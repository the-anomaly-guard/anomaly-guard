// Overview: key figures, alerts by severity, every request that has arrived (in a box that
// scrolls, newest or oldest first), alerts by level, what raised them, the most frequent
// signatures, and links to the other modules. The page opens empty and fills up as the live
// replay brings the test requests in (E-08, ADR-011).

import { initShell } from '../shell.js';
import { runExperiment, countBy } from '../pipeline.js';
import { SEVERITIES, SIGNATURE_LEVEL, severityOf } from '../levels.js';
import { h, mount, fmt } from '../dom.js';
import { kpi, levelBadge } from '../ui.js';
import { requestRowClass } from '../rows.js';
import {
  setupCharts,
  barChart,
  doughnutChart,
  token,
  setChartData,
  chartMessage,
} from '../charts.js';
import { initLive } from '../live.js';

const SEVERITY_TEXT = {
  critical: ['Critical', 'level 15 · a signature matched'],
  high: ['High', 'level 4-14 · p ≤ 10⁻⁴'],
  medium: ['Medium', 'level 2-3 · p ≤ 10⁻²'],
  low: ['Low', 'level 0-1'],
};
const SOURCES = ['signature', 'statistics', 'both'];

const state = initShell();
const run = runExperiment(state);
const { events } = run;

setupCharts();
const levels = Array.from({ length: SIGNATURE_LEVEL + 1 }, (_, level) => level);
const levelChart = barChart(canvas('#chart-levels'), {
  label: 'Alerts',
  labels: levels.map(String),
  values: levels.map(() => 0),
  colors: levels.map((level) => token(`--sev-${severityOf(level)}`)),
});
const sourceChart = doughnutChart(canvas('#chart-source'), {
  labels: ['Signature only', 'Statistics only', 'Both'],
  values: SOURCES.map(() => 0),
  colors: [token('--src-signature'), token('--src-statistics'), token('--src-both')],
});
const ruleChart = barChart(canvas('#chart-rules'), {
  label: 'Requests matched',
  labels: [],
  values: [],
  colors: token('--primary'),
  horizontal: true,
});

// The requests panel: every request that has arrived, in a box that scrolls.
const feedBody = /** @type {HTMLElement} */ (document.querySelector('#feed-body'));
const feedScroll = /** @type {HTMLElement} */ (document.querySelector('#feed-scroll'));
let newestFirst = true; // like a SIEM; the button turns it around
let drawnUpTo = 0; // requests that have arrived: ids 1..drawnUpTo (some may still be queued)
/** @type {import('../pipeline.js').DashboardEvent[]} arrived but not drawn yet, oldest first */
let queue = [];
let flushing = 0; // the pending flush timer, 0 when none
/** Rows drawn per task: a jump to thousands of requests must not freeze the page. */
const CHUNK = 150;

document.querySelector('[data-feed-sort]')?.addEventListener('click', () => {
  newestFirst = !newestFirst;
  const rows = [...feedBody.querySelectorAll('tr[data-id]')];
  rows.sort((a, b) => (Number(a.dataset.id) - Number(b.dataset.id)) * (newestFirst ? -1 : 1));
  feedBody.append(...rows); // moves the rows, nothing is drawn again
  feedScroll.scrollTop = 0;
  showOrder();
});
// The arrival highlight plays once: without this, moving a row would play it again.
feedBody.addEventListener('animationend', (event) => {
  if (event.target instanceof Element) event.target.closest('tr')?.classList.remove('is-new');
});
showOrder();

initLive({ state, run, render });

/** @param {import('../replay.js').Frame} frame */
function render(frame) {
  const view = events.slice(0, frame.at);
  const alerts = view.filter((e) => e.alert);
  const waiting = frame.stage === 'idle' ? 'No traffic yet.' : 'Waiting for the first request...';

  mount(
    '#kpis',
    kpi('Requests analysed', view.length),
    kpi('Alerts', alerts.length, 'primary'),
    kpi('Signature matches', alerts.filter((e) => e.result.ruleMatched).length, 'danger'),
    kpi(
      'Statistical alerts (no rule matched)',
      alerts.filter((e) => !e.result.ruleMatched).length,
      'warning',
    ),
  );

  const bySeverity = countBy(alerts, (e) => severityOf(e.level));
  mount(
    '#severity',
    [...SEVERITIES].reverse().map((severity) => {
      const [name, info] = SEVERITY_TEXT[severity];
      return h(
        'div',
        { class: `sev-tile sev-${severity}` },
        h('span', { class: 'sev-count' }, fmt.int(bySeverity.get(severity) ?? 0)),
        h('span', { class: 'sev-name' }, `${name} severity`),
        h('span', { class: 'sev-info' }, info),
      );
    }),
  );

  drawFeed(view, frame);

  const byLevel = countBy(alerts, (e) => e.level);
  setChartData(levelChart, { values: levels.map((level) => byLevel.get(level) ?? 0) });

  const bySource = countBy(alerts, (e) => e.source);
  setChartData(sourceChart, { values: SOURCES.map((s) => bySource.get(s) ?? 0) });
  let sourceText = null;
  if (view.length === 0) sourceText = waiting;
  else if (alerts.length === 0) sourceText = 'No alerts with these settings.';
  chartMessage(sourceChart, sourceText);

  const hitsByRule = new Map();
  for (const e of view) {
    for (const id of new Set(e.result.detail.hits.map((hit) => hit.ruleId))) {
      hitsByRule.set(id, (hitsByRule.get(id) ?? 0) + 1);
    }
  }
  const topRules = [...hitsByRule]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 7);
  setChartData(ruleChart, {
    labels: topRules.map(([id]) => id),
    values: topRules.map(([, n]) => n),
  });
  let rulesText = null;
  if (state.mode === 'stats') rulesText = 'Rules are not evaluated in statistics-only mode.';
  else if (view.length === 0) rulesText = waiting;
  else if (topRules.length === 0) rulesText = 'No signature matched.';
  chartMessage(ruleChart, rulesText);
}

