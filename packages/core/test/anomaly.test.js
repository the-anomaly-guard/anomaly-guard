import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trainStatModel,
  scoreRequest,
  scoreParts,
  calibrateModel,
  tailScore,
  SIGNAL_PARTS,
  COMBINE_MODES,
} from '../src/index.js';

const get = (path, params) => ({ method: 'GET', path, params });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// 30 normal values of /s?q: lengths 8..12, all letters (entropy grows with the length).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const word = (len) => get('/s', { q: LETTERS.slice(0, len) });
const training = Array.from({ length: 30 }, (_, i) => word(8 + (i % 5)));
const model = trainStatModel(training);
// 40 other legitimate requests of the same kind, for the calibration (never the training split)
const calibration = Array.from({ length: 40 }, (_, i) => word(8 + ((i * 3) % 5)));
const calibrated = calibrateModel(model, calibration);
const normal = word(10);
const long = get('/s', { q: 'a'.repeat(500) });

test('scoreRequest: one part per signal, the score is the max part and names it', () => {
  const r = scoreRequest(model, long);
  assert.deepEqual(Object.keys(r.parts), [...SIGNAL_PARTS]);
  assert.equal(r.score, Math.max(...Object.values(r.parts)));
  assert.equal(r.parts[r.top], r.score);
  assert.deepEqual(r.raw, r.parts); // in max mode the parts are the signals' own scores
  assert.ok(Object.values(r.parts).every((s) => Number.isFinite(s) && s >= 0));
});

test('scoreRequest: labels are never read', () => {
  const r = scoreRequest(model, long);
  assert.deepEqual(scoreRequest(model, { ...long, label: 'attack', kind: 'sqli' }), r);
  const c = scoreRequest(calibrated, long, { combine: 'calibrated' });
  assert.deepEqual(
    scoreRequest(calibrated, { ...long, label: 'attack', kind: 'sqli' }, { combine: 'calibrated' }),
    c,
  );
});

test('scoreRequest: a normal value scores low, a very long one high, on every part', () => {
  const low = scoreParts(model, normal);
  const high = scoreParts(model, long);
  for (const name of SIGNAL_PARTS) {
    assert.ok(low[name] < 1, `${name}: ${low[name]}`);
  }
  for (const name of ['length', 'iqr', 'mad', 'mahalanobis']) {
    assert.ok(high[name] > 2.5, `${name}: ${high[name]}`);
  }
  assert.ok(scoreRequest(model, normal).score < 1);
});

test('scoreRequest: the max is monotonic for a longer value beyond the training range', () => {
  let previous = -1;
  for (const len of [50, 100, 200, 400, 800]) {
    const s = scoreRequest(model, get('/s', { q: 'a'.repeat(len) })).score;
    assert.ok(s >= previous, `length ${len}`);
    previous = s;
  }
});

test('scoreRequest: an unseen pair is scored by the length signal only (policy of C-04)', () => {
  const r = scoreRequest(model, get('/other', { q: 'a'.repeat(500) }));
  assert.equal(r.top, 'length');
  near(r.parts.length, Math.log10(model.trainedOn + 1));
  for (const name of SIGNAL_PARTS.filter((n) => n !== 'length')) {
    // the chi-square signal also scores a pair it never saw (against the pooled counts)
    if (name !== 'chiSquare') assert.equal(r.parts[name], 0, name);
  }
});

test('scoreRequest: an unknown combine mode throws', () => {
  assert.throws(() => scoreRequest(model, normal, { combine: 'sum' }), RangeError);
  assert.deepEqual([...COMBINE_MODES], ['max', 'calibrated']);
});

test('tailScore: known answers on four calibration scores 1, 2, 3, 4', () => {
  const sorted = [1, 2, 3, 4];
  assert.equal(tailScore(sorted, 0), 0); // below every score: p = 5/5
  assert.equal(tailScore(sorted, 1), 0); // all four reach 1: p = 5/5
  near(tailScore(sorted, 2.5), Math.log10(5 / 3)); // two reach it: p = 3/5
  near(tailScore(sorted, 4), Math.log10(5 / 2)); // one reaches it: p = 2/5
  near(tailScore(sorted, 5), Math.log10(5)); // none: p = 1/5, the largest possible
  near(tailScore(sorted, 1e9), Math.log10(5)); // and it stays there
});

