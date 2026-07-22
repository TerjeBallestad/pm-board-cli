import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';
import * as store from '../lib/store.js';
import { createApp } from '../lib/app.js';
import { resetAutoCommit } from '../lib/autocommit.js';

// Spin up an Express app pointed at a fresh tmpdir per test.
// Returns { app, dir, cleanup }. Always pair with `t.after(cleanup)`.
export async function setupTestApp(configOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-test-'));
  const config = {
    name: 'Test Project',
    port: 0,
    dataDir: 'data',
    ...configOverrides
  };
  writeFileSync(join(dir, 'pm.config.json'), JSON.stringify(config));
  // Keep rewind-detection state inside the tmpdir, not the real ~/.pm-board-cli.
  process.env.PM_STATE_DIR = join(dir, '.pm-state');
  store.reset();
  resetAutoCommit();
  loadConfig(dir);
  const app = await createApp({ frontend: false, attachments: false });
  return {
    app,
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      store.reset();
      resetAutoCommit();
    }
  };
}
