import { Router } from 'express';
import * as store from '../lib/store.js';

const router = Router();

// List SDDs
router.get('/', (req, res) => {
  let designs = store.get().designs;
  if (req.query.sprintId) designs = designs.filter(d => d.sprintId === req.query.sprintId);
  res.json(designs);
});

// Get single SDD
router.get('/:id', (req, res) => {
  const design = store.get().designs.find(d => d.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Not found' });
  res.json(design);
});

// Create SDD (links items, moves them to 'sdd' stage)
router.post('/', async (req, res) => {
  const { title, body, itemIds, sprintId } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const id = store.nextId('SDD');
  const now = new Date().toISOString();
  const design = {
    id, title,
    body: body || '',
    itemIds: itemIds || [],
    stage: 'sdd',
    sprintId: sprintId || null,
    comments: [],
    createdAt: now, updatedAt: now
  };
  const data = store.get();
  for (const itemId of design.itemIds) {
    const item = data.items.find(i => i.id === itemId);
    if (item && item.stage !== 'done') {
      item.stage = 'sdd';
      item.updatedAt = now;
      store.writeEntity('items', item.id, item);
    }
  }
  data.designs.push(design);
  store.writeEntity('designs', id, design);
  res.status(201).json(design);
});

// Update SDD
router.patch('/:id', async (req, res) => {
  const design = store.get().designs.find(d => d.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Not found' });
  const allowed = ['title', 'body', 'itemIds', 'stage', 'sprintId'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) design[key] = req.body[key];
  }
  design.updatedAt = new Date().toISOString();
  store.writeEntity('designs', design.id, design);
  res.json(design);
});

// Add comment to SDD
router.post('/:id/comments', async (req, res) => {
  const design = store.get().designs.find(d => d.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Not found' });
  const { author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const comment = {
    id: `c${Date.now()}`,
    author: author || 'user',
    text,
    createdAt: new Date().toISOString()
  };
  design.comments.push(comment);
  design.updatedAt = new Date().toISOString();
  store.writeEntity('designs', design.id, design);
  res.status(201).json(comment);
});

export default router;
