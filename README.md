# PM Board CLI

Lightweight, file-based project management for agentic workflows. A kanban dashboard, CLI, and REST API designed to split feature development into minimal-context steps that AI agents can execute independently.

## Philosophy

Large features burn through context windows. PM Board enforces a decomposition pipeline that keeps each step small and self-contained:

```
Brainstorm → SDD → Plan → Tasks
```

1. **Brainstorm** — capture ideas, issues, concerns, gaps as backlog items
2. **SDD (Solution Design Document)** — write a focused design spec that links source items and makes decisions explicit
3. **Plan** — break the SDD into an ordered task list with dependencies, verification criteria, and file references
4. **Tasks** — each task is a self-contained unit an agent (or human) can pick up cold, with enough context to execute without reading the full codebase

Optional **reviews** between steps catch problems early — a bad SDD wastes one review cycle, a bad plan wastes entire agent sessions.

The kanban stages (`inbox → exploring → sdd → planned → done`) track where each item is in this pipeline. The dashboard gives you the overview; the CLI gives agents the interface.

## Quick Start

```bash
# Install globally
npm install -g @terjeballestad/pm-board-cli

# Initialize in your project
cd my-project
pm init

# Start the dashboard
pm serve

# Open http://localhost:3333
```

`pm init` creates a `pm.config.json`, a `.pm/data/` directory for artifacts, and a `.pm/.gitignore` to exclude runtime files (`pm.pid`, `pm.log`). The data directory stores all PM artifacts as git-trackable files (YAML frontmatter markdown for items/SDDs, JSON for plans/sprints).

## CLI Reference

### Server Lifecycle

```bash
pm init                          # Create pm.config.json + data directory
pm serve [--port N]              # Start dashboard server (background, detached)
pm stop                          # Stop the running server (by PID)
pm update                        # Self-update to latest npm version (stops/restarts server)
pm health                        # Server health check
```

`pm serve` detects port conflicts — if another process is already using the port, it fails with a clear message instead of silently dying. The server writes logs to `.pm/pm.log` (truncated on each restart) and its PID to `.pm/pm.pid`.

`pm update` stops any running server, runs `npm install -g @terjeballestad/pm-board-cli@latest`, and restarts the server if it was running.

### Items

Create and manage backlog items (issues, concerns, gaps, decisions):

```bash
# Shorthands — get by ID or create by title
pm issue "title"                 # Create issue (or get: pm issue SB-001)
pm concern "title"               # Create concern (or get: pm concern DC-001)
pm gap "title"                   # Create gap (or get: pm gap GAP-001)
pm decision "title"              # Create decision (or get: pm decision DD-001)

# Generic create with explicit type
pm create <type> "title" [--priority P] [--body B] [--pillar P] [--sprint ID] [--files f1,f2]

# Read
pm get <id>                      # Get any entity by ID (SB-001, SDD-001, PLAN-001, etc.)
pm list [--type T] [--stage S] [--priority P] [--sprint ID]

# Update
pm update <id> [--stage S] [--priority P] [--title T] [--body B] [--pillar P] [--sprint ID]
pm comment <id> "text" [--author A]   # Add comment (default author: claude)

# Archive
pm archive <id> [<id2>...]       # Archive one or more items by ID
pm sweep [--days N]              # Auto-archive items in 'done' stage (default: 1 day old)
```

### SDDs (Solution Design Documents)

```bash
pm sdd "title" [--body B] [--items ID1,ID2] [--sprint SPRINT-001]   # Create SDD
pm sdd SDD-001                   # Get SDD by ID
pm sdd create "title" [--body B] [--items IDs] [--sprint ID]        # Explicit create
pm sdds                          # List all SDDs
```

### Plans & Tasks

```bash
# Plans
pm plan create < plan.json       # Create plan from JSON on stdin
pm plan PLAN-001                 # Get plan by ID
pm plans                         # List all plans
pm plan-update PLAN-001 [--tasks @file.json] [--title T] [--stage S]

# Task operations (agent-facing)
pm next-task PLAN-001            # Get next unblocked task for a plan
pm task-done PLAN-001 TASK-1 "completed migration"
pm task-update PLAN-001 TASK-1 [--status S] [--passes true|false] [--note N] [--description D] [--steps '[]'] [--verification V]
```

