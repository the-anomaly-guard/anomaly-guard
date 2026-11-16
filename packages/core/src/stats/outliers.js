// Outlier signals (C-05, methods.md §5): robust per-feature scores (IQR, MAD) and the multivariate
// Mahalanobis distance, each turned into a tail probability and reported as s = -log10(p)
// (ADR-007); the threshold is applied outside. They measure each parameter value on three
// features (OUTLIER_FEATURES) against what its (path, parameter) pair receives in normal traffic.
// A pair never seen in training, or seen fewer than MIN_OUTLIER_N times, scores 0 here: the policy
// for unseen pairs belongs to the length signal (C-04), and counting it twice would not add
// information. Pure, runtime-agnostic.

import { extractFeatures, paramFeatures } from '../features/extract.js';
import { chiSquareLogSurvival } from './chisquare.js';
import { paramKey, pToScore } from './model.js';
import { FEATURE_FLOORS, MIN_OUTLIER_N, OUTLIER_FEATURES, outlierVector } from './robust.js';

/** MAD of a normal distribution is 0.6745 σ, so σ is estimated by MAD / 0.6745. */
export const MAD_CONSISTENCY = 0.6745;

/** The inter-quartile range of a normal distribution is 1.349 σ, so σ is estimated by IQR / 1.349. */
export const IQR_NORMAL = 1.349;

/** Tukey's fence: a value further than this many IQRs beyond a quartile is a box-plot outlier. */
export const FENCE = 1.5;

/**
 * Robust standardised deviation z = |x - median| / max(scale / k, floor), where `scale` is the
 * MAD (k = 0.6745) or the IQR (k = 1.349): a robust estimate of σ, never below the feature floor.
 * @param {number} x
 * @param {number} centre  the training median
 * @param {number} scale  the training MAD or IQR
 * @param {number} k  MAD_CONSISTENCY or IQR_NORMAL
 * @param {number} floor  FEATURE_FLOORS entry
 * @returns {number} z >= 0
 */
function robustDeviation(x, centre, scale, k, floor) {
  return Math.abs(x - centre) / Math.max(scale / k, floor);
}

/**
 * z from the median and the MAD: z = 0.6745 |x - median| / MAD, with σ floored.
 * @param {number} x
 * @param {number} median
 * @param {number} mad  raw MAD
 * @param {number} [floor=0]
 * @returns {number}
 */
export function madDeviation(x, median, mad, floor = 0) {
  return robustDeviation(x, median, mad, MAD_CONSISTENCY, floor);
}

/**
 * z from the median and the IQR: z = |x - median| / (IQR / 1.349), with σ floored.
 * @param {number} x
 * @param {number} median
 * @param {number} iqr  Q3 - Q1
 * @param {number} [floor=0]
 * @returns {number}
 */
export function iqrDeviation(x, median, iqr, floor = 0) {
  return robustDeviation(x, median, iqr, IQR_NORMAL, floor);
}

/**
 * How far x lies beyond Tukey's fences, in IQR units (0 inside the fences). Reported to explain a
 * hit; the score itself comes from `iqrDeviation`.
 * @param {number} x
 * @param {number} q1
 * @param {number} q3
 * @returns {number} >= 0
 */
export function fenceDistance(x, q1, q3) {
  const iqr = q3 - q1;
  if (!(iqr > 0)) return 0;
  return Math.max(0, (q1 - FENCE * iqr - x) / iqr, (x - (q3 + FENCE * iqr)) / iqr);
}

/**
 * Score of a deviation z by Chebyshev's inequality, p = min(1, 1/z²) (distribution-free, as in
 * methods.md §3): s = -log10(p).
 * @param {number} z
 * @returns {number} s >= 0
 */
export function deviationScore(z) {
  return pToScore(1 / (z * z));
}

/**
 * Squared Mahalanobis distance D² = (x - μ)ᵀ P (x - μ), with P the inverse covariance.
 * @param {number[]} x
 * @param {number[]} mean
 * @param {number[][]} precision
 * @returns {number} D² >= 0
 */
