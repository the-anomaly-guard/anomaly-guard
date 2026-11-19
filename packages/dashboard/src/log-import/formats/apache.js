// Apache and Nginx access logs: the Common Log Format, the Combined one (Nginx's default
// "combined" is the same) and Apache's vhost_combined, which starts with host:port. Fields after
// the user agent (some setups add the forwarded-for address or timings) are kept as `extra`.
//   %h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i"

import { SKIP, orNull, parseRequestLine, statusOf, unescapeLogText } from '../format.js';

const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const LINE = new RegExp(
  `^(?:(\\S+:\\d+) )?(\\S+) (\\S+) (\\S+) \\[([^\\]]+)\\] ${QUOTED} (\\d{3}|-) (\\d+|-)` +
    `(?: ${QUOTED} ${QUOTED})?(?: (.*))?$`,
);

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
      const [, vhost, ip, ident, user, time, request, status, bytes, referer, agent, extra] = m;
      const parsed = parseRequestLine(unescapeLogText(request));
      if (!parsed) return SKIP; // "-", or a TLS handshake sent to the HTTP port
      /** @type {Record<string, string>} */
      const fields = { ip, ident, user, time, request: unescapeLogText(request), status, bytes };
      if (vhost) fields.vhost = vhost;
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
