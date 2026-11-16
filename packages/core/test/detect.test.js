import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleEngine, trainStatModel, detect, describeExplanation } from '../src/index.js';

const get = (path, params) => ({ method: 'GET', path, params });

const engine = new RuleEngine();
const model = trainStatModel(
  ['red shoes', 'blue hat', 'green coat', 'socks', 'a nice warm jacket'].map((q) =>
    get('/search', { q }),
  ),
);

const samples = [
  get('/search', { q: 'red hat' }), // ordinary
  get('/search', { q: 'x'.repeat(800) }), // only the statistics can see this
  get('/search', { q: "' OR '1'='1" }), // a rule matches
  get('/search', { q: 'warm cotton socks' }),
];

test('detect (stats): a very long parameter is flagged by the statistical score', () => {
  const res = detect(samples[1], { model, threshold: 1, mode: 'stats' });
  assert.equal(res.verdict, 'attack');
  assert.ok(res.score >= 1);
  // the reason names the signal that produced the score (the largest of the five, C-06), the
  // parameter and the probability (C-07)
  assert.match(
    res.reasons.join(),
    /statistical score \d+\.\d\d ≥ threshold 1\.00: (length|chiSquare|iqr|mad|mahalanobis) on "q"/,
  );
  assert.match(res.reasons.join(), /p ≈ /);
});

test('detect (combined): a rule hit scores +Infinity, so every threshold flags it', () => {
  const res = detect(samples[2], { ruleEngine: engine, model, threshold: 1e9, mode: 'combined' });
  assert.equal(res.score, Infinity);
  assert.equal(res.verdict, 'attack');
  assert.ok(res.ruleMatched);
});

test('detect (rules): binary score, threshold not needed', () => {
  assert.equal(detect(samples[2], { ruleEngine: engine, mode: 'rules' }).score, 1);
  assert.equal(detect(samples[0], { ruleEngine: engine, mode: 'rules' }).score, 0);
});

test('detect: in stats and combined mode, verdict is attack exactly when score ≥ threshold', () => {
  for (const mode of ['stats', 'combined']) {
    for (const threshold of [0, 0.5, 1, 2, 5]) {
      for (const request of samples) {
        const r = detect(request, { ruleEngine: engine, model, threshold, mode });
        assert.equal(r.verdict === 'attack', r.score >= threshold, `${mode} t=${threshold}`);
      }
    }
  }
});

test('detect: refuses to run without what the mode needs (no silent defaults)', () => {
  assert.throws(() => detect(samples[0], { ruleEngine: engine, model, mode: 'combined' }));
  assert.throws(() => detect(samples[0], { model, threshold: 1, mode: 'combined' }));
  assert.throws(() => detect(samples[0], { ruleEngine: engine, threshold: 1, mode: 'stats' }));
  assert.throws(() => detect(samples[0], { ruleEngine: engine, model, threshold: 1, mode: 'x' }));
});

test('detect: the reason gives the threshold with two decimals, like the score', () => {
  const res = detect(samples[1], { model, threshold: 1 / 3, mode: 'stats' });
  assert.match(res.reasons.join(), /statistical score \d+\.\d\d ≥ threshold 0\.33: /);
});

test('detect: the explanation says which signal, which parameter and which probability', () => {
  const res = detect(samples[1], { model, threshold: 1, mode: 'stats' });
  const e = res.detail.explanation;
  assert.equal(e.param, 'q');
  assert.ok(['length', 'chiSquare', 'iqr', 'mad', 'mahalanobis'].includes(e.signal));
  assert.equal(e.score, res.statScore);
  assert.ok(Math.abs(e.p - 10 ** -res.statScore) < 1e-12);
  assert.ok(e.p < 0.1);
  // plain data: it survives a JSON round trip unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});

test('detect: an unremarkable request has no explanation, and rules mode has none either', () => {
  assert.equal(detect(samples[0], { model, threshold: 50, mode: 'stats' }).reasons.length, 0);
  assert.equal(detect(samples[2], { ruleEngine: engine, mode: 'rules' }).detail.explanation, null);
});

test('describeExplanation: known answers for each kind of signal', () => {
  const base = { param: 'q', feature: null, df: null, unseen: false };
  assert.equal(
    describeExplanation({
      ...base,
      signal: 'length',
      statistic: 'z',
      value: 12.1,
      score: 2,
      p: 0.01,
    }),
    'length on "q": z = 12.10, p ≈ 0.01',
  );
  assert.equal(
    describeExplanation({
      ...base,
      signal: 'iqr',
      feature: 'logLength',
      statistic: 'z',
      value: 8.2,
      score: 4,
      p: 1e-4,
    }),
    'iqr on "q" (logLength): z = 8.20, p ≈ 1.0e-4',
  );
  assert.equal(
    describeExplanation({
      ...base,
      signal: 'mahalanobis',
      statistic: 'D2',
      value: 30,
      df: 3,
      score: 3,
      p: 1e-3,
    }),
    'mahalanobis on "q": D2 = 30.00 (df 3), p ≈ 1.0e-3',
  );
  assert.equal(
    describeExplanation({
      ...base,
      signal: 'length',
      statistic: 'z',
      value: null,
      unseen: true,
      score: 1,
      p: 0.1,
    }),
    'length on "q": parameter never seen in training, p ≈ 0.10',
  );
});
