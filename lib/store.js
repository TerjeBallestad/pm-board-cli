import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { parse, serialize } from './frontmatter.js';
import { resolveDataDir, getConfig, getDefaultCounters } from './config.js';
import { emit } from '../api/events.js';

let DATA_DIR = null;
let META_FILE = null;

const COLLECTIONS = ['items', 'designs', 'plans', 'sprints', 'milestones'];
const MD_COLLECTIONS = new Set(['items', 'designs']);
const JSON_COLLECTIONS = new Set(['plans', 'sprints', 'milestones']);
const SUBDIRS = [...COLLECTIONS, 'archive'];

let data = null;
let archive = null;

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
  if (JSON_COLLECTIONS.has(collectionName)) {
    return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      const entity = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      validateFilenameId(collectionName, f, entity);
      return entity;
    });
  }
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const entity = mdToEntity(readFileSync(join(dir, f), 'utf-8'));
    validateFilenameId(collectionName, f, entity);
    return entity;
  });
}

function validateFilenameId(collectionName, filename, entity) {
  const expected = filename.replace(/\.(md|json)$/, '');
  const actual = entity?.id;
  if (!actual) {
    throw new Error(`${collectionName}/${filename} filename id ${expected} has no frontmatter id`);
  }
  if (actual !== expected) {
    throw new Error(`${collectionName}/${filename} filename id ${expected} does not match frontmatter id ${actual}`);
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
}

export function load() {
  initPaths();
  ensureDirs();

  let meta;
  if (existsSync(META_FILE)) {
    meta = JSON.parse(readFileSync(META_FILE, 'utf-8'));
  } else {
    const config = getConfig();
    meta = {
      projectName: config.name,
      version: '3.0.0',
      lastUpdated: new Date().toISOString(),
      counters: getDefaultCounters()
    };
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
      const content = readFileSync(join(archiveDir, f), 'utf-8');
      const entity = mdToEntity(content);
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

  return data;
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
}

export function writeEntity(collection, id, entity) {
  initPaths();
  ensureDirs();
  const filePath = join(DATA_DIR, collection, filenameForId(collection, id));
  const isNew = !existsSync(filePath);
  atomicWrite(filePath, serializeEntity(collection, entity));
  const entityType = collection.replace(/s$/, '');
  emit(entityType, id, isNew ? 'create' : 'update');
}

export function deleteEntity(collection, id) {
  initPaths();
  const filePath = join(DATA_DIR, collection, filenameForId(collection, id));
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
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

// Pools spanning every id-bearing collection plus the archive. Used for both
// next-id derivation and existence checks so ids are never reused.
function allIdPools() {
  if (!data) load();
  const arch = getArchive();
  // Tasks are nested inside plan files, not a top-level collection, so flatten
  // them in too — otherwise TASK ids would never see their predecessors.
  const tasks = (data.plans || []).flatMap(p => p.tasks || []);
  return [
    data.items, data.designs, data.plans, data.sprints, data.milestones,
    tasks, arch.items, arch.designs,
  ];
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

// True if any active or archived entity already owns this id. Create paths use
// this to refuse silent overwrites.
export function idExists(id) {
  for (const pool of allIdPools()) {
    if ((pool || []).some(e => e && e.id === id)) return true;
  }
  return false;
}
