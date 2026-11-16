# Report

The final report (E-05). It has one chapter per statistical theme, plus an introduction, a method
overview, and the conclusions and limitations, which the group writes together. The report may be
in Italian (AGENTS.md §8). Each chapter here has an Italian and an English version, kept in step.

| Chapter                                | Theme | Author          | Files                                                                                 | Status |
| -------------------------------------- | ----- | --------------- | ------------------------------------------------------------------------------------- | ------ |
| Character distributions and chi-square | T1    | -               | -                                                                                     | to do  |
| Lengths and outliers                   | T2    | -               | -                                                                                     | to do  |
| Evaluation and uncertainty             | T3    | Nicholas Arcari | [IT](t3-evaluation-and-uncertainty.it.md) · [EN](t3-evaluation-and-uncertainty.en.md) | draft  |
| Probability and simulation             | T4    | Giuseppe        | -                                                                                     | to do  |

## Numbers

No number in a chapter is typed by hand (ADR-014). A chapter is written once per language, as a
template in [`templates/`](templates/), and its numbers are placeholders. `npm run report` fills
them from [`numbers.json`](numbers.json): one run of the experiment of ADR-009 on a named commit
(`packages/experiments`, D-04).

| Command                      | When                                                       | What it does                                                                                                            |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run report`             | after editing a template                                   | rewrites the chapters from the templates and the saved numbers (seconds)                                                |
| `npm run report -- --update` | after a change that moves the results (`npm test` says so) | commit first; it runs the experiment on that commit (about 1.5 minutes), saves `numbers.json` and rewrites the chapters |

- **Edit the template, never the generated chapter.** `npm test` fails when a chapter differs from
  what its template gives, and when the code no longer gives the saved results: `numbers.json`
  keeps the fingerprint of the code that produced it (a small run of the experiment, hashed).
- **Placeholders.** `{{hi.tpr.stats}}` is a fact of the chapter, defined in
  `packages/experiments/src/chapters/<chapter>.js`, and written in the template's language: 78.5%
  [77.5-79.4] in English, 78,5% [77,5-79,4] in Italian. Modifiers follow a colon: `:mean` (the mean
  without its interval), `:0` (no decimals), `:words` and `:Words` (five, Five / cinque, Cinque),
  `:a` (a 1%, an 8%), and the Italian articles `:il`, `:del`, `:al`, `:dal`, `:nel`, `:sul` (il
  59%, l'84%, dell'1%, dello 0,1%).
- **Claims.** A sentence that interprets the numbers ends with `<!-- claim: id -->`, a condition on
  the numbers defined next to the facts. When new numbers no longer support it, the chapter is still
  generated: the sentence is marked "To rewrite" ("Da riscrivere"), a note at the top counts the
  marks, and `npm run report` names them. Rewrite the sentence in the template.
- **A new chapter.** Write `templates/<name>.en.md` and `templates/<name>.it.md`, a facts module in
  `packages/experiments/src/chapters/`, and list it in `chapters/index.js`. The two languages must
  use the same facts and claims: a test checks it.

The written method behind the numbers is in
[`../statistics/methods.md`](../statistics/methods.md); the decisions are in the ADRs (ADR-004,
ADR-009, ADR-014).
