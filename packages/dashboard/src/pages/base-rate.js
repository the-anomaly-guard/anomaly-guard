// E-03: the finished held-out experiment supplies rates; the control varies only prevalence.
import { initShell } from '../shell.js';
import { runExperiment } from '../pipeline.js';
import { measuredRates, alarmPpv, prevalenceCurve } from '../base-rate-data.js';
import { mount } from '../dom.js';
import { setupCharts, baseRateChart } from '../charts.js';

const state = initShell();
const { cm } = runExperiment(state);
const rates = measuredRates(cm);
const input = /** @type {HTMLInputElement} */ (document.querySelector('#scenario-prevalence'));
const chartBox = /** @type {HTMLElement} */ (document.querySelector('#base-rate-box'));
const percent = (n) => `${(n * 100).toFixed(2)}%`;

mount(
  '#measured-rates',
  `Test split: ${cm.tp} of ${rates.attacks} attacks caught (TPR: ` +
    `${rates.tpr === null ? 'unavailable' : percent(rates.tpr)}); ` +
    `${cm.fp} of ${rates.legitimate} legitimate requests flagged (FPR: ` +
    `${rates.fpr === null ? 'unavailable' : percent(rates.fpr)}).`,
);

let chart = null;
if (rates.tpr === null || rates.fpr === null) {
  chartBox.hidden = true;
  input.disabled = true;
  mount(
    '#scenario-result',
    'Both attacks and legitimate requests are needed to measure the rates. Change the experiment attack share or test size.',
  );
} else if (rates.tpr === 0 && rates.fpr === 0) {
  chartBox.hidden = true;
  input.disabled = true;
  mount(
    '#scenario-result',
    'No alarms are expected at any attack share with these measured rates, so PPV is undefined.',
  );
} else {
  setupCharts();
  chart = baseRateChart(
    /** @type {HTMLCanvasElement} */ (document.querySelector('#chart-base-rate')),
    prevalenceCurve(rates.tpr, rates.fpr),
  );
  input.addEventListener('input', drawScenario);
  drawScenario();
}

function drawScenario() {
  const value = input.valueAsNumber;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    mount('#scenario-result', 'Enter an attack share from 0 to 100%.');
    chart.data.datasets[1].data = [];
  } else {
    const prevalence = value / 100;
    const ppv = alarmPpv(rates.tpr, rates.fpr, prevalence);
    mount(
      '#scenario-result',
      ppv === null
        ? 'No alarms are expected at this attack share, so PPV is undefined.'
        : `At ${value}% attacks, an estimated ${percent(ppv)} of alarms are attacks.`,
    );
    chart.data.datasets[1].data =
      ppv === null || prevalence < 0.000001 ? [] : [{ x: prevalence, y: ppv }];
  }
  chart.update();
}
