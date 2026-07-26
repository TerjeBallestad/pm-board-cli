/**
 * Glossary term detection — shared by the CLI (bin/pm) and the dashboard.
 *
 * PURE ESM: no node builtins, no DOM, no HTML. Text in, matches out. The browser
 * loads this exact file (lib/app.js serves it at /glossary.js), so a single
 * `node:` import or `process` reference would break the dashboard silently.
 * tests/glossary.test.js asserts that purity — keep it true.
 *
 * Rendering decisions live in the consumers: the dashboard wraps matches in
 * spans, the CLI prints a footer. This module knows about neither.
 */

export const TERM_TYPE = 'term';

export function isTerm(item) {
  return !!item && item.type === TERM_TYPE;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lookup keys ignore case and collapse runs of whitespace, so "Merge  Conflict" finds "merge conflict". */
function surfaceKey(s) {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A term with no definition is not a term — it is a signpost pointing at the
 * words that do have one. Deriving this from an empty body rather than a flag
 * keeps the rule self-enforcing: an entry earns its link by being defined.
 */
function termKind(t) {
  const defined = String(t.body || '').trim().length > 0;
  const targets = Array.isArray(t.related) ? t.related : [];
  return !defined && targets.length > 0 ? 'signpost' : 'term';
}

/**
 * Compile a reusable matcher over a set of term items.
 *
 * opts.minLength  minimum surface length (default 3) — stops a term named "pm"
 *                 chipping inside "PM Board".
 * opts.transform  applied to every surface before compiling; the dashboard
 *                 passes its escHtml so a term containing & or < still matches
 *                 the already-escaped text it scans.
 *
 * Returns { re, bySurface, terms, size, conflicts }. `conflicts` is never
 * silently dropped work — both consumers surface it.
 */
export function buildTermIndex(terms, opts = {}) {
  const minLength = opts.minLength ?? 3;
  const transform = opts.transform || ((s) => s);
  const norm = (s) => transform(String(s == null ? '' : s).trim());
  const list = (terms || []).filter(isTerm);

  const index = { re: null, bySurface: new Map(), terms: new Map(), size: 0, conflicts: [] };

  const surfacesOf = (t) => {
    const aliases = Array.isArray(t.aliases) ? t.aliases : [];
    return [t.title, ...aliases].map(norm).filter(Boolean);
  };

  // Pass 1 — collect every signpost surface. An alias may never shadow a word
  // that is ambiguous on its own (`git-merge` may never alias `merge`), or the
  // glossary would quietly resolve the very ambiguity it exists to expose.
  const signpostSurfaces = new Set();
  for (const t of list) {
    if (termKind(t) !== 'signpost') continue;
    for (const s of surfacesOf(t)) signpostSurfaces.add(surfaceKey(s));
  }

  const titleById = new Map(list.map((t) => [t.id, norm(t.title)]));

  // Pass 2 — index every surface, recording why each rejected one was dropped.
  const surfaces = [];
  for (const t of list) {
    const kind = termKind(t);
    const targets = kind === 'signpost' ? (t.related || []).slice() : [];
    index.terms.set(t.id, {
      id: t.id,
      title: norm(t.title),
      kind,
      targets,
      targetTitles: targets.map((id) => titleById.get(id) || id)
    });

    surfacesOf(t).forEach((surface, i) => {
      const isAlias = i > 0;
      const key = surfaceKey(surface);
      if (surface.length < minLength) {
        index.conflicts.push({ termId: t.id, surface, reason: 'too-short' });
      } else if (isAlias && signpostSurfaces.has(key)) {
        index.conflicts.push({ termId: t.id, surface, reason: 'alias-shadows-signpost' });
      } else if (index.bySurface.has(key)) {
        index.conflicts.push({
          termId: t.id, surface, reason: 'duplicate-surface', heldBy: index.bySurface.get(key)
        });
      } else {
        index.bySurface.set(key, t.id);
        surfaces.push(surface);
      }
    });
  }

  if (surfaces.length) {
    // JS alternation is leftmost-FIRST, not leftmost-longest, so sorting by
    // length descending is what makes "merge conflict" win over "merge".
    surfaces.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
    const alt = surfaces.map((s) => escapeRegExp(s).replace(/\s+/g, '[ \\t]+')).join('|');
    // \b is wrong here: '-' is not a word character, so /\bgit-merge\b/ matches
    // inside "re-git-merge" AND "git-merge-strategy". Treating '-' as part of a
    // word fixes both — and stops the signpost "merge" matching inside
    // "git-merge" for free.
    try {
      index.re = new RegExp(`(?<![\\w-])(?:${alt})(?![\\w-])`, 'gi');
    } catch (err) {
      // One term titled "a|b(" would otherwise take down every rendered body in
      // the app. Compiling once means a bad title costs one warning, not a crash.
      index.conflicts.push({ reason: 'regex-compile-failed', message: err.message });
      index.re = null;
      index.bySurface.clear();
    }
  }

  index.size = index.bySurface.size;
  return index;
}

/**
 * Every occurrence of every term in `text`, in document order.
 * Match: { start, end, text, termId, title, kind, targets, targetTitles }
 * `text` is the exact source slice, so callers render the prose's own casing.
 */
export function findTermMatches(text, index) {
  const out = [];
  if (!text || !index || !index.re) return out;
  // The index is memoized across hundreds of bodies and the regex is /g, so
  // lastIndex survives between scans. Failing to reset it silently skips the
  // early matches in every other body — the likeliest bug in this feature.
  index.re.lastIndex = 0;
  let m;
  while ((m = index.re.exec(text)) !== null) {
    if (m[0] === '') { index.re.lastIndex++; continue; }
    const termId = index.bySurface.get(surfaceKey(m[0]));
    const meta = termId && index.terms.get(termId);
    if (!meta) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      termId,
      title: meta.title,
      kind: meta.kind,
      targets: meta.targets,
      targetTitles: meta.targetTitles
    });
  }
  return out;
}

/**
 * Keep only the first occurrence of each term (Wikipedia's rule — linking every
 * "shape" in a ticket is unreadable).
 *
 * This is also exactly the CLI's "distinct terms mentioned" set: the dashboard
 * reads the offsets, the CLI reads the ids. One primitive, so the two surfaces
 * cannot disagree about what a body mentions.
 */
export function firstMatchPerTerm(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    // Dedup on termId, not surface — an alias hit and a title hit are one term.
    if (seen.has(m.termId)) continue;
    seen.add(m.termId);
    out.push(m);
  }
  return out;
}

/** Human-readable one-liners for index.conflicts, for CLI warnings / console.warn. */
export function describeConflict(c) {
  switch (c.reason) {
    case 'alias-shadows-signpost':
      return `${c.termId}: alias "${c.surface}" is an ambiguous word — dropped (aliases may not shadow a signpost)`;
    case 'duplicate-surface':
      return `${c.termId}: "${c.surface}" already claimed by ${c.heldBy} — dropped`;
    case 'too-short':
      return `${c.termId}: "${c.surface}" is too short to match safely — dropped`;
    case 'regex-compile-failed':
      return `glossary index failed to compile (${c.message}) — no terms will link`;
    default:
      return `${c.termId || 'glossary'}: ${c.reason}`;
  }
}
