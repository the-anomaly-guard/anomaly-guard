import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReplay,
  linkPosition,
  statusText,
  calibrationText,
  INTRO,
  MONITOR_MS,
  MAX_STEP_MS,
  SPEEDS,
} from '../src/replay.js';
import { runExperiment } from '../src/pipeline.js';
import { DEFAULTS } from '../src/state.js';

const INTRO_MS = INTRO.reduce((sum, step) => sum + step.ms, 0);

/** A replay on a fake clock: `advance(ms)` runs the scheduled ticks every 10 ms. */
function harness(total = 1000, options = {}) {
  let time = 0;
  /** @type {(() => void) | null} */
  let queued = null;
  const frames = [];
  const replay = createReplay({
    total,
    now: () => time,
    schedule: (tick) => {
      queued = tick;
      return 1;
    },
    cancel: () => {
      queued = null;
    },
    onFrame: (frame) => frames.push(frame),
    ...options,
  });
  return {
    replay,
    frames,
    last: () => frames.at(-1),
    /** @param {number} ms @param {number} [step] */
    advance(ms, step = 10) {
      const end = time + ms;
      while (time < end) {
        time = Math.min(end, time + step);
        const tick = queued;
        queued = null;
        tick?.();
      }
    },
    /** Move the clock without running any tick, then run one: a tab that was hidden. */
    jump(ms) {
      time += ms;
      const tick = queued;
      queued = null;
      tick?.();
    },
    running: () => queued !== null,
  };
}

test('replay: idle shows nothing, nothing trained, no threshold', () => {
  const { replay, last, running } = harness();
  replay.idle();
  assert.deepEqual(last(), {
    stage: 'idle',
    step: null,
    stepProgress: 0,
    trained: 0,
    calibrated: false,
    at: 0,
    total: 1000,
    speed: 1,
  });
  assert.equal(running(), false);
});

test('replay: training, then calibration, then the requests arrive at total / MONITOR_MS', () => {
  const { replay, last, advance } = harness(1000);
  replay.start();
  assert.equal(last().stage, 'intro');
  assert.equal(last().step, 'training');

  advance(INTRO[0].ms / 2);
  assert.equal(last().step, 'training');
  assert.ok(Math.abs(last().trained - 0.5) < 0.1, `trained ${last().trained}`);
  assert.equal(last().calibrated, false);

  advance(INTRO[0].ms / 2 + 10);
  assert.equal(last().step, 'calibration');
  assert.equal(last().trained, 1);
  assert.equal(last().calibrated, false);

  advance(INTRO[1].ms);
  assert.equal(last().stage, 'playing');
  assert.equal(last().calibrated, true);
  assert.ok(last().at < 10, `at ${last().at}`);

  advance(MONITOR_MS / 2);
  assert.ok(Math.abs(last().at - 500) <= 10, `half way: at ${last().at}`);

  advance(MONITOR_MS / 2 + 100);
  assert.equal(last().stage, 'done');
  assert.equal(last().at, 1000);
});

test('replay: the requests only ever move forward, and the last frame is every request', () => {
  const { replay, frames, advance } = harness(357);
  replay.start();
  advance(INTRO_MS + MONITOR_MS + 500);
  const ats = frames.map((f) => f.at);
  for (let i = 1; i < ats.length; i++) assert.ok(ats[i] >= ats[i - 1]);
  assert.equal(frames.at(-1).at, 357);
  assert.equal(frames.filter((f) => f.stage === 'done').length, 1);
});

test('replay: while it runs, at most one frame per frameMs', () => {
  const { replay, frames, advance } = harness(1000, { frameMs: 100 });
  replay.start();
  advance(INTRO_MS + 2000);
  // About 10 frames a second, plus one for each change of stage or step.
  assert.ok(frames.length <= ((INTRO_MS + 2000) / 100) * 1.2 + 4, `${frames.length} frames`);
});

test('replay: pause stops the clock; resume carries on from the same request', () => {
  const { replay, last, advance, running } = harness(1000);
  replay.start();
  advance(INTRO_MS + 4000);
  replay.pause();
  const at = last().at;
  assert.equal(last().stage, 'paused');
  assert.equal(running(), false);
  advance(10_000);
  assert.equal(last().at, at);
  replay.resume();
  assert.equal(last().stage, 'playing');
  advance(1000);
  assert.ok(last().at > at && last().at <= at + 60, `${at} -> ${last().at}`);
});

test('replay: a pause during the intro keeps the step', () => {
  const { replay, last, advance } = harness();
  replay.start();
  advance(INTRO[0].ms + 200);
  replay.pause();
  assert.equal(last().stage, 'paused');
  assert.equal(last().step, 'calibration');
  assert.equal(last().calibrated, false);
  replay.resume();
  assert.equal(last().stage, 'intro');
});

test('replay: speed scales the time, the intro included', () => {
  const fast = harness(1000);
  fast.replay.setSpeed(4);
  fast.replay.start();
  fast.advance((INTRO_MS + MONITOR_MS) / 4 + 100);
  assert.equal(fast.last().stage, 'done');

  const slow = harness(1000);
  slow.replay.setSpeed(0.25);
  slow.replay.start();
  slow.advance(INTRO_MS * 4 + MONITOR_MS); // a quarter of the traffic
  assert.equal(slow.last().stage, 'playing');
  assert.ok(Math.abs(slow.last().at - 250) <= 10, `at ${slow.last().at}`);

  assert.throws(() => fast.replay.setSpeed(2), RangeError);
  assert.deepEqual(SPEEDS, [0.25, 1, 4]);
});

