import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { parse, serialize } from './frontmatter.js';
import { resolveDataDir, getConfig, getDefaultCounters } from './config.js';
import { emit } from '../api/events.js';
import { markDirty } from './autocommit.js';
import { readSeenStamp, recordSeenStamp } from './rewind.js';

let DATA_DIR = null;
let META_FILE = null;

const COLLECTIONS = ['items', 'designs', 'plans', 'sprints', 'milestones'];
const MD_COLLECTIONS = new Set(['items', 'designs']);
const JSON_COLLECTIONS = new Set(['plans', 'sprints', 'milestones']);
const SUBDIRS = [...COLLECTIONS, 'archive'];

let data = null;
let archive = null;

// Files whose parse/validation failed during the last load(). They are skipped
// (not served) but their filename-derived id is still reserved, so a later
// create can never overwrite the very file the user is in the middle of fixing.
// Reset on every load(); warnings dedup across a process so the long-running
// dashboard logs each bad file once, not once per request.
let quarantined = [];
const warnedKeys = new Set();

// Set when load() finds only timestamps older than what a previous run saw on
// disk (see lib/rewind.js): { diskMax, seenMax }. Surfaced on /api/health.
let lastRewind = null;

// Whether meta.json was actually read from disk in the last load(). A missing
// meta.json gets a default stamped "now" — that must not count as a disk
// timestamp or it masks rewind detection.
let metaFromDisk = false;

function warnOnce(msg) {
  if (warnedKeys.has(msg)) return;
  warnedKeys.add(msg);
  process.stderr.write(`Warning: ${msg}\n`);
}

// Record a file that could not be parsed/validated: skip it from the served
// data, reserve its filename id so a create can't overwrite it, and warn once.
function quarantineFile(collectionName, filename, err) {
  const id = filename.replace(/\.(md|json)$/, '');
  quarantined.push({ collection: collectionName, file: filename, id, error: err.message });
  warnOnce(`${collectionName}/${filename} could not be read (${err.message}) — skipped; fix or remove the file. Its id ${id} stays reserved.`);
}

function initPaths() {
  if (!DATA_DIR) {
    DATA_DIR = resolveDataDir();
    META_FILE = join(DATA_DIR, 'meta.json');
  }
}

function ensureDirs() {
  initPaths();
  mkdirSync(DATA_DIR, { recursive: true });
  for (const sub of SUBDIRS) {
    mkdirSync(join(DATA_DIR, sub), { recursive: true });
  }
}

function entityToMd(entity) {
  const { body, ...meta } = entity;
  return serialize(meta, body || '');
}

function mdToEntity(content) {
  const { meta, body } = parse(content);
  if (body.trim()) {
    meta.body = body;
  }
  return meta;
}

function readCollection(collectionName) {
  initPaths();
  const dir = join(DATA_DIR, collectionName);
  if (!existsSync(dir)) return [];
  const isJson = JSON_COLLECTIONS.has(collectionName);
  const ext = isJson ? '.json' : '.md';
  const entities = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(ext))) {
    try {
      const raw = readFileSync(join(dir, f), 'utf-8');
      const entity = isJson ? JSON.parse(raw) : mdToEntity(raw);
      validateFilenameId(f, entity);
      entities.push(entity);
    } catch (err) {
      // A single malformed/mismatched file must not brick the whole CLI: skip
      // it, keep serving the rest, and reserve its id (see quarantineFile).
      quarantineFile(collectionName, f, err);
    }
  }
  return entities;
}

function validateFilenameId(filename, entity) {
  const expected = filename.replace(/\.(md|json)$/, '');
  const actual = entity?.id;
  if (!actual) {
    throw new Error(`filename id ${expected} has no frontmatter id`);
  }
  if (actual !== expected) {
    throw new Error(`filename id ${expected} does not match frontmatter id ${actual}`);
  }
}

function filenameForId(collection, id) {
  const ext = JSON_COLLECTIONS.has(collection) ? '.json' : '.md';
  return `${id}${ext}`;
}

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

// --- Public API ---

// Reset module-level state so a different config (e.g. test tmpdir) can
// be loaded without sticky DATA_DIR or stale data/archive caches.
export function reset() {
  DATA_DIR = null;
  META_FILE = null;
  data = null;
  archive = null;
  quarantined = [];
  lastRewind = null;
  metaFromDisk = false;
  warnedKeys.clear();
}

