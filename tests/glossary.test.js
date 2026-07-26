import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTermIndex, findTermMatches, firstMatchPerTerm, isTerm } from '../lib/glossary.js';

const term = (id, title, extra = {}) => ({
  id, type: 'term', title, body: `Definition of ${title}.`, aliases: [], related: [], ...extra
});

const surfaces = (text, index) => findTermMatches(text, index).map(m => m.text);
const ids = (text, index) => firstMatchPerTerm(findTermMatches(text, index)).map(m => m.termId);

test('hyphenated terms do not match inside longer hyphenated words', () => {
  const index = buildTermIndex([term('TERM-001', 'git-merge')]);
  assert.deepEqual(surfaces('a re-git-merge here', index), [], 'left side');
  assert.deepEqual(surfaces('a git-merge-strategy here', index), [], 'right side');
  assert.deepEqual(surfaces('the git-merge step', index), ['git-merge'], 'standalone');
  assert.deepEqual(surfaces('(git-merge)', index), ['git-merge'], 'punctuation is a boundary');
  assert.deepEqual(surfaces("git-merge's problem", index), ['git-merge'], 'possessive');
});

test('a signpost does not match inside a term that contains it', () => {
  const index = buildTermIndex([
    term('TERM-001', 'git-merge'),
    term('TERM-002', 'merge', { body: '', related: ['TERM-001'] })
  ]);
  assert.deepEqual(surfaces('a git-merge here', index), ['git-merge']);
  assert.deepEqual(surfaces('a merge here', index), ['merge']);
});

test('longest surface wins at the same position', () => {
  const index = buildTermIndex([term('TERM-001', 'merge'), term('TERM-002', 'merge conflict')]);
  const matches = findTermMatches('a merge conflict here', index);
  assert.deepEqual(matches.map(m => m.termId), ['TERM-002']);
  assert.deepEqual(matches.map(m => m.text), ['merge conflict']);
});

test('multi-word terms tolerate extra whitespace', () => {
  const index = buildTermIndex([term('TERM-001', 'merge conflict')]);
  assert.deepEqual(ids('a merge  conflict here', index), ['TERM-001']);
  assert.deepEqual(ids('a merge\tconflict here', index), ['TERM-001']);
});

test('inflections need an explicit alias — no stemming', () => {
  const bare = buildTermIndex([term('TERM-001', 'merge')]);
  assert.deepEqual(surfaces('two merges landed', bare), [], 'plural is not inferred');
  const aliased = buildTermIndex([term('TERM-001', 'merge', { aliases: ['merges'] })]);
  assert.deepEqual(surfaces('two merges landed', aliased), ['merges']);
});

test('matching is case-insensitive but the prose casing is preserved', () => {
  const index = buildTermIndex([term('TERM-001', 'git-merge')]);
  const matches = findTermMatches('Git-Merge is the VCS operation.', index);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, 'Git-Merge', 'renders what the author wrote');
  assert.equal(matches[0].title, 'git-merge', 'canonical title still available');
});

test('firstMatchPerTerm dedups an alias hit against a title hit', () => {
  const index = buildTermIndex([term('TERM-001', 'git-merge', { aliases: ['git-merging'] })]);
  const all = findTermMatches('git-merge then git-merging then git-merge', index);
  assert.equal(all.length, 3, 'every occurrence is reported');
  const first = firstMatchPerTerm(all);
  assert.equal(first.length, 1, 'one term, one link');
  assert.equal(first[0].text, 'git-merge');
});

test('signposts are derived from an empty body plus redirects', () => {
  const index = buildTermIndex([
    term('TERM-001', 'git-merge'),
    term('TERM-002', 'obsidian-merge'),
    term('TERM-003', 'merge', { body: '', related: ['TERM-001', 'TERM-002'] }),
    term('TERM-004', 'unfinished', { body: '', related: [] })
  ]);
  const [signpost] = findTermMatches('a merge here', index);
  assert.equal(signpost.kind, 'signpost');
  assert.deepEqual(signpost.targetTitles, ['git-merge', 'obsidian-merge'], 'ids resolved to words');

  const [defined] = findTermMatches('a git-merge here', index);
  assert.equal(defined.kind, 'term');

  const [orphan] = findTermMatches('an unfinished thing', index);
  assert.equal(orphan.kind, 'term', 'no body and no redirects is just undefined, not ambiguous');
});

test('an alias may not shadow an ambiguous word', () => {
  const index = buildTermIndex([
    term('TERM-001', 'git-merge', { aliases: ['merge'] }),
    term('TERM-002', 'merge', { body: '', related: ['TERM-001'] })
  ]);
  assert.deepEqual(surfaces('a merge here', index), ['merge']);
  assert.equal(findTermMatches('a merge here', index)[0].termId, 'TERM-002', 'signpost keeps the word');
  const conflict = index.conflicts.find(c => c.reason === 'alias-shadows-signpost');
  assert.ok(conflict, 'the dropped alias is reported, not silently discarded');
  assert.equal(conflict.termId, 'TERM-001');
});

test('surfaces below minLength are dropped with a conflict', () => {
  const index = buildTermIndex([term('TERM-001', 'pm')]);
  assert.deepEqual(surfaces('the PM Board is here', index), []);
  assert.equal(index.conflicts[0].reason, 'too-short');
});

test('a regex-hostile title cannot break the whole index', () => {
  const index = buildTermIndex([term('TERM-001', 'a|b('), term('TERM-002', 'git-merge')]);
  assert.deepEqual(surfaces('a git-merge here', index), ['git-merge'], 'other terms still work');
  assert.deepEqual(surfaces('literally a|b( here', index), ['a|b('], 'and it matches literally');
});

test('two consecutive scans with the same index agree', () => {
  const index = buildTermIndex([term('TERM-001', 'git-merge')]);
  const text = 'git-merge at the very start of the body';
  const first = findTermMatches(text, index);
  const second = findTermMatches(text, index);
  assert.deepEqual(second, first, 'a stale lastIndex would drop the leading match');
  assert.equal(second.length, 1);
});

test('non-term items are ignored', () => {
  const index = buildTermIndex([
    { id: 'SB-001', type: 'issue', title: 'git-merge', body: 'x' },
    term('TERM-001', 'vault-import')
  ]);
  assert.equal(index.size, 1);
  assert.deepEqual(surfaces('git-merge and vault-import', index), ['vault-import']);
  assert.equal(isTerm({ type: 'issue' }), false);
});

test('an empty glossary matches nothing and never throws', () => {
  const index = buildTermIndex([]);
  assert.equal(index.size, 0);
  assert.deepEqual(findTermMatches('any text at all', index), []);
  assert.deepEqual(findTermMatches('text', null), []);
});

test('lib/glossary.js stays browser-safe', () => {
  // The dashboard loads this file verbatim. A node builtin, a bare specifier, or
  // a `process` reference would 404/throw in the browser and silently disable
  // every term chip — with no server-side test noticing.
  const src = readFileSync(fileURLToPath(new URL('../lib/glossary.js', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual(imports, [], 'no imports at all — this module must stand alone');
  for (const forbidden of ['process.', 'require(', 'Buffer.', '__dirname', 'document.', 'window.']) {
    assert.ok(!src.includes(forbidden), `must not reference ${forbidden}`);
  }
});
