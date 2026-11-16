# T3 - Evaluation and uncertainty

> **Draft** of the T3 chapter of the final report (E-05). Author: Nicholas Arcari.
>
> - **Source of the numbers:** one run of `npm run experiments` at commit `{{commit}}`, seeds
>   {{seeds}}, clean working tree<!-- claim: cleanTree -->, {{date}}. No number here is typed by
>   hand: `npm run report` fills [the template of this chapter](templates/t3-evaluation-and-uncertainty.en.md)
>   from [`numbers.json`](numbers.json), and a test fails when the code no longer gives these
>   results ([README](README.md), ADR-014).
> - **The statistical score is still the length signal alone**, on the log scale since C-04
>   (ADR-012).<!-- claim: lengthOnly --> Chi-square (C-03) and the outlier signals (C-05) are
>   implemented, but they enter the score only with C-06.
> - The first draft used the baseline ruleset (commit `c4ef25c`), and §5 explains what changed.
>
> The Italian version is [`t3-evaluation-and-uncertainty.it.md`](t3-evaluation-and-uncertainty.it.md).

## 1. The question

The project asks how much statistics can catch without predefined signatures, and how often it
gets it wrong. This chapter measures the errors, and how sure we can be of those measurements. It
compares three detectors on the same requests:

- **rules**: signatures only. A request is flagged when a regular expression matches.
- **stats**: statistics only. A request is flagged when its anomaly score `s = −log10 p`, learned
  from legitimate traffic, reaches a threshold.
- **combined**: a request is flagged on a rule match, or when the score reaches the threshold.

## 2. Experimental design

Each **seed** draws a complete dataset from the traffic generator (T4, ADR-006), in three splits:

| Split       | Requests              | Content                                                                                          | Used for                      |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| train       | {{split.train}}       | legitimate only                                                                                  | fitting the statistical model |
| calibration | {{split.calibration}} | legitimate only                                                                                  | choosing the threshold        |
| test        | {{split.test}}        | {{split.testLegit}} legitimate ({{split.testHard}} hard cases) and {{split.testAttacks}} attacks | measuring the errors, once    |

- **Labels never reach the model or the threshold.** The model is fitted on legitimate requests
  only (ADR-004), and the threshold is chosen on legitimate requests only (ADR-009). Attack labels
  are used once, to score the test split. Choosing the threshold that looks best on the test set
  would inflate every number.
- **Attacks** are legitimate requests with one value replaced by a payload. They come in three
  variants:
  - canonical: known signatures;
  - obfuscated: disguised to dodge the signatures;
  - novel: families the rules have no signature for.

  {{families.novel:Words}} of the {{families.all:words}} families are novel, so novel attacks are
  more than half of the attacks<!-- claim: novelMajority -->: {{perSeed.novel}} of the
  {{split.testAttacks}} in each seed.

- **Hard cases** are legitimate requests that look odd: an apostrophe, long free text, non-Latin
  text. They are only in the test split, so they show how the detector handles traffic the
  calibration never saw.
- **{{seedCount}} seeds** give {{seedCount}} independent replications of the whole procedure: new
  data, new model, new thresholds.

## 3. Methods

### 3.1 Error rates, not accuracy

From the confusion matrix (TP, FN, FP, TN) the chapter reports:

- the true-positive rate, `TPR = TP / (TP + FN)` (recall), and its complement the false-negative
  rate, `FNR = 1 − TPR`;
- the false-positive rate, `FPR = FP / (FP + TN)`;
- the precision, `TP / (TP + FP)`.

Accuracy is not reported. With {{legitShare}} legitimate requests, a detector that never raises an
alert would score {{legitShare}}.

### 3.2 A threshold for a target false-positive rate

Take the scores of `n` legitimate calibration requests and a target `α`. At most `k = ⌊α·n⌋` of
them may reach the threshold. The threshold `t` is the smallest number strictly above the
`(k+1)`-th largest score: an empirical quantile of the legitimate scores (`thresholdAtFpr`).

