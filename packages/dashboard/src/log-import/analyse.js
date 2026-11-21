// Analyse a log with the console's detector (E-10, ADR-016), the way the experiment does it on
// simulated traffic. With no labels, what counts as normal is an assumption: a baseline, a
// separate log of the same site that the user trusts (ADR-017). The known attacks in it, the
// requests that match a signature, are left out first; then its first part trains the
// statistical model (legitimate only, ADR-004) and its last part sets the threshold at the chosen
// false-positive rate (ADR-009), and every request of the log is scored once. The rules, the model, the threshold and the detector are reused as they
// are. Pure: no DOM, tested in Node.

import { RuleEngine, detect, trainStatModel } from '@anomaly-guard/core';
import { operatingPoint, sourceOf } from '../pipeline.js';
import { levelOf } from '../levels.js';
import { toRequest } from './request.js';

/** Share of the baseline that sets the threshold; the rest trains the model. */
export const CALIBRATION_SHARE = 0.3;

/** Fewer baseline requests than this and the statistics would learn nothing. */
export const MIN_BASELINE = 50;

/**
 * @typedef {Object} DetectorSettings
 * @property {'combined' | 'stats' | 'rules'} mode
 * @property {number | 'manual'} fpr    target false-positive rate, or a manual threshold
 * @property {number} threshold         the manual threshold (−log10 p)
 */

/**
 * @typedef {Object} LogRow
 * @property {number} id
 * @property {import('./format.js').LogEntry} entry
 * @property {ReturnType<typeof toRequest>} request
 * @property {ReturnType<typeof detect>} result
 * @property {boolean} alert
 * @property {number} level
 * @property {'signature' | 'statistics' | 'both' | 'none'} source
 */

/**
 * The detector, from the baseline only. Its requests that match a signature are known attacks,
 * not normal traffic: they are left out. Of the rest, the model learns from the first part and
 * the threshold is set on the last part, so the threshold never sees the requests it trained on.
 * @param {import('./format.js').LogEntry[]} baseline
 * @param {DetectorSettings} settings
 * @throws {RangeError} when the statistics have too small a baseline to learn from
 */
