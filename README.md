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
npm install -g @terjeballestad/pm-board-cli

cd my-project
pm init          # creates pm.config.json + .pm/data/
pm serve         # optional: dashboard at http://localhost:3333
```

Then try the loop:

```bash
pm issue "Login form loses state on refresh"    # capture something → SB-001
pm list                                         # see the backlog
pm get SB-001                                   # full detail
pm patch SB-001 --stage exploring               # move it along the pipeline
pm comment SB-001 "Repro: refresh mid-typing"   # leave a note
```

`pm init` creates a `pm.config.json`, a `.pm/data/` directory for artifacts, and a `.pm/.gitignore` to exclude runtime files (`pm.pid`, `pm.log`). All artifacts are git-trackable files — YAML-frontmatter markdown for items and SDDs, JSON for plans and projects. Commit the data directory (or make it its own repo) for history and collaboration.

### Using it with agents

The CLI is the agent interface. A typical setup: tell your agent (e.g. in `CLAUDE.md`) that project state lives in PM Board, and point it at three commands:

```bash
pm project              # orientation: items with stages + open blockers, designs, plan progress
pm get <id> --brief     # metadata only — cheap to read before deciding to load the full body
pm next-task PLAN-001   # the next unblocked task, with everything needed to execute it cold
```

`pm project` → `pm get --brief` → `pm get` is deliberate progressive disclosure: an agent can orient itself, pick a work item, and load only the context it needs.

The dashboard closes the loop in the other direction: configure `commands` templates in `pm.config.json` (see [Configuration](#configuration)) and every item, SDD, plan, and project gets a **⧉ Start** button that copies a ready-to-paste agent prompt like `Work the PM ticket SB-001: Login form loses state`.

## Serverless by default

The CLI runs **in-process against the data files** — no server required. `pm serve` is only needed for the **dashboard** (the web UI). This makes the data files the single source of truth:

- The CLI, your text editor (e.g. resolving a merge conflict by hand), and `git pull` all write the same files. No daemon holds a divergent in-memory copy.
- IDs are derived from the highest id present on disk (`max+1`), not a stored counter — so they survive branching, merging, and machine switches without the counter drifting and overwriting a record.
- A running dashboard re-reads disk on every request **and watches the data dir**, so it live-updates even when a write comes from outside the server (CLI, editor, `git pull`).

To target a server instead (e.g. a single shared instance over Tailscale), set `PM_URL` or pass `--server`:

```bash
PM_URL=http://my-host:3333 pm list          # use a remote server
pm list --server http://my-host:3333       # same, explicit URL
pm list --server                           # use the local dashboard server from pm.config.json
```

### Data safety

- **Malformed files don't brick the CLI.** On load, PM validates that each data file's name matches its embedded `id`. A malformed or mismatched file (e.g. after a bad merge or hand edit) is skipped with a warning — the rest of your data stays usable — and its id stays **reserved** so a later create never overwrites the file you're fixing.
- **Auto-commit** (opt-in): set `"autoCommit": true` and every store write triggers a debounced git commit of the data dir, so a crash or stray `git reset` loses seconds of work and everything is recoverable via `git log`. Works best when the data dir is its own git repo.
- **Rewind detection**: PM remembers the newest data timestamp *outside* the repo (`~/.pm-board-cli/state/`). If a load suddenly sees only older data — the signature of an unnoticed `git reset` or checkout — it warns loudly, and `pm health` reports `rewound`.
- Sequential ids can still collide if two offline processes create the same entity type concurrently; avoid parallel local writes.

## CLI Reference

Run `pm --help` for the always-current version of this list.

### Setup & server lifecycle

```bash
pm init                          # Create pm.config.json + data directory
pm serve [--port N] [--restart]  # Start dashboard server (background, detached)
pm stop                          # Stop the running server (waits for actual exit)
pm update                        # Self-update to latest npm version (stops/restarts server)
pm health                        # Health check (includes rewind status)
```

`pm serve` detects port conflicts and fails with a clear message instead of silently dying. Logs go to `.pm/pm.log` (truncated on restart), PID to `.pm/pm.pid`. `pm stop`, `pm update`, and `pm serve --restart` wait for the old process to actually release the port before rebinding.

### Items

```bash
# Shorthands — get by ID or create by title
pm issue "title"                 # Create issue (or get: pm issue SB-001)
pm concern "title"               # Create concern (or get: pm concern DC-001)
pm gap "title"                   # Create gap (or get: pm gap GAP-001)
pm decision "title"              # Create decision (or get: pm decision DD-001)