- **Ties** move together, so the calibration FPR can fall below `α`.
- **Size:** the quantile rests on the `k` largest scores, and with fewer than about 10 of them it is
  noisy. So the calibration split has {{split.calibration}} requests: `n ≥ 10/α` even at
  `α = {{lo.target}}`.<!-- claim: calibrationSize -->
- **An unattainable target:** in combined mode a rule match scores `+∞` and is flagged at any
  threshold. If more than `k` legitimate calibration requests match a rule, no threshold meets the
  target. The threshold then sits above every finite calibration score, and only the rules fire on
  the calibration split. This happened with the baseline ruleset (§5).

Kruegel and Vigna (2003) likewise set their thresholds on attack-free traffic.

### 3.3 ROC curve and AUC

The ROC curve sweeps the threshold down through every distinct score and plots TPR against FPR.
The area under it is the Mann-Whitney statistic:

```
AUC = P(score of a random attack > score of a random legitimate request), ties counting ½
```

0.5 is chance and 1 is perfect separation. The AUC uses only the ranking of the scores, so it does
not depend on any threshold. The rules have a binary score: their curve has a single inner point,
and `AUC = (1 + TPR − FPR) / 2`.

### 3.4 Uncertainty within one run

Every rate is a proportion `x/n` estimated from a finite test set. It gets a 95% **Wilson**
interval, with `p̂ = x/n` and `z = 1.96`:

```
centre     = (p̂ + z²/(2n)) / (1 + z²/n)
half-width = z / (1 + z²/n) · √( p̂(1 − p̂)/n + z²/(4n²) )
```

The textbook Wald interval, `p̂ ± z·√(p̂(1 − p̂)/n)`, collapses to [0, 0] when there are no errors.
Wilson does not: 0 false positives out of 900 gives an FPR in {{wilsonZero}}, not "zero".

The AUC is not a simple proportion, so it gets a **stratified percentile bootstrap**:

1. resample the attacks and the legitimate requests separately, with replacement,
   {{resamples}} times;
2. compute the AUC of each resample;
3. take the 2.5th and 97.5th percentiles.

The random numbers come from a generator seeded with the dataset seed + 2³¹.<!-- claim: bootstrapOffset -->
That stream never overlaps the dataset's, so the intervals are reproducible.

### 3.5 Uncertainty across runs

The intervals of §3.4 describe one test set. Across the {{seedCount}} seeds everything changes at
once: training data, model, threshold and test set. Each metric is therefore summarised by its
mean, its standard deviation, its range, and a 95% Student-t interval for the mean:

```
mean ± t(0.975, {{df}}) · SD / √{{seedCount}},     t(0.975, {{df}}) = {{tQuantile}}
```

The seed is the independent unit. The requests of one seed share one model and one threshold, so
they are not independent trials. A Wilson interval on the counts added up over all seeds would
ignore how much the threshold moves from run to run, and come out too narrow.

Sometimes a value is the same in every seed, for example 100% of command-injection attacks caught
by the rules.<!-- claim: rulesCmdiAll --> The interval then has zero width, and the tables say
"every seed" instead.

### 3.6 Comparing two detectors on the same requests

The three detectors score the same requests, so their results are paired. **McNemar's test** uses
only the requests where two detectors disagree: `b` flagged by A only, `c` flagged by B only. If
the two were equally good, each disagreement would be a coin flip: `b ~ Binomial(b + c, ½)`.

- The exact two-sided p-value is `2·P(X ≤ min(b, c))`. The textbook χ² with continuity correction,
  `(|b − c| − 1)² / (b + c)`, agrees with it for large counts.
- Attacks, novel attacks and legitimate requests are tested separately. On attacks, flagging more is
  better; on legitimate requests, it means more false alarms. One test on all requests would compare
  accuracy.
- Over the seeds the counts are added up: under the null hypothesis each seed's `b` is binomial, and
  so is the sum.
- There are {{tests}} tests ({{pairs}} pairs × {{groups}} groups × {{targetCount}} targets). With
  a Bonferroni correction, a difference counts at p < 0.05/{{tests}} ≈ {{bonferroni}}.

## 4. Results

All values are the mean over {{seedCount}} seeds, with the 95% t-interval of the mean in
brackets.

### 4.1 Without a threshold: AUC

