import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig, getConfigDir } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILTIN_TEMPLATES_DIR = join(__dirname, '..', 'defaults', 'templates');

/**
 * Load a template by name (e.g. 'prompt-item', 'review-sdd').
 * Checks project templates dir first, falls back to built-in defaults per file.
 * Returns the raw template string, or null if not found in either location.
 */
export function loadTemplate(name) {
  const config = getConfig();
  if (config.templates) {
    const custom = join(getConfigDir(), config.templates, `${name}.md`);
    if (existsSync(custom)) return readFileSync(custom, 'utf-8');
  }
  const builtin = join(BUILTIN_TEMPLATES_DIR, `${name}.md`);
  if (!existsSync(builtin)) return null;
  return readFileSync(builtin, 'utf-8');
}

/**
 * Render a template by substituting {{var.path}} placeholders.
 * Supports dotted paths: {{item.title}}, {{project.name}}
 *
 * @param {string} template - template string with {{var}} placeholders
 * @param {object} vars - flat or nested object of variable values
 * @returns {string} rendered template
 */
export function render(template, vars) {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const val = resolvePath(vars, path);
    if (val === undefined || val === null) return '';
    return String(val);
  });
}

/**
 * Load and render a template in one call.
 * Falls back to the fallback string if template not found.
 */
export function renderTemplate(name, vars, fallback = '') {
  const template = loadTemplate(name);
  if (!template) return fallback;
  return render(template, vars);
}

/**
 * Resolve a dotted path like 'item.title' against an object.
 */
function resolvePath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

// --- Pre-render helpers ---
// These build "blob" strings from structured data, for use as template variables.

/**
 * Pre-render a list of items as a markdown blob.
 */
export function renderItemsBlob(items) {
  if (!items || items.length === 0) return '(none)';
  return items.map(item => {
    let s = `### ${item.id}: ${item.title}\n`;
    s += `**Type:** ${item.type} | **Priority:** ${item.priority || 'unset'}`;
    if (item.body) s += `\n${item.body.slice(0, 500)}`;
    return s;
  }).join('\n\n');
}

/**
 * Pre-render comments as a markdown blob.
 */
export function renderCommentsBlob(comments) {
  if (!comments || comments.length === 0) return '(no comments)';
  return comments.map(c =>
    `**${c.author}** (${c.createdAt}):\n${c.text}`
  ).join('\n\n');
}

/**
 * Pre-render a task list as a markdown blob.
 */
export function renderTasksBlob(tasks) {
  if (!tasks || tasks.length === 0) return '(no tasks)';
  return tasks.map((t, idx) => {
    const status = t.passes ? '[x]' : '[ ]';
    const blocked = t.blockedBy?.length ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
    let s = `- ${status} **${t.id}**: ${t.title}${blocked}`;
    if (t.description) s += `\n  ${t.description}`;
    if (t.verification) s += `\n  Verify: ${t.verification}`;
    return s;
  }).join('\n');
}

/**
 * Pre-render related items as a markdown blob.
 */
export function renderRelatedBlob(items) {
  if (!items || items.length === 0) return '(none)';
  return items.map(r =>
    `### ${r.id}: ${r.title}\n${r.body?.slice(0, 200) || '(no description)'}...`
  ).join('\n\n');
}

/**
 * Pre-render affected files as a markdown list.
 */
export function renderFilesBlob(files) {
  if (!files || files.length === 0) return '(none)';
  return files.map(f => `- \`${f}\``).join('\n');
}

/**
 * Pre-render design decisions list as a markdown blob.
 */
export function renderDecisionsBlob(decisions) {
  if (!decisions || decisions.length === 0) return '(none)';
  return decisions.map(dd => {
    let s = `- **${dd.id}: ${dd.title}**`;
    if (dd.body) s += ` — ${dd.body.split('\n')[0].slice(0, 150)}`;
    return s;
  }).join('\n');
}
