// Import logs (E-10, ADR-016): the access log of a real web server, read in this browser and
// analysed with the console's detector. Every log format is a plug-in in src/log-import/formats/,
// found here by Vite: a new file there is a new format, with no change to this page or to the
// engine (open for extension, closed for modification). Nothing leaves the page: no upload and no
// storage; closing it forgets the log.

import '../logs.css';
import { initShell } from '../shell.js';
import { h, mount, fmt, setText } from '../dom.js';
import { kpi, levelBadge, sortToggle, setSortToggle } from '../ui.js';
import { requestRowClass } from '../rows.js';
import { severityOf } from '../levels.js';
import { topPart } from '../pipeline.js';
import { FPR_TARGETS } from '../state.js';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageOf } from '../listing.js';
import { readLog } from '../log-import/read.js';
import { MAX_TEXT_CHARS, readFiles } from '../log-import/text.js';
import { PATH_PARAM } from '../log-import/request.js';
import { sampleLog } from '../log-import/sample.js';
import {
  BASELINE_SHARES,
  DEFAULT_BASELINE_SHARE,
  analyseLog,
  splitBaseline,
} from '../log-import/analyse.js';

/** @typedef {import('../log-import/format.js').LogFormat} LogFormat */
/** @typedef {import('../log-import/analyse.js').LogRow} LogRow */

/** Every format in src/log-import/formats/, the most specific first. */
const FORMATS = /** @type {LogFormat[]} */ (
  Object.values(import.meta.glob('../log-import/formats/*.js', { eager: true, import: 'default' }))
).sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));

const COLUMNS = 9;
const state = initShell();

/** @param {string} id */
const byId = (id) => /** @type {any} */ (document.getElementById(id));
/** @type {HTMLTextAreaElement} */
const textArea = byId('log-text');
/** @type {HTMLInputElement} */
const fileInput = byId('log-files');
/** @type {HTMLInputElement} */
const baselineInput = byId('log-baseline-files');
/** @type {HTMLSelectElement} */
const formatSelect = byId('log-format');
/** @type {HTMLSelectElement} */
const exampleSelect = byId('log-example');
/** @type {HTMLSelectElement} */
const shareSelect = byId('log-share');
/** @type {HTMLSelectElement} */
const modeSelect = byId('log-mode');
/** @type {HTMLSelectElement} */
const fprSelect = byId('log-fpr');
/** @type {HTMLInputElement} */
const thresholdInput = byId('log-threshold');
/** @type {HTMLButtonElement} */
const analyseButton = byId('log-analyse');
const status = byId('log-status');
const results = byId('log-results');

// --- The controls, filled from the formats and the console's own settings --------------------

mount(
  '#log-format',
  h('option', { value: 'auto' }, 'Recognise it'),
  FORMATS.map((format) => h('option', { value: format.id }, format.label)),
);
mount(
  '#log-example',
  FORMATS.map((format) => h('option', { value: format.id }, format.label)),
);
mount(
  '#log-share',
  BASELINE_SHARES.map((share) =>
    h(
      'option',
      { value: String(share), selected: share === DEFAULT_BASELINE_SHARE },
      `${share * 100}%`,
    ),
  ),
);
mount(
  '#log-fpr',
  FPR_TARGETS.map((target) =>
    h(
      'option',
      { value: String(target), selected: target === 0.01 },
      `${target * 100}% (calibrated)`,
    ),
  ),
  h('option', { value: 'manual' }, 'Manual threshold'),
);
const syncThreshold = () => {
  thresholdInput.readOnly = fprSelect.value !== 'manual';
};
fprSelect.addEventListener('change', syncThreshold);
syncThreshold();

// --- Where the log comes from: files (picked or dropped) or the text box -----------------------

/** @type {File[]} */
let files = [];

/** @param {File[]} chosen */
function useFiles(chosen) {
  files = chosen;
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  setText(
    byId('log-chosen'),
    chosen.length
      ? `${fmt.count(chosen.length, 'file')}, ${(total / 1048576).toFixed(1)} MB: ` +
          chosen.map((file) => file.name).join(', ')
      : '',
  );
}
fileInput.addEventListener('change', () => useFiles([...(fileInput.files ?? [])]));
textArea.addEventListener('input', () => {
  if (files.length) useFiles([]); // typing means: read the text box
});

