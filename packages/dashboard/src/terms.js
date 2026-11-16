// Hover help for the acronyms and codes the console shows: rule ids (CMDI-001), attack families
// (sqli), backlog tasks (C-06) and themes (T1), decision records (ADR-009) and metric acronyms
// (AUC, FPR). One dictionary, built from the sources themselves (the ruleset, the backlog, the
// ADR index), so a new rule, task or ADR is explained with no change to the pages. term-help.js
// puts it on the text of every page, charts.js on every chart. Pure: no DOM, tested in Node.

/** Acronyms of the console's own text: add one here and every page and chart explains it. */
export const ACRONYMS = Object.freeze({
  ACM: 'Association for Computing Machinery.',
  ADR: 'architecture decision record, a design choice of the project and the reasons for it.',
  AUC:
    'area under the ROC curve, the chance that a random attack scores higher than a random ' +
    'legitimate request (0.5 is chance, 1 is perfect).',
  CCS: 'the ACM Conference on Computer and Communications Security.',
  CI: 'confidence interval, a range built to contain the true value in 95% of repeated experiments.',
  FNR: 'false-negative rate, the share of attacks that raise no alert.',
  FPR: 'false-positive rate, the share of legitimate requests that raise an alert.',
  IDS: 'intrusion detection system, which watches requests and raises an alert on suspicious ones.',
  IQR: 'interquartile range, the spread of the middle half of the values (Q3 - Q1).',
  JSON: "JavaScript Object Notation, the request and the detector's result as plain data.",
  MAD: 'median absolute deviation, a spread that a few extreme values cannot inflate.',
  MIT: 'the MIT licence: anyone may use, copy and change the code, keeping the copyright notice.',
  PPV: 'positive predictive value (precision), the share of alerts that are real attacks.',
  ROC:
    'receiver operating characteristic, the true-positive rate against the false-positive rate ' +
    'as the threshold moves.',
  SD: 'standard deviation, the typical distance of a value from the mean.',
  TNR: 'true-negative rate, the share of legitimate requests that raise no alert.',
  TPR: 'true-positive rate (recall), the share of attacks that raise an alert.',
  XSS: 'cross-site scripting, a script smuggled into a web page.',
});

/** The attack families of the ruleset (`kind` in core/rules), by their code: name, and what it is. */
export const FAMILIES = Object.freeze({
  sqli: ['SQL injection', 'database commands smuggled into a value'],
  xss: ['cross-site scripting', 'a script smuggled into a web page'],
  traversal: ['path traversal', 'a file path that climbs out of the web folder'],
  cmdi: ['command injection', 'a shell command smuggled into a value'],
});

/** Codes that follow a pattern: explained even when no source lists them (yet). */
const PATTERNS = [
  {
    re: /^ADR-(\d{3})$/,
    help: (/** @type {RegExpExecArray} */ m) =>
      `ADR-${m[1]}: architecture decision record no. ${Number(m[1])}, in docs/development/adr.`,
  },
  {
    re: /^([A-Z])-(\d{2})$/,
    help: (/** @type {RegExpExecArray} */ m) =>
      `${m[0]}: a task of the project's backlog (docs/planning/backlog.md).`,
  },
];

/**
 * The explanation of a rule id, from the rule itself: its family and its number.
 * @param {{ id: string, kind: string }} rule
 */
export function ruleHelp({ id, kind }) {
  const [prefix, number] = id.split('-');
  const family = FAMILIES[/** @type {keyof typeof FAMILIES} */ (kind)];
  const name = family ? family[0] : `the "${kind}" family`;
  const which = number ? `signature ${number}` : 'a signature';
  return (
    `${id}: ${which} for ${name} (${prefix}), a rule that recognises a known form of attack. ` +
    'Its pattern is on the Rules page.'
  );
}

/**
 * Markdown to plain text, for a tooltip: no emphasis, code marks or link targets.
 * @param {string} text
 */
