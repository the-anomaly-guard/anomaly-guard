import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median,
  quantile,
  mad,
  covariance,
  invertSymmetric,
  regularise,
  fitOutlierStats,
  outlierVector,
  paramFeatures,
  OUTLIER_FEATURES,
  FEATURE_FLOORS,
  RIDGE,
} from '../src/index.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('median, quantile and MAD: known answers for 1, 2, 3, 4, 100', () => {
  const xs = [100, 1, 3, 2, 4]; // unsorted on purpose, and the input must not be reordered
  assert.equal(median(xs), 3);
  assert.equal(quantile(xs, 0.25), 2);
  assert.equal(quantile(xs, 0.75), 4);
  assert.equal(mad(xs), 1); // |x - 3| = 2, 1, 0, 1, 97 -> median 1
  assert.deepEqual(xs, [100, 1, 3, 2, 4]);
});

test('quantile: linear interpolation between order statistics (type 7)', () => {
  near(quantile([1, 2, 3, 4], 0.25), 1.75); // position 0.75
  near(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([], 0.5), 0);
  assert.equal(quantile([1, 2, 3], 0), 1);
  assert.equal(quantile([1, 2, 3], 1), 3);
});

test('the median and the MAD are not moved by one huge value, unlike the mean and the std', () => {
  const clean = [10, 11, 12, 13, 14, 15, 16];
  const dirty = [...clean, 10000];
  assert.ok(Math.abs(median(dirty) - median(clean)) <= 1);
  assert.ok(Math.abs(mad(dirty) - mad(clean)) <= 1);
});

test('covariance: known answer and symmetry', () => {
  const c = covariance([
    [1, 2],
    [2, 4],
    [3, 6],
  ]);
  assert.deepEqual(c, [
    [1, 2],
    [2, 4],
  ]);
  assert.deepEqual(covariance([[1, 2]]), [
    [0, 0],
    [0, 0],
  ]); // one value: no spread
  assert.deepEqual(covariance([]), []);
});

test('invertSymmetric: known inverses, and A times its inverse is the identity', () => {
  assert.deepEqual(
    invertSymmetric([
      [2, 0],
      [0, 4],
    ]),
    [
      [0.5, 0],
      [0, 0.25],
    ],
  );
  const inv = invertSymmetric([
    [2, 1],
    [1, 2],
  ]);
  near(inv[0][0], 2 / 3);
  near(inv[0][1], -1 / 3);
  const a = [
    [4, 1, 0.5],
    [1, 3, 0.2],
    [0.5, 0.2, 2],
  ];
  const p = invertSymmetric(a);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i][k] * p[k][j];
      near(s, i === j ? 1 : 0, 1e-9);
    }
  }
});

test('invertSymmetric: a singular matrix throws', () => {
  assert.throws(
    () =>
      invertSymmetric([
        [1, 2],
        [2, 4],
      ]),
    RangeError,
  );
});

test('regularise: floors every variance, adds the ridge, and makes a zero matrix invertible', () => {
  const zero = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const r = regularise(zero);
  for (let i = 0; i < 3; i++) near(r[i][i], FEATURE_FLOORS[i] ** 2 * (1 + RIDGE));
  assert.doesNotThrow(() => invertSymmetric(r));
  // a variance above its floor is only scaled by the ridge; off-diagonal terms are untouched
  const big = regularise([
    [4, 1],
    [1, 9],
  ]);
  near(big[0][0], 4 * (1 + RIDGE));
  near(big[1][1], 9 * (1 + RIDGE));
  assert.equal(big[0][1], 1);
});

test('even perfectly correlated training features give an invertible matrix (correlation 1)', () => {
  const rows = Array.from({ length: 20 }, (_, i) => [i / 10, 2 * (i / 10), 3 * (i / 10)]);
  const stats = fitOutlierStats(rows);
  assert.equal(stats.precision.length, 3);
  assert.ok(stats.precision.flat().every(Number.isFinite));
});

test('outlierVector: ln(1 + length), entropy and the share of special characters', () => {
  const v = outlierVector(paramFeatures('q', "ab'c"));
  assert.equal(v.length, OUTLIER_FEATURES.length);
  near(v[0], Math.log(5));
  near(v[1], 2); // four different characters -> 2 bits
  near(v[2], 0.25); // one special character out of four
  assert.deepEqual(outlierVector(paramFeatures('q', '')), [0, 0, 0]);
});

test('fitOutlierStats: a plain serialisable object of the right shape', () => {
  const rows = [1, 2, 3, 4, 100].map((x) => [x, 2 * x, 0]);
  const s = fitOutlierStats(rows);
  assert.deepEqual(s.median, [3, 6, 0]);
  assert.deepEqual(s.q1, [2, 4, 0]);
  assert.deepEqual(s.q3, [4, 8, 0]);
  assert.deepEqual(s.mad, [1, 2, 0]);
  assert.equal(s.cov.length, 3);
  assert.equal(s.precision.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), JSON.parse(JSON.stringify(s)));
  assert.deepEqual(Object.keys(s).sort(), [
    'cov',
    'features',
    'mad',
    'mean',
    'median',
    'precision',
    'q1',
    'q3',
  ]);
});

test('fitOutlierStats: an empty training set is still a valid, invertible model', () => {
  const s = fitOutlierStats([]);
  assert.ok(s.precision.flat().every(Number.isFinite));
  assert.deepEqual(s.median, [0, 0, 0]);
});
