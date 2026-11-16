# ADR-014: The numbers of the report are generated from the experiment

**Date:** 2026-11-16
**Status:** Accepted
**Author:** Nicholas Arcari (task D-08)

## Context

- Every number of the report comes from `npm run experiments` (D-04, ADR-009), but the chapters
  held them as typed text. C-04 (ADR-012) changed the score on 2026-11-15, and the T3 chapter fell
  out of step with the code the same day. Every number of its Tables 1-4 changed, and some
  sentences that interpret them became false, not just old: the statistics' false alarms no longer
  come "mostly from search and comments", and the spread of their AUC across seeds no longer comes
  mostly from the training data. Nothing signalled it, while the dashboard, which computes
  everything in the browser, already showed the new results.
- C-06 will change every number again before the deadline, and T1, T2 and T4 still have chapters
  to write.
- There is no CI (ADR-005): a check has to run in `npm test`, on each member's machine.

## Decision

1. **A chapter is a template.** It is written once per language, in
   `docs/report/templates/<chapter>.<en|it>.md`, and each of its numbers is a placeholder
   (`{{hi.tpr.stats}}`) that `npm run report` fills from `docs/report/numbers.json`. The generated
   chapter, `docs/report/<chapter>.<en|it>.md`, is committed, so it reads on GitHub as before; its
   first line says not to edit it. Numbers follow each language (0.870 / 0,870; 1,643 / 1.643),
   with the article that fits the number in Italian (dell'1%, dello 0,1%, l'84%).
2. **numbers.json is the only source.** `npm run report -- --update` runs the experiment of ADR-009
   on the current commit (about 1.5 minutes; it refuses uncommitted changes outside
   `docs/report/`). It saves the summary across seeds, the commit and the date, a few facts about
   the code (the signals in the score, the novel families, the hard cases) and the fingerprint of
   point 3.
3. **A test catches a report that is out of date.** The fingerprint is the SHA-256 of every number
   of a small probe run of the same experiment: two seeds at the full sizes and 20 bootstrap
   resamples, about a second, rounded to ten significant digits. A change to the generator, the
   features, the rules, the model, the detector, the threshold or the metrics moves it; a refactor
   that moves no number does not. `npm test` fails when the fingerprint of the code differs from
   the saved one, and when a generated chapter differs from what its template gives (edited by
   hand, or not regenerated).
4. **Interpretations are checked, not frozen.** A sentence that interprets the numbers carries a
   claim (`<!-- claim: aucOrder -->`), a condition on the numbers defined next to the facts of the
   chapter (`packages/experiments/src/chapters/`). When a claim no longer holds, the chapter is
   still generated: the sentence is marked "To rewrite" in place, a note at the top counts the
   marks, and `npm run report` names them. A teammate whose change moves the numbers is never
   blocked by prose that is not theirs.

## Alternatives considered

| Alternative                                      | Why not                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Keep typing the numbers and update them by hand  | What failed with C-04: nothing says that the text is old, and a reader cannot tell                     |
| A CI job that regenerates the report             | No CI (ADR-005)                                                                                        |
| Run the whole experiment in `npm test`           | 1.5 minutes added to every test run                                                                    |
| Fingerprint the source files                     | Every comment or refactor would ask for a new run                                                      |
| Text that rewrites itself (if/else in templates) | Hard-to-read templates, and wording that nobody reviewed; a marked sentence is rewritten by its author |
| Stop the generation when a claim fails           | It would block a teammate's PR (C-06, for example) on another member's prose                           |
| A templating library (Handlebars, Nunjucks)      | A new dependency for one kind of placeholder; the engine is one short, tested module                   |

## Consequences

### Positive

- A chapter cannot silently disagree with the code: an old number fails a test, and an
  interpretation that no longer holds is marked.
- When C-06 lands, every number of the T3 chapter changes with one command.
- The T1, T2 and T4 chapters can use the same mechanism: a template pair and a facts module
  (`docs/report/README.md`).

### Negative / risks

- `npm test` takes about a second more (the probe).
- A change that moves the results asks its author to run `npm run report -- --update` and commit
  `docs/report/`, also when the change belongs to another theme.
- The probe has two seeds: a change that moves no number of those two runs (a rule for a payload
  the probe never draws) passes the test, and reaches the report at the next `--update`.
- Only sentences with a claim are checked: whoever writes a template has to attach claims to the
  sentences that interpret numbers.
- `npm run report` uses Prettier as a library, to format what it writes as `npm run format:check`
  expects. Prettier is already a development dependency of the repository.

### Actions

- [x] `packages/experiments/src`: `template.js` (placeholders, formats, claims), `chapters/t3.js`,
      `fingerprint.js`, `numbers.js`, `report-cli.js` (`npm run report`), with tests.
- [x] The T3 chapter as a template pair, generated from the run recorded in `numbers.json`.
- [ ] T1, T2 and T4: write their chapters as templates.
