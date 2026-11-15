// Hover help on the acronyms and codes of every page (terms.js): each one is wrapped in an
// <abbr> whose title explains it, now and whenever the page draws something new, so new pages,
// tables and texts are covered with no change. Left alone: data shown as typed (`data-raw`:
// request values, patterns), code, form controls and table headers (glossary.js explains those).

import { h } from './dom.js';
import { findTerms } from './terms.js';
import { TERMS } from './term-data.js';

const SKIP = 'script, style, textarea, select, option, pre, code, svg, abbr, thead, [data-raw]';

/**
 * Wrap the terms in the text under `root` (an element, a text node or the document body).
 * @param {Node} root
 */
export function explainTerms(root) {
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE) return;
  if (root.parentElement?.closest(SKIP)) return;
  if (root.nodeType === Node.ELEMENT_NODE && /** @type {Element} */ (root).matches(SKIP)) return;
  /** @type {Text[]} */
  const texts = [];
  if (root.nodeType === Node.TEXT_NODE) texts.push(/** @type {Text} */ (root));
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return /** @type {Element} */ (node).matches(SKIP)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) texts.push(/** @type {Text} */ (walker.currentNode));
  }
  for (const text of texts) {
    const found = findTerms(text.data, TERMS);
    if (found.length === 0) continue;
    /** @type {(Node | string)[]} */
    const parts = [];
    let at = 0;
    for (const { index, term, help } of found) {
      if (index > at) parts.push(text.data.slice(at, index));
      parts.push(h('abbr', { title: help, 'data-term': true }, term));
      at = index + term.length;
    }
    if (at < text.data.length) parts.push(text.data.slice(at));
    text.replaceWith(...parts);
  }
}

/** Explain the terms now and in everything the page draws later. */
export function watchTerms() {
  explainTerms(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        if (record.target.isConnected) explainTerms(record.target);
        continue;
      }
      for (const node of record.addedNodes) if (node.isConnected) explainTerms(node);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
