// E-03: prepare the held-out rates and Bayes curve without depending on the browser.
import { positivePredictiveValue } from '@anomaly-guard/evaluation';

/**
 * Measured rates are undefined when the test split contains none of that class.
 * @param {{ tp: number, fp: number, tn: number, fn: number }} cm
 */
export function measuredRates({ tp, fp, tn, fn }) {
  const attacks = tp + fn;
  const legitimate = fp + tn;
  return {
    attacks,
    legitimate,
    tpr: attacks ? tp / attacks : null,
    fpr: legitimate ? fp / legitimate : null,
  };
}

/**
 * The share of alarms that are attacks, or null when no alarms are expected. The evaluation
 * helper returns 0 for an empty denominator; here we display the conditional probability as
 * undefined because there are no alarms to condition on.
 * @param {number} tpr
 * @param {number} fpr
 * @param {number} prevalence
 * @returns {number | null}
 */
export function alarmPpv(tpr, fpr, prevalence) {
  if (tpr * prevalence + fpr * (1 - prevalence) === 0) return null;
  return positivePredictiveValue(tpr, fpr, prevalence);
}

/**
 * Sample the curve at equal intervals in log prevalence, including the endpoints. A log axis
 * makes rare attacks visible; zero is handled separately because log(0) is undefined.
 * @param {number} tpr
 * @param {number} fpr
 */
export function prevalenceCurve(tpr, fpr) {
  return Array.from({ length: 301 }, (_, i) => {
    const x = 10 ** (-6 + (6 * i) / 300);
    return { x, y: alarmPpv(tpr, fpr, x) };
  });
}