// Newest timestamp anywhere in the loaded data — the disk-side value compared
// against the out-of-repo state file to detect a rewound data dir.
function computeMaxStamp() {
  let max = (metaFromDisk && data?.meta?.lastUpdated) || null;
  const bump = (v) => { if (v && (!max || v > max)) max = v; };
  for (const col of COLLECTIONS) {
    for (const e of data?.[col] || []) {
      bump(e.updatedAt); bump(e.createdAt); bump(e.doneAt);
    }
  }
  for (const e of archive?.items || []) { bump(e.updatedAt); bump(e.archivedAt); }
  for (const e of archive?.designs || []) { bump(e.updatedAt); bump(e.archivedAt); }
  return max;
}

// After a legitimate delete/archive the newest record may be gone; force the
// state file down to the new disk max so the next load doesn't cry rewind.
function syncSeenAfterRemoval() {
  if (!data) return;
  recordSeenStamp(DATA_DIR, computeMaxStamp(), { force: true });
}

export function load() {
  initPaths();
  ensureDirs();
  quarantined = []; // rebuilt from disk on every load

  const buildDefaultMeta = () => ({
    projectName: getConfig().name,
    version: '3.0.0',
    lastUpdated: new Date().toISOString(),
    counters: getDefaultCounters()
  });
  let meta;
  metaFromDisk = false;
  if (existsSync(META_FILE)) {
    try {
      meta = JSON.parse(readFileSync(META_FILE, 'utf-8'));
      metaFromDisk = true;
    } catch (err) {
      warnOnce(`meta.json could not be read (${err.message}) — using defaults`);
      meta = buildDefaultMeta();
    }
  } else {
    meta = buildDefaultMeta();
  }

  data = {
    meta,
    items: readCollection('items'),
    designs: readCollection('designs'),
    plans: readCollection('plans'),
    sprints: readCollection('sprints'),
    milestones: readCollection('milestones')
  };

  archive = {
    items: [],
    designs: [],
    archivedAt: {}
  };
  const archiveDir = join(DATA_DIR, 'archive');
  if (existsSync(archiveDir)) {
    const files = readdirSync(archiveDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      let entity;
      try {
        entity = mdToEntity(readFileSync(join(archiveDir, f), 'utf-8'));
      } catch (err) {
        quarantineFile('archive', f, err);
        continue;
      }
      if (entity.id && entity.id.startsWith('SDD')) {
        archive.designs.push(entity);
      } else {
        if (entity.archivedAt) {
          archive.archivedAt[entity.id] = entity.archivedAt;
        }
        archive.items.push(entity);
      }
    }
  }

  const diskMax = computeMaxStamp();
  const seenMax = readSeenStamp(DATA_DIR);
  // A rewind is disk showing strictly older content than this data dir ever
  // showed before — including an emptied dir (diskMax null with history seen).
  if (seenMax && (!diskMax || diskMax < seenMax)) {
    lastRewind = { diskMax, seenMax };
    warnOnce(
      `data dir looks REWOUND: newest record on disk is ${diskMax || 'none (empty)'}, but ${seenMax} was seen here before. ` +
      `Likely a git reset/branch switch or external delete rewound ${DATA_DIR}. ` +
      `Check \`git -C ${DATA_DIR} log\` / your VCS before writing new data.`
    );
  } else {
    lastRewind = null;
    recordSeenStamp(DATA_DIR, diskMax);
  }

  return data;
}

// Non-null when the last load() saw a rewound data dir: { diskMax, seenMax }.
export function getRewind() {
  if (!data) load();
  return lastRewind;
}

export function get() {
  if (!data) load();
  return data;
}

function serializeEntity(collection, entity) {
  if (JSON_COLLECTIONS.has(collection)) {
    return JSON.stringify(entity, null, 2);
  }
  return entityToMd(entity);
}

export function save() {
  if (!data) return;
  initPaths();
  data.meta.lastUpdated = new Date().toISOString();
  atomicWrite(META_FILE, JSON.stringify(data.meta, null, 2));
  for (const col of COLLECTIONS) {
    for (const entity of data[col]) {
      const filePath = join(DATA_DIR, col, filenameForId(col, entity.id));
      atomicWrite(filePath, serializeEntity(col, entity));
    }
  }
  recordSeenStamp(DATA_DIR, data.meta.lastUpdated);
  markDirty();
}

