// Chapters with generated numbers (D-08, ADR-014). A chapter of the report is written once, as a
// template in docs/report/templates/, and each of its numbers is a placeholder filled from the
// saved results of the experiment. When a formula changes, `npm run report -- --update` runs the
// experiment again and the text follows. Each statement that interprets the numbers carries a
// claim, checked against them: a sentence the numbers no longer support is marked, never
// silently kept. Pure: strings in, strings out.
//
// In a template:
//   {{key}}              a fact of the chapter, written in the template's language
//   {{key:mod:mod}}      the same, changed by modifiers (a colon, never "|", which splits a
//                        Markdown table cell):
//     mean               an interval as its mean only
//     0 1 2 3 4          that many decimals (an interval: its mean only)
//     words  Words       a count up to twenty in words, or capitalised: five, Five / cinque, Cinque
//     a                  English article: "a 1%", "an 8%"
//     il del al dal nel sul    Italian article: "il 59%", "l'84%", "lo 0%", "dell'1%", "dello 0,1%"
//   <!-- claim: id -->   after a sentence: the sentence is true only while the claim holds

/** @typedef {'en' | 'it'} Locale */

/**
 * One value of a chapter, with how to write it.
 * - `int`: a count. `dec`, `pct`: a number, a share in [0, 1] written as a percentage.
 * - `interval`: a mean across seeds with its 95% interval (`meanInterval`), `of` dec or pct.
 * - `range`: min-max across seeds. `p`: a p-value. `text`: words in each language. `code`: as is.
 * @typedef {{ kind: 'int', value: number }
 *   | { kind: 'dec', value: number, digits: number }
 *   | { kind: 'pct', value: number, digits: number }
 *   | { kind: 'interval', of: 'dec' | 'pct', digits: number, estimate: number, lower: number,
 *       upper: number, sd: number }
 *   | { kind: 'range', of: 'int' | 'dec' | 'pct', digits: number, min: number, max: number }
 *   | { kind: 'p', value: number }
 *   | { kind: 'text', en: string, it: string }
 *   | { kind: 'code', value: string }} Fact
 */

/**
 * A statement of the chapter, checked against the numbers. `says` explains it to whoever has to
 * rewrite the sentence when it stops holding.
 * @typedef {{ holds: boolean, says: string }} Claim
 */

export const LOCALES = Object.freeze(/** @type {Locale[]} */ (['en', 'it']));
const INTL = { en: 'en-US', it: 'it-IT' };

const WORDS = {
  en: 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty',
  it: 'zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove venti',
};

/** "(every seed)": a value that was the same in every seed, so its interval has no width. */
const EVERY_SEED = { en: '(every seed)', it: '(in ogni seed)' };

/** Italian article and preposition, by the first sound of the number: consonant, vowel, z. */
const ITALIAN = {
  il: ['il', "l'", 'lo'],
  del: ['del', "dell'", 'dello'],
  al: ['al', "all'", 'allo'],
  dal: ['dal', "dall'", 'dallo'],
  nel: ['nel', "nell'", 'nello'],
  sul: ['sul', "sull'", 'sullo'],
};

/**
 * A number in a language: thousands grouped (1,643 / 1.643, also with four digits), a fixed
 * number of decimals.
 * @param {number} value
 * @param {number} digits
 * @param {Locale} locale
 */