export function mahalanobisD2(x, mean, precision) {
  const d = x.length;
  let sum = 0;
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) sum += (x[i] - mean[i]) * precision[i][j] * (x[j] - mean[j]);
  }
  return Math.max(0, sum);
}

/**
 * Score of a squared distance: s = -log10 P(χ²(df) > D²), computed in log space so it cannot
 * underflow. The p-value is nominal (the mean and the covariance are estimated, and the features
 * are not normal), so it is only a score (methods.md §5).
 * @param {number} d2  D² >= 0
 * @param {number} df  number of features
 * @returns {number} s >= 0
 */
export function mahalanobisTailScore(d2, df) {
  return Math.max(0, -chiSquareLogSurvival(d2, df) / Math.LN10);
}

/**
 * Shared scan over a request's parameters for the two univariate signals: the worst feature of
 * the worst parameter.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @param {(s: import('./robust.js').OutlierStats, i: number, x: number) => number} deviation
 * @returns {{ score: number, z: number, param: string | null, feature: string | null, beyondFence: boolean }}
 */
function scanFeatures(model, request, deviation) {
  const f = extractFeatures(request);
  const best = { score: 0, z: 0, param: null, feature: null, beyondFence: false };
  for (const p of f.params) {
    const stats = model.params[paramKey(f.path, p.name)];
    if (!stats?.outlier || stats.n < MIN_OUTLIER_N) continue;
    const x = outlierVector(paramFeatures(p.name, request.params[p.name]));
    for (let i = 0; i < OUTLIER_FEATURES.length; i++) {
      const z = deviation(stats.outlier, i, x[i]);
      const score = deviationScore(z);
      if (score > best.score) {
        best.score = score;
        best.z = z;
        best.param = p.name;
        best.feature = OUTLIER_FEATURES[i];
        best.beyondFence = fenceDistance(x[i], stats.outlier.q1[i], stats.outlier.q3[i]) > 0;
      }
    }
  }
  return best;
}

/**
 * IQR signal: for each feature, z = |x - median| / (IQR / 1.349) (the IQR is a robust σ), then the
 * Chebyshev tail. `beyondFence` tells whether the value is also outside Tukey's fences.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @returns {{ score: number, z: number, param: string | null, feature: string | null, beyondFence: boolean }}
 */
export function iqrScore(model, request) {
  return scanFeatures(model, request, (s, i, x) =>
    iqrDeviation(x, s.median[i], s.q3[i] - s.q1[i], FEATURE_FLOORS[i]),
  );
}

/**
 * MAD signal: for each feature, z = 0.6745 |x - median| / MAD, then the Chebyshev tail. Robust to
 * outliers in the training data, unlike the mean and the standard deviation of §3.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @returns {{ score: number, z: number, param: string | null, feature: string | null, beyondFence: boolean }}
 */
export function madScore(model, request) {
  return scanFeatures(model, request, (s, i, x) =>
    madDeviation(x, s.median[i], s.mad[i], FEATURE_FLOORS[i]),
  );
}

/**
 * Mahalanobis signal: the three features of a value together, D² against the pair's mean and
 * regularised covariance, p ~ P(χ²(3) > D²). It catches a *combination* that is unusual even when
 * every feature alone is ordinary (methods.md §5).
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @returns {{ score: number, d2: number, df: number, param: string | null }}
 */
export function mahalanobisScore(model, request) {
  const f = extractFeatures(request);
  const df = OUTLIER_FEATURES.length;
  const best = { score: 0, d2: 0, df, param: null };
  for (const p of f.params) {
    const stats = model.params[paramKey(f.path, p.name)];
    if (!stats?.outlier || stats.n < MIN_OUTLIER_N) continue;
    const x = outlierVector(paramFeatures(p.name, request.params[p.name]));
    const d2 = mahalanobisD2(x, stats.outlier.mean, stats.outlier.precision);
    const score = mahalanobisTailScore(d2, df);
    if (score > best.score) {
      best.score = score;
      best.d2 = d2;
      best.param = p.name;
    }
  }
  return best;
}
