import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_RULES } from '@anomaly-guard/core';
import {
  ACRONYMS,
  FAMILIES,
  adrTerms,
  backlogTerms,
  buildTerms,
  explain,
  findTerms,
  plain,
  shorten,
  wrapLines,
} from '../src/terms.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const backlog = read('../../../docs/planning/backlog.md');
const adrIndex = read('../../../docs/development/adr/README.md');
// What the dashboard bundles (vite.config.js, virtual:term-sources), from the real docs.
const docs = { ...backlogTerms(backlog), ...adrTerms(adrIndex) };
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

test('every task and theme of the backlog, and every ADR of the index, explains itself', () => {
  const tasks = [...backlog.matchAll(/^\|\s*([A-Z]-\d{2})\s*\|/gm)].map((m) => m[1]);
  assert.ok(tasks.length > 30, `${tasks.length} tasks`);
  for (const id of tasks) {
    assert.match(docs[id], new RegExp(`^${id}: backlog task`), id);
    assert.ok(!docs[id].includes('**') && !docs[id].includes('`'), `${id}: plain text`);
  }
  assert.match(docs['C-06'], /^C-06: backlog task of T2, \w/);
  for (const theme of ['T1', 'T2', 'T3', 'T4']) {
    assert.match(docs[theme], new RegExp(`^${theme}: the statistical theme "[A-Z]`), theme);
  }
  const adrs = [...adrIndex.matchAll(/^\|\s*\[(ADR-\d{3})\]/gm)].map((m) => m[1]);
  assert.ok(adrs.length >= 11);
  for (const id of adrs)
    assert.match(docs[id], new RegExp(`^${id}: architecture decision record, `));
  // public pages name nobody: the theme lines' "member: ..." never reaches the explanations
  for (const help of Object.values(docs)) assert.doesNotMatch(help, /member:|\(`/, help);
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
        !help.includes("a task of the project's backlog"),
        `${file}: ${term} is not in the backlog`,
      );
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
    ['CI', 'AUC', 'ADR-099', 'C-99', 'SQLI-001', 'sqli'],
  );
  for (const { index, term } of found) assert.equal(text.slice(index, index + term.length), term);
  assert.match(explain('ADR-099', TERMS), /architecture decision record no\. 99/);
  assert.match(explain('C-99', TERMS), /a task of the project's backlog/);
  assert.equal(explain('HELLO', TERMS), null);
});

test('the explanations are plain sentences, with no special typography', () => {
  const texts = [...TERMS.values(), ...Object.values(ACRONYMS)];
  for (const text of texts) {
    assert.doesNotMatch(text, /[—–→←…]/, text);
    assert.ok(text.length < 260, text);
  }
});

test('plain, shorten and wrapLines', () => {
  assert.equal(
    plain('**Chi-square** in `stats/x.js` ([ADR-008](a.md)), _see_ <https://x.y>'),
    'Chi-square in stats/x.js (ADR-008), see https://x.y',
  );
  assert.equal(shorten('one two three four', 100), 'one two three four');
  assert.equal(shorten('one two three four five six', 16), 'one two three...');
  assert.deepEqual(wrapLines('aa bb cc dd', 5), ['aa bb', 'cc dd']);
  assert.deepEqual(wrapLines('averyveryverylongword x', 5), ['averyveryverylongword', 'x']);
});
