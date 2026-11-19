// Read a log: find its format, then turn every line into a request (E-10, ADR-016). The formats
// come from outside, as a list: this file knows none of them, so a new format never changes it
// (open for extension, closed for modification). Pure: no DOM, tested in Node.

import { SKIP } from './format.js';

/** Lines read to recognise the format. */
export const SAMPLE_LINES = 200;

/** Requests kept from one text: enough for any analysis the browser can do in seconds. */
export const MAX_REQUESTS = 100000;

/** Unreadable lines kept as examples, to show what went wrong. */
const EXAMPLES = 5;

/**
 * The lines of a text, without line ends; Windows and old Mac line ends too.
 * @param {string} text
 */
export function splitLines(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * How well each format reads the first lines: the share of the lines it recognises that hold a
 * request it can read (lines it skips, such as headers, do not count). The best format wins; on a
 * tie the one with the higher priority, the more specific.
 * @param {string[]} lines
 * @param {import('./format.js').LogFormat[]} formats
 * @returns {{ format: import('./format.js').LogFormat, score: number }[]}  best first; formats
 *   that read none of the lines are left out
 */
export function rankFormats(lines, formats) {
  const sample = lines.filter((line) => line.trim() !== '').slice(0, SAMPLE_LINES);
  const ranked = [];
  for (const format of formats) {
    const read = format.reader();
    let requests = 0;
    let misses = 0;
    for (const line of sample) {
      const result = read(line);
      if (result === SKIP) continue;
      if (result === null) misses++;
      else requests++;
    }
    if (requests > 0) ranked.push({ format, score: requests / (requests + misses) });
  }
  return ranked.sort((a, b) => b.score - a.score || b.format.priority - a.format.priority);
}

/**
 * @typedef {Object} ReadResult
 * @property {import('./format.js').LogFormat | null} format  null when no format reads the text
 * @property {number} score             share of the sample lines the format read
 * @property {import('./format.js').LogEntry[]} entries
 * @property {number} lines             non-empty lines seen
 * @property {number} skipped           lines of the format without a request (headers, "-")
 * @property {number} unreadable        lines the format could not read
 * @property {{ line: number, text: string }[]} examples  the first unreadable lines
 * @property {boolean} truncated        true when the text held more than `maxRequests` requests
 */

/**
 * Read a whole text with one format: the one asked for, or the best one for its first lines.
 * @param {string} text
 * @param {import('./format.js').LogFormat[]} formats
 * @param {{ formatId?: string, maxRequests?: number }} [options]  formatId 'auto' (default) or
 *   a format's id
 * @returns {ReadResult}
 */
export function readLog(text, formats, { formatId = 'auto', maxRequests = MAX_REQUESTS } = {}) {
  const lines = splitLines(text);
  const chosen =
    formatId === 'auto'
      ? (rankFormats(lines, formats)[0] ?? null)
      : { format: formats.find((f) => f.id === formatId) ?? null, score: NaN };
  /** @type {ReadResult} */
  const result = {
    format: chosen?.format ?? null,
    score: chosen?.score ?? 0,
    entries: [],
    lines: 0,
    skipped: 0,
    unreadable: 0,
    examples: [],
    truncated: false,
  };
  if (!result.format) {
    result.lines = lines.filter((line) => line.trim() !== '').length;
    return result;
  }
  const read = result.format.reader();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    result.lines++;
    const entry = read(line);
    if (entry === SKIP) result.skipped++;
    else if (entry === null) {
      result.unreadable++;
      if (result.examples.length < EXAMPLES) result.examples.push({ line: i + 1, text: line });
    } else if (result.entries.length >= maxRequests) {
      result.truncated = true;
      break;
    } else result.entries.push({ line: i + 1, ...entry });
  }
  if (Number.isNaN(result.score)) {
    result.score = result.lines
      ? result.entries.length / Math.max(1, result.lines - result.skipped)
      : 0;
  }
  return result;
}
