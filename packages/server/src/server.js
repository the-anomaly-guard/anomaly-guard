// Express live monitor. Demonstrates the realistic ingest -> analyse -> verdict loop LOCALLY.
// It binds to localhost only and never forwards, executes, or acts on a payload (ADR-001): it
// only measures the request and returns a verdict. Node only - not part of the Pages demo.
//
// Configuration (environment): PORT (default 3100), TARGET_FPR (default 0.01, the false-positive
// rate the thresholds are calibrated for), CALIBRATION_SIZE (default 2000), SEED (default 1).

import { createApp } from './app.js';

const HOST = '127.0.0.1';

/**
 * A number from the environment, or its default; an invalid value stops the server with a clear
 * message instead of a stack trace further on.
 * @param {string} name
 * @param {number} fallback
 * @param {(x: number) => boolean} valid
 * @param {string} expected  what a valid value looks like
 */
function fromEnv(name, fallback, valid, expected) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!valid(value)) {
    console.error(`[anomaly-guard] ${name}=${raw} is not valid: expected ${expected}.`);
    process.exit(1);
  }
  return value;
}

const PORT = fromEnv(
  'PORT',
  3100,
  (x) => Number.isInteger(x) && x > 0 && x < 65536,
  'a port between 1 and 65535',
);
const SEED = fromEnv(
  'SEED',
  1,
  (x) => Number.isInteger(x) && x >= 0 && x <= 4294967295,
  'an integer between 0 and 4294967295',
);
const CALIBRATION_SIZE = fromEnv(
  'CALIBRATION_SIZE',
  2000,
  (x) => Number.isInteger(x) && x >= 1,
  'a positive integer',
);
const TARGET_FPR = fromEnv('TARGET_FPR', 0.01, (x) => x > 0 && x < 1, 'a share such as 0.01');

// An estimate of a rate α needs about 10/α legitimate requests (methods.md §6).
if (CALIBRATION_SIZE * TARGET_FPR < 10) {
  console.warn(
    `[anomaly-guard] warning: ${CALIBRATION_SIZE} calibration requests are few for a ` +
      `${TARGET_FPR * 100}% target: the threshold needs about ${Math.ceil(10 / TARGET_FPR)}.`,
  );
}

const { app, model, calibration } = createApp({
  seed: SEED,
  calibrationSize: CALIBRATION_SIZE,
  targetFpr: TARGET_FPR,
});

app.listen(PORT, HOST, () => {
  const t = calibration.thresholds;
  console.log(
    `[anomaly-guard] monitor on http://${HOST}:${PORT} · model trained on ${model.trainedOn} ` +
      `legitimate requests · thresholds for ${calibration.targetFpr * 100}% false positives on ` +
      `${calibration.size} legitimate requests: stats ${t.stats.toFixed(3)}, combined ${t.combined.toFixed(3)}`,
  );
});
