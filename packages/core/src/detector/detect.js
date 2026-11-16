// Detector: combine rule hits and the statistical score into an explained verdict, with ONE
// continuous score per mode so the ROC can sweep the threshold in every configuration (ADR-007).
// A statistical reason names the signal, the parameter, the feature and the probability (C-07).
// Pure, runtime-agnostic.

import { scoreRequest } from '../stats/anomaly.js';

/** @typedef {import('../stats/anomaly.js').Explanation} Explanation */

/**
 * @typedef {'rules' | 'stats' | 'combined'} DetectMode
 */

const MODES = ['rules', 'stats', 'combined'];

/**
 * One readable line for an explanation, e.g.
 * `length on "q": z = 12.10, p ≈ 6.3e-5` or `iqr on "q" (logLength): z = 8.20, p ≈ 1.5e-2`.
 * @param {Explanation} e
 * @returns {string}
 */
export function describeExplanation(e) {
  const where = e.param === null ? '' : ` on "${e.param}"${e.feature ? ` (${e.feature})` : ''}`;
  if (e.unseen) return `${e.signal}${where}: parameter never seen in training, p ≈ ${fmtP(e.p)}`;
  const df = e.df === null ? '' : ` (df ${e.df})`;
  const value = e.value === null ? '' : `${e.statistic} = ${e.value.toFixed(2)}${df}, `;
  return `${e.signal}${where}: ${value}p ≈ ${fmtP(e.p)}`;
}

/** @param {number} p  @returns {string} two significant digits, exponent for small values */
function fmtP(p) {
  return p >= 0.01 ? p.toFixed(2) : p.toExponential(1);
}

/**
 * Decide whether a request is an attack, and say why.
 *
 * Score by mode (ADR-007): `stats` -> the statistical score (−log10 p scale); `combined` ->
 * +Infinity when a rule matched, otherwise the statistical score; `rules` -> 1 if a rule matched,
 * else 0 (a binary score: its ROC is a single operating point). For `stats` and `combined` the
 * verdict is 'attack' exactly when score ≥ threshold.
 *
 * @param {import('../features/extract.js').AgRequest} request
 * @param {Object} opts
 * @param {import('../rules/engine.js').RuleEngine} [opts.ruleEngine]  required for 'rules'/'combined'
 * @param {import('../stats/model.js').StatModel} [opts.model]       required for 'stats'/'combined'
 * @param {number} [opts.threshold]  on the −log10(p) scale; required for 'stats'/'combined'. No
 *   default on purpose: it is calibrated on legitimate data and swept by the ROC (ADR-009).
 * @param {DetectMode} [opts.mode='combined']
 * @returns {{
 *   verdict: 'attack' | 'legit',
 *   score: number,
 *   statScore: number,
 *   ruleMatched: boolean,
 *   reasons: string[],
 *   detail: { hits: any[], parts: Record<string, number>, explanation: Explanation | null }
 * }}
 */
export function detect(request, opts) {
  const { ruleEngine, model, threshold, mode = 'combined' } = opts ?? {};
  if (!MODES.includes(mode)) throw new TypeError(`detect: unknown mode '${mode}'`);
  const useRules = mode !== 'stats';
  const useStats = mode !== 'rules';
  if (useRules && !ruleEngine) throw new TypeError(`detect: mode '${mode}' needs a ruleEngine`);
  if (useStats && !model) throw new TypeError(`detect: mode '${mode}' needs a trained model`);
  if (useStats && !Number.isFinite(threshold)) {
    throw new TypeError(`detect: mode '${mode}' needs a finite numeric threshold`);
  }

  /** @type {string[]} */
  const reasons = [];

  let ruleMatched = false;
  /** @type {any[]} */
  let hits = [];
  if (useRules) {
    const r = ruleEngine.inspect(request);
    ruleMatched = r.matched;
    hits = r.hits;
    for (const h of r.hits) reasons.push(`rule ${h.ruleId} (${h.kind}) on "${h.param}"`);
  }

  let statScore = 0;
  /** @type {Record<string, number>} */
  let parts = {};
  /** @type {Explanation | null} */
  let explanation = null;
  if (useStats) {
    const s = scoreRequest(model, request);
    statScore = s.score;
    parts = s.parts;
    explanation = s.explanation;
    if (statScore >= threshold) {
      // Two decimals for both: a calibrated threshold has many digits (ADR-009).
      reasons.push(
        `statistical score ${statScore.toFixed(2)} ≥ threshold ${threshold.toFixed(2)}: ` +
          (explanation ? describeExplanation(explanation) : 'no signal'),
      );
    }
  }

  let score;
  if (mode === 'rules') score = ruleMatched ? 1 : 0;
  else if (mode === 'stats') score = statScore;
  else score = ruleMatched ? Infinity : statScore;

  const isAttack = mode === 'rules' ? ruleMatched : score >= threshold;

  return {
    verdict: isAttack ? 'attack' : 'legit',
    score,
    statScore,
    ruleMatched,
    reasons,
    detail: { hits, parts, explanation },
  };
}