test('replay: skip leaves the intro, then jumps to the end; finish shows everything', () => {
  const { replay, last, advance, running } = harness(1000);
  replay.start();
  advance(300);
  replay.skip();
  assert.equal(last().stage, 'playing');
  assert.equal(last().at, 0);
  assert.equal(last().calibrated, true);
  advance(1000);
  replay.skip();
  assert.equal(last().stage, 'done');
  assert.equal(last().at, 1000);
  assert.equal(running(), false);

  const fresh = harness(1000);
  fresh.replay.idle();
  fresh.replay.finish();
  assert.deepEqual(
    { ...fresh.last(), speed: 1 },
    {
      stage: 'done',
      step: null,
      stepProgress: 0,
      trained: 1,
      calibrated: true,
      at: 1000,
      total: 1000,
      speed: 1,
    },
  );
});

test('replay: resumeFrom carries on from another page without the intro', () => {
  const { replay, last, advance } = harness(1000);
  replay.resumeFrom(412);
  assert.equal(last().stage, 'playing');
  assert.equal(last().at, 412);
  assert.equal(last().trained, 1);
  advance(1000);
  assert.ok(last().at > 412);

  const end = harness(1000);
  end.replay.resumeFrom(1000);
  assert.equal(end.last().stage, 'done');
});

test('replay: after a hidden tab, one frame moves time by MAX_STEP_MS at most', () => {
  const { replay, last, jump } = harness(1000);
  replay.resumeFrom(0);
  jump(60_000);
  const most = Math.ceil((MAX_STEP_MS * 1000) / MONITOR_MS);
  assert.ok(last().at <= most, `at ${last().at}`);
  assert.equal(last().stage, 'playing');
});

test('replay: start again after the end', () => {
  const { replay, last, advance } = harness(100);
  replay.finish();
  replay.start();
  assert.equal(last().stage, 'intro');
  assert.equal(last().at, 0);
  advance(INTRO_MS + MONITOR_MS + 100);
  assert.equal(last().at, 100);
});

test('linkPosition: nothing before the start, a number while it runs, end at the end', () => {
  const frame = { stage: 'playing', at: 412, total: 1000 };
  assert.equal(linkPosition({ ...frame, stage: 'idle', at: 0 }), null);
  assert.equal(linkPosition({ ...frame, stage: 'intro', at: 0 }), '0');
  assert.equal(linkPosition(frame), '412');
  assert.equal(linkPosition({ ...frame, stage: 'paused' }), '412');
  assert.equal(linkPosition({ ...frame, stage: 'done', at: 1000 }), 'end');
});

test('statusText and calibrationText: each step says what it does and what it found', () => {
  const run = runExperiment({ ...DEFAULTS, size: 200 });
  const frame = {
    stage: 'idle',
    step: null,
    stepProgress: 0,
    trained: 0,
    calibrated: false,
    at: 0,
    total: 200,
    speed: 1,
  };
  assert.match(statusText(run, frame, 0), /learn from 800 legitimate requests/);
  assert.match(statusText(run, frame, 0), /2,000 more, then watch 200 test requests/);
  assert.match(
    statusText(run, { ...frame, stage: 'intro', step: 'training', trained: 0.5 }, 0),
    /^Step 1 of 3 · Training: .* from 400 of 800 legitimate requests/,
  );
  assert.match(
    statusText(run, { ...frame, stage: 'paused', step: 'calibration', trained: 1 }, 0),
    /^Step 2 of 3 · Calibration: .* Paused\.$/,
  );
  assert.equal(
    statusText(run, { ...frame, stage: 'playing', trained: 1, calibrated: true, at: 37 }, 4),
    'Step 3 of 3 · Monitoring: 37 of 200 test requests, 4 alerts.',
  );
  assert.equal(
    statusText(run, { ...frame, stage: 'done', at: 200 }, 21),
    'Done: 200 test requests analysed, 21 alerts.',
  );
  // one alert is singular, zero is plural
  assert.equal(
    statusText(run, { ...frame, stage: 'playing', trained: 1, calibrated: true, at: 3 }, 1),
    'Step 3 of 3 · Monitoring: 3 of 200 test requests, 1 alert.',
  );
  assert.equal(
    statusText(run, { ...frame, stage: 'done', at: 200 }, 1),
    'Done: 200 test requests analysed, 1 alert.',
  );
  assert.equal(
    statusText(run, { ...frame, stage: 'done', at: 200 }, 0),
    'Done: 200 test requests analysed, 0 alerts.',
  );

  const point = { threshold: 1.5706, target: 0.01, calibrationFpr: 0.005, attainable: true };
  assert.equal(
    calibrationText({ ...point, source: 'calibrated' }),
    'the threshold for 1% false positives on 2,000 legitimate requests is s = 1.57.',
  );
  assert.match(
    calibrationText({ ...point, source: 'calibrated', calibrationFpr: 0.036, attainable: false }),
    /The target cannot be met: the rules alone flag 3\.60% of them\.$/,
  );
  assert.match(
    calibrationText({ ...point, source: 'manual', threshold: 2, target: null }),
    /^a threshold set by hand, s = 2\.00: it flags 0\.50% of 2,000/,
  );
  assert.match(calibrationText({ ...point, source: 'rules' }), /^rules only, no threshold to set/);
});