**Table 1 - AUC on the test split.**

| Detector | AUC              | SD across seeds    | Range                 | Mean width of one seed's bootstrap interval |
| -------- | ---------------- | ------------------ | --------------------- | ------------------------------------------- |
| rules    | {{auc.rules}}    | {{aucSd.rules}}    | {{aucRange.rules}}    | {{aucBoot.rules}}                           |
| stats    | {{auc.stats}}    | {{aucSd.stats}}    | {{aucRange.stats}}    | {{aucBoot.stats}}                           |
| combined | {{auc.combined}} | {{aucSd.combined}} | {{aucRange.combined}} | {{aucBoot.combined}}                        |

On ranking alone, the combination separates attacks from legitimate requests best, and the
statistics clearly beat the rules.<!-- claim: aucOrder -->

### 4.2 At {{hi.target:a}} false-positive target

**Table 2 - Operating point at {{hi.target:a}} target.**

| Detector | Threshold                 | Calibration FPR        | Test FPR, typical               | Test FPR, all legitimate | TPR                 | Precision                 | Target met             |
| -------- | ------------------------- | ---------------------- | ------------------------------- | ------------------------ | ------------------- | ------------------------- | ---------------------- |
| rules    | - (a rule match)          | {{hi.calFpr.rules}}    | {{hi.variant.rules.typical}}    | {{hi.fpr.rules}}         | {{hi.tpr.rules}}    | {{hi.precision.rules}}    | {{hi.met.rules}} seeds |
| stats    | {{hi.threshold.stats}}    | {{hi.calFpr.stats}}    | {{hi.variant.stats.typical}}    | {{hi.fpr.stats}}         | {{hi.tpr.stats}}    | {{hi.precision.stats}}    | {{hi.met.stats}}       |
| combined | {{hi.threshold.combined}} | {{hi.calFpr.combined}} | {{hi.variant.combined.typical}} | {{hi.fpr.combined}}      | {{hi.tpr.combined}} | {{hi.precision.combined}} | {{hi.met.combined}}    |

The rules flag no legitimate request<!-- claim: rulesNoFalseAlarms -->, so the combination keeps
the statistics' threshold: the two raise the same false alarms, and the combination adds the rule
matches.<!-- claim: hiSameFalseAlarms -->

**Table 3 - Share flagged by variant at {{hi.target:a}} target.** For attacks this is the
detection rate; for legitimate requests, the false-positive rate.

| Variant              | Requests per seed      | rules                           | stats                           | combined                           |
| -------------------- | ---------------------- | ------------------------------- | ------------------------------- | ---------------------------------- |
| attack · canonical   | {{perSeed.canonical}}  | {{hi.variant.rules.canonical}}  | {{hi.variant.stats.canonical}}  | {{hi.variant.combined.canonical}}  |
| attack · obfuscated  | {{perSeed.obfuscated}} | {{hi.variant.rules.obfuscated}} | {{hi.variant.stats.obfuscated}} | {{hi.variant.combined.obfuscated}} |
| attack · novel       | {{perSeed.novel}}      | {{hi.variant.rules.novel}}      | {{hi.variant.stats.novel}}      | {{hi.variant.combined.novel}}      |
| legitimate · typical | {{perSeed.typical}}    | {{hi.variant.rules.typical}}    | {{hi.variant.stats.typical}}    | {{hi.variant.combined.typical}}    |
| legitimate · hard    | {{perSeed.hard}}       | {{hi.variant.rules.hard}}       | {{hi.variant.stats.hard}}       | {{hi.variant.combined.hard}}       |

By family:

- **The rules** catch every command-injection attack ({{hi.kind.rules.cmdi:mean}} in every
  seed)<!-- claim: rulesCmdiAll -->, and most SQL injection ({{hi.kind.rules.sqli:mean}}), XSS
  ({{hi.kind.rules.xss:mean}}) and traversal ({{hi.kind.rules.traversal:mean}}).<!-- claim: rulesMostTargeted -->
  They catch no novel attack at all.<!-- claim: rulesNoNovel --> They were written for the
  canonical payloads only, without looking at the obfuscated and novel ones (ADR-006, B-01):
  every canonical attack is caught, but only {{hi.variant.rules.obfuscated:0}} of the obfuscated
  ones.<!-- claim: rulesAllCanonical -->
