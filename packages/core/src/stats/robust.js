// Robust and multivariate building blocks for the outlier signals (C-05, methods.md §5): median,
// quantiles, MAD, covariance and a small symmetric-matrix inverse, plus the feature vector and the
// per-pair statistics that `trainStatModel` stores. No imports on purpose: `model.js` uses this
// file to train, `outliers.js` uses it to score, and neither depends on the other. Pure,
// runtime-agnostic.

/** Names of the features measured on every parameter value, in vector order. */
export const OUTLIER_FEATURES = Object.freeze(['logLength', 'entropy', 'special']);

/**
 * Smallest "one standard deviation" per feature, in the feature's own unit: 0.1 on ln(1 + length)
 * (about 10 % of the length, as in C-04), 0.1 bit of entropy and 2 % of special characters. A
 * pair whose training values are (almost) constant would otherwise make every difference infinite.
 */
export const FEATURE_FLOORS = Object.freeze([0.1, 0.1, 0.02]);

/** Fewer training values than this and the robust statistics mean nothing: the pair scores 0. */
export const MIN_OUTLIER_N = 5;

/** Ridge added to the covariance diagonal, as a share of each variance (methods.md §5). */
export const RIDGE = 0.1;

/**
 * Feature vector of one parameter value (see OUTLIER_FEATURES).
 * @param {{ length: number, entropy: number, classRatios: Record<string, number> }} p
 *   a record from `paramFeatures`
 * @returns {number[]} [ln(1 + length), entropy in bits, share of `special` characters]
 */
export function outlierVector(p) {
  return [Math.log1p(p.length), p.entropy, p.classRatios.special];
}

/**
 * Median (0 for an empty list).
 * @param {number[]} xs
 * @returns {number}
 */
export function median(xs) {
  return quantile(xs, 0.5);
}

/**
 * Quantile by linear interpolation between order statistics (the "type 7" rule of R and NumPy):
 * the position is (n − 1)·q. 0 for an empty list.
 * @param {number[]} xs
 * @param {number} q  in [0, 1]
 * @returns {number}
 */
export function quantile(xs, q) {
  const n = xs.length;
  if (n === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Median absolute deviation, raw (not scaled to σ): median(|x − median(x)|).
 * @param {number[]} xs
 * @returns {number}
 */
export function mad(xs) {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Sample covariance matrix (divisor n − 1; all zeros when n < 2).
 * @param {number[][]} rows  n vectors of the same length d
 * @returns {number[][]} d × d
 */
export function covariance(rows) {
  const n = rows.length;
  const d = n === 0 ? 0 : rows[0].length;
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  if (n < 2) return cov;
  const mean = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / n;
  for (const r of rows) {
    for (let i = 0; i < d; i++) {
      for (let j = i; j < d; j++) cov[i][j] += ((r[i] - mean[i]) * (r[j] - mean[j])) / (n - 1);
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
  return cov;
}

/**
 * Inverse of a small symmetric positive-definite matrix, by Gauss-Jordan elimination with partial
 * pivoting.
 * @param {number[][]} a  d × d
 * @returns {number[][]} the inverse
 * @throws {RangeError} if the matrix is (numerically) singular
 */
export function invertSymmetric(a) {
  const d = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < d; col++) {
    let pivot = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) throw new RangeError('matrix is singular');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    for (let j = 0; j < 2 * d; j++) m[col][j] /= p;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f !== 0) for (let j = 0; j < 2 * d; j++) m[r][j] -= f * m[col][j];
    }
  }
  // `+ 0` turns a -0 left by the elimination into 0, so the model survives a JSON round trip
  return m.map((row) => row.slice(d).map((v) => v + 0));
}

/**
 * Make a covariance matrix safe to invert (methods.md §5): first each variance is raised to at
 * least the feature's floor squared (adding a non-negative diagonal keeps the matrix positive
 * semi-definite), then a ridge of `RIDGE` times each variance is added, which makes it positive
 * definite even when the training values are few or perfectly correlated.
 * @param {number[][]} cov
 * @returns {number[][]}
 */
export function regularise(cov) {
  return cov.map((row, i) =>
    row.map((v, j) => {
      if (i !== j) return v;
      const floored = Math.max(v, FEATURE_FLOORS[i] ** 2);
      return floored * (1 + RIDGE);
    }),
  );
}

/**
 * Statistics of one (path, parameter) pair for the outlier signals, learned from legitimate
 * values only: robust location and spread per feature, and the mean vector, covariance and
 * regularised inverse covariance for the Mahalanobis distance. A plain serialisable object.
 * @typedef {Object} OutlierStats
 * @property {readonly string[]} features  OUTLIER_FEATURES, the order of every array below
 * @property {number[]} median
 * @property {number[]} q1  first quartile
 * @property {number[]} q3  third quartile
 * @property {number[]} mad  raw median absolute deviation
 * @property {number[]} mean
 * @property {number[][]} cov  sample covariance (as measured, before regularisation)
 * @property {number[][]} precision  inverse of the regularised covariance
 */

/**
 * @param {number[][]} rows  one `outlierVector` per training value
 * @returns {OutlierStats}
 */
export function fitOutlierStats(rows) {
  const d = OUTLIER_FEATURES.length;
  const columns = Array.from({ length: d }, (_, j) => rows.map((r) => r[j]));
  const cov = covariance(rows);
  const n = rows.length;
  return {
    features: OUTLIER_FEATURES,
    median: columns.map(median),
    q1: columns.map((c) => quantile(c, 0.25)),
    q3: columns.map((c) => quantile(c, 0.75)),
    mad: columns.map(mad),
    mean: columns.map((c) => (n === 0 ? 0 : c.reduce((a, b) => a + b, 0) / n)),
    cov: n === 0 ? Array.from({ length: d }, () => new Array(d).fill(0)) : cov,
    precision: invertSymmetric(
      regularise(n === 0 ? Array.from({ length: d }, () => new Array(d).fill(0)) : cov),
    ),
  };
}
