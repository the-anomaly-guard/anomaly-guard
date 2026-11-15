import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestRowClass } from '../src/rows.js';

test('requestRowClass: alerts and mistakes, in every combination', () => {
  const classes = (e) => requestRowClass(e).split(' ');
  assert.deepEqual(classes({ alert: false, correct: true }), ['request-row']); // passed, rightly
  assert.deepEqual(classes({ alert: true, correct: true }), ['request-row', 'is-alert']); // caught
  assert.deepEqual(classes({ alert: true, correct: false }), [
    'request-row',
    'is-alert',
    'is-mistake',
  ]); // false alarm
  assert.deepEqual(classes({ alert: false, correct: false }), ['request-row', 'is-mistake']); // missed
});

test("requestRowClass: the table's own classes, empty ones skipped", () => {
  const e = { alert: true, correct: true };
  assert.equal(requestRowClass(e, 'feed-row', 'is-new'), 'request-row feed-row is-new is-alert');
  assert.equal(requestRowClass(e, 'event-row', false), 'request-row event-row is-alert');
  assert.equal(
    requestRowClass(e, 'event-row', null, undefined, ''),
    'request-row event-row is-alert',
  );
});

test('every table of requests takes its row classes from rows.js', () => {
  for (const page of ['overview', 'events']) {
    const source = readFileSync(new URL(`../src/pages/${page}.js`, import.meta.url), 'utf8');
    assert.match(source, /class: requestRowClass\(e, /, `${page}.js builds its rows with rows.js`);
    assert.doesNotMatch(source, /classes\.push\('is-(alert|mistake)'\)/, page);
  }
  // and styles.css draws the look once, for any table
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.request-row\.is-alert > td \{/);
  assert.match(css, /\.request-row\.is-mistake > td:first-child \{/);
  assert.doesNotMatch(css, /\.(feed|event)-row\.is-(alert|mistake) > td/);
});

test('every table of requests has the key to the two marks under it', () => {
  const legend = readFileSync(new URL('../partials/request-legend.html', import.meta.url), 'utf8');
  assert.match(legend, /legend-swatch is-alert/);
  assert.match(legend, /legend-swatch is-mistake/);
  assert.match(legend, /a false alarm or a missed attack/);
  for (const page of ['index', 'events']) {
    const html = readFileSync(new URL(`../${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /<!-- include: partials\/request-legend\.html -->/, page);
  }
});
