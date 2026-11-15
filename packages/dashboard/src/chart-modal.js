// A chart opened large in a modal: the page behind is dimmed, the chart fills most of the window
// and follows its size, and hover and legend work as on the page (it is a real Chart.js chart, not
// a picture). Any panel can use it: it gives the button that opens it, a title, and a function that
// draws the chart on the modal's canvas. Esc, the Close button or a click on the dimmed page close
// it; the chart is destroyed with it.

import { h } from './dom.js';

/**
 * @param {{ trigger: HTMLElement, title: string,
 *   draw: (canvas: HTMLCanvasElement) => import('chart.js').Chart }} options
 * @returns {{ chart: () => import('chart.js').Chart | null }}  the large chart while it is open, so
 *   the page can update it too (the live replay keeps drawing)
 */
export function chartModal({ trigger, title, draw }) {
  /** @type {import('chart.js').Chart | null} */
  let chart = null;
  const canvas = /** @type {HTMLCanvasElement} */ (
    h('canvas', { role: 'img', 'aria-label': title })
  );
  const close = h('button', { class: 'btn', type: 'button' }, 'Close');
  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      'dialog',
      { class: 'chart-modal', 'aria-label': title },
      h('div', { class: 'chart-modal-head' }, h('h2', { class: 'panel-title' }, title), close),
      h('div', { class: 'chart-modal-body' }, canvas),
    )
  );
  document.body.append(dialog);

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    chart = draw(canvas); // after showModal: the canvas has its size now
  });
  close.addEventListener('click', () => dialog.close());
  // A click outside the box lands on the dimmed backdrop, which belongs to the dialog.
  dialog.addEventListener('click', (event) => {
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
  dialog.addEventListener('close', () => {
    chart?.destroy();
    chart = null;
    trigger.focus();
  });
  return { chart: () => chart };
}
