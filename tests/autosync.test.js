import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestApp } from './helpers.js';
import { commitNow } from '../lib/autocommit.js';
import { pullNow, pushNow, syncNow, autoSyncEnabled, resetAutoSync } from '../lib/autosync.js';

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

// Bare origin + a data-dir clone wired as its remote, so pull/push run
// against a real upstream without any network.
function setupOrigin(t, dataDir) {
  const originDir = mkdtempSync(join(tmpdir(), 'pm-origin-'));
  t.after(() => rmSync(originDir, { recursive: true, force: true }));
  git(originDir, 'init', '-q', '--bare');
  // Regardless of the host's init.defaultBranch, clones must land on main.
  git(originDir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(dataDir, { recursive: true });
  git(dataDir, 'init', '-q', '-b', 'main');
  git(dataDir, 'config', 'user.email', 'test@test');
  git(dataDir, 'config', 'user.name', 'test');
  writeFileSync(join(dataDir, '.gitkeep'), '');
  git(dataDir, 'add', '.gitkeep');
  git(dataDir, 'commit', '-q', '-m', 'init');
  git(dataDir, 'remote', 'add', 'origin', originDir);
  git(dataDir, 'push', '-q', '-u', 'origin', 'main');
  return originDir;
}

// A second clone standing in for the other machine.
function cloneAsOtherMachine(t, originDir) {
  const otherDir = mkdtempSync(join(tmpdir(), 'pm-other-'));
  t.after(() => rmSync(otherDir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', originDir, otherDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(otherDir, 'config', 'user.email', 'other@test');
  git(otherDir, 'config', 'user.name', 'other');
  return otherDir;
}

test('autoSync: pullNow brings the other machine\'s commits into the data dir', async (t) => {
  const { dir, cleanup } = await setupTestApp({ autoCommit: true, autoSync: true });
  t.after(cleanup);
  t.after(resetAutoSync);
  const dataDir = join(dir, 'data');
  const originDir = setupOrigin(t, dataDir);

  const otherDir = cloneAsOtherMachine(t, originDir);
  writeFileSync(join(otherDir, 'remote-note.md'), 'from the other machine\n');
  git(otherDir, 'add', 'remote-note.md');
  git(otherDir, 'commit', '-q', '-m', 'remote work');
  git(otherDir, 'push', '-q');

  const result = pullNow(dataDir);
  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(dataDir, 'remote-note.md'), 'utf-8'), 'from the other machine\n');
});

test('autoSync: conflicted pull aborts back to local state and reports', async (t) => {
  const { dir, cleanup } = await setupTestApp({ autoCommit: true, autoSync: true });
  t.after(cleanup);
  t.after(resetAutoSync);
  const dataDir = join(dir, 'data');
  const originDir = setupOrigin(t, dataDir);

  const otherDir = cloneAsOtherMachine(t, originDir);
  writeFileSync(join(otherDir, 'contested.md'), 'other machine version\n');
  git(otherDir, 'add', 'contested.md');
  git(otherDir, 'commit', '-q', '-m', 'other side');
  git(otherDir, 'push', '-q');

  writeFileSync(join(dataDir, 'contested.md'), 'local version\n');
  git(dataDir, 'add', 'contested.md');
  git(dataDir, 'commit', '-q', '-m', 'local side');

  const result = pullNow(dataDir);
  assert.equal(result.ok, false);
  // Local state intact: no rebase in progress, local content preserved.
  assert.equal(readFileSync(join(dataDir, 'contested.md'), 'utf-8'), 'local version\n');
  assert.match(git(dataDir, 'status'), /nothing to commit|working tree clean/);
});

test('autoSync: syncNow pushes local auto-commits to the origin', async (t) => {
  const { app, dir, cleanup } = await setupTestApp({ autoCommit: true, autoSync: true });
  t.after(cleanup);
  t.after(resetAutoSync);
  const dataDir = join(dir, 'data');
  const originDir = setupOrigin(t, dataDir);

  const res = await request(app).post('/api/items').send({ type: 'issue', title: 'Synced' });
  assert.equal(res.status, 201);
  commitNow(); // flush the debounce; the detached push may or may not land first
  const result = syncNow(dataDir);
  assert.equal(result.ok, true);

  const originLog = git(originDir, 'log', '--oneline', 'main');
  assert.match(originLog, /\[pm\] auto-commit data/);
});

test('autoSync: pushNow reports a rejected push instead of throwing', async (t) => {
  const { dir, cleanup } = await setupTestApp({ autoCommit: true, autoSync: true });
  t.after(cleanup);
  t.after(resetAutoSync);
  const dataDir = join(dir, 'data');
  const originDir = setupOrigin(t, dataDir);

  const otherDir = cloneAsOtherMachine(t, originDir);
  writeFileSync(join(otherDir, 'ahead.md'), 'x\n');
  git(otherDir, 'add', 'ahead.md');
  git(otherDir, 'commit', '-q', '-m', 'origin moved ahead');
  git(otherDir, 'push', '-q');

  writeFileSync(join(dataDir, 'local.md'), 'y\n');
  git(dataDir, 'add', 'local.md');
  git(dataDir, 'commit', '-q', '-m', 'local commit');

  assert.equal(pushNow(dataDir).ok, false);
  // syncNow resolves the same situation: pull first, then push.
  assert.equal(syncNow(dataDir).ok, true);
  assert.match(git(originDir, 'log', '--oneline', 'main'), /local commit/);
});

test('autoSync off (or no remote): autoSyncEnabled gates to false', async (t) => {
  const { dir, cleanup } = await setupTestApp({ autoCommit: true, autoSync: true });
  t.after(cleanup);
  t.after(resetAutoSync);
  const dataDir = join(dir, 'data');
  // A repo with no remote: enabled flag must stay off even with config on.
  mkdirSync(dataDir, { recursive: true });
  git(dataDir, 'init', '-q');
  resetAutoSync();
  assert.equal(autoSyncEnabled(), false);
});
