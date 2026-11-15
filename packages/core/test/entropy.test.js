import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shannonEntropy,
  entropySummary,
  entropySeparation,
  charClassCounts,
  classifyChar,
  CHAR_CLASSES,
} from '../src/index.js';

test('shannonEntropy: empty string is 0', () => {
  assert.equal(shannonEntropy(''), 0);
});

test('shannonEntropy: a single repeated symbol is 0', () => {
  assert.equal(shannonEntropy('aaaaaa'), 0);
});

test('shannonEntropy: two equally frequent symbols is 1 bit', () => {
  assert.equal(shannonEntropy('0101'), 1);
});

test('shannonEntropy: k equally frequent symbols is log2(k)', () => {
  // 4 distinct symbols, each once → log2(4) = 2 bits
  assert.ok(Math.abs(shannonEntropy('abcd') - 2) < 1e-12);
});

test('CHAR_CLASSES: the seven documented classes, in order (ADR-008)', () => {
  assert.deepEqual(
    [...CHAR_CLASSES],
    ['lower', 'upper', 'digit', 'space', 'special', 'punct', 'nonascii'],
  );
});

test('charClassCounts: one character of each class', () => {
  const c = charClassCounts("aA1 '.é"); // lower, upper, digit, space, special, punct, nonascii
  for (const cls of CHAR_CLASSES) assert.equal(c[cls], 1, cls);
});

test('classifyChar: injection metacharacters and control characters are special', () => {
  for (const ch of ["'", '"', ';', '<', '>', '=', '-', '/', '\\', '%', '|', '$', '`', '*', '#']) {
    assert.equal(classifyChar(ch), 'special', JSON.stringify(ch));
  }
  for (const ch of ['\r', '\n', '\t', '\0', '\x7f']) {
    assert.equal(classifyChar(ch), 'special', JSON.stringify(ch));
  }
});

test('classifyChar: harmless ASCII punctuation is punct, not special', () => {
  for (const ch of ['!', '+', ',', '.', ':', '?', '@', '[', ']', '^', '_', '~']) {
    assert.equal(classifyChar(ch), 'punct', JSON.stringify(ch));
  }
});

test('classifyChar: non-Latin letters are nonascii, never special', () => {
  for (const ch of ['è', 'ü', 'ñ', 'Ω', 'ж', '中', '😀']) {
    assert.equal(classifyChar(ch), 'nonascii', ch);
  }
});

test('shannonEntropy: an astral symbol counts once, not as two UTF-16 code units', () => {
  assert.equal(shannonEntropy('😀'), 0);
  assert.equal(shannonEntropy('😀a'), 1);
  assert.ok(Math.abs(shannonEntropy('😀😀ab') - 1.5) < 1e-12); // p = 1/2, 1/4, 1/4
});

// C-08 — entropy distributions of the legitimate and attack test values (methods.md §1b).

test('entropySummary: known quantiles for 0, 1, 2, 3, 4', () => {
  const r = entropySummary([0, 1, 2, 3, 4]);
  assert.equal(r.n, 5);
  assert.equal(r.mean, 2);
  assert.ok(Math.abs(r.sd - Math.sqrt(2.5)) < 1e-15);
  assert.equal(r.min, 0);
  assert.ok(Math.abs(r.p05 - 0.2) < 1e-15);
  assert.equal(r.q1, 1);
  assert.equal(r.median, 2);
  assert.equal(r.q3, 3);
  assert.ok(Math.abs(r.p95 - 3.8) < 1e-15);
  assert.equal(r.max, 4);
});

test('entropySummary: quantiles interpolate between order statistics', () => {
  const r = entropySummary([1, 2, 3, 4]);
  assert.equal(r.q1, 1.75);
  assert.equal(r.median, 2.5);
  assert.equal(r.q3, 3.25);
});

test('entropySummary: one value has sd 0 and constant quantiles; input is not mutated', () => {
  const input = [3, 1, 2];
  const single = entropySummary([2]);
  assert.equal(single.n, 1);
  assert.equal(single.mean, 2);
  assert.equal(single.sd, 0);
  for (const key of ['min', 'p05', 'q1', 'median', 'q3', 'p95', 'max']) {
    assert.equal(single[key], 2, key);
  }
  entropySummary(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test('entropySummary: empty or non-finite input is an error', () => {
  assert.throws(() => entropySummary([]), RangeError);
  assert.throws(() => entropySummary([1, NaN]), TypeError);
  assert.throws(() => entropySummary([1, '2']), TypeError);
});

test('entropySeparation: identical distributions give AUC 0.5, no direction and KS 0', () => {
  const r = entropySeparation([0, 1, 2], [0, 1, 2]);
  assert.equal(r.auc, 0.5);
  assert.equal(r.bestAuc, 0.5);
  assert.equal(r.direction, 'none');
  assert.equal(r.ks, 0);
});

test('entropySeparation: perfectly separated groups give AUC 1 and KS 1', () => {
  const r = entropySeparation([1, 2, 3], [4, 5, 6]);
  assert.equal(r.auc, 1);
  assert.equal(r.bestAuc, 1);
  assert.equal(r.direction, 'higher');
  assert.equal(r.ks, 1);
});

test('entropySeparation: a lower-entropy attack group is reported as direction "lower"', () => {
  const r = entropySeparation([4, 5, 6], [1, 2, 3]);
  assert.equal(r.auc, 0);
  assert.equal(r.bestAuc, 1);
  assert.equal(r.direction, 'lower');
  assert.equal(r.ks, 1);
});

test('entropySeparation: AUC 0.875 with one tie in four pairs; KS 0.5', () => {
  // Pairs (attack, legit): (1,0) win, (1,1) tie, (2,0) win, (2,1) win → (3 + ½)/4.
  const r = entropySeparation([0, 1], [1, 2]);
  assert.equal(r.auc, 0.875);
  assert.equal(r.ks, 0.5);
});

test('entropySeparation: all-tied attack group gives AUC 0.5; KS 1/3', () => {
  const r = entropySeparation([1, 2, 3], [2, 2, 2]);
  assert.equal(r.auc, 0.5);
  assert.equal(r.direction, 'none');
  assert.ok(Math.abs(r.ks - 1 / 3) < 1e-15);
});

test('entropySeparation: KS known answer 2/3 and AUC 17/18', () => {
  const r = entropySeparation([1, 2, 3], [3, 4, 5]);
  assert.ok(Math.abs(r.ks - 2 / 3) < 1e-15, `D = ${r.ks}`);
  // Attack 3: two wins and one tie; attacks 4 and 5: three wins each → 8.5 / 9.
  assert.ok(Math.abs(r.auc - 17 / 18) < 1e-15, `AUC = ${r.auc}`);
});

test('entropySeparation: shifting every attack entropy up never lowers the AUC', () => {
  let previous = -1;
  for (let shift = 0; shift <= 5; shift += 1) {
    const attack = [0, 1, 2].map((h) => h + shift);
    const r = entropySeparation([0, 1, 2], attack);
    assert.ok(r.auc >= previous, `shift = ${shift}`);
    previous = r.auc;
  }
  assert.equal(previous, 1);
});

test('entropySeparation: empty input is an error, in either group', () => {
  assert.throws(() => entropySeparation([], [1]), RangeError);
  assert.throws(() => entropySeparation([1], []), RangeError);
});
