// Opt-in git auto-sync of the data dir (config: "autoSync": true, requires
// autoCommit + a data-dir repo with an upstream remote). Local-first stays
// intact: every read/write hits local files; sync is a background concern.
// Pull happens at server start and on a periodic timer (never per CLI call —
// that would put network latency back on the write path). Push happens
// fire-and-forget after each auto-commit, so the divergence window between
// machines is seconds instead of days. A pull that hits a real conflict
// aborts the rebase, leaves the repo exactly as it was, and warns loudly —
// resolution is a human's call, never automated.
import { execFileSync, spawn } from 'node:child_process';
import { getConfig, resolveDataDir } from './config.js';

const remoteCache = new Map(); // dataDir -> boolean (has an upstream remote?)

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function hasRemote(dir) {
  if (!remoteCache.has(dir)) {
    let remote = false;
    try {
      remote = git(dir, ['remote']).toString().trim().length > 0;
    } catch { /* not a repo, or git missing — auto-sync silently off */ }
    remoteCache.set(dir, remote);
  }
  return remoteCache.get(dir);
}

export function autoSyncEnabled() {
  let config;
  try { config = getConfig(); } catch { return false; }
  if (!config.autoSync || !config.autoCommit) return false;
  return hasRemote(resolveDataDir());
}

// Rebase local commits onto the remote. --autostash covers a mid-debounce
// dirty tree; a conflict aborts back to the pre-pull state and returns the
// error so callers can warn. Never throws.
export function pullNow(dir = resolveDataDir()) {
  try {
    git(dir, ['pull', '--rebase', '--autostash', '--quiet']);
    return { ok: true };
  } catch (err) {
    try { git(dir, ['rebase', '--abort']); } catch { /* no rebase in progress */ }
    const detail = (err.stderr || err.message || '').toString().trim();
    console.error(`[pm autosync] pull failed — data dir left as-is, resolve manually:\n${detail}`);
    return { ok: false, error: detail };
  }
}

// Synchronous push for the server's periodic sync (failures reported).
export function pushNow(dir = resolveDataDir()) {
  try {
    git(dir, ['push', '--quiet']);
    return { ok: true };
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    console.error(`[pm autosync] push failed (will retry on next sync):\n${detail}`);
    return { ok: false, error: detail };
  }
}

// Fire-and-forget push for the auto-commit path: detached so the serverless
// CLI's exit hook never waits on the network, and the push survives the
// parent exiting. Failures are invisible here by design — the server's
// periodic syncNow() is the retry that also reports.
export function pushDetached(dir = resolveDataDir()) {
  try {
    spawn('git', ['-C', dir, 'push', '--quiet'], {
      detached: true,
      stdio: 'ignore'
    }).unref();
  } catch { /* git missing — nothing to do */ }
}

// The server's periodic heartbeat: pull remote work in, push anything a
// detached push missed (offline window, rejected push). Pull-before-push
// resolves the rejected-push case in one pass.
export function syncNow(dir = resolveDataDir()) {
  const pulled = pullNow(dir);
  if (!pulled.ok) return pulled;
  try {
    const ahead = git(dir, ['rev-list', '--count', '@{u}..HEAD']).toString().trim();
    if (ahead === '0') return { ok: true };
  } catch {
    return { ok: true }; // no upstream tracking — nothing to push
  }
  return pushNow(dir);
}

// Test seam: drop cached remote detection so a new tmpdir gets re-probed.
export function resetAutoSync() {
  remoteCache.clear();
}
