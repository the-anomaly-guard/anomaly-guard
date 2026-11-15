// Detection quality (E-06, and the ROC of E-02 - theme T3): the operating point calibrated on
// legitimate requests, the confusion matrix and the error rates with 95% Wilson intervals, the
// results by variant, the ROC curves of the three modes with their AUC and its bootstrap interval,
// and McNemar's test between the modes. With the live replay (E-08, ADR-011) every
// figure is computed on the test requests that have arrived so far: the intervals narrow as n
// grows, and the last frame is the whole test split.

import { initShell, percent } from '../shell.js';
import { runExperiment, summarise } from '../pipeline.js';
import {
  ratesWithIntervals,
  byVariant,
  rocByMode,
  aucInterval,
  flagsByMode,
  compareFlags,
} from '../quality.js';
import { rocCurve } from '@anomaly-guard/evaluation';
import { h, mount, fmt } from '../dom.js';
import { kpi } from '../ui.js';
import { setupCharts, rocChart, setRocData, chartMessage, token } from '../charts.js';
import { initLive } from '../live.js';
import { chartModal } from '../chart-modal.js';

const MODE_NAMES = {
  rules: 'Rules only',
  stats: 'Statistics only',
  combined: 'Rules + statistics',
};
const MODE_COLORS = { rules: '--src-signature', stats: '--src-statistics', combined: '--src-both' };

const VARIANT_TEXT = {
  canonical: 'known signatures',
  obfuscated: 'disguised to dodge signatures',
  novel: 'no signature exists',
  typical: 'ordinary traffic',
  hard: 'unusual but legitimate',
};

const state = initShell();
const run = runExperiment(state);
const { operating } = run;
const labels = run.dataset.test.map((s) => s.label);

// Computed once on the whole test split; the replay only cuts them to the first n requests.
const curves = rocByMode(run); // null without both attacks and legitimate requests
const flags = curves === null ? null : flagsByMode(run, curves);

/**
 * "57.2%" and "95% CI 53.0-61.3%" for an interval; "-" and "not defined (0 of 0)" when the rate
 * has nothing to count yet (e.g. a TPR with no attack).
 */
const value = (interval) => (interval ? fmt.pct(interval.estimate) : '-');
const bounds = (interval) =>
  interval
    ? `95% CI ${(interval.lower * 100).toFixed(1)}-${(interval.upper * 100).toFixed(1)}%`
    : 'not defined (0 of 0)';

/** Rates near the target need two decimals: 0.95% is not 1%. */
const pct2 = (x) => `${(x * 100).toFixed(2)}%`;

/** @type {ReturnType<typeof rocChart> | null} */
let chart = null;
if (curves === null) {
  mount(
    '#roc-box',
    h('p', { class: 'empty-chart' }, 'A ROC curve needs both attacks and legitimate requests.'),
  );
  mount('#auc', h('p', { class: 'muted' }, 'Set an attack share between 0 and 1.'));
  mount('#paired', h('p', { class: 'muted' }, 'Needs both attacks and legitimate requests.'));
} else {
  setupCharts();
  chart = rocChart(/** @type {HTMLCanvasElement} */ (document.querySelector('#chart-roc')), {
    curves: [],
  });
}

// The ROC curve opened large (the title is the button): the same data, bigger text, and kept up
// to date while the replay runs.
/** @type {Parameters<typeof rocChart>[1]} */
let rocData = { curves: [] };
const expand = /** @type {HTMLButtonElement | null} */ (
  document.querySelector('[data-roc-expand]')
);
const rocModal =
  expand && chart
    ? chartModal({
        trigger: expand,
        title: 'ROC curve',
        draw: (canvas) => rocChart(canvas, rocData, { fontSize: 14 }),
      })
    : null;
if (expand && !chart) {
  expand.disabled = true;
  expand.title = 'A ROC curve needs both attacks and legitimate requests';
}

/** The AUC bootstrap intervals of the whole test split: computed once, when the run is done. */
const aucIntervals = curves === null ? [] : curves.map(() => null);
let bootstrapStarted = false;
let lastFrame = /** @type {import('../replay.js').Frame | null} */ (null);

initLive({ state, run, render });

