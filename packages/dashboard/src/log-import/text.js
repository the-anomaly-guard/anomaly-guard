// The text of the files the user picks (E-10, ADR-016): plain or gzip-compressed, the way AWS
// delivers its logs. Read with the browser's own streams (DecompressionStream, TextDecoder): no
// library, and nothing leaves the page. Works in Node too, for the tests.
//
// The text is read as a stream and only its start is kept: the first MAX_TEXT_LINES lines, and
// never more than MAX_TEXT_CHARS characters. The page analyses the first 100,000 requests of a
// log anyway (MAX_REQUESTS, read.js), and a gzip file expands about ten times: a real 20 MB .gz
// of 1.9 million lines held 205 MB of text, which took the browser tab to 721 MB of memory, and
// the baseline is a second log (ADR-017). Reading all of a larger one would exhaust it.
//
// A gzip file may hold several compressed streams one after the other ("members"): Nginx writes
// one per buffer with `access_log ... gzip`, and `cat a.gz b.gz` joins two. DecompressionStream
// reads one and then fails on the rest, and Chromium drops the end of the first when it does. So
// after such a failure each member is found and read on its own. A file cut short (a copy taken
// while the log was written) keeps the lines read before the damage, and the page says so.

/** Most text kept from one log (several files count together): 100 MB. */
export const MAX_TEXT_CHARS = 100 * 1024 * 1024;

/** Most lines kept from one log: twice the requests analysed, room for lines without one. */
export const MAX_TEXT_LINES = 200_000;

/** Bytes of compressed data searched at a time for the start of the next gzip member. */
const SEARCH_WINDOW = 64 * 1024;

/**
 * Whether a file starts with the gzip signature (1f 8b), whatever its name.
 * @param {Blob} blob
 */
export async function isGzip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * The text encoding of a plain file: UTF-16 when it starts with that byte order mark (Windows
 * tools such as PowerShell write it), UTF-8 otherwise.
 * @param {Blob} blob
 */
async function encodingOf(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
  if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  return 'utf-8';
}

/**
 * Pass the bytes of a stream to `push` until it ends, fails, or `push` asks to stop.
 * @param {ReadableStream<Uint8Array>} stream
 * @param {(bytes: Uint8Array) => boolean} push  false: enough
 * @param {number} [skip]  bytes not to pass on, already passed by an earlier read
 * @returns {Promise<{ size: number, end: 'done' | 'stopped' | 'failed' }>}  `size`: bytes read
 */
async function drain(stream, push, skip = 0) {
  const reader = stream.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { size, end: 'done' };
      const from = Math.max(0, skip - size);
      size += value.length;
      if (from < value.length && !push(from ? value.subarray(from) : value)) {
        reader.cancel().catch(() => {});
        return { size, end: 'stopped' };
      }
    }
  } catch {
    return { size, end: 'failed' };
  }
}

/** @param {Blob} blob */
const gunzip = (blob) => blob.stream().pipeThrough(new DecompressionStream('gzip'));

/**
 * Where a gzip member may start after `from`: the signature with the deflate method (1f 8b 08).
 * @param {Blob} blob
 * @param {number} from
 */
async function* memberStarts(blob, from) {
  for (let at = from; at < blob.size; at += SEARCH_WINDOW) {
    const bytes = new Uint8Array(await blob.slice(at, at + SEARCH_WINDOW + 2).arrayBuffer());
    for (let i = 0; i < Math.min(SEARCH_WINDOW, bytes.length - 2); i++) {
      if (bytes[i] === 0x1f && bytes[i + 1] === 0x8b && bytes[i + 2] === 0x08) yield at + i;
    }
  }
}

/**
 * The decompressed bytes of a gzip file, member after member, to `push`.
 * @param {Blob} blob
 * @param {(bytes: Uint8Array) => boolean} push
 * @returns {Promise<boolean>}  true when the file is damaged: the bytes before the damage were
 *   passed on, the rest could not be read
 */