- **The statistics** catch between {{hi.statsKindMin:0}} ({{hi.statsKindMinName}}) and
  {{hi.statsKindMax:0}} ({{hi.statsKindMaxName}}) of every family.
- **Legitimate requests:** the rules raise no false alarm, {{hi.pooledFp.rules}} of
  {{legitTested}} legitimate test requests over the {{seedCount}} seeds.<!-- claim: rulesNoFalseAlarms -->
  Most of the statistics' false alarms ({{hi.topFp.share}}) come from {{hi.topFp.name}} requests,
  {{hi.topFp.rate}} of which raise one<!-- claim: hiFpMostlyTop -->; {{hi.zeroFp.names}} requests
  never raise one.<!-- claim: hiFpSomeZero -->

### 4.3 At {{lo.target:a}} false-positive target

All three detectors meet this target.<!-- claim: loAllMet -->

- **Statistics:** threshold {{lo.threshold.stats}}; calibration FPR {{lo.calFpr.stats}}, test FPR
  {{lo.fpr.stats}}; TPR down to {{lo.tpr.stats}}, precision up to
  {{lo.precision.stats}}<!-- claim: loTradeOff -->; {{lo.variant.stats.novel}} of novel attacks
  caught, and no hard case flagged.<!-- claim: loNoHard -->
- **Combined:** the same threshold and the same false alarms<!-- claim: loSameFalseAlarms -->; TPR
  {{lo.tpr.combined}}, precision {{lo.precision.combined}}.
- **Rules:** no threshold, so the same row as at {{hi.target}}: no false alarm, TPR
  {{hi.tpr.rules:mean}}.<!-- claim: rulesNoFalseAlarms -->

### 4.4 Paired comparisons

**Table 4 - McNemar at {{hi.target:a}} target**, disagreements added up over the {{seedCount}}
seeds.

| A vs B            | Requests      | Flagged only by A                 | Flagged only by B                 | Exact p                           | Seeds with p < 0.05                   |
| ----------------- | ------------- | --------------------------------- | --------------------------------- | --------------------------------- | ------------------------------------- |
| stats vs combined | attacks       | {{hi.cmp.statsCombined.attack.a}} | {{hi.cmp.statsCombined.attack.b}} | {{hi.cmp.statsCombined.attack.p}} | {{hi.cmp.statsCombined.attack.seeds}} |
| stats vs combined | novel attacks | {{hi.cmp.statsCombined.novel.a}}  | {{hi.cmp.statsCombined.novel.b}}  | {{hi.cmp.statsCombined.novel.p}}  | {{hi.cmp.statsCombined.novel.seeds}}  |
| stats vs combined | legitimate    | {{hi.cmp.statsCombined.legit.a}}  | {{hi.cmp.statsCombined.legit.b}}  | {{hi.cmp.statsCombined.legit.p}}  | {{hi.cmp.statsCombined.legit.seeds}}  |
| rules vs stats    | attacks       | {{hi.cmp.rulesStats.attack.a}}    | {{hi.cmp.rulesStats.attack.b}}    | {{hi.cmp.rulesStats.attack.p}}    | {{hi.cmp.rulesStats.attack.seeds}}    |
| rules vs stats    | novel attacks | {{hi.cmp.rulesStats.novel.a}}     | {{hi.cmp.rulesStats.novel.b}}     | {{hi.cmp.rulesStats.novel.p}}     | {{hi.cmp.rulesStats.novel.seeds}}     |
| rules vs stats    | legitimate    | {{hi.cmp.rulesStats.legit.a}}     | {{hi.cmp.rulesStats.legit.b}}     | {{hi.cmp.rulesStats.legit.p}}     | {{hi.cmp.rulesStats.legit.seeds}}     |

