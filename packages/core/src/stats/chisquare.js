// Character-distribution signal (C-03) — the headline method (Kruegel & Vigna 2003, ADR-008,
// methods.md §4). The χ² survival function is computed here by hand: `core` uses no stats library.
// The dataset-level test of homogeneity and its effect size (C-08, methods.md §4b) live here too.
// Pure, runtime-agnostic.
//
// Building blocks: extractFeatures (../features/extract.js) gives each parameter's observed class
// counts; paramKey (./model.js) gives the model key; CHAR_CLASSES (./entropy.js) fixes k = 7.

import { extractFeatures } from '../features/extract.js';
import { CHAR_CLASSES, charClassCounts } from './entropy.js';
import { paramKey } from './model.js';

/** Degrees of freedom: k − 1, with k = 7 fixed character classes (ADR-008). */
const DF = CHAR_CLASSES.length - 1;

/** Expected count below which a class is merged for the dataset-level test (methods.md §4b). */
const MIN_EXPECTED = 5;

/** Lanczos coefficients for ln Γ(z), g = 7, 9 terms (Numerical Recipes, 3rd ed., §6.1). */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/**
 * Natural log of the gamma function by the Lanczos approximation, with the reflection formula
 * for z < 0.5. Only ln Γ(a) for a = df/2 > 0 is needed by the survival function.
 * @param {number} z
 * @returns {number}
 */
function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = LANCZOS[0];
  const shifted = z - 1;
  for (let i = 1; i < LANCZOS.length; i += 1) x += LANCZOS[i] / (shifted + i);
  const t = shifted + 7.5; // shifted + g + 0.5 with g = 7
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Natural log of the regularised upper incomplete gamma Q(a, x) = Γ(a, x) / Γ(a), i.e. the
 * chi-square survival function P(χ²(2a) > 2x). Series for x < a + 1 (then Q = 1 − P) and the
 * Lentz continued fraction otherwise, so a tiny tail probability is never lost by subtraction.
 * @param {number} a  shape parameter, > 0 (here df/2)
 * @param {number} x  argument, > 0 (here χ²/2)
 * @returns {number} ln Q(a, x) ≤ 0
 */
