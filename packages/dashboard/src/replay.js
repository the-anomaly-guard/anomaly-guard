// Live replay of an experiment (E-08, ADR-011). The experiment is still computed in one
// go when the page loads (pipeline.js); the replay only decides how much of it the page shows.
// First the two steps of the method: training on legitimate requests, then the threshold on the
// legitimate calibration split. Then the test requests, one after another, as a monitor would
// receive them. The last frame is the whole run, so the finished page is the same as without the
// replay: same seed, same numbers. Pure: no DOM; the clock and the frame scheduler are passed in,
// so the tests drive them.

import { TRAIN_SIZE, CALIBRATION_SIZE } from './pipeline.js';
import { percent } from './shell.js';
import { fmt } from './dom.js';

/** The steps before the traffic, in order, and how long each one lasts at normal speed. */
export const INTRO = Object.freeze([
  Object.freeze({ step: 'training', ms: 1500 }),
  Object.freeze({ step: 'calibration', ms: 1500 }),
]);

/** How long the whole test split takes to arrive at normal speed, whatever its size. */
export const MONITOR_MS = 20000;

/** The speeds on offer (slow, normal, fast), as in partials/runbar.html. */
export const SPEEDS = Object.freeze([0.25, 1, 4]);

/** One frame never moves time by more than this, so a tab that was hidden does not jump ahead. */
export const MAX_STEP_MS = 250;

/**
 * @typedef {'idle' | 'intro' | 'playing' | 'paused' | 'done'} Stage
 *
 * @typedef {Object} Frame  what the page shows now
 * @property {Stage} stage
 * @property {'training' | 'calibration' | null} step  the step of the intro, also while paused in it
 * @property {number} stepProgress  0-1 within that step
 * @property {number} trained       share of the training split learned so far, 0-1
 * @property {boolean} calibrated   the threshold is set: the intro is over
 * @property {number} at            test requests arrived so far, 0-total
 * @property {number} total
 * @property {number} speed
 */

/**
 * @param {{ total: number, onFrame: (frame: Frame) => void, now: () => number,
 *   schedule: (tick: () => void) => unknown, cancel: (handle: unknown) => void,
 *   frameMs?: number }} options  `frameMs`: while it runs, at most one frame every so many ms
 */
export function createReplay({ total, onFrame, now, schedule, cancel, frameMs = 100 }) {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError('total must be an integer ≥ 0');
  }
  /** @type {Stage} */
  let stage = 'idle';
  /** @type {'intro' | 'playing'} */
  let pausedFrom = 'playing';
  let speed = 1;
  let introIndex = 0; // the step of the intro
  let introMs = 0; // time spent in it, in replay time
  let position = 0; // test requests arrived, fractional
  let last = 0; // the clock at the previous tick
  let lastEmit = -Infinity;
  /** @type {unknown} */
  let handle = null;

  const inIntro = () => stage === 'intro' || (stage === 'paused' && pausedFrom === 'intro');

  /** @returns {Frame} */
  function frame() {
    const intro = inIntro();
    const step = intro ? INTRO[introIndex].step : null;
    const stepProgress = intro ? Math.min(1, introMs / INTRO[introIndex].ms) : 0;
    let trained = 1;
    if (stage === 'idle') trained = 0;
    else if (step === 'training') trained = stepProgress;
    return {
      stage,
      step,
      stepProgress,
      trained,
      calibrated: stage !== 'idle' && !intro,
      at: Math.min(total, Math.floor(position + 1e-9)),
      total,
      speed,
    };
  }

  function emit() {
    lastEmit = now();
    onFrame(frame());
  }

  function stopTimer() {
    if (handle !== null) cancel(handle);
    handle = null;
  }

  function runTimer() {
    stopTimer();
    last = now();
    handle = schedule(tick);
  }

  function tick() {
    handle = null;
    const t = now();
    const dt = Math.min(Math.max(t - last, 0), MAX_STEP_MS) * speed;
    last = t;
    const before = stage;
    if (stage === 'intro') {
      introMs += dt;
      while (stage === 'intro' && introMs >= INTRO[introIndex].ms) {
        introMs -= INTRO[introIndex].ms;
        introIndex += 1;
        if (introIndex === INTRO.length) toTraffic(0);
      }
    } else if (stage === 'playing') {
      position = Math.min(total, position + (dt * total) / MONITOR_MS);
      if (position >= total) stage = 'done';
    }
    if (stage !== before || stage === 'done' || t - lastEmit >= frameMs) emit();
    if (stage === 'intro' || stage === 'playing') handle = schedule(tick);
  }

  /** @param {number} at */
  function toTraffic(at) {
    stage = 'playing';
    introIndex = 0;
    introMs = 0;
    position = Math.min(total, Math.max(0, at));
    if (position >= total) stage = 'done';
  }

  /** Nothing has arrived: the page is empty, waiting for Start. */
  function idle() {
    stopTimer();
    stage = 'idle';
    introIndex = 0;
    introMs = 0;
    position = 0;
    emit();
  }

  /** Start, or start again, from the first step of the intro. */
  function start() {
    stage = 'intro';
    introIndex = 0;
    introMs = 0;
    position = 0;
    emit();
    runTimer();
  }

  /**
   * Carry on from `at` requests without the intro: the replay was started on another page.
   * @param {number} at
   */
  function resumeFrom(at) {
    toTraffic(at);
    if (stage === 'done') return finish();
    emit();
    runTimer();
  }

  function pause() {
    if (stage !== 'intro' && stage !== 'playing') return;
    pausedFrom = stage;
    stage = 'paused';
    stopTimer();
    emit();
  }

  function resume() {
    if (stage !== 'paused') return;
    stage = pausedFrom;
    emit();
    runTimer();
  }

  /** During the intro, go straight to the traffic; during the traffic, to the end. */
  function skip() {
    if (inIntro()) {
      toTraffic(0);
      emit();
      runTimer();
    } else finish();
  }

  /** Show the whole run at once. */
  function finish() {
    stopTimer();
    stage = 'done';
    position = total;
    emit();
  }

  /** @param {number} x  one of SPEEDS */
  function setSpeed(x) {
    if (!SPEEDS.includes(x)) throw new RangeError(`speed must be one of ${SPEEDS.join(', ')}`);
    speed = x;
    emit();
  }

  return {
    frame,
    idle,
    start,
    resumeFrom,
    pause,
    resume,
    skip,
    finish,
    setSpeed,
    dispose: stopTimer,
  };
}