export function formatNumber(value, digits, locale) {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite number: ${value}`);
  return new Intl.NumberFormat(INTL[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: 'always',
  }).format(value || 0); // || 0: never "-0"
}

/**
 * A count in words, up to twenty; digits beyond.
 * @param {number} n
 * @param {Locale} locale
 */
export function countWords(n, locale) {
  const words = WORDS[locale].split(' ');
  return Number.isInteger(n) && n >= 0 && n < words.length ? words[n] : formatNumber(n, 0, locale);
}

/**
 * Whether the English name of a whole number starts with a vowel sound: eight, eleven,
 * eighteen, eighty-..., eight hundred..., eight thousand...
 * @param {number} n  a whole number ≥ 0
 */
function englishVowel(n) {
  while (n >= 1000) n = Math.floor(n / 1000);
  if (n >= 100) n = Math.floor(n / 100);
  return n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89);
}

/**
 * The first sound of the Italian name of a whole number: 'z' for zero (lo), 'v' for a vowel
 * (uno, otto, undici, ottanta..., ottocento..., ottomila...: l'), 'c' otherwise (il).
 * @param {number} n  a whole number ≥ 0
 * @returns {'z' | 'v' | 'c'}
 */
function italianSound(n) {
  if (n === 0) return 'z';
  if (n >= 1e6) return italianSound(Math.floor(n / 1e6));
  if (n >= 1000) return Math.floor(n / 1000) === 1 ? 'c' : italianSound(Math.floor(n / 1000)); // mille
  if (n >= 100) return Math.floor(n / 100) === 1 ? 'c' : italianSound(Math.floor(n / 100)); // cento
  return n === 1 || n === 8 || n === 11 || (n >= 80 && n <= 89) ? 'v' : 'c';
}

/**
 * Write a fact in a language, changed by the modifiers of its placeholder.
 * @param {Fact} fact
 * @param {Locale} locale
 * @param {string[]} [modifiers]
 * @returns {string}
 */
export function formatFact(fact, locale, modifiers = []) {
  if (!INTL[locale]) throw new RangeError(`unknown language: ${locale}`);
  /** @type {number | undefined} */
  let digits;
  let meanOnly = false;
  let words = /** @type {'' | 'words' | 'Words'} */ ('');
  /** @type {string | undefined} */
  let article;
  for (const mod of modifiers) {
    if (/^[0-4]$/.test(mod)) {
      digits = Number(mod);
      meanOnly = true;
    } else if (mod === 'mean') meanOnly = true;
    else if (mod === 'words' || mod === 'Words') words = mod;
    else if (mod === 'a' && locale === 'en') article = mod;
    else if (mod in ITALIAN && locale === 'it') article = mod;
    else throw new RangeError(`unknown modifier "${mod}" in ${locale}`);
  }

  // The text, and the number an article depends on (the integer part of what is written).
  let text;
  /** @type {number | undefined} */
  let spoken;
  const pctText = (/** @type {number} */ share, /** @type {number} */ d) => {
    const written = formatNumber(share * 100, d, locale);
    return {
      written: `${written}%`,
      whole: Math.trunc(Math.round(share * 100 * 10 ** d) / 10 ** d),
    };
  };
  switch (fact.kind) {
    case 'int': {
      text = words ? countWords(fact.value, locale) : formatNumber(fact.value, 0, locale);
      if (words === 'Words') text = text[0].toUpperCase() + text.slice(1);
      spoken = fact.value;
      break;
    }
    case 'dec': {
      const d = digits ?? fact.digits;
      text = formatNumber(fact.value, d, locale);
      spoken = Math.trunc(fact.value);
      break;
    }
    case 'pct': {
      const { written, whole } = pctText(fact.value, digits ?? fact.digits);
      text = written;
      spoken = whole;
      break;
    }
    case 'interval': {
      const constant = fact.sd === 0 && fact.lower === fact.upper;
      const exact = fact.of === 'pct' && (fact.estimate === 0 || fact.estimate === 1);
      const d = digits ?? (constant && exact ? 0 : fact.digits);
      const write = (/** @type {number} */ x) =>
        fact.of === 'pct' ? formatNumber(x * 100, d, locale) : formatNumber(x, d, locale);
      const unit = fact.of === 'pct' ? '%' : '';
      const mean = `${write(fact.estimate)}${unit}`;
      if (meanOnly) text = mean;
      else if (constant) text = `${mean} ${EVERY_SEED[locale]}`;
      else text = `${mean} [${write(fact.lower)}-${write(fact.upper)}]`;
      spoken =
        fact.of === 'pct' ? pctText(fact.estimate, d).whole : Math.trunc(Number(fact.estimate));
      break;
    }
    case 'range': {
      const d = fact.of === 'int' ? 0 : (digits ?? fact.digits);
      const write = (/** @type {number} */ x) =>
        fact.of === 'pct' ? formatNumber(x * 100, d, locale) : formatNumber(x, d, locale);
      const unit = fact.of === 'pct' ? '%' : '';
      text =
        fact.min === fact.max
          ? `${write(fact.min)}${unit}`
          : `${write(fact.min)}-${write(fact.max)}${unit}`;
      spoken = Math.trunc(fact.of === 'pct' ? fact.min * 100 : fact.min);
      break;
    }
    case 'p': {
      text =
        fact.value < 0.001
          ? `< ${formatNumber(0.001, 3, locale)}`
          : formatNumber(Math.min(1, fact.value), 3, locale);
      break;
    }
    case 'text':
      text = fact[locale];
      break;
    case 'code':
      text = fact.value;
      break;
    default:
      throw new TypeError(`unknown kind of fact: ${JSON.stringify(fact)}`);
  }
  if (typeof text !== 'string') throw new TypeError(`no text for ${JSON.stringify(fact)}`);
  if (words && fact.kind !== 'int') throw new RangeError('words: only for a count');
  if (article) {
    if (spoken === undefined) throw new RangeError(`no article for a ${fact.kind}`);
    if (article === 'a') return `${englishVowel(spoken) ? 'an' : 'a'} ${text}`;
    const form =
      ITALIAN[/** @type {keyof typeof ITALIAN} */ (article)][
        { c: 0, v: 1, z: 2 }[italianSound(spoken)]
      ];
    return form.endsWith("'") ? `${form}${text}` : `${form} ${text}`;
  }
  return text;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9.]*)((?::[A-Za-z0-9]+)*)\s*\}\}/g;
const CLAIM = /<!--\s*claim:\s*([A-Za-z][A-Za-z0-9.]*)\s*-->/g;

/** How a sentence that the numbers no longer support is marked, in place and on top. */
const OUTDATED = {
  en: {
    mark: (/** @type {string} */ id) =>
      `**[To rewrite: the numbers no longer support this sentence (claim ${id}).]**`,
    note: (/** @type {number} */ n) =>
      `> **To rewrite:** ${n === 1 ? 'one sentence no longer matches' : `${countWords(n, 'en')} sentences no longer match`} the numbers; ${n === 1 ? 'it is' : 'they are'} marked below.`,
  },
  it: {
    mark: (/** @type {string} */ id) =>
      `**[Da riscrivere: i numeri non sostengono più questa frase (claim ${id}).]**`,
    note: (/** @type {number} */ n) =>
      `> **Da riscrivere:** ${n === 1 ? 'una frase non corrisponde' : `${countWords(n, 'it')} frasi non corrispondono`} più ai numeri; ${n === 1 ? 'è segnata' : 'sono segnate'} più sotto.`,
  },
};

/**
 * Fill a template: every placeholder with its fact, every claim checked. An unknown fact, claim
 * or modifier is an error, not a blank: a typo must not reach the report.
 * @param {string} template  Markdown with {{placeholders}} and <!-- claim: id --> markers
 * @param {{ facts: Record<string, Fact>, claims: Record<string, Claim>, locale: Locale,
 *   name?: string }} chapter  `name` only labels the errors
 * @returns {{ text: string, facts: Set<string>, claims: Set<string>, outdated: string[] }}
 *   the Markdown; the facts and claims used; the claims that no longer hold
 */
export function renderTemplate(template, { facts, claims, locale, name = 'template' }) {
  const usedFacts = new Set();
  const usedClaims = new Set();
  /** @type {string[]} */
  const outdated = [];
  let text = template.replace(PLACEHOLDER, (_, key, mods) => {
    const fact = Object.hasOwn(facts, key) ? facts[key] : undefined;
    if (!fact) throw new RangeError(`${name}: unknown fact {{${key}}}`);
    usedFacts.add(key);
    try {
      return formatFact(fact, locale, mods ? mods.slice(1).split(':') : []);
    } catch (error) {
      throw new RangeError(`${name}: {{${key}${mods}}}: ${error.message}`);
    }
  });
  text = text.replace(CLAIM, (_, id) => {
    const claim = Object.hasOwn(claims, id) ? claims[id] : undefined;
    if (!claim) throw new RangeError(`${name}: unknown claim "${id}"`);
    usedClaims.add(id);
    if (claim.holds) return '';
    if (!outdated.includes(id)) outdated.push(id);
    return ` ${OUTDATED[locale].mark(id)}`;
  });
  const leftover = /\{\{|\}\}|<!--\s*claim/.exec(text);
  if (leftover) {
    const line = text.slice(0, leftover.index).split('\n').length;
    throw new SyntaxError(`${name}: malformed placeholder or claim on line ${line}`);
  }
  if (outdated.length > 0) {
    // The note goes right under the title, so nobody reads the chapter without seeing it.
    const heading = /^# .*\n/m.exec(text);
    const at = heading ? heading.index + heading[0].length : 0;
    text = `${text.slice(0, at)}\n${OUTDATED[locale].note(outdated.length)}\n${text.slice(at)}`;
  }
  return { text, facts: usedFacts, claims: usedClaims, outdated };
}
