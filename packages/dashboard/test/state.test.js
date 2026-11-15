import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, FPR_TARGETS, parseState, readAt, toQuery, withState } from '../src/state.js';

test('parseState: no query gives the defaults', () => {
  assert.deepEqual(parseState(''), { ...DEFAULTS });
});

test('parseState: reads every setting', () => {
  assert.deepEqual(
    parseState('?seed=7&mode=stats&fpr=0.005&threshold=2.5&prevalence=0.2&size=300'),
    { seed: 7, mode: 'stats', fpr: 0.005, threshold: 2.5, prevalence: 0.2, size: 300 },
  );
  assert.equal(parseState('?fpr=manual').fpr, 'manual');
  for (const fpr of FPR_TARGETS) assert.equal(parseState(`?fpr=${fpr}`).fpr, fpr);
});

test('parseState: the target false-positive rate is calibrated at 1% unless chosen', () => {
  assert.equal(DEFAULTS.fpr, 0.01);
  // Only the offered targets: 0.1% needs 10,000 calibration requests (n ≥ 10/α, methods.md §6).
  for (const query of ['fpr=0.001', 'fpr=0.5', 'fpr=1', 'fpr=', 'fpr=MANUAL', 'fpr=abc']) {
    assert.equal(parseState(`?${query}`).fpr, 0.01, query);
  }
  assert.ok(FPR_TARGETS.every((target) => 2000 >= 10 / target - 1e-9));
});

test('parseState: an invalid value falls back to its own default only', () => {
  const bad = [
    'seed=-1',
    'seed=1.5',
    'seed=abc',
    'seed=4294967296',
    'mode=evil',
    'threshold=-1',
    'threshold=NaN',
    'threshold=1e9',
    'prevalence=2',
    'size=50',
    'size=100.5',
    'seed=',
  ];
  for (const query of bad) {
    assert.deepEqual(parseState(`?${query}`), { ...DEFAULTS }, query);
  }
  assert.deepEqual(parseState('?seed=-1&size=200'), { ...DEFAULTS, size: 200 });
});

test('toQuery / parseState: round trip', () => {
  const state = {
    seed: 123,
    mode: 'rules',
    fpr: 'manual',
    threshold: 3,
    prevalence: 0.05,
    size: 2000,
  };
  assert.equal(
    toQuery(state),
    'seed=123&mode=rules&fpr=manual&threshold=3&prevalence=0.05&size=2000',
  );
  assert.deepEqual(parseState(toQuery(state)), state);
  const calibrated = { ...state, fpr: 0.02 };
  assert.deepEqual(parseState(toQuery(calibrated)), calibrated);
});

test('withState: adds the settings and keeps other parameters and the hash', () => {
  const state = { ...DEFAULTS, seed: 9 };
  assert.equal(
    withState('./events.html', state),
    './events.html?seed=9&mode=combined&fpr=0.01&threshold=1&prevalence=0.1&size=1000',
  );
  assert.equal(
    withState('./events.html?show=alerts&seed=1#top', state),
    './events.html?show=alerts&seed=9&mode=combined&fpr=0.01&threshold=1&prevalence=0.1&size=1000#top',
  );
});

test('readAt: the live replay position (E-08) - absent, a request count, or end', () => {
  assert.equal(readAt(null, 1000), null); // not started: the page opens empty
  assert.equal(readAt('', 1000), null);
  assert.equal(readAt('0', 1000), 0);
  assert.equal(readAt('412', 1000), 412);
  assert.equal(readAt('end', 1000), 1000);
  assert.equal(readAt('5000', 1000), 1000); // past the end: everything
  for (const raw of ['-1', '1.5', 'abc', 'END']) assert.equal(readAt(raw, 1000), null, raw);
  // A page parameter, not a setting: it never changes the experiment.
  assert.deepEqual(parseState('?at=412'), { ...DEFAULTS });
});

test('withState: extra parameters are set or removed, never duplicated', () => {
  const href = withState('./events.html?show=alerts&page=3', DEFAULTS, { page: 4, show: null });
  const q = new URLSearchParams(href.split('?')[1]);
  assert.equal(q.get('page'), '4');
  assert.equal(q.has('show'), false);
  assert.equal(q.getAll('seed').length, 1);
});
