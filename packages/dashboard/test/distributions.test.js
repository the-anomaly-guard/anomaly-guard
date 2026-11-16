import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LENGTH_EDGES,
  SCORE_EDGES,
  binLabels,
  binOf,
  histogram,
  longestValue,
  pointsOf,
  thresholdPosition,
} from '../src/distributions.js';
import { runExperiment } from '../src/pipeline.js';
import { DEFAULTS } from '../src/state.js';

test('binOf: the lower edge belongs to its bin, and the last bin is open', () => {
  assert.equal(binOf(LENGTH_EDGES, 0), 0);
  assert.equal(binOf(LENGTH_EDGES, 4), 0);
  assert.equal(binOf(LENGTH_EDGES, 5), 1);
  assert.equal(binOf(LENGTH_EDGES, 199), 5);
  assert.equal(binOf(LENGTH_EDGES, 200), 6);
  assert.equal(binOf(LENGTH_EDGES, 50000), 6);
  assert.equal(binOf(SCORE_EDGES, 9.99), 9);
  assert.equal(binOf(SCORE_EDGES, 1e9), 10);
});

test('binLabels: ranges, single values for a step of 1, and an open last bin', () => {
  assert.deepEqual(binLabels(LENGTH_EDGES), [
    '0-4',
    '5-9',
    '10-19',
    '20-49',
    '50-99',
    '100-199',
    '200+',
  ]);
  assert.deepEqual(binLabels(SCORE_EDGES).slice(0, 2), ['0', '1']);
  assert.equal(binLabels(SCORE_EDGES).at(-1), '10+');
});

test('longestValue: the longest parameter value, 0 without parameters', () => {
  assert.equal(longestValue({ params: { a: 'xy', b: 'abcde' } }), 5);
  assert.equal(longestValue({ params: {} }), 0);
});

test('histogram: each class adds up to 1 and the counts are the known ones', () => {
  const points = [
    { attack: false, length: 3, score: 0.5 },
    { attack: false, length: 7, score: 0.9 },
    { attack: false, length: 8, score: 2.5 },
    { attack: false, length: 300, score: 12 },
    { attack: true, length: 300, score: 15 },
    { attack: true, length: 250, score: 4 },
  ];
  const len = histogram(points, 'length', LENGTH_EDGES);
  assert.deepEqual(len.legitCount, [1, 2, 0, 0, 0, 0, 1]);
  assert.deepEqual(len.attackCount, [0, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(len.attack.at(-1), 1);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum(len.legit) - 1) < 1e-12);
  const score = histogram(points, 'score', SCORE_EDGES);
  assert.deepEqual(score.legitCount.slice(0, 3), [2, 0, 1]);
  assert.equal(score.legitCount.at(-1), 1);
  assert.equal(score.attackCount.at(-1), 1);
  assert.equal(score.attackCount[4], 1);
});

test('histogram: a class with no request gives zeros, not NaN', () => {
  const h = histogram([{ attack: false, length: 1, score: 0 }], 'score', SCORE_EDGES);
  assert.ok(h.attack.every((v) => v === 0));
});

test('thresholdPosition: where the line is drawn between the centres of the bins', () => {
  assert.equal(thresholdPosition(SCORE_EDGES, 0), -0.5); // the left side of the first bin
  assert.equal(thresholdPosition(SCORE_EDGES, 1), 0.5); // between bin 0 and bin 1
  assert.equal(thresholdPosition(SCORE_EDGES, 2.5), 2); // the middle of bin 2
  assert.equal(thresholdPosition(SCORE_EDGES, 50), 9.5); // clamped at the open bin's left side
});

test('pointsOf: one point per test request, the labels of the simulator, scores >= 0', () => {
  const run = runExperiment({ ...DEFAULTS, size: 200 });
  const points = pointsOf(run);
  assert.equal(points.length, run.dataset.test.length);
  assert.ok(points.every((p) => p.score >= 0 && Number.isFinite(p.score) && p.length >= 0));
  assert.equal(
    points.filter((p) => p.attack).length,
    run.dataset.test.filter((s) => s.label === 'attack').length,
  );
  // the chart's point of the paper: attack values are longer and rarer than legitimate ones
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const attacks = points.filter((p) => p.attack);
  const legit = points.filter((p) => !p.attack);
  assert.ok(mean(attacks.map((p) => p.score)) > mean(legit.map((p) => p.score)));
});
