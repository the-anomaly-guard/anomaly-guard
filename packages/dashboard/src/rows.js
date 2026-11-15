// How a row that shows one request looks, in every table of requests (Overview, Security events
// and any later one). The classes come from here and styles.css draws them the same everywhere,
// so a new table of requests gets the red alert rows and the mistake bar just by using this.
// Pure: no DOM, tested in Node.

/**
 * The classes of a table row that shows one request: `request-row`, the table's own classes,
 * then `is-alert` when the detector raised an alert (the whole row is tinted red) and
 * `is-mistake` when it got the request wrong, a false alarm or a missed attack (a red bar on the
 * left).
 * @param {{ alert: boolean, correct: boolean }} e  a dashboard event (pipeline.js)
 * @param {...(string | false | null | undefined)} extra  the table's own classes; empty ones are
 *   skipped, so `isOpen && 'is-open'` works
 * @returns {string}
 */
export function requestRowClass(e, ...extra) {
  const classes = ['request-row', ...extra.filter((name) => typeof name === 'string' && name)];
  if (e.alert) classes.push('is-alert');
  if (!e.correct) classes.push('is-mistake');
  return classes.join(' ');
}
