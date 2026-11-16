import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trainStatModel,
  iqrScore,
  madScore,
  mahalanobisScore,
  iqrDeviation,
  madDeviation,
  fenceDistance,
  deviationScore,
  mahalanobisD2,
  mahalanobisTailScore,
  MIN_OUTLIER_N,
} from '../src/index.js';

const get = (path, params) => ({ method: 'GET', path, params });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// 30 normal values of /s?q: lengths 8..12, all letters (entropy grows with the length).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const training = Array.from({ length: 30 }, (_, i) =>
  get('/s', { q: LETTERS.slice(0, 8 + (i % 5)) }),
);
const model = trainStatModel(training);
const normal = get('/s', { q: LETTERS.slice(0, 10) });
const SIGNALS = { iqr: iqrScore, mad: madScore, mahalanobis: mahalanobisScore };

test('madDeviation: known answer, median 3, MAD 1, x = 10 -> z = 0.6745 * 7', () => {
  near(madDeviation(10, 3, 1), 0.6745 * 7);
  near(deviationScore(madDeviation(10, 3, 1)), Math.log10((0.6745 * 7) ** 2));
  assert.equal(madDeviation(3, 3, 1), 0);
});

test('iqrDeviation: known answer, median 3, IQR 4, x = 10 -> z = 7 * 1.349 / 4', () => {
  near(iqrDeviation(10, 3, 4), (7 * 1.349) / 4);
  near(iqrDeviation(-4, 3, 4), (7 * 1.349) / 4); // two-sided
});

test('a zero spread uses the floor instead of an infinite z', () => {
  assert.equal(madDeviation(5, 3, 0, 0.5), 4); // |5 - 3| / 0.5
  assert.equal(iqrDeviation(5, 3, 0, 0.5), 4);
  assert.ok(Number.isFinite(madDeviation(5, 3, 0, 0.1)));
});

test('fenceDistance: Tukey fences at Q1 - 1.5 IQR and Q3 + 1.5 IQR, in IQR units', () => {
  // Q1 = 2, Q3 = 4, IQR = 2: fences at -1 and 7
  assert.equal(fenceDistance(5, 2, 4), 0); // inside
  assert.equal(fenceDistance(7, 2, 4), 0); // on the fence
  assert.equal(fenceDistance(10, 2, 4), 1.5); // 3 beyond the upper fence = 1.5 IQR
  assert.equal(fenceDistance(-6, 2, 4), 2.5); // 5 beyond the lower fence
  assert.equal(fenceDistance(100, 3, 3), 0); // zero IQR: no fence
});

test('deviationScore: Chebyshev, z = 10 -> p <= 1/100 -> score 2; no deviation -> 0', () => {
  near(deviationScore(10), 2, 1e-12);
  assert.equal(deviationScore(0), 0);
  assert.equal(deviationScore(1), 0); // p = 1: nothing unusual
});

test('mahalanobisD2: identity precision is the squared Euclidean distance', () => {
  const identity = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  assert.equal(mahalanobisD2([1, 2, 0], [0, 0, 0], identity), 5);
  assert.equal(mahalanobisD2([0, 0, 0], [0, 0, 0], identity), 0);
  assert.equal(
    mahalanobisD2(
      [1, 2],
      [0, 0],
      [
        [2, 0],
        [0, 0.5],
      ],
    ),
    4, // 2 * 1 + 0.5 * 4
  );
});

test('mahalanobisTailScore: chi-square known answers, p = 0.05 -> score log10(20)', () => {
  near(mahalanobisTailScore(5.991464547107979, 2), Math.log10(20), 1e-9); // P(chi2(2) > 5.9915) = 0.05
  near(mahalanobisTailScore(3.841458820694124, 1), Math.log10(20), 1e-9); // df = 1
  near(mahalanobisTailScore(7.814727903251179, 3), Math.log10(20), 1e-9); // df = 3
  assert.equal(mahalanobisTailScore(0, 3), 0);
  assert.ok(Number.isFinite(mahalanobisTailScore(1e6, 3))); // log space: no underflow
});

test('Mahalanobis sees a combination that no single feature shows (correlation)', () => {
  // two strongly correlated features (correlation 0.9, variance 1): (1, -1) is ordinary on each
  // axis alone (z = 1) but against the correlation
  const det = 1 - 0.81;
  const precision = [
    [1 / det, -0.9 / det, 0],
    [-0.9 / det, 1 / det, 0],
    [0, 0, 1],
  ];
  const d2 = mahalanobisD2([1, -1, 0], [0, 0, 0], precision);
  near(d2, (1 + 1 + 1.8) / det, 1e-9); // about 20
  assert.ok(mahalanobisTailScore(d2, 3) > 3);
  assert.equal(deviationScore(1), 0); // each feature alone: z = 1 -> nothing
});