export function plain(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * At most `max` characters, cut at a word.
 * @param {string} text
 * @param {number} max
 */
export function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}...`;
}

/**
 * Tasks and themes of the backlog (docs/planning/backlog.md): "C-06" -> its task, theme and
 * status; "T1" -> the theme's title. Member names are left out: public pages name nobody.
 * @param {string} markdown
 * @returns {Record<string, string>}
 */
export function backlogTerms(markdown) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @type {string[] | null} */
  let columns = null;
  for (const line of markdown.split('\n')) {
    const cells = /^\|(.*)\|\s*$/
      .exec(line)?.[1]
      .split('|')
      .map((cell) => plain(cell));
    if (!cells) {
      columns = null;
      const theme = /^\*\*(T\d+) - (.+?)\*\*/.exec(line);
      if (theme) out[theme[1]] = `${theme[1]}: the statistical theme "${plain(theme[2])}".`;
      continue;
    }
    if (cells[0] === 'ID') {
      columns = cells.map((cell) => cell.toLowerCase());
      continue;
    }
    if (!columns || !/^[A-Z]-\d{2}$/.test(cells[0])) continue;
    const field = (/** @type {string} */ name) => cells[columns?.indexOf(name) ?? -1] ?? '';
    const theme = field('theme');
    const status = field('status');
    const owner = theme && !/^(-|shared|anyone|all)$/.test(theme) ? ` of ${theme}` : '';
    out[cells[0]] =
      `${cells[0]}: backlog task${owner}${status ? `, ${status}` : ''}. ` +
      shorten(field('task'), 180);
  }
  return out;
}

/**
 * Decision records of the ADR index (docs/development/adr/README.md): "ADR-009" -> its title and
 * status.
 * @param {string} markdown
 * @returns {Record<string, string>}
 */
export function adrTerms(markdown) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of markdown.split('\n')) {
    const row = /^\|\s*\[(ADR-\d{3})\]\([^)]*\)\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (row) {
      out[row[1]] =
        `${row[1]}: architecture decision record, ${plain(row[3]).toLowerCase()}. ` +
        `${plain(row[2])}.`;
    }
  }
  return out;
}

/**
 * The whole dictionary: acronyms, attack families and rule ids from the ruleset, and what the
 * docs list (backlogTerms, adrTerms).
 * @param {{ rules?: { id: string, kind: string }[], docs?: Record<string, string> }} sources
 * @returns {Map<string, string>}
 */
export function buildTerms({ rules = [], docs = {} } = {}) {
  /** @type {Map<string, string>} */
  const terms = new Map();
  for (const [term, help] of Object.entries(ACRONYMS)) terms.set(term, `${term}: ${help}`);
  for (const [code, [name, what]] of Object.entries(FAMILIES)) {
    terms.set(code, `${code}: ${name}, ${what}.`);
  }
  for (const rule of rules) {
    terms.set(rule.id, ruleHelp(rule));
    if (!terms.has(rule.kind)) terms.set(rule.kind, `${rule.kind}: an attack family of the rules.`);
  }
  for (const [term, help] of Object.entries(docs)) terms.set(term, help);
  return terms;
}

/** @type {WeakMap<Map<string, string>, RegExp>} */
const patterns = new WeakMap();

/**
 * One expression for every term of a dictionary, plus the code patterns, matched as whole words.
 * @param {Map<string, string>} terms
 */
function termPattern(terms) {
  let re = patterns.get(terms);
  if (!re) {
    const words = [...terms.keys()]
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    re = new RegExp(
      `(?<![\\w-])(?:${[...words, 'ADR-\\d{3}', '[A-Z]-\\d{2}'].join('|')})(?![\\w-])`,
      'g',
    );
    patterns.set(terms, re);
  }
  return re;
}

/**
 * The explanation of one term or code, or null.
 * @param {string} term
 * @param {Map<string, string>} terms
 */
export function explain(term, terms) {
  const known = terms.get(term);
  if (known) return known;
  for (const { re, help } of PATTERNS) {
    const m = re.exec(term);
    if (m) return help(m);
  }
  return null;
}

/**
 * The terms in a text, in order, each with its explanation.
 * @param {string} text
 * @param {Map<string, string>} terms
 * @returns {{ index: number, term: string, help: string }[]}
 */
export function findTerms(text, terms) {
  const out = [];
  for (const m of text.matchAll(termPattern(terms))) {
    const help = explain(m[0], terms);
    if (help) out.push({ index: m.index ?? 0, term: m[0], help });
  }
  return out;
}

/**
 * Lines of at most `width` characters, cut between words: a chart tooltip does not wrap.
 * @param {string} text
 * @param {number} width
 */
export function wrapLines(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