The statistics and the combination raise exactly the same {{hi.pooledFp.stats}} false alarms and
catch the same novel attacks: they never disagree there.<!-- claim: hiSameFalseAlarms --><!-- claim: hiSameNovel -->
The combination adds {{hi.cmp.statsCombined.attack.b}} attacks that the statistics miss, all
canonical or obfuscated, the ones the rules are written for.<!-- claim: hiSameNovel --> The rules
and the statistics miss different attacks ({{hi.cmp.rulesStats.attack.a}} against
{{hi.cmp.rulesStats.attack.b}}), which is why combining them pays.<!-- claim: hiBothMiss -->

At {{lo.target}} the picture is the same: the combination adds {{lo.cmp.statsCombined.attack.b}}
attacks to the statistics, with the same {{lo.pooledFp.stats}} false alarms.<!-- claim: loSameFalseAlarms --><!-- claim: loSameNovel -->

### 4.5 How much do the numbers move?

- **Rules:** the SD of the AUC across seeds ({{aucSd.rules}}) matches the standard error from one
  seed's bootstrap (≈ {{aucBoot.rules}} / 3.92 = {{aucSe.rules}}).<!-- claim: rulesSdMatchesSe -->
  The rules learn nothing from data, so the only noise is the test set.
- **Statistics:** the SD across seeds ({{aucSd.stats}}) is close to the bootstrap's standard error
  too (≈ {{aucSe.stats}})<!-- claim: statsSdMatchesSe -->: one test set accounts for most of the
  spread, and the training data add little to it. It was not so in the first draft. On the raw
  length (commit `0ca4847`) the SD was 0.028 against 0.013, and the training data made up about
  four fifths of the variance. The log scale of C-04 made the model far steadier from one training
  set to the next.
- **The test FPR over all legitimate requests** also moves a lot: SD {{hi.fprSd.stats}}, from
  {{hi.fprMin.stats}} to {{hi.fprMax.stats}}.<!-- claim: fprMoves --> How many of the {{hardCases:words}} hard-case
  fixtures fall above the threshold changes from seed to seed.

This is why the experiment uses {{seedCount}} seeds rather than one.

## 5. Discussion

1. **Calibration works where it has seen data.** On typical legitimate traffic, the statistics
   keep to the targets out of sample: {{hi.variant.stats.typical}} against {{hi.target}}, and
   {{lo.variant.stats.typical:mean}} against {{lo.target}}.<!-- claim: typicalWithinTarget -->
2. **It does not cover what it has not seen.** About one hard case in {{hi.hardOneIn:words}}
   ({{hi.variant.stats.hard:0}}) raises a false alarm at the {{hi.target}} target.<!-- claim: hiHardFlagged -->
   Neither the calibration split nor the training split holds such requests: a model of "normal"
   is only as wide as the normal traffic it was given.
3. **Statistics catch what signatures cannot.** At {{hi.target}} they catch
   {{hi.variant.stats.novel:0}} of novel attacks, against {{hi.variant.rules.novel:0}} for the
   rules: this is the core answer to the research question.<!-- claim: rulesNoNovel --> But they
   also miss {{hi.statsMissCanonical:0}} of the canonical attacks the rules catch
   ({{hi.variant.stats.canonical:0}} against {{hi.variant.rules.canonical:0}}).<!-- claim: hiStatsMissCanonical -->
   So they complement the rules rather than replace them.
4. **Combining is free, as long as the rules raise no false alarm.** The signatures of B-01 flag
   no legitimate request, so the combination keeps the statistics' threshold and their false
   alarms, and adds the rule matches: at the {{hi.target}} target its TPR rises from
   {{hi.tpr.stats:0}} to {{hi.tpr.combined:0}} with the same {{hi.fpr.stats:mean}} of false
   positives (McNemar: {{hi.cmp.statsCombined.attack.b}} attacks against
   {{hi.cmp.statsCombined.attack.a}}, {{hi.cmp.statsCombined.attack.inSeeds}}).<!-- claim: rulesNoFalseAlarms --><!-- claim: hiSameFalseAlarms -->
   - The baseline ruleset of the first draft (commit `c4ef25c`, with the raw length signal of the
     time) showed the opposite. It matched 20.6% of the login requests, whose generated passwords
     contain `#` and `--`, so the rules alone flagged 3.1% of legitimate traffic. The combination
     could then never meet a 1% target: its threshold rose from 1.38, the statistics' own, to
     2.30, and it caught fewer novel attacks than the statistics alone (42% against 59%, McNemar
     p < 0.001).
   - The lesson: with a fixed false-positive budget, every false alarm of a rule is paid for by the
     statistics. A signature has to be checked on legitimate traffic before it joins the
     combination.

