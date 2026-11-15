import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trainStatModel,
  lengthZScore,
  lengthScore,
  unseenPairScore,
  LENGTH_METHODS,
  DEFAULT_LENGTH_METHOD,
} from '../src/index.js';

const get = (path, params) => ({ method: 'GET', path, params });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

// Lengths 3, 5, 4 -> mean 4, sample std 1: easy known answers.
const model = trainStatModel([
  get('/search', { q: 'abc' }),
  get('/search', { q: 'abcde' }),
  get('/search', { q: 'abcd' }),
]);

/** A hand-written model (plain object): one pair, raw lengths mean 0 / std 1, n values. */
const handModel = (n) => ({
  params: {
    '/s?q': {
      n,
      length: { mean: 0, std: 1 },
      logLength: { mean: 0, std: 1 },
      classCounts: {},
    },
  },
  classCounts: {},
  trainedOn: n,
});

test('lengthScore: Chebyshev known answer, z = 10 -> p ≤ 1/100 -> score 2', () => {
  const raw = { method: 'chebyshev' };
  const r = lengthScore(model, get('/search', { q: 'x'.repeat(14) }), raw); // |14 − 4| / 1 = 10
  assert.equal(r.z, 10);
  assert.equal(r.param, 'q');
  assert.equal(r.unseen, false);
  near(r.score, 2, 1e-12);
  assert.equal(lengthScore(model, get('/search', { q: 'abcd' }), raw).score, 0); // z = 0
});

test('lengthScore: the default method is Chebyshev on the log scale (ADR-012)', () => {
  assert.equal(DEFAULT_LENGTH_METHOD, 'chebyshev-log');
  const request = get('/search', { q: 'x'.repeat(14) });
  assert.deepEqual(
    lengthScore(model, request),
    lengthScore(model, request, { method: 'chebyshev-log' }),
  );
});

test('lengthScore: monotonic - a larger deviation never scores lower, for every method', () => {
  for (const method of LENGTH_METHODS) {
    let previous = -1;
    for (let len = 4; len <= 400; len += 4) {
      const s = lengthScore(model, get('/search', { q: 'x'.repeat(len) }), { method }).score;
      assert.ok(s >= previous, `${method}, length ${len}`);
      previous = s;
    }
  }
});

test('lengthScore: a length below the mean is as anomalous as one above (two-sided)', () => {
  const big = trainStatModel([
    get('/p', { q: 'x'.repeat(20) }),
    get('/p', { q: 'x'.repeat(30) }),
    get('/p', { q: 'x'.repeat(25) }),
  ]); // mean 25, std 5
  const raw = { method: 'chebyshev' };
  const below = lengthScore(big, get('/p', { q: 'x'.repeat(5) }), raw); // z = 4
  const above = lengthScore(big, get('/p', { q: 'x'.repeat(45) }), raw); // z = 4
  near(below.score, above.score);
  near(below.score, Math.log10(16), 1e-12);
});

test('unseen pair (policy C-04): moderate fixed score log10(n + 1), never a hard verdict', () => {
  near(unseenPairScore(model), Math.log10(4)); // n = 3 training requests -> p = 1/4
  const r = lengthScore(model, get('/other', { q: 'x'.repeat(500) }));
  assert.equal(r.unseen, true);
  assert.equal(r.param, 'q');
  assert.equal(r.z, 0);
  near(r.score, Math.log10(4));
  // the length of the unseen value does not change the score: nothing to compare it with
  near(lengthScore(model, get('/other', { q: 'x' })).score, r.score);
  assert.ok(Number.isFinite(r.score));
});

test('unseen pair: an empty model has no evidence, so the score is 0', () => {
  const empty = trainStatModel([]);
  assert.equal(unseenPairScore(empty), 0);
  assert.equal(lengthScore(empty, get('/a', { q: 'x' })).score, 0);
});

test('unseen pair: the score is the worst parameter, seen or unseen', () => {
  const r = lengthScore(model, get('/search', { q: 'x'.repeat(14), extra: 'x' })); // seen z = 10
  assert.equal(r.param, 'q'); // score 2 beats the unseen pair's log10(4) ≈ 0.6
  assert.equal(r.unseen, false);
  const r2 = lengthScore(model, get('/search', { q: 'abcd', extra: 'x' }));
  assert.equal(r2.param, 'extra');
  assert.equal(r2.unseen, true);
});

test('lengthZScore: an unseen pair has no z and is skipped', () => {
  assert.deepEqual(lengthZScore(model, get('/other', { q: 'x'.repeat(500) })), {
    z: 0,
    param: null,
  });
});

