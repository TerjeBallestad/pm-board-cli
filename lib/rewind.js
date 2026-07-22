// Rewind detection: remember the newest timestamp ever observed in a data dir,
// in a state file OUTSIDE the repo (a git reset that rewinds the data would
// rewind an in-repo marker with it). If a later load sees only older
// timestamps, the data dir was likely rewound — git reset, branch switch, or
// an external delete — and the caller warns loudly instead of serving the old
// state as if nothing happened (issue #1: a reset went unnoticed for 7 hours).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

function stateFilePath(dataDir) {
  const dir = process.env.PM_STATE_DIR || join(homedir(), '.pm-board-cli', 'state');
  const hash = createHash('sha1').update(dataDir).digest('hex').slice(0, 16);
  return { dir, file: join(dir, `${hash}.json`) };
}

export function readSeenStamp(dataDir) {
  const { file } = stateFilePath(dataDir);
  try {
    return JSON.parse(readFileSync(file, 'utf-8')).maxStamp || null;
  } catch { return null; }
}

// Record the newest observed timestamp. `force` overwrites even with an older
// value — used after a legitimate delete/archive so removing the newest record
// doesn't read as a rewind on the next load.
export function recordSeenStamp(dataDir, maxStamp, { force = false } = {}) {
  const { dir, file } = stateFilePath(dataDir);
  if (!force) {
    if (!maxStamp) return;
    const seen = readSeenStamp(dataDir);
    if (seen && seen >= maxStamp) return;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ dataDir, maxStamp: maxStamp || null }));
  } catch { /* state file is best-effort — never break a load/write over it */ }
}
