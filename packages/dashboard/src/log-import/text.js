// The text of the files the user picks (E-10, ADR-016): plain or gzip-compressed, the way AWS
// delivers its logs. Read with the browser's own streams (DecompressionStream): no library, and
// nothing leaves the page. Works in Node too, for the tests.

/** Largest file read: beyond it the browser would struggle long before the analysis. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Whether a file starts with the gzip signature (1f 8b), whatever its name.
 * @param {Blob} blob
 */
export async function isGzip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * The text of one file, decompressed when it is gzip.
 * @param {Blob} blob
 * @throws {RangeError} beyond MAX_FILE_BYTES
 */
export async function readText(blob) {
  if (blob.size > MAX_FILE_BYTES) {
    throw new RangeError(
      `${'name' in blob ? blob.name : 'The file'} is ${(blob.size / 1048576).toFixed(0)} MB: ` +
        `the page reads files up to ${MAX_FILE_BYTES / 1048576} MB.`,
    );
  }
  if (await isGzip(blob)) {
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return blob.text();
}

/**
 * Several files as one log, in name order (AWS writes one file every few minutes, named by time).
 * @param {File[]} files
 */
export async function readFiles(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const texts = [];
  for (const file of sorted) texts.push(await readText(file));
  return texts.map((text) => (text.endsWith('\n') ? text : `${text}\n`)).join('');
}
