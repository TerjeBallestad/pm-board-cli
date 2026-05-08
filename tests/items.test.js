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