test('tailScore: ties move together, an empty calibration gives 0', () => {
  near(tailScore([2, 2, 2], 2), 0); // three reach 2: p = 4/4
  near(tailScore([2, 2, 2], 2.1), Math.log10(4)); // none does
  assert.equal(tailScore([], 5), 0);
});

test('tailScore: monotonic in the score', () => {
  const sorted = [0, 0, 0.1, 0.5, 0.5, 2, 3, 3, 7];
  let previous = -1;
  for (let s = 0; s <= 10; s += 0.25) {
    const t = tailScore(sorted, s);
    assert.ok(t >= previous, `s = ${s}`);
    previous = t;
  }
});

test('tailScore: why the calibrated mode exists, a noisy signal stops drowning a quiet one', () => {
  // signal A usually scores 5-7 on legitimate traffic, signal B almost never above 0
  const a = [5, 6, 7];
  const b = [0, 0, 0.1];
  // raw: A = 6.5 beats B = 1, although 6.5 is ordinary for A and 1 is extreme for B
  assert.ok(6.5 > 1);
  assert.ok(tailScore(b, 1) > tailScore(a, 6.5));
});

test('calibrateModel: a copy with the sorted legitimate scores, the input is untouched', () => {
  assert.equal(model.calibration, undefined);
  assert.equal(calibrated.calibration.n, calibration.length);
  assert.deepEqual(Object.keys(calibrated.calibration.scores), [...SIGNAL_PARTS]);
  for (const name of SIGNAL_PARTS) {
    const s = calibrated.calibration.scores[name];
    assert.equal(s.length, calibration.length);
    assert.deepEqual(
      s,
      [...s].sort((x, y) => x - y),
    );
  }
  assert.equal(calibrated.params, model.params); // the fitted statistics are shared, not refitted
  assert.equal(calibrated.trainedOn, model.trainedOn);
  assert.deepEqual(JSON.parse(JSON.stringify(calibrated)), calibrated); // still a plain object
});

test('calibrateModel: an empty calibration set is allowed and neutral', () => {
  const empty = calibrateModel(model, []);
  assert.equal(empty.calibration.n, 0);
  assert.equal(scoreRequest(empty, long, { combine: 'calibrated' }).score, 0);
});

test('calibrated mode: needs a calibrated model', () => {
  assert.throws(() => scoreRequest(model, normal, { combine: 'calibrated' }), TypeError);
});

test('calibrated mode: a legitimate calibration request never reaches the top of the scale', () => {
  const cap = Math.log10(calibration.length + 1);
  for (const request of calibration) {
    const r = scoreRequest(calibrated, request, { combine: 'calibrated' });
    // it is in its own calibration set, so at least one score (its own) reaches it: p >= 2/(n+1)
    assert.ok(r.score <= Math.log10((calibration.length + 1) / 2) + 1e-12);
    assert.ok(r.score < cap);
  }
});

test('calibrated mode: a request above every calibration score gets the largest score', () => {
  const r = scoreRequest(calibrated, long, { combine: 'calibrated' });
  near(r.score, Math.log10(calibration.length + 1));
  assert.ok(Object.values(r.parts).every((s) => s <= r.score + 1e-12));
  assert.deepEqual(r.raw, scoreRequest(calibrated, long).raw); // the raw scores are the same
});

test('calibrated mode: parts are tail ranks, the max of them is the score', () => {
  const r = scoreRequest(calibrated, normal, { combine: 'calibrated' });
  for (const name of SIGNAL_PARTS) {
    near(r.parts[name], tailScore(calibrated.calibration.scores[name], r.raw[name]));
  }
  assert.equal(r.score, Math.max(...Object.values(r.parts)));
});

test('calibrated mode: monotonic for a longer value beyond the training range', () => {
  let previous = -1;
  for (const len of [50, 100, 200, 400, 800]) {
    const s = scoreRequest(calibrated, get('/s', { q: 'a'.repeat(len) }), {
      combine: 'calibrated',
    }).score;
    assert.ok(s >= previous, `length ${len}`);
    previous = s;
  }
});

test('the default mode does not need, and does not read, the calibration', () => {
  assert.deepEqual(scoreRequest(calibrated, long), scoreRequest(model, long));
});
