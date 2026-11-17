// Character-class composition of the legitimate and attack test values (E-02, theme T1): the
// seven-class column profile behind the chi-square score (C-03) and the dataset-level test of
// homogeneity (C-08, methods.md §4b). Pure: no DOM, tested in Node. The labels come from the
// simulator and are used for the picture only, never by the detector (ADR-004).

import { CHAR_CLASSES, charClassCounts } from '@anomaly-guard/core';

/**
 * @typedef {Object} CharacterClassShares
 * @property {string[]} labels  the seven character classes, in ADR-008 order
 * @property {number[]} legit   share of the legitimate group's characters in each class
 * @property {number[]} attack  share of the attack group's characters in each class
 * @property {number[]} legitCount  characters per class, legitimate group
 * @property {number[]} attackCount characters per class, attack group
 * @property {number} legitChars    total characters in the legitimate group
 * @property {number} attackChars   total characters in the attack group
 */

/** @returns {Record<string, number>} a zero for every class (a fresh object per group) */
function zeroCounts() {
  return Object.fromEntries(CHAR_CLASSES.map((cls) => [cls, 0]));
}

/**
 * Pool every parameter value of the test requests by ground-truth label, count the seven character
 * classes and divide by the group's total number of characters. This is the column profile of the
 * 7 × 2 table of methods.md §4b, not the per-request chi-square score: each group adds up to 1, so
 * the smaller attack group is not hidden, and characters within a value count once each. The attack
 * group also contains the legitimate filler values of an attack request (ADR-006), which dilutes
 * the contrast; the chart describes this corpus, it is not a probability about requests.
 * @param {{ label: string, request: { params?: Record<string, unknown> } }[]} samples
 * @returns {CharacterClassShares}
 * @throws {TypeError} if samples is not an array
 */
export function characterClassShares(samples) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');

  const counts = { legit: zeroCounts(), attack: zeroCounts() };
  let legitChars = 0;
  let attackChars = 0;
  for (const sample of samples) {
    const side = sample.label === 'attack' ? 'attack' : 'legit';
    for (const value of Object.values(sample.request?.params ?? {})) {
      const valueCounts = charClassCounts(String(value ?? ''));
      let valueChars = 0;
      for (const cls of CHAR_CLASSES) {
        counts[side][cls] += valueCounts[cls];
        valueChars += valueCounts[cls];
      }
      if (side === 'attack') attackChars += valueChars;
      else legitChars += valueChars;
    }
  }

  /** @param {Record<string, number>} groupCounts @param {number} total */
  const shares = (groupCounts, total) =>
    CHAR_CLASSES.map((cls) => (total === 0 ? 0 : groupCounts[cls] / total));

  return {
    labels: [...CHAR_CLASSES],
    legit: shares(counts.legit, legitChars),
    attack: shares(counts.attack, attackChars),
    legitCount: CHAR_CLASSES.map((cls) => counts.legit[cls]),
    attackCount: CHAR_CLASSES.map((cls) => counts.attack[cls]),
    legitChars,
    attackChars,
  };
}
