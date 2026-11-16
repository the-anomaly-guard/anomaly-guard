// The numbers and the checked statements of the T3 chapter (evaluation and uncertainty, D-08),
// from the saved results of the experiment, docs/report/numbers.json. Every key here is a
// {{placeholder}} of docs/report/templates/t3-evaluation-and-uncertainty.<en|it>.md, and every
// claim is a sentence of the chapter that interprets the numbers. Pure.

import {
  positivePredictiveValue,
  studentTQuantile,
  wilsonInterval,
  Z_95,
} from '@anomaly-guard/evaluation';
import { MODES, bootstrapSeedFor } from '../run.js';
import { formatNumber } from '../template.js';

/** @typedef {import('../template.js').Fact} Fact */
/** @typedef {import('../template.js').Claim} Claim */

/** The prevalence of the base-rate example in §5: one request in a thousand is an attack. */
const BASE_RATE = 0.001;

const MODE_NAMES = {
  rules: { en: 'rules', it: 'regole', of: 'delle regole' },
  stats: { en: 'stats', it: 'statistica', of: 'della statistica' },
  combined: { en: 'combined', it: 'combinato', of: 'del combinato' },
};

/** Attack families (the `kind` of an attack), as the chapter names them. */
const FAMILY_NAMES = {
  cmdi: { en: 'command injection', it: 'command injection' },
  crlf: { en: 'CRLF injection', it: 'CRLF injection' },
  ldap: { en: 'LDAP injection', it: 'LDAP injection' },
  nosql: { en: 'NoSQL injection', it: 'NoSQL injection' },
  oversized: { en: 'oversized values', it: 'valori sovradimensionati' },
  sqli: { en: 'SQL injection', it: 'SQL injection' },
  template: { en: 'template injection', it: 'template injection' },
  traversal: { en: 'path traversal', it: 'path traversal' },
  xss: { en: 'XSS', it: 'XSS' },
};

/**
 * @typedef {Object} SavedNumbers  the content of docs/report/numbers.json (see numbers.js)
 * @property {{ createdAt: string, commit: string, dirty: boolean | null }} provenance
 * @property {import('../run.js').ExperimentConfig} config
 * @property {{ signals: string[], families: Record<string, 'novel' | 'targeted'>,
 *   endpoints: Record<string, string>, hardCases: number,
 *   split: Record<string, number> }} setup
 * @property {any} summary  `runExperiment(...).summary`
 */

/**
 * @param {SavedNumbers} numbers
 * @returns {{ facts: Record<string, Fact>, claims: Record<string, Claim> }}
 */
