import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/run.js';
import { canonical, codeFingerprint, fingerprint } from '../src/fingerprint.js';
import { TEMPLATE_DIR, readNumbers, renderChapters } from '../src/numbers.js';
import { formatFact, renderTemplate } from '../src/template.js';
import { runReport } from '../src/report-cli.js';

const numbers = readNumbers();

test('numbers.json comes from the code as it is now (else: npm run report -- --update)', () => {
  const now = codeFingerprint();
  assert.ok(
    now === numbers.fingerprint,
    `The detector's results have changed since docs/report/numbers.json was made (commit ` +
      `${numbers.provenance.commit.slice(0, 7)}), so the numbers of the report are out of date. ` +
      'Commit your change, run `npm run report -- --update` (about 1.5 minutes) and commit ' +
      'docs/report/ (ADR-014).',
  );
});

test('the chapters in docs/report are exactly what their templates give (else: npm run report)', async (t) => {
  const chapters = await renderChapters(numbers);
  assert.ok(chapters.length >= 2, 'one chapter per template and language');
  for (const chapter of chapters) {
    const written = readFileSync(chapter.path, 'utf8');
    const line = firstDifference(written, chapter.text);
    assert.ok(
      line === 0,
      `docs/report/${chapter.file} differs from its template at line ${line}: it was edited by ` +
        `hand, or its template or numbers.json changed. Edit templates/${chapter.file} and run ` +
        '`npm run report` (ADR-014).',
    );
    for (const { id, says } of chapter.outdated) {
      t.diagnostic(`${chapter.file}: claim ${id} no longer holds (${says}): rewrite the sentence`);
    }
  }
});

test('numbers.json is the ADR-009 run on a commit, with every part a chapter needs', () => {
  assert.deepEqual(numbers.config, {
    ...DEFAULT_CONFIG,
    seeds: [...DEFAULT_CONFIG.seeds],
    targets: [...DEFAULT_CONFIG.targets],
  });
  assert.equal(numbers.provenance.dirty, false);
  assert.match(numbers.provenance.commit, /^[0-9a-f]{40}$/);
  assert.match(numbers.fingerprint, /^[0-9a-f]{64}$/);
  for (const key of ['signals', 'families', 'endpoints', 'hardCases', 'split']) {
    assert.ok(numbers.setup[key] !== undefined, `setup.${key}`);
  }
  assert.ok(numbers.summary.modes.stats.points.length === DEFAULT_CONFIG.targets.length);
});

test('the two languages of a chapter use the same numbers and the same claims', async () => {
  const byChapter = new Map();
  for (const chapter of await renderChapters(numbers)) {
    const name = chapter.file.replace(/\.(en|it)\.md$/, '');
    const seen = byChapter.get(name);
    const used = { facts: [...chapter.facts].sort(), claims: [...chapter.claims].sort() };
    if (seen) assert.deepEqual(used, seen, `${name}: English and Italian differ`);
    else byChapter.set(name, used);
  }
  assert.ok(byChapter.size >= 1);
  const templates = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.md'));
  assert.equal(templates.length, byChapter.size * 2, 'every chapter has both languages');
});

test('a generated chapter has no blank, NaN or leftover placeholder', async () => {
  for (const chapter of await renderChapters(numbers)) {
    assert.doesNotMatch(
      chapter.text,
      /NaN|undefined|Infinity|\{\{|\}\}|<!--\s*claim/,
      chapter.file,
    );
    assert.doesNotMatch(chapter.text, /[—–→←…]/, `${chapter.file}: plain typography`);
  }
});

test('formatFact: numbers in English and Italian', () => {
  const en = (fact, ...mods) => formatFact(fact, 'en', mods);
  const it = (fact, ...mods) => formatFact(fact, 'it', mods);
  assert.equal(en({ kind: 'int', value: 1643 }), '1,643');
  assert.equal(it({ kind: 'int', value: 1643 }), '1.643'); // grouped with four digits too
  assert.equal(it({ kind: 'int', value: 90000 }), '90.000');
  assert.equal(en({ kind: 'dec', value: 0.86971, digits: 3 }), '0.870');
  assert.equal(it({ kind: 'dec', value: 0.86971, digits: 3 }), '0,870');
  assert.equal(en({ kind: 'pct', value: 0.0204, digits: 2 }), '2.04%');
  assert.equal(it({ kind: 'pct', value: 0.0204, digits: 2 }), '2,04%');
  const tpr = {
    kind: 'interval',
    of: 'pct',
    digits: 1,
    estimate: 0.6203,
    lower: 0.6084,
    upper: 0.6322,
    sd: 0.025,
  };
  assert.equal(en(tpr), '62.0% [60.8-63.2]');
  assert.equal(it(tpr), '62,0% [60,8-63,2]');
  assert.equal(en(tpr, 'mean'), '62.0%');
  assert.equal(en(tpr, '0'), '62%');
  const every = { kind: 'interval', of: 'pct', digits: 1, estimate: 1, lower: 1, upper: 1, sd: 0 };
  assert.equal(en(every), '100% (every seed)');
  assert.equal(it(every), '100% (in ogni seed)');
  assert.equal(en(every, 'mean'), '100%');
  assert.equal(en({ kind: 'range', of: 'int', digits: 0, min: 163, max: 197 }), '163-197');
  assert.equal(en({ kind: 'range', of: 'int', digits: 0, min: 4275, max: 4275 }), '4,275');
  assert.equal(en({ kind: 'range', of: 'dec', digits: 3, min: 0.687, max: 0.727 }), '0.687-0.727');
  assert.equal(en({ kind: 'p', value: 1e-30 }), '< 0.001');
  assert.equal(it({ kind: 'p', value: 1 }), '1,000');
  assert.equal(it({ kind: 'text', en: 'none', it: 'nessuno' }), 'nessuno');
});

