// The text of the files the user picks (E-10, ADR-016): plain or gzip-compressed, the way AWS
// delivers its logs. Read with the browser's own streams (DecompressionStream, TextDecoderStream):
// no library, and nothing leaves the page. Works in Node too, for the tests.
//
// The text is read as a stream and only its start is kept. The page analyses the first
// MAX_REQUESTS requests anyway (100,000 lines are some 10 to 60 MB), and a gzip file expands
// about ten times: a real 20 MB .gz of 1.9 million lines held 205 MB of text, which took the
// browser tab to 721 MB of memory. Reading all of a larger one would exhaust it.

/** Most text kept from one log (several files count together): 100 MB. */
export const MAX_TEXT_CHARS = 100 * 1024 * 1024;

/**
 * Whether a file starts with the gzip signature (1f 8b), whatever its name.
 * @param {Blob} blob
 */
export async function isGzip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * The text of one file, decompressed when it is gzip: no more than `maxChars` characters, cut at
 * the end of a line.
 * @param {Blob} blob
 * @param {{ maxChars?: number }} [options]
 * @returns {Promise<{ text: string, cut: boolean }>}  `cut`: the file holds more than was kept
 */
export async function readText(blob, { maxChars = MAX_TEXT_CHARS } = {}) {
  let stream = blob.stream();
  if (await isGzip(blob)) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text, cut: false };
    text += value;
    if (text.length > maxChars) {
      reader.cancel().catch(() => {});
      return { text: text.slice(0, text.lastIndexOf('\n', maxChars - 1) + 1), cut: true };
    }
  }
}

/**
 * Several files as one log, in name order (AWS writes one file every few minutes, named by time).
 * They share the MAX_TEXT_CHARS budget: once a file is cut, the later ones are left out.
 * @param {File[]} files
 * @param {{ maxChars?: number }} [options]
 * @returns {Promise<{ text: string, cut: string[] }>}  `cut`: the files read in part or not at all
 */
export async function readFiles(files, { maxChars = MAX_TEXT_CHARS } = {}) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  let text = '';
  /** @type {string[]} */
  const cut = [];
  for (const file of sorted) {
    if (cut.length) {
      cut.push(file.name);
      continue;
    }
    const part = await readText(file, { maxChars: maxChars - text.length });
    text += part.text && !part.text.endsWith('\n') ? `${part.text}\n` : part.text;
    if (part.cut) cut.push(file.name);
  }
  return { text, cut };
}
