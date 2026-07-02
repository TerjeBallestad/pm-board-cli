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

test('blockedBy accepts liberal ordinal forms ("Task 1", "task_2", cardinal "1")', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [
      { title: 'A' },
      { title: 'B', blockedBy: ['Task 1'] },
      { title: 'C', blockedBy: ['task_2', '1'] }
    ]
  });
  assert.equal(res.status, 201);
  const [a, b, c] = res.body.tasks;
  assert.deepEqual(b.blockedBy, [a.id], '"Task 1" (space form) must resolve');
  assert.deepEqual(c.blockedBy, [b.id, a.id], '"task_2" and cardinal "1" must resolve');
});

test('unresolvable blockedBy ref is rejected with 400 (no silent stall)', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  const res = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [
      { title: 'A' },
      { title: 'B', blockedBy: ['Task 9'] }   // only 2 tasks — ordinal 9 cannot resolve
    ]
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unresolved blockedBy/);
  assert.ok(res.body.details.some(d => d.includes('Task 9')));
});

test('next-task unblocks dependents authored with the space form after the dep passes', async (t) => {
  const { app, cleanup } = await setupTestApp();
  t.after(cleanup);
  // This is the exact PLAN-077 regression: dependents written as "Task 1" must
  // flip to unblocked once the real first task passes.
  const created = await request(app).post('/api/plans').send({
    title: 'p',
    tasks: [
      { title: 'A' },
      { title: 'B', blockedBy: ['Task 1'] }
    ]
  });
  const planId = created.body.id;
  const [a, b] = created.body.tasks;

  const before = await request(app).get(`/api/plans/${planId}/next-task`);
  const bBefore = before.body.tasks.find(t => t.id === b.id);
  assert.equal(bBefore.unblocked, false, 'B blocked until A passes');

  await request(app).patch(`/api/plans/${planId}/tasks/${a.id}`).send({ passes: true });

  const after = await request(app).get(`/api/plans/${planId}/next-task`);
  const bAfter = after.body.tasks.find(t => t.id === b.id);
  assert.equal(bAfter.unblocked, true, 'B unblocks once A passes (regression: was stuck false)');
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
