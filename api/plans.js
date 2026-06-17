import { Router } from 'express';
import * as store from '../lib/store.js';

const router = Router();

// Resolve ordinal blockedBy refs (e.g. "TASK-1" meaning task index 0) to real TASK-NNN IDs
function resolveBlockedBy(tasks) {
  const ordinalMap = {};
  tasks.forEach((t, i) => { ordinalMap[`TASK-${i + 1}`] = t.id; });
  for (const task of tasks) {
    task.blockedBy = (task.blockedBy || []).map(ref => ordinalMap[ref] || ref);
  }
}

// Build normalized plan tasks, allocating a fresh TASK id for any task that
// needs one (ids batched so siblings don't collide before they hit disk).
// `preserve` keeps caller-supplied id/passes/status/progressNotes — used by the
// full-replacement PATCH; otherwise every task starts fresh and pending.
function buildTasks(tasks, { preserve = false } = {}) {
  const ids = [];
  return (tasks || []).map(t => {
    const id = (preserve && t.id) || store.nextId('TASK', ids);
    ids.push(id);
    return {
      id,
      title: t.title || '',
      description: t.description || '',
      steps: t.steps || [],
      verification: t.verification || '',
      blockedBy: t.blockedBy || [],
      passes: preserve ? (t.passes || false) : false,
      status: preserve ? (t.status || 'pending') : 'pending',
      progressNotes: preserve ? (t.progressNotes || []) : []
    };
  });
}

export const listPlans = (req, res) => {
  let plans = store.get().plans;
  if (req.query.sprintId) plans = plans.filter(p => p.sprintId === req.query.sprintId);
  res.json(plans);
};

export const getPlan = (req, res) => {
  const plan = store.get().plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  res.json(plan);
};

export const createPlan = (req, res) => {
  const { title, sddId, sprintId, context: ctx, tasks } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const id = store.nextId('PLAN');
  const now = new Date().toISOString();
  const plan = {
    id, title,
    sddId: sddId || null,
    stage: 'planned',
    sprintId: sprintId || null,
    context: ctx || { setupNotes: '', relevantFiles: [], designDecisions: '' },
    tasks: buildTasks(tasks),
    comments: [],
    createdAt: now, updatedAt: now
  };
  resolveBlockedBy(plan.tasks);
  store.get().plans.push(plan);
  store.writeEntity('plans', id, plan);
  res.status(201).json(plan);
};

export const patchPlan = (req, res) => {
  const plan = store.get().plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const allowed = ['title', 'sddId', 'stage', 'sprintId', 'context'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) plan[key] = req.body[key];
  }
  if (Array.isArray(req.body.tasks)) {
    plan.tasks = buildTasks(req.body.tasks, { preserve: true });
    resolveBlockedBy(plan.tasks);
  }
  plan.updatedAt = new Date().toISOString();
  store.writeEntity('plans', plan.id, plan);
  res.json(plan);
};

export const addPlanTasks = (req, res) => {
  const plan = store.get().plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const { tasks } = req.body;
  if (!Array.isArray(tasks) || tasks.length === 0) return res.status(400).json({ error: 'tasks array required' });
  const newTasks = buildTasks(tasks);
  plan.tasks.push(...newTasks);
  resolveBlockedBy(plan.tasks);
  plan.updatedAt = new Date().toISOString();
  store.writeEntity('plans', plan.id, plan);
  res.status(201).json({ added: newTasks, total: plan.tasks.length });
};

// Get next available task (unblocked, pending)
export const nextTask = (req, res) => {
  const data = store.get();
  const plan = data.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const ordinalMap = {};
  plan.tasks.forEach((t, i) => { ordinalMap[`TASK-${i + 1}`] = t.id; });

  const passedIds = new Set(plan.tasks.filter(t => t.passes).map(t => t.id));

  const tasks = plan.tasks.map(t => ({
    ...t,
    unblocked: (t.blockedBy || []).every(depId => passedIds.has(ordinalMap[depId] || depId))
  }));

  const allDone = plan.tasks.every(t => t.passes);

  const designDecisions = plan.context?.designDecisions || '';

  const sdd = data.designs.find(d => d.id === plan.sddId);
  const references = {
    plan: `/api/plans/${plan.id}`,
    ...(sdd ? { sdd: `/api/designs/${sdd.id}` } : {}),
    ...(plan.sprintId ? { sprint: `/api/sprints/${plan.sprintId}/explore` } : {})
  };

  res.json({
    planTitle: plan.title,
    tasks,
    designDecisions,
    relevantFiles: plan.context?.relevantFiles || [],
    references,
    progress: { completed: passedIds.size, total: plan.tasks.length },
    allComplete: allDone
  });
};

// Get plan init context
export const planContext = (req, res) => {
  const data = store.get();
  const plan = data.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const sdd = data.designs.find(d => d.id === plan.sddId);
  const totalTasks = plan.tasks.length;
  const completedTasks = plan.tasks.filter(t => t.passes).length;
  res.json({
    planId: plan.id,
    title: plan.title,
    context: plan.context,
    sdd: sdd ? { id: sdd.id, title: sdd.title, body: sdd.body } : null,
    progress: { completed: completedTasks, total: totalTasks },
    tasks: plan.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, passes: t.passes }))
  });
};

// Update task (status, passes, progress note)
export const patchTask = (req, res) => {
  const plan = store.get().plans.find(p => p.id === req.params.planId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const task = plan.tasks.find(t => t.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.body.description !== undefined) task.description = req.body.description;
  if (req.body.steps !== undefined) task.steps = req.body.steps;
  if (req.body.verification !== undefined) task.verification = req.body.verification;
  if (req.body.status) task.status = req.body.status;
  if (req.body.passes !== undefined) task.passes = req.body.passes;
  if (req.body.progressNote) {
    task.progressNotes.push({
      text: req.body.progressNote,
      timestamp: new Date().toISOString()
    });
  }
  if (task.passes && task.status !== 'done') task.status = 'done';
  plan.updatedAt = new Date().toISOString();
  store.writeEntity('plans', plan.id, plan);
  res.json(task);
};

export const addPlanComment = (req, res) => {
  const plan = store.get().plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });
  const { author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const comment = {
    id: `c${Date.now()}`,
    author: author || 'user',
    text,
    createdAt: new Date().toISOString()
  };
  plan.comments.push(comment);
  plan.updatedAt = new Date().toISOString();
  store.writeEntity('plans', plan.id, plan);
  res.status(201).json(comment);
};

router.get('/', listPlans);
router.get('/:id', getPlan);
router.post('/', createPlan);
router.patch('/:id', patchPlan);
router.post('/:id/tasks', addPlanTasks);
router.get('/:id/next-task', nextTask);
router.get('/:id/context', planContext);
router.patch('/:planId/tasks/:taskId', patchTask);
router.post('/:id/comments', addPlanComment);

export default router;
