// Security events: every analysed request with its verdict, alert level and reason, and the
// simulator's ground truth to check it against. Filters, page, rows per page and order are plain
// links (?show=...&page=...&rows=...&order=...), like the rest of the multi-page app (ADR-010).
// The table fills up as the live replay brings the requests in (E-08, ADR-011): the links and
// rows that stay are kept between frames, so a click on them is never lost. Payloads are shown as
// text only.

import { initShell } from '../shell.js';
import { runExperiment, topPart } from '../pipeline.js';
import { severityOf } from '../levels.js';
import { withState } from '../state.js';
import { h, mount, fmt, patchChildren, setText } from '../dom.js';
import { levelBadge, sortToggle, pageSizeLinks } from '../ui.js';
import { requestRowClass } from '../rows.js';
import { DEFAULT_PAGE_SIZE, readPageSize, readOrder, pageOf } from '../listing.js';
import { initLive } from '../live.js';

const COLUMNS = 8;

/** @type {Record<string, { label: string, keep: (e: import('../pipeline.js').DashboardEvent) => boolean }>} */
const FILTERS = {
  all: { label: 'All', keep: () => true },
  alerts: { label: 'Alerts', keep: (e) => e.alert },
  clean: { label: 'Not flagged', keep: (e) => !e.alert },
  mistakes: { label: 'Detector mistakes', keep: (e) => !e.correct },
};

const state = initShell();
const run = runExperiment(state);
const { events } = run;
const query = new URLSearchParams(location.search);
const requested = query.get('show') ?? 'all';
const show = Object.hasOwn(FILTERS, requested) ? requested : 'all';
const size = readPageSize(query.get('rows'));
const order = readOrder(query.get('order'));

/** Events whose details are open: they stay open while new requests arrive. */
const open = new Set();
/** The rows drawn, by event id: a row that stays on the page is kept, not drawn again. */
const drawnRows = new Map();
let drawn = ''; // the rows the table shows now: an unchanged page is not drawn again

// Drawn once: the tabs, the list controls and the pager. Each frame only updates their numbers,
// so a click that has started on one of them survives the next frame.
/** @type {Record<string, HTMLElement>} */
const tabCounts = {};
mount(
  '#tabs',
  Object.entries(FILTERS).map(([key, filter]) => {
    tabCounts[key] = h('span', { class: 'count' }, '0');
    return h(
      'a',
      {
        href: link({ show: key === 'all' ? null : key, page: null }),
        'aria-current': key === show ? 'page' : null,
        'data-keep-live': true,
      },
      filter.label,
      tabCounts[key],
    );
  }),
);
mount(
  '#events-controls',
  pageSizeLinks(size, (n) => link({ rows: n === DEFAULT_PAGE_SIZE ? null : n, page: null })),
  sortToggle(
    'a',
    {
      href: link({ order: order === 'newest' ? 'oldest' : null, page: null }),
      title: 'Change the order of the events',
      'data-keep-live': true,
    },
    order === 'newest',
  ),
);
document
  .querySelector('#events-order')
  ?.setAttribute('aria-sort', order === 'newest' ? 'descending' : 'ascending');
const pagerText = h('span');
const previous = h('a', { 'data-keep-live': true }, '<- Previous');
const next = h('a', { 'data-keep-live': true }, 'Next ->');
mount('#pager', pagerText, h('span', { class: 'pager-links' }, previous, next));

initLive({ state, run, render });

