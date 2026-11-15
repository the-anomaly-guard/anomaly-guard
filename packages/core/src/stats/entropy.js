// Shannon entropy and character-distribution primitives.
// Pure, runtime-agnostic (no DOM, no Node API). See docs/statistics/methods.md §0-§1 and ADR-008.
// The report-facing summaries of the entropy distributions (methods.md §1b, C-08) live here too.

/**
 * The fixed character classes used for distribution features and the chi-square score
 * (ADR-008, methods.md §0). Keep this stable: changing it silently invalidates trained models and
 * reported results (standards §3). Every character maps to exactly one class.
 * @type {readonly string[]}
 */
export const CHAR_CLASSES = Object.freeze([
  'lower', // a-z
  'upper', // A-Z
  'digit', // 0-9
  'space', // a single space (U+0020)
  'special', // injection metacharacters (SPECIAL_CHARS) and control characters
  'punct', // the remaining printable ASCII punctuation: ! + , . : ? @ [ ] ^ _ ~
  'nonascii', // any code point >= U+0080: accented letters, non-Latin scripts, emoji
]);

/**
 * Metacharacters of SQL, HTML/JS, shell and path syntax: frequent in injection payloads, rare in
 * normal input. Control characters (U+0000-U+001F, U+007F) are classed as `special` too.
 * Documented in methods.md §0.
 * @type {ReadonlySet<string>}
 */
export const SPECIAL_CHARS = new Set([
  "'",
  '"',
  ';',
  '<',
  '>',
  '(',
  ')',
  '=',
  '-',
  '/',
  '\\',
  '%',
  '&',
  '|',
  '$',
  '{',
  '}',
  '`',
  '*',
  '#',
]);

/**
 * Classify a single character (one code point) into one of CHAR_CLASSES.
 * @param {string} ch a single-code-point string
 * @returns {string} one of CHAR_CLASSES
 */
export function classifyChar(ch) {
  if (ch >= 'a' && ch <= 'z') return 'lower';
  if (ch >= 'A' && ch <= 'Z') return 'upper';
  if (ch >= '0' && ch <= '9') return 'digit';
  if (ch === ' ') return 'space';
  const code = ch.codePointAt(0) ?? 0;
  if (SPECIAL_CHARS.has(ch) || code < 0x20 || code === 0x7f) return 'special';
  if (code < 0x80) return 'punct';
  return 'nonascii';
}

/**
 * Count characters per class.
 * @param {string} input
 * @returns {Record<string, number>} counts keyed by CHAR_CLASSES (every class present, may be 0)
 */
export function charClassCounts(input) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const cls of CHAR_CLASSES) counts[cls] = 0;
  for (const ch of String(input)) counts[classifyChar(ch)] += 1;
  return counts;
}

/**
 * Histogram of raw symbols (characters) in a string: symbol -> count. Used for the entropy; the
 * binned histogram that feeds the models is charClassCounts.
 * @param {string} input
 * @returns {Map<string, number>}
 */
export function charHistogram(input) {
  /** @type {Map<string, number>} */
  const hist = new Map();
  for (const ch of String(input)) hist.set(ch, (hist.get(ch) ?? 0) + 1);
  return hist;
}

/**
 * Shannon entropy of a string, in bits per symbol.
 * H = -Σ p_i log2(p_i), with 0 ≤ H ≤ log2(k), k = number of distinct symbols.
 * A symbol is a code point, so an astral character (an emoji, say) counts once, not twice as its
 * two UTF-16 code units. An empty string has entropy 0 by convention.
 * @param {string} input
 * @returns {number} entropy in bits/symbol
 */
export function shannonEntropy(input) {
  const s = String(input);
  if (s.length === 0) return 0;
  const hist = charHistogram(s);
  let symbols = 0;
  for (const count of hist.values()) symbols += count;
  let h = 0;
  for (const count of hist.values()) {
    const p = count / symbols;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * The p-quantile of a sorted numeric array by linear interpolation between order statistics:
 * position (n − 1)·p, as in R's default type 7 and NumPy's default. p = 0 is the minimum and
 * p = 1 the maximum.
 * @param {number[]} sorted ascending
 * @param {number} p in [0, 1]
 * @returns {number}
 */
function quantile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * @typedef {Object} EntropySummary
 * @property {number} n       number of entropy values
 * @property {number} mean    arithmetic mean, bits/symbol
 * @property {number} sd      sample standard deviation (n − 1; 0 when n = 1)
 * @property {number} min
 * @property {number} p05     5th percentile
 * @property {number} q1      25th percentile
 * @property {number} median
 * @property {number} q3      75th percentile
 * @property {number} p95     95th percentile
 * @property {number} max
 */

/**
 * Summarise the distribution of per-value Shannon entropies (methods.md §1b, C-08). Pass one
 * entropy per non-empty parameter value (values.map(shannonEntropy)); the groups are the
 * legitimate and attack test values. Quantiles use linear interpolation. This is descriptive:
 * n values from n requests are not independent draws, and entropy depends on the value's length.
 * @param {number[]} entropies  finite entropies in bits/symbol
 * @returns {EntropySummary}
 * @throws {TypeError} if an entry is not a finite number
 * @throws {RangeError} if the array is empty
 */
export function entropySummary(entropies) {
  if (!Array.isArray(entropies)) throw new TypeError('entropies must be an array');
  if (entropies.length === 0) throw new RangeError('entropies must not be empty');
  for (const value of entropies) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('every entropy must be a finite number');
    }
  }
  const sorted = [...entropies].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const sd =
    n === 1 ? 0 : Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1));
  return {
    n,
    mean,
    sd,
    min: sorted[0],
    p05: quantile(sorted, 0.05),
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95),
    max: sorted[n - 1],
  };
}

