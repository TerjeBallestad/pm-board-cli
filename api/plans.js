import { Router } from 'express';
import * as store from '../lib/store.js';

const router = Router();

// Resolve a single blockedBy ref to a real TASK-NNN id.
// Accepts a real task id, or any ordinal/cardinal form meaning "the Nth task in
// this plan" (1-indexed): "TASK-1", "Task 1", "task_1", "#1", "1". Returns the
// ref unchanged if it resolves to nothing — unresolvedBlockedBy() flags that.
function resolveRef(ref, tasks, byId) {
  if (byId.has(ref)) return ref;
  const m = String(ref).match(/^\s*(?:task[\s\-_]*)?#?(\d+)\s*$/i);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx >= 0 && idx < tasks.length) return tasks[idx].id;
  }
  return ref;
}

// Rewrite every task's blockedBy from ordinal/cardinal refs to real task ids.
function resolveBlockedBy(tasks) {
  const byId = new Set(tasks.map(t => t.id));
  for (const task of tasks) {
    task.blockedBy = (task.blockedBy || []).map(ref => resolveRef(ref, tasks, byId));
  }
}

// Return human-readable errors for any blockedBy ref that did not resolve to a
// real task id in this plan. Empty array = all refs valid. Run AFTER
// resolveBlockedBy so the only survivors are genuinely unresolvable refs.
function unresolvedBlockedBy(tasks) {
  const byId = new Set(tasks.map(t => t.id));
  const errors = [];
  for (const task of tasks) {
    for (const dep of (task.blockedBy || [])) {
      if (!byId.has(dep)) errors.push(`${task.id} blockedBy "${dep}" matches no task id or ordinal`);
    }
  }
  return errors;
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
  if (store.idExists(id)) return res.status(409).json({ error: `id ${id} already exists — refusing to overwrite` });
  const now = new Date().toISOString();
  const plan = {
    id, title,
    sddId: sddId || null,
    stage: 'planned',
    sprintId: sprintId || null,
    context: ctx || { setupNotes: '', relevantFiles: [], designDecisions: '' },
    tasks: (() => {
      const ids = [];
      return (tasks || []).map(t => {
        const taskId = store.nextId('TASK', ids);
        ids.push(taskId);
        return {
          id: taskId,
          title: t.title || '',
          description: t.description || '',
          steps: t.steps || [],
          verification: t.verification || '',
          blockedBy: t.blockedBy || [],
          passes: false,
          status: 'pending',
          progressNotes: []
        };
      });
    })(),
    comments: [],
    createdAt: now, updatedAt: now
  };
  resolveBlockedBy(plan.tasks);
  const createErrors = unresolvedBlockedBy(plan.tasks);
  if (createErrors.length) return res.status(400).json({ error: 'unresolved blockedBy refs', details: createErrors });
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
    const ids = [];
    const newTasks = req.body.tasks.map(t => {
      const taskId = t.id || store.nextId('TASK', ids);
      ids.push(taskId);
      return {
        id: taskId,
        title: t.title || '',
        description: t.description || '',
        steps: t.steps || [],
        verification: t.verification || '',
        blockedBy: t.blockedBy || [],
        passes: t.passes || false,
        status: t.status || 'pending',
        progressNotes: t.progressNotes || []
      };
    });
    resolveBlockedBy(newTasks);
    const patchErrors = unresolvedBlockedBy(newTasks);
    if (patchErrors.length) return res.status(400).json({ error: 'unresolved blockedBy refs', details: patchErrors });
    plan.tasks = newTasks;
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
  const ids = [];
  const newTasks = tasks.map(t => {
    const taskId = store.nextId('TASK', ids);
    ids.push(taskId);
    return {
      id: taskId,
      title: t.title || '',
      description: t.description || '',
      steps: t.steps || [],
      verification: t.verification || '',
      blockedBy: t.blockedBy || [],
      passes: false,
      status: 'pending',
      progressNotes: []
    };
  });
  const merged = [...plan.tasks, ...newTasks];
  resolveBlockedBy(merged);
  const addErrors = unresolvedBlockedBy(merged);
  if (addErrors.length) return res.status(400).json({ error: 'unresolved blockedBy refs', details: addErrors });
  plan.tasks = merged;
  plan.updatedAt = new Date().toISOString();
  store.writeEntity('plans', plan.id, plan);
  res.status(201).json({ added: newTasks, total: plan.tasks.length });
};

// Get next available task (unblocked, pending)
export const nextTask = (req, res) => {
  const data = store.get();
  const plan = data.plans.find(p => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: 'Not found' });

  const byId = new Set(plan.tasks.map(t => t.id));
  const passedIds = new Set(plan.tasks.filter(t => t.passes).map(t => t.id));

  const tasks = plan.tasks.map(t => ({
    ...t,
    unblocked: (t.blockedBy || []).every(depId => passedIds.has(resolveRef(depId, plan.tasks, byId)))
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
