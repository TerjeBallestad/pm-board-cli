// lib/dispatch.js — in-process request dispatch for the serverless CLI.
//
// Maps an HTTP verb + /api path straight to the exported route handlers, with no
// network and no Express. Handlers touch only req.{body,query,params} and
// res.{status,json,end}, so a trivial mock req/res runs the exact same code the
// server runs. Each call reloads config + store from disk, so the CLI always
// sees current files (no daemon, no stale cache) — that is what makes serverless
// safe across git pulls and hand-edited conflict resolutions.

import { loadConfig, getConfig } from './config.js';
import * as store from './store.js';
import * as items from '../api/items.js';
import * as designs from '../api/designs.js';
import * as plans from '../api/plans.js';
import * as sprints from '../api/sprints.js';
import * as context from '../api/context.js';

// Compile '/api/plans/:planId/tasks/:taskId' → { regex, keys }.
function compile(template) {
  const keys = [];
  const pattern = template.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

// Order matters: more specific paths before catch-all ':id' routes.
const ROUTE_TABLE = [
  ['GET', '/api/health', () => ({ status: 'ok', version: '0.1.0', project: getConfig().name }), true],

  ['GET', '/api/items/archived', items.listArchived],
  ['POST', '/api/items/archive/sweep', items.sweepItems],
  ['POST', '/api/items/archive', items.archiveItems],
  ['GET', '/api/items', items.listItems],
  ['POST', '/api/items', items.createItem],
  ['GET', '/api/items/:id', items.getItem],
  ['PATCH', '/api/items/:id', items.patchItem],
  ['DELETE', '/api/items/:id', items.deleteItem],
  ['POST', '/api/items/:id/comments', items.addItemComment],

  ['GET', '/api/designs', designs.listDesigns],
  ['POST', '/api/designs', designs.createDesign],
  ['GET', '/api/designs/:id', designs.getDesign],
  ['PATCH', '/api/designs/:id', designs.patchDesign],
  ['POST', '/api/designs/:id/comments', designs.addDesignComment],

  ['GET', '/api/plans', plans.listPlans],
  ['POST', '/api/plans', plans.createPlan],
  ['GET', '/api/plans/:id/next-task', plans.nextTask],
  ['GET', '/api/plans/:id/context', plans.planContext],
  ['POST', '/api/plans/:id/tasks', plans.addPlanTasks],
  ['PATCH', '/api/plans/:planId/tasks/:taskId', plans.patchTask],
  ['POST', '/api/plans/:id/comments', plans.addPlanComment],
  ['GET', '/api/plans/:id', plans.getPlan],
  ['PATCH', '/api/plans/:id', plans.patchPlan],

  ['GET', '/api/sprints', sprints.listSprints],
  ['POST', '/api/sprints', sprints.createSprint],
  ['POST', '/api/sprints/:id/suggest', sprints.suggestSprintItems],
  ['POST', '/api/sprints/:id/explore', sprints.exploreSprint],
  ['POST', '/api/sprints/:id/items', sprints.addSprintItems],
  ['GET', '/api/sprints/:id', sprints.getSprint],
  ['PATCH', '/api/sprints/:id', sprints.patchSprint],

  ['GET', '/api/context/qmd', context.qmdQuery],
  ['POST', '/api/context/prompt', context.generatePrompt],
  ['POST', '/api/context/review', context.generateReview],
].map(([method, template, handler, direct]) => ({ method, ...compile(template), handler, direct }));

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

// Use an already-loaded config if present (tests, embedding); otherwise load it
// from the current working directory (the normal CLI case).
function ensureConfig() {
  try { getConfig(); } catch { loadConfig(); }
}

// Dispatch one request in-process. Returns { status, data } mirroring the HTTP
// response the server would have produced.
export async function dispatch(method, path, body) {
  ensureConfig();
  store.load(); // fresh disk read every command — disk is the source of truth

  const [rawPath, queryStr = ''] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr));

  for (const route of ROUTE_TABLE) {
    if (route.method !== method) continue;
    const m = rawPath.match(route.regex);
    if (!m) continue;

    if (route.direct) {
      return { status: 200, data: route.handler() };
    }

    const params = {};
    route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
    const req = { params, query, body: body || {} };
    const res = mockRes();
    await route.handler(req, res);
    return { status: res.statusCode, data: res.body };
  }

  return {
    status: 501,
    data: { error: `No local route for ${method} ${rawPath} — this command needs a running server (pm serve)` },
  };
}
