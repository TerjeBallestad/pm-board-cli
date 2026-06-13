import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';
import * as store from '../lib/store.js';
import { dispatch } from '../lib/dispatch.js';

// Point config + store at a fresh tmpdir for in-process dispatch (no server).
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pm-dispatch-'));
  writeFileSync(join(dir, 'pm.config.json'), JSON.stringify({ name: 'Test', port: 0, dataDir: 'data' }));
  mkdirSync(join(dir, 'data', 'designs'), { recursive: true });
  mkdirSync(join(dir, 'data', 'items'), { recursive: true });
  store.reset();
  loadConfig(dir);
  return {
    dir,
    cleanup() { rmSync(dir, { recursive: true, force: true }); store.reset(); }
  };
}

test('dispatch creates SDD and reads it back from disk', async (t) => {
  const { dir, cleanup } = setup();
  t.after(cleanup);
  const created = await dispatch('POST', '/api/designs', { title: 'First' });
  assert.equal(created.status, 201);
  assert.equal(created.data.id, 'SDD-001');
  assert.ok(existsSync(join(dir, 'data', 'designs', 'SDD-001.md')));

  const got = await dispatch('GET', '/api/designs/SDD-001');
  assert.equal(got.status, 200);
  assert.equal(got.data.title, 'First');
});

test('dispatch next id derives from disk, not a counter', async (t) => {
  const { dir, cleanup } = setup();
  t.after(cleanup);
  // Pre-seed a design file with a gap — no meta.json counter exists at all.
  writeFileSync(join(dir, 'data', 'designs', 'SDD-005.md'), '---\nid: SDD-005\ntitle: seeded\n---\n');
  const created = await dispatch('POST', '/api/designs', { title: 'Next' });
  assert.equal(created.data.id, 'SDD-006');
  assert.ok(!existsSync(join(dir, 'data', 'meta.json')) ||
    !JSON.parse(readFileSync(join(dir, 'data', 'meta.json'), 'utf8')).counters,
    'ids must not depend on a persisted counter');
});

test('dispatch never overwrites an existing id', async (t) => {
  const { dir, cleanup } = setup();
  t.after(cleanup);
  await dispatch('POST', '/api/designs', { title: 'One' });   // SDD-001
  const second = await dispatch('POST', '/api/designs', { title: 'Two' }); // must be SDD-002
  assert.equal(second.data.id, 'SDD-002');
  const first = await dispatch('GET', '/api/designs/SDD-001');
  assert.equal(first.data.title, 'One'); // untouched
});

test('dispatch fresh-reads disk between calls (no stale cache)', async (t) => {
  const { dir, cleanup } = setup();
  t.after(cleanup);
  await dispatch('POST', '/api/items', { type: 'issue', title: 'A' }); // SB-001
  // Simulate an external edit (e.g. git pull / hand edit) straight to disk.
  writeFileSync(join(dir, 'data', 'items', 'SB-009.md'), '---\nid: SB-009\ntype: issue\ntitle: external\nstage: inbox\n---\n');
  const got = await dispatch('GET', '/api/items/SB-009');
  assert.equal(got.status, 200);
  assert.equal(got.data.title, 'external');
  // And the next created id accounts for the externally-added SB-009.
  const created = await dispatch('POST', '/api/items', { type: 'issue', title: 'B' });
  assert.equal(created.data.id, 'SB-010');
});

test('dispatch returns 404 for unknown id and 501 for unmapped route', async (t) => {
  const { cleanup } = setup();
  t.after(cleanup);
  const missing = await dispatch('GET', '/api/designs/SDD-999');
  assert.equal(missing.status, 404);
  const unmapped = await dispatch('GET', '/api/nope');
  assert.equal(unmapped.status, 501);
});