const drop = byId('log-drop');
drop.addEventListener('dragover', (/** @type {DragEvent} */ event) => {
  event.preventDefault();
  drop.classList.add('is-over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
drop.addEventListener('drop', (/** @type {DragEvent} */ event) => {
  event.preventDefault();
  drop.classList.remove('is-over');
  useFiles([...(event.dataTransfer?.files ?? [])]);
});

byId('log-example-load').addEventListener('click', () => {
  const format = FORMATS.find((f) => f.id === exampleSelect.value);
  if (!format) return;
  useFiles([]);
  textArea.value = `${format.examples.join('\n')}\n`;
  say(`Pasted the ${format.label} example: ${fmt.count(format.examples.length, 'line')}.`);
});

byId('log-sample').addEventListener('click', () => {
  const sample = sampleLog({ seed: state.seed });
  useFiles([]);
  textArea.value = sample.text;
  // The largest baseline share that stays within the attack-free start of the sample.
  const fits = BASELINE_SHARES.filter((share) => share <= sample.baselineShare);
  shareSelect.value = String(fits.length ? Math.max(...fits) : DEFAULT_BASELINE_SHARE);
  say(
    `Generated a sample log from the simulated traffic (seed ${state.seed}): ` +
      `${fmt.int(sample.labels.length)} requests, legitimate first, then a stretch with 10% ` +
      'attacks. Press Analyse.',
  );
});

/** @param {string} text @param {boolean} [error] */
function say(text, error = false) {
  setText(status, text);
  status.classList.toggle('is-error', error);
}

// --- The analysis ---------------------------------------------------------------------------

/** @type {{ rows: LogRow[], mode: string, threshold: number } | null} */
let analysed = null;
const view = { show: 'all', size: DEFAULT_PAGE_SIZE, page: 1, newestFirst: false };
/** Rows whose details are open. */
const open = new Set();

analyseButton.addEventListener('click', () => {
  analyseButton.disabled = true;
  run()
    .catch((error) => say(error instanceof Error ? error.message : String(error), true))
    .finally(() => {
      analyseButton.disabled = false;
    });
});

async function run() {
  say('Reading the log...');
  const { text, cut } = files.length
    ? await readFiles(files)
    : { text: textArea.value, cut: /** @type {string[]} */ ([]) };
  if (!text.trim()) throw new Error('There is nothing to read: choose a file or paste some lines.');
  const read = readLog(text, FORMATS, { formatId: formatSelect.value });
  if (!read.format) {
    throw new Error(
      `No format reads these ${fmt.count(read.lines, 'line')}. Check that they are access-log lines ` +
        'with requests, or pick the format by hand.',
    );
  }
  if (read.entries.length === 0)
    throw new Error(`The ${read.format.label} reader found no request in the log.`);

  const fromFile =
    /** @type {HTMLInputElement} */ (document.querySelector('input[name="log-baseline"]:checked'))
      .value === 'file';
  let baseline;
  let inspected;
  if (fromFile) {
    const chosen = [...(baselineInput.files ?? [])];
    if (!chosen.length)
      throw new Error('Choose the log that counts as normal, or use the first part of this one.');
    const base = readLog((await readFiles(chosen)).text, FORMATS, {
      formatId: formatSelect.value,
    });
    if (!base.format) throw new Error('No format reads the baseline log.');
    baseline = base.entries;
    inspected = read.entries;
  } else {
    ({ baseline, inspected } = splitBaseline(read.entries, Number(shareSelect.value)));
    // The rules learn nothing, so they inspect the whole log; the baseline only says how often
    // they fire on traffic taken as normal.
    if (modeSelect.value === 'rules') inspected = read.entries;
  }
  if (inspected.length === 0)
    throw new Error('Nothing is left to inspect after the baseline: use a smaller share.');

  const settings = {
    mode: /** @type {'combined' | 'stats' | 'rules'} */ (modeSelect.value),
    fpr:
      fprSelect.value === 'manual' ? /** @type {'manual'} */ ('manual') : Number(fprSelect.value),
    threshold: Number(thresholdInput.value),
  };
  say(`Learning normal traffic from ${fmt.count(baseline.length, 'request')}...`);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the message show
  const outcome = await analyseLog(
    { baseline, inspected, settings },
    {
      onProgress: (done, total) =>
        say(`Scoring the requests: ${fmt.int(done)} of ${fmt.int(total)}...`),
    },
  );

  analysed = { rows: outcome.rows, mode: settings.mode, threshold: outcome.operating.threshold };
  Object.assign(view, { show: 'all', page: 1 });
  open.clear();
  drawSummary(read, baseline.length, outcome, settings, cut);
  drawTable();
  results.hidden = false;
  say(
    `Read as ${read.format.label}: ${fmt.count(read.entries.length, 'request')}` +
      (read.skipped ? `, ${fmt.count(read.skipped, 'line')} without a request` : '') +
      (read.unreadable ? `, ${fmt.count(read.unreadable, 'unreadable line')}` : '') +
      '.',
  );
}

/**
 * @param {import('../log-import/read.js').ReadResult} read
 * @param {number} baselineSize
 * @param {Awaited<ReturnType<typeof analyseLog>>} outcome
 * @param {{ mode: string }} settings
 * @param {string[]} cut  the files read in part or not at all
 */
function drawSummary(read, baselineSize, outcome, settings, cut) {
  const inspected = outcome.rows.length;
  const share = inspected ? fmt.pct(outcome.alerts / inspected) : '-';
  mount(
    '#log-kpis',
    kpi('Requests read', read.entries.length, 'neutral', read.format?.label),
    kpi(
      'Baseline',
      baselineSize,
      'neutral',
      settings.mode !== 'rules'
        ? `model ${fmt.int(outcome.train)} · threshold ${fmt.int(outcome.calibration)}`
        : outcome.calibration > 0
          ? `the rules match ${fmt.pct(outcome.operating.calibrationFpr)} of its last 30%`
          : 'too short to try the rules on',
    ),
    kpi('Inspected', inspected),
    kpi(
      'Alerts',
      outcome.alerts,
      outcome.alerts ? 'danger' : 'success',
      `${share} of the inspected`,
    ),
    kpi('Signature matches', outcome.signatures, 'primary'),
    kpi(
      'Statistical alerts',
      outcome.statistical,
      'warning',
      settings.mode === 'rules'
        ? 'rules only'
        : `threshold ${fmt.score(outcome.operating.threshold)}`,
    ),
  );
  const notes = [...outcome.warnings];
  if (cut.length) {
    const named =
      cut.length > 3 ? `${cut.slice(0, 3).join(', ')} and ${cut.length - 3} more` : cut.join(', ');
    notes.push(
      `The page keeps the first ${MAX_TEXT_CHARS / 1048576} MB of text of a log, decompressed: ` +
        `${named} ${cut.length === 1 ? 'was' : 'were'} read in part or not at all.`,
    );
  }
  if (read.truncated)
    notes.push(
      `The log holds more requests than the page reads: only the first ${fmt.int(read.entries.length)} are analysed.`,
    );
  if (read.unreadable) {
    notes.push(
      `${fmt.count(read.unreadable, 'line')} could not be read as ${read.format?.label}, for example line ` +
        `${read.examples[0].line}: ${read.examples[0].text.slice(0, 160)}`,
    );
  }
  mount(
    '#log-warnings',
    notes.map((note) => h('div', { class: 'callout is-warning', 'data-raw': true }, note)),
  );
}

// --- The table of inspected requests ----------------------------------------------------------

const tabCounts = { all: h('span', { class: 'count' }), alerts: h('span', { class: 'count' }) };
const tabs = {
  all: h('a', { href: '#log-results' }, 'All ', tabCounts.all),
  alerts: h('a', { href: '#log-results' }, 'Alerts ', tabCounts.alerts),
};
for (const [show, tab] of Object.entries(tabs)) {
  tab.addEventListener('click', (event) => {
    event.preventDefault();
    Object.assign(view, { show, page: 1 });
    drawTable();
  });
}
mount('#log-tabs', tabs.all, tabs.alerts);

const sizeButtons = PAGE_SIZES.map((size) => {
  const button = h(
    'button',
    { type: 'button', class: 'btn btn-small', title: `${size} per page` },
    String(size),
  );
  button.addEventListener('click', () => {
    Object.assign(view, { size, page: 1 });
    drawTable();
  });
  return button;
});
const orderToggle = sortToggle(
  'button',
  { type: 'button', title: 'Change the order of the requests' },
  view.newestFirst,
);
orderToggle.addEventListener('click', () => {
  Object.assign(view, { newestFirst: !view.newestFirst, page: 1 });
  drawTable();
});
mount(
  '#log-controls',
  h(
    'span',
    { class: 'page-size', role: 'group', 'aria-label': 'Rows per page' },
    h('span', { class: 'page-size-label' }, 'Rows'),
    sizeButtons,
  ),
  orderToggle,
);

const pagerText = h('span');
const previous = h('button', { type: 'button', class: 'btn btn-small' }, '<- Previous');
const next = h('button', { type: 'button', class: 'btn btn-small' }, 'Next ->');
previous.addEventListener('click', () => {
  view.page -= 1;
  drawTable();
});
next.addEventListener('click', () => {
  view.page += 1;
  drawTable();
});
mount('#log-pager', pagerText, h('span', { class: 'pager-links' }, previous, next));

function drawTable() {
  if (!analysed) return;
  const { rows } = analysed;
  const alerts = rows.filter((row) => row.alert);
  setText(tabCounts.all, fmt.int(rows.length));
  setText(tabCounts.alerts, fmt.int(alerts.length));
  for (const [show, tab] of Object.entries(tabs)) {
    if (show === view.show) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  sizeButtons.forEach((button, i) =>
    button.setAttribute('aria-pressed', String(PAGE_SIZES[i] === view.size)),
  );
  setSortToggle(orderToggle, view.newestFirst);

  const listed = view.show === 'alerts' ? alerts : rows;
  const ordered = view.newestFirst ? [...listed].reverse() : listed;
  const { page, pages, first, items } = pageOf(ordered, String(view.page), view.size);
  view.page = page;
  mount(
    '#log-body',
    items.length
      ? items.flatMap(rowsOf)
      : h('tr', {}, h('td', { colspan: COLUMNS, class: 'empty' }, 'No request here.')),
  );
  setText(
    byId('log-meta'),
    items.length
      ? `${fmt.int(first + 1)}-${fmt.int(first + items.length)} of ${fmt.int(listed.length)}`
      : '',
  );
  setText(pagerText, `Page ${page} of ${pages}`);
  previous.disabled = page <= 1;
  next.disabled = page >= pages;
}

/** The parameters of a request as name=value, the path aside. @param {LogRow} row */
function paramsText(row) {
  return Object.entries(row.request.params)
    .filter(([name]) => !name.startsWith(PATH_PARAM))
    .map(([name, value]) => `${name}=${value}`)
    .join('  ');
}

/** The summary row and its detail row. @param {LogRow} row */
function rowsOf(row) {
  const isOpen = open.has(row.id);
  const detailId = `log-row-${row.id}`;
  const toggle = h(
    'button',
    {
      class: 'row-toggle',
      type: 'button',
      'aria-expanded': String(isOpen),
      'aria-controls': detailId,
      'aria-label': `Details of line ${row.entry.line}`,
    },
    h('span', { class: 'chevron', 'aria-hidden': 'true' }),
  );
  const params = paramsText(row);
  const summary = h(
    'tr',
    // No ground truth in a real log, so no row is marked as the detector's mistake.
    {
      class: requestRowClass({ alert: row.alert, correct: true }, 'event-row', isOpen && 'is-open'),
    },
    h('td', {}, toggle),
    h('td', { class: 'num' }, String(row.entry.line)),
    // The clock time only, so nine columns fit; the whole time is on hover and in the details.
    // Not preceded by a digit: in Apache's 10/Nov/2026:19:12:31 the year ends in "26:".
    h(
      'td',
      { class: 'mono nowrap', title: row.entry.time ?? null, 'data-raw': true },
      (row.entry.time && /(?:^|\D)(\d{2}:\d{2}:\d{2})/.exec(row.entry.time)?.[1]) ??
        row.entry.time ??
        '-',
    ),
    h(
      'td',
      {
        class: 'mono nowrap truncate',
        title: `${row.request.method} ${row.request.path}`,
        'data-raw': true,
      },
      `${row.request.method} ${row.request.path}`,
    ),
    h('td', { class: 'mono truncate', title: params, 'data-raw': true }, params || '-'),
    h('td', { class: 'num' }, row.entry.status === null ? '-' : String(row.entry.status)),
    h('td', {}, levelBadge(row.level)),
    h('td', { class: 'nowrap' }, detection(row)),
    h(
      'td',
      {},
      row.alert
        ? h('span', { class: 'badge is-alert' }, 'Alert')
        : h('span', { class: 'badge is-clean' }, 'Not flagged'),
    ),
  );
  const detail = h(
    'tr',
    { class: 'event-detail', id: detailId, hidden: !isOpen },
    h('td', { colspan: COLUMNS }, detailView(row)),
  );
  const flip = () => {
    const opening = detail.hidden;
    detail.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    summary.classList.toggle('is-open', opening);
    if (opening) open.add(row.id);
    else open.delete(row.id);
  };
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    flip();
  });
  summary.addEventListener('click', flip);
  return [summary, detail];
}

/** Which rule or signal raised the alert. @param {LogRow} row */
function detection(row) {
  const { result } = row;
  if (result.ruleMatched) {
    return h(
      'span',
      { class: 'mono' },
      [...new Set(result.detail.hits.map((hit) => hit.ruleId))].join(', '),
    );
  }
  if (row.alert) {
    const top = topPart(result.detail.parts);
    return top ? `${top.name} · s = ${fmt.score(top.score)}` : 'statistics';
  }
  return h('span', { class: 'muted' }, '-');
}

/** Everything about one request: as logged, as the detector read it, and why. @param {LogRow} row */
function detailView(row) {
  const { entry, request, result } = row;
  /** @type {[string, string, boolean?][]} term, value, shown as typed */
  const facts = [
    ['Line', String(entry.line)],
    ['Time', entry.time ?? '-', true],
    ['HTTP status', entry.status === null ? '-' : String(entry.status)],
    ['Request as logged', `${entry.method} ${entry.target}`, true],
    ...(request.host
      ? [/** @type {[string, string, boolean]} */ (['Host', request.host, true])]
      : []),
    ...Object.entries(request.params).map(
      ([name, value]) =>
        /** @type {[string, string, boolean]} */ ([
          name.startsWith(PATH_PARAM) ? 'Path, decoded' : `Parameter ${name}`,
          value,
          true,
        ]),
    ),
    ['Detector score', fmt.score(result.score)],
    ['Statistical score', `${fmt.score(result.statScore)} (−log₁₀ p)`],
    ...Object.entries(result.detail.parts).map(
      ([name, score]) => /** @type {[string, string]} */ ([`Signal ${name}`, fmt.score(score)]),
    ),
    ['Alert level', `${row.level} · ${severityOf(row.level)} severity`],
    ['Why', result.reasons.length ? result.reasons.join('; ') : 'nothing reached the threshold'],
  ];
  const logged = Object.entries(entry.fields);
  const json = JSON.stringify(
    {
      line: entry.line,
      logged: entry.fields,
      request,
      verdict: result.verdict,
      score: result.score,
      statScore: result.statScore,
      parts: result.detail.parts,
      hits: result.detail.hits,
      explanation: result.detail.explanation,
      reasons: result.reasons,
      level: row.level,
    },
    (_key, value) => (value === Infinity ? 'Infinity' : value),
    2,
  );
  /** @param {string} title @param {[string, string, boolean?][]} pairs */
  const list = (title, pairs) =>
    h(
      'div',
      {},
      h('h3', { class: 'detail-title' }, title),
      h(
        'dl',
        { class: 'kv' },
        pairs.map(([term, value, raw]) => [
          h('dt', {}, term),
          h('dd', { class: raw ? 'mono' : null, 'data-raw': raw ? true : null }, value),
        ]),
      ),
    );
  return h(
    'div',
    { class: 'detail-grid' },
    list('Summary', facts),
    h(
      'div',
      {},
      list(
        'Every field of the line',
        logged.map(
          ([name, value]) => /** @type {[string, string, boolean]} */ ([name, value, true]),
        ),
      ),
      h('h3', { class: 'detail-title' }, 'JSON'),
      h('pre', { class: 'json', 'data-raw': true }, json),
    ),
  );
}
