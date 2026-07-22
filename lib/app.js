import express from 'express';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getConfig, getConfigDir, resolveDataDir } from './config.js';
import { VERSION } from './version.js';
import * as store from './store.js';
import itemsRouter from '../api/items.js';
import designsRouter from '../api/designs.js';
import plansRouter from '../api/plans.js';
import sprintsRouter from '../api/sprints.js';
import contextRouter from '../api/context.js';
import milestonesRouter from '../api/milestones.js';
import eventsRouter from '../api/events.js';
import testsRouter from '../api/tests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED_ATTACHMENT_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

// Build an Express app for the loaded config. `loadConfig()` must have run
// before this is called. Tests pass `{ frontend: false, attachments: false }`
// to skip filesystem side effects unrelated to API surface.
export async function createApp({ frontend = true, attachments = true } = {}) {
  const config = getConfig();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Disk is the single source of truth. Re-read it at the start of every API
  // request so the long-running dashboard never serves stale data after the CLI,
  // a text editor (conflict resolution), or `git pull` changes the files. Node's
  // single thread + synchronous handlers mean the load completes before the
  // handler runs, so there is no interleave hazard.
  app.use('/api', (req, res, next) => { store.load(); next(); });

  let frontendDir = null;
  if (frontend) {
    if (config.frontend?.dir) {
      const custom = join(getConfigDir(), config.frontend.dir);
      if (existsSync(custom)) frontendDir = custom;
    }
    if (!frontendDir) {
      const builtin = join(__dirname, '..', 'dashboard');
      if (existsSync(builtin)) frontendDir = builtin;
    }
    if (frontendDir) app.use(express.static(frontendDir));
  }

  let attachmentsDir = null;
  if (attachments) {
    attachmentsDir = join(resolveDataDir(), '..', 'attachments');
    await mkdir(attachmentsDir, { recursive: true });
    app.use('/attachments', express.static(attachmentsDir));
  }

  app.use('/api/items', itemsRouter);
  app.use('/api/designs', designsRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/sprints', sprintsRouter);
  app.use('/api/context', contextRouter);
  app.use('/api/milestones', milestonesRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/tests', testsRouter);

  if (attachmentsDir) {
    app.post('/api/attachments', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
      const origName = req.query.name || 'upload.png';
      const ext = extname(origName).toLowerCase();
      if (!ALLOWED_ATTACHMENT_EXT.has(ext)) return res.status(400).json({ error: `Unsupported file type: ${ext}` });
      const slug = randomBytes(6).toString('hex');
      const filename = `${slug}${ext}`;
      await writeFile(join(attachmentsDir, filename), req.body);
      res.status(201).json({ filename, url: `/attachments/${filename}` });
    });

    app.get('/api/attachments', async (_req, res) => {
      const files = await readdir(attachmentsDir).catch(() => []);
      res.json(files.filter(f => ALLOWED_ATTACHMENT_EXT.has(extname(f).toLowerCase())));
    });
  }

  app.get('/api/config', (req, res) => {
    res.json({
      name: config.name,
      stages: config.stages,
      entityTypes: config.entityTypes,
      // Copy-to-start command templates ({id}/{title} placeholders) — the
      // project's own vocabulary, so the dashboard stays skill-agnostic.
      commands: config.commands || {}
    });
  });

  app.get('/api/health', (req, res) => res.json({
    status: 'ok',
    version: VERSION,
    project: config.name
  }));

  if (frontendDir) {
    app.get('/{*path}', (req, res) => {
      res.sendFile('index.html', { root: frontendDir });
    });
  }

  return app;
}
