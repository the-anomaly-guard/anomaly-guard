# ADR-015: Combining the statistical signals - the maximum, and an optional calibrated mode

**Date:** 2026-11-16
**Status:** Accepted
**Author:** The Anomaly Guard team (task C-06)

## Context

- ADR-007 fixed the statistical score as the maximum of the signals, each on the `-log10(p)` scale.
  C-06 adds the chi-square (C-03), length (C-04) and outlier (C-05: IQR, MAD, Mahalanobis) signals
  to `scoreRequest`.
- ADR-013 warned that the signals share a scale but not a calibration: on legitimate traffic one
  signal can run higher than another, and the maximum then raises the calibrated threshold for all
  of them, so the combination can be worse than its best member.

## Decision

1. **`scoreRequest(model, request)` returns five parts** (`length`, `chiSquare`, `iqr`, `mad`,
   `mahalanobis`, in the order of `SIGNAL_PARTS`), the **maximum** of them as `score`, the part that
   produced it as `top`, and the signals' own scores as `raw`. This is the default and the
   specification of ADR-007; it needs nothing beyond `trainStatModel`.
2. **An optional `{ combine: 'calibrated' }` mode.** `calibrateModel(model, calibrationRequests)`
   scores the legitimate calibration requests and keeps, per signal, the sorted scores. In
   calibrated mode each part is replaced by its **tail rank** on those scores,
   `s' = -log10((k + 1) / (n + 1))` with `k` the number of calibration scores at least as high,
   and the score is the maximum of the `s'`. A part is then "how rare is this among legitimate
   requests", the same question for every signal. The most extreme value is `log10(n + 1)`.
3. **The calibration split is legitimate-only and is not the training split** (the model has seen
   its training values, so their scores are optimistic) **nor the test split**. The threshold is
   still set separately, on legitimate scores, at a target FPR (ADR-009); when the same split is
   used for both, cut it in two halves.
4. **The default stays `max`.** `calibrated` is not wired into the dashboard pipeline or the
   experiment: both use files of other themes (T3), and they need to decide how to split the
   calibration split. This ADR gives them the evidence and the function.
5. The `-0` that `chiSquareScore` returns when `p = 1` is turned into `0` in `scoreParts`, and
   `invertSymmetric` no longer leaves `-0` in a matrix, so a model survives a JSON round trip
   unchanged.

## Evidence

20 seeds (1-20), 500 training / 2000 calibration / 1000 test requests per seed, 10 % attacks, the
threshold at a 1 % target FPR. The calibration split is cut in two halves: the first calibrates
the model, the second sets the threshold, so neither reuses data. Mean over seeds. First value
without hard legitimate cases in the test set, second value with 20 % of them. The sizes are
smaller than the experiment of the report (D-04); the comparison should be repeated with its
configuration.

| Strategy            | AUC           | TPR (at 1 % FPR) | Test FPR      |
| ------------------- | ------------- | ---------------- | ------------- |
| `max` (default)     | 0.996 / 0.966 | 0.873 / 0.866    | 0.011 / 0.065 |
| `calibrated`        | 0.998 / 0.966 | 0.948 / 0.933    | 0.010 / 0.079 |
| `mahalanobis` alone | 0.996 / 0.985 | 0.951 / 0.940    | 0.011 / 0.070 |
| `chiSquare` alone   | 0.995 / 0.959 | 0.861 / 0.853    | 0.012 / 0.066 |
| `length` alone      | 0.874 / 0.859 | 0.618 / 0.632    | 0.009 / 0.050 |

- **The plain maximum loses 8 points of TPR to its best member** (0.873 against 0.951), as ADR-013
  warned. The chi-square score runs high on legitimate traffic, so the threshold of the maximum
  is set by it.
- **The calibrated mode recovers it**: TPR +0.075 over `max` in 19/20 seeds without hard cases
  (+0.067 in 18/20 with them), at the same FPR without hard cases. By attack variant (no hard
  cases), TPR of `max` / `calibrated` / `mahalanobis`: canonical 0.84 / 0.92 / 0.92, novel
  0.90 / 0.97 / 0.98, obfuscated 0.90 / 0.96 / 0.91. It is the best of the three on obfuscated
  attacks, where the chi-square signal helps (0.92 alone).
- **No strategy wins on everything.** With hard legitimate cases (`O'Brien`, long free text,
  non-Latin text) in the test set but not in the calibration set, `mahalanobis` alone has the best
  AUC (0.985 against 0.966) and a lower FPR than `calibrated` (0.070 against 0.079). The other
  signals add attacks they catch and false alarms they cause; the weirdness of legitimate traffic
  is what the calibration split must contain for the threshold to be honest.
- The scores of the calibrated mode have a ceiling (`log10(n + 1)`, 3.0 for n = 1000): every
  request above all the calibration scores of a signal ties there. The ROC is coarser at the very
  top, and no tie-breaking is attempted.

## Alternatives considered

| Alternative                               | Why not                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| Only the plain maximum                    | Documented, but loses 8 points of TPR for no gain in FPR                         |
| Subtract a quantile of each signal        | Measured: TPR 0.92, AUC 0.992, more false alarms on hard cases than `calibrated` |
| Sum of the signals                        | Counts the same evidence several times (the signals are correlated)              |
| Keep only the best signal (`mahalanobis`) | Best on hard cases, but worse on obfuscated attacks and not a combination        |
| Make `calibrated` the default             | Needs a calibrated model everywhere; the group decides after seeing this         |

## Consequences

### Positive

- One call gives every signal's score and the reason (`parts`, `top`, `raw`), with no threshold
  inside.
- The default behaves as specified; the better combination is available without a new dependency.

### Negative / risks

- **The statistical score of `stats` and `combined` mode changes for everyone** as soon as the five
  signals are in the maximum: the numbers of D-04 and the report must be regenerated
  (`npm run report -- --update`, see ADR-014) and the T3 chapters re-read.
- A calibrated model stores about `5 * n` numbers (n = calibration requests), more than the rest
  of the model.
- The evidence is on synthetic data, with sizes smaller than the report's experiment.

### Actions

- [x] `scoreRequest` with five parts, `calibrateModel`, `tailScore`, the `calibrated` mode, tests
      with known answers.
- [ ] T3: decide whether the pipeline and the experiment use `calibrated`, and how to split the
      calibration split between calibrating the model and setting the threshold.
- [ ] Repeat the comparison with the report's configuration (D-04) and put it in the report.
- [x] C-07: explain a verdict with `top`, the parameter and the feature of the signal
      (`explanation` in `scoreRequest` and `detect().detail`, one line in `reasons`).