/** @param {import('../replay.js').Frame} frame */
function render(frame) {
  lastFrame = frame;
  const view = run.events.slice(0, frame.at);
  const { cm, metrics: m } = summarise(view);
  drawOperatingPoint(frame);
  drawMatrix(frame, cm, m.f1, view.length);
  drawVariants(frame, view);
  if (curves === null || chart === null) return;

  const n = frame.at;
  const both = labels.slice(0, n).includes('attack') && labels.slice(0, n).includes('legit');
  if (!both) {
    chartMessage(
      chart,
      frame.stage === 'idle'
        ? 'No traffic yet.'
        : 'Waiting for both attacks and legitimate requests...',
    );
    mount('#auc', h('p', { class: 'muted' }, 'Needs both attacks and legitimate requests.'));
    mount('#paired', h('p', { class: 'muted' }, 'Needs both attacks and legitimate requests.'));
    return;
  }

  const now = curves.map((c) => ({ mode: c.mode, ...rocCurve(c.scored.slice(0, n)) }));
  chartMessage(chart, null);
  const color = (mode) => token(MODE_COLORS[mode]);
  rocData = {
    curves: now.map((c) => ({
      label: `${MODE_NAMES[c.mode]} (AUC ${c.auc.toFixed(3)})`,
      color: color(c.mode),
      points: c.points,
    })),
    marks: [
      {
        label: `Operating point (${MODE_NAMES[state.mode]})`,
        color: color(state.mode),
        fpr: m.fpr,
        tpr: m.recall,
      },
    ],
  };
  setRocData(chart, rocData);
  const large = rocModal?.chart();
  if (large) setRocData(large, rocData);
  drawAuc(frame, now);
  drawPaired(n);
}

// ---- operating point -------------------------------------------------------------------------

/** @param {import('../replay.js').Frame} frame */
function drawOperatingPoint(frame) {
  const target = operating.target === null ? 'manual' : percent(operating.target);
  if (!frame.calibrated) {
    // Before step 2 of the replay the threshold is not set yet: only the target is known.
    mount(
      '#operating',
      kpi('Target false-positive rate', target, 'primary'),
      kpi('Threshold (−log₁₀ p)', '-', 'neutral', 'set in step 2, on the calibration split'),
      kpi('Flagged on the calibration split', '-', 'warning'),
      kpi('Target met on the calibration split', '-'),
    );
    mount('#operating-note');
    return;
  }
  mount(
    '#operating',
    kpi('Target false-positive rate', target, 'primary'),
    kpi(
      'Threshold (−log₁₀ p)',
      operating.source === 'rules' ? '-' : fmt.score(operating.threshold),
      'neutral',
      {
        calibrated: 'set on the calibration split',
        manual: 'set by hand',
        rules: 'rules only: a rule match',
      }[operating.source],
    ),
    kpi(
      'Flagged on the calibration split',
      pct2(operating.calibrationFpr),
      'warning',
      `of ${fmt.int(operating.calibrationSize)} legitimate requests`,
    ),
    kpi(
      'Target met on the calibration split',
      operating.attainable === null ? '-' : operating.attainable ? 'yes' : 'no',
      { true: 'success', false: 'danger' }[String(operating.attainable)] ?? 'neutral',
    ),
  );

  const calibrationText = `${pct2(operating.calibrationFpr)} of ${fmt.int(operating.calibrationSize)}`;
  const notes = [];
  if (operating.attainable === false) {
    notes.push(
      h(
        'div',
        { class: 'callout is-warning' },
        operating.source === 'rules'
          ? `The rules alone flag ${pct2(operating.calibrationFpr)} of the legitimate calibration ` +
              `requests, more than the ${percent(/** @type {number} */ (operating.target))} ` +
              'target allows, and rules mode has no threshold to move.'
          : `The target cannot be met: the rules alone flag ${pct2(operating.calibrationFpr)} of ` +
              `the legitimate calibration requests, more than ` +
              `${percent(/** @type {number} */ (operating.target))} allows. A rule match scores ` +
              '+∞ and is flagged at any threshold, so the threshold sits above every legitimate ' +
              'statistical score instead: the statistics add no false alarm of their own on the ' +
              'calibration split, and catch fewer attacks.',
      ),
    );
  } else if (operating.source === 'manual') {
    notes.push(
      h(
        'div',
        { class: 'callout is-warning' },
        `A threshold set by hand: it flags ${calibrationText} legitimate calibration requests. ` +
          'Choose a calibrated false-positive target in the settings bar to set it on legitimate ' +
          'traffic instead (ADR-009).',
      ),
    );
  }
  mount('#operating-note', notes);
}

