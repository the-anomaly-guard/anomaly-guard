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
  LogarithmicScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { densify } from './lines.js';
import { findTerms, wrapLines } from './terms.js';
import { TERMS } from './term-data.js';

/** Hover points along the ROC lines: at most this far apart, in FPR or TPR (see lines.js). */
const HOVER_STEP = 0.01;

/**
 * The explanations of the acronyms and codes in a chart text (terms.js), one per line.
 * @param {unknown} text
 */
function termHelp(text) {
  return findTerms(String(text ?? ''), TERMS).map(({ help }) => help);
}

/**
 * The legend entry or category label (e.g. a rule id on the axis) under the pointer, if any.
 * @param {Chart} chart
 * @param {number} x
 * @param {number} y
 */
function labelAt(chart, x, y) {
  const legend = /** @type {any} */ (chart.legend);
  const boxes = legend?.legendHitBoxes ?? [];
  const hit = boxes.findIndex(
    (/** @type {any} */ b) =>
      x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height,
  );
  if (hit >= 0) return legend.legendItems?.[hit]?.text;
  for (const scale of Object.values(chart.scales)) {
    if (scale.type !== 'category' || x < scale.left || x > scale.right) continue;
    if (y < scale.top || y > scale.bottom) continue;
    const index = Math.round(scale.getValueForPixel(scale.isHorizontal() ? x : y) ?? -1);
    return /** @type {any} */ (scale).getLabels()[index];
  }
  return null;
}

// Hover help on every chart, present and future (registered once): a legend entry or an axis
// label with an acronym or a code explains it in the canvas's title; a bar or point explains the
// codes of its label in the tooltip's footer (setupCharts).
const termHelpPlugin = {
  id: 'termHelp',
  afterEvent(/** @type {Chart} */ chart, /** @type {any} */ { event }) {
    if (event.type !== 'mousemove' && event.type !== 'mouseout') return;
    const text = event.type === 'mousemove' ? labelAt(chart, event.x, event.y) : null;
    const help = termHelp(text).join('\n');
    if (chart.canvas.title !== help) chart.canvas.title = help;
  },
};

