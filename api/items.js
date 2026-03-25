import { Router } from 'express';
import * as store from '../lib/store.js';
import { getConfig, getTypePrefix } from '../lib/config.js';

const router = Router();

// List archived items (optional filters: type)
router.get('/archived', (req, res) => {
  let items = store.getArchive().items;
  if (req.query.type) items = items.filter(i => i.type === req.query.type);
  res.json(items);
});

// Sweep done items older than N days into archive
router.post('/archive/sweep', async (req, res) => {
  const days = req.body?.days ?? 1;
  const moved = store.sweepDoneItems(days);
  res.json({ archived: moved.length, ids: moved });
});

// Archive specific items by ID
router.post('/archive', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const moved = store.archiveItems(ids);
  res.json({ archived: moved.length, ids: moved });
});

// List items (optional filters: type, stage, priority, sprintId)
router.get('/', (req, res) => {
  let items = store.get().items;
  if (req.query.type) items = items.filter(i => i.type === req.query.type);
  if (req.query.stage) items = items.filter(i => i.stage === req.query.stage);
  if (req.query.priority) items = items.filter(i => i.priority === req.query.priority);
  if (req.query.sprintId) items = items.filter(i => i.sprintId === req.query.sprintId);
  res.json(items);
});

// Get single item
router.get('/:id', (req, res) => {
  const item = store.get().items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

// Create item
router.post('/', async (req, res) => {
  const { type, title, priority, body, pillar, related, affectedFiles, stage } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const config = getConfig();
  const stages = config.stages;
  const typePrefix = getTypePrefix();
  const prefix = typePrefix[type] || Object.keys(config.entityTypes)[0] || 'SB';
  const id = store.nextId(prefix);
  const now = new Date().toISOString();
  const item = {
    id, type: type || 'issue', title,
    stage: stages.includes(stage) ? stage : stages[0],
    priority: priority || null,
    pillar: pillar || '',
    body: body || '',
    related: related || [],
    affectedFiles: affectedFiles || [],
    sprintId: req.body.sprintId || null,
    comments: [],
    createdAt: now, updatedAt: now
  };
  store.get().items.push(item);
  store.writeEntity('items', id, item);
  res.status(201).json(item);
});

// Update item
router.patch('/:id', async (req, res) => {
  const data = store.get();
  const item = data.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const config = getConfig();
  const stages = config.stages;
  const allowed = ['title', 'priority', 'pillar', 'stage', 'body', 'related', 'affectedFiles', 'sprintId'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) item[key] = req.body[key];
  }
  if (req.body.stage && !stages.includes(req.body.stage)) {
    return res.status(400).json({ error: `Invalid stage. Must be one of: ${stages.join(', ')}` });
  }
  if (req.body.stage === 'done' && !item.doneAt) {
    item.doneAt = new Date().toISOString();
  }
  item.updatedAt = new Date().toISOString();
  store.writeEntity('items', item.id, item);
  res.json(item);
});

// Delete item
router.delete('/:id', async (req, res) => {
  const data = store.get();
  const idx = data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.items.splice(idx, 1);
  store.deleteEntity('items', req.params.id);
  res.status(204).end();
});

// Add comment to item
router.post('/:id/comments', async (req, res) => {
  const item = store.get().items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const comment = {
    id: `c${Date.now()}`,
    author: author || 'user',
    text,
    createdAt: new Date().toISOString()
  };
  item.comments.push(comment);
  item.updatedAt = new Date().toISOString();
  store.writeEntity('items', item.id, item);
  res.status(201).json(comment);
});

export default router;