/** @param {import('../replay.js').Frame} frame */
function render(frame) {
  const arrived = events.slice(0, frame.at);
  const view = order === 'newest' ? arrived.reverse() : arrived; // newest first, as in a SIEM
  const rows = view.filter(FILTERS[show].keep);
  const { page, pages, first, items: shown } = pageOf(rows, query.get('page'), size);

  for (const [key, filter] of Object.entries(FILTERS)) {
    setText(tabCounts[key], fmt.int(view.filter(filter.keep).length));
  }

  setText(
    /** @type {HTMLElement} */ (document.querySelector('#events-meta')),
    rows.length
      ? `${fmt.int(first + 1)}-${fmt.int(first + shown.length)} of ${fmt.int(rows.length)} · ` +
          `${order} first`
      : 'No events',
  );

  const key = `${frame.stage === 'idle'}:${shown.map((e) => e.id).join(',')}`;
  if (key !== drawn) {
    drawn = key;
    const body = /** @type {HTMLElement} */ (document.querySelector('#events-body'));
    if (shown.length) {
      const ids = new Set(shown.map((e) => e.id));
      for (const id of drawnRows.keys()) if (!ids.has(id)) drawnRows.delete(id);
      const nodes = shown.flatMap((e) => {
        let pair = drawnRows.get(e.id);
        if (!pair) {
          pair = eventRows(e);
          drawnRows.set(e.id, pair);
        }
        return pair;
      });
      patchChildren(body, nodes);
    } else {
      drawnRows.clear();
      let text = 'No events match this filter.';
      if (frame.stage === 'idle') {
        text = 'No traffic yet. Press Start monitoring to watch the requests arrive.';
      } else if (view.length === 0) text = 'Waiting for the first request...';
      mount('#events-body', h('tr', {}, h('td', { colspan: COLUMNS, class: 'empty' }, text)));
    }
  }

  setText(pagerText, `Page ${page} of ${pages}`);
  pagerLink(previous, page > 1 ? link({ page: page - 1 > 1 ? page - 1 : null }) : null);
  pagerLink(next, page < pages ? link({ page: page + 1 }) : null);
}

/**
 * Point a pager link at a page, or disable it (no href: it cannot be followed or focused).
 * @param {HTMLElement} anchor
 * @param {string | null} href
 */
function pagerLink(anchor, href) {
  const target = href ?? '';
  if (anchor.dataset.base === target) return; // unchanged: src/live.js keeps `at` on it
  anchor.dataset.base = target;
  if (href === null) anchor.removeAttribute('href');
  else anchor.setAttribute('href', href);
  anchor.classList.toggle('is-disabled', href === null);
  if (href === null) anchor.setAttribute('aria-disabled', 'true');
  else anchor.removeAttribute('aria-disabled');
}

/**
 * A link to this page with the current settings, filter, rows per page and order; src/live.js
 * adds the replay's position (`data-keep-live`).
 * @param {Record<string, any>} extra
 */
function link(extra) {
  return withState('./events.html', state, {
    show: show === 'all' ? null : show,
    rows: size === DEFAULT_PAGE_SIZE ? null : size,
    order: order === 'newest' ? null : order,
    ...extra,
  });
}

/** The summary row and its (hidden) detail row. @param {import('../pipeline.js').DashboardEvent} e */
function eventRows(e) {
  const { request } = e.sample;
  const detailId = `event-${e.id}`;
  const params = Object.entries(request.params)
    .map(([name, value]) => `${name}=${value}`)
    .join('  ');

  const isOpen = open.has(e.id);
  const toggle = h(
    'button',
    {
      class: 'row-toggle',
      type: 'button',
      'aria-expanded': String(isOpen),
      'aria-controls': detailId,
      'aria-label': `Details of event ${e.id}`,
    },
    h('span', { class: 'chevron', 'aria-hidden': 'true' }),
  );
  const row = h(
    'tr',
    { class: requestRowClass(e, 'event-row', isOpen && 'is-open') },
    h('td', {}, toggle),
    h('td', { class: 'num' }, String(e.id)),
    h('td', { class: 'mono nowrap', 'data-raw': true }, `${request.method} ${request.path}`),
    h('td', { class: 'mono truncate', title: params, 'data-raw': true }, params),
    h('td', {}, levelBadge(e.level)),
    h('td', { class: 'nowrap' }, detection(e)),
    h(
      'td',
      {},
      e.alert
        ? h('span', { class: 'badge is-alert' }, 'Alert')
        : h('span', { class: 'badge is-clean' }, 'Not flagged'),
    ),
    h('td', { class: 'nowrap' }, truth(e)), // one line: rows keep one height while they arrive
  );
  const detail = h(
    'tr',
    { class: 'event-detail', id: detailId, hidden: !isOpen },
    h('td', { colspan: COLUMNS }, detailView(e)),
  );

  const flip = () => {
    const opening = detail.hidden;
    detail.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    row.classList.toggle('is-open', opening);
    if (opening) open.add(e.id);
    else open.delete(e.id);
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    flip();
  });
  row.addEventListener('click', flip);
  return [row, detail];
}

