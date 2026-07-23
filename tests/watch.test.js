import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, renameSync, rmSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchDataDir } from '../lib/watch.js';

// Wait until predicate passes or time out. fs.watch delivery is lossy on
// macOS; the watcher's poll sweep guarantees delivery, so poll the collector.
async function until(fn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return fn();
}

// Short pollMs so tests rely on the deterministic sweep, not fs.watch luck.
function setup(t, { start = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-watch-'));
  const events = [];
  let close = () => {};
  if (start) close = watchDataDir(dir, { onEvent: (...e) => events.push(e), pollMs: 100 });
  t.after(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, events, close };
}

test('emits update when a collection file is written', async (t) => {
  const { dir, events } = setup(t);
  writeFileSync(join(dir, 'items', 'ITEM-001.md'), '---\nid: ITEM-001\n---\n');
  assert.ok(await until(() => events.length > 0), 'no event received');
  assert.deepStrictEqual(events[0], ['item', 'ITEM-001', 'update']);
});

test('atomicWrite pattern (.tmp then rename) yields update, nothing for the tmp name', async (t) => {
  const { dir, events } = setup(t);
  const target = join(dir, 'plans', 'PLAN-001.json');
  writeFileSync(target + '.tmp', '{"id":"PLAN-001"}');
  renameSync(target + '.tmp', target);
  assert.ok(await until(() => events.length > 0), 'no event received');
  assert.ok(events.every(e => e[1] === 'PLAN-001'), `tmp name leaked: ${JSON.stringify(events)}`);
  assert.deepStrictEqual(events[0], ['plan', 'PLAN-001', 'update']);
});

test('emits delete when a file is removed', async (t) => {
  const { dir, events } = setup(t);
  const file = join(dir, 'designs', 'SDD-001.md');
  writeFileSync(file, '---\nid: SDD-001\n---\n');
  assert.ok(await until(() => events.length > 0), 'no update event');
  events.length = 0;
  unlinkSync(file);
  assert.ok(await until(() => events.some(e => e[2] === 'delete')), 'no delete event');
  assert.deepStrictEqual(events[0], ['design', 'SDD-001', 'delete']);
});

test('file appearing in archive/ emits archive; leaving it emits nothing', async (t) => {
  const { dir, events } = setup(t);
  const archived = join(dir, 'archive', 'ITEM-002.md');
  writeFileSync(archived, '---\nid: ITEM-002\n---\n');
  assert.ok(await until(() => events.length > 0), 'no archive event');
  assert.deepStrictEqual(events[0], ['item', 'ITEM-002', 'archive']);
  events.length = 0;
  unlinkSync(archived);
  // Restores are covered by the collection-dir update; archive removal is silent.
  await new Promise(r => setTimeout(r, 400));
  assert.deepStrictEqual(events, []);
});

test('files present before the watcher starts emit nothing', async (t) => {
  const { dir, events, close } = setup(t, { start: false });
  mkdirSync(join(dir, 'items'), { recursive: true });
  writeFileSync(join(dir, 'items', 'ITEM-001.md'), '---\nid: ITEM-001\n---\n');
  const stop = watchDataDir(dir, { onEvent: (...e) => events.push(e), pollMs: 100 });
  t.after(stop);
  await new Promise(r => setTimeout(r, 400));
  assert.deepStrictEqual(events, []);
  close();
});

test('close() stops event delivery', async (t) => {
  const { dir, events, close } = setup(t);
  close();
  writeFileSync(join(dir, 'items', 'ITEM-001.md'), '---\nid: ITEM-001\n---\n');
  await new Promise(r => setTimeout(r, 400));
  assert.deepStrictEqual(events, []);
});