function gammaQLog(a, x) {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return -Infinity;
  const tiny = 1e-300;
  if (x < a + 1) {
    // Series for P(a, x): x^a e^-x / Γ(a) · Σ x^n / (a(a+1)…(a+n)).
    let denominator = a;
    let term = 1 / a;
    let sum = term;
    for (let n = 0; n < 1000; n += 1) {
      denominator += 1;
      term *= x / denominator;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    const p = Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
    return Math.log1p(-p); // log(1 − p), accurate when Q is small (here Q is not small)
  }
  // Continued fraction for Q(a, x), evaluated with the modified Lentz algorithm.
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return -x + a * Math.log(x) - logGamma(a) + Math.log(h);
}

/**
 * Natural log of the χ²(6) survival function:
 * P(χ²(6) > x) = e^(−x/2) · (1 + x/2 + x²/8).
 * For an even df = 2m the survival function is e^(−x/2) · Σ_{j=0}^{m−1} (x/2)^j / j!, here m = 3.
 * Working in logs keeps s = −ln p / ln 10 finite when p underflows (methods.md §4, ADR-007).
 * x ≤ 0 gives p = 1: a chi-square statistic is non-negative, and zero is not extreme.
 * @param {number} x chi-square statistic (≥ 0)
 * @returns {number} ln P(χ²(6) > x) ≤ 0
 */
export function chiSquare6LogSurvival(x) {
  if (!(x > 0)) return 0;
  if (!Number.isFinite(x)) return -Infinity;
  const half = x / 2;
  // ln(1 + half + half²/2); the branch avoids overflow of half² for absurd inputs.
  const logPolynomial =
    half > 1e150 ? 2 * Math.log(half) - Math.LN2 : Math.log1p(half + (half * half) / 2);
  return -half + logPolynomial;
}

/**
 * Natural log of the χ²(df) survival function for any positive df (methods.md §4b): for X ~ χ²(df),
 * P(X > x) = Q(df/2, x/2). df = 6 keeps the exact closed form used by the C-03 score; other df
 * (for example after merging classes) use the regularised incomplete gamma function.
 * The log form keeps huge χ² values reportable when p underflows to 0.
 * @param {number} x chi-square statistic (≥ 0)
 * @param {number} df degrees of freedom, > 0
 * @returns {number} ln P(χ²(df) > x) ≤ 0
 * @throws {RangeError} if df is not a positive finite number
 * @throws {TypeError} if x is not a number
 */
export function chiSquareLogSurvival(x, df) {
  if (!Number.isFinite(df) || df <= 0) {
    throw new RangeError('df must be a positive finite number');
  }
  if (typeof x !== 'number' || Number.isNaN(x)) throw new TypeError('x must be a number');
  if (!(x > 0)) return 0;
  if (!Number.isFinite(x)) return -Infinity;
  return df === DF ? chiSquare6LogSurvival(x) : gammaQLog(df / 2, x / 2);
}

/**
 * HEADLINE METHOD — chi-square score on the character distribution (methods.md §4, ADR-008).
 * For each parameter value with N > 0 characters: observed class counts O_i against expected
 * E_i = N · p̂_i, with Laplace-smoothed p̂_i = (c_i + 1) / (C + k) from the pair's training counts
 * (the pooled counts if the pair is unseen), so E_i > 0 always. χ² = Σ (O_i − E_i)² / E_i with
 * df = k − 1 = 6; no class merging, no Yates correction. The p-value from the χ²(6) survival
 * function is NOMINAL (the E_i are small), so it is used only as a score, s = −log10(p), computed
 * in log space so it cannot underflow. Report the most anomalous parameter; values with N = 0
 * carry no character evidence and are skipped.
 *
 * @param {import('./model.js').StatModel} model
 * @param {import('../features/extract.js').AgRequest} request
 * @returns {{ chiSquare: number, df: number, pValue: number, score: number, param: string | null }}
 */
export function chiSquareScore(model, request) {
  const f = extractFeatures(request);
  let chiSquare = 0;
  /** @type {string | null} */
  let param = null;

  for (const p of f.params) {
    const n = p.length;
    if (n === 0) continue;

    const stats = model.params[paramKey(f.path, p.name)];
    const counts = stats ? stats.classCounts : model.classCounts;
    let total = 0;
    for (const cls of CHAR_CLASSES) total += counts[cls] ?? 0;

    let observedChiSquare = 0;
    for (const cls of CHAR_CLASSES) {
      const smoothed = (counts[cls] ?? 0) + 1;
      const expected = (n * smoothed) / (total + CHAR_CLASSES.length);
      const difference = (p.classCounts[cls] ?? 0) - expected;
      observedChiSquare += (difference * difference) / expected;
    }

    if (param === null || observedChiSquare > chiSquare) {
      chiSquare = observedChiSquare;
      param = p.name;
    }
  }

  const logP = chiSquare6LogSurvival(chiSquare);
  return {
    chiSquare,
    df: DF,
    pValue: Math.exp(logP),
    score: logP === 0 ? 0 : -logP / Math.LN10,
    param,
  };
}

/**
 * @typedef {Object} ContingencyRow
 * @property {string} class  class name, or the merged names joined by '+' (e.g. 'punct+nonascii')
 * @property {number} legit  characters of this class in the legitimate group
 * @property {number} attack characters of this class in the attack group
 */

/**
 * @typedef {Object} HomogeneityResult
 * @property {number} chiSquare  test statistic Σ(O − E)² / E
 * @property {number} df         (rows − 1)(2 − 1) after any merging
 * @property {number} pValue     P(χ²(df) > chiSquare); may underflow to 0 for a huge statistic
 * @property {number} score      −log10(pValue), finite even when pValue underflows
 * @property {number} cramersV   effect size √(χ² / N); with two groups min(rows − 1, 1) = 1
 * @property {number} totalChars total characters in the table, both groups
 * @property {{ legit: number, attack: number }} groups  characters per group
 * @property {ContingencyRow[]} table  final rows, in CHAR_CLASSES order
 * @property {{ from: string, into: string }[]} merges  classes merged for this test, in order
 */

/**
 * DATASET-LEVEL TEST (methods.md §4b, ADR-008 point 3, C-08). Tests whether the seven character
 * classes have the same distribution in the legitimate and attack test values: a 7 × 2 contingency
 * table of pooled character counts, a chi-square test of homogeneity with
 * df = (rows − 1)(2 − 1). Expected values are E_ij = row_i · column_j / N.
 *
 * Unlike the per-request score, this is a valid asymptotic test: the character counts are in the
 * thousands. A class whose smallest expected count is below 5 is merged into an adjacent class
 * (in CHAR_CLASSES order, the neighbour with the larger expected count; the previous one on a
 * tie) for this test only, and the merge is reported. All-zero classes merge away without
 * changing any count. Cramér's V is returned because with thousands of characters a negligible
 * difference can be "significant": the p-value says whether, V says how much.
 *
 * The unit is the pooled character, not the request: characters within a value and values within
 * a request are not independent draws, so the p-value is descriptive of this corpus, not a
 * calibrated probability about requests (methods.md §1b/§4b).
 *
 * @param {string[]} legitValues  parameter values of the legitimate test requests (empty allowed)
 * @param {string[]} attackValues parameter values of the attack test requests (empty allowed)
 * @returns {HomogeneityResult}
 * @throws {TypeError} if either argument is not an array
 * @throws {RangeError} if either group has no characters
 */
export function chiSquareHomogeneity(legitValues, attackValues) {
  if (!Array.isArray(legitValues) || !Array.isArray(attackValues)) {
    throw new TypeError('legitValues and attackValues must be arrays');
  }
  if (legitValues.length === 0 || attackValues.length === 0) {
    throw new RangeError('each group needs at least one value');
  }

  /** @type {{ label: string, legit: number, attack: number }[]} */
  const table = CHAR_CLASSES.map((label) => ({ label, legit: 0, attack: 0 }));
  let legitChars = 0;
  let attackChars = 0;
  for (const [values, side] of /** @type {const} */ ([
    [legitValues, 'legit'],
    [attackValues, 'attack'],
  ])) {
    for (const value of values) {
      const counts = charClassCounts(String(value));
      let valueChars = 0;
      for (const row of table) {
        row[side] += counts[row.label];
        valueChars += counts[row.label];
      }
      if (side === 'legit') legitChars += valueChars;
      else attackChars += valueChars;
    }
  }
  if (legitChars === 0 || attackChars === 0) {
    throw new RangeError('each group needs at least one character');
  }

  const totalChars = legitChars + attackChars;
  /** @type {{ from: string, into: string }[]} */
  const merges = [];
  while (table.length > 1) {
    // Find the class with the smallest expected count in the 7 × 2 table.
    let worst = 0;
    let worstExpected = Infinity;
    for (let i = 0; i < table.length; i += 1) {
      const rowTotal = table[i].legit + table[i].attack;
      const expected = Math.min(
        (rowTotal * legitChars) / totalChars,
        (rowTotal * attackChars) / totalChars,
      );
      if (expected < worstExpected) {
        worstExpected = expected;
        worst = i;
      }
    }
    if (worstExpected >= MIN_EXPECTED) break;

    // Merge into the adjacent class with the larger expected count; the previous one on a tie.
    let into;
    if (worst === 0) into = 1;
    else if (worst === table.length - 1) into = worst - 1;
    else {
      const previous = table[worst - 1];
      const next = table[worst + 1];
      const previousTotal = previous.legit + previous.attack;
      const nextTotal = next.legit + next.attack;
      into = nextTotal > previousTotal ? worst + 1 : worst - 1;
    }

    const from = table[worst];
    const target = table[into];
    const label = into < worst ? `${target.label}+${from.label}` : `${from.label}+${target.label}`;
    merges.push({ from: from.label, into: target.label });
    table.splice(Math.min(worst, into), 2, {
      label,
      legit: from.legit + target.legit,
      attack: from.attack + target.attack,
    });
  }

  let chiSquare = 0;
  for (const row of table) {
    const rowTotal = row.legit + row.attack;
    for (const [observed, columnTotal] of /** @type {const} */ ([
      [row.legit, legitChars],
      [row.attack, attackChars],
    ])) {
      const expected = (rowTotal * columnTotal) / totalChars;
      chiSquare += ((observed - expected) * (observed - expected)) / expected;
    }
  }

  const df = (table.length - 1) * (2 - 1);
  const logP = df === 0 ? 0 : chiSquareLogSurvival(chiSquare, df);
  return {
    chiSquare,
    df,
    pValue: Math.exp(logP),
    score: logP === 0 ? 0 : -logP / Math.LN10,
    cramersV: df === 0 ? 0 : Math.sqrt(chiSquare / (totalChars * Math.min(table.length - 1, 1))),
    totalChars,
    groups: { legit: legitChars, attack: attackChars },
    table: table.map((row) => ({ class: row.label, legit: row.legit, attack: row.attack })),
    merges,
  };
}
