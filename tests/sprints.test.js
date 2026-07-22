import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestApp } from './helpers.js';

test('POST /api/sprints requires name', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/sprints').send({ problemStatement: 'p' });
  assert.equal(res.status, 400);
});

test('POST /api/sprints creates active sprint with sequential ID', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const a = await request(app).post('/api/sprints').send({ name: 'First' });
  const b = await request(app).post('/api/sprints').send({ name: 'Second' });
  assert.equal(a.body.id, 'SPRINT-001');
  assert.equal(a.body.status, 'active');
  assert.equal(b.body.id, 'SPRINT-002');
});

test('PATCH status=completed marks sprint items as done', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const sprint = await request(app).post('/api/sprints').send({ name: 's' });
  const sprintId = sprint.body.id;
  const item = await request(app).post('/api/items').send({ type: 'issue', title: 'in sprint' });
  await request(app).patch(`/api/items/${item.body.id}`).send({ sprintId });

  const otherItem = await request(app).post('/api/items').send({ type: 'issue', title: 'unassigned' });

  const completed = await request(app).patch(`/api/sprints/${sprintId}`).send({ status: 'completed' });
  assert.equal(completed.body.status, 'completed');
  assert.ok(completed.body.completedAt);

  const inSprint = await request(app).get(`/api/items/${item.body.id}`);
  assert.equal(inSprint.body.stage, 'done');

  const outOfSprint = await request(app).get(`/api/items/${otherItem.body.id}`);
  assert.notEqual(outOfSprint.body.stage, 'done');
});

test('GET /api/sprints/:id joins items, designs, plans', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const sprint = await request(app).post('/api/sprints').send({ name: 's' });
  const sprintId = sprint.body.id;

  const item = await request(app).post('/api/items').send({ type: 'issue', title: 'i', sprintId });
  const design = await request(app).post('/api/designs').send({ title: 'd', sprintId });
  const plan = await request(app).post('/api/plans').send({ title: 'p', sprintId, tasks: [] });

  const res = await request(app).get(`/api/sprints/${sprintId}`);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].id, item.body.id);
  assert.equal(res.body.designs.length, 1);
  assert.equal(res.body.designs[0].id, design.body.id);
  assert.equal(res.body.plans.length, 1);
  assert.equal(res.body.plans[0].id, plan.body.id);
});

test('sprint body: set on create, patchable, persists across reload', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app)
    .post('/api/sprints')
    .send({ name: 'Map', problemStatement: 'dest', body: '## Decisions so far\n- none' });
  assert.equal(created.body.body, '## Decisions so far\n- none');
  assert.deepEqual(created.body.comments, []);

  const patched = await request(app)
    .patch(`/api/sprints/${created.body.id}`)
    .send({ body: '## Out of scope\n- everything' });
  assert.equal(patched.body.body, '## Out of scope\n- everything');

  const fetched = await request(app).get(`/api/sprints/${created.body.id}`);
  assert.equal(fetched.body.body, '## Out of scope\n- everything');
  assert.equal(fetched.body.problemStatement, 'dest');
});

test('POST /api/sprints/:id/comments appends a comment', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const sprint = await request(app).post('/api/sprints').send({ name: 's' });

  const noText = await request(app).post(`/api/sprints/${sprint.body.id}/comments`).send({});
  assert.equal(noText.status, 400);

  const res = await request(app)
    .post(`/api/sprints/${sprint.body.id}/comments`)
    .send({ text: 'wayfinder session log', author: 'claude' });
  assert.equal(res.status, 201);
  assert.equal(res.body.author, 'claude');

  const fetched = await request(app).get(`/api/sprints/${sprint.body.id}`);
  assert.equal(fetched.body.comments.length, 1);
  assert.equal(fetched.body.comments[0].text, 'wayfinder session log');

  const missing = await request(app).post('/api/sprints/SPRINT-999/comments').send({ text: 'x' });
  assert.equal(missing.status, 404);
});

test('GET /api/sprints/:id → 404 for unknown sprint', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).get('/api/sprints/SPRINT-999');
  assert.equal(res.status, 404);
});