# Generic create with explicit type
pm create <type> "title" [--priority P] [--body B] [--pillar P] [--sprint ID] [--files f1,f2]

# Read
pm get <id> [--brief]            # Any entity by ID; --brief = metadata only, no body/comments
pm list [<type>] [--stage S] [--priority P] [--sprint ID] [--frontier] [--limit N] [--all] [--json]
                                 # Terse "ID  title" lines, oldest→newest, default 20.
                                 # <type>: sdd, plan, sprint, issue, decision, concern, gap.
                                 # --frontier: only items whose blockers are all done/archived.

# Update — patch any field on any entity
pm patch <id> [--stage S] [--priority P] [--title T] [--body B] [--blockedBy IDs] ...
pm comment <id> "text" [--author A]   # Add comment (default author: claude)

# Archive
pm archive <id> [<id2>...]       # Archive one or more items by ID
pm sweep [--days N]              # Auto-archive items in 'done' stage (default: 1 day old)
```

Body flags accept inline text, `@file.md`, or `-` for stdin. Items can declare `blockedBy` dependencies on other items; `pm list --frontier` shows what's actionable now.

### SDDs (Solution Design Documents)

```bash
pm sdd "title" [--body B] [--items ID1,ID2] [--sprint SPRINT-001]   # Create SDD
pm sdd SDD-001                   # Get SDD by ID
pm sdd create "title" [...]      # Explicit create
pm list sdd                      # List all SDDs
```

### Plans & Tasks

```bash
pm plan create < plan.json       # Create plan from JSON on stdin
pm plan PLAN-001                 # Get plan by ID
pm list plan                     # List all plans
pm plan-update PLAN-001 [--tasks @file.json] [--title T] [--stage S]

# Task operations (agent-facing)
pm next-task PLAN-001            # Next unblocked task, with full context to execute cold
pm task-done PLAN-001 TASK-1 "completed migration"      # note also via @file.md or -
pm task-update PLAN-001 TASK-1 [--status S] [--passes true|false] [--note N]
```

`pm next-task` is the primary agent interface — it returns the next task whose dependencies are satisfied, with all context needed to execute it cold.

#### Plan JSON shape

`pm plan create` reads this from stdin. Only `title` is required; task ids are assigned by the server (`TASK-NNN`), so `blockedBy` can reference other tasks by ordinal — `"1"`, `"#2"`, `"task 3"` all mean "the Nth task in this file" and are resolved to real ids on create:

```json
{
  "title": "Migrate auth to sessions",
  "sddId": "SDD-003",
  "sprintId": "SPRINT-001",
  "context": {
    "setupNotes": "Run npm install first; tests need PM_STATE_DIR set.",
    "relevantFiles": ["lib/auth.js", "api/login.js"],
    "designDecisions": "Sessions over JWT — see SDD-003 §2."
  },
  "tasks": [
    {
      "title": "Add session store",
      "description": "Introduce lib/session.js backed by the existing store.",
      "steps": ["Create lib/session.js", "Wire into createApp()"],
      "verification": "npm test passes; login sets a session cookie."
    },
    {
      "title": "Cut login route over",
      "description": "Replace JWT issuance in api/login.js with a session.",
      "blockedBy": ["1"],
      "verification": "Manual login via dashboard works end-to-end."
    }
  ]
}
```

Every task starts as `pending` with `passes: false`; `status`, `passes`, and `progressNotes` are managed afterward via `pm task-done` / `pm task-update`. An unresolvable `blockedBy` ref rejects the whole create with a clear error rather than silently creating an unblockable task.

### Projects

Projects group items, SDDs, and plans toward a destination. (`sprint` is an alias; ids remain `SPRINT-NNN` for compatibility.)

```bash
pm project                       # Overview of the active project: items w/ stage + open
                                 # blockers, designs, plan progress (--json for full dump)
pm project SPRINT-001            # Overview of a specific project
pm project create "name" [--destination "where this arrives"] [--body "markdown doc"]
pm project SPRINT-001 [--name N] [--destination D] [--body B] [--status S]   # Patch
pm list sprint                   # List all projects
```

The project `--body` is a living markdown doc — decisions log, out-of-scope notes — that travels with the project.

### Exploration & Context

```bash
pm explore SPRINT-001            # Generate project dossier (linked items, SDDs, open questions)
pm suggest SPRINT-001            # Get suggested items for a project
pm prompt <type> <id>            # Generate scoped prompt (type: item, sdd, plan)
pm review <type> <id>            # Generate review prompt with knowledge base context (type: sdd, plan)
```

`pm prompt` and `pm review` use configurable templates (see [Prompt Templates](#prompt-templates)) to build context-rich prompts for AI agents. The review variant also queries the knowledge base for relevant background.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PM_URL` | Target a server instead of running in-process (default: serverless) |
| `PM_STATE_DIR` | Override where rewind-detection state lives (default: `~/.pm-board-cli/state/`) |