/**
 * Area under the ROC curve of entropy as a score for "attack", i.e. the Mann–Whitney probability
 * P(H_attack > H_legitimate), with ties counted ½. No threshold is chosen, so no label is used
 * beyond forming the two groups.
 * @param {number[]} legit
 * @param {number[]} attack
 * @returns {number} in [0, 1]
 */
function mannWhitneyAuc(legit, attack) {
  /** @type {{ value: number, attack: boolean }[]} */
  const combined = [
    ...legit.map((value) => ({ value, attack: false })),
    ...attack.map((value) => ({ value, attack: true })),
  ].sort((a, b) => a.value - b.value);

  let attackRankSum = 0;
  let i = 0;
  while (i < combined.length) {
    let j = i + 1;
    while (j < combined.length && combined[j].value === combined[i].value) j += 1;
    // Ranks are 1-based: positions i+1 … j; ties share their average rank.
    const averageRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) if (combined[k].attack) attackRankSum += averageRank;
    i = j;
  }
  const nAttack = attack.length;
  return (attackRankSum - (nAttack * (nAttack + 1)) / 2) / (nAttack * legit.length);
}

/**
 * Two-sample Kolmogorov–Smirnov distance: the largest absolute gap between the empirical CDFs.
 * 0 = the two samples have the same distribution, 1 = disjoint support. It measures any
 * difference, in either direction, so it complements the directional AUC.
 * @param {number[]} legit
 * @param {number[]} attack
 * @returns {number} in [0, 1]
 */
function ksDistance(legit, attack) {
  const left = [...legit].sort((a, b) => a - b);
  const right = [...attack].sort((a, b) => a - b);
  let i = 0;
  let j = 0;
  let distance = 0;
  while (i < left.length || j < right.length) {
    const next = Math.min(
      i < left.length ? left[i] : Infinity,
      j < right.length ? right[j] : Infinity,
    );
    while (i < left.length && left[i] === next) i += 1;
    while (j < right.length && right[j] === next) j += 1;
    distance = Math.max(distance, Math.abs(i / left.length - j / right.length));
  }
  return distance;
}

/**
 * @typedef {Object} EntropySeparation
 * @property {number} auc       P(H_attack > H_legitimate), ties ½ (higher entropy = more attack-like)
 * @property {number} bestAuc   max(auc, 1 − auc): separation in the better direction
 * @property {'higher' | 'lower' | 'none'} direction  which direction separates better; 'none' at 0.5
 * @property {number} ks        two-sample Kolmogorov–Smirnov distance (direction-free)
 * @property {EntropySummary} legit
 * @property {EntropySummary} attack
 */

/**
 * Compare the entropy distributions of the legitimate and attack test values (methods.md §1b,
 * C-08): summaries, the Mann–Whitney AUC and the two-sample KS distance. Entropy has no natural
 * direction — an attack can be more random-looking (encoded payload) or more repetitive
 * ('1 OR 1=1') — so `bestAuc` reports the better of the two directions and names it. That
 * direction is chosen on the same data, so `bestAuc` is a descriptive effect size, not an
 * unbiased estimate of a classifier trained in advance; `ks` is direction-free.
 * @param {number[]} legitEntropies   one entropy per non-empty legitimate test value
 * @param {number[]} attackEntropies  one entropy per non-empty attack test value
 * @returns {EntropySeparation}
 * @throws {RangeError} if either group is empty
 */
export function entropySeparation(legitEntropies, attackEntropies) {
  if (!Array.isArray(legitEntropies) || !Array.isArray(attackEntropies)) {
    throw new TypeError('legitEntropies and attackEntropies must be arrays');
  }
  if (legitEntropies.length === 0 || attackEntropies.length === 0) {
    throw new RangeError('each group needs at least one entropy');
  }
  const auc = mannWhitneyAuc(legitEntropies, attackEntropies);
  const direction = auc > 0.5 ? 'higher' : auc < 0.5 ? 'lower' : 'none';
  return {
    auc,
    bestAuc: Math.max(auc, 1 - auc),
    direction,
    ks: ksDistance(legitEntropies, attackEntropies),
    legit: entropySummary(legitEntropies),
    attack: entropySummary(attackEntropies),
  };
}