Chart.register(
  termHelpPlugin,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
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
  // A bar or point whose label is a code (a rule id) explains it under the values.
  Chart.defaults.plugins.tooltip.callbacks.footer = (items) =>
    termHelp(items[0]?.label).flatMap((help) => wrapLines(help, 56));
  Chart.defaults.plugins.tooltip.footerFont = { weight: 'normal' };
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
 * Draws a vertical line (the detector's threshold) on a category axis, at a fractional index: bin
 * i is centred on i, so 1.5 is the border between bin 1 and bin 2. Set the position, and the
 * text of the label, in `options.plugins.thresholdLine`; without a position nothing is drawn.
 */
const thresholdLinePlugin = {
  id: 'thresholdLine',
  afterDatasetsDraw(/** @type {Chart} */ chart, _args, /** @type {any} */ options) {
    if (options?.position === null || options?.position === undefined) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(options.position);
    if (x < chartArea.left || x > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = options.color;
    ctx.fillStyle = options.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `${options.fontSize ?? 12}px ${Chart.defaults.font.family}`;
    ctx.textAlign = x > chartArea.right - 90 ? 'right' : 'left';
    ctx.fillText(options.label, x + (ctx.textAlign === 'right' ? -4 : 4), chartArea.top + 12);
    ctx.restore();
  },
};

/**
 * Grouped bars: the share of two classes (legitimate, attack) in every bin of a distribution or
 * category, and optionally the threshold (E-02, themes T1 and T2). The tooltip shows the share and
 * the count, in the unit of the data (`requests` by default, `characters` for class shares).
 * @param {HTMLCanvasElement} canvas
 * @param {HistogramData} data
 * @param {{ fontSize?: number, xTitle?: string, yTitle?: string, unit?: string }} [style]
 */
export function histogramChart(
  canvas,
  data,
  { fontSize, xTitle, yTitle = 'Share of its class', unit = 'requests' } = {},
) {
  const font = fontSize ? { size: fontSize } : undefined;
  const percent = (value) => `${Math.round(Number(value) * 100)}%`;
  return new Chart(canvas, {
    type: 'bar',
    plugins: [thresholdLinePlugin],
    data: histogramDatasets(data),
    options: {
      scales: {
        x: { grid: { display: false }, title: { display: !!xTitle, text: xTitle, font } },
        y: {
          beginAtZero: true,
          max: 1,
          ticks: { callback: percent, stepSize: 0.25, font },
          title: { display: true, text: yTitle, font },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { font } },
        thresholdLine: thresholdOptions(data, font),
        tooltip: {
          titleFont: font,
          bodyFont: font,
          callbacks: {
            label: (item) => {
              const counts = item.datasetIndex === 0 ? data.legitCount : data.attackCount;
              return (
                `${item.dataset.label}: ${(item.parsed.y * 100).toFixed(1)}% ` +
                `(${counts[item.dataIndex]} ${unit})`
              );
            },
          },
        },
      },
    },
  });
}

/**
 * @typedef {Object} HistogramData
 * @property {string[]} labels  one per bin or category
 * @property {number[]} legit   share of the legitimate group per bin or category
 * @property {number[]} attack  share of the attack group per bin or category
 * @property {number[]} legitCount
 * @property {number[]} attackCount
 * @property {string} [unit]  what one count is: 'requests' (default) or 'characters'
 * @property {{ position: number, label: string } | null} [threshold]  fractional bin index
 */

/** @param {HistogramData} data */
function histogramDatasets({ labels, legit, attack }) {
  return {
    labels,
    datasets: [
      { label: 'Legitimate', data: legit, backgroundColor: token('--primary'), borderRadius: 2 },
      { label: 'Attack', data: attack, backgroundColor: token('--danger'), borderRadius: 2 },
    ],
  };
}

/** @param {HistogramData} data @param {{ size: number } | undefined} font */
function thresholdOptions(data, font) {
  return {
    position: data.threshold?.position ?? null,
    label: data.threshold?.label ?? '',
    color: token('--text'),
    fontSize: font?.size,
  };
}

/**
 * New data for a chart made by histogramChart (the live replay keeps adding requests).
 * @param {Chart} chart
 * @param {HistogramData} data
 */
export function setHistogramData(chart, data) {
  const next = histogramDatasets(data);
  chart.data.labels = next.labels;
  chart.data.datasets.forEach((dataset, i) => {
    dataset.data = next.datasets[i].data;
  });
  const font = chart.options.scales?.y?.ticks?.font;
  const unit = data.unit ?? 'requests';
  chart.options.plugins.thresholdLine = thresholdOptions(data, /** @type {any} */ (font));
  chart.options.plugins.tooltip.callbacks.label = (item) => {
    const counts = item.datasetIndex === 0 ? data.legitCount : data.attackCount;
    return `${item.dataset.label}: ${(item.parsed.y * 100).toFixed(1)}% (${counts[item.dataIndex]} ${unit})`;
  };
  chart.update();
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

/** PPV against prevalence, with a logarithmic prevalence axis for rare attacks (E-03). */
export function baseRateChart(canvas, points) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'PPV',
          data: points,
          borderColor: token('--primary'),
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Selected scenario',
          data: [],
          showLine: false,
          backgroundColor: token('--primary'),
          pointRadius: 5,
        },
      ],
    },
    options: {
      scales: {
        x: {
          type: 'logarithmic',
          min: 0.000001,
          max: 1,
          title: { display: true, text: 'Hypothetical attack share (%)' },
          ticks: { callback: (value) => `${Number((Number(value) * 100).toPrecision(3))}%` },
        },
        y: {
          type: 'linear',
          min: 0,
          max: 1,
          title: { display: true, text: 'Alarms that are attacks (PPV)' },
          ticks: { callback: (value) => `${Number(value) * 100}%` },
        },
      },
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            title: () => '',
            label: (item) =>
              `Attack share ${(item.parsed.x * 100).toPrecision(3)}% · PPV ${(item.parsed.y * 100).toFixed(2)}%`,
          },
        },
      },
    },
  });
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