/** Which rule or signal raised the alert. @param {import('../pipeline.js').DashboardEvent} e */
function detection(e) {
  const { result } = e;
  if (result.ruleMatched) {
    return h(
      'span',
      { class: 'mono' },
      [...new Set(result.detail.hits.map((x) => x.ruleId))].join(', '),
    );
  }
  if (e.alert) {
    const top = topPart(result.detail.parts);
    return top ? `${top.name} · s = ${fmt.score(top.score)}` : 'statistics';
  }
  return h('span', { class: 'muted' }, '-');
}

/** The simulator's label, and whether the detector got it wrong. @param {import('../pipeline.js').DashboardEvent} e */
function truth(e) {
  const { sample } = e;
  const text =
    sample.label === 'attack'
      ? `attack · ${sample.kind} · ${sample.variant}`
      : `legit · ${sample.variant}`;
  if (e.correct) return text;
  return [text, ' ', h('span', { class: 'badge is-mistake' }, e.alert ? 'false alarm' : 'missed')];
}

/** @param {import('../pipeline.js').DashboardEvent} e */
function detailView(e) {
  const { sample, result } = e;
  /** @type {[string, string, string?][]} */
  const facts = [
    ['Request', `${sample.request.method} ${sample.request.path}`, 'mono'],
    ...Object.entries(sample.request.params).map(([name, value]) => [
      `Parameter ${name}`,
      String(value),
      'mono',
    ]),
    ['Detector score', fmt.score(result.score)],
    ['Statistical score', `${fmt.score(result.statScore)} (−log₁₀ p)`],
    ...Object.entries(result.detail.parts).map(([name, score]) => [
      `Signal ${name}`,
      fmt.score(score),
    ]),
    ['Alert level', `${e.level} · ${severityOf(e.level)} severity`],
    ['Why', result.reasons.length ? result.reasons.join('; ') : 'nothing reached the threshold'],
    [
      'Ground truth',
      sample.label === 'attack'
        ? `attack (${sample.kind}, ${sample.variant})`
        : `legitimate (${sample.variant})`,
    ],
  ];
  const json = JSON.stringify(
    {
      request: sample.request,
      verdict: result.verdict,
      score: result.score,
      statScore: result.statScore,
      ruleMatched: result.ruleMatched,
      hits: result.detail.hits,
      parts: result.detail.parts,
      reasons: result.reasons,
      level: e.level,
      truth: { label: sample.label, kind: sample.kind, variant: sample.variant },
    },
    (_key, value) => (value === Infinity ? 'Infinity' : value),
    2,
  );
  return h(
    'div',
    { class: 'detail-grid' },
    h(
      'div',
      {},
      h('h3', { class: 'detail-title' }, 'Summary'),
      h(
        'dl',
        { class: 'kv' },
        facts.map(([term, value, cls]) => [
          h('dt', {}, term),
          // the request's own values are shown as typed: no term help inside them
          h('dd', { class: cls, 'data-raw': cls === 'mono' ? true : null }, value),
        ]),
      ),
    ),
    h('div', {}, h('h3', { class: 'detail-title' }, 'JSON'), h('pre', { class: 'json' }, json)),
  );
}
