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

test('Apache and Nginx behind a proxy, and before quotes were escaped', () => {
  const after = ' - - [01/Nov/2026:10:00:00 +0000] "GET /a HTTP/1.1" 200 12 "-" "UA"';
  const who = (line) => {
    const entry = readOne('apache', line);
    return [entry.fields.vhost ?? null, entry.fields.ip, entry.target, entry.fields.userAgent];
  };
  assert.deepEqual(who(`203.0.113.7, 10.0.0.1${after}`), [
    null,
    '203.0.113.7, 10.0.0.1',
    '/a',
    'UA',
  ]);
  assert.deepEqual(who(`www.example.com 192.0.2.1${after}`), [
    'www.example.com',
    '192.0.2.1',
    '/a',
    'UA',
  ]);
  assert.deepEqual(who(`www.example.com:80 "203.0.113.7, 10.0.0.1" 192.0.2.1${after}`), [
    'www.example.com:80',
    '"203.0.113.7, 10.0.0.1" 192.0.2.1',
    '/a',
    'UA',
  ]);
  assert.deepEqual(who(`unix:${after}`), [null, 'unix:', '/a', 'UA']);
  // Apache before 2.0.46 wrote a quote of the request as it came
  const old = readOne(
    'apache',
    '192.0.2.1 - - [01/Jul/1995:00:00:01 -0400] "GET /a"b.html HTTP/1.0" 404 - "-" "UA"',
  );
  assert.deepEqual([old.target, old.status, old.fields.userAgent], ['/a"b.html', 404, 'UA']);
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
  values[0] = '2026-11-01';
  values[5] = 'GET';
  values[7] = '/no-header';
  const noHeader = readOne('w3c', values.join('\t'));
  assert.equal(noHeader.target, '/no-header?v11');
  // Not every line with 26 words is CloudFront: a JSON line with spaces is not read as one.
  const words = Array.from({ length: 30 }, (_, i) => (i === 5 ? 'GET' : `w${i}`)).join(' ');
  assert.equal(byId('w3c').reader()(`{"note":"${words}"}`), null);
});

