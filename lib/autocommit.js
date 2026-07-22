// Opt-in git auto-commit of the data dir (config: "autoCommit": true).
// Every store mutation marks the repo dirty; a short debounce batches bursts
// (plan writes touch many files) and a process exit hook flushes whatever the
// timer hasn't, so the short-lived serverless CLI still commits before exiting.
// Commits are pathspec-scoped to the data dir, so a data dir living inside a
// larger repo (the pre-nested-repo layout) never sweeps up unrelated staged
// files. Loss window after a crash/reset: seconds, and recoverable via git.
import { execFileSync } from 'node:child_process';
import { getConfig, resolveDataDir } from './config.js';

const DEBOUNCE_MS = 2000;

let timer = null;
let dirty = false;
let exitHookInstalled = false;
const repoCache = new Map(); // dataDir -> boolean (inside a git work tree?)

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function isGitWorkTree(dir) {
  if (!repoCache.has(dir)) {
    let inside = false;
    try {
      inside = git(dir, ['rev-parse', '--is-inside-work-tree']).toString().trim() === 'true';
    } catch { /* not a repo, or git missing — auto-commit silently off */ }
    repoCache.set(dir, inside);
  }
  return repoCache.get(dir);
}

export function commitNow() {
  if (!dirty) return;
  dirty = false;
  if (timer) { clearTimeout(timer); timer = null; }
  const dir = resolveDataDir();
  try {
    git(dir, ['add', '-A', '.']);
    // Pathspec-scoped commit: only the data dir subtree, regardless of what
    // else the surrounding repo has staged.
    git(dir, ['commit', '-q', '-m', '[pm] auto-commit data', '--', '.']);
  } catch { /* nothing to commit, or git error — never break the write path */ }
}

export function markDirty() {
  let config;
  try { config = getConfig(); } catch { return; }
  if (!config.autoCommit) return;
  if (!isGitWorkTree(resolveDataDir())) return;
  dirty = true;
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', commitNow);
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(commitNow, DEBOUNCE_MS);
  timer.unref();
}

// Test seam: drop cached repo detection so a new tmpdir gets re-probed.
export function resetAutoCommit() {
  if (timer) { clearTimeout(timer); timer = null; }
  dirty = false;
  repoCache.clear();
}
