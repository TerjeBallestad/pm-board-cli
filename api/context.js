import { Router } from 'express';
import { execSync } from 'node:child_process';
import * as store from '../lib/store.js';
import { getConfig, buildQmdCommand } from '../lib/config.js';
import {
  renderTemplate, renderItemsBlob, renderCommentsBlob,
  renderTasksBlob, renderRelatedBlob, renderFilesBlob,
  renderDecisionsBlob
} from '../lib/templates.js';

const router = Router();

// QMD proxy (config-driven)
router.get('/qmd', (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q required' });
  const cmd = buildQmdCommand(q);
  if (!cmd) return res.json({ query: q, result: '', error: 'Knowledge base not configured' });
  try {
    const result = execSync(cmd, { timeout: 10000, encoding: 'utf8' });
    res.json({ query: q, result });
  } catch (e) {
    res.json({ query: q, result: '', error: e.message });
  }
});

// Generate scoped prompt for any entity
router.post('/prompt', async (req, res) => {
  const { entityType, entityId, includeQmd } = req.body;
  const data = store.get();
  const config = getConfig();
  let prompt = '';

  if (entityType === 'item') {
    const item = data.items.find(i => i.id === entityId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const relatedItems = data.items.filter(i => (item.related || []).includes(i.id));
    prompt = renderTemplate('prompt-item', {
      project: { name: config.name },
      item: {
        id: item.id,
        title: item.title,
        type: item.type,
        priority: item.priority || 'unset',
        stage: item.stage,
        body: item.body || '(no description)',
        affectedFiles: renderFilesBlob(item.affectedFiles),
        related: renderRelatedBlob(relatedItems),
        comments: renderCommentsBlob(item.comments)
      }
    }, buildItemPromptFallback(item, data));
  } else if (entityType === 'sdd') {
    const sdd = data.designs.find(d => d.id === entityId);
    if (!sdd) return res.status(404).json({ error: 'SDD not found' });
    const linkedItems = (sdd.itemIds || []).map(id => data.items.find(i => i.id === id)).filter(Boolean);
    prompt = renderTemplate('prompt-sdd', {
      project: { name: config.name },
      sdd: {
        id: sdd.id,
        title: sdd.title,
        body: sdd.body || '(no description)',
        linkedItems: renderItemsBlob(linkedItems),
        comments: renderCommentsBlob(sdd.comments)
      }
    }, buildSddPromptFallback(sdd, data));
  } else if (entityType === 'plan') {
    const plan = data.plans.find(p => p.id === entityId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const sdd = data.designs.find(d => d.id === plan.sddId);
    prompt = renderTemplate('prompt-plan', {
      project: { name: config.name },
      plan: {
        id: plan.id,
        title: plan.title,
        setupNotes: plan.context?.setupNotes || '',
        designDecisions: plan.context?.designDecisions || '',
        relevantFiles: renderFilesBlob(plan.context?.relevantFiles),
        sddTitle: sdd ? `${sdd.id} — ${sdd.title}` : '(none)',
        sddBody: sdd?.body || '(no SDD linked)',
        taskList: renderTasksBlob(plan.tasks)
      }
    }, buildPlanPromptFallback(plan, data));
  } else {
    return res.status(400).json({ error: 'entityType must be item, sdd, or plan' });
  }

  // Optional QMD context
  if (includeQmd) {
    const title = entityType === 'item'
      ? data.items.find(i => i.id === entityId)?.title
      : entityType === 'sdd'
        ? data.designs.find(d => d.id === entityId)?.title
        : data.plans.find(p => p.id === entityId)?.title;
    if (title) {
      const cmd = buildQmdCommand(title);
      if (cmd) {
        try {
          const qmd = execSync(cmd, { timeout: 10000, encoding: 'utf8' });
          if (qmd.trim()) prompt += `\n\n## Knowledge Base Context\n\n${qmd.trim()}`;
        } catch (_) { /* QMD unavailable, skip */ }
      }
    }
  }

  res.json({ prompt, entityType, entityId });
});

// Generate review prompt for SDDs or Plans
router.post('/review', async (req, res) => {
  const { entityType, entityId } = req.body;
  const data = store.get();
  const config = getConfig();
  let prompt = '';

  if (entityType === 'sdd') {
    const sdd = data.designs.find(d => d.id === entityId);
    if (!sdd) return res.status(404).json({ error: 'SDD not found' });
    const linkedItems = (sdd.itemIds || []).map(id => data.items.find(i => i.id === id)).filter(Boolean);
    const allDecisions = data.items.filter(i => i.type === 'decision');
    prompt = renderTemplate('review-sdd', {
      project: { name: config.name },
      sdd: {
        id: sdd.id,
        title: sdd.title,
        body: sdd.body || '(empty body)',
        linkedItems: renderItemsBlob(linkedItems),
        decisions: renderDecisionsBlob(allDecisions.slice(0, 20))
      }
    }, buildSddReviewFallback(sdd, data));
  } else if (entityType === 'plan') {
    const plan = data.plans.find(p => p.id === entityId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const sdd = data.designs.find(d => d.id === plan.sddId);
    const dd = plan.context?.designDecisions;
    const ddRefs = dd ? ((Array.isArray(dd) ? dd.join(' ') : dd).match(/DD-\d+/g) || []) : [];
    const referencedDecisions = ddRefs.map(ref => data.items.find(i => i.id === ref)).filter(Boolean);
    prompt = renderTemplate('review-plan', {
      project: { name: config.name },
      plan: {
        id: plan.id,
        title: plan.title,
        setupNotes: plan.context?.setupNotes || '',
        designDecisions: Array.isArray(plan.context?.designDecisions)
          ? plan.context.designDecisions.join('\n')
          : (plan.context?.designDecisions || ''),
        relevantFiles: renderFilesBlob(plan.context?.relevantFiles),
        sddTitle: sdd ? `${sdd.id} — ${sdd.title}` : '(none)',
        sddBody: sdd?.body || '(no SDD linked)',
        taskList: renderTasksBlob(plan.tasks),
        referencedDecisions: renderItemsBlob(referencedDecisions)
      }
    }, buildPlanReviewFallback(plan, data));
  } else {
    return res.status(400).json({ error: 'entityType must be sdd or plan' });
  }

  // Gather QMD context
  const qmdResults = [];
  const qmdQueries = extractReviewQmdQueries(entityType, entityId, data);
  for (const q of qmdQueries) {
    const cmd = buildQmdCommand(q);
    if (!cmd) continue;
    try {
      const result = execSync(cmd, { timeout: 10000, encoding: 'utf8' });
      if (result.trim()) qmdResults.push({ query: q, result: result.trim() });
    } catch (_) { /* QMD unavailable, skip */ }
  }

  if (qmdResults.length > 0) {
    prompt += `\n\n## Knowledge Base Context\n\n`;
    prompt += `Use these references to cross-check decisions and identify misalignments:\n\n`;
    for (const qr of qmdResults) {
      prompt += `### Query: "${qr.query}"\n\n${qr.result}\n\n`;
    }
  }

  res.json({ prompt, entityType, entityId });
});

// --- QMD query extraction ---

function extractReviewQmdQueries(entityType, entityId, data) {
  const queries = [];
  if (entityType === 'sdd') {
    const sdd = data.designs.find(d => d.id === entityId);
    if (sdd) {
      queries.push(sdd.title);
      for (const itemId of (sdd.itemIds || [])) {
        const item = data.items.find(i => i.id === itemId);
        if (item) queries.push(item.title);
      }
    }
  } else if (entityType === 'plan') {
    const plan = data.plans.find(p => p.id === entityId);
    if (plan) {
      queries.push(plan.title);
      const sdd = data.designs.find(d => d.id === plan.sddId);
      if (sdd) queries.push(sdd.title);
      const dd = plan.context?.designDecisions;
      if (dd) {
        const ddRefs = (Array.isArray(dd) ? dd.join(' ') : dd).match(/DD-\d+/g) || [];
        for (const ref of ddRefs.slice(0, 3)) {
          const item = data.items.find(i => i.id === ref);
          if (item) queries.push(item.title);
        }
      }
    }
  }
  return [...new Set(queries)].slice(0, 5);
}

// --- Inline fallbacks (used when no template file exists) ---

function buildItemPromptFallback(item, data) {
  let p = `# ${item.id}: ${item.title}\n\n`;
  p += `**Type:** ${item.type} | **Priority:** ${item.priority || 'unset'} | **Stage:** ${item.stage}\n\n`;
  if (item.body) p += `## Description\n\n${item.body}\n\n`;
  return p;
}

function buildSddPromptFallback(sdd, data) {
  let p = `# ${sdd.id}: ${sdd.title}\n\n`;
  if (sdd.body) p += sdd.body + '\n\n';
  return p;
}

function buildPlanPromptFallback(plan, data) {
  let p = `# ${plan.id}: ${plan.title}\n\n`;
  if (plan.context?.setupNotes) p += `## Setup\n\n${plan.context.setupNotes}\n\n`;
  return p;
}

function buildSddReviewFallback(sdd, data) {
  return `# SDD Review: ${sdd.id} — ${sdd.title}\n\n(No review template found. Install default templates.)\n\n${sdd.body || ''}`;
}

function buildPlanReviewFallback(plan, data) {
  return `# Plan Review: ${plan.id} — ${plan.title}\n\n(No review template found. Install default templates.)`;
}

export default router;
