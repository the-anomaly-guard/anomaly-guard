// Combined statistical score (C-06): every signal reports s = -log10(p) on the common scale
// (ADR-007) and the request's score is their maximum. Thresholds are applied by the caller so the
// ROC can sweep them (standards §3, methods.md). Pure, runtime-agnostic.
//
// Signals: length.js (C-04), chisquare.js (C-03), outliers.js (C-05: IQR, MAD, Mahalanobis).
//
// The signals share a scale, not a calibration: on legitimate traffic one signal can run higher
// than another, and a plain maximum then raises the threshold for all of them (ADR-014). The
// optional `calibrated` mode first turns each signal into its own tail rank on legitimate
// calibration traffic.

import { chiSquareScore } from './chisquare.js';
import { lengthScore } from './length.js';
import { iqrScore, madScore, mahalanobisScore } from './outliers.js';

/** The parts of the statistical score, in a fixed order (it decides ties for `top`). */
export const SIGNAL_PARTS = Object.freeze(['length', 'chiSquare', 'iqr', 'mad', 'mahalanobis']);

/**
 * How the parts become one score:
 * - `max`: the largest part, as written in ADR-007 (the default, no extra fitting needed);
 * - `calibrated`: the largest part after each part is replaced by its tail rank on the legitimate
 *   calibration requests of `calibrateModel` (ADR-014).
 * @typedef {'max' | 'calibrated'} CombineMode
 */

/** @type {readonly CombineMode[]} */
export const COMBINE_MODES = Object.freeze(['max', 'calibrated']);

/**
 * The score of every signal for one request, each on the -log10(p) scale.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @returns {Record<string, number>} one entry per SIGNAL_PARTS
 */
export function scoreParts(model, request) {
  // Math.max(0, s) turns a -0 (a tail probability of exactly 1) into 0, so the parts survive a
  // JSON round trip unchanged.
  const part = (s) => Math.max(0, s);
  return {
    length: part(lengthScore(model, request).score),
    chiSquare: part(chiSquareScore(model, request).score),
    iqr: part(iqrScore(model, request).score),
    mad: part(madScore(model, request).score),
    mahalanobis: part(mahalanobisScore(model, request).score),
  };
}

/**
 * Tail rank of a score among legitimate calibration scores: s' = -log10(p~), where
 * p~ = (number of calibration scores >= s + 1) / (n + 1). It is the share of legitimate traffic
 * that scores at least as high, so 1 means "one legitimate request in ten does as well" and the
 * most extreme value possible is log10(n + 1), for a score above every calibration score.
 * @param {number[]} sortedScores  the calibration scores of one signal, ascending
 * @param {number} s
 * @returns {number} s' in [0, log10(n + 1)]
 */
export function tailScore(sortedScores, s) {
  const n = sortedScores.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedScores[mid] >= s) hi = mid;
    else lo = mid + 1;
  }
  return Math.log10((n + 1) / (n - lo + 1));
}

/**
 * Scores of the legitimate calibration requests, per signal, for the `calibrated` mode.
 * @typedef {Object} Calibration
 * @property {number} n  number of calibration requests
 * @property {Record<string, number[]>} scores  per SIGNAL_PARTS entry, ascending
 */

/**
 * Add the calibration of the signals to a model: score every LEGITIMATE calibration request and
 * keep the sorted scores of each signal. Use the legit-only calibration split (ADR-009), never the
 * training split (its scores are optimistic: the model has seen those values) and never the test
 * split. The model passed in is not modified; the result is still a plain serialisable object.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest[]} calibrationRequests  legitimate only
 * @returns {import('./model.js').StatModel} a copy of the model with `calibration`
 */
export function calibrateModel(model, calibrationRequests) {
  /** @type {Record<string, number[]>} */
  const scores = Object.fromEntries(SIGNAL_PARTS.map((name) => [name, []]));
  for (const request of calibrationRequests) {
    const parts = scoreParts(model, request);
    for (const name of SIGNAL_PARTS) scores[name].push(parts[name]);
  }
  for (const name of SIGNAL_PARTS) scores[name].sort((a, b) => a - b);
  return { ...model, calibration: { n: calibrationRequests.length, scores } };
}

/**
 * Combine the statistical signals into one anomaly score (ADR-007): every part is on the
 * -log10(p) scale and the score is their maximum; `top` names the part that produced it (the first
 * in SIGNAL_PARTS on a tie). Higher = more anomalous. The caller applies the threshold.
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @param {{ combine?: CombineMode }} [options]  `calibrated` needs a model from `calibrateModel`
 * @returns {{ score: number, parts: Record<string, number>, top: string | null, raw: Record<string, number> }}
 *   `parts` are the values that were combined; `raw` the signals' own scores (the same in `max`)
 * @throws {RangeError} for an unknown mode
 * @throws {TypeError} for `calibrated` on a model that was not calibrated
 */
export function scoreRequest(model, request, { combine = 'max' } = {}) {
  if (!COMBINE_MODES.includes(combine)) throw new RangeError(`unknown combine mode: ${combine}`);
  const raw = scoreParts(model, request);
  let parts = raw;
  if (combine === 'calibrated') {
    const calibration = model.calibration;
    if (!calibration) throw new TypeError("combine 'calibrated' needs calibrateModel(model, ...)");
    parts = Object.fromEntries(
      SIGNAL_PARTS.map((name) => [name, tailScore(calibration.scores[name], raw[name])]),
    );
  }
  let score = 0;
  /** @type {string | null} */
  let top = null;
  for (const [name, s] of Object.entries(parts)) {
    if (s > score) {
      score = s;
      top = name;
    }
  }
  return { score, parts, top, raw: { ...raw } };
}
