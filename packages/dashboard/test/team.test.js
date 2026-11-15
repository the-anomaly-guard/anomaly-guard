import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEAM, profileUrl } from '../src/team.js';

test('TEAM: GitHub nicknames, valid, unique, in alphabetical order', () => {
  assert.ok(TEAM.length > 0);
  assert.ok(Object.isFrozen(TEAM));
  // GitHub: letters, digits and single hyphens inside, at most 39 characters
  for (const nickname of TEAM) {
    assert.match(nickname, /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, nickname);
  }
  assert.equal(new Set(TEAM.map((n) => n.toLowerCase())).size, TEAM.length, 'no duplicates');
  const sorted = [...TEAM].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual([...TEAM], sorted);
});

test('profileUrl: the GitHub profile of a nickname', () => {
  assert.equal(profileUrl('Sangioo'), 'https://github.com/Sangioo');
  assert.equal(profileUrl('giuseppe1-1'), 'https://github.com/giuseppe1-1');
});

test('about.html lists the team from team.js, not by hand', () => {
  const html = readFileSync(new URL('../about.html', import.meta.url), 'utf8');
  assert.match(html, /<ul id="team-list"><\/ul>/);
  assert.match(html, /src="\.\/src\/pages\/about\.js"/);
  for (const nickname of TEAM) {
    assert.ok(!html.includes(profileUrl(nickname)), `${nickname} is written by hand in about.html`);
  }
});
