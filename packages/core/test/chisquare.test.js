import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainStatModel, chiSquareScore } from '../src/index.js';
import {
  chiSquare6LogSurvival,
  chiSquareLogSurvival,
  chiSquareHomogeneity,
} from '../src/stats/chisquare.js';

const get = (path, params) => ({ method: 'GET', path, params });

// One character of each class: with Laplace smoothing each p̂_i = (1 + 1) / (7 + 7) = 1/7, so
// the expected shares are uniform and the chi-square has simple exact values.
const ONE_OF_EACH = "aA1 '!é";
const uniform = trainStatModel([get('/search', { q: ONE_OF_EACH })]);

test('chiSquare6LogSurvival: known answers p ≈ 0.05 and p ≈ 0.01 for df = 6', () => {
  const p05 = Math.exp(chiSquare6LogSurvival(12.592));
  const p01 = Math.exp(chiSquare6LogSurvival(16.812));
  assert.ok(Math.abs(p05 - 0.05) < 1e-4, `p(12.592) = ${p05}`);
  assert.ok(Math.abs(p01 - 0.01) < 1e-5, `p(16.812) = ${p01}`);

  // s = −log10(p): the 5% and 1% critical values are scores ≈ 1.301 and 2.
  assert.ok(Math.abs(-chiSquare6LogSurvival(12.592) / Math.LN10 - 1.301) < 1e-3);
  assert.ok(Math.abs(-chiSquare6LogSurvival(16.812) / Math.LN10 - 2) < 1e-4);
});

test('chiSquare6LogSurvival: x = 0 gives p = 1 and the score is monotone in χ²', () => {
  assert.equal(chiSquare6LogSurvival(0), 0);
  assert.equal(Math.exp(chiSquare6LogSurvival(0)), 1);

  let previous = -Infinity;
  for (let x = 0; x <= 100; x += 0.25) {
    const score = -chiSquare6LogSurvival(x) / Math.LN10;
    assert.ok(score >= previous, `χ² = ${x}`);
    previous = score;
  }
});

test('chiSquare6LogSurvival: a huge χ² keeps a finite score when p underflows to 0', () => {
  const logP = chiSquare6LogSurvival(1e6);
  assert.ok(Number.isFinite(logP));
  assert.equal(Math.exp(logP), 0); // the p-value underflows...
  assert.ok(Number.isFinite(-logP / Math.LN10)); // ...the score does not
  assert.ok(-logP / Math.LN10 > 200000);
  assert.ok(Number.isFinite(chiSquare6LogSurvival(1e300)));
});

test('chiSquareScore: Laplace-smoothed exact answer χ² = 6N = 24 for N = 4', () => {
  const r = chiSquareScore(uniform, get('/search', { q: 'aaaa' }));
  assert.equal(r.param, 'q');
  assert.equal(r.df, 6);
  assert.ok(Math.abs(r.chiSquare - 24) < 1e-12, `χ² = ${r.chiSquare}`);
  // Survival at χ² = 24, df = 6: p = e^−12 · 85, s = 3.2821…
  assert.ok(Math.abs(r.pValue - 0.0005222580500328979) < 1e-15);
  assert.ok(Math.abs(r.score - 3.282114857124729) < 1e-12);
});

test('chiSquareScore: a value matching the learned distribution scores 0 (χ² = 0, p = 1)', () => {
  const r = chiSquareScore(uniform, get('/search', { q: ONE_OF_EACH }));
  assert.equal(r.chiSquare, 0);
  assert.equal(r.pValue, 1);
  assert.equal(r.score, 0);
  assert.equal(r.param, 'q');
});

test('chiSquareScore: unseen pair uses the pooled counts (ADR-007)', () => {
  const r = chiSquareScore(uniform, get('/other', { q: 'aaaa' }));
  assert.equal(r.param, 'q');
  assert.ok(Math.abs(r.chiSquare - 24) < 1e-12);
});

test('chiSquareScore: no training data still gives Laplace-smoothed uniform expectations', () => {
  const empty = trainStatModel([]);
  const r = chiSquareScore(empty, get('/search', { q: 'aaaa' }));
  assert.ok(Math.abs(r.chiSquare - 24) < 1e-12);
  assert.ok(Number.isFinite(r.score));
});

test('chiSquareScore: reports the worst parameter; ties keep the first; empty values are skipped', () => {
  const both = trainStatModel([get('/search', { q: ONE_OF_EACH, page: ONE_OF_EACH })]);

  const worst = chiSquareScore(both, get('/search', { q: ONE_OF_EACH, page: 'aaaa' }));
  assert.equal(worst.param, 'page');
  assert.ok(Math.abs(worst.chiSquare - 24) < 1e-12);

  const tie = chiSquareScore(both, get('/search', { q: 'aaaa', page: 'bbbb' }));
  assert.equal(tie.param, 'q');
  assert.ok(Math.abs(tie.chiSquare - 24) < 1e-12);

  const skipped = chiSquareScore(both, get('/search', { q: '', page: 'aaaa' }));
  assert.equal(skipped.param, 'page');
});

