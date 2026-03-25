import { Router } from 'express';
import * as store from '../lib/store.js';

const router = Router();

router.get('/', (req, res) => res.json(store.get().milestones));

router.get('/:id', (req, res) => {
  const ms = store.get().milestones.find(m => m.id === req.params.id);
  if (!ms) return res.status(404).json({ error: 'Not found' });
  res.json(ms);
});

router.patch('/:id', (req, res) => {
  const data = store.get();
  const ms = data.milestones.find(m => m.id === req.params.id);
  if (!ms) return res.status(404).json({ error: 'Not found' });
  for (const key of ['title', 'status', 'phases']) {
    if (req.body[key] !== undefined) ms[key] = req.body[key];
  }
  store.writeEntity('milestones', ms.id, ms);
  res.json(ms);
});

export default router;
