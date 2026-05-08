import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestApp } from './helpers.js';

test('POST /api/designs requires title', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/designs').send({ body: 'no title' });
  assert.equal(res.status, 400);
});

test('POST /api/designs creates SDD with sequential ID and sdd stage', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/designs').send({ title: 'First SDD' });
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 'SDD-001');
  assert.equal(res.body.stage, 'sdd');
  assert.deepEqual(res.body.itemIds, []);
});

test('POST /api/designs with itemIds moves linked items to sdd stage', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const item = await request(app).post('/api/items').send({ type: 'issue', title: 'i' });
  assert.equal(item.body.stage, 'inbox');
  await request(app).post('/api/designs').send({ title: 'd', itemIds: [item.body.id] });
  const after = await request(app).get(`/api/items/${item.body.id}`);
  assert.equal(after.body.stage, 'sdd');
});

test('POST /api/designs does not move done items', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const item = await request(app).post('/api/items').send({ type: 'issue', title: 'i' });
  await request(app).patch(`/api/items/${item.body.id}`).send({ stage: 'done' });
  await request(app).post('/api/designs').send({ title: 'd', itemIds: [item.body.id] });
  const after = await request(app).get(`/api/items/${item.body.id}`);
  assert.equal(after.body.stage, 'done');
});

test('PATCH /api/designs coerces string itemIds to array', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const item1 = await request(app).post('/api/items').send({ type: 'issue', title: 'a' });
  const item2 = await request(app).post('/api/items').send({ type: 'issue', title: 'b' });
  const design = await request(app).post('/api/designs').send({ title: 'd' });
  const res = await request(app).patch(`/api/designs/${design.body.id}`).send({
    itemIds: `${item1.body.id}, ${item2.body.id}`
  });
  assert.deepEqual(res.body.itemIds, [item1.body.id, item2.body.id]);
});

test('GET /api/designs?sprintId filters by sprint', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const s = await request(app).post('/api/sprints').send({ name: 's' });
  await request(app).post('/api/designs').send({ title: 'in', sprintId: s.body.id });
  await request(app).post('/api/designs').send({ title: 'out' });
  const res = await request(app).get(`/api/designs?sprintId=${s.body.id}`);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].title, 'in');
});
