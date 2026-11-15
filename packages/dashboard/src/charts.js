// Chart.js, registered once with only the pieces the dashboard uses (a smaller bundle) and themed
// from the CSS tokens, so light and dark mode both work. Theme panels (E-02, E-03, E-06) reuse it:
// register any extra Chart.js component they need in the list below.

import {
  Chart,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { densify } from './lines.js';

/** Hover points along the ROC lines: at most this far apart, in FPR or TPR (see lines.js). */
const HOVER_STEP = 0.01;

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

/**
 * The value of a CSS custom property, e.g. token('--primary').
 * @param {string} name
 */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Apply the dashboard theme to Chart.js. Call once per page, before creating charts. */
export function setupCharts() {
  Chart.defaults.font.family = token('--font');
  Chart.defaults.font.size = 12;
  Chart.defaults.color = token('--text-muted');
  Chart.defaults.borderColor = token('--border');
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}

/**
 * A bar chart with one series.
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], values: number[], colors: string | string[], label: string,
 *   horizontal?: boolean }} data
 */
export function barChart(canvas, { labels, values, colors, label, horizontal = false }) {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label, data: values, backgroundColor: colors, borderRadius: 2, maxBarThickness: 32 },
      ],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: horizontal },
          ticks: { precision: 0, maxRotation: 0 },
          beginAtZero: true,
        },
        y: { grid: { display: !horizontal }, ticks: { precision: 0 }, beginAtZero: true },
      },
    },
  });
}

/**
 * A doughnut chart.
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], values: number[], colors: string[] }} data
 */
export function doughnutChart(canvas, { labels, values, colors }) {
  return new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: { cutout: '62%', plugins: { legend: { position: 'right' } } },
  });
}

/**
 * ROC curves (E-02, theme T3): true-positive rate against false-positive rate, one line per curve,
 * the chance diagonal, and marked points such as the current operating point.
 * @param {HTMLCanvasElement} canvas
 * @param {{ curves: { label: string, color: string, points: { fpr: number, tpr: number }[] }[],
 *   marks?: { label: string, color: string, fpr: number, tpr: number }[] }} data
 * @param {{ fontSize?: number }} [style]  larger text for the chart opened in a modal
 */
export function rocChart(canvas, { curves, marks = [] }, { fontSize } = {}) {
  const font = fontSize ? { size: fontSize } : undefined;
  const percent = (value) => `${Math.round(Number(value) * 100)}%`;
  const axis = (text) => ({
    type: /** @type {const} */ ('linear'),
    min: 0,
    max: 1,
    title: { display: true, text, font },
    ticks: { callback: percent, stepSize: 0.2, font },
  });
  return new Chart(canvas, {
    type: 'line',
    data: { datasets: rocDatasets({ curves, marks }) },
    options: {
      scales: { x: axis('False-positive rate'), y: axis('True-positive rate (recall)') },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { font } },
        tooltip: {
          titleFont: font,
          bodyFont: font,
          callbacks: {
            title: () => '', // the label below already says FPR and TPR
            label: (item) =>
              `${item.dataset.label}: FPR ${(item.parsed.x * 100).toFixed(1)}%, ` +
              `TPR ${(item.parsed.y * 100).toFixed(1)}%` +
              /** @type {any} */ (item.raw?.between ? ' (between two operating points)' : ''),
          },
        },
      },
    },
  });
}

/**
 * The datasets of a ROC chart: the curves, the chance diagonal, the marked points.
 * @param {Parameters<typeof rocChart>[1]} data
 */
function rocDatasets({ curves, marks = [] }) {
  return [
    // Every line gets hover points along its straight parts (lines.js): without them the rules'
    // curve, a single inner point joined to the corners, showed no tooltip between its ends.
    ...curves.map(({ label, color, points }) => ({
      label,
      data: densify(
        points.map((p) => ({ x: p.fpr, y: p.tpr })),
        HOVER_STEP,
      ),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
    })),
    {
      label: 'Chance (AUC 0.5)',
      data: densify(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        HOVER_STEP,
        false, // a reference line: no operating points to be between
      ),
      borderColor: token('--border-strong'),
      backgroundColor: token('--border-strong'),
      borderDash: [4, 4],
      borderWidth: 1,
      pointRadius: 0,
    },
    ...marks.map(({ label, color, fpr, tpr }) => ({
      label,
      data: [{ x: fpr, y: tpr }],
      showLine: false,
      borderColor: color,
      backgroundColor: token('--panel-bg'),
      borderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 7,
    })),
  ];
}

// ---- live replay (E-08, ADR-011): the pages create their charts once and update them
// as the requests arrive, instead of drawing them again.

/**
 * New values (and labels) for a chart with one series: a bar or doughnut chart.
 * @param {Chart} chart
 * @param {{ values: number[], labels?: string[] }} data
 */
export function setChartData(chart, { values, labels }) {
  if (labels) chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.update();
}

/**
 * New curves and marks for a chart made by rocChart.
 * @param {Chart} chart
 * @param {Parameters<typeof rocChart>[1]} data
 */
export function setRocData(chart, data) {
  chart.data.datasets = /** @type {any} */ (rocDatasets(data));
  chart.update();
}

/**
 * Show a message in place of a chart (nothing to draw yet), or the chart again with null. The
 * canvas stays, so the chart can come back when data arrives.
 * @param {Chart} chart
 * @param {string | null} text
 */
export function chartMessage(chart, text) {
  const box = chart.canvas.parentElement;
  if (!box) return;
  let note = box.nextElementSibling;
  if (!(note instanceof HTMLElement) || !note.classList.contains('empty-chart')) {
    note = document.createElement('p');
    note.className = 'empty-chart';
    note.hidden = true;
    box.after(note);
  }
  box.hidden = text !== null;
  note.hidden = text === null;
  if (text !== null && note.textContent !== text) note.textContent = text;
}
