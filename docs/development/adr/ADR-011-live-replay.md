# ADR-011: Live replay in the console

**Date:** 2026-11-15
**Status:** Accepted
**Author:** Nicholas Arcari

## Context

The brief asks for an application that **monitors** simulated web requests. The console
(ADR-010) computes the whole experiment when a page loads and shows it already finished: every
number is there at once, and a visitor never sees a request arrive. The order of the method is
invisible too: the model is trained on legitimate requests only, the threshold is set on a
separate legitimate calibration split, and only then is the test split scored (ADR-004,
ADR-009). That order is what makes the evaluation honest, and the page does not show it.

B-03 (a request log and a verdict stream from the Express server) was cut because it is
engineering, not statistics, and the dashboard already runs the pipeline in the browser. The
replay needs no server: it only changes how much of the computed experiment a page shows.

## Decision

1. **Every page that shows traffic opens empty**: Overview, Security events, Rules, Statistical
   models, Detection quality. Base rate and About do not change. A run bar
   (`partials/runbar.html`) says what will happen and offers **Start monitoring**: there is no
   shortcut to the result. The line under the page title (seed, number of test requests, attack
   share) would give the run away, so it stays concealed until the replay is done.
2. **Start monitoring replays the method in order** (`src/replay.js`, pure and tested):
   1. training: the model learns from the 800 legitimate training requests (Statistical models
      shows the table filling up);
   2. calibration: the threshold for the target false-positive rate on the 2,000 legitimate
      calibration requests;
   3. monitoring: the test requests arrive one after another, 20 seconds for the whole split at
      normal speed, whatever its size.

   Pause and resume, three speeds (slow, normal, fast), skip the intro, skip to the end, replay.

3. **Only the display is progressive.** The experiment is still computed once, as before
   (`pipeline.js`), and every figure is computed on the requests that have arrived so far. The
   last frame is the whole test split, so the finished page shows exactly the numbers it showed
   before: same seed, same results. On Detection quality the Wilson intervals narrow as n grows.
   The AUC bootstrap runs once, at the end.
4. **The position is in the URL**, as the page parameter `at` (`state.js` `readAt`): absent, the
   replay has not started; a number, that many requests have arrived; `end`, all of them. Links
   carry it, so a replay started on one page carries on on the next. Nothing goes in browser
   storage, so it still works in a sandboxed iframe (ADR-010). Applying new settings drops `at`:
   a new experiment starts empty.
5. With `prefers-reduced-motion` the requests still arrive, but the pulse and the highlight of new
   rows stop.

## Alternatives considered

| Alternative                                     | Why not                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A verdict stream from the server (B-03)         | Cut: engineering, not statistics; GitHub Pages has no server                                           |
| Start on its own when the page opens            | A button instead: the page stays still until the visitor chooses to start                              |
| Animate only the Overview                       | Every page would show a finished run while the Overview is still filling up                            |
| Keep the position in `sessionStorage`           | Not available in a sandboxed iframe (ADR-010); a URL is also shareable                                 |
| Feed the requests to the detector one at a time | It would change what is computed and when; replaying a computed run keeps the numbers exactly the same |

## Consequences

### Positive

- The console behaves like a monitor: requests arrive, counters and charts grow.
- It shows the order of the method (train on legitimate traffic -> calibrate -> test) and that the
  test traffic never changes the model.
- It shows uncertainty shrinking with n: wide intervals after a few requests, narrow at the end.

### Negative / risks

- A link without `at` now opens an empty page. Links in the report and in portfolios should add
  `at=end` to open the finished run.
- More code in the pages: each one draws itself for a frame (`render(frame)`). A theme chart
  (E-02) that does not follow the frame still works, but shows the finished run from the start.
- Re-drawing about ten times a second costs a few milliseconds per frame at 1,000 requests.

### Actions

- [x] `src/replay.js`, `src/live.js`, `partials/runbar.html`; every page draws from the requests
      so far; tests for the replay, `readAt`, `summarise` and McNemar on the first n requests.
- [x] Merged into `main` on 2026-11-15 (backlog E-08: `Done`).
