import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as store from '../lib/store.js';
import { resolveDataDir } from '../lib/config.js';

const router = Router();

function readSidecarTests(id) {
  const sidecarPath = join(resolveDataDir(), 'designs', `${id}.tests.json`);
  if (!existsSync(sidecarPath)) return null;
  try {
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    return sidecar.tests || [];
  } catch (err) {
    console.error(`[designs] sidecar read failed for ${id}:`, err.message);
    return null;
  }
}

// List SDDs
router.get('/', (req, res) => {
  let designs = store.get().designs;
  if (req.query.sprintId) designs = designs.filter(d => d.sprintId === req.query.sprintId);
  res.json(designs.map(d => {
    const tests = readSidecarTests(d.id);
    return tests ? { ...d, tests } : d;
  }));
});

// Get single SDD
router.get('/:id', (req, res) => {
  const design = store.get().designs.find(d => d.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Not found' });
  const tests = readSidecarTests(design.id);
  if (tests) return res.json({ ...design, tests });
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

// Coerce string-or-array → array for fields that MUST be arrays.
// Prevents frontend crashes when a caller passes "SB-225" instead of ["SB-225"].
function coerceArrayField(body, key) {
  if (body[key] === undefined) return;
  if (body[key] === '' || body[key] === null) { body[key] = []; return; }
  if (typeof body[key] === 'string') {
    body[key] = body[key].split(',').map(s => s.trim()).filter(Boolean);
  }
}

// Update SDD
router.patch('/:id', async (req, res) => {
  const design = store.get().designs.find(d => d.id === req.params.id);
  if (!design) return res.status(404).json({ error: 'Not found' });
  coerceArrayField(req.body, 'itemIds');
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
