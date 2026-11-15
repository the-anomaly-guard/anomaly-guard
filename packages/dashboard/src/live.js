// The run bar (partials/runbar.html) of the live replay (E-08, ADR-011). A page hands
// over its experiment and a function that draws the page for a frame; this module runs the replay,
// wires the buttons, and keeps the position in every internal link (`at`), so a replay started on
// one page carries on on the next. Like the rest of the console it keeps nothing in storage, only
// the URL, so it also works inside a sandboxed iframe. The line under the page title (seed, size,
// attack share) gives the run away, so it stays concealed until the replay is done.

import { createReplay, linkPosition, statusText } from './replay.js';
import { readAt, withState } from './state.js';

/** Links that keep the position: the shared navigation and the page's own links (filters...). */
const LINKS = 'a[data-nav], a[data-keep-state], a[data-keep-live]';

const STEPS = ['training', 'calibration', 'monitoring'];

/**
 * @param {{ state: import('./state.js').ExperimentState,
 *   run: ReturnType<typeof import('./pipeline.js').runExperiment>,
 *   render: (frame: import('./replay.js').Frame) => void }} page
 */
export function initLive({ state, run, render }) {
  const bar = document.querySelector('[data-runbar]');
  if (!(bar instanceof HTMLElement)) throw new Error('initLive: the run bar partial is missing');
  /** @param {string} name */
  const part = (name) => {
    const node = bar.querySelector(`[data-run-${name}]`);
    if (!(node instanceof HTMLElement)) throw new Error(`initLive: [data-run-${name}] is missing`);
    return node;
  };
  const start = part('start');
  const pause = part('pause');
  const skip = part('skip');
  const again = part('replay');
  const speedBox = part('speed-box');
  const speed = /** @type {HTMLSelectElement} */ (part('speed'));
  const status = part('status');
  const announce = part('announce');
  const progress = /** @type {HTMLProgressElement} */ (part('progress'));
  const steps = [...bar.querySelectorAll('[data-step]')];

  // Alerts among the first i test requests, for the status line.
  const alertsUpTo = [0];
  for (const e of run.events)
    alertsUpTo.push(alertsUpTo[alertsUpTo.length - 1] + (e.alert ? 1 : 0));

  let lastStage = '';
  const replay = createReplay({
    total: run.events.length,
    now: () => performance.now(),
    schedule: (tick) => requestAnimationFrame(tick),
    cancel: (handle) => cancelAnimationFrame(/** @type {number} */ (handle)),
    onFrame: draw,
  });

  start.addEventListener('click', () => replay.start());
  again.addEventListener('click', () => replay.start());
  skip.addEventListener('click', () => replay.skip());
  pause.addEventListener('click', () => {
    if (replay.frame().stage === 'paused') replay.resume();
    else replay.pause();
  });
  speed.addEventListener('change', () => replay.setSpeed(Number(speed.value)));

  const at = readAt(new URLSearchParams(location.search).get('at'), run.events.length);
  if (at === null) replay.idle();
  else replay.resumeFrom(at);
  return replay;

  /** @param {import('./replay.js').Frame} frame */
  function draw(frame) {
    render(frame);

    const { stage } = frame;
    const intro = frame.step !== null;
    const running = stage === 'intro' || stage === 'playing' || stage === 'paused';
    bar.dataset.stage = stage;
    status.textContent = statusText(run, frame, alertsUpTo[frame.at]);
    if (stage !== lastStage) {
      announce.textContent = status.textContent; // screen readers hear the steps, not every tick
      lastStage = stage;
    }
    if (stage === 'idle') progress.value = 0;
    else if (intro) progress.value = frame.stepProgress;
    else progress.value = frame.total ? frame.at / frame.total : 1;

    start.hidden = stage !== 'idle';
    pause.hidden = !running;
    pause.textContent = stage === 'paused' ? 'Resume' : 'Pause';
    skip.hidden = !running;
    skip.textContent = intro ? 'Skip the intro' : 'Skip to the end';
    speedBox.hidden = !running;
    again.hidden = stage !== 'done';

    let reached = STEPS.indexOf('monitoring');
    if (stage === 'idle') reached = -1;
    else if (stage === 'done') reached = STEPS.length;
    else if (intro) reached = STEPS.indexOf(/** @type {string} */ (frame.step));
    steps.forEach((step, i) => {
      step.classList.toggle('is-current', i === reached);
      step.classList.toggle('is-done', i < reached);
    });
    // Not even its space before the end: it appears, line and spacing, once the run is done.
    for (const line of document.querySelectorAll('[data-experiment]')) {
      line.classList.toggle('is-concealed', stage !== 'done');
    }

    const position = linkPosition(frame);
    for (const link of document.querySelectorAll(LINKS)) {
      const href = link.getAttribute('href');
      if (href) link.setAttribute('href', withState(href, state, { at: position }));
    }
  }
}
