import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageOf, readOrder, readPageSize } from '../src/listing.js';

test('readPageSize: one of the sizes on offer, else the default', () => {
  assert.deepEqual([...PAGE_SIZES], [25, 50, 100]);
  assert.equal(DEFAULT_PAGE_SIZE, 25);
  assert.equal(readPageSize('50'), 50);
  assert.equal(readPageSize('100'), 100);
  for (const raw of [null, '', '30', '-50', '50.5', 'abc', '1e9']) {
    assert.equal(readPageSize(raw), 25, String(raw));
  }
});

test('readOrder: oldest only when asked, newest otherwise', () => {
  assert.equal(readOrder('oldest'), 'oldest');
  for (const raw of [null, '', 'newest', 'OLDEST', 'asc']) assert.equal(readOrder(raw), 'newest');
});

test('pageOf: the page, clamped, and its slice', () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);
  assert.deepEqual(pageOf(items, null, 50), {
    page: 1,
    pages: 3,
    first: 0,
    items: items.slice(0, 50),
  });
  assert.deepEqual(pageOf(items, '3', 50).items, items.slice(100, 120));
  assert.equal(pageOf(items, '4', 50).page, 1); // out of range: the first page
  assert.equal(pageOf(items, '2.5', 50).page, 1);
  assert.equal(pageOf(items, '2', 100).items.length, 20);
  assert.deepEqual(pageOf([], '2', 25), { page: 1, pages: 1, first: 0, items: [] });
});