/**
 * The `at` page parameter that links carry (state.js `readAt`): none before the start, `end` once
 * every request has arrived, otherwise how many have. During the intro it is 0: the next page
 * goes straight to the traffic.
 * @param {Frame} frame
 * @returns {string | null}
 */
export function linkPosition({ stage, at, total }) {
  if (stage === 'idle') return null;
  if (stage === 'done' || at >= total) return 'end';
  return String(at);
}

/** Rates near the target need two decimals: 0.95% is not 1%. @param {number} x */
const pct2 = (x) => `${(x * 100).toFixed(2)}%`;

/**
 * What the calibration step found: the threshold for the target, a manual threshold, or none.
 * @param {import('./pipeline.js').OperatingPoint} operating
 */
export function calibrationText({ source, threshold, target, calibrationFpr, attainable }) {
  const on = `${fmt.int(CALIBRATION_SIZE)} legitimate requests`;
  if (source === 'rules') {
    return `rules only, no threshold to set: the rules flag ${pct2(calibrationFpr)} of ${on}.`;
  }
  if (source === 'manual') {
    return `a threshold set by hand, s = ${fmt.score(threshold)}: it flags ${pct2(calibrationFpr)} of ${on}.`;
  }
  const text = `the threshold for ${percent(/** @type {number} */ (target))} false positives on ${on} is s = ${fmt.score(threshold)}.`;
  return attainable === false
    ? `${text} The target cannot be met: the rules alone flag ${pct2(calibrationFpr)} of them.`
    : text;
}

/**
 * The run bar's line for a frame: which step, how far, what it found.
 * @param {Pick<ReturnType<typeof import('./pipeline.js').runExperiment>, 'operating'>} run
 * @param {Frame} frame
 * @param {number} alerts  alerts among the requests arrived so far
 */
export function statusText(run, frame, alerts) {
  const total = fmt.int(frame.total);
  if (frame.stage === 'idle') {
    return (
      `Ready. The detector has not seen any traffic yet: it will learn from ` +
      `${fmt.int(TRAIN_SIZE)} legitimate requests, set its threshold on ` +
      `${fmt.int(CALIBRATION_SIZE)} more, then watch ${total} test requests.`
    );
  }
  if (frame.stage === 'done') {
    return `Done: ${total} test requests analysed, ${fmt.count(alerts, 'alert')}.`;
  }
  const paused = frame.stage === 'paused' ? ' Paused.' : '';
  if (frame.step === 'training') {
    const learned = Math.round(frame.trained * TRAIN_SIZE);
    return (
      `Step 1 of 3 · Training: learning what normal looks like from ${fmt.int(learned)} of ` +
      `${fmt.int(TRAIN_SIZE)} legitimate requests. No attack, no test request.${paused}`
    );
  }
  if (frame.step === 'calibration') {
    return `Step 2 of 3 · Calibration: ${calibrationText(run.operating)}${paused}`;
  }
  return (
    `Step 3 of 3 · Monitoring: ${fmt.int(frame.at)} of ${total} test requests, ` +
    `${fmt.count(alerts, 'alert')}.${paused}`
  );
}
