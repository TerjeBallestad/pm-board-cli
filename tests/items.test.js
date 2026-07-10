import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestApp } from './helpers.js';

test('GET /api/items returns empty array on fresh store', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).get('/api/items');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('POST /api/items creates an item with the configured prefix', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app)
    .post('/api/items')
    .send({ type: 'issue', title: 'First issue' });
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 'SB-001');
  assert.equal(res.body.title, 'First issue');
  assert.equal(res.body.type, 'issue');
  assert.equal(res.body.stage, 'inbox');
});

test('IDs increment per prefix independently', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const a = await request(app).post('/api/items').send({ type: 'issue', title: 'A' });
  const b = await request(app).post('/api/items').send({ type: 'issue', title: 'B' });
  const c = await request(app).post('/api/items').send({ type: 'decision', title: 'C' });
  assert.equal(a.body.id, 'SB-001');
  assert.equal(b.body.id, 'SB-002');
  assert.equal(c.body.id, 'DD-001');
});

test('GET /api/items?type=issue filters correctly', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  await request(app).post('/api/items').send({ type: 'issue', title: 'I1' });
  await request(app).post('/api/items').send({ type: 'decision', title: 'D1' });
  const res = await request(app).get('/api/items?type=issue');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].title, 'I1');
});

test('PATCH updates allowed fields and bumps updatedAt', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'orig' });
  const id = created.body.id;
  const before = created.body.updatedAt;
  await new Promise(r => setTimeout(r, 5));
  const patched = await request(app).patch(`/api/items/${id}`).send({ title: 'renamed', stage: 'exploring' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.title, 'renamed');
  assert.equal(patched.body.stage, 'exploring');
  assert.notEqual(patched.body.updatedAt, before);
});

test('PATCH rejects unknown stage', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'x' });
  const res = await request(app).patch(`/api/items/${created.body.id}`).send({ stage: 'bogus' });
  assert.equal(res.status, 400);
});

test('PATCH stage→done sets doneAt timestamp', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'x' });
  assert.equal(created.body.doneAt, undefined);
  const done = await request(app).patch(`/api/items/${created.body.id}`).send({ stage: 'done' });
  assert.ok(done.body.doneAt);
  // Re-patching done shouldn't reset doneAt
  const before = done.body.doneAt;
  await new Promise(r => setTimeout(r, 5));
  const repatched = await request(app).patch(`/api/items/${created.body.id}`).send({ stage: 'done', title: 'renamed' });
  assert.equal(repatched.body.doneAt, before);
});

test('POST comment appends and bumps updatedAt', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'x' });
  const before = created.body.updatedAt;
  await new Promise(r => setTimeout(r, 5));
  const c = await request(app).post(`/api/items/${created.body.id}/comments`).send({ author: 'tester', text: 'hi' });
  assert.equal(c.status, 201);
  assert.equal(c.body.text, 'hi');
  assert.equal(c.body.author, 'tester');

  const refreshed = await request(app).get(`/api/items/${created.body.id}`);
  assert.equal(refreshed.body.comments.length, 1);
  assert.notEqual(refreshed.body.updatedAt, before);
});

test('POST comment requires text', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'x' });
  const res = await request(app).post(`/api/items/${created.body.id}/comments`).send({ author: 'a' });
  assert.equal(res.status, 400);
});

test('sweep archives done items older than cutoff', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const fresh = await request(app).post('/api/items').send({ type: 'issue', title: 'fresh' });
  const stale = await request(app).post('/api/items').send({ type: 'issue', title: 'stale' });
  await request(app).patch(`/api/items/${fresh.body.id}`).send({ stage: 'done' });
  await request(app).patch(`/api/items/${stale.body.id}`).send({ stage: 'done' });

  // Sweep with 0 days → both eligible; with very large minAge → none.
  const noneSwept = await request(app).post('/api/items/archive/sweep').send({ days: 365 });
  assert.equal(noneSwept.body.archived, 0);

  const swept = await request(app).post('/api/items/archive/sweep').send({ days: 0 });
  assert.equal(swept.body.archived, 2);
  assert.deepEqual(swept.body.ids.sort(), [fresh.body.id, stale.body.id].sort());
});

test('sweep skips decisions even when done', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const decision = await request(app).post('/api/items').send({ type: 'decision', title: 'd' });
  await request(app).patch(`/api/items/${decision.body.id}`).send({ stage: 'done' });
  const swept = await request(app).post('/api/items/archive/sweep').send({ days: 0 });
  assert.equal(swept.body.archived, 0);
});

test('archive moves item out of active list', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/items').send({ type: 'issue', title: 'tmp' });
  const id = created.body.id;
  const archived = await request(app).post('/api/items/archive').send({ ids: [id] });
  assert.equal(archived.status, 200);
  assert.deepEqual(archived.body.ids, [id]);
  const list = await request(app).get('/api/items');
  assert.equal(list.body.length, 0);
  const archivedList = await request(app).get('/api/items/archived');
  assert.equal(archivedList.body.length, 1);
  assert.equal(archivedList.body[0].id, id);
});

test('blockedBy: set on create, patch, and string coercion', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app)
    .post('/api/items')
    .send({ type: 'issue', title: 'blocked', blockedBy: ['SB-099'] });
  assert.deepEqual(created.body.blockedBy, ['SB-099']);
  const patched = await request(app)
    .patch(`/api/items/${created.body.id}`)
    .send({ blockedBy: 'SB-001,SB-002' });
  assert.deepEqual(patched.body.blockedBy, ['SB-001', 'SB-002']);
  const cleared = await request(app)
    .patch(`/api/items/${created.body.id}`)
    .send({ blockedBy: '' });
  assert.deepEqual(cleared.body.blockedBy, []);
});

test('GET /api/items?frontier=true hides blocked and done items', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const blocker = await request(app).post('/api/items').send({ type: 'issue', title: 'blocker' }); // SB-001
  const blocked = await request(app).post('/api/items').send({ type: 'issue', title: 'blocked', blockedBy: [blocker.body.id] });
  const free = await request(app).post('/api/items').send({ type: 'issue', title: 'free' });
  const ghost = await request(app).post('/api/items').send({ type: 'issue', title: 'ghost-blocked', blockedBy: ['SB-999'] });

  let res = await request(app).get('/api/items?frontier=true');
  let titles = res.body.map(i => i.title).sort();
  // blocker itself is on the frontier; blocked is hidden; unknown blocker ids don't block
  assert.deepEqual(titles, ['blocker', 'free', 'ghost-blocked']);

  // Completing the blocker releases the blocked item; done items leave the frontier
  await request(app).patch(`/api/items/${blocker.body.id}`).send({ stage: 'done' });
  res = await request(app).get('/api/items?frontier=true');
  titles = res.body.map(i => i.title).sort();
  assert.deepEqual(titles, ['blocked', 'free', 'ghost-blocked']);
  assert.equal(free.status, 201);
  assert.equal(ghost.status, 201);
});