## Configuration

`pm.config.json` in your project root (created by `pm init`):

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
  "commands": {
    "ticket": { "default": "Work the PM ticket {id}: {title}" },
    "sdd": "Work the PM design doc {id}: {title}",
    "plan": "Execute PM plan {id}",
    "project": "Work the frontier of PM project {id}"
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
| `autoCommit` | Git-commit the data dir (debounced) after every write — see [Data safety](#data-safety) | `false` |
| `stages` | Kanban column stages | `["inbox", "exploring", "sdd", "planned", "done"]` |
| `entityTypes` | ID prefixes, labels, and colors for item types | See defaults above |
| `commands` | Templates for the dashboard's **⧉ Start** buttons — `{id}`/`{title}` placeholders, copied to clipboard. Omit a template and the button doesn't render. `ticket` can map per item type or use `default`. | Generic prompts |
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
| `/api/config` | GET | Project name, stages, entity types, commands |
| `/api/health` | GET | Health check (reports `rewound` after a detected data-dir rewind) |
| `/api/items` | GET | List items (query: type, stage, priority, sprintId, frontier) |
| `/api/items` | POST | Create item |
| `/api/items/:id` | GET / PATCH / DELETE | Get / update / delete item |
| `/api/items/:id/comments` | POST | Add comment |
| `/api/items/archived` | GET | List archived items |
| `/api/items/archive` | POST | Archive items (`{ ids: [...] }`) |
| `/api/items/archive/sweep` | POST | Auto-archive done items (`{ days: N }`) |
| `/api/designs` | GET / POST | List / create SDDs |
| `/api/designs/:id` | GET / PATCH | Get / update SDD |
| `/api/designs/:id/comments` | POST | Add SDD comment |
| `/api/plans` | GET / POST | List / create plans |
| `/api/plans/:id` | GET / PATCH | Get / update plan |
| `/api/plans/:id/next-task` | GET | Get next unblocked task |
| `/api/plans/:id/context` | GET | Full execution context for a plan |
| `/api/plans/:id/tasks` | POST | Append tasks to a plan |
| `/api/plans/:planId/tasks/:taskId` | PATCH | Update task |
| `/api/plans/:id/comments` | POST | Add plan comment |
| `/api/sprints` | GET / POST | List / create projects |
| `/api/sprints/:id` | GET / PATCH | Get / update project |
| `/api/sprints/:id/items` | POST | Attach items to a project |
| `/api/sprints/:id/comments` | POST | Add project comment |
| `/api/sprints/:id/explore` | POST | Generate project dossier |
| `/api/sprints/:id/suggest` | POST | Get project suggestions |
| `/api/context/prompt` | POST | Generate agent prompt |
| `/api/context/review` | POST | Generate review prompt |
| `/api/events` | GET | SSE stream for real-time updates |

### Real-time Updates (SSE)

`GET /api/events` opens a Server-Sent Events stream. The dashboard uses this for live updates without polling. Events fire on API mutations *and* on out-of-process writes to the data dir (CLI, editor, `git pull`) via a filesystem watcher:

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
    meta.json          # Last-updated timestamp (feeds rewind detection)
    items/             # SB-001.md, DD-001.md, ...
    designs/           # SDD-001.md
    plans/             # PLAN-001.json
    sprints/           # SPRINT-001.json (projects)
    milestones/        # MILESTONE-001.json
    archive/           # Archived items
  .gitignore           # Excludes pm.pid and pm.log
  pm.pid               # Server PID (runtime, gitignored)
  pm.log               # Server log (runtime, gitignored, truncated on restart)
```

Items and SDDs are stored as markdown with YAML frontmatter. Plans, projects, and milestones are JSON. All writes are atomic (temp file + rename). Commit the data directory to git for version history and collaboration.

## Multi-Project Setup

Each project gets its own `pm.config.json` and runs its own server on a separate port:

```bash
# Project A (port 3333)
cd project-a && pm init && pm serve

# Project B (port 3334 — edit pm.config.json first)
cd project-b && pm init && pm serve
```

The CLI discovers the nearest `pm.config.json` by walking up from your current directory, so `pm list` always targets the right project. If no config is found, the CLI refuses to run (no silent fallback to a wrong server).

## License

MIT
