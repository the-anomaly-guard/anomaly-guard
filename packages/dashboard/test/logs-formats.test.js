import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { SKIP, parseRequestLine, splitFields, unescapeLogText } from '../src/log-import/format.js';
import { readLog, rankFormats, splitLines } from '../src/log-import/read.js';

// Every format in src/log-import/formats/, found the way the page finds them: a new file is checked by
// these tests with no change here.
const DIR = new URL('../src/log-import/formats/', import.meta.url);
const FORMATS = [];
for (const file of readdirSync(DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  FORMATS.push((await import(new URL(file, DIR).href)).default);
}
const byId = (id) => FORMATS.find((f) => f.id === id);
const readOne = (id, line) => byId(id).reader()(line);

test('every format follows the contract', () => {
  assert.ok(FORMATS.length >= 6, `${FORMATS.length} formats`);
  assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length, 'ids are unique');
  for (const f of FORMATS) {
    assert.match(f.id, /^[a-z0-9-]+$/, f.id);
    assert.ok(f.label && typeof f.priority === 'number', f.id);
    assert.ok(Array.isArray(f.examples) && f.examples.length > 0, `${f.id}: examples`);
    assert.equal(typeof f.reader(), 'function', `${f.id}: reader() gives a line reader`);
    // Synthetic examples only: documentation addresses and example domains (AGENTS.md §5)
    for (const line of f.examples) {
      for (const ip of line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []) {
        assert.match(ip, /^(192\.0\.2|198\.51\.100|203\.0\.113|10)\./, `${f.id}: ${ip}`);
      }
    }
  }
});

test('every format reads its own examples, and is the one recognised for them', () => {
  for (const f of FORMATS) {
    const read = readLog(f.examples.join('\n'), FORMATS);
    assert.equal(read.format?.id, f.id, `${f.id}: recognised as ${read.format?.id}`);
    assert.equal(read.unreadable, 0, `${f.id}: ${JSON.stringify(read.examples)}`);
    assert.ok(read.entries.length > 0, f.id);
    for (const entry of read.entries) {
      assert.match(entry.method, /^[A-Z][A-Z-]+$/, f.id);
      assert.ok(entry.target.length > 0, f.id);
      assert.equal(typeof entry.fields, 'object', f.id);
    }
  }
});

test('a specific format wins over the generic ones on a tie', () => {
  const apacheLine = byId('apache').examples[0];
  const ranked = rankFormats([apacheLine], FORMATS).map((r) => r.format.id);
  assert.deepEqual(ranked.slice(0, 2), ['apache', 'request-line']);
});

test('lines of no format, and empty text, are read by nothing', () => {
  for (const line of ['hello world', '', '{"no": "request"}', '#Comment without a header']) {
    for (const f of FORMATS) {
      const result = f.reader()(line);
      assert.ok(result === null || result === SKIP, `${f.id} read "${line}"`);
    }
  }
  assert.equal(readLog('just text\nmore text\n', FORMATS).format, null);
});

test('Apache and Nginx: escapes, missing user agent, vhost prefix, odd requests', () => {
  const nginx = readOne(
    'apache',
    '192.0.2.1 - - [01/Nov/2026:10:00:00 +0000] "GET /a?q=\\x22quoted\\x22 HTTP/1.1" 200 12 "-" "UA \\"x\\""',
  );
  assert.equal(nginx.target, '/a?q="quoted"');
  assert.equal(nginx.fields.userAgent, 'UA "x"');
  const common = readOne(
    'apache',
    '192.0.2.1 - bob [01/Nov/2026:10:00:00 +0000] "HEAD / HTTP/1.0" 304 -',
  );
  assert.equal(common.method, 'HEAD');
  assert.equal(common.status, 304);
  assert.equal(common.fields.user, 'bob');
  assert.equal(common.fields.userAgent, undefined);
  const vhost = readOne('apache', byId('apache').examples[4]);
  assert.equal(vhost.fields.vhost, 'www.example.com:443');
  // a TLS handshake sent to the HTTP port is an Apache line without a request
  assert.equal(
    readOne('apache', '192.0.2.1 - - [01/Nov/2026:10:00:00 +0000] "\\x16\\x03\\x01" 400 0'),
    SKIP,
  );
  const ipv6 = readOne(
    'apache',
    '2001:db8::1 - - [01/Nov/2026:10:00:00 +0000] "GET /x HTTP/1.1" 200 1',
  );
  assert.equal(ipv6.fields.ip, '2001:db8::1');
});

