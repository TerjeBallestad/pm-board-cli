import { loadConfig } from './lib/config.js';
import * as store from './lib/store.js';
import { createApp } from './lib/app.js';
import { commitNow } from './lib/autocommit.js';

const config = loadConfig();
const PORT = process.env.PORT || config.port || 3333;

const app = await createApp();
await store.load();
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
