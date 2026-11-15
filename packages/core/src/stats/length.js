// Length signal (C-04): how far a value's length is from what its (path, parameter) pair receives
// in normal traffic (methods.md §3). Four ways to turn the deviation into a tail probability p,
// all reported as s = −log10(p) (ADR-007); the threshold is applied outside. Pure,
// runtime-agnostic.

import { extractFeatures } from '../features/extract.js';
import { chiSquareLogSurvival } from './chisquare.js';
import { paramKey, pToScore } from './model.js';

/**
 * How the deviation z becomes a tail probability (methods.md §3):
 * - `chebyshev`: p = min(1, 1/z²) on the raw length - any distribution, conservative;
 * - `chebyshev-log`: the same on ln(1 + length) - lengths are right-skewed;
 * - `prediction-interval`: normal-theory bound for a NEW value, z' = z / √(1 + 1/n),
 *   p = P(|N(0,1)| ≥ z') on the raw length;
 * - `prediction-interval-log`: the same on ln(1 + length).
 * The normal quantile replaces Student's t (large n); a t quantile is a possible refinement.
 * @typedef {'chebyshev' | 'chebyshev-log' | 'prediction-interval' | 'prediction-interval-log'} LengthMethod
 */

/** @type {readonly LengthMethod[]} */
export const LENGTH_METHODS = Object.freeze([
  'chebyshev',
  'chebyshev-log',
  'prediction-interval',
  'prediction-interval-log',
]);

/**
 * The method used when none is asked for: Chebyshev on the log scale (ADR-012). Distribution-free
 * like the baseline, and better on the comparison of C-04 (AUC +0.025 in 20/20 seeds, half the
 * false alarms on hard legitimate cases at a 1 % target FPR).
 */
export const DEFAULT_LENGTH_METHOD = 'chebyshev-log';

/**
 * Smallest σ used to standardise: a pair whose training lengths are (almost) constant would give
 * z = ∞ for any difference. 1 character on the raw scale, 0.1 (≈ 10 %) on the log scale.
 */
export const MIN_STD = Object.freeze({ raw: 1, log: 0.1 });

/**
 * Policy for a (path, parameter) pair never seen in training (C-04): an unexpected attribute is
 * anomalous in itself (Kruegel & Vigna), but only moderately so, because rare legitimate
 * parameters exist. Its tail probability is 1 / (n + 1), n = number of training requests
 * ("less likely than anything we observed"), so s = log10(n + 1). With n = 0 there is no
 * evidence at all and the score is 0.
 * @param {import('./model.js').StatModel} model
 * @returns {number} s ≥ 0
 */
export function unseenPairScore(model) {
  return model.trainedOn > 0 ? Math.log10(model.trainedOn + 1) : 0;
}

/**
 * Standardised deviation z = |x − μ| / max(σ, MIN_STD) of one length.
 * @param {import('./model.js').ParamStats} stats
 * @param {number} length
 * @param {boolean} [log=false] use the ln(1 + length) statistics
 * @returns {number} z ≥ 0
 */
function deviation(stats, length, log = false) {
  const { mean, std } = log ? stats.logLength : stats.length;
  const x = log ? Math.log1p(length) : length;
  return Math.abs(x - mean) / Math.max(std, log ? MIN_STD.log : MIN_STD.raw);
}

/**
 * Score s = −log10(p) of one deviation z under a method.
 * @param {LengthMethod} method
 * @param {number} z  deviation on the method's scale (see `deviation`)
 * @param {number} n  training values of the pair
 * @returns {number} s ≥ 0
 */
function methodScore(method, z, n) {
  if (method === 'chebyshev' || method === 'chebyshev-log') return pToScore(1 / (z * z));
  // Two-sided normal tail P(|N| ≥ z') = P(χ²(1) > z'²), computed in log space (no underflow).
  const zPrime = z / Math.sqrt(1 + 1 / n);
  return -chiSquareLogSurvival(zPrime * zPrime, 1) / Math.LN10;
}

/**
 * Largest standardised length deviation z across the request's parameters, from the statistics of
 * each (path, parameter) pair (σ floored at MIN_STD). Pairs unseen in training have no z and are
 * skipped here; `lengthScore` gives them their own score.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @param {{ log?: boolean }} [options]  `log`: standardise ln(1 + length) instead of the length
 * @returns {{ z: number, param: string | null }} the largest z (≥ 0) and its parameter
 */
export function lengthZScore(model, request, { log = false } = {}) {
  const f = extractFeatures(request);
  let z = 0;
  /** @type {string | null} */
  let param = null;
  for (const p of f.params) {
    const stats = model.params[paramKey(f.path, p.name)];
    if (!stats) continue;
    const zp = deviation(stats, p.length, log);
    if (zp > z) {
      z = zp;
      param = p.name;
    }
  }
  return { z, param };
}

/**
 * Length signal (C-04) on the common scale: the largest score over the request's parameters,
 * `unseenPairScore` for a pair never seen in training. Chebyshev's inequality bounds the tail of
 * ANY distribution, P(|X − μ| ≥ zσ) ≤ 1/z² (the bound Kruegel & Vigna use for lengths); it bounds
 * a NEW observation and is not a confidence interval (methods.md §3).
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @param {{ method?: LengthMethod }} [options]
 * @returns {{ score: number, z: number, param: string | null, unseen: boolean }}
 *   `z` is on the method's scale; `unseen` is true when the score comes from an unseen pair
 * @throws {RangeError} for an unknown method
 */
export function lengthScore(model, request, { method = DEFAULT_LENGTH_METHOD } = {}) {
  if (!LENGTH_METHODS.includes(method)) throw new RangeError(`unknown length method: ${method}`);
  const log = method.endsWith('-log');
  const f = extractFeatures(request);
  let score = 0;
  let z = 0;
  /** @type {string | null} */
  let param = null;
  let unseen = false;
  for (const p of f.params) {
    const stats = model.params[paramKey(f.path, p.name)];
    let s;
    let zp = 0;
    let isUnseen = false;
    if (stats) {
      zp = deviation(stats, p.length, log);
      s = methodScore(method, zp, stats.n);
    } else {
      s = unseenPairScore(model);
      isUnseen = true;
    }
    if (s > score) {
      score = s;
      z = zp;
      param = p.name;
      unseen = isUnseen;
    }
  }
  return { score, z, param, unseen };
}
