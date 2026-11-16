// The saved numbers of the report, and the chapters made from them (D-08, ADR-014).
// docs/report/numbers.json holds one run of the experiment of ADR-009 (its summary across seeds),
// where it comes from (commit, date), what the code looked like at that point (the signals in the
// score, the attack families, the hard cases) and the fingerprint of that code. renderChapters
// fills every template of docs/report/templates/ from it, and formats the result with Prettier,
// the formatter of the repository, so the generated files pass `npm run format:check`. Node only.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { scoreRequest, trainStatModel } from '@anomaly-guard/core';
import { ATTACK_PAYLOADS, buildDataset } from '@anomaly-guard/traffic';
import { CHAPTERS } from './chapters/index.js';
import { renderTemplate } from './template.js';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const REPORT_DIR = path.join(ROOT, 'docs', 'report');
export const TEMPLATE_DIR = path.join(REPORT_DIR, 'templates');
export const NUMBERS_FILE = path.join(REPORT_DIR, 'numbers.json');

const ABOUT =
  'The numbers the chapters of the report are generated from: one run of the experiment of ' +
  'ADR-009 (D-04), summarised across seeds. Written by `npm run report -- --update`, never by ' +
  'hand (ADR-014); `fingerprint` is the fingerprint of the code that produced it.';

/**
 * What the chapters say about the code itself, measured on the first seed: the parts of the
 * statistical score, the attack families (novel when the rules have no signature for any of
 * their payloads), the path of each endpoint, how many distinct hard cases the test split
 * draws from, and the size of each split.
 * @param {import('./run.js').ExperimentConfig} config
 */
export function reportSetup(config) {
  const { train, calibration, test } = buildDataset({
    seed: config.seeds[0],
    trainSize: config.trainSize,
    calibrationSize: config.calibrationSize,
    testSize: config.testSize,
    prevalence: config.prevalence,
    hardShare: config.hardShare,
  });
  const model = trainStatModel(train.map((s) => s.request)); // legitimate only (ADR-004)
  const count = (/** @type {(s: any) => boolean} */ keep) => test.filter(keep).length;
  /** @type {Record<string, string>} */
  const endpoints = {};
  for (const s of [...train, ...test]) {
    if (s.label === 'legit' && s.variant === 'typical') endpoints[s.kind] ??= s.request.path;
  }
  return {
    signals: Object.keys(scoreRequest(model, test[0].request).parts),
    families: Object.fromEntries(
      Object.entries(ATTACK_PAYLOADS)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([family, payloads]) => [
          family,
          payloads.every((p) => p.variant === 'novel') ? 'novel' : 'targeted',
        ]),
    ),
    endpoints: Object.fromEntries(Object.entries(endpoints).sort(([a], [b]) => (a < b ? -1 : 1))),
    hardCases: new Set(
      test.filter((s) => s.variant === 'hard').map((s) => JSON.stringify(s.request)),
    ).size,
    split: {
      train: train.length,
      calibration: calibration.length,
      test: test.length,
      testLegit: count((s) => s.label === 'legit'),
      testHard: count((s) => s.variant === 'hard'),
      testAttacks: count((s) => s.label === 'attack'),
    },
  };
}

/**
 * The content of numbers.json.
 * @param {{ result: ReturnType<typeof import('./run.js').runExperiment>,
 *   provenance: ReturnType<typeof import('./provenance.js').provenance>, fingerprint: string }} run
 */
export function buildNumbers({ result, provenance, fingerprint }) {
  return {
    about: ABOUT,
    provenance,
    config: result.config,
    setup: reportSetup(result.config),
    fingerprint,
    summary: result.summary,
  };
}

/** @param {string} [file] */
export function readNumbers(file = NUMBERS_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * @param {ReturnType<typeof buildNumbers>} numbers
 * @param {string} [file]
 */
export async function writeNumbers(numbers, file = NUMBERS_FILE) {
  writeFileSync(file, await format(`${JSON.stringify(numbers, null, 2)}\n`, file));
}

/**
 * Text formatted as Prettier formats that file in this repository.
 * @param {string} text
 * @param {string} file  decides the parser (Markdown, JSON) and the settings
 * @param {{ proseWrap?: 'always' | 'preserve' }} [extra]
 */
async function format(text, file, extra = {}) {
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(text, { ...options, ...extra, filepath: file });
}

/**
 * Every chapter of the report, filled from the saved numbers: one per template
 * <chapter>.<en|it>.md, written next to the templates' folder. Writes nothing.
 * @param {any} numbers  the content of numbers.json
 * @param {{ templateDir?: string, outDir?: string }} [dirs]
 * @returns {Promise<{ file: string, path: string, text: string, facts: Set<string>,
 *   claims: Set<string>, outdated: { id: string, says: string }[] }[]>}
 */
export async function renderChapters(
  numbers,
  { templateDir = TEMPLATE_DIR, outDir = REPORT_DIR } = {},
) {
  const chapters = [];
  const files = readdirSync(templateDir)
    .filter((file) => file.endsWith('.md'))
    .sort();
  for (const file of files) {
    const match = /^(.+)\.(en|it)\.md$/.exec(file);
    if (!match) throw new Error(`templates/${file}: a template is named <chapter>.<en|it>.md`);
    const [, chapter, locale] = match;
    const factsOf = CHAPTERS[/** @type {keyof typeof CHAPTERS} */ (chapter)];
    if (!factsOf) {
      throw new Error(`templates/${file}: no chapter "${chapter}" in src/chapters/index.js`);
    }
    const { facts, claims } = factsOf(numbers);
    const rendered = renderTemplate(readFileSync(path.join(templateDir, file), 'utf8'), {
      facts,
      claims,
      locale: /** @type {'en' | 'it'} */ (locale),
      name: `templates/${file}`,
    });
    const target = path.join(outDir, file);
    const banner =
      `<!-- Generated by \`npm run report\` from templates/${file} and numbers.json (ADR-014). ` +
      'Edit the template, not this file. -->\n\n';
    chapters.push({
      file,
      path: target,
      // The numbers are shorter or longer than their placeholders: wrap the prose again at the
      // print width. `prettier --check` (proseWrap "preserve") accepts any wrapping.
      text: await format(banner + rendered.text, target, { proseWrap: 'always' }),
      facts: rendered.facts,
      claims: rendered.claims,
      outdated: rendered.outdated.map((id) => ({ id, says: claims[id].says })),
    });
  }
  return chapters;
}
