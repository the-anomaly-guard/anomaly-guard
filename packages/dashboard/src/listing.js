// A list split into pages, chosen from the page (Security events, and any later list): how many
// rows per page and in which order, read from the page parameters `rows` and `order`. Pure: no
// DOM, tested in Node.

/** The page sizes on offer; the first is the default. */
export const PAGE_SIZES = Object.freeze([25, 50, 100]);

export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

/**
 * Rows per page from the `rows` page parameter: one of PAGE_SIZES, else the default.
 * @param {string | null} raw
 */
export function readPageSize(raw) {
  const n = Number(raw);
  return PAGE_SIZES.includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/**
 * The order from the `order` page parameter: 'oldest' (first request first), else 'newest'.
 * @param {string | null} raw
 * @returns {'newest' | 'oldest'}
 */
export function readOrder(raw) {
  return raw === 'oldest' ? 'oldest' : 'newest';
}

/**
 * One page of a list: the page number is clamped to the pages there are (1 if out of range).
 * @template T
 * @param {T[]} items
 * @param {string | number | null} rawPage
 * @param {number} size
 * @returns {{ page: number, pages: number, first: number, items: T[] }}
 */
export function pageOf(items, rawPage, size) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const n = Number(rawPage);
  const page = Number.isInteger(n) && n >= 1 && n <= pages ? n : 1;
  const first = (page - 1) * size;
  return { page, pages, first, items: items.slice(first, first + size) };
}
