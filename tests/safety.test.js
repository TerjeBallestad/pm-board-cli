import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestApp } from './helpers.js';
import * as store from '../lib/store.js';
import { commitNow } from '../lib/autocommit.js';
import { loadConfig } from '../lib/config.js';

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

test('autoCommit: writes land as git commits in the data dir', async (t) => {
  const { app, dir, cleanup } = await setupTestApp({ autoCommit: true });
  t.after(cleanup);
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  git(dataDir, 'init', '-q');
  git(dataDir, 'config', 'user.email', 'test@test');
  git(dataDir, 'config', 'user.name', 'test');

  const res = await request(app).post('/api/items').send({ type: 'issue', title: 'First' });
  assert.equal(res.status, 201);
  commitNow(); // flush the debounce instead of waiting it out

  const log = git(dataDir, 'log', '--oneline');
  assert.match(log, /\[pm\] auto-commit data/);
  const files = git(dataDir, 'ls-files');
  assert.match(files, new RegExp(`items/${res.body.id}\\.md`));
});

test('autoCommit off by default: no repo, no commit, writes still work', async (t) => {
  const { app, dir, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/items').send({ type: 'issue', title: 'Plain' });
  assert.equal(res.status, 201);
  commitNow();
  assert.ok(!readdirSync(join(dir, 'data')).includes('.git'));
});

test('rewind detection: externally deleted newest file flags the load', async (t) => {
  const { app, dir, cleanup } = await setupTestApp();
  t.after(cleanup);

  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'Doomed' });
  assert.equal(created.status, 201);
  // Health after a normal write: no rewound flag
  let health = await request(app).get('/api/health');
  assert.equal(health.body.rewound, undefined);

  // Simulate a git-reset-style rewind: file vanishes behind the store's back
  unlinkSync(join(dir, 'data', 'items', `${created.body.id}.md`));
  store.reset();
  loadConfig(dir);

  health = await request(app).get('/api/health');
  assert.ok(health.body.rewound, 'expected rewound flag on health');
  assert.ok(health.body.rewound.seenMax > (health.body.rewound.diskMax || ''));
});

test('rewind detection: deleting via the API does not false-positive', async (t) => {
  const { app, dir, cleanup } = await setupTestApp();
  t.after(cleanup);

  const a = await request(app).post('/api/items').send({ type: 'issue', title: 'Keep' });
  const b = await request(app).post('/api/items').send({ type: 'issue', title: 'Newest, deleted legally' });
  assert.equal(b.status, 201);

  const del = await request(app).delete(`/api/items/${b.body.id}`);
  assert.equal(del.status, 204);

  store.reset();
  loadConfig(dir);
  const health = await request(app).get('/api/health');
  assert.equal(health.body.rewound, undefined);
  assert.ok(a.body.id);
});