test('chiSquareScore: no usable parameter returns the neutral result', () => {
  const neutral = { chiSquare: 0, df: 6, pValue: 1, score: 0, param: null };
  assert.deepEqual(chiSquareScore(uniform, get('/search', {})), neutral);
  assert.deepEqual(chiSquareScore(uniform, get('/search', { q: '' })), neutral);
});

test('chiSquareScore: monotonic — more deviating characters never score lower', () => {
  let previous = -1;
  for (let n = 0; n <= 64; n += 1) {
    const r = chiSquareScore(uniform, get('/search', { q: 'a'.repeat(n) }));
    assert.ok(r.score >= previous, `N = ${n}`);
    previous = r.score;
  }
});

// C-08 — dataset-level test of homogeneity (methods.md §4b) and its effect size.

// One representative character per CHAR_CLASSES entry, in the documented order.
const CLASS_SAMPLES = ['a', 'A', '0', ' ', "'", '!', 'é'];

/** A string with the requested number of characters in each of the seven classes. */
const valueWith = (counts) => CLASS_SAMPLES.map((ch, i) => ch.repeat(counts[i])).join('');

test('chiSquareLogSurvival: known 5% critical values for odd and even df', () => {
  const critical = [
    [1, 3.841458820694124], // df = 1: the 2 × 2 table after merging
    [2, 5.991464547107979],
    [6, 12.591587243743977], // the 7 × 2 table
    [7, 14.067140449340169],
    [10, 18.307038053275146],
  ];
  for (const [df, x] of critical) {
    const p = Math.exp(chiSquareLogSurvival(x, df));
    assert.ok(Math.abs(p - 0.05) < 1e-9, `df = ${df}: p = ${p}`);
  }
  const p = Math.exp(chiSquareLogSurvival(16.811893829770936, 6));
  assert.ok(Math.abs(p - 0.01) < 1e-9, `df = 6: p = ${p}`);
});

test('chiSquareLogSurvival: the general path agrees with the closed forms', () => {
  for (const x of [0.1, 1, 5, 10, 20, 50]) {
    assert.equal(chiSquareLogSurvival(x, 6), chiSquare6LogSurvival(x));
  }
  // df = 8 = 2m with m = 4: e^−x/2 · (1 + x/2 + (x/2)²/2 + (x/2)³/6).
  const x = 15.50731305586545;
  const h = x / 2;
  const closed = Math.exp(-h) * (1 + h + (h * h) / 2 + (h * h * h) / 6);
  assert.ok(Math.abs(Math.exp(chiSquareLogSurvival(x, 8)) - closed) < 1e-12);
});

test('chiSquareLogSurvival: p = 1 at x = 0, monotone in x and in df, finite for a huge x', () => {
  assert.equal(chiSquareLogSurvival(0, 6), 0);
  assert.equal(chiSquareLogSurvival(-3, 4), 0);

  let previous = 0;
  for (let x = 0; x <= 100; x += 0.5) {
    const logP = chiSquareLogSurvival(x, 4);
    assert.ok(logP <= previous, `x = ${x}`);
    previous = logP;
  }

  previous = -Infinity;
  for (let df = 1; df <= 20; df += 1) {
    const logP = chiSquareLogSurvival(10, df);
    assert.ok(logP >= previous, `df = ${df}`);
    previous = logP;
  }

  const logP = chiSquareLogSurvival(1e6, 6);
  assert.ok(Number.isFinite(logP));
  assert.equal(Math.exp(logP), 0); // p underflows...
  assert.ok(-logP / Math.LN10 > 200000); // ...the score does not
  assert.ok(Number.isFinite(chiSquareLogSurvival(1e300, 7)));
});

test('chiSquareLogSurvival: rejects an invalid df and a NaN statistic', () => {
  for (const df of [0, -1, NaN, Infinity]) {
    assert.throws(() => chiSquareLogSurvival(1, df), RangeError, `df = ${df}`);
  }
  assert.throws(() => chiSquareLogSurvival(NaN, 6), TypeError);
});

