// Apache and Nginx access logs: the Common Log Format, the Combined one (Nginx's default
// "combined" is the same) and Apache's vhost_combined, which starts with the virtual host. Fields
// after the user agent (some setups add the forwarded-for address or timings) are kept as `extra`.
//   %h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i"
// Behind a proxy the client is often a list, "203.0.113.7, 10.0.0.1", or a quoted one before the
// address; and logs older than Apache 2.0.46 did not escape a quote inside the request. Both are
// read: the client is all that comes before ident, user and the first [ (the time), the request
// runs to the quote that the status and the size follow.

import { SKIP, orNull, parseRequestLine, statusOf, unescapeLogText } from '../format.js';

const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const LINE = new RegExp(
  `^([^[\\]]+?) (\\S+) (\\S+) \\[([^\\]]+)\\] "(.*?)" (\\d{3}|-) (\\d+|-)` +
    `(?: ${QUOTED} ${QUOTED})?(?: (.*))?$`,
);

/** The client at the end of what comes before ident and user: an address or a list of them,
 * after a quoted list when a proxy logs one. Before it, the virtual host, or a prefix. */
const WHO = /^(?:(.+?) )??((?:"[^"]*" )?[^\s,"]+(?:, [^\s,"]+)*)$/;

/**
 * The client, and what comes before it: "192.0.2.1", "www.example.com:443 192.0.2.1", a list such
 * as "192.0.2.7, 10.0.0.1", or a prefix that another program wrote ("... stdout F 192.0.2.1").
 * @param {string} who
 * @returns {Record<string, string>}
 */
function client(who) {
  const m = WHO.exec(who);
  if (!m) return { ip: who };
  const [, before, ip] = m;
  if (!before) return { ip };
  return before.includes(' ') ? { prefix: before, ip } : { vhost: before, ip };
}

/** @type {import('../format.js').LogFormat} */
export default {
  id: 'apache',
  label: 'Apache / Nginx (common, combined)',
  priority: 50,
  examples: [
    '192.0.2.10 - - [01/Nov/2026:10:00:01 +0100] "GET /index.html HTTP/1.1" 200 5120 "-" "Mozilla/5.0 (X11; Linux x86_64)"',
    '198.51.100.7 - alice [01/Nov/2026:10:00:02 +0100] "GET /search?q=blue+shoes&page=2 HTTP/1.1" 200 2048 "https://www.example.com/" "Mozilla/5.0 (Macintosh)"',
    '203.0.113.5 - - [01/Nov/2026:10:00:03 +0100] "GET /products?id=1%27%20OR%20%271%27%3D%271 HTTP/1.1" 200 312 "-" "curl/8.4.0"',
    '192.0.2.44 - - [01/Nov/2026:10:00:04 +0100] "GET /../../etc/passwd HTTP/1.1" 400 0 "-" "scanner/1.0"',
    'www.example.com:443 198.51.100.23 - - [01/Nov/2026:10:00:05 +0100] "POST /login HTTP/2.0" 302 0 "-" "Mozilla/5.0"',
  ],
  reader() {
    return (line) => {
      const m = LINE.exec(line);
      if (!m) return null;
      const [, who, ident, user, time, request, status, bytes, referer, agent, extra] = m;
      const parsed = parseRequestLine(unescapeLogText(request));
      if (!parsed) return SKIP; // "-", or a TLS handshake sent to the HTTP port
      /** @type {Record<string, string>} */
      const fields = {
        ...client(who),
        ident,
        user,
        time,
        request: unescapeLogText(request),
        status,
        bytes,
      };
      if (referer !== undefined) fields.referer = unescapeLogText(referer);
      if (agent !== undefined) fields.userAgent = unescapeLogText(agent);
      if (extra) fields.extra = extra;
      return {
        method: parsed.method,
        target: parsed.target,
        time: orNull(time),
        status: statusOf(status),
        fields,
      };
    };
  },
};
