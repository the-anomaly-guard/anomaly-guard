import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densify } from '../src/lines.js';

// The ROC of the rules: one inner point, joined to the corners (the hover bug: nothing in between).
const RULES = [
  { x: 0, y: 0 },
  { x: 0, y: 0.33 },
  { x: 1, y: 1 },
];

test('densify: keeps every original point, in order, unmarked', () => {
  const out = densify(RULES, 0.01);
  const kept = out.filter((p) => !p.between);
  assert.deepEqual(kept, RULES);
  assert.deepEqual(out[0], RULES[0]);
  assert.deepEqual(out.at(-1), RULES.at(-1));
});

test('densify: no gap left larger than the step, on x or on y', () => {
  const out = densify(RULES, 0.01);
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(out[i].x - out[i - 1].x) <= 0.01 + 1e-12, `x gap at ${i}`);
    assert.ok(Math.abs(out[i].y - out[i - 1].y) <= 0.01 + 1e-12, `y gap at ${i}`);
  }
  assert.ok(out.length > 100, 'the long segment to (1, 1) is now hoverable along its length');
});

test('densify: the added points lie on the drawn segment and are marked', () => {
  const out = densify(RULES, 0.05);
  for (const p of out.filter((q) => q.between)) {
    const onFirst = p.x === 0 && p.y > 0 && p.y < 0.33;
    const onSecond = Math.abs(p.y - (0.33 + 0.67 * p.x)) < 1e-12 && p.x > 0 && p.x < 1;
    assert.ok(onFirst || onSecond, JSON.stringify(p));
  }
  assert.ok(densify(RULES, 0.05, false).every((p) => !('between' in p)));
});

test('densify: short segments and single points are left alone; a bad step is refused', () => {
  const steps = [
    { x: 0, y: 0 },
    { x: 0.004, y: 0.006 },
  ];
  assert.deepEqual(densify(steps, 0.01), steps);
  assert.deepEqual(densify([{ x: 0.2, y: 0.7 }], 0.01), [{ x: 0.2, y: 0.7 }]);
  assert.deepEqual(densify([], 0.01), []);
  for (const bad of [0, -1, NaN]) assert.throws(() => densify(RULES, bad), RangeError);
});