test('chiSquareHomogeneity: exact 7 × 2 known answer χ² = 7.619048, df = 6, p = 0.267362', () => {
  // Legit: 10 of every class. Attack: the same, but 30 specials instead of 10.
  // N = 160, expected cells ≥ 8.75, so no class is merged.
  const legit = valueWith([10, 10, 10, 10, 10, 10, 10]);
  const attack = valueWith([10, 10, 10, 10, 30, 10, 10]);
  const r = chiSquareHomogeneity([legit], [attack]);

  assert.equal(r.df, 6);
  assert.equal(r.merges.length, 0);
  assert.ok(Math.abs(r.chiSquare - 7.619047619047619) < 1e-12, `χ² = ${r.chiSquare}`);
  assert.ok(Math.abs(r.pValue - 0.267361888573749) < 1e-15, `p = ${r.pValue}`);
  assert.ok(Math.abs(r.score - 0.5729004996983611) < 1e-12);
  assert.ok(Math.abs(r.cramersV - 0.21821789023599236) < 1e-15);
  assert.equal(r.totalChars, 160);
  assert.deepEqual(r.groups, { legit: 70, attack: 90 });
  assert.equal(r.table.length, 7);
  assert.equal(r.table[4].class, 'special');
  assert.deepEqual(
    r.table.map((row) => [row.legit, row.attack]),
    [
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 10],
      [10, 30],
      [10, 10],
      [10, 10],
    ],
  );
});

test('chiSquareHomogeneity: 2 × 2 known answer χ² = 10, df = 1, p = 0.0015654', () => {
  // Only two classes are present, so the five empty classes merge away. The resulting 2 × 2
  // table has 20 characters per group and expected counts 10 in every cell:
  // χ² = (5 − 10)²/10 + (15 − 10)²/10 + (15 − 10)²/10 + (5 − 10)²/10 = 10.
  const legit = 'a'.repeat(5) + "'".repeat(15);
  const attack = 'a'.repeat(15) + "'".repeat(5);
  const r = chiSquareHomogeneity([legit], [attack]);

  assert.equal(r.df, 1);
  assert.equal(r.chiSquare, 10);
  assert.ok(Math.abs(r.pValue - 0.001565402258002549) < 1e-15, `p = ${r.pValue}`);
  assert.equal(r.table.length, 2);
  assert.deepEqual(
    r.merges.map((m) => m.from),
    ['upper', 'digit', 'space', 'punct', 'nonascii'],
  );
});

test('chiSquareHomogeneity: a class with expected < 5 is merged and df drops to 5', () => {
  // Every class has 100 characters per group except nonascii, which has 1: its expected count is
  // 2·601/1202 = 1, so it must be merged into its neighbour punct for this test only.
  const legit = valueWith([100, 100, 100, 100, 100, 100, 1]);
  const attack = valueWith([100, 100, 100, 100, 100, 100, 1]);
  const r = chiSquareHomogeneity([legit], [attack]);

  assert.equal(r.df, 5);
  assert.deepEqual(r.merges, [{ from: 'nonascii', into: 'punct' }]);
  assert.equal(r.table.length, 6);
  assert.equal(r.table[5].class, 'punct+nonascii');
  assert.deepEqual(r.table[5], { class: 'punct+nonascii', legit: 101, attack: 101 });
  assert.equal(r.chiSquare, 0);
  assert.equal(r.pValue, 1);
  assert.equal(r.score, 0);
  assert.equal(r.cramersV, 0);
});

test('chiSquareHomogeneity: order within a group does not change the result', () => {
  const legit = valueWith([10, 10, 10, 10, 10, 10, 10]);
  const attack = valueWith([10, 10, 10, 10, 30, 10, 10]);
  const forward = chiSquareHomogeneity([...legit], [...attack]);
  const backward = chiSquareHomogeneity([...legit].reverse(), [...attack].reverse());
  assert.deepEqual(backward, forward);
});

test('chiSquareHomogeneity: χ² is monotone as the attack group gains more specials', () => {
  // Legit: 100 lower. Attack: 100 characters in total, k of them special. With k ≥ 10 every
  // expected count is ≥ 5, so the table stays 2 × 2 (df = 1) and χ² = k²/100 + k.
  let previous = -1;
  for (let k = 10; k <= 90; k += 5) {
    const r = chiSquareHomogeneity(['a'.repeat(100)], ['a'.repeat(100 - k) + "'".repeat(k)]);
    assert.equal(r.df, 1, `k = ${k}`);
    assert.ok(r.chiSquare >= previous, `k = ${k}: χ² = ${r.chiSquare}`);
    previous = r.chiSquare;
  }
});

test('chiSquareHomogeneity: one class only is neutral (df = 0, p = 1)', () => {
  const r = chiSquareHomogeneity(['a'.repeat(10)], ['a'.repeat(10)]);
  assert.equal(r.df, 0);
  assert.equal(r.chiSquare, 0);
  assert.equal(r.pValue, 1);
  assert.equal(r.score, 0);
  assert.equal(r.cramersV, 0);
  assert.equal(r.table.length, 1);
});

test('chiSquareHomogeneity: empty input is an error, in either group', () => {
  assert.throws(() => chiSquareHomogeneity([], ['a']), RangeError);
  assert.throws(() => chiSquareHomogeneity(['a'], []), RangeError);
  assert.throws(() => chiSquareHomogeneity([''], ['a']), RangeError);
  assert.throws(() => chiSquareHomogeneity(['a'], ['']), RangeError);
  assert.throws(() => chiSquareHomogeneity('a', ['a']), TypeError);
});
