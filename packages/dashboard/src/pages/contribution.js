// Contribution pages show the completed held-out experiment using the existing chart helpers.
import { initShell } from '../shell.js';
import { runExperiment } from '../pipeline.js';
import { characterClassShares } from '../character-classes.js';
import { histogram, LENGTH_EDGES, pointsOf } from '../distributions.js';
import { rocByMode } from '../quality.js';
import { alarmPpv, measuredRates, prevalenceCurve } from '../base-rate-data.js';
import { setupCharts, histogramChart, rocChart, baseRateChart, token } from '../charts.js';

const state = initShell();
const run = runExperiment(state);
const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('#contribution-chart'));
const box = /** @type {HTMLElement} */ (document.querySelector('#contribution-chart-box'));
const message = /** @type {HTMLElement} */ (document.querySelector('#chart-message'));
const page = document.body.dataset.page;
const hasBoth =
  run.dataset.test.some((sample) => sample.label === 'attack') &&
  run.dataset.test.some((sample) => sample.label === 'legit');

setupCharts();
if (!hasBoth) {
  box.hidden = true;
  message.textContent =
    'Both attack and legitimate requests are needed for this comparison. Change the attack share in the experiment settings.';
} else if (page === 'team-andrea') {
  histogramChart(canvas, characterClassShares(run.dataset.test), { unit: 'characters' });
} else if (page === 'team-marcello') {
  histogramChart(canvas, histogram(pointsOf(run), 'length', LENGTH_EDGES), {
    xTitle: 'Longest parameter value (characters)',
  });
} else if (page === 'team-nicholas') {
  const names = { rules: 'Rules', stats: 'Statistics', combined: 'Combined' };
  const colors = { rules: '--src-signature', stats: '--src-statistics', combined: '--src-both' };
  const curves = rocByMode(run);
  rocChart(canvas, {
    curves: curves.map(({ mode, points, auc }) => ({
      label: `${names[mode]} (AUC ${auc.toFixed(3)})`,
      color: token(colors[mode]),
      points,
    })),
  });
} else if (page === 'team-giuseppe') {
  const { tpr, fpr, attacks, legitimate } = measuredRates(run.cm);
  if (tpr === 0 && fpr === 0) {
    box.hidden = true;
    message.textContent =
      'No alarms are expected at any attack share with these measured rates, so PPV is undefined.';
  } else {
    baseRateChart(canvas, prevalenceCurve(tpr, fpr));
    const percent = (value) => `${(value * 100).toFixed(2)}%`;
    document.querySelector('#base-rate-rates').textContent =
      `The detector caught ${run.cm.tp} of ${attacks} attacks (TPR ${percent(tpr)}) and ` +
      `flagged ${run.cm.fp} of ${legitimate} legitimate requests (FPR ${percent(fpr)}).`;
    document.querySelector('#base-rate-examples').textContent =
      'Holding those rates fixed, the estimated share of alerts that are attacks is ' +
      [0.001, 0.01, 0.1]
        .map(
          (prevalence) =>
            `${percent(alarmPpv(tpr, fpr, prevalence))} at ${percent(prevalence)} attack prevalence`,
        )
        .join('; ') +
      '.';
    document.querySelector('#base-rate-trend').textContent =
      fpr === 0
        ? 'No legitimate requests were flagged in this sample, so the estimated PPV is 100% at positive prevalence. A larger sample could reveal false alarms.'
        : tpr === 0
          ? 'No attacks were caught in this sample, so the estimated PPV is 0% wherever alarms are expected.'
          : 'As attacks become rarer, false alarms make up more of the expected alerts; as prevalence rises, the estimated PPV rises.';
    document.querySelector('#base-rate-insights').hidden = false;
  }
}