// ---- confusion matrix and rates ------------------------------------------------------------

/**
 * @param {import('../replay.js').Frame} frame
 * @param {{ tp: number, fp: number, tn: number, fn: number }} cm
 * @param {number} f1        from the metrics of the same requests
 * @param {number} arrived   test requests arrived so far
 */
function drawMatrix(frame, cm, f1, arrived) {
  const rates = ratesWithIntervals(cm);
  const attacks = cm.tp + cm.fn;
  const legit = cm.fp + cm.tn;
  const rateCell = (name, interval) =>
    h(
      'td',
      { class: 'num' },
      `${name} ${value(interval)}`,
      h('br'),
      h('span', { class: 'muted' }, bounds(interval)),
    );
  mount(
    '#matrix',
    h(
      'table',
      { class: 'data' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Actual'),
          h('th', { scope: 'col', class: 'num' }, 'Alert'),
          h('th', { scope: 'col', class: 'num' }, 'No alert'),
          h('th', { scope: 'col', class: 'num' }, 'Rate'),
        ),
      ),
      h(
        'tbody',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, `Attack (${fmt.int(attacks)})`),
          h('td', { class: 'num' }, `${fmt.int(cm.tp)} caught`),
          h('td', { class: 'num is-bad' }, `${fmt.int(cm.fn)} missed`),
          rateCell('TPR', rates.tpr),
        ),
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, `Legitimate (${fmt.int(legit)})`),
          h('td', { class: 'num is-bad' }, fmt.count(cm.fp, 'false alarm')),
          h('td', { class: 'num' }, `${fmt.int(cm.tn)} passed`),
          rateCell('FPR', rates.fpr),
        ),
      ),
    ),
  );

  const alarms = cm.tp + cm.fp;
  const precision = `precision ${value(rates.precision)}`;
  let note =
    alarms === 1
      ? `The one alert ${cm.tp === 1 ? 'is an attack' : 'is a false alarm'}: ${precision}.`
      : `Of the ${fmt.int(alarms)} alerts, ${fmt.int(cm.tp)} ${cm.tp === 1 ? 'is an attack' : 'are attacks'}: ${precision}.`;
  if (arrived === 0) {
    note = frame.stage === 'idle' ? 'No traffic yet.' : 'Waiting for the first request...';
  } else if (alarms === 0) note = 'No alert at this threshold.';
  const sofar =
    frame.stage === 'done' || arrived === frame.total
      ? ''
      : ` So far ${fmt.int(arrived)} of ${fmt.int(frame.total)} test requests: the intervals narrow as more arrive.`;
  mount(
    '#matrix-note',
    'Rows are the truth, from the simulator; columns are the detector. TPR = caught / attacks, ' +
      `FPR = false alarms / legitimate requests. ${note}${sofar}`,
  );

  mount(
    '#rates',
    kpi('Recall (true-positive rate)', value(rates.tpr), 'primary', bounds(rates.tpr)),
    kpi('False-positive rate', value(rates.fpr), 'warning', bounds(rates.fpr)),
    kpi('False-negative rate', value(rates.fnr), 'danger', bounds(rates.fnr)),
    kpi(
      'Precision (alerts that are attacks)',
      value(rates.precision),
      'neutral',
      bounds(rates.precision),
    ),
    kpi('F1', arrived === 0 ? '-' : f1.toFixed(3)),
  );
}

// ---- by variant -------------------------------------------------------------------------------

/**
 * @param {import('../replay.js').Frame} frame
 * @param {import('../pipeline.js').DashboardEvent[]} view
 */