export function t3Facts({ provenance, config, setup, summary }) {
  if (config.targets.length !== 2) {
    throw new RangeError('T3: the chapter is written for two target false-positive rates');
  }
  /** @type {Record<string, Fact>} */
  const facts = {};
  /** @type {Record<string, Claim>} */
  const claims = {};
  const fact = (/** @type {string} */ key, /** @type {Fact} */ value) => {
    if (Object.hasOwn(facts, key)) throw new Error(`T3: the fact ${key} is defined twice`);
    facts[key] = value;
  };
  const claim = (
    /** @type {string} */ id,
    /** @type {unknown} */ holds,
    /** @type {string} */ says,
  ) => {
    if (Object.hasOwn(claims, id)) throw new Error(`T3: the claim ${id} is defined twice`);
    claims[id] = { holds: Boolean(holds), says };
  };
  const seedCount = config.seeds.length;

  // --- Where the numbers come from -------------------------------------------------------------
  fact('commit', code(provenance.commit.slice(0, 7)));
  const [year, month, day] = provenance.createdAt.slice(0, 10).split('-');
  fact('date', text(`${year}-${month}-${day}`, `${day}/${month}/${year}`));
  const [first, last] = [config.seeds[0], config.seeds[seedCount - 1]];
  const consecutive = config.seeds.every((seed, i) => seed === first + i);
  const seeds = consecutive ? `${first}-${last}` : config.seeds.join(', ');
  fact('seeds', text(seeds, seeds));
  fact('seedCount', int(seedCount));
  claim('cleanTree', provenance.dirty === false, 'the run had no uncommitted change to the code');
  claim(
    'lengthOnly',
    setup.signals.length === 1 && setup.signals[0] === 'length',
    `the statistical score is the length signal alone (scoreRequest parts: ${setup.signals.join(', ')})`,
  );

  // --- Design ------------------------------------------------------------------------------
  for (const [key, value] of Object.entries(setup.split)) fact(`split.${key}`, int(value));
  fact('legitShare', pct(setup.split.testLegit / setup.split.test, 0));
  const families = Object.values(setup.families);
  fact('families.all', int(families.length));
  fact('families.novel', int(families.filter((variant) => variant === 'novel').length));
  fact('hardCases', int(setup.hardCases));
  // Requests per seed of each variant: the same in every mode and at every target.
  const firstPoint = summary.modes.rules.points[0];
  for (const label of ['attack', 'legit']) {
    for (const [variant, group] of Object.entries(firstPoint.byVariant[label])) {
      fact(`perSeed.${variant}`, range('int', 0, group.requestsPerSeed));
    }
  }
  claim(
    'novelMajority',
    firstPoint.byVariant.attack.novel.requestsPerSeed.min > setup.split.testAttacks / 2,
    'novel attacks are more than half of the attacks in every seed',
  );

  // --- Methods -----------------------------------------------------------------------------
  const smallest = Math.min(...config.targets);
  claim(
    'calibrationSize',
    config.calibrationSize >= 10 / smallest - 1e-9,
    'the calibration split holds n ≥ 10/α requests for the smallest target',
  );
  const wilson = wilsonInterval(0, 900);
  fact(
    'wilsonZero',
    text(
      `[0, ${formatNumber(wilson.upper * 100, 2, 'en')}%]`,
      `[0; ${formatNumber(wilson.upper * 100, 2, 'it')}%]`,
    ),
  );
  fact('resamples', int(config.resamples));
  claim('bootstrapOffset', bootstrapSeedFor(0) === 2 ** 31, 'the bootstrap seed is seed + 2^31');
  fact('df', int(seedCount - 1));
  fact('tQuantile', dec(studentTQuantile(0.975, seedCount - 1), 3));
  const pairs = summary.comparisons[0].pairs.length;
  const groups = Object.keys(summary.comparisons[0].pairs[0].groups).length;
  const tests = pairs * groups * config.targets.length;
  fact('pairs', int(pairs));
  fact('groups', int(groups));
  fact('targetCount', int(config.targets.length));
  fact('tests', int(tests));
  fact('bonferroni', dec(0.05 / tests, 4));
  fact('prevalence', pct(config.prevalence, 0));
  fact('basePi', pct(BASE_RATE, 1));

  // --- AUC (Table 1) -----------------------------------------------------------------------
  /** sd across seeds / the standard error of one seed's bootstrap (its width / 3.92) */
  const sdOverSe = (/** @type {string} */ mode) =>
    summary.modes[mode].auc.sd / (summary.modes[mode].aucBootstrapWidth / (2 * Z_95));
  for (const mode of MODES) {
    const { auc, aucBootstrapWidth } = summary.modes[mode];
    fact(`auc.${mode}`, interval(auc, 'dec', 3));
    fact(`aucSd.${mode}`, dec(auc.sd, 3));
    fact(`aucRange.${mode}`, range('dec', 3, auc));
    fact(`aucBoot.${mode}`, dec(aucBootstrapWidth, 3));
    fact(`aucSe.${mode}`, dec(aucBootstrapWidth / (2 * Z_95), 3));
  }
  const auc = (/** @type {string} */ mode) => summary.modes[mode].auc;
  claim(
    'aucOrder',
    auc('combined').estimate > auc('stats').estimate && auc('stats').lower > auc('rules').upper,
    'AUC: combined above stats, and stats clearly above rules (intervals apart)',
  );
  for (const mode of ['rules', 'stats']) {
    const ratio = sdOverSe(mode);
    claim(
      `${mode}SdMatchesSe`,
      ratio >= 2 / 3 && ratio <= 1.5,
      `the ${mode} AUC: SD across seeds close to the bootstrap's standard error (ratio ${ratio.toFixed(2)})`,
    );
  }

  // --- Each target: operating points, variants, families, McNemar (Tables 2-4, §4-§5) ---------
  const hi = config.targets[0] > config.targets[1] ? 0 : 1;
  const at = { hi, lo: 1 - hi };
  for (const [tag, i] of Object.entries(at)) {
    const target = config.targets[i];
    fact(`${tag}.target`, pct(target, decimalsOf(target * 100)));
    const point = (/** @type {string} */ mode) => summary.modes[mode].points[i];
    for (const mode of MODES) {
      const p = point(mode);
      if (mode !== 'rules') fact(`${tag}.threshold.${mode}`, interval(p.threshold, 'dec', 3));
      fact(`${tag}.calFpr.${mode}`, interval(p.calibrationFpr, 'pct', 2));
      fact(`${tag}.fpr.${mode}`, interval(p.fpr, 'pct', 2));
      fact(`${tag}.fprSd.${mode}`, pct(p.fpr.sd, 2));
      fact(`${tag}.fprMin.${mode}`, pct(p.fpr.min, 2));
      fact(`${tag}.fprMax.${mode}`, pct(p.fpr.max, 2));
      fact(`${tag}.tpr.${mode}`, interval(p.tpr, 'pct', 1));
      fact(
        `${tag}.precision.${mode}`,
        p.precision ? interval(p.precision, 'pct', 1) : text('-', '-'),
      );
      fact(
        `${tag}.met.${mode}`,
        text(`${p.attainableSeeds}/${seedCount}`, `${p.attainableSeeds}/${seedCount}`),
      );
      fact(`${tag}.pooledFp.${mode}`, int(p.pooled.fp));
      for (const label of ['attack', 'legit']) {
        for (const [variant, group] of Object.entries(p.byVariant[label])) {
          if (group.rate) {
            fact(
              `${tag}.variant.${mode}.${variant}`,
              interval(group.rate, 'pct', variant === 'typical' ? 2 : 1),
            );
          }
        }
      }
      for (const [family, group] of Object.entries(p.byKind.attack)) {
        if (group.rate) fact(`${tag}.kind.${mode}.${family}`, interval(group.rate, 'pct', 1));
      }
      if (mode !== 'rules') {
        const ppv = positivePredictiveValue(p.tpr.estimate, p.fpr.estimate, BASE_RATE);
        fact(`${tag}.ppv.${mode}`, pct(ppv, 1));
        if (mode === 'combined') fact(`${tag}.falsePer100`, int(Math.round(100 * (1 - ppv))));
      }
    }

    const rules = point('rules');
    const stats = point('stats');
    // The families the statistics catch least and most.
    const caught = Object.entries(stats.byKind.attack).filter(([, g]) => g.rate);
    const [lowFamily, low] = caught.reduce((a, b) =>
      b[1].rate.estimate < a[1].rate.estimate ? b : a,
    );
    const [highFamily, high] = caught.reduce((a, b) =>
      b[1].rate.estimate > a[1].rate.estimate ? b : a,
    );
    fact(`${tag}.statsKindMin`, pct(low.rate.estimate, 1));
    fact(`${tag}.statsKindMinName`, familyName(lowFamily));
    fact(`${tag}.statsKindMax`, pct(high.rate.estimate, 1));
    fact(`${tag}.statsKindMaxName`, familyName(highFamily));
    // Where the statistics' false alarms come from, by endpoint (its path, as code).
    const endpoint = (/** @type {string} */ kind) => `\`${setup.endpoints[kind] ?? `/${kind}`}\``;
    const endpoints = Object.entries(stats.byKind.legit);
    const [topKind, top] = endpoints.reduce((a, b) => (b[1].flagged > a[1].flagged ? b : a));
    const share = stats.pooled.fp > 0 ? top.flagged / stats.pooled.fp : 0;
    fact(`${tag}.topFp.name`, text(endpoint(topKind), endpoint(topKind)));
    fact(`${tag}.topFp.share`, pct(share, 0));
    fact(`${tag}.topFp.rate`, top.rate ? pct(top.rate.estimate, 1) : pct(0, 1));
    claim(
      `${tag}FpMostlyTop`,
      share > 0.5,
      `most of the stats false alarms come from ${endpoint(topKind)}`,
    );
    const silent = endpoints.filter(([, g]) => g.flagged === 0).map(([kind]) => endpoint(kind));
    fact(`${tag}.zeroFp.names`, text(joinList(silent, 'en'), joinList(silent, 'it')));
    claim(
      `${tag}FpSomeZero`,
      silent.length > 0,
      'some endpoint never raises a false alarm of the stats',
    );
    // Hard cases.
    const hard = stats.byVariant.legit.hard?.rate;
    fact(`${tag}.hardOneIn`, int(hard && hard.estimate > 0 ? Math.round(1 / hard.estimate) : 0));
    claim(`${tag}HardFlagged`, hard && hard.estimate > 0, 'the stats flag some hard cases');
    claim(
      `${tag}NoHard`,
      hard && hard.sd === 0 && hard.estimate === 0,
      'the stats flag no hard case, in every seed',
    );
    // Canonical attacks: the statistics against the rules.
    const statsCanonical = stats.byVariant.attack.canonical.rate.estimate;
    const rulesCanonical = rules.byVariant.attack.canonical.rate.estimate;
    fact(`${tag}.statsMissCanonical`, pct(1 - statsCanonical, 1));
    claim(
      `${tag}StatsMissCanonical`,
      statsCanonical < rulesCanonical,
      'the stats miss canonical attacks the rules catch',
    );
    claim(
      `${tag}AllMet`,
      MODES.every((mode) => point(mode).attainableSeeds === seedCount),
      'every mode meets the target in every seed',
    );

    // McNemar: {{hi.cmp.statsCombined.attack.b}} and so on.
    for (const { modes, groups: byGroup } of summary.comparisons[i].pairs) {
      const pair = `${modes[0]}${modes[1][0].toUpperCase()}${modes[1].slice(1)}`;
      for (const [group, result] of Object.entries(byGroup)) {
        const key = `${tag}.cmp.${pair}.${group}`;
        fact(`${key}.a`, int(result.onlyA));
        fact(`${key}.b`, int(result.onlyB));
        fact(`${key}.p`, { kind: 'p', value: result.exactP });
        fact(`${key}.seeds`, seedsAhead(group, modes, result));
        const more = Math.max(result.seedsMoreA, result.seedsMoreB);
        fact(
          `${key}.inSeeds`,
          more === seedCount
            ? text(`in all ${seedCount} seeds`, `in tutti i ${seedCount} seed`)
            : text(`in ${more} of the ${seedCount} seeds`, `in ${more} seed su ${seedCount}`),
        );
      }
    }
    const cmp = (/** @type {string} */ a, /** @type {string} */ b) =>
      summary.comparisons[i].pairs.find(
        (/** @type {any} */ x) => x.modes[0] === a && x.modes[1] === b,
      )?.groups;
    const statsCombined = cmp('stats', 'combined');
    const rulesStats = cmp('rules', 'stats');
    const same = (/** @type {any} */ g) => g.onlyA === 0 && g.onlyB === 0;
    claim(
      `${tag}SameFalseAlarms`,
      same(statsCombined.legit),
      'stats and combined raise the same false alarms',
    );
    claim(
      `${tag}SameNovel`,
      same(statsCombined.novel),
      'stats and combined catch the same novel attacks',
    );
    claim(
      `${tag}BothMiss`,
      rulesStats.attack.onlyA > 0 && rulesStats.attack.onlyB > 0,
      'the rules and the stats each catch attacks the other misses',
    );
  }

  // --- Statements across the two targets, and the rules alone --------------------------------
  const point = (/** @type {string} */ mode, /** @type {number} */ i) =>
    summary.modes[mode].points[i];
  const rulesHi = point('rules', hi);
  const constant = (/** @type {any} */ rate, /** @type {number} */ value) =>
    Boolean(rate) && rate.sd === 0 && rate.estimate === value;
  fact('legitTested', int(rulesHi.pooled.fp + rulesHi.pooled.tn));
  claim(
    'rulesNoFalseAlarms',
    [hi, 1 - hi].every((i) => point('rules', i).pooled.fp === 0),
    'the rules raise no false alarm',
  );
  claim(
    'rulesCmdiAll',
    constant(rulesHi.byKind.attack.cmdi?.rate, 1),
    'the rules catch every command injection, in every seed',
  );
  claim(
    'rulesMostTargeted',
    ['sqli', 'xss', 'traversal'].every(
      (family) => rulesHi.byKind.attack[family]?.rate?.estimate > 0.5,
    ),
    'the rules catch most SQL injection, XSS and traversal',
  );
  claim(
    'rulesNoNovel',
    constant(rulesHi.byVariant.attack.novel?.rate, 0),
    'the rules catch no novel attack',
  );
  claim(
    'rulesAllCanonical',
    constant(rulesHi.byVariant.attack.canonical?.rate, 1),
    'the rules catch every canonical attack',
  );
  const statsHi = point('stats', hi);
  const statsLo = point('stats', 1 - hi);
  claim(
    'loTradeOff',
    statsLo.tpr.estimate < statsHi.tpr.estimate &&
      (statsLo.precision?.estimate ?? 0) > (statsHi.precision?.estimate ?? 1),
    'at the stricter target the stats catch less, with a higher precision',
  );
  claim(
    'typicalWithinTarget',
    [hi, 1 - hi].every(
      (i) => point('stats', i).byVariant.legit.typical.rate.estimate <= 1.1 * config.targets[i],
    ),
    'on typical legitimate requests the stats keep to each target (at most 1.1 times it)',
  );
  claim(
    'fprMoves',
    statsHi.fpr.estimate > 0 && statsHi.fpr.sd / statsHi.fpr.estimate > 0.2,
    'the test FPR of the stats moves from seed to seed (SD above a fifth of the mean)',
  );

  // Table 4 shows stats vs combined and rules vs stats, at the looser target.
  const table4 = summary.comparisons[hi].pairs
    .filter((/** @type {any} */ x) => x.modes.join() !== 'rules,combined')
    .flatMap((/** @type {any} */ x) => Object.values(x.groups));
  const equal = table4.filter((/** @type {any} */ g) => g.exactP === 1).length;
  claim(
    'table4Extremes',
    equal > 0 && table4.every((/** @type {any} */ g) => g.exactP < 0.001 || g.exactP === 1),
    'every row of Table 4 has p < 0.001 or p = 1, and some row has p = 1',
  );
  fact(
    'table4EqualRows',
    equal === 1
      ? text(
          'the row with p = 1.000 is not a difference at all',
          'quella con p = 1,000 non è affatto una differenza',
        )
      : text(
          `the ${wordsOf(equal, 'en')} rows with p = 1.000 are not differences at all`,
          `le ${wordsOf(equal, 'it')} con p = 1,000 non sono affatto differenze`,
        ),
  );

  return { facts, claims };
}