export function writeEntity(collection, id, entity) {
  initPaths();
  ensureDirs();
  const filePath = join(DATA_DIR, collection, filenameForId(collection, id));
  const isNew = !existsSync(filePath);
  atomicWrite(filePath, serializeEntity(collection, entity));
  recordSeenStamp(DATA_DIR, entity.updatedAt || entity.createdAt || new Date().toISOString());
  markDirty();
  const entityType = collection.replace(/s$/, '');
  emit(entityType, id, isNew ? 'create' : 'update');
}

export function deleteEntity(collection, id) {
  initPaths();
  const filePath = join(DATA_DIR, collection, filenameForId(collection, id));
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
  syncSeenAfterRemoval();
  markDirty();
  const entityType = collection.replace(/s$/, '');
  emit(entityType, id, 'delete');
}

export function getArchive() {
  if (!archive) load();
  return archive;
}

export function saveArchive() {
  if (!archive) return;
  initPaths();
  ensureDirs();
  for (const item of archive.items) {
    const entity = { ...item };
    if (archive.archivedAt[item.id]) {
      entity.archivedAt = archive.archivedAt[item.id];
    }
    const filePath = join(DATA_DIR, 'archive', `${item.id}.md`);
    atomicWrite(filePath, entityToMd(entity));
  }
  for (const design of archive.designs) {
    const filePath = join(DATA_DIR, 'archive', `${design.id}.md`);
    atomicWrite(filePath, entityToMd(design));
  }
  markDirty();
}

export function archiveItems(ids) {
  if (!data || !archive) load();
  initPaths();
  const now = new Date().toISOString();
  const moved = [];
  for (const id of ids) {
    const idx = data.items.findIndex(i => i.id === id);
    if (idx === -1) continue;
    const [item] = data.items.splice(idx, 1);
    archive.items.push(item);
    archive.archivedAt[id] = now;
    const archiveEntity = { ...item, archivedAt: now };
    const archiveFilePath = join(DATA_DIR, 'archive', `${id}.md`);
    atomicWrite(archiveFilePath, entityToMd(archiveEntity));
    const itemFilePath = join(DATA_DIR, 'items', `${id}.md`);
    if (existsSync(itemFilePath)) {
      unlinkSync(itemFilePath);
    }
    emit('item', id, 'archive');
    moved.push(id);
  }
  if (moved.length) {
    data.meta.lastUpdated = now;
    atomicWrite(META_FILE, JSON.stringify(data.meta, null, 2));
    recordSeenStamp(DATA_DIR, now, { force: true });
    markDirty();
  }
  return moved;
}

export function sweepDoneItems(minAgeDays = 1) {
  if (!data) load();
  const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
  const eligible = data.items
    .filter(i => {
      if (i.stage !== 'done') return false;
      if (i.type === 'decision') return false;
      const doneAt = i.doneAt || i.updatedAt || i.createdAt;
      return new Date(doneAt).getTime() < cutoff;
    })
    .map(i => i.id);
  return archiveItems(eligible);
}

// Pools spanning every id-bearing collection plus the archive, used to derive
// the next id from the highest present so ids are never reused.
function allIdPools() {
  if (!data) load();
  const arch = getArchive();
  // Tasks are nested inside plan files, not a top-level collection, so flatten
  // them in too — otherwise TASK ids would never see their predecessors.
  const tasks = (data.plans || []).flatMap(p => p.tasks || []);
  return [
    data.items, data.designs, data.plans, data.sprints, data.milestones,
    tasks, arch.items, arch.designs,
    // Skipped/malformed files keep their id reserved ({id} shape) so a create
    // never hands back an id whose file exists but failed to load.
    quarantined,
  ];
}

// Files skipped during the last load() (parse/validation failure). Surfaced so
// callers (CLI, dashboard) can report what was not loaded.
export function getQuarantined() {
  if (!data) load();
  return quarantined;
}

// Derive the next id from the highest id actually present on disk (loaded into
// `data`/`archive`), NOT from a stored counter. A counter is a single scalar
// that drifts across git branches and stale server RAM — that drift is exactly
// what caused a live id to be handed back and a record overwritten. Disk is the
// single source of truth; max+1 can only collide under genuinely concurrent
// offline creation, which is a separate (deliberately deferred) problem.
// `extraIds` carries ids already allocated earlier in the same batch (e.g. the
// sibling tasks of a plan being constructed, which aren't in `data` yet).
export function nextId(prefix, extraIds = []) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  const bump = (id) => {
    const m = id && String(id).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  for (const pool of allIdPools()) for (const e of pool || []) bump(e && e.id);
  for (const id of extraIds) bump(id);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
