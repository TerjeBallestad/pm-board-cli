import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const CONFIG_FILENAME = 'pm.config.json';

const DEFAULT_CONFIG = {
  name: 'My Project',
  port: 3333,
  dataDir: '.pm/data',
  stages: ['inbox', 'exploring', 'sdd', 'planned', 'done'],
  entityTypes: {
    SB:    { label: 'Issue',    color: '#66d9ef' },
    DD:    { label: 'Decision', color: '#ae81ff' },
    DC:    { label: 'Concern',  color: '#e6db74' },
    GAP:   { label: 'Gap',      color: '#f92672' },
    SDD:   { label: 'Design' },
    PLAN:  { label: 'Plan' },
    SPRINT: { label: 'Sprint' },
    TASK:  { label: 'Task' },
    MILESTONE: { label: 'Milestone' }
  },
  knowledgeBase: {
    command: 'qmd query',
    scope: null
  },
  templates: null, // null = use built-in defaults
  frontend: {
    dir: null // null = use built-in dashboard
  }
};

// Item types map their prefix to a "type" string used in the data model.
// This mapping is derived from entityTypes config.
// By convention, item-level types are: SB→issue, DD→decision, DC→concern, GAP→gap
const DEFAULT_TYPE_PREFIX = { issue: 'SB', decision: 'DD', concern: 'DC', gap: 'GAP' };

let _config = null;
let _configDir = null; // directory containing pm.config.json (or cwd)

/**
 * Walk up from startDir looking for pm.config.json.
 * Returns { config, configDir } or null if not found.
 */
function findConfig(startDir) {
  let dir = resolve(startDir);
  const root = dirname(dir) === dir ? dir : null; // filesystem root check
  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf-8');
        return { config: JSON.parse(raw), configDir: dir };
      } catch (e) {
        throw new Error(`Failed to parse ${candidate}: ${e.message}`);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Load configuration. Merges found config with defaults.
 * @param {string} [startDir=process.cwd()] - directory to start searching from
 * @returns {object} merged config
 */
export function loadConfig(startDir = process.cwd()) {
  const found = findConfig(startDir);

  if (found) {
    _configDir = found.configDir;
    _config = mergeDeep(structuredClone(DEFAULT_CONFIG), found.config);
  } else {
    _configDir = resolve(startDir);
    _config = structuredClone(DEFAULT_CONFIG);
  }

  return _config;
}

/**
 * Get the loaded config (must call loadConfig first).
 */
export function getConfig() {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}

/**
 * Get the directory containing pm.config.json (or cwd if none found).
 * Data paths are resolved relative to this.
 */
export function getConfigDir() {
  if (!_configDir) throw new Error('Config not loaded. Call loadConfig() first.');
  return _configDir;
}

/**
 * Resolve the data directory to an absolute path.
 */
export function resolveDataDir() {
  const config = getConfig();
  const configDir = getConfigDir();
  return resolve(configDir, config.dataDir);
}

/**
 * Build the QMD command string from config.
 * Returns null if knowledge base is disabled.
 */
export function buildQmdCommand(query) {
  const config = getConfig();
  const kb = config.knowledgeBase;
  if (!kb || !kb.command) return null;
  const escaped = query.replace(/"/g, '\\"');
  let cmd = `${kb.command} "${escaped}"`;
  if (kb.scope) cmd += ` -c ${kb.scope}`;
  return cmd;
}

/**
 * Get the type→prefix mapping from entityTypes config.
 * Builds it dynamically from config labels.
 */
export function getTypePrefix() {
  const config = getConfig();
  const map = {};
  for (const [prefix, meta] of Object.entries(config.entityTypes)) {
    const label = (meta.label || prefix).toLowerCase();
    map[label] = prefix;
  }
  return map;
}

/**
 * Get the default counters object from configured entity types.
 */
export function getDefaultCounters() {
  const config = getConfig();
  const counters = {};
  for (const prefix of Object.keys(config.entityTypes)) {
    counters[prefix] = 0;
  }
  return counters;
}

/** Deep merge utility (source wins for primitives, arrays replaced) */
function mergeDeep(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      mergeDeep(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

export { DEFAULT_CONFIG, CONFIG_FILENAME };