test('AWS load balancers: the absolute URL, ALB and Classic layouts, TCP lines', () => {
  const [alb, , classic] = byId('alb').examples.map((line) => readOne('alb', line));
  assert.equal(alb.target, 'https://www.example.com:443/search?q=blue+shoes');
  assert.equal(alb.fields.client, '192.0.2.10:52734');
  assert.equal(alb.fields.domain_name, 'www.example.com');
  assert.equal(alb.status, 200);
  assert.equal(classic.fields.backend, '10.0.2.20:80');
  const tcp =
    '2026-11-01T09:00:03Z classic 203.0.113.5:61234 10.0.2.20:80 0.1 0.1 0.1 - - 0 0 "- - - " "-" - -';
  assert.equal(readOne('alb', tcp), SKIP);
});

test('W3C extended: headers, CloudFront tabs, IIS spaces, CloudFront without a header', () => {
  const read = readLog(byId('w3c').examples.join('\n'), FORMATS, { formatId: 'w3c' });
  assert.equal(read.skipped, 3); // #Version and two #Fields
  const [cloudfront, attack, iis] = read.entries;
  assert.equal(cloudfront.fields['cs(Host)'], 'd111111abcdef8.cloudfront.net');
  assert.equal(attack.target, '/search?q=%3Cscript%3Ealert(1)%3C/script%3E');
  assert.equal(iis.fields['c-ip'], '203.0.113.5');
  assert.equal(iis.time, '2026-11-01 09:10:03');
  const values = Array.from({ length: 33 }, (_, i) => `v${i}`);
  values[5] = 'GET';
  values[7] = '/no-header';
  const noHeader = readOne('w3c', values.join('\t'));
  assert.equal(noHeader.target, '/no-header?v11');
});

test('S3 access logs and JSON logs', () => {
  const s3 = readOne('s3', byId('s3').examples[1]);
  assert.equal(s3.status, 403);
  assert.equal(s3.fields.operation, 'WEBSITE.GET.OBJECT');
  assert.equal(s3.fields.remote_ip, '198.51.100.7');
  const lifecycle =
    'owner bucket [01/Nov/2026:09:20:03 +0000] AWS:Service - REQID S3.EXPIRE.OBJECT key "-" - - - - - - "-" "-" -';
  assert.equal(readOne('s3', lifecycle), SKIP);

  const [caddy, traefik, apiGateway, gcp] = byId('json').examples.map((line) =>
    readOne('json', line),
  );
  assert.equal(caddy.target, '/search?q=blue+shoes');
  assert.equal(caddy.fields['request.remote_ip'], '192.0.2.10');
  assert.equal(traefik.method, 'GET');
  assert.equal(apiGateway.status, 401);
  assert.equal(gcp.target, 'https://www.example.com/profile?email=a%40example.com');
  const ecs = readOne(
    'json',
    '{"http":{"request":{"method":"get"}},"url":{"path":"/x","query":"a=1"}}',
  );
  assert.equal(ecs.method, 'GET');
  assert.equal(ecs.target, '/x?a=1');
  const nginxJson = readOne('json', '{"request":"POST /login HTTP/1.1","status":"200"}');
  assert.deepEqual([nginxJson.method, nginxJson.target, nginxJson.status], ['POST', '/login', 200]);
});

test('helpers: request lines, fields, escapes, lines', () => {
  assert.deepEqual(parseRequestLine('GET /a b HTTP/1.1'), {
    method: 'GET',
    target: '/a b',
    protocol: 'HTTP/1.1',
  });
  assert.deepEqual(parseRequestLine('GET /old'), { method: 'GET', target: '/old', protocol: null });
  assert.equal(parseRequestLine('-'), null);
  assert.equal(parseRequestLine('\u0016\u0003\u0001'), null);
  assert.deepEqual(
    splitFields('a "b \\" c" [d e] f').map((x) => x.value),
    ['a', 'b \\" c', 'd e', 'f'],
  );
  assert.equal(unescapeLogText('\\xE6\\x9D\\xB1 \\" \\\\'), '東 " \\');
  assert.deepEqual(splitLines('a\r\nb\rc\nd\n'), ['a', 'b', 'c', 'd']);
});
