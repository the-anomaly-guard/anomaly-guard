// What every column of the console's tables means, in one place. shell.js gives each table
// header its explanation as a hover title, also on tables drawn later (the live replay redraws
// them): a new table only needs its column names here. Pure data and a lookup, plus two small DOM
// helpers; no page knows the texts.

/** Explanations keyed by the header text, lowercased (see `normalize`). */
export const COLUMN_HELP = Object.freeze({
  // Requests (Overview) and Security events
  '#': 'Arrival order of the request in the test split.',
  details: 'Open the row to see the request, its scores and the full record.',
  request: 'HTTP method and path of the simulated request.',
  parameters: 'The parameters of the request, as name=value (already URL-decoded).',
  level:
    'Alert level 0-15: level k means p ≤ 10^-k for the statistics; 15 means a signature matched.',
  'detected by': 'The rule that matched, or the statistical signal with the highest score.',
  verdict: 'What the detector decided at the current threshold.',
  'ground truth':
    'How the simulator generated the request: legitimate or attack, family and variant. A real ' +
    'IDS never sees it.',

  // Rules
  rule: 'Identifier of the signature.',
  family: 'Attack family the signature is written for.',
  pattern: 'Regular expression matched against every parameter value.',
  matched: 'Test requests where this rule matched at least once.',
  'on attacks': 'Of those, the requests that really were attacks.',
  'on legitimate requests': 'Of those, the legitimate requests: false alarms caused by this rule.',

  // Statistical models
  signal: 'A statistical test that turns how unusual a value is into a score s = -log10 p.',
  method: 'How the signal computes its probability p.',
  status: 'Whether the signal already counts in the score of the detector.',
  task: 'Backlog task and theme that own the signal.',
  'endpoint · parameter': 'The request path and the parameter name: one model for each pair.',
  values: 'Legitimate training values learned for this pair.',
  'mean length': 'Average length of those values, in characters.',
  sd: 'Standard deviation of the length, in characters.',
  lower: 'Share of lowercase letters a-z.',
  upper: 'Share of uppercase letters A-Z.',
  digit: 'Share of digits 0-9.',
  space: 'Share of spaces.',
  special:
    'Share of characters typical of injections: \' " ; < > ( ) = - / \\ % & | $ { } ` * # ' +
    'and control characters.',
  punct: 'Share of the other ASCII punctuation: ! + , . : ? @ [ ] ^ _ ~',
  nonascii: 'Share of non-ASCII characters: accented letters, other scripts, emoji.',

  // Detection quality
  actual: 'The truth from the simulator: attack or legitimate.',
  alert: 'Requests the detector flagged.',
  'no alert': 'Requests the detector let through.',
  rate: 'TPR on the attack row, FPR on the legitimate row, with the 95% Wilson interval.',
  variant:
    'How the request was generated: canonical, obfuscated or novel attack; typical or hard ' +
    'legitimate request.',
  requests: 'Test requests of this variant.',
  alerts: 'Of those, the requests the detector flagged.',
  share:
    'Alerts / requests: the detection rate for attacks, the false-positive rate for legitimate ' +
    'requests, with the 95% Wilson interval.',
  detector: 'The detection mode.',
  auc: 'Area under the ROC curve: the chance that a random attack scores above a random legitimate request.',
  '95% interval': 'Seeded bootstrap interval of the AUC (200 resamples of this test split).',
  'a vs b': 'The two detectors compared on the same test requests.',
  'attacks caught only by a': 'Attacks that detector A flags and detector B misses.',
  'only by b':
    'Requests that only detector B flags: attacks caught (left) or false alarms (right).',
  'false alarms only by a': 'Legitimate requests that detector A flags and detector B does not.',
  p:
    'Exact two-sided McNemar p-value: how surprising the split of the disagreements is if both ' +
    'detectors were equally good. Bold below 0.05.',
});

/**
 * The lookup key of a header: its text, lowercased, spaces collapsed.
 * @param {string} text
 */
export function normalize(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The explanation of a column, or undefined when the glossary has none.
 * @param {string} header  the text of the header cell
 */
export function helpFor(header) {
  return COLUMN_HELP[/** @type {keyof typeof COLUMN_HELP} */ (normalize(header))];
}

/**
 * Give every column header under `root` its explanation as a hover title. A header that already
 * has a title keeps it.
 * @param {ParentNode} root
 */
export function explainHeaders(root) {
  for (const th of root.querySelectorAll('thead th')) {
    if (th.hasAttribute('title')) continue;
    const help = helpFor(th.textContent ?? '');
    if (help) th.setAttribute('title', help);
  }
}

/** Explain the headers now and whenever the page draws a table again. */
export function watchHeaders() {
  explainHeaders(document);
  new MutationObserver(() => explainHeaders(document)).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
