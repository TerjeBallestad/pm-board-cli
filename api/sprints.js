import { Router } from 'express';
import * as store from '../lib/store.js';
import { getConfig, buildQmdCommand } from '../lib/config.js';

const router = Router();

// List sprints
router.get('/', (req, res) => {
  res.json(store.get().sprints);
});

// Get single sprint (include related items, SDDs, plans)
router.get('/:id', (req, res) => {
  const data = store.get();
  const sprint = data.sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  const items = data.items.filter(i => i.sprintId === sprint.id);
  const designs = data.designs.filter(d => d.sprintId === sprint.id);
  const plans = data.plans.filter(p => p.sprintId === sprint.id);
  res.json({ ...sprint, items, designs, plans });
});

// Create sprint
router.post('/', async (req, res) => {
  const { name, problemStatement } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = store.nextId('SPRINT');
  const now = new Date().toISOString();
  const sprint = {
    id, name,
    problemStatement: problemStatement || '',
    status: 'active',
    createdAt: now,
    completedAt: null
  };
  store.get().sprints.push(sprint);
  store.writeEntity('sprints', id, sprint);
  res.status(201).json(sprint);
});

// Update sprint (end sprint, rename, etc.)
router.patch('/:id', async (req, res) => {
  const sprint = store.get().sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'problemStatement', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) sprint[key] = req.body[key];
  }
  if (req.body.status === 'completed') {
    sprint.completedAt = new Date().toISOString();
    const now = new Date().toISOString();
    for (const item of store.get().items) {
      if (item.sprintId === sprint.id && item.stage !== 'done') {
        item.stage = 'done';
        item.doneAt = now;
      }
    }
  }
  store.writeEntity('sprints', sprint.id, sprint);
  res.json(sprint);
});

// Suggest items for a sprint based on problem statement
router.post('/:id/suggest', async (req, res) => {
  const data = store.get();
  const sprint = data.sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Not found' });

  const words = sprint.problemStatement.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const unassigned = data.items.filter(i => !i.sprintId && i.stage !== 'done');
  const scored = unassigned.map(item => {
    const text = `${item.title} ${item.body}`.toLowerCase();
    const score = words.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
    return { item, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  res.json(scored.slice(0, 10).map(s => ({ ...s.item, relevanceScore: s.score })));
});

// Generate sprint exploration dossier
router.post('/:id/explore', async (req, res) => {
  const data = store.get();
  const config = getConfig();
  const sprint = data.sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Not found' });

  const items = data.items.filter(i => i.sprintId === sprint.id);
  const designs = data.designs.filter(d => d.sprintId === sprint.id);
  const plans = data.plans.filter(p => p.sprintId === sprint.id);

  let doc = `# Sprint Dossier: ${sprint.name}\n\n`;
  doc += `**ID:** ${sprint.id} | **Status:** ${sprint.status} | **Created:** ${sprint.createdAt}\n\n`;
  if (sprint.problemStatement) {
    doc += `## Problem Statement\n\n${sprint.problemStatement}\n\n`;
  }

  // Items grouped by type
  const byType = {};
  for (const item of items) {
    const t = item.type || 'issue';
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }
  if (items.length) {
    doc += `## Sprint Items (${items.length})\n\n`;
    for (const [type, group] of Object.entries(byType)) {
      doc += `### ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;
      for (const item of group) {
        doc += `#### ${item.id}: ${item.title}\n`;
        doc += `- **Priority:** ${item.priority || 'unset'} | **Stage:** ${item.stage}\n`;
        if (item.body) doc += `- ${item.body.slice(0, 300)}${item.body.length > 300 ? '...' : ''}\n`;
        if (item.affectedFiles?.length) doc += `- **Files:** ${item.affectedFiles.map(f => '`' + f + '`').join(', ')}\n`;
        doc += '\n';
      }
    }
  }

  if (designs.length) {
    doc += `## Design Documents (${designs.length})\n\n`;
    for (const sdd of designs) {
      doc += `### ${sdd.id}: ${sdd.title}\n\n`;
      if (sdd.body) doc += sdd.body.slice(0, 500) + (sdd.body.length > 500 ? '...' : '') + '\n\n';
      if (sdd.itemIds?.length) doc += `**Linked items:** ${sdd.itemIds.join(', ')}\n\n`;
    }
  }

  if (plans.length) {
    doc += `## Plans (${plans.length})\n\n`;
    for (const plan of plans) {
      doc += `### ${plan.id}: ${plan.title}\n\n`;
      if (plan.context?.designDecisions) doc += `**Design decisions:** ${plan.context.designDecisions.slice(0, 300)}\n\n`;
      if (plan.context?.relevantFiles?.length) doc += `**Files:** ${plan.context.relevantFiles.map(f => '`' + f + '`').join(', ')}\n\n`;
      if (plan.tasks?.length) {
        const done = plan.tasks.filter(t => t.passes).length;
        doc += `**Tasks:** ${done}/${plan.tasks.length} complete\n\n`;
      }
    }
  }

  // Aggregated affected files
  const allFiles = new Set();
  for (const item of items) {
    for (const f of item.affectedFiles || []) allFiles.add(f);
  }
  for (const plan of plans) {
    for (const f of plan.context?.relevantFiles || []) allFiles.add(f);
  }
  if (allFiles.size) {
    doc += `## Aggregated Files\n\n`;
    doc += [...allFiles].sort().map(f => `- \`${f}\``).join('\n') + '\n\n';
  }

  // Suggested related items
  const words = (sprint.problemStatement || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length) {
    const unassigned = data.items.filter(i => !i.sprintId && i.stage !== 'done');
    const scored = unassigned.map(item => {
      const text = `${item.title} ${item.body || ''}`.toLowerCase();
      const score = words.reduce((sum, w) => sum + (text.includes(w) ? 1 : 0), 0);
      return { item, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    if (scored.length) {
      doc += `## Potentially Relevant (Unassigned)\n\n`;
      for (const { item, score } of scored) {
        doc += `- **${item.id}:** ${item.title} (relevance: ${score})\n`;
      }
      doc += '\n';
    }
  }

  // Knowledge base query suggestions (config-driven)
  const topics = [sprint.name, sprint.problemStatement, ...items.map(i => i.title)].filter(Boolean);
  const uniqueTopics = [...new Set(topics.map(t => t.toLowerCase().trim()))].filter(Boolean).slice(0, 5);
  if (uniqueTopics.length && config.knowledgeBase?.command) {
    doc += `## Knowledge Base Queries\n\n`;
    doc += `Run these to gather design context:\n\n`;
    for (const topic of uniqueTopics) {
      const cmd = buildQmdCommand(topic);
      doc += `\`\`\`\n${cmd}\n\`\`\`\n\n`;
    }
  }

  res.json({ sprint: sprint.id, dossier: doc });
});

// Add items to sprint
router.post('/:id/items', async (req, res) => {
  const data = store.get();
  const sprint = data.sprints.find(s => s.id === req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Not found' });
  const { itemIds } = req.body;
  if (!Array.isArray(itemIds)) return res.status(400).json({ error: 'itemIds array required' });
  let count = 0;
  for (const id of itemIds) {
    const item = data.items.find(i => i.id === id);
    if (item) {
      item.sprintId = sprint.id;
      store.writeEntity('items', item.id, item);
      count++;
    }
  }
  res.json({ added: count });
});

export default router;