/**
 * Every request that has arrived, in the chosen order. New rows go in at the top (newest first) or
 * at the bottom (oldest first); a row already there is never drawn again, so its highlight is not
 * cut short and the box keeps its scroll position while you read. A big jump (Skip to the end, a
 * link with at=end) is drawn in chunks, the visible end first, so the page stays responsive.
 * @param {import('../pipeline.js').DashboardEvent[]} view  the requests arrived so far
 * @param {import('../replay.js').Frame} frame
 */
function drawFeed(view, frame) {
  if (view.length === 0 || view.length < drawnUpTo) {
    // Nothing yet, or the replay started again: begin from an empty table.
    drawnUpTo = 0;
    queue = [];
    clearTimeout(flushing);
    flushing = 0;
    feedBody.replaceChildren(
      h(
        'tr',
        {},
        h(
          'td',
          { colspan: 5, class: 'empty' },
          frame.stage === 'idle'
            ? 'No traffic yet. Press Start monitoring to watch the requests arrive.'
            : 'Waiting for the first request...',
        ),
      ),
    );
    showOrder();
    if (view.length === 0) return;
  }
  if (drawnUpTo === 0) feedBody.replaceChildren();
  // Ids are positions in the test split (1-based): the new requests are view[drawnUpTo...].
  const animate = frame.stage === 'playing' && drawnUpTo > 0;
  queue.push(...view.slice(drawnUpTo));
  drawnUpTo = view.length;
  flush(animate);
  showOrder();
}

/**
 * Draw up to CHUNK queued requests and come back in the next task for the rest. The drawn rows are
 * always one run of consecutive ids, lo..hi, and the queue holds the others, oldest first: some
 * older than lo, some newer than hi. Each chunk is taken next to the run (just below lo, or just
 * above hi), so the run stays whole and in order whatever happens in between: new arrivals, a
 * change of order. The side at the top of the table comes first.
 * @param {boolean} animate  highlight the rows as just arrived
 */
function flush(animate) {
  flushing = 0;
  if (queue.length === 0) return;
  const drawn = feedBody.querySelectorAll('tr[data-id]');
  /** @type {import('../pipeline.js').DashboardEvent[]} */
  let batch;
  let newer = true;
  if (drawn.length === 0) {
    // An empty table: start at the end the eye sees first.
    batch = newestFirst ? queue.splice(-CHUNK) : queue.splice(0, CHUNK);
  } else {
    const ends = [Number(drawn[0].dataset.id), Number(drawn[drawn.length - 1].dataset.id)];
    const hi = Math.max(...ends);
    const firstNewer = queue.findIndex((e) => e.id > hi);
    const older = firstNewer === -1 ? queue.length : firstNewer; // queue[0..older) are below lo
    const takeNewer = queue.length > older && (newestFirst || older === 0);
    if (takeNewer)
      batch = queue.splice(older, CHUNK); // just above hi
    else {
      const n = Math.min(CHUNK, older);
      batch = queue.splice(older - n, n); // just below lo
      newer = false;
    }
  }
  const rows = batch.map((e) => feedRow(e, animate));
  if (newestFirst) rows.reverse(); // the table runs from the highest id down
  // Newest first: newer rows go on top, older ones below. Oldest first: the other way round.
  if (newer === newestFirst) feedBody.prepend(...rows);
  else feedBody.append(...rows);
  if (queue.length) flushing = window.setTimeout(() => flush(false), 0);
}

/** The sort button, the # column and the line above the table say which order is shown. */
function showOrder() {
  const label = document.querySelector('[data-feed-sort-label]');
  if (label) label.textContent = newestFirst ? 'Newest first' : 'Oldest first';
  document.querySelector('[data-feed-sort]')?.classList.toggle('is-ascending', !newestFirst);
  document
    .querySelector('#feed-order')
    ?.setAttribute('aria-sort', newestFirst ? 'descending' : 'ascending');
  let meta = '';
  if (drawnUpTo > 0) meta = `${fmt.int(drawnUpTo)} of ${fmt.int(events.length)} arrived`;
  if (drawnUpTo > 8) meta += ' · scroll to see them all';
  mount('#feed-meta', meta);
}

/**
 * @param {import('../pipeline.js').DashboardEvent} e
 * @param {boolean} animate  highlight it as just arrived
 */
function feedRow(e, animate) {
  const { request } = e.sample;
  const params = Object.entries(request.params)
    .map(([name, value]) => `${name}=${value}`)
    .join('  ');
  return h(
    'tr',
    { class: requestRowClass(e, 'feed-row', animate && 'is-new'), dataset: { id: String(e.id) } },
    h('td', { class: 'num' }, String(e.id)),
    h('td', { class: 'mono nowrap' }, `${request.method} ${request.path}`),
    h('td', { class: 'mono truncate', title: params }, params),
    h('td', {}, levelBadge(e.level)),
    h(
      'td',
      { class: 'nowrap' },
      e.alert
        ? h('span', { class: 'badge is-alert' }, 'Alert')
        : h('span', { class: 'badge is-clean' }, 'Not flagged'),
      e.correct
        ? null
        : [' ', h('span', { class: 'badge is-mistake' }, e.alert ? 'false alarm' : 'missed')],
    ),
  );
}

/** @param {string} selector */
function canvas(selector) {
  return /** @type {HTMLCanvasElement} */ (document.querySelector(selector));
}
