import express from 'express';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig, getConfig, getConfigDir, resolveDataDir } from './lib/config.js';
import * as store from './lib/store.js';
import itemsRouter from './api/items.js';
import designsRouter from './api/designs.js';
import plansRouter from './api/plans.js';
import sprintsRouter from './api/sprints.js';
import contextRouter from './api/context.js';
import milestonesRouter from './api/milestones.js';
import eventsRouter from './api/events.js';
import testsRouter from './api/tests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load config before anything else
const config = loadConfig();
const PORT = process.env.PORT || config.port || 3333;

const app = express();
app.use(express.json());

// --- Frontend resolution ---
// Priority: config.frontend.dir → built-in dashboard
function resolveFrontendDir() {
  if (config.frontend?.dir) {
    const custom = join(getConfigDir(), config.frontend.dir);
    if (existsSync(custom)) return custom;
  }
  // Built-in dashboard
  const builtin = join(__dirname, 'dashboard');
  if (existsSync(builtin)) return builtin;
  return null;
}

const frontendDir = resolveFrontendDir();
if (frontendDir) {
  app.use(express.static(frontendDir));
}

// Attachments directory (inside data dir)
const ATTACHMENTS_DIR = join(resolveDataDir(), '..', 'attachments');
await mkdir(ATTACHMENTS_DIR, { recursive: true });
app.use('/attachments', express.static(ATTACHMENTS_DIR));

// --- API routes ---
app.use('/api/items', itemsRouter);
app.use('/api/designs', designsRouter);
app.use('/api/plans', plansRouter);
app.use('/api/sprints', sprintsRouter);
app.use('/api/context', contextRouter);
app.use('/api/milestones', milestonesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tests', testsRouter);

// Upload attachment
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
app.post('/api/attachments', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const origName = req.query.name || 'upload.png';
  const ext = extname(origName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: `Unsupported file type: ${ext}` });
  const slug = randomBytes(6).toString('hex');
  const filename = `${slug}${ext}`;
  await writeFile(join(ATTACHMENTS_DIR, filename), req.body);
  res.status(201).json({ filename, url: `/attachments/${filename}` });
});

// List attachments
app.get('/api/attachments', async (_req, res) => {
  const files = await readdir(ATTACHMENTS_DIR).catch(() => []);
  res.json(files.filter(f => ALLOWED_EXT.has(extname(f).toLowerCase())));
});

// Config endpoint (frontend reads project name, entity types, stages)
app.get('/api/config', (req, res) => {
  res.json({
    name: config.name,
    stages: config.stages,
    entityTypes: config.entityTypes
  });
});

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  version: '0.1.0',
  project: config.name
}));

// SPA fallback
if (frontendDir) {
  const spaIndex = join(frontendDir, 'index.html');
  app.get('/{*path}', (req, res) => {
    res.sendFile('index.html', { root: frontendDir });
  });
}

await store.load();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`${config.name} PM Dashboard → http://localhost:${PORT}`);
});
