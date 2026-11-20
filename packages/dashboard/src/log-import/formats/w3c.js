// The W3C extended log format: AWS CloudFront (fields separated by tabs) and Microsoft IIS
// (separated by spaces, with "+" for the spaces inside a value). The `#Fields:` header names the
// columns. Lines without it, as when a few are copied out of a file, are read too: CloudFront's
// standard columns, and IIS by the fixed order in which it writes its fields.

import { SKIP, orNull, statusOf } from '../format.js';

/** CloudFront's standard access log columns, in order (version 1.0). */
const CLOUDFRONT_FIELDS = [
  'date',
  'time',
  'x-edge-location',
  'sc-bytes',
  'c-ip',
  'cs-method',
  'cs(Host)',
  'cs-uri-stem',
  'sc-status',
  'cs(Referer)',
  'cs(User-Agent)',
  'cs-uri-query',
  'cs(Cookie)',
  'x-edge-result-type',
  'x-edge-request-id',
  'x-host-header',
  'cs-protocol',
  'cs-bytes',
  'time-taken',
  'x-forwarded-for',
  'ssl-protocol',
  'ssl-cipher',
  'x-edge-response-result-type',
  'cs-protocol-version',
  'fle-status',
  'fle-encrypted-fields',
  'c-port',
  'time-to-first-byte',
  'x-edge-detailed-result-type',
  'sc-content-type',
  'sc-content-len',
  'sc-range-start',
  'sc-range-end',
];

const METHOD = /^[A-Z][A-Z-]{1,15}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}:\d{2}/;
const NUMBER = /^\d+$/;
/** A path, or the absolute URL a proxy logs as `cs-uri`. */
const TARGET = /^(?:\/|[a-z][a-z0-9+.-]*:\/\/)/i;

/**
 * Column names for an IIS line without its header. IIS writes the fields it logs in a fixed
 * order: date time [s-sitename s-computername s-ip] cs-method cs-uri-stem cs-uri-query
 * [s-port cs-username c-ip ...] sc-status sc-substatus sc-win32-status [sc-bytes cs-bytes
 * time-taken]. The request and the three status codes are found by their shape; the rest keep
 * their position as a name. Null when the line does not have that shape.
 * @param {string[]} values
 */
function iisColumns(values) {
  if (!DATE.test(values[0]) || !CLOCK.test(values[1] ?? '')) return null;
  const method = values.findIndex(
    (value, i) => i >= 2 && METHOD.test(value) && (values[i + 1] ?? '').startsWith('/'),
  );
  if (method === -1 || /^HTTP\//.test(values[method + 2] ?? '')) return null;
  const status = values.findIndex(
    (value, i) =>
      i > method + 2 &&
      /^\d{3}$/.test(value) &&
      NUMBER.test(values[i + 1] ?? '') &&
      NUMBER.test(values[i + 2] ?? ''),
  );
  if (status === -1) return null;
  const names = values.map((_, i) => `field_${i + 1}`);
  names[0] = 'date';
  names[1] = 'time';
  names.splice(method, 3, 'cs-method', 'cs-uri-stem', 'cs-uri-query');
  names.splice(status, 3, 'sc-status', 'sc-substatus', 'sc-win32-status');
  if (NUMBER.test(values[method + 3] ?? '') && status > method + 5) {
    names.splice(method + 3, 3, 's-port', 'cs-username', 'c-ip');
  }
  return names;
}

/** @type {import('../format.js').LogFormat} */
export default {
  id: 'w3c',
  label: 'W3C extended (AWS CloudFront, IIS)',
  priority: 70,
  examples: [
    '#Version: 1.0',
    '#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) cs-uri-query',
    '2026-11-01\t09:10:01\tFRA56-P1\t4096\t192.0.2.10\tGET\td111111abcdef8.cloudfront.net\t/index.html\t200\t-\tMozilla/5.0%20(X11;%20Linux%20x86_64)\t-',
    '2026-11-01\t09:10:02\tFRA56-P1\t512\t198.51.100.7\tGET\td111111abcdef8.cloudfront.net\t/search\t200\t-\tcurl/8.4.0\tq=%3Cscript%3Ealert(1)%3C/script%3E',
    '#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus sc-win32-status time-taken',
    '2026-11-01 09:10:03 10.0.0.4 GET /default.aspx id=42 443 - 203.0.113.5 Mozilla/5.0+(Windows+NT+10.0) - 200 0 0 15',
  ],
  reader() {
    /** @type {string[] | null} */
    let names = null;
    return (line) => {
      if (line.startsWith('#')) {
        const header = /^#Fields:\s*(.*)$/.exec(line);
        if (header) names = header[1].trim().split(/\s+/);
        return /^#[A-Za-z-]+:/.test(line) ? SKIP : null;
      }
      const tabs = line.includes('\t');
      const values = tabs ? line.split('\t') : line.trim().split(/ +/);
      // The header names the columns of the lines it heads. An IIS line that does not fit it
      // (copied without its own header) is read by its shape, as a line with no header at all.
      let columns = names?.length === values.length ? names : null;
      if (!columns && !tabs) columns = iisColumns(values);
      if (!columns && !names && tabs && values.length >= 26 && DATE.test(values[0])) {
        columns = CLOUDFRONT_FIELDS;
      }
      columns ??= names;
      if (!columns || values.length < Math.min(columns.length, 3)) return null;
      /** @type {Record<string, string>} */
      const fields = {};
      values.forEach((value, i) => {
        fields[columns?.[i] ?? `field_${i + 1}`] = value;
      });
      const method = fields['cs-method'];
      const stem = orNull(fields['cs-uri-stem']) ?? orNull(fields['cs-uri']);
      if (!method || !METHOD.test(method) || !stem || !TARGET.test(stem)) return null;
      const query = fields['cs-uri-stem'] ? orNull(fields['cs-uri-query']) : null;
      const time = [orNull(fields.date), orNull(fields.time)].filter(Boolean).join(' ');
      return {
        method,
        target: query ? `${stem}?${query}` : stem,
        time: time || null,
        status: statusOf(fields['sc-status']),
        fields,
      };
    };
  },
};
