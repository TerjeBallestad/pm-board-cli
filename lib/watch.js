import { watch, readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from './config.js';
import { emit } from '../api/events.js';

const COLLECTIONS = ['items', 'designs', 'plans', 'sprints', 'milestones'];
const DEBOUNCE_MS = 150;

// Data files by name → mtime. `.tmp` files from atomicWrite never match.
function scan(dir) {
  const snapshot = new Map();
  for (const f of readdirSync(dir)) {
    if (!/\.(md|json)$/.test(f)) continue;
    try {
      snapshot.set(f, statSync(join(dir, f)).mtimeMs);
    } catch {
      // deleted between readdir and stat — treat as absent
    }
  }
  return snapshot;
}

// Watch the data dir and push SSE events for writes the server process didn't
// make itself — CLI (serverless dispatch), agents editing files, git
// checkout/reset. Server-side API writes emit() directly from the store, so the
// watcher fires a duplicate shortly after; the dashboard's handling is
// idempotent (fetch entity + upsert + debounced rerender), so that's harmless.
//
// fs.watch is lossy on macOS (null filenames, dropped per-file events), so an
// event is only a *hint*: it schedules a debounced rescan of the directory,
// which diffs names+mtimes against the last snapshot and emits per real change.
// A slow poll sweep backstops fs.watch dropping an event entirely.
export function watchDataDir(dataDir = resolveDataDir(), { onEvent = emit, pollMs = 2000 } = {}) {
  const cleanups = [];

  const watchDir = (dir, toEvent) => {
    mkdirSync(dir, { recursive: true });
    let snapshot = scan(dir);
    let timer = null;

    const rescan = () => {
      timer = null;
      let next;
      try {
        next = scan(dir);
      } catch {
        return; // dir vanished; keep old snapshot and retry on next poll
      }
      for (const [f, mtime] of next) {
        if (snapshot.get(f) !== mtime) {
          const event = toEvent(f, true);
          if (event) onEvent(...event);
        }
      }
      for (const f of snapshot.keys()) {
        if (!next.has(f)) {
          const event = toEvent(f, false);
          if (event) onEvent(...event);
        }
      }
      snapshot = next;
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(rescan, DEBOUNCE_MS);
    };

    let watcher = null;
    try {
      watcher = watch(dir, schedule);
      watcher.unref?.();
    } catch {
      // no native watching available — the poll sweep still covers this dir
    }
    const poll = setInterval(() => { if (timer === null) rescan(); }, pollMs);
    poll.unref();
    cleanups.push(() => {
      watcher?.close();
      clearTimeout(timer);
      clearInterval(poll);
    });
  };

  for (const col of COLLECTIONS) {
    const entityType = col.replace(/s$/, '');
    watchDir(join(dataDir, col), (filename, exists) => {
      const id = filename.replace(/\.(md|json)$/, '');
      return [entityType, id, exists ? 'update' : 'delete'];
    });
  }

  // A file *appearing* in archive/ means the entity was archived; emit so the
  // dashboard drops it and invalidates its archive cache. A file leaving
  // archive/ (restore) is deliberately ignored — the recreated file in its
  // collection dir fires its own 'update', and emitting 'archive' here could
  // race that update and remove the just-restored card from client state.
  watchDir(join(dataDir, 'archive'), (filename, exists) => {
    if (!exists) return null;
    const id = filename.replace(/\.md$/, '');
    return [id.startsWith('SDD') ? 'design' : 'item', id, 'archive'];
  });

  return () => {
    for (const fn of cleanups) fn();
  };
}