/** @param {number} value @returns {Fact} */
function int(value) {
  return { kind: 'int', value };
}
/** @param {number} value @param {number} digits @returns {Fact} */
function dec(value, digits) {
  return { kind: 'dec', value, digits };
}
/** @param {number} value @param {number} digits @returns {Fact} */
function pct(value, digits) {
  return { kind: 'pct', value, digits };
}
/** @param {string} en @param {string} it @returns {Fact} */
function text(en, it) {
  return { kind: 'text', en, it };
}
/** @param {string} value @returns {Fact} */
function code(value) {
  return { kind: 'code', value };
}
/**
 * @param {{ estimate: number, lower: number, upper: number, sd: number }} i  from meanInterval
 * @param {'dec' | 'pct'} of
 * @param {number} digits
 * @returns {Fact}
 */
function interval({ estimate, lower, upper, sd }, of, digits) {
  return { kind: 'interval', of, digits, estimate, lower, upper, sd };
}
/**
 * @param {'int' | 'dec' | 'pct'} of
 * @param {number} digits
 * @param {{ min: number, max: number }} span
 * @returns {Fact}
 */
function range(of, digits, { min, max }) {
  return { kind: 'range', of, digits, min, max };
}

/** Fewest decimals that write x exactly (at most 3): 1 -> 0, 0.1 -> 1. @param {number} x */
function decimalsOf(x) {
  for (let d = 0; d < 3; d++) if (Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) < 1e-9) return d;
  return 3;
}

