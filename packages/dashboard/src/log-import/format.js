// What a log format is (E-10, ADR-016), and the small helpers the formats share. Every file in
// src/log-import/formats/ exports one LogFormat as its default: the page and the tests find them there,
// so a new format is a new file and nothing else changes (open for extension, closed for
// modification). Pure: no DOM, tested in Node.

/**
 * One request read from a log line. Every value is a string as written in the log, except
 * `status`.
 * @typedef {Object} LogEntry
 * @property {number} line            1-based line number in the text that was read
 * @property {string} method          HTTP method
 * @property {string} target          the request target as logged: a path with its query string,
 *                                    or an absolute URL (load balancers log the whole URL)
 * @property {string | null} time     when, as the log writes it
 * @property {number | null} status   HTTP status code of the answer
 * @property {Record<string, string>} fields  every field of the line, by name: client address,
 *                                    user agent, referer, sizes, timings... (ADR-016: all kept)
 */

/**
 * What a line reader returns: a request (without its line number, added by the reader of the
 * whole text), SKIP for a line of this format that holds no request (a comment, a header, a TLS
 * handshake sent to the HTTP port), or null when the line is not in this format at all.
 * @typedef {Omit<LogEntry, 'line'> | typeof SKIP | null} LineResult
 */

/**
 * A log format: a plug-in of the Import logs page.
 * @typedef {Object} LogFormat
 * @property {string} id          unique, short: 'apache', 'alb'...
 * @property {string} label       shown in the format menu
 * @property {number} priority    breaks ties when several formats read a sample equally well: a
 *                                specific format above a generic one
 * @property {string[]} examples  a few synthetic lines (documentation addresses, example.com):
 *                                shown on the page, and read by the tests
 * @property {() => (line: string) => LineResult} reader  a fresh reader for one text; it may keep
 *                                state from line to line (the W3C `#Fields` header does)
 */

/** A line of the format that carries no request. */
export const SKIP = 'skip';

/** HTTP methods a request line may start with: WebDAV ones too, scanners send them. */
const METHOD = /^[A-Z][A-Z-]{1,15}$/;

/**
 * Split a request line, `GET /path?query HTTP/1.1`, into its parts. A target with spaces (a
 * client that did not encode them) is kept whole. Null when the text is not a request line.
 * @param {string} text
 * @returns {{ method: string, target: string, protocol: string | null } | null}
 */
export function parseRequestLine(text) {
  const parts = text.trim().split(/ +/);
  if (parts.length < 2 || !METHOD.test(parts[0])) return null;
  const last = parts[parts.length - 1];
  const hasProtocol = parts.length > 2 && /^HTTP\/\d(\.\d)?$/i.test(last);
  const target = (hasProtocol ? parts.slice(1, -1) : parts.slice(1)).join(' ');
  if (!target) return null;
  return { method: parts[0], target, protocol: hasProtocol ? last : null };
}

/**
 * Split a line into fields separated by spaces, where "a quoted field" and [a bracketed one]
 * may contain spaces, and a quoted field may escape a quote as \". The quotes and brackets are
 * removed; `quoted` and `bracketed` say which fields had them.
 * @param {string} line
 * @returns {{ value: string, quoted: boolean, bracketed: boolean }[]}
 */
export function splitFields(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      let j = i + 1;
      let value = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) {
          value += line[j] + line[j + 1];
          j += 2;
        } else value += line[j++];
      }
      fields.push({ value, quoted: true, bracketed: false });
      i = j + 1;
    } else if (line[i] === '[') {
      const end = line.indexOf(']', i);
      const stop = end === -1 ? line.length : end;
      fields.push({ value: line.slice(i + 1, stop), quoted: false, bracketed: true });
      i = stop + 1;
    } else {
      let j = i;
      while (j < line.length && line[j] !== ' ') j++;
      fields.push({ value: line.slice(i, j), quoted: false, bracketed: false });
      i = j;
    }
  }
  return fields;
}

/**
 * Undo the escaping Apache and Nginx apply to quoted fields: \" and \\, and \xHH for bytes
 * (read as UTF-8, so a multi-byte character escaped byte by byte comes back whole).
 * @param {string} text
 */
export function unescapeLogText(text) {
  if (!text.includes('\\')) return text;
  return text.replace(/(?:\\x[0-9a-fA-F]{2})+|\\(["\\])/g, (match, single) => {
    if (single) return single;
    const bytes = match.match(/[0-9a-fA-F]{2}/g)?.map((hex) => parseInt(hex, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  });
}

/** '-' is how the formats write an empty field. @param {string | undefined} value */
export function orNull(value) {
  return value === undefined || value === '' || value === '-' ? null : value;
}

/**
 * A status code, or null.
 * @param {string | undefined} value
 */
export function statusOf(value) {
  return value !== undefined && /^\d{3}$/.test(value) ? Number(value) : null;
}
