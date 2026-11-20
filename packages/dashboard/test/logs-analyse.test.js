import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readLog } from '../src/log-import/read.js';
import { sampleLog } from '../src/log-import/sample.js';
import {
  BASELINE_SHARES,
  CALIBRATION_SHARE,
  MIN_BASELINE,
  analyseLog,
  inspectEntry,
  prepareDetector,
  splitBaseline,
} from '../src/log-import/analyse.js';

const DIR = new URL('../src/log-import/formats/', import.meta.url);
const FORMATS = [];
for (const file of readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  FORMATS.push((await import(new URL(file, DIR).href)).default);
}
const noPause = async () => {};

// A log whose answers are known: legitimate traffic first, then 10% attacks (seeded).
const sample = sampleLog({ seed: 7, normal: 4000, inspected: 1000 });
const read = readLog(sample.text, FORMATS);

test('the sample log: Apache combined, one request per line, seeded', () => {
  assert.equal(read.format.id, 'apache');
  assert.equal(read.entries.length, 5000);
  assert.equal(read.unreadable, 0);
  assert.equal(sample.baselineShare, 0.8);
  assert.equal(
    sampleLog({ seed: 7, normal: 4000, inspected: 1000 }).text,
    sample.text,
    'same seed, same log',
  );
  assert.equal(
    sample.labels.slice(0, 4000).every((label) => label === 'legit'),
    true,
  );
});

test('the baseline is the start of the log; the model and the threshold split it', () => {
  const { baseline, inspected } = splitBaseline(read.entries, 0.75);
  assert.equal(baseline.length, 3750);
  assert.equal(inspected.length, 1250);
  assert.equal(inspected[0].line, 3751);
  const detector = prepareDetector(baseline, { mode: 'combined', fpr: 0.01, threshold: 1 });
  assert.equal(detector.train + detector.calibration, 3750);
  assert.equal(detector.calibration, Math.round(3750 * CALIBRATION_SHARE));
  assert.equal(detector.operating.source, 'calibrated');
  // the threshold lets at most 1% of the calibration part through
  assert.ok(detector.operating.calibrationFpr <= 0.01, String(detector.operating.calibrationFpr));
  assert.deepEqual(detector.warnings, []); // 1,125 calibration requests: n >= 10/α holds at 1%
  assert.deepEqual([...BASELINE_SHARES], [0.25, 0.5, 0.75]);
});

test('analyseLog: most attacks of the sample raise an alert, few legitimate requests do', async () => {
  const { baseline, inspected } = splitBaseline(read.entries, 0.75);
  const progress = [];
  const result = await analyseLog(
    { baseline, inspected, settings: { mode: 'combined', fpr: 0.01, threshold: 1 } },
    { pause: noPause, slice: 400, onProgress: (done, total) => progress.push([done, total]) },
  );
  assert.deepEqual(progress.at(-1), [1250, 1250]);
  assert.equal(progress.length, 4);
  let tp = 0;
  let attacks = 0;
  let fp = 0;
  let legit = 0;
  for (const row of result.rows) {
    if (sample.labels[row.entry.line - 1] === 'attack') {
      attacks++;
      if (row.alert) tp++;
    } else {
      legit++;
      if (row.alert) fp++;
    }
  }
  assert.equal(attacks, 100);
  assert.ok(tp / attacks > 0.8, `TPR ${tp}/${attacks}`);
  assert.ok(fp / legit < 0.05, `FPR ${fp}/${legit}`);
  assert.equal(result.alerts, tp + fp);
  assert.equal(result.signatures + result.statistical, result.alerts);
  for (const row of result.rows) {
    assert.equal(row.alert, row.result.verdict === 'attack');
    if (row.result.ruleMatched) assert.equal(row.level, 15);
  }
});

test('rules alone need no baseline; the statistics refuse a tiny one', async () => {
  const few = read.entries.slice(0, 10);
  await assert.rejects(
    analyseLog({
      baseline: few,
      inspected: read.entries.slice(10, 20),
      settings: { mode: 'stats', fpr: 0.01, threshold: 1 },
    }),
    new RegExp(`at least ${MIN_BASELINE}`),
  );
  const rules = await analyseLog(
    {
      baseline: few,
      inspected: read.entries.slice(4000),
      settings: { mode: 'rules', fpr: 0.01, threshold: 1 },
    },
    { pause: noPause },
  );
  assert.equal(rules.statistical, 0);
  assert.equal(rules.alerts, rules.signatures);
  assert.deepEqual(rules.warnings, []);
});

test('a small calibration part is reported, not hidden', () => {
  const detector = prepareDetector(read.entries.slice(0, 300), {
    mode: 'combined',
    fpr: 0.01,
    threshold: 1,
  });
  assert.match(detector.warnings.join(' '), /n ≥ 10\/α/);
});

test('a baseline that repeats a few requests does not drag the threshold to 0', () => {
  // As in a real public log with three URLs: almost every score is about 0, the calibrated
  // threshold falls to rounding noise, and requests with p close to 1 would raise alerts.
  const entry = (line, target) => ({
    line,
    method: 'GET',
    target,
    time: null,
    status: 200,
    fields: {},
  });
  const product = (i) => (i === 40 || i === 90 ? 3 : i % 7 === 0 ? 2 : 1);
  const baseline = Array.from({ length: 400 }, (_, i) =>
    entry(i + 1, `/downloads/product_${product(i)}`),
  );
  const settings = { mode: 'combined', fpr: 0.01, threshold: 1 };
  const detector = prepareDetector(baseline, settings);
  assert.equal(detector.operating.threshold, 2, 'raised to −log10 α');
  assert.equal(detector.operating.source, 'calibrated');
  assert.match(detector.warnings[0], /raised to −log₁₀ α = 2\.00/);
  for (const n of [1, 2, 3]) {
    const row = inspectEntry(entry(401, `/downloads/product_${n}`), detector, settings, 0);
    assert.ok(row.result.statScore < 2, `product_${n} scores ${row.result.statScore}`);
    assert.equal(row.alert, false);
  }
  // A manual threshold is the user's choice: no floor.
  const manual = prepareDetector(baseline, { mode: 'combined', fpr: 'manual', threshold: 0.5 });
  assert.equal(manual.operating.threshold, 0.5);
});
