# @anomaly-guard/core

The shared detection engine. **Pure JavaScript - no DOM, no Node-only APIs** - so it runs
unchanged in the browser (for the GitHub Pages demo) and in Node (server + tests). See
[`../../docs/development/project-structure.md`](../../docs/development/project-structure.md) §3-§4.
ESLint rejects browser globals, Node globals/modules, `fetch` and `Math.random` in `src/`.

## Exports

```js
import {
  // features
  extractFeatures,
  paramFeatures,
  // character stats
  shannonEntropy,
  entropySummary, // distribution of per-value entropies (C-08)
  entropySeparation, // AUC / KS between legit and attack entropies (C-08)
  charClassCounts,
  charHistogram,
  classifyChar,
  CHAR_CLASSES, // the seven classes (ADR-008)
  SPECIAL_CHARS,
  // rules
  RuleEngine,
  DEFAULT_RULES,
  // statistical models
  trainStatModel,
  scoreRequest,
  paramKey, // '/search?q' - models are per (path, parameter) (ADR-007)
  pToScore, // s = −log10(p), the common score scale (ADR-007)
  lengthZScore,
  lengthScore, // Chebyshev bound on lengths
  chiSquareScore, // per-request character-distribution score (C-03)
  chiSquareLogSurvival, // χ²(df) survival function in log space (C-08)
  chiSquareHomogeneity, // legit vs attack 7 × 2 test (C-08)
  // detector
  detect,
} from '@anomaly-guard/core';
```

## Request shape

```js
/** @type {import('@anomaly-guard/core').AgRequest} */
const request = {
  method: 'GET',
  path: '/search',
  params: { q: 'red shoes' }, // every user-controlled value, keyed by name, URL-decoded once
};
```

Values are what the application sees after one URL-decoding pass (ADR-006): leftover `%xx` means
the sender double-encoded it.

## Typical use

```js
import { RuleEngine, trainStatModel, detect } from '@anomaly-guard/core';

const engine = new RuleEngine();
const model = trainStatModel(legitimateRequests); // train on NORMAL only (ADR-004)

// threshold on the −log10(p) scale: 2 ≈ p ≤ 0.01. Calibrate it on legit-only data (ADR-009).
const result = detect(request, { ruleEngine: engine, model, threshold: 2, mode: 'combined' });
// -> { verdict: 'attack' | 'legit', score, statScore, ruleMatched, reasons, detail }
```

`score` is continuous in every mode, so the ROC can sweep it: `stats` -> the statistical score;
`combined` -> `Infinity` on a rule hit, otherwise the statistical score; `rules` -> 1 or 0. There is
no default threshold on purpose.

## Status

Implemented: entropy + the seven character classes, feature extraction, canonical signature
rules for SQL injection, XSS, path traversal and command injection (B-01), the per-(path,
parameter) model, a baseline length signal (Chebyshev bound → −log10 p), a baseline detector
with a continuous score per mode, the chi-square character-distribution score (C-03), and the
dataset-level homogeneity test plus entropy summaries for the report (C-08). Stubs with a backlog
id: robust/multivariate outliers (C-05), adding them to `scoreRequest` (C-06). The maths is in
[`../../docs/statistics/methods.md`](../../docs/statistics/methods.md).

## Test

```bash
npm test --workspace @anomaly-guard/core
```
