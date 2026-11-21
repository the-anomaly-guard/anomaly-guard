# ADR-017: Import logs - the baseline is a separate log of normal traffic, without known attacks

**Date:** 2026-11-21
**Status:** Accepted
**Author:** Nicholas Arcari (task E-11)

## Context

- ADR-016 let the baseline of the Import logs page, what counts as normal, be a separate log or
  the first 25, 50 or 75% of the log itself. Taking part of the same log mixes the two roles: the
  requests that set what is normal are never inspected, whatever attack sits among them is learned
  as normal, and only the rest of the log is inspected.
- Real traffic always holds scans. On public access logs with real scans, half of each taken as
  the baseline held requests that match a signature: 8 of 892 (CVE-2021-41773 traversals,
  Mirai-style shell probes), 4 of 518, 1 of 498.
- A baseline is easily read as a catalogue of attacks, which new attacks would always outdate. It
  is the opposite: normal traffic, from which the statistics learn how each page and parameter
  usually looks, so that a new attack stands out with no signature. On the simulated traffic, at a
  1% target, the statistics catch 93.7% of the attacks of families the rules have no signature
  for; the rules catch none (the T3 chapter of the report).

## Decision

1. **The baseline is a separate log, required by the statistics** (statistics only, rules +
   statistics): normal traffic of the same site, from another period. The log loaded is inspected
   whole. The rules alone need no baseline, since they learn nothing.
2. **Known attacks are left out of the baseline.** Its requests that match a signature are dropped
   before the model learns and the threshold is set (train on normal only, ADR-004). The page says
   how many, and shows the first, so that a signature firing on the site's normal traffic shows
   too.
3. **The page says why the baseline needs no attacks**, and warns when the baseline file is the
   inspected log itself.
4. **The sample is two logs:** a baseline of 4,000 legitimate requests, put in the baseline input,
   and a log of 1,000 requests with 10% attacks that follows it in time.

This replaces decision 5 of ADR-016 for the choice of the baseline; its split (the first 70%
trains the model, the last 30% sets the threshold) is unchanged.

## Alternatives considered

| Alternative                                         | Why not                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Keep the first 25, 50 or 75% of the log as baseline | One log is enough, but the attacks in that part are learned as normal and never inspected                |
| Keep the signature matches in the baseline          | They are known attacks: the model would learn them as normal traffic                                     |
| Also drop the statistical outliers of the baseline  | They are mostly unusual but legitimate requests, which the threshold must account for: more false alarms |
| Require a baseline with the rules alone too         | The rules learn nothing from it                                                                          |

## Consequences

### Positive

- What is learned and what is inspected never overlap, like the training and test splits of the
  experiment (ADR-004).
- Known attacks in the baseline no longer teach the model that they are normal, and the user sees
  them.

### Negative / risks

- Two logs are needed: the baseline from a period the user trusts, and the log to inspect.
- An attack that no signature knows, inside the baseline, is still learned as normal.
- A baseline from another period may miss pages added since: requests to them are never seen, and
  may raise false alarms.
- A short baseline gives a noisy threshold: the `n ≥ 10/α` warning stays.

### Actions

- [x] `src/log-import/analyse.js` (known attacks left out), `src/log-import/sample.js` (two
      logs), the page (`logs.html`, `src/pages/logs.js`) and the tests.
