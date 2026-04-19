import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '../lib/config.js';

const router = express.Router();

router.get('/', (req, res) => {
  const reportsPath = join(getConfigDir(), 'reports', 'test-catalogue.json');
  if (!existsSync(reportsPath)) {
    return res.json({
      schema: 1,
      tests: [],
      counts: {},
      drift_counts: {},
      codebase_drift: { constants_out_of_sync: [] },
      missing: true
    });
  }
  try {
    const raw = readFileSync(reportsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: 'catalogue_parse_failed' });
  }
});

export default router;
