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
    return readdirSync(dir).filter(f => f.endsWith('.json')).map(f =>
      JSON.parse(readFileSync(join(dir, f), 'utf-8'))
    );
  }
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f =>
    mdToEntity(readFileSync(join(dir, f), 'utf-8'))
  );
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

export function nextId(prefix) {
  if (!data) load();
  initPaths();
  const counter = data.meta.counters[prefix] || 0;
  data.meta.counters[prefix] = counter + 1;
  atomicWrite(META_FILE, JSON.stringify(data.meta, null, 2));
  return `${prefix}-${String(counter + 1).padStart(3, '0')}`;
}
