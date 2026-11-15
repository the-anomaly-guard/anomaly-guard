import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAR_CLASSES } from '@anomaly-guard/core';
import { COLUMN_HELP, helpFor, normalize } from '../src/glossary.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');

/** Column headers written in the pages' HTML: <th ...>text</th>, tags inside removed. */
function htmlHeaders() {
  const headers = [];
  for (const file of readdirSync(root).filter((f) => f.endsWith('.html'))) {
    for (const [, inner] of read(file).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)) {
      headers.push([file, inner.replace(/<[^>]+>/g, '').trim()]);
    }
  }
  return headers;
}

/** Column headers built by the page scripts: h('th', { scope: 'col', ... }, 'text') and head(...). */
function scriptHeaders() {
  const headers = [];
  for (const file of readdirSync(root + 'src/pages')) {
    const source = read(`src/pages/${file}`);
    for (const [, text] of source.matchAll(
      /h\(\s*'th',\s*\{[^}]*scope: 'col'[^}]*\},\s*'([^']+)'\s*\)/g,
    )) {
      headers.push([file, text]);
    }
    for (const [, list] of source.matchAll(/head\(((?:\s*'[^']+',?)+)\s*\)/g)) {
      for (const [, text] of list.matchAll(/'([^']+)'/g)) headers.push([file, text]);
    }
  }
  return headers;
}

test('glossary: every column header of every table has an explanation', () => {
  const headers = [...htmlHeaders(), ...scriptHeaders(), ...CHAR_CLASSES.map((c) => ['core', c])];
  assert.ok(headers.length >= 45, `only ${headers.length} headers found: the parser broke?`);
  const missing = headers.filter(([, text]) => !helpFor(text));
  assert.deepEqual(missing, [], 'add these to COLUMN_HELP in src/glossary.js');
});

test('glossary: lookup ignores case and spacing; unknown headers get nothing', () => {
  assert.equal(normalize('  Mean\n  LENGTH '), 'mean length');
  assert.equal(helpFor('Mean length'), helpFor('mean   length'));
  assert.equal(helpFor('No such column'), undefined);
});

test('glossary: short plain sentences, none of the typography the team avoids', () => {
  for (const [key, text] of Object.entries(COLUMN_HELP)) {
    assert.equal(key, normalize(key), `key "${key}" must be normalised`);
    assert.ok(text.length <= 160, `"${key}" is too long for a hover: ${text.length} characters`);
    assert.doesNotMatch(text, /[—–→←…]/, key);
  }
});