test('formatFact: counts in words and the articles before a number', () => {
  const en = (fact, ...mods) => formatFact(fact, 'en', mods);
  const it = (fact, ...mods) => formatFact(fact, 'it', mods);
  const count = (value) => ({ kind: 'int', value });
  const share = (value, digits = 0) => ({ kind: 'pct', value, digits });
  assert.equal(en(count(5), 'Words'), 'Five');
  assert.equal(it(count(9), 'words'), 'nove');
  assert.equal(en(count(25), 'words'), '25');
  assert.equal(en(share(0.01), 'a'), 'a 1%');
  assert.equal(en(share(0.08), 'a'), 'an 8%');
  assert.equal(en(share(0.11), 'a'), 'an 11%');
  assert.equal(en(share(0.84), 'a'), 'an 84%');
  assert.equal(en(share(0.001, 1), 'a'), 'a 0.1%');
  assert.equal(it(share(0.59), 'il'), 'il 59%');
  assert.equal(it(share(0.84), 'il'), "l'84%");
  assert.equal(it(share(0.01), 'del'), "dell'1%");
  assert.equal(it(share(0.001, 1), 'del'), 'dello 0,1%');
  assert.equal(it(share(0), 'il'), 'lo 0%');
  assert.equal(it(share(0.62), 'dal'), 'dal 62%');
  assert.equal(it(share(0.08), 'al'), "all'8%");
  assert.equal(it(share(0.11), 'nel'), "nell'11%");
  assert.equal(it(count(800), 'il'), "l'800");
  assert.equal(it(count(1000), 'il'), 'il 1.000');
  assert.equal(it(count(8000), 'il'), "l'8.000");
  assert.throws(() => en(share(0.5), 'il'), /unknown modifier/); // an Italian article in English
  assert.throws(() => en(share(0.5), 'words'), /only for a count/);
});

test('renderTemplate: placeholders, claims, and errors instead of blanks', () => {
  const facts = { n: { kind: 'int', value: 3 }, rate: { kind: 'pct', value: 0.5, digits: 0 } };
  const claims = { ok: { holds: true, says: 'fine' }, gone: { holds: false, says: 'no more' } };
  const ok = renderTemplate('# T\n\n{{n:Words}} tests, {{ rate }} pass.<!-- claim: ok -->\n', {
    facts,
    claims,
    locale: 'en',
  });
  assert.equal(ok.text, '# T\n\nThree tests, 50% pass.\n');
  assert.deepEqual([...ok.facts].sort(), ['n', 'rate']);
  assert.deepEqual(ok.outdated, []);

  const stale = renderTemplate('# T\n\nMost pass.<!-- claim: gone --> Fine.<!-- claim: ok -->\n', {
    facts,
    claims,
    locale: 'it',
  });
  assert.deepEqual(stale.outdated, ['gone']);
  assert.match(stale.text, /^# T\n\n> \*\*Da riscrivere:\*\* una frase non corrisponde più/);
  assert.match(stale.text, /Most pass\. \*\*\[Da riscrivere: .*\(claim gone\)\.\]\*\* Fine\.\n$/);

  assert.throws(
    () => renderTemplate('{{missing}}', { facts, claims, locale: 'en' }),
    /unknown fact/,
  );
  assert.throws(
    () => renderTemplate('x<!-- claim: nope -->', { facts, claims, locale: 'en' }),
    /unknown claim/,
  );
  assert.throws(
    () => renderTemplate('{{n:shout}}', { facts, claims, locale: 'en' }),
    /unknown modifier/,
  );
  assert.throws(() => renderTemplate('{{ n | 0 }}', { facts, claims, locale: 'en' }), /malformed/);
});

test('fingerprint: the same results give the same hash, whatever the key order or float noise', () => {
  const a = { x: 0.1 + 0.2, y: [1, 2, { z: Infinity }] };
  const b = { y: [1, 2, { z: Infinity }], x: 0.3 };
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint({ ...a, x: 0.31 }));
  assert.deepEqual(canonical({ b: 2, a: [NaN, -Infinity] }), { a: ['NaN', '-Infinity'], b: 2 });
});

test('npm run report: --help, and a wrong option', async () => {
  const lines = [];
  const io = { log: (l) => lines.push(l), warn: (l) => lines.push(l) };
  assert.equal(await runReport(['--help'], io), 0);
  assert.match(lines.join('\n'), /--update/);
  assert.equal(await runReport(['--nope'], io), 2);
});

/** 0 when the texts are equal, else the number of the first line that differs. */
function firstDifference(a, b) {
  if (a === b) return 0;
  const [x, y] = [a.split('\n'), b.split('\n')];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 1;
}
