import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAR_CLASSES } from '@anomaly-guard/core';
import { characterClassShares } from '../src/character-classes.js';
import { runExperiment } from '../src/pipeline.js';
import { DEFAULTS } from '../src/state.js';

/** @param {string} label @param {Record<string, string>} params */
const sample = (label, params) => ({
  label,
  request: { method: 'GET', path: '/search', params },
});

const SPECIAL = CHAR_CLASSES.indexOf('special');
const LOWER = CHAR_CLASSES.indexOf('lower');

const sum = (values) => values.reduce((total, value) => total + value, 0);

test('characterClassShares: pooled counts and shares of hand-built groups', () => {
  const result = characterClassShares([
    sample('legit', { q: 'abc' }),
    sample('legit', { q: 'A1 ' }),
    sample('attack', { q: "a'=1" }),
  ]);
  assert.deepEqual(result.labels, [...CHAR_CLASSES]);
  assert.deepEqual(result.legitCount, [3, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(result.attackCount, [1, 0, 1, 0, 2, 0, 0]);
  assert.deepEqual(result.legit, [0.5, 1 / 6, 1 / 6, 1 / 6, 0, 0, 0]);
  assert.deepEqual(result.attack, [0.25, 0, 0.25, 0, 0.5, 0, 0]);
  assert.equal(result.legitChars, 6);
  assert.equal(result.attackChars, 4);
});

test('characterClassShares: non-ASCII characters are their own class', () => {
  const result = characterClassShares([sample('attack', { bio: 'é' })]);
  assert.deepEqual(result.attackCount, [0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(result.attack, [0, 0, 0, 0, 0, 0, 1]);
});

test('characterClassShares: no values, empty values or one empty group gives zeros, not NaN', () => {
  const empty = characterClassShares([]);
  assert.deepEqual(empty.legit, new Array(CHAR_CLASSES.length).fill(0));
  assert.deepEqual(empty.attack, new Array(CHAR_CLASSES.length).fill(0));
  assert.equal(empty.legitChars, 0);
  assert.equal(empty.attackChars, 0);

  const noCharacters = characterClassShares([
    sample('legit', {}),
    sample('legit', { q: '' }),
    sample('attack', { q: '' }),
  ]);
  assert.deepEqual(noCharacters.legitCount, new Array(CHAR_CLASSES.length).fill(0));
  assert.deepEqual(noCharacters.attackCount, new Array(CHAR_CLASSES.length).fill(0));
});

test('characterClassShares: each non-empty group is a share in [0, 1] adding up to 1', () => {
  const result = characterClassShares([
    sample('legit', { q: 'abc' }),
    sample('legit', { q: 'A1 ' }),
    sample('attack', { q: "a'=1" }),
  ]);
  for (const group of [result.legit, result.attack]) {
    assert.ok(Math.abs(sum(group) - 1) < 1e-12);
    assert.ok(group.every((share) => share >= 0 && share <= 1));
  }
  assert.equal(result.legitChars, sum(result.legitCount));
  assert.equal(result.attackChars, sum(result.attackCount));
});

test('characterClassShares: replacing lower-case characters by specials is monotone', () => {
  let previousSpecial = -1;
  for (let specials = 0; specials <= 10; specials += 1) {
    const value = 'a'.repeat(10 - specials) + "'".repeat(specials);
    const result = characterClassShares([sample('attack', { q: value })]);
    assert.ok(result.attack[SPECIAL] > previousSpecial);
    assert.equal(result.attack[LOWER], (10 - specials) / 10);
    previousSpecial = result.attack[SPECIAL];
  }
});

test('characterClassShares: a seeded test split sums to 1 and attacks use specials more', () => {
  const run = runExperiment({ ...DEFAULTS, size: 200 });
  const result = characterClassShares(run.dataset.test);
  assert.ok(Math.abs(sum(result.legit) - 1) < 1e-12);
  assert.ok(Math.abs(sum(result.attack) - 1) < 1e-12);
  assert.equal(
    result.legitChars + result.attackChars,
    sum(result.legitCount) + sum(result.attackCount),
  );
  assert.ok(result.attack[SPECIAL] > result.legit[SPECIAL]);
});

test('characterClassShares: a non-array is an error', () => {
  assert.throws(() => characterClassShares(/** @type {any} */ ('not an array')), TypeError);
});
