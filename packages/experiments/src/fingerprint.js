// The fingerprint of the code behind the report's numbers (D-08, ADR-014). It runs a small
// version of the experiment, PROBE_CONFIG (two seeds at the full split sizes, few bootstrap
// resamples, about a second), and hashes every number it gives. A change to the traffic
// generator, the features, the rules, the statistical model, the detector, the threshold or the
// metrics moves some of those numbers, and so the hash; a change that moves none of them (a
// refactor, a comment) leaves it as it was. docs/report/numbers.json keeps the fingerprint of the
// code that produced it, and a test compares it with the fingerprint of the code as it is now.
// Node only (node:crypto).

import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, runExperiment } from './run.js';

/** The probe: the report's configuration with two seeds and 20 bootstrap resamples. */
export const PROBE_CONFIG = Object.freeze({
  ...DEFAULT_CONFIG,
  seeds: Object.freeze([1, 2]),
  resamples: 20,
});

/** Significant digits kept before hashing, so that the last bit of a float does not count. */
const DIGITS = 10;

/**
 * A plain copy with the object keys sorted and every number rounded to DIGITS significant
 * digits (a non-finite number as text): the same results always give the same JSON.
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonical(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toPrecision(DIGITS)) : String(value);
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(/** @type {Record<string, unknown>} */ (value)[key])]),
    );
  }
  return value;
}

/**
 * SHA-256 of the canonical JSON of a value.
 * @param {unknown} value
 * @returns {string} 64 hex digits
 */
export function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** The fingerprint of the code as it is now: run the probe and hash its results. */
export function codeFingerprint() {
  return fingerprint(runExperiment(PROBE_CONFIG));
}
