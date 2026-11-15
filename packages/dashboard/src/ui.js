// Small UI pieces shared by the pages.

import { h, fmt, svg } from './dom.js';
import { severityOf } from './levels.js';
import { PAGE_SIZES } from './listing.js';

/**
 * A KPI tile: a big number, its label and an optional detail line (e.g. a confidence interval).
 * @param {string} label
 * @param {number | string} value  numbers are formatted, strings shown as they are
 * @param {'neutral' | 'primary' | 'success' | 'warning' | 'danger'} [tone]
 * @param {string} [detail]
 */
export function kpi(label, value, tone = 'neutral', detail) {
  return h(
    'div',
    { class: `kpi is-${tone}` },
    h('span', { class: 'kpi-value' }, typeof value === 'number' ? fmt.int(value) : value),
    h('span', { class: 'kpi-label' }, label),
    detail ? h('span', { class: 'kpi-detail' }, detail) : null,
  );
}

/**
 * The coloured alert-level badge.
 * @param {number} level  0-15
 */
export function levelBadge(level) {
  const severity = severityOf(level);
  return h(
    'span',
    { class: `level sev-${severity}`, title: `Level ${level} · ${severity} severity` },
    String(level),
  );
}

/**
 * The order switch of a list of requests, the same everywhere: an arrow and "Newest first" or
 * "Oldest first". A button where the page reorders the rows itself (Overview), a link where it
 * opens the other order (Security events).
 * @param {'button' | 'a'} tag
 * @param {Record<string, any>} attrs
 * @param {boolean} newestFirst
 */
export function sortToggle(tag, attrs, newestFirst) {
  const toggle = h(
    tag,
    { ...attrs, class: 'btn btn-small sort-toggle' },
    svg(
      'svg',
      { class: 'sort-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      svg('path', { d: 'M8 3v10M4 9l4 4 4-4' }),
    ),
    h('span', { class: 'sort-label' }),
  );
  setSortToggle(toggle, newestFirst);
  return toggle;
}

/**
 * Show the order a sortToggle stands for.
 * @param {Element} toggle
 * @param {boolean} newestFirst
 */
export function setSortToggle(toggle, newestFirst) {
  toggle.classList.toggle('is-ascending', !newestFirst);
  const label = toggle.querySelector('.sort-label');
  if (label) label.textContent = newestFirst ? 'Newest first' : 'Oldest first';
}

/**
 * "Rows 25 50 100": links to the same list with another number of rows per page, the current one
 * marked. The same control wherever a list is split into pages (listing.js).
 * @param {number} size  the current one
 * @param {(n: number) => string} href  the link for n rows per page
 */
export function pageSizeLinks(size, href) {
  return h(
    'span',
    { class: 'page-size', role: 'group', 'aria-label': 'Rows per page' },
    h('span', { class: 'page-size-label', 'aria-hidden': 'true' }, 'Rows'),
    PAGE_SIZES.map((n) =>
      h(
        'a',
        {
          class: 'page-size-option',
          href: href(n),
          'aria-current': n === size ? 'true' : null,
          'data-keep-live': true,
          title: `${n} per page`,
        },
        String(n),
      ),
    ),
  );
}
