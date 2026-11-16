import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_RULES } from '@anomaly-guard/core';
import {
  ACRONYMS,
  FAMILIES,
  adrTerms,
  buildTerms,
  explain,
  findTerms,
  plain,
  wrapLines,
} from '../src/terms.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const adrIndex = read('../../../docs/development/adr/README.md');
// What the dashboard bundles (vite.config.js, virtual:term-sources), from the real index.
const docs = adrTerms(adrIndex);
const TERMS = buildTerms({ rules: DEFAULT_RULES, docs });

test('every rule of the ruleset explains itself: its family and its number', () => {
  for (const rule of DEFAULT_RULES) {
    const help = TERMS.get(rule.id);
    assert.ok(help, rule.id);
    assert.ok(help.startsWith(`${rule.id}: signature ${rule.id.split('-')[1]} for `), help);
    assert.ok(help.includes(FAMILIES[rule.kind]?.[0] ?? rule.kind), help);
    assert.ok(TERMS.has(rule.kind), `the family code ${rule.kind}`);
  }
  // a rule added later, of a family not listed yet, is explained all the same
  const later = buildTerms({ rules: [{ id: 'SSTI-001', kind: 'ssti' }] });
  assert.match(later.get('SSTI-001'), /^SSTI-001: signature 001 for the "ssti" family \(SSTI\)/);
  assert.match(later.get('ssti'), /an attack family/);
});

test('every ADR of the index explains itself', () => {
  const adrs = [...adrIndex.matchAll(/^\|\s*\[(ADR-\d{3})\]/gm)].map((m) => m[1]);
  assert.ok(adrs.length >= 14);
  for (const id of adrs) {
    assert.match(docs[id], new RegExp(`^${id}: architecture decision record, `));
    assert.ok(!docs[id].includes('**') && !docs[id].includes('`'), `${id}: plain text`);
  }
});

test('task codes and themes get no hover help, wherever they appear', () => {
  // The group's bookkeeping (the Task column of Statistical models, the chart placeholders):
  // every task of the backlog, the four themes, and codes of tasks not written yet.
  const backlog = read('../../../docs/planning/backlog.md');
  const tasks = [...backlog.matchAll(/^\|\s*([A-Z]-\d{2})\s*\|/gm)].map((m) => m[1]);
  assert.ok(tasks.length > 30, `${tasks.length} tasks`);
  for (const code of [...tasks, 'T1', 'T2', 'T3', 'T4', 'C-99', 'Z-01']) {
    assert.equal(explain(code, TERMS), null, code);
  }
  assert.deepEqual(findTerms('C-04 · T2, E-02 · T1, task · theme', TERMS), []);
});

test('every code the pages show has its own explanation, not just the generic one', () => {
  const dir = new URL('../', import.meta.url);
  const files = [
    ...readdirSync(dir).filter((f) => f.endsWith('.html')),
    ...readdirSync(new URL('partials/', dir)).map((f) => `partials/${f}`),
    ...readdirSync(new URL('src/pages/', dir)).map((f) => `src/pages/${f}`),
  ];
  for (const file of files) {
    const text = readFileSync(new URL(file, dir), 'utf8').replace(/^\s*\/\/.*$/gm, ''); // not comments
    for (const { term, help } of findTerms(text, TERMS)) {
      assert.ok(
        !help.includes(', in docs/development/adr'),
        `${file}: ${term} is not in the ADR index`,
      );
    }
  }
});

test('findTerms: whole words only, in order, with the code patterns as a fallback', () => {
  const text = '95% CI of the AUC; ADR-099 and C-99, SQLI-001 matched (sqli). CIs, AUCs, XADR-001';
  const found = findTerms(text, TERMS);
  assert.deepEqual(
    found.map((t) => t.term),
    ['CI', 'AUC', 'ADR-099', 'SQLI-001', 'sqli'],
  );
  for (const { index, term } of found) assert.equal(text.slice(index, index + term.length), term);
  assert.match(explain('ADR-099', TERMS), /architecture decision record no\. 99/);
  assert.equal(explain('HELLO', TERMS), null);
});

test('the explanations are plain sentences, with no special typography', () => {
  const texts = [...TERMS.values(), ...Object.values(ACRONYMS)];
  for (const text of texts) {
    assert.doesNotMatch(text, /[—–→←…]/, text);
    assert.ok(text.length < 260, text);
  }
});

test('plain and wrapLines', () => {
  assert.equal(
    plain('**Chi-square** in `stats/x.js` ([ADR-008](a.md)), _see_ <https://x.y>'),
    'Chi-square in stats/x.js (ADR-008), see https://x.y',
  );
  assert.deepEqual(wrapLines('aa bb cc dd', 5), ['aa bb', 'cc dd']);
  assert.deepEqual(wrapLines('averyveryverylongword x', 5), ['averyveryverylongword', 'x']);
});
