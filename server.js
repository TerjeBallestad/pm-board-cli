import { loadConfig } from './lib/config.js';
import * as store from './lib/store.js';
import { createApp } from './lib/app.js';
import { commitNow } from './lib/autocommit.js';
import { autoSyncEnabled, pullNow, syncNow } from './lib/autosync.js';
import { watchDataDir } from './lib/watch.js';

const config = loadConfig();
const PORT = process.env.PORT || config.port || 3333;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Pull BEFORE the store loads, so a machine switch starts from the other
// machine's latest state instead of serving stale local data. A failed pull
// warns and serves local state — local-first, never blocked on the network.
if (autoSyncEnabled()) pullNow();

const app = await createApp();
await store.load();
// Push SSE events for data-dir writes made outside this process (CLI, agents,
// git) so the dashboard live-updates without any write path having to know
// whether a server is running.
watchDataDir();
// Periodic heartbeat: pull the other machine's pushes in (the watcher
// broadcasts resulting file changes to the dashboard), retry any push a
// detached fire-and-forget attempt missed.
if (autoSyncEnabled()) setInterval(syncNow, SYNC_INTERVAL_MS).unref();
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`${config.name} PM Dashboard → http://localhost:${PORT}`);
});

// Drain on SIGTERM/SIGINT (`pm stop`, `pm update`): finish in-flight requests,
// flush any pending auto-commit, then exit. SSE connections never close on
// their own, so a short force-exit timer backstops server.close().
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  commitNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
