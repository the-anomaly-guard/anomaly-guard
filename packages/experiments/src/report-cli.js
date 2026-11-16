// `npm run report` (D-08, ADR-014): the report's chapters, from their templates and the saved
// numbers.
//   npm run report               after editing a template: rewrites the chapters (seconds)
//   npm run report -- --update   after a change to the code: runs the experiment of ADR-009 on
//                                this commit (about 1.5 minutes), saves docs/report/numbers.json,
//                                then rewrites the chapters
// The numbers must come from a commit, so --update refuses uncommitted changes outside
// docs/report/. A sentence the new numbers no longer support is marked in the chapter and listed
// here. Node only. git is run directly (no shell) with fixed arguments.

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { codeFingerprint } from './fingerprint.js';
import {
  NUMBERS_FILE,
  ROOT,
  buildNumbers,
  readNumbers,
  renderChapters,
  writeNumbers,
} from './numbers.js';
import { provenance } from './provenance.js';
import { DEFAULT_CONFIG, runExperiment } from './run.js';

export const USAGE = `Usage: npm run report [-- --update]

  (no option)  write docs/report/<chapter>.<en|it>.md from docs/report/templates/ and the saved
               numbers, docs/report/numbers.json
  --update     first run the experiment of ADR-009 on the current commit (about 1.5 minutes) and
               save its numbers; needs no uncommitted change outside docs/report/
  --help       show this help`;

/**
 * Files with uncommitted changes outside docs/report/, or null without git.
 * @returns {string[] | null}
 */
function uncommittedCode() {
  try {
    const status = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/report'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return null;
  }
}

/**
 * @param {string[]} argv  the arguments after the script name
 * @param {{ log?: (line: string) => void, warn?: (line: string) => void }} [io]
 * @returns {Promise<number>} the exit code
 */
export async function runReport(argv, { log = console.log, warn = console.error } = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { update: { type: 'boolean' }, help: { type: 'boolean' } },
      strict: true,
    }));
  } catch (error) {
    warn(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const shown = (/** @type {string} */ file) => path.relative(process.cwd(), file) || file;

  if (values.update) {
    const changed = uncommittedCode();
    if (changed === null) {
      warn('git is not available: the numbers would not say which code they come from');
      return 1;
    }
    if (changed.length > 0) {
      const list = changed.slice(0, 5).join(', ') + (changed.length > 5 ? ', ...' : '');
      warn(`uncommitted changes outside docs/report/ (${list}): commit them first, so that the`);
      warn('numbers come from a commit that anyone can check out');
      return 1;
    }
    const before = existsSync(NUMBERS_FILE) ? readNumbers() : null;
    warn('running the experiment of ADR-009 (20 seeds, about 1.5 minutes)');
    const result = runExperiment(DEFAULT_CONFIG, {
      onSeed: (done, total) => warn(`  seed ${done}/${total}`),
    });
    // Only docs/report/ may differ from the commit, and the numbers never depend on it.
    const origin = { ...provenance(ROOT), dirty: false };
    const numbers = buildNumbers({ result, provenance: origin, fingerprint: codeFingerprint() });
    await writeNumbers(numbers);
    const same = before?.fingerprint === numbers.fingerprint;
    log(
      `wrote ${shown(NUMBERS_FILE)}, from commit ${origin.commit.slice(0, 7)}` +
        (same ? ' (same results as before: only the commit and the date changed)' : ''),
    );
  } else if (!existsSync(NUMBERS_FILE)) {
    warn(`${shown(NUMBERS_FILE)} does not exist yet: run npm run report -- --update`);
    return 1;
  }

  for (const chapter of await renderChapters(readNumbers())) {
    writeFileSync(chapter.path, chapter.text);
    log(`wrote ${shown(chapter.path)}`);
    for (const { id, says } of chapter.outdated) {
      warn(`  to rewrite, in templates/${chapter.file}: claim ${id} no longer holds (${says})`);
    }
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await runReport(process.argv.slice(2));
