// Statistical models: what "normal" looks like per (path, parameter) pair, learned from the
// legitimate training split only (ADR-004, ADR-007), and which signals make up the score. With the
// live replay (E-08, ADR-011) the table fills up during step 1, as the model learns
// from more and more legitimate requests, and then stays as it is: the test traffic never changes
// the model.

import {
  CHAR_CLASSES,
  chiSquareScore,
  iqrScore,
  madScore,
  mahalanobisScore,
  scoreRequest,
  trainStatModel,
} from '@anomaly-guard/core';
import { initShell } from '../shell.js';
import { runExperiment } from '../pipeline.js';
import { h, mount, fmt } from '../dom.js';
import { kpi } from '../ui.js';
import { initLive } from '../live.js';

/**
 * The planned signals. `part` is the key a signal adds to `scoreRequest().parts` (C-06): a signal
 * shows as "in the score" as soon as that key appears. `probe` calls the signal's own function: if
 * it answers, the signal is implemented even when it is not in the score.
 */
const SIGNALS = [
  {
    part: 'length',
    name: 'Length',
    method: 'Chebyshev bound on ln(1 + length): p ≤ 1/z²',
    task: 'C-04 · T2',
  },
  {
    part: 'chiSquare',
    name: 'Character distribution',
    method: 'Chi-square, Laplace-smoothed, df = 6',
    task: 'C-03 · T1',
    probe: chiSquareScore,
  },
  {
    part: 'iqr',
    name: 'Outliers: IQR',
    method: 'Robust z from the IQR / 1.349, Chebyshev tail',
    task: 'C-05 · T2',
    probe: iqrScore,
  },
  {
    part: 'mad',
    name: 'Outliers: MAD',
    method: 'Robust z from the MAD / 0.6745, Chebyshev tail',
    task: 'C-05 · T2',
    probe: madScore,
  },
  {
    part: 'mahalanobis',
    name: 'Outliers: Mahalanobis',
    method: 'Regularised Mahalanobis distance, chi-square tail, df = 3',
    task: 'C-05 · T2',
    probe: mahalanobisScore,
  },
];

const state = initShell();
const run = runExperiment(state);
const { model, dataset } = run;
const sample = dataset.train[0].request;
const inScore = new Set(Object.keys(scoreRequest(model, sample).parts));
const status = new Map(SIGNALS.map((signal) => [signal, statusOf(signal)]));
const active = SIGNALS.filter((signal) => status.get(signal) === 'score');
const columns = 4 + CHAR_CLASSES.length;

mount(
  '#signals-body',
  SIGNALS.map((signal) =>
    h(
      'tr',
      {},
      h('td', {}, signal.name),
      h('td', {}, signal.method),
      h('td', {}, badge(status.get(signal) ?? 'todo')),
      h('td', { class: 'mono nowrap' }, signal.task),
    ),
  ),
);

mount(
  '#classes-head',
  h('th', { scope: 'col' }, 'Endpoint · parameter'),
  h('th', { scope: 'col', class: 'num' }, 'Values'),
  h('th', { scope: 'col', class: 'num' }, 'Mean length'),
  h('th', { scope: 'col', class: 'num' }, 'SD'),
  CHAR_CLASSES.map((cls) => h('th', { scope: 'col', class: 'num' }, cls)),
);

let drawn = ''; // what the table was last drawn for: requests learned and stage

initLive({ state, run, render });

/** @param {import('../replay.js').Frame} frame */
function render(frame) {
  const size = dataset.train.length;
  const learned = Math.round(frame.trained * size);
  let phase = 'running';
  if (frame.stage === 'idle' || frame.stage === 'done') phase = frame.stage;
  const key = `${learned}:${phase}`;
  if (key === drawn) return;
  drawn = key;

  // The model of the first `learned` training requests: the one the detector uses once all of
  // them are in. Training is deterministic, so the last step is exactly `model`.
  let current = null;
  if (learned >= size) current = model;
  else if (learned > 0)
    current = trainStatModel(dataset.train.slice(0, learned).map((s) => s.request));
  const pairs = current
    ? Object.entries(current.params).sort(([a], [b]) => a.localeCompare(b))
    : [];

  mount(
    '#kpis',
    kpi('Legitimate requests learned', learned),
    kpi('Endpoint · parameter pairs', pairs.length),
    kpi('Signals in the score', active.length, 'primary'),
    kpi('Signals not in the score yet', SIGNALS.length - active.length, 'warning'),
  );

  let meta = 'length statistics and character-class shares';
  if (frame.stage === 'idle') meta = 'not trained yet';
  else if (learned < size)
    meta = `learning: ${fmt.int(learned)} of ${fmt.int(size)} legitimate requests`;
  else if (frame.stage !== 'done') meta = 'trained · the test requests never change it';
  mount('#pairs-meta', meta);

  if (pairs.length === 0) {
    mount(
      '#pairs-body',
      h(
        'tr',
        {},
        h(
          'td',
          { colspan: columns, class: 'empty' },
          frame.stage === 'idle'
            ? `Not trained yet. Press Start monitoring: the model first learns from ${fmt.int(size)} legitimate requests.`
            : 'Learning...',
        ),
      ),
    );
    return;
  }
  mount(
    '#pairs-body',
    pairs.map(([key, stats]) => {
      const total = CHAR_CLASSES.reduce((sum, cls) => sum + stats.classCounts[cls], 0);
      return h(
        'tr',
        {},
        h('td', { class: 'mono nowrap' }, key),
        h('td', { class: 'num' }, fmt.int(stats.n)),
        h('td', { class: 'num' }, stats.length.mean.toFixed(1)),
        h('td', { class: 'num' }, stats.length.std.toFixed(2)),
        CHAR_CLASSES.map((cls) => {
          const count = stats.classCounts[cls];
          return h(
            'td',
            { class: count ? 'num' : 'num muted' },
            count ? fmt.pct(count / total) : '·',
          );
        }),
      );
    }),
  );
}

/**
 * 'score': it counts in the detector's score; 'ready': implemented, waiting for C-06 to add it;
 * 'todo': not implemented yet (a stub that throws, or no function).
 * @param {(typeof SIGNALS)[number]} signal
 * @returns {'score' | 'ready' | 'todo'}
 */
function statusOf(signal) {
  if (signal.part !== null && inScore.has(signal.part)) return 'score';
  if (!signal.probe) return 'todo';
  try {
    const { score } = signal.probe(model, sample);
    return typeof score === 'number' && !Number.isNaN(score) ? 'ready' : 'todo';
  } catch {
    return 'todo'; // still a stub
  }
}

/**
 * A new badge for a status (a DOM node can only be in one place, so never share one).
 * @param {'score' | 'ready' | 'todo'} state
 */
function badge(state) {
  if (state === 'score') return h('span', { class: 'badge is-clean' }, 'In the score');
  if (state === 'ready') {
    return h('span', { class: 'badge is-pending' }, 'Implemented, not in the score yet (C-06)');
  }
  return h('span', { class: 'badge is-mistake' }, 'To implement');
}
