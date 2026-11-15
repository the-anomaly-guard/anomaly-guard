// Tiny DOM helpers. Every piece of data - attack payloads included - is inserted as TEXT, never
// as HTML: there is no innerHTML with data anywhere in the dashboard. A payload is measured and
// shown, never rendered or executed (ADR-001).

/** @typedef {Node | string | number | null | undefined | false | Child[]} Child */

/**
 * Create an element. `attrs` are plain attributes (`true` -> empty attribute; null, undefined and
 * false are skipped), plus `class` and `dataset`. No `style`: the CSP forbids inline styles, so
 * use a class.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...Child} children  strings and numbers become text nodes
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'style') throw new Error('h(): no inline styles (CSP) - use a class');
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  return append(node, children);
}

/**
 * Append children as nodes or text.
 * @template {Node} N
 * @param {N} node
 * @param {Child[]} children
 * @returns {N}
 */
export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/**
 * Replace the contents of the element matching `selector`.
 * @param {string} selector
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function mount(selector, ...children) {
  const host = /** @type {HTMLElement | null} */ (document.querySelector(selector));
  if (!host) throw new Error(`mount: ${selector} not found`);
  host.replaceChildren();
  return append(host, children);
}

/**
 * Make `nodes` the children of `parent`, in order, touching only what changed: a node that stays
 * keeps its place and its identity, so a click that has started on it is not lost when the page
 * draws again (the live replay draws about ten times a second).
 * @param {Element} parent
 * @param {Node[]} nodes
 */
export function patchChildren(parent, nodes) {
  nodes.forEach((node, i) => {
    const current = parent.childNodes[i] ?? null;
    if (current !== node) parent.insertBefore(node, current);
  });
  while (parent.childNodes.length > nodes.length) parent.lastChild?.remove();
}

/**
 * Set an element's text only when it changes (no needless redraw).
 * @param {Element} node
 * @param {string} text
 */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * An SVG element (h() makes HTML ones, which an <svg> cannot hold).
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {...SVGElement} children
 */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** Number formatting, the same on every page. */
export const fmt = {
  /** @param {number} n */
  int: (n) => n.toLocaleString('en-US'),
  /**
   * A count and its noun, singular for one: "1 alert", "2 alerts".
   * @param {number} n
   * @param {string} noun  singular, with a regular plural in -s
   */
  count: (n, noun) => `${n.toLocaleString('en-US')} ${n === 1 ? noun : `${noun}s`}`,
  /** @param {number} x  a share in 0-1 */
  pct: (x) => `${(x * 100).toFixed(1)}%`,
  /** @param {number} s  a −log10(p) score; +Infinity is a rule hit in combined mode */
  score: (s) => (Number.isFinite(s) ? s.toFixed(2) : '∞'),
};