test('IIS lines without their #Fields header, as when a few are copied out of a file', () => {
  // IIS writes its fields in a fixed order; the request and the three status codes are found by
  // their shape, whatever the other columns chosen (default, all of them, or a custom set).
  const lines = [
    '2026-11-01 09:10:03 10.0.0.4 GET /default.aspx id=42 443 - 203.0.113.5 Mozilla/5.0+(Windows+NT+10.0) - 200 0 0 15',
    '2026-11-01 09:10:04 W3SVC1 WEB01 10.0.0.4 GET /pbserver/cmd.exe /c+dir+c:\\ 80 - 198.51.100.7 HTTP/1.1 scanner/1.0 - - www.example.com 404 0 2 1245 310 15',
    '2026-11-01 09:10:05 10.0.0.4 POST /api/orders - 443 - 192.0.2.9 curl/8.4.0 - 201 0 0 31 198.51.100.20',
  ];
  const read = readLog(lines.join('\n'), FORMATS);
  assert.equal(read.format.id, 'w3c');
  assert.equal(read.entries.length, 3);
  const [first, second, third] = read.entries;
  assert.deepEqual(
    [first.method, first.target, first.status, first.fields['c-ip'], first.time],
    ['GET', '/default.aspx?id=42', 200, '203.0.113.5', '2026-11-01 09:10:03'],
  );
  assert.deepEqual(
    [second.target, second.status, second.fields['c-ip']],
    ['/pbserver/cmd.exe?/c+dir+c:\\', 404, '198.51.100.7'],
  );
  assert.deepEqual([third.method, third.target, third.status], ['POST', '/api/orders', 201]);
  // A line that does not fit the header above it is read by its shape too.
  const header =
    '#Fields: date time s-sitename s-computername s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs-version cs(User-Agent) cs(Cookie) cs(Referer) cs-host sc-status sc-substatus sc-win32-status sc-bytes cs-bytes time-taken';
  const mixed = readLog([header, lines[1], lines[0]].join('\n'), FORMATS);
  assert.equal(mixed.entries.length, 2);
  assert.equal(mixed.entries[1].target, '/default.aspx?id=42');
  // Other W3C writers: values apart by several spaces, the whole URI as cs-uri.
  const oracle = readLog(
    [
      '#Fields:  c-ip  date  time  cs-method  cs-uri  sc-status  bytes',
      '192.0.2.4      2026-11-01     09:10:06      GET      /images/a.gif?v=2    200     350',
    ].join('\n'),
    FORMATS,
  );
  assert.deepEqual(
    [oracle.format.id, oracle.entries[0].target, oracle.entries[0].status],
    ['w3c', '/images/a.gif?v=2', 200],
  );
  // A date, a time and a request are not enough: no status codes, no IIS line.
  assert.equal(byId('w3c').reader()('2026-11-01 09:10:07 GET /a HTTP/1.1 200'), null);
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

test('JSON logs of CDNs, firewalls and gateways, and JSON behind a prefix', () => {
  const read = (line) => {
    const entry = readOne('json', line);
    return entry === SKIP ? SKIP : [entry.method, entry.target, entry.status];
  };
  // Cloudflare
  assert.deepEqual(
    read(
      '{"ClientIP":"192.0.2.1","ClientRequestMethod":"GET","ClientRequestURI":"/a?x=1","EdgeResponseStatus":200,"EdgeStartTimestamp":"2026-11-01T09:00:00Z"}',
    ),
    ['GET', '/a?x=1', 200],
  );
  // AWS WAF: the request inside httpRequest, the query apart, the headers a list of objects
  const waf = readOne(
    'json',
    '{"timestamp":1793523600000,"action":"BLOCK","httpRequest":{"clientIp":"192.0.2.1","headers":[{"name":"Host","value":"www.example.com"}],"uri":"/search","args":"q=1%27%20OR%201%3D1","httpMethod":"GET"}}',
  );
  assert.deepEqual([waf.method, waf.target], ['GET', '/search?q=1%27%20OR%201%3D1']);
  assert.equal(waf.fields['httpRequest.headers'], '[{"name":"Host","value":"www.example.com"}]');
  // AWS API Gateway HTTP APIs log the route, not the path
  assert.deepEqual(
    read('{"requestId":"r1","httpMethod":"GET","routeKey":"GET /items/{id}","status":"200"}'),
    ['GET', '/items/{id}', 200],
  );
  // Azure: everything inside "properties"
  assert.deepEqual(
    read(
      '{"category":"FrontdoorAccessLog","properties":{"httpMethod":"POST","requestUri":"https://www.example.com:443/login","httpStatusCode":"401"}}',
    ),
    ['POST', 'https://www.example.com:443/login', 401],
  );
  // Docker Compose and Kubernetes write the container's line after their own words
  const compose = readOne('json', 'web  | {"request":{"method":"GET","uri":"/a"},"status":200}');
  assert.deepEqual([compose.target, compose.fields.prefix], ['/a', 'web  |']);
  assert.deepEqual(read('2026-11-01T09:00:00.1Z stdout F {"method":"GET","path":"/b"}'), [
    'GET',
    '/b',
    null,
  ]);
  // A JSON line without a request is a line of the format that holds none
  assert.equal(read('{"level":"info","msg":"server started"}'), SKIP);
  assert.equal(read('{"httpMethod":"N/A","requestUri":"N/A"}'), SKIP);
});

test('any request line: HAProxy writes the status first, Docker escapes the quotes', () => {
  const haproxy = readOne('request-line', byId('request-line').examples[0]);
  assert.deepEqual([haproxy.target, haproxy.status], ['/search?q=blue+shoes', 200]);
  const docker = readOne(
    'request-line',
    '{"log":"192.0.2.1 - - [01/Nov/2026:10:00:00 +0000] \\"GET /a?x=1 HTTP/1.1\\" 404 10 \\"-\\" \\"UA\\"\\n","stream":"stdout"}',
  );
  assert.deepEqual([docker.method, docker.target, docker.status], ['GET', '/a?x=1', 404]);
  // Apache lines with words before them keep the client apart
  const prefixed = readOne(
    'apache',
    '2026-11-01T10:00:00.1Z stdout F 192.0.2.1 - - [01/Nov/2026:10:00:00 +0000] "GET /a HTTP/1.1" 200 1',
  );
  assert.deepEqual(
    [prefixed.fields.prefix, prefixed.fields.ip, prefixed.fields.vhost],
    ['2026-11-01T10:00:00.1Z stdout F', '192.0.2.1', undefined],
  );
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