/** @param {string} family @returns {Fact} */
function familyName(family) {
  const name = FAMILY_NAMES[/** @type {keyof typeof FAMILY_NAMES} */ (family)];
  return name ? text(name.en, name.it) : text(family, family);
}

/** @param {number} n @param {'en' | 'it'} locale */
function wordsOf(n, locale) {
  const words = {
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six'],
    it: ['zero', 'una', 'due', 'tre', 'quattro', 'cinque', 'sei'],
  };
  return words[locale][n] ?? String(n);
}

/**
 * "a, b and c" / "a, b e c".
 * @param {string[]} items
 * @param {'en' | 'it'} locale
 */
function joinList(items, locale) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')}${locale === 'it' ? ' e ' : ' and '}${items.at(-1)}`;
}

/**
 * The last column of Table 4: in how many seeds one mode flagged significantly more.
 * @param {string} group  attack, novel or legit
 * @param {string[]} modes  [A, B]
 * @param {{ seedsMoreA: number, seedsMoreB: number }} result
 * @returns {Fact}
 */
function seedsAhead(group, [a, b], { seedsMoreA, seedsMoreB }) {
  const one = (/** @type {string} */ mode, /** @type {number} */ n) => {
    const name = MODE_NAMES[/** @type {keyof typeof MODE_NAMES} */ (mode)];
    return group === 'legit'
      ? { en: `${name.en} more alarms in ${n}`, it: `più allarmi ${name.of} in ${n}` }
      : { en: `${name.en} ahead in ${n}`, it: `${name.it} avanti in ${n}` };
  };
  if (!seedsMoreA && !seedsMoreB) return text('none', 'nessuno');
  if (seedsMoreA && seedsMoreB) {
    const [x, y] = [one(a, seedsMoreA), one(b, seedsMoreB)];
    return text(`${x.en}, ${y.en}`, `${x.it}, ${y.it}`);
  }
  const only = seedsMoreA ? one(a, seedsMoreA) : one(b, seedsMoreB);
  return text(only.en, only.it);
}