function drawVariants(frame, view) {
  const rows = byVariant(view);
  let empty = 'No test requests.';
  if (frame.stage === 'idle') empty = 'No traffic yet.';
  else if (view.length === 0) empty = 'Waiting for the first request...';
  mount(
    '#variants',
    h(
      'table',
      { class: 'data' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Variant'),
          h('th', { scope: 'col', class: 'num' }, 'Requests'),
          h('th', { scope: 'col', class: 'num' }, 'Alerts'),
          h('th', { scope: 'col', class: 'num' }, 'Share'),
        ),
      ),
      h(
        'tbody',
        {},
        rows.length === 0
          ? h('tr', {}, h('td', { class: 'empty', colspan: '4' }, empty))
          : rows.map((row) =>
              h(
                'tr',
                {},
                h(
                  'td',
                  {},
                  `${row.label === 'attack' ? 'Attack' : 'Legitimate'} · ${row.variant}`,
                  h('br'),
                  h('span', { class: 'muted' }, VARIANT_TEXT[row.variant] ?? ''),
                ),
                h('td', { class: 'num' }, fmt.int(row.requests)),
                h('td', { class: 'num' }, fmt.int(row.flagged)),
                h(
                  'td',
                  { class: 'num' },
                  value(row.rate),
                  h('br'),
                  h('span', { class: 'muted' }, bounds(row.rate)),
                ),
              ),
            ),
      ),
    ),
  );
}

// ---- AUC --------------------------------------------------------------------------------------

/**
 * The AUC of each mode on the requests so far. Its bootstrap interval resamples the whole test
 * split 200 times: it takes a moment in the browser, so it is computed once, when the run is done,
 * each curve in its own task so the page stays responsive.
 * @param {import('../replay.js').Frame} frame
 * @param {{ mode: string, auc: number }[]} now
 */
function drawAuc(frame, now) {
  const done = frame.stage === 'done';
  if (done && !bootstrapStarted && curves !== null) {
    bootstrapStarted = true;
    curves.forEach((c, i) => {
      setTimeout(() => {
        aucIntervals[i] = aucInterval(c.scored, state.seed);
        if (lastFrame?.stage === 'done') drawAuc(lastFrame, curves);
      }, 0);
    });
  }
  mount(
    '#auc',
    h(
      'table',
      { class: 'data' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Detector'),
          h('th', { scope: 'col', class: 'num' }, 'AUC'),
          h('th', { scope: 'col', class: 'num' }, '95% interval'),
        ),
      ),
      h(
        'tbody',
        {},
        now.map((c, i) => {
          const ci = aucIntervals[i];
          let cell = h('td', { class: 'num muted' }, 'when the run is done');
          if (done && ci)
            cell = h('td', { class: 'num' }, `${ci.lower.toFixed(3)}-${ci.upper.toFixed(3)}`);
          else if (done) cell = h('td', { class: 'num muted' }, 'computing...');
          return h(
            'tr',
            {},
            h('td', {}, MODE_NAMES[c.mode]),
            h('td', { class: 'num' }, c.auc.toFixed(3)),
            cell,
          );
        }),
      ),
    ),
  );
}

// ---- paired comparison (McNemar, D-07) -------------------------------------------------------

/** @param {number} n  test requests arrived so far */
function drawPaired(n) {
  if (flags === null) return;
  const cut = Object.fromEntries(Object.entries(flags).map(([mode, f]) => [mode, f.slice(0, n)]));
  /** p-value for the table: bold when below 0.05. */
  const pCell = (test) =>
    h(
      'td',
      { class: 'num' },
      test.exactP < 0.05
        ? h('strong', {}, test.exactP < 0.001 ? '< 0.001' : test.exactP.toFixed(3))
        : test.exactP.toFixed(3),
    );
  const head = (...names) => names.map((name) => h('th', { scope: 'col', class: 'num' }, name));
  mount(
    '#paired',
    h(
      'table',
      { class: 'data' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'A vs B'),
          head('Attacks caught only by A', 'only by B', 'p'),
          head('False alarms only by A', 'only by B', 'p'),
        ),
      ),
      h(
        'tbody',
        {},
        compareFlags(cut, labels.slice(0, n)).map(({ modes: [a, b], attack, legit }) =>
          h(
            'tr',
            {},
            h('td', {}, `${MODE_NAMES[a]} vs ${MODE_NAMES[b]}`),
            h('td', { class: 'num' }, fmt.int(attack.onlyA)),
            h('td', { class: 'num' }, fmt.int(attack.onlyB)),
            pCell(attack),
            h('td', { class: 'num' }, fmt.int(legit.onlyA)),
            h('td', { class: 'num' }, fmt.int(legit.onlyB)),
            pCell(legit),
          ),
        ),
      ),
    ),
  );
}
