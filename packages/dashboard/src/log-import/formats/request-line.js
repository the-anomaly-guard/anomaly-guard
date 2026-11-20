// The last resort for any other text log: a line that contains an HTTP request line,
// "METHOD /path?query HTTP/x", wherever it is (HAProxy, Squid, custom formats, a line that Docker
// wrapped in JSON...). The client address, the time and the status are taken when the line makes
// them easy to find; the whole line is kept as a field.

import { statusOf } from '../format.js';

const METHODS =
  'GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|PROPFIND|PROPPATCH|MKCOL|COPY|MOVE|LOCK|UNLOCK|SEARCH';
const REQUEST = new RegExp(
  `(?:^|[\\s"'\\[(|,;{])(${METHODS}) ((?:/|https?://|\\*)[^\\s"]*) (HTTP/\\d(?:\\.\\d)?)(?=["'\\s\\]),|;}\\\\]|$)`,
);
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const BRACKETED_TIME = /\[(\d{2}\/\w{3}\/\d{4}:[^\]]+)\]/;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const STATUS_AFTER = /^\\?["']?\s+(\d{3})\b/;
/** HAProxy writes the status before the request, after its five timers: 0/0/1/12/13 200. */
const STATUS_BEFORE = /\s-?\d+\/-?\d+\/-?\d+\/-?\d+\/\+?-?\d+ (\d{3}) /;

/** @type {import('../format.js').LogFormat} */
export default {
  id: 'request-line',
  label: 'Any text log with a request line',
  priority: 10,
  examples: [
    'Nov  1 09:40:01 lb1 haproxy[1234]: 192.0.2.10:51234 [01/Nov/2026:09:40:01.123] www~ web/srv1 0/0/1/12/13 200 4096 - - ---- 1/1/0/0/0 0/0 "GET /search?q=blue+shoes HTTP/1.1"',
    '2026-11-01 09:40:02 app[web.1]: 198.51.100.7 "GET /comments?body=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E HTTP/1.1" 200 312',
  ],
  reader() {
    return (line) => {
      const m = REQUEST.exec(line);
      if (!m) return null;
      const after = line.slice((m.index ?? 0) + m[0].length);
      const time = BRACKETED_TIME.exec(line)?.[1] ?? ISO_TIME.exec(line)?.[0] ?? null;
      /** @type {Record<string, string>} */
      const fields = { line };
      const ip = IPV4.exec(line)?.[0];
      if (ip) fields.ip = ip;
      return {
        method: m[1],
        target: m[2],
        time,
        status: statusOf(
          STATUS_AFTER.exec(after)?.[1] ?? STATUS_BEFORE.exec(line.slice(0, m.index))?.[1],
        ),
        fields,
      };
    };
  },
};