export function prepareDetector(baseline, settings) {
  const ruleEngine = new RuleEngine();
  /** @type {import('./format.js').LogEntry[]} */
  const known = [];
  /** @type {ReturnType<typeof toRequest>[]} */
  const requests = [];
  for (const entry of baseline) {
    const request = toRequest(entry);
    if (ruleEngine.inspect(request).matched) known.push(entry);
    else requests.push(request);
  }
  if (settings.mode !== 'rules' && requests.length < MIN_BASELINE) {
    throw new RangeError(
      `The baseline has ${requests.length} requests` +
        (known.length ? ` once the ${known.length} that match a signature are left out` : '') +
        `: the statistics need at least ${MIN_BASELINE}. ` +
        'Use a longer baseline log, or the rules alone, which need none.',
    );
  }
  const trainCount = Math.round(requests.length * (1 - CALIBRATION_SHARE));
  const calibration = requests.slice(trainCount).map((request) => ({ request }));
  const model = trainStatModel(settings.mode === 'rules' ? [] : requests.slice(0, trainCount));
  let operating = operatingPoint(settings, calibration, { ruleEngine, model });
  /** @type {string[]} */
  const warnings = [];
  if (known.length) {
    const [first] = known;
    warnings.push(
      `${known.length} of the ${baseline.length} baseline requests match a signature, such as ` +
        `line ${first.line}: ${first.method} ${first.target.slice(0, 120)}. As known attacks they ` +
        'are left out of what counts as normal. If they are not attacks, a signature fires on ' +
        "this site's normal traffic.",
    );
  }
  const calibrated = settings.mode !== 'rules' && operating.target !== null;
  // A request is never flagged while its own p-value is above the target (s < −log10 α). On a
  // baseline that repeats a few identical requests almost every score is about 0, and the
  // calibrated threshold falls to rounding noise: a real public log with three URLs gave 5e-13,
  // and requests with p = 0.99995 raised alerts. The floor is the classic test at level α; on
  // ordinary traffic the calibrated threshold is far above it and nothing changes.
  const floor = calibrated ? -Math.log10(operating.target) : null;
  if (floor !== null && operating.threshold < floor) {
    const before = operating.threshold;
    const raised = operatingPoint({ ...settings, fpr: 'manual', threshold: floor }, calibration, {
      ruleEngine,
      model,
    });
    operating = { ...operating, threshold: floor, calibrationFpr: raised.calibrationFpr };
    warnings.push(
      'Almost every baseline request scores close to 0, as when a log repeats a few requests: ' +
        `the calibrated threshold, ${before < 0.01 ? before.toExponential(1) : before.toFixed(2)}, ` +
        `would flag requests that are not rare at all. It is raised to −log₁₀ α = ${floor.toFixed(2)}: ` +
        'a request is flagged only when its own p-value is below the false-positive target too.',
    );
  }
  if (calibrated && calibration.length < 10 / operating.target) {
    warnings.push(
      `The threshold rests on ${calibration.length} baseline requests: with fewer than ` +
        `${Math.ceil(10 / operating.target)} (n ≥ 10/α) it is noisy. Use a longer baseline or a ` +
        'higher false-positive target.',
    );
  }
  if (operating.attainable === false) {
    warnings.push(
      'No threshold keeps the alerts on the baseline within the false-positive target: ' +
        `${(100 * operating.calibrationFpr).toFixed(1)}% of the requests that set it score so ` +
        'high that any threshold flags them.',
    );
  }
  return {
    ruleEngine,
    model,
    operating,
    train: trainCount,
    calibration: calibration.length,
    known: known.length,
    warnings,
  };
}

/**
 * Score one logged request.
 * @param {import('./format.js').LogEntry} entry
 * @param {ReturnType<typeof prepareDetector>} detector
 * @param {DetectorSettings} settings
 * @param {number} id
 * @returns {LogRow}
 */
export function inspectEntry(entry, { ruleEngine, model, operating }, settings, id) {
  const request = toRequest(entry);
  const { threshold } = operating;
  const result = detect(request, { ruleEngine, model, threshold, mode: settings.mode });
  const alert = result.verdict === 'attack';
  return {
    id,
    entry,
    request,
    result,
    alert,
    level: levelOf(result),
    source: sourceOf(result, alert, threshold, settings.mode),
  };
}

/** Let the browser draw between slices of work. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The whole analysis, a slice of requests at a time so the page stays responsive.
 * @param {{ baseline: import('./format.js').LogEntry[], inspected: import('./format.js').LogEntry[],
 *   settings: DetectorSettings }} input
 * @param {{ onProgress?: (done: number, total: number) => void, slice?: number,
 *   pause?: () => Promise<unknown> }} [options]
 */
export async function analyseLog({ baseline, inspected, settings }, options = {}) {
  const { onProgress, slice = 500, pause = breathe } = options;
  const detector = prepareDetector(baseline, settings);
  /** @type {LogRow[]} */
  const rows = [];
  for (let start = 0; start < inspected.length; start += slice) {
    for (const entry of inspected.slice(start, start + slice)) {
      rows.push(inspectEntry(entry, detector, settings, rows.length + 1));
    }
    onProgress?.(rows.length, inspected.length);
    await pause();
  }
  const count = (/** @type {(row: LogRow) => boolean} */ keep) => rows.filter(keep).length;
  return {
    rows,
    operating: detector.operating,
    train: detector.train,
    calibration: detector.calibration,
    known: detector.known,
    warnings: detector.warnings,
    alerts: count((row) => row.alert),
    signatures: count((row) => row.alert && row.result.ruleMatched),
    statistical: count((row) => row.alert && !row.result.ruleMatched),
  };
}
