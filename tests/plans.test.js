import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestApp } from './helpers.js';

test('POST /api/plans creates plan with sequential task IDs', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/plans').send({
    title: 'Test plan',
    tasks: [
      { title: 'First' },
      { title: 'Second' }
    ]
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 'PLAN-001');
  assert.equal(res.body.tasks.length, 2);
  assert.equal(res.body.tasks[0].id, 'TASK-001');
  assert.equal(res.body.tasks[1].id, 'TASK-002');
  assert.equal(res.body.tasks[0].status, 'pending');
  assert.equal(res.body.tasks[0].passes, false);
});

test('blockedBy ordinals (TASK-1, TASK-2) resolve to real task IDs', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [
      { title: 'A' },
      { title: 'B', blockedBy: ['TASK-1'] },
      { title: 'C', blockedBy: ['TASK-1', 'TASK-2'] }
    ]
  });
  const [a, b, c] = res.body.tasks;
  assert.deepEqual(b.blockedBy, [a.id]);
  assert.deepEqual(c.blockedBy, [a.id, b.id]);
});

test('next-task returns unblocked tasks with progress', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [
      { title: 'A' },
      { title: 'B', blockedBy: ['TASK-1'] }
    ]
  });
  const planId = created.body.id;
  const [a, b] = created.body.tasks;

  const before = await request(app).get(`/api/plans/${planId}/next-task`);
  assert.equal(before.body.tasks.find(t => t.id === a.id).unblocked, true);
  assert.equal(before.body.tasks.find(t => t.id === b.id).unblocked, false);
  assert.deepEqual(before.body.progress, { completed: 0, total: 2 });
  assert.equal(before.body.allComplete, false);

  await request(app).patch(`/api/plans/${planId}/tasks/${a.id}`).send({ passes: true });

  const after = await request(app).get(`/api/plans/${planId}/next-task`);
  assert.equal(after.body.tasks.find(t => t.id === b.id).unblocked, true);
  assert.deepEqual(after.body.progress, { completed: 1, total: 2 });
});

test('task-update: passes:true flips status to done', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [{ title: 'A' }]
  });
  const planId = created.body.id;
  const taskId = created.body.tasks[0].id;
  const res = await request(app).patch(`/api/plans/${planId}/tasks/${taskId}`).send({ passes: true });
  assert.equal(res.body.passes, true);
  assert.equal(res.body.status, 'done');
});

test('task-update: progressNote appends timestamped entry', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [{ title: 'A' }]
  });
  const planId = created.body.id;
  const taskId = created.body.tasks[0].id;
  await request(app).patch(`/api/plans/${planId}/tasks/${taskId}`).send({ progressNote: 'first' });
  const second = await request(app).patch(`/api/plans/${planId}/tasks/${taskId}`).send({ progressNote: 'second' });
  assert.equal(second.body.progressNotes.length, 2);
  assert.equal(second.body.progressNotes[0].text, 'first');
  assert.equal(second.body.progressNotes[1].text, 'second');
  assert.ok(second.body.progressNotes[0].timestamp);
});

test('POST /api/plans/:id/tasks appends with new TASK ids and preserves blockedBy resolution', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [{ title: 'A' }]
  });
  const planId = created.body.id;
  const firstId = created.body.tasks[0].id;
  const added = await request(app).post(`/api/plans/${planId}/tasks`).send({
    tasks: [{ title: 'B', blockedBy: ['TASK-1'] }]
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.added.length, 1);
  assert.equal(added.body.total, 2);
  assert.deepEqual(added.body.added[0].blockedBy, [firstId]);
});

test('PATCH /api/plans/:id replaces all tasks when tasks array is sent', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [{ title: 'A' }, { title: 'B' }]
  });
  const planId = created.body.id;
  const replaced = await request(app).patch(`/api/plans/${planId}`).send({
    tasks: [{ title: 'Only one' }]
  });
  assert.equal(replaced.body.tasks.length, 1);
  assert.equal(replaced.body.tasks[0].title, 'Only one');
});

test('next-task on missing plan → 404', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).get('/api/plans/PLAN-999/next-task');
  assert.equal(res.status, 404);
});