test('σ = 0: constant training lengths use the floor σ = 1 instead of an infinite z', () => {
  const constant = trainStatModel([get('/c', { id: 'abcde' }), get('/c', { id: 'fghij' })]);
  assert.equal(constant.params['/c?id'].length.std, 0);
  const raw = { method: 'chebyshev' };
  const r = lengthScore(constant, get('/c', { id: 'x'.repeat(15) }), raw); // |15 − 5| / 1 = 10
  assert.equal(r.z, 10);
  near(r.score, 2, 1e-12);
  assert.equal(lengthScore(constant, get('/c', { id: 'abcde' }), raw).score, 0);
  // a single training value (std = 0 as well) behaves the same way
  const one = trainStatModel([get('/c', { id: 'abcde' })]);
  near(lengthScore(one, get('/c', { id: 'x'.repeat(15) }), raw).score, 2, 1e-12);
});

test('chebyshev-log: standardises ln(1 + length), with the log floor 0.1', () => {
  const m = trainStatModel([get('/p', { q: 'x'.repeat(99) }), get('/p', { q: 'x'.repeat(101) })]);
  const { mean, std } = m.params['/p?q'].logLength;
  assert.ok(std < 0.1); // below the floor, so the floor applies
  const r = lengthScore(m, get('/p', { q: 'x'.repeat(199) }), { method: 'chebyshev-log' });
  near(r.z, Math.abs(Math.log(200) - mean) / 0.1, 1e-9);
  near(r.score, Math.log10(r.z * r.z), 1e-9);
});

test('log scale: pairs with proportional spread give about the same z for a ×2 change', () => {
  // lengths 8–12 and 80–120 (same relative spread): ×2 is z = 5 on the raw scale for both, and
  // about the same on the log scale, whatever the absolute length of the pair
  const m = trainStatModel([
    ...[8, 10, 12].map((n) => get('/a', { q: 'x'.repeat(n) })),
    ...[80, 100, 120].map((n) => get('/b', { q: 'x'.repeat(n) })),
  ]);
  const z = (path, len, method) => lengthScore(m, get(path, { q: 'x'.repeat(len) }), { method }).z;
  near(z('/a', 20, 'chebyshev'), 5);
  near(z('/b', 200, 'chebyshev'), 5);
  const zA = z('/a', 20, 'chebyshev-log');
  const zB = z('/b', 200, 'chebyshev-log');
  assert.ok(Math.abs(zA - zB) < 0.3, `${zA} vs ${zB}`);
});

test('prediction-interval: normal tail, z = 2 -> p = 0.0455 -> score 1.342 (large n)', () => {
  const r = lengthScore(handModel(1e8), get('/s', { q: 'xx' }), { method: 'prediction-interval' });
  assert.equal(r.z, 2);
  near(r.score, -Math.log10(0.04550026389635842), 1e-6);
  const r3 = lengthScore(handModel(1e8), get('/s', { q: 'xxx' }), {
    method: 'prediction-interval',
  });
  near(r3.score, -Math.log10(0.0026997960632601866), 1e-6); // z = 3
});

test('prediction-interval: a small training set widens the interval (lower score)', () => {
  const request = get('/s', { q: 'xxx' });
  const small = lengthScore(handModel(3), request, { method: 'prediction-interval' }).score;
  const large = lengthScore(handModel(10000), request, { method: 'prediction-interval' }).score;
  assert.ok(small < large);
});

test('prediction-interval vs Chebyshev: for the same z the normal bound is tighter (higher score)', () => {
  const request = get('/s', { q: 'xxx' }); // z = 3
  const cheb = lengthScore(handModel(1e8), request, { method: 'chebyshev' }).score;
  const normal = lengthScore(handModel(1e8), request, { method: 'prediction-interval' }).score;
  near(cheb, Math.log10(9));
  assert.ok(normal > cheb);
});

test('prediction-interval: huge deviations stay finite and monotone (log-space tail)', () => {
  let previous = 0;
  for (const len of [10, 100, 1000, 10000]) {
    const { score } = lengthScore(handModel(500), get('/s', { q: 'x'.repeat(len) }), {
      method: 'prediction-interval',
    });
    assert.ok(Number.isFinite(score) && score > previous, `length ${len}`);
    previous = score;
  }
});

test('lengthScore: an unknown method throws', () => {
  assert.throws(
    () => lengthScore(model, get('/search', { q: 'a' }), { method: 'nope' }),
    RangeError,
  );
});

test('lengthScore: labels in the request are never read', () => {
  const request = get('/search', { q: 'x'.repeat(14) });
  assert.deepEqual(
    lengthScore(model, { ...request, label: 'attack', kind: 'sqli' }),
    lengthScore(model, request),
  );
});
