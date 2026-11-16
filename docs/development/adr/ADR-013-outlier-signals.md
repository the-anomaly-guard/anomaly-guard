# ADR-013: Outlier signals - robust scale, regularised Mahalanobis, three features

**Date:** 2026-11-16
**Status:** Accepted
**Author:** The Anomaly Guard team (task C-05)

## Context

- methods.md §5 plans per-feature robust alternatives to the z-score (IQR, MAD) and the
  Mahalanobis distance across features, each ending as a tail probability and a score on the
  `-log10(p)` scale (ADR-007). C-05 had to choose the features, the mapping from a deviation to
  `p`, how to invert a covariance matrix that is singular on legitimate traffic (a feature that
  never varies), and what to do with pairs seen too rarely.
- The length signal (ADR-012) looks at one feature only and assumes nothing about the others.

## Decision

1. **Three features per parameter value**, all already in the feature record: `ln(1 + length)`,
   Shannon entropy and the share of `special` characters. Training keeps, per (path, parameter)
   pair and from legitimate values only: median, quartiles, MAD, mean, covariance and the inverse
   of the regularised covariance (`ParamStats.outlier`, a plain serialisable object).
2. **IQR and MAD signals:** `z = |x - median| / sigma_hat`, with `sigma_hat = IQR / 1.349` or
   `MAD / 0.6745` (the value of sigma if the data were normal), never below a floor per feature
   (0.1 on the log length, 0.1 bit of entropy, 2 % of special characters). The tail is
   Chebyshev's, `p = min(1, 1/z^2)`, as in ADR-012: no normality assumed. Tukey's fence is reported
   (`beyondFence`) to explain a hit; it is not the score. The score of a request is the worst
   feature of the worst parameter.
3. **Mahalanobis signal:** `D^2 = (x - mean)^T P (x - mean)` with `P` the inverse of the
   regularised covariance, and `p ~ P(chi-square(3) > D^2)`, computed in log space. The covariance
   is made invertible in two steps: every variance is raised to the square of its floor (this
   keeps the matrix positive semi-definite), then a ridge of 10 % of each variance is added. The
   p-value is nominal (mean and covariance are estimated, the features are not normal), so it is a
   score only, as in ADR-008.
4. **Pairs never seen, or seen fewer than 5 times, score 0** in these signals. The policy for
   unseen pairs is the length signal's (ADR-012); the combination by maximum (C-06) must not count
   it twice, and robust statistics from fewer than 5 values mean nothing.
5. **No signal is added to `scoreRequest` here.** That is C-06, which should use the evidence below.

## Evidence

20 seeds (1-20), 500 training / 1000 calibration / 1000 test requests per seed, 10 % attacks,
threshold at a 1 % target FPR on the legit-only calibration split (ADR-009); labels only to
evaluate. Mean over seeds (standard deviations are in the comparison output: 0.002-0.006 on AUC,
0.017-0.062 on TPR). First value without hard legitimate cases in the test set, second value with
20 % of them (`O'Brien`, long free text, non-Latin text) while the calibration split has none.

| Signal (alone)     | AUC           | TPR (at 1 % FPR) | Test FPR      |
| ------------------ | ------------- | ---------------- | ------------- |
| `length` (ADR-012) | 0.878 / 0.858 | 0.632 / 0.631    | 0.011 / 0.051 |
| `chiSquare` (C-03) | 0.994 / 0.963 | 0.844 / 0.860    | 0.010 / 0.069 |
| `iqr`              | 0.990 / 0.979 | 0.875 / 0.896    | 0.007 / 0.054 |
| `mad`              | 0.983 / 0.978 | 0.765 / 0.783    | 0.003 / 0.005 |
| `mahalanobis`      | 0.995 / 0.986 | 0.950 / 0.953    | 0.013 / 0.076 |

- Each outlier signal beats the length signal alone by 0.10-0.13 of AUC in 20/20 seeds, with and
  without hard cases. Mahalanobis is the best single signal (TPR 0.95); IQR is close; MAD is the
  most conservative (lowest TPR, and the only one whose false alarms barely grow on hard cases).
- By attack variant (no hard cases), TPR of Mahalanobis / IQR / chi-square: canonical
  0.93 / 0.77 / 0.79, novel 0.98 / 0.96 / 0.87, obfuscated 0.84 / 0.73 / 0.90. The chi-square score
  is still the best on obfuscated attacks.
- **The maximum of signals can be worse than its best member.** `max(length, chiSquare,
mahalanobis)` has TPR 0.865 where Mahalanobis alone has 0.950, because a signal whose scores run
  higher on legitimate traffic raises the calibrated threshold for the whole maximum. The signals
  are on the same scale but not equally calibrated. This is not decided here; it is the first thing
  C-06 should test (for example a per-signal threshold, or ranking signals before the maximum).
- All the signals raise the false positive rate on legitimate-but-weird requests when the
  calibration split has none of them (0.05-0.08, not 0.01), with MAD the exception. That is the
  honest limit of calibrating on easy legitimate traffic.
- The dataset is synthetic and its legitimate values come from templates: a high AUC here says the
  signals work on this generator, not that they would on real traffic. The comparison must be
  repeated on the final dataset (A-02, A-04).

## Alternatives considered

| Alternative                                  | Why rejected                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Score the distance beyond Tukey's fence      | Zero for every value inside the fences, so no ranking there; needs an arbitrary map to `p` |
| Normal tail for the robust z                 | Assumes normality; Chebyshev keeps the choice of ADR-012                                   |
| More features (digit ratio, parameter count) | More dimensions with a small `n` per pair; the three chosen separate the classes well      |
| Plain covariance without ridge               | Singular whenever a feature is constant in training, which happens on this data            |
| Student's t or F distribution for `D^2`      | Closer to exact for small `n`, but needs new functions; the p-value is only a score        |

## Consequences

### Positive

- Three new signals on the common scale, each returning a score and the reason for it (worst
  parameter, feature, fence, `D^2`), with no threshold inside.
- The model stays a plain serialisable object; `core` has no new dependency.

### Negative / risks

- Each pair now stores about 30 more numbers.
- The floors (0.1, 0.1 bit, 2 %) and the ridge (10 %) are choices, not estimates; they change the
  score of pairs with almost constant training values.
- Combining the signals by maximum is not obviously right (see Evidence).

### Actions

- [x] `stats/outliers.js` (IQR, MAD, Mahalanobis), `stats/robust.js` (numeric building blocks),
      `ParamStats.outlier` in `trainStatModel`.
- [x] Tests with known answers (MAD of 1, 2, 3, 4, 100 is 1; `chi-square(2)` at 5.9915 gives
      p = 0.05), constant features, correlation 1, unseen and rare pairs, labels never read.
- [x] C-06: the outlier parts are in `scoreRequest`, and the combination was tested (ADR-015).
- [ ] Repeat the comparison on the final dataset (A-02, A-04) and put it in the report.
