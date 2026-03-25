# @terjeballestad/pm-board-cli

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

`pm init` creates a `pm.config.json` and `.pm/data/` directory. The data directory stores all PM artifacts as git-trackable files (YAML frontmatter markdown for items/SDDs, JSON for plans/sprints).

## CLI Reference

```bash
# Server
pm init                          # Create pm.config.json in current directory
pm serve [--port N]              # Start dashboard server

# Items
pm issue "title"                 # Create issue
pm concern "title"               # Create concern
pm gap "title"                   # Create gap
pm decision "title"              # Create decision
pm list [--type T] [--stage S]   # List items with filters
pm get <id>                      # Get any entity by ID
pm update <id> --stage done      # Update fields
pm comment <id> "text"           # Add comment

# SDDs (Solution Design Documents)
pm sdd "title" --body "..."      # Create SDD
pm sdds                          # List all SDDs

# Plans & Tasks
pm plan create < plan.json       # Create plan from JSON
pm plans                         # List all plans
pm next-task PLAN-001            # Get next unblocked task (agent API)
pm task-done PLAN-001 TASK-001 "completed migration"

# Sprints
pm sprint                        # Get active sprint
pm sprints                       # List all sprints
pm explore SPRINT-001            # Generate sprint dossier

# Context & Prompts
pm prompt sdd SDD-001            # Generate scoped prompt for an entity
pm review sdd SDD-001            # Generate review prompt with knowledge base context
```

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

### Key API endpoints for frontend authors

| Endpoint | Description |
|----------|-------------|
| `GET /api/config` | Project name, stages, entity types |
| `GET /api/items` | List items (query: type, stage, priority, sprintId) |
| `GET /api/designs` | List SDDs |
| `GET /api/plans` | List plans |
| `GET /api/sprints` | List sprints |
| `GET /api/events` | SSE stream for real-time updates |
| `GET /api/plans/:id/next-task` | Agent-facing: get next unblocked task |

## Data Storage

All data lives in `dataDir` as git-trackable files:

```
.pm/data/
  meta.json          # ID counters
  items/             # SB-001.md, DD-001.md, ...
  designs/           # SDD-001.md
  plans/             # PLAN-001.json
  sprints/           # SPRINT-001.json
  milestones/        # MILESTONE-001.json
  archive/           # Archived items
```

Items and SDDs are stored as markdown with YAML frontmatter. Plans, sprints, and milestones are JSON. All writes are atomic (temp file + rename). Commit the data directory to git for version history and collaboration.

## Multi-Project Setup

Each project gets its own `pm.config.json` and runs its own server on a separate port:

```bash
# Project A
cd project-a && pm serve --port 3333

# Project B
cd project-b && pm serve --port 3334
```

The CLI discovers the nearest `pm.config.json` by walking up from your current directory, so `pm list` always targets the right project.

## License

MIT
