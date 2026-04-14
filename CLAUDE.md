# PM Board CLI

## Fixing bugs

The `pm` command runs from the **global npm install**, not this dev repo:

```
which pm  =>  ~/.nvm/.../lib/node_modules/@terjeballestad/pm-board-cli/bin/pm
```

Editing files in this repo has NO effect until you publish and update. After committing a fix:

```bash
cd /Users/godstemning/dev/pm-board-cli
npm version patch
npm publish
pm update              # pulls down the latest package globally
```

**Server changes** (anything in `server.js`, `api/`, `lib/`) also require a server restart after updating:

```bash
pm serve --restart   # or kill the process and re-run pm serve
```

The server runs as a background process (PID stays resident). Code changes to server files are NOT picked up until restart.

## Architecture

- `bin/pm` — CLI entry point (argument parsing, API calls)
- `server.js` — Express server entry point
- `api/` — Route handlers (items, plans, sprints, designs)
- `lib/` — Shared utilities (store, config)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