5. **The base rate changes everything** (T4's chapter). At the {{prevalence}} prevalence of the
   test split, about {{hi.precision.stats:0}} of the statistics' alarms are attacks, and
   {{hi.precision.combined:0}} of the combination's. At a prevalence `π` of {{basePi}}, Bayes
   gives:

   ```
   PPV = TPR·π / (TPR·π + FPR·(1 − π))
   ```

   - at the {{hi.target}} target: {{hi.ppv.stats}} for the statistics and {{hi.ppv.combined}} for
     the combination, so even for the combination about {{hi.falsePer100}} alarms in 100 are
     false;
   - at the {{lo.target}} target: {{lo.ppv.stats}} and {{lo.ppv.combined}}.

## 6. Limitations

- **Synthetic data.** The numbers describe the T4 generator, not real traffic. The conclusions that
  carry over are comparative: rules against statistics, what the combination adds and what a
  rule's false alarms cost it, calibration against unseen requests.
- **A baseline model.** The score is still the length signal alone, on the log scale
  (C-04).<!-- claim: lengthOnly --> Chi-square (C-03) and the outlier signals (C-05) are
  implemented but enter the score only with C-06: they will change every number in Tables 1-4,
  and `npm run report -- --update` will write the new ones.
- **{{hardCases:Words}} hard cases, repeated.** Their false-positive rate mostly says which of the
  {{hardCases:words}} fall above the threshold. It is not a rate over a population of unusual
  requests.
- **The t-interval** assumes roughly normal per-seed values. With {{seedCount}} seeds this is
  reasonable, but not near 0% or 100%, where the interval is clipped.
- **Many tests.** Only the McNemar results with p < {{bonferroni}} survive a Bonferroni correction.
  In Table 4 every row with p < 0.001 does; {{table4EqualRows}}, since there the two detectors
  decide in the same way on every request.<!-- claim: table4Extremes -->

## 7. Reproducing the numbers

```bash
git checkout {{commit}}
npm ci
npm run experiments          # about 1.5 minutes; writes results/<date>-<commit>/report.md
npm run report -- --update   # the same run, saved in numbers.json, and this chapter rewritten
```

The same seed always gives the same data, model, thresholds and bootstrap resamples.
`results.json` holds every seed, with its own Wilson and bootstrap intervals. The dashboard's
_Detection quality_ page shows one seed live: ROC, confusion matrix, variants, McNemar.

## 8. Individual contribution

Nicholas Arcari (T3) wrote:

- the threshold calibration (D-06);
- the ROC curve and AUC (D-03);
- the Wilson and bootstrap intervals (D-05);
- the multi-seed experiment and the across-seed intervals (D-04);
- the server calibration (B-02);
- the dashboard's _Detection quality_ page (E-06, and the ROC of E-02);
- McNemar's test (D-07);
- the generated numbers of the report: templates, `npm run report`, and the test that keeps them
  in step with the code (D-08);
- this chapter.

Prepared with Claude Code (AI assistant), as the team guide asks to declare.

## References

- C. Kruegel and G. Vigna, _Anomaly Detection of Web-based Attacks_, ACM CCS 2003.
- E. B. Wilson, _Probable inference, the law of succession, and statistical inference_, JASA 22,
  1927 (the Wilson interval).
- Q. McNemar, _Note on the sampling error of the difference between correlated proportions or
  percentages_, Psychometrika 12, 1947.
- J. A. Hanley and B. J. McNeil, _The meaning and use of the area under a receiver operating
  characteristic (ROC) curve_, Radiology 143, 1982 (AUC as the Mann-Whitney statistic).
- B. Efron and R. J. Tibshirani, _An Introduction to the Bootstrap_, Chapman & Hall, 1993.