`pm next-task` is the primary agent interface — it returns the next task whose dependencies are satisfied, with all context needed to execute it cold.

### Sprints

```bash
pm sprint                        # Get the first active sprint
pm sprint SPRINT-001             # Get sprint by ID
pm sprints                       # List all sprints
```

### Exploration & Context

```bash
pm explore SPRINT-001            # Generate sprint dossier (linked items, SDDs, open questions)
pm suggest SPRINT-001            # Get suggested items for a sprint
pm prompt <type> <id>            # Generate scoped prompt (type: item, sdd, plan)
pm review <type> <id>            # Generate review prompt with knowledge base context (type: sdd, plan)
```

`pm prompt` and `pm review` use configurable templates (see [Prompt Templates](#prompt-templates)) to build context-rich prompts for AI agents. The review variant also queries the knowledge base for relevant background.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PM_URL` | Override server URL (default: `http://localhost:<port from config>`) |

## Configuration

`pm.config.json` in your project root:

```json
{
  "name": "My Project",
  "port": 3333,
  "dataDir": ".pm/data",
  "stages": ["inbox", "exploring", "sdd", "planned", "done"],
  "entityTypes": {
    "SB":   { "label": "Issue",    "color": "#66d9ef" },
    "DD":   { "label": "Decision", "color": "#ae81ff" },
    "DC":   { "label": "Concern",  "color": "#e6db74" },
    "GAP":  { "label": "Gap",      "color": "#f92672" },
    "SDD":  { "label": "Design" },
    "PLAN": { "label": "Plan" },
    "SPRINT": { "label": "Sprint" },
    "TASK": { "label": "Task" },
    "MILESTONE": { "label": "Milestone" }
  },
  "knowledgeBase": {
    "command": "qmd query",
    "scope": null
  },
  "templates": null,
  "frontend": {
    "dir": null
  }
}
```

### Key options

| Field | Description | Default |
|-------|-------------|---------|
| `name` | Project name, shown in dashboard header | Directory name |
| `port` | Dashboard server port | `3333` |
| `dataDir` | Where PM data lives (relative to config file) | `.pm/data` |
| `stages` | Kanban column stages | `["inbox", "exploring", "sdd", "planned", "done"]` |
| `entityTypes` | ID prefixes, labels, and colors for item types | See defaults above |
| `knowledgeBase.command` | CLI command for knowledge base queries | `qmd query` |
| `knowledgeBase.scope` | Optional collection scope for KB queries | `null` (search everything) |
| `templates` | Path to custom prompt templates directory | `null` (use built-in) |
| `frontend.dir` | Path to custom dashboard frontend | `null` (use built-in) |

### Custom entity types

Replace the default prefixes with your own:

```json
{
  "entityTypes": {
    "BUG":  { "label": "Bug",     "color": "#f92672" },
    "FEAT": { "label": "Feature", "color": "#66d9ef" },
    "RFC":  { "label": "RFC",     "color": "#ae81ff" }
  }
}
```

The CLI, API, and dashboard all adapt to your entity types — the shorthand commands (`pm issue`, `pm gap`, etc.) map to whatever prefixes you define.

## Prompt Templates

Templates control how `pm prompt` and `pm review` generate context for AI agents. They use simple `{{variable}}` substitution — no loops, no conditionals, just slots.

Default templates live in `defaults/templates/`. Override them by setting `"templates": "./my-templates"` in your config and creating matching files:

```
my-templates/
  prompt-item.md
  prompt-sdd.md
  prompt-plan.md
  review-sdd.md
  review-plan.md
```

### Available variables

| Context | Variables |
|---------|-----------|
| Items | `{{item.id}}`, `{{item.title}}`, `{{item.type}}`, `{{item.priority}}`, `{{item.stage}}`, `{{item.body}}`, `{{item.affectedFiles}}`, `{{item.related}}`, `{{item.comments}}` |
| SDDs | `{{sdd.id}}`, `{{sdd.title}}`, `{{sdd.body}}`, `{{sdd.linkedItems}}`, `{{sdd.comments}}`, `{{sdd.decisions}}` |
| Plans | `{{plan.id}}`, `{{plan.title}}`, `{{plan.setupNotes}}`, `{{plan.designDecisions}}`, `{{plan.relevantFiles}}`, `{{plan.sddTitle}}`, `{{plan.sddBody}}`, `{{plan.taskList}}`, `{{plan.referencedDecisions}}` |
| Global | `{{project.name}}` |

Compound variables (`linkedItems`, `taskList`, `comments`, etc.) are pre-rendered markdown blobs — the template just places them.

### Example template

```markdown
You are reviewing an SDD for {{project.name}}.

## Design Document: {{sdd.title}}

{{sdd.body}}

## Linked Items
{{sdd.linkedItems}}

Review this design for completeness, feasibility, and edge cases.
Provide your feedback as a numbered list of suggestions.
```

## Bring Your Own Frontend

The dashboard is a vanilla JS SPA that talks to the REST API. You can replace it entirely:

```json
{
  "frontend": {
    "dir": "./my-custom-dashboard"
  }
}
```

Point `frontend.dir` at any directory with static files (index.html, JS, CSS). The server serves them and provides the API at `/api/*`. The built-in dashboard is just the default — build a React, Svelte, or whatever frontend that hits the same endpoints.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Project name, stages, entity types |
| `/api/health` | GET | Server health check |
| `/api/items` | GET | List items (query: type, stage, priority, sprintId) |
| `/api/items` | POST | Create item |
| `/api/items/:id` | GET | Get item |
| `/api/items/:id` | PATCH | Update item |
| `/api/items/:id/comments` | POST | Add comment |
| `/api/items/archive` | POST | Archive items (`{ ids: [...] }`) |
| `/api/items/archive/sweep` | POST | Auto-archive done items (`{ days: N }`) |
| `/api/designs` | GET | List SDDs |
| `/api/designs` | POST | Create SDD |
| `/api/designs/:id` | GET | Get SDD |
| `/api/designs/:id` | PATCH | Update SDD |
| `/api/designs/:id/comments` | POST | Add SDD comment |
| `/api/plans` | GET | List plans |
| `/api/plans` | POST | Create plan |
| `/api/plans/:id` | GET | Get plan |
| `/api/plans/:id` | PATCH | Update plan |
| `/api/plans/:id/next-task` | GET | Get next unblocked task |
| `/api/plans/:id/tasks/:taskId` | PATCH | Update task |
| `/api/sprints` | GET | List sprints |
| `/api/sprints/:id` | GET | Get sprint |
| `/api/sprints/:id/explore` | POST | Generate sprint dossier |
| `/api/sprints/:id/suggest` | POST | Get sprint suggestions |
| `/api/context/prompt` | POST | Generate agent prompt |
| `/api/context/review` | POST | Generate review prompt |
| `/api/events` | GET | SSE stream for real-time updates |

### Real-time Updates (SSE)

`GET /api/events` opens a Server-Sent Events stream. The dashboard uses this for live updates without polling. Events are emitted on any data mutation:

```javascript
const events = new EventSource('/api/events');
events.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // { type: 'item_created', payload: { ... } }
};
```

## Data Storage

All data lives in `dataDir` as git-trackable files:

```
.pm/
  data/
    meta.json          # ID counters
    items/             # SB-001.md, DD-001.md, ...
    designs/           # SDD-001.md
    plans/             # PLAN-001.json
    sprints/           # SPRINT-001.json
    milestones/        # MILESTONE-001.json
    archive/           # Archived items
  .gitignore           # Excludes pm.pid and pm.log
  pm.pid               # Server PID (runtime, gitignored)
  pm.log               # Server log (runtime, gitignored, truncated on restart)
```

Items and SDDs are stored as markdown with YAML frontmatter. Plans, sprints, and milestones are JSON. All writes are atomic (temp file + rename). Commit the data directory to git for version history and collaboration.

## Multi-Project Setup

Each project gets its own `pm.config.json` and runs its own server on a separate port:

```bash
# Project A (port 3333)
cd project-a && pm init && pm serve

# Project B (port 3334 — edit pm.config.json first)
cd project-b && pm init && pm serve
```

The CLI discovers the nearest `pm.config.json` by walking up from your current directory, so `pm list` always targets the right project. If no config is found, the CLI refuses to run (no silent fallback to a wrong server).

Port conflicts are detected on startup — if another process is already using the port, `pm serve` fails with a clear error message.

## License

MIT