async function readGzip(blob, push) {
  let start = 0;
  while (start < blob.size) {
    const first = await drain(gunzip(blob.slice(start)), push);
    if (first.end !== 'failed') return false;
    // Something follows the member, or it is cut short. A member starts where the data before
    // it decompresses with no error: try each place that looks like one, in order.
    let passed = first.size;
    let next = -1;
    for await (const at of memberStarts(blob, start + 18)) {
      const part = await drain(gunzip(blob.slice(start, at)), push, passed);
      if (part.end === 'stopped') return false;
      passed = Math.max(passed, part.size);
      if (part.end === 'done') {
        next = at;
        break;
      }
    }
    if (next === -1) return true;
    start = next;
  }
  return false;
}

/** @param {string} text */
const countLines = (text) => {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

/**
 * Where to cut a text so that it keeps whole lines only, at most `maxLines` of them and at most
 * `maxChars` characters.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} maxLines
 */
function cutAt(text, maxChars, maxLines) {
  const end = text.lastIndexOf('\n', maxChars - 1) + 1;
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) {
    if (++n === maxLines) return i + 1;
  }
  return end;
}

/**
 * The text of one file, decompressed when it is gzip: no more than `maxLines` lines and
 * `maxChars` characters, cut at the end of a line.
 * @param {Blob} blob
 * @param {{ maxChars?: number, maxLines?: number }} [options]
 * @returns {Promise<{ text: string, cut: boolean, damaged: boolean }>}  `cut`: the file holds more
 *   than was kept; `damaged`: it could be read only up to some point (it ends with a whole line)
 */
export async function readText(
  blob,
  { maxChars = MAX_TEXT_CHARS, maxLines = MAX_TEXT_LINES } = {},
) {
  if (maxLines <= 0) return { text: '', cut: blob.size > 0, damaged: false };
  const gzip = await isGzip(blob);
  const decoder = new TextDecoder(gzip ? 'utf-8' : await encodingOf(blob));
  let text = '';
  let lines = 0;
  const push = (/** @type {Uint8Array} */ bytes) => {
    const chunk = decoder.decode(bytes, { stream: true });
    text += chunk;
    lines += countLines(chunk);
    return text.length <= maxChars && lines <= maxLines;
  };
  const damaged = gzip
    ? await readGzip(blob, push)
    : (await drain(blob.stream(), push)).end === 'failed';
  if (text.length > maxChars || lines > maxLines) {
    return { text: text.slice(0, cutAt(text, maxChars, maxLines)), cut: true, damaged: false };
  }
  if (damaged)
    return { text: text.slice(0, text.lastIndexOf('\n') + 1), cut: false, damaged: true };
  return { text: text + decoder.decode(), cut: false, damaged: false };
}

/**
 * Several files as one log, in name order (AWS writes one file every few minutes, named by time).
 * They share the budgets of lines and characters: once a file is cut, the later ones are left out.
 * @param {File[]} files
 * @param {{ maxChars?: number, maxLines?: number }} [options]
 * @returns {Promise<{ text: string, cut: string[], damaged: string[] }>}  `cut`: the files read in
 *   part or not at all; `damaged`: those read only up to some damage
 * @throws {Error} when a file is damaged from its very start
 */
export async function readFiles(
  files,
  { maxChars = MAX_TEXT_CHARS, maxLines = MAX_TEXT_LINES } = {},
) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  let text = '';
  let lines = 0;
  /** @type {string[]} */
  const cut = [];
  /** @type {string[]} */
  const damaged = [];
  for (const file of sorted) {
    if (cut.length) {
      cut.push(file.name);
      continue;
    }
    const part = await readText(file, {
      maxChars: maxChars - text.length,
      maxLines: maxLines - lines,
    });
    if (part.damaged && !part.text) {
      throw new Error(
        `${file.name} could not be read: it is damaged or incomplete, or it changed after it was ` +
          'chosen (choose it again).',
      );
    }
    const whole = part.text && !part.text.endsWith('\n') ? `${part.text}\n` : part.text;
    text += whole;
    lines += countLines(whole);
    if (part.cut) cut.push(file.name);
    if (part.damaged) damaged.push(file.name);
  }
  return { text, cut, damaged };
}
