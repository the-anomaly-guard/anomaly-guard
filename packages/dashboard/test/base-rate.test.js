import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmPpv, measuredRates, prevalenceCurve } from '../src/base-rate-data.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12);

test('Bayes: known answers for rare and common attacks', () => {
  close(alarmPpv(0.99, 0.01, 0.001), 0.00099 / 0.01098);
  close(alarmPpv(0.99, 0.01, 0.5), 0.99);
});

test('measured rates use the correct test class and identify missing classes', () => {
  assert.deepEqual(measuredRates({ tp: 9, fn: 1, fp: 2, tn: 98 }), {
    attacks: 10,
    legitimate: 100,
    tpr: 0.9,
    fpr: 0.02,
  });
  assert.equal(measuredRates({ tp: 0, fn: 0, fp: 0, tn: 10 }).tpr, null);
  assert.equal(measuredRates({ tp: 1, fn: 0, fp: 0, tn: 0 }).fpr, null);
});

test('PPV endpoints and no expected alarms', () => {
  assert.equal(alarmPpv(0.9, 0.1, 0), 0);
  assert.equal(alarmPpv(0.9, 0.1, 1), 1);
  assert.equal(alarmPpv(0.9, 0, 0), null);
  assert.equal(alarmPpv(0, 0.1, 1), null);
  assert.equal(alarmPpv(0, 0, 0.5), null);
  assert.equal(alarmPpv(0.9, 0, 0.001), 1);
  assert.equal(alarmPpv(0, 0.1, 0.001), 0);
});

test('curve increases with prevalence for positive TPR and FPR', () => {
  const curve = prevalenceCurve(0.99, 0.01);
  close(curve[0].x, 0.000001);
  assert.equal(curve.at(-1).x, 1);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].x > curve[i - 1].x);
    assert.ok(curve[i].y > curve[i - 1].y);
  }
});

test('PPV increases with TPR and decreases with FPR when prevalence is fixed', () => {
  const prevalence = 0.01;
  assert.ok(alarmPpv(0.8, 0.02, prevalence) > alarmPpv(0.4, 0.02, prevalence));
  assert.ok(alarmPpv(0.8, 0.01, prevalence) > alarmPpv(0.8, 0.02, prevalence));
});
