import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { readLog } from '../src/log-import/read.js';
import {
  PATH_PARAM,
  decodeOnce,
  parseQuery,
  splitTarget,
  toRequest,
} from '../src/log-import/request.js';
import { MAX_TEXT_CHARS, isGzip, readFiles, readText } from '../src/log-import/text.js';

const DIR = new URL('../src/log-import/formats/', import.meta.url);
const FORMATS = [];
for (const file of readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  FORMATS.push((await import(new URL(file, DIR).href)).default);
}
const line = (path, n = 1) =>
  `192.0.2.${n} - - [01/Nov/2026:10:00:00 +0000] "GET ${path} HTTP/1.1" 200 10 "-" "test"`;

test('readLog: counts what it read, what it skipped and what it could not read', () => {
  const text = [
    line('/a'),
    '',
    'garbage that no format reads',
    '192.0.2.9 - - [01/Nov/2026:10:00:00 +0000] "-" 400 0 "-" "-"',
    line('/b?x=1'),
  ].join('\n');
  const read = readLog(text, FORMATS);
  assert.equal(read.format.id, 'apache');
  assert.equal(read.lines, 4); // empty lines are not counted
  assert.equal(read.entries.length, 2);
  assert.deepEqual(
    read.entries.map((e) => e.line),
    [1, 5],
  );
  assert.equal(read.skipped, 1);
  assert.equal(read.unreadable, 1);
  assert.deepEqual(read.examples, [{ line: 3, text: 'garbage that no format reads' }]);
  assert.equal(read.truncated, false);
});

test('readLog: a format chosen by hand, and the cap on requests', () => {
  const text = Array.from({ length: 30 }, (_, i) => line(`/p${i}`)).join('\n');
  const forced = readLog(text, FORMATS, { formatId: 'request-line' });
  assert.equal(forced.format.id, 'request-line');
  assert.equal(forced.entries.length, 30);
  const capped = readLog(text, FORMATS, { maxRequests: 10 });
  assert.equal(capped.entries.length, 10);
  assert.equal(capped.truncated, true);
});

test('targets: paths kept as logged, absolute URLs, queries decoded once', () => {
  assert.deepEqual(splitTarget('/a/../b?x=1#frag'), { path: '/a/../b', query: 'x=1', host: null });
  assert.deepEqual(splitTarget('https://www.example.com:443/s?q=1'), {
    path: '/s',
    query: 'q=1',
    host: 'www.example.com:443',
  });
  assert.deepEqual(splitTarget('http://www.example.com'), {
    path: '/',
    query: '',
    host: 'www.example.com',
  });
  assert.equal(decodeOnce('a+b%20c'), 'a b c');
  assert.equal(decodeOnce('100%25'), '100%');
  assert.equal(
    decodeOnce('%2527'),
    '%27',
    'one pass only: double encoding stays visible (ADR-006)',
  );
  assert.equal(decodeOnce('bad%E0%A4end %41'), 'bad%E0%A4end A', 'a broken escape is kept');
  assert.equal(decodeOnce('/a+b', { plusIsSpace: false }), '/a+b');
  assert.deepEqual(parseQuery('a=1&b&a=2&=x&c=%3Cs%3E'), {
    a: '1',
    b: '',
    'a#2': '2',
    '': 'x',
    c: '<s>',
  });
});

test('toRequest: the detector sees the parameters and the decoded path', () => {
  const request = toRequest({ method: 'GET', target: '/files/..%2F..%2Fetc%2Fpasswd?name=a+b' });
  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/files/..%2F..%2Fetc%2Fpasswd');
  assert.deepEqual(request.params, { name: 'a b', [PATH_PARAM]: '/files/../../etc/passwd' });
  const clash = toRequest({ method: 'GET', target: `/x?${encodeURIComponent(PATH_PARAM)}=1` });
  assert.deepEqual(Object.keys(clash.params), [PATH_PARAM, `${PATH_PARAM}#2`]);
  assert.equal(toRequest({ method: 'OPTIONS', target: '*' }).path, '*');
});

const gzip = (text) =>
  new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();

test('files: plain and gzip, several in name order', async () => {
  const plain = new Blob([`${line('/plain')}\n`]);
  assert.equal(await isGzip(plain), false);
  assert.deepEqual(await readText(plain), { text: `${line('/plain')}\n`, cut: false });
  const zipped = await gzip(`${line('/zipped')}\n`);
  assert.equal(await isGzip(zipped), true);
  assert.deepEqual(await readText(zipped), { text: `${line('/zipped')}\n`, cut: false });
  const joined = await readFiles([
    new File([line('/second')], 'b.log'),
    new File([line('/first')], 'a.log'),
  ]);
  assert.deepEqual(joined, { text: `${line('/first')}\n${line('/second')}\n`, cut: [] });
  assert.equal(MAX_TEXT_CHARS, 100 * 1024 * 1024);
});

test('files: only the start of a large log is kept, cut at the end of a line', async () => {
  assert.deepEqual(await readText(new Blob(['a\nbb\nccc\n']), { maxChars: 5 }), {
    text: 'a\nbb\n',
    cut: true,
  });
  assert.deepEqual(await readText(new Blob(['a\nbb\n']), { maxChars: 5 }), {
    text: 'a\nbb\n',
    cut: false,
  });
  // a gzip file expands: the budget is on the text, not on the file
  const zipped = await gzip(`${'x'.repeat(5000)}\n`.repeat(200));
  assert.ok(zipped.size < 5000);
  const kept = await readText(zipped, { maxChars: 12000 });
  assert.equal(kept.cut, true);
  assert.equal(kept.text, `${'x'.repeat(5000)}\n`.repeat(2));
  // several files share the budget: once one is cut, the later ones are left out
  const files = [
    new File(['1234\n'], 'a.log'),
    new File(['5678\n9\n'], 'b.log'),
    new File(['0\n'], 'c.log'),
  ];
  assert.deepEqual(await readFiles(files, { maxChars: 8 }), {
    text: '1234\n',
    cut: ['b.log', 'c.log'],
  });
});
