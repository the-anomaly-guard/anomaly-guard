# ADR-012: Length signal on the log scale, and a policy for unseen pairs

**Date:** 2026-11-15
**Status:** Accepted
**Author:** The Anomaly Guard team (task C-04)

## Context

- ADR-007 fixed the length signal as the Chebyshev bound on the raw length, `p = min(1, 1/z²)`,
  and left C-04 to compare it with a normal-theory prediction interval, to try a log transform,
  and to decide what to do with (path, parameter) pairs never seen in training.
- Lengths are right-skewed and bounded below by 0, so `μ` and `σ` on the raw scale describe them
  poorly; a pair whose training lengths are all equal has `σ = 0`, which made `z` undefined.
- A pair unseen in training was skipped, so a parameter on an unknown endpoint scored 0 however
  strange it was.

## Decision

1. **Default method: Chebyshev on `ln(1 + length)`** (`chebyshev-log`). Same inequality, same
   `s = −log10(p)`, no normality assumed; only the scale of `z` changes. The model keeps `μ` and
   `σ` of both scales (`length` and `logLength`) in each `ParamStats`. The other three methods
   (`chebyshev`, `prediction-interval`, `prediction-interval-log`) stay available through
   `lengthScore(model, request, { method })` for comparison and the report.
2. **Floor on σ:** `σ_eff = max(σ, 1)` on the raw scale and `max(σ, 0.1)` on the log scale (about
   a 10 % change in length), so constant or single-value training sets give a finite `z`.
3. **Unseen pair:** a fixed, moderate score `s = log10(n + 1)`, i.e. `p = 1/(n + 1)` with `n` the
   number of training requests ("rarer than anything we saw"). An unexpected attribute is
   anomalous in itself (Kruegel & Vigna), but a hard verdict or `+Infinity` would flag every rare
   legitimate parameter. With `n = 0` the score is 0. It stays a score: the threshold is applied
   outside (ADR-009).
4. **Prediction interval with the normal quantile**, `z' = z / √(1 + 1/n)`, not Student's t: the
   difference is negligible for the training sizes used here, and `core` takes no new dependency.

## Evidence

20 seeds (1–20), 500 training / 1000 calibration / 1000 test requests per seed, 10 % attacks,
threshold at a 1 % target FPR on the legit-only calibration split (ADR-009); labels used only to
evaluate. Mean ± standard deviation over seeds.

| Method (hard legit share 0 -> 0.2) | AUC                        | TPR (at 1 % FPR)       | Test FPR                   |
| ---------------------------------- | -------------------------- | ---------------------- | -------------------------- |
| `chebyshev` (previous default)     | 0.853 ± 0.024 -> 0.831     | 0.642 ± 0.056 -> 0.650 | 0.010 -> **0.094 ± 0.032** |
| `chebyshev-log` (new default)      | **0.878 ± 0.023 -> 0.858** | 0.632 ± 0.042 -> 0.631 | 0.011 -> **0.051 ± 0.037** |
| `prediction-interval`              | 0.872 ± 0.021 -> 0.851     | 0.642 ± 0.056 -> 0.650 | 0.010 -> 0.094             |
| `prediction-interval-log`          | 0.887 ± 0.022 -> 0.865     | 0.631 ± 0.042 -> 0.631 | 0.011 -> 0.051             |

- The log scale wins the paired AUC comparison in 20/20 seeds (+0.025) without hard cases and in
  19/20 (+0.027) with them, and halves the false alarms on legitimate-but-weird traffic (FPR
  0.094 -> 0.051 when the calibration split has none of it), for a TPR 1 point lower.
- `chebyshev` and `prediction-interval` have the same TPR and FPR: both are monotone in `z`, so
  at a calibrated threshold they cut at the same place. The AUC gap (+0.019) is ties: Chebyshev
  gives score 0 whenever `z ≤ 1`, the normal tail does not. It is not extra detection power.
- No legitimate test request hit an unseen pair (0 of 18 000), because the generator uses a fixed
  set of endpoints: the unseen-pair policy is **not exercised by the synthetic data** and is
  covered by unit tests only.
- The length signal alone is weak on attacks that keep a normal length (TPR ≈ 0.63), as expected
  (`1 OR 1=1` mimicry); it is one part of the maximum of ADR-007, not the detector.

## Alternatives considered

| Alternative                              | Why rejected                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Keep `chebyshev` on the raw length       | Worse AUC and twice the false alarms on hard legitimate cases                                  |
| `prediction-interval-log` as default     | Best AUC (+0.009) but only through tie-breaking at `z ≤ 1`; assumes normality of `ln(1 + len)` |
| Unseen pair = `+Infinity` (hard anomaly) | Flags every rare legitimate parameter; destroys the ROC sweep                                  |
| Unseen pair = skipped (score 0)          | A parameter on an unknown endpoint, however long, would never be flagged                       |
| Robust scale (median / MAD) for lengths  | Belongs to C-05 (`outliers.js`); not combined here to keep one change per task                 |
| Student's t quantile                     | Needs a new function or dependency for a negligible difference                                 |

## Consequences

### Positive

- A better length signal with no extra assumption, same score scale, still one number per request.
- Every deviation, including constant-length pairs and unseen pairs, has a finite score.

### Negative / risks

- The log-length statistics add two numbers per pair to the model (plain serialisable object, so
  no format change beyond the new `logLength` field).
- The floors (1 character, 0.1 on the log scale) are choices, not estimates; a different floor
  changes the score of pairs with almost constant lengths.
- The results above are on the synthetic generator (A-02/A-04 may change it) and must be repeated
  with the final dataset.

### Actions

- [x] `lengthScore` with four methods, `unseenPairScore`, `logLength` in `trainStatModel`.
- [x] Tests with known answers (z = 10 -> s = 2; z = 2 -> p = 0.0455), monotonicity, floors,
      unseen pairs.
- [ ] Repeat the comparison on the final dataset (A-02, A-04) and put it in the report.