test('a normal value scores low on every signal', () => {
  for (const [name, fn] of Object.entries(SIGNALS)) {
    assert.ok(fn(model, normal).score < 1, `${name}: ${fn(model, normal).score}`);
  }
});

test('a very long value scores high on every signal and names the parameter', () => {
  const long = get('/s', { q: 'a'.repeat(500) });
  for (const [name, fn] of Object.entries(SIGNALS)) {
    const r = fn(model, long);
    // Chebyshev is conservative: a z of 20-30 gives a score of 2.5-3, not more
    assert.ok(r.score > 2.5, `${name}: ${r.score}`);
    assert.equal(r.param, 'q');
  }
  assert.equal(iqrScore(model, long).feature, 'logLength');
  assert.equal(iqrScore(model, long).beyondFence, true);
});

test('a normal length with a wrong entropy is caught (the length signal alone would miss it)', () => {
  const flat = get('/s', { q: 'a'.repeat(10) }); // length 10, entropy 0 instead of about 3.3
  assert.equal(madScore(model, flat).feature, 'entropy');
  assert.ok(madScore(model, flat).score > 2);
  assert.ok(iqrScore(model, flat).score > 2);
  assert.ok(mahalanobisScore(model, flat).score > 2);
});

test('special characters at a normal length are caught', () => {
  const sql = get('/s', { q: "ab'; --cde" }); // length 10, 4 special characters out of 10
  assert.equal(madScore(model, sql).feature, 'special');
  for (const fn of Object.values(SIGNALS)) assert.ok(fn(model, sql).score > 2);
});

test('monotonic: a longer value never scores lower beyond the training range', () => {
  for (const [name, fn] of Object.entries(SIGNALS)) {
    let previous = -1;
    for (const len of [50, 100, 200, 400, 800, 1600]) {
      const s = fn(model, get('/s', { q: 'a'.repeat(len) })).score;
      assert.ok(s >= previous, `${name}, length ${len}`);
      previous = s;
    }
  }
});

test("an unseen (path, parameter) pair scores 0 (the policy is the length signal's, C-04)", () => {
  const other = get('/other', { q: 'a'.repeat(500) });
  for (const fn of Object.values(SIGNALS)) assert.equal(fn(model, other).score, 0);
  assert.equal(iqrScore(model, other).param, null);
});

test('a pair with fewer than MIN_OUTLIER_N training values scores 0', () => {
  const few = trainStatModel(
    Array.from({ length: MIN_OUTLIER_N - 1 }, (_, i) => get('/f', { q: LETTERS.slice(0, 5 + i) })),
  );
  for (const fn of Object.values(SIGNALS))
    assert.equal(fn(few, get('/f', { q: 'a'.repeat(500) })).score, 0);
  const enough = trainStatModel(
    Array.from({ length: MIN_OUTLIER_N }, (_, i) => get('/f', { q: LETTERS.slice(0, 5 + i) })),
  );
  for (const fn of Object.values(SIGNALS))
    assert.ok(fn(enough, get('/f', { q: 'a'.repeat(500) })).score > 0);
});

test('constant training values: finite scores, no division by zero', () => {
  const constant = trainStatModel(Array.from({ length: 12 }, () => get('/c', { id: 'abcde' })));
  for (const fn of Object.values(SIGNALS)) {
    assert.ok(fn(constant, get('/c', { id: 'abcde' })).score < 1e-9); // 0 up to rounding
    const odd = fn(constant, get('/c', { id: 'x'.repeat(50) }));
    assert.ok(Number.isFinite(odd.score) && odd.score > 2, String(odd.score));
  }
});

test('one huge value slipped into the training data does not blind the robust signals', () => {
  const polluted = trainStatModel([
    ...training,
    get('/s', { q: 'a'.repeat(5000) }), // one huge value slipped into "normal" traffic
  ]);
  const long = get('/s', { q: 'a'.repeat(500) });
  assert.ok(madScore(polluted, long).score > 2.5);
  assert.ok(iqrScore(polluted, long).score > 2.5);
});

test('the worst parameter of the request decides', () => {
  const two = trainStatModel(
    Array.from({ length: 20 }, (_, i) =>
      get('/t', { a: LETTERS.slice(0, 6 + (i % 3)), b: LETTERS.slice(0, 6 + (i % 3)) }),
    ),
  );
  const r = madScore(two, get('/t', { a: LETTERS.slice(0, 7), b: 'z'.repeat(300) }));
  assert.equal(r.param, 'b');
});

test('labels in the request are never read', () => {
  const long = get('/s', { q: 'a'.repeat(500) });
  for (const fn of Object.values(SIGNALS)) {
    assert.deepEqual(fn(model, { ...long, label: 'attack', kind: 'sqli' }), fn(model, long));
  }
});
