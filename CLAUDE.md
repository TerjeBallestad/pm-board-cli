# PM Board CLI

## Fixing bugs

The `pm` command runs from the **global npm install**, not this dev repo:

```
which pm  =>  ~/.nvm/.../lib/node_modules/@terjeballestad/pm-board-cli/bin/pm
```

The global install is symlinked to this dev repo (via `npm install -g .`), so **CLI changes** (`bin/pm`) take effect immediately after saving the file.

**Server changes** (anything in `server.js`, `api/`, `lib/`) require a server restart — the server is a long-running process that caches code in memory:

```bash
pm serve --restart   # or kill the process and re-run pm serve
```

**Publishing** (`npm publish`) requires login and OTP — only the user can do this. Don't attempt it. For local development, the symlink means changes are live without publishing.

## Architecture

- `bin/pm` — CLI entry point (argument parsing, API calls)
- `server.js` — Express server entry point
- `api/` — Route handlers (items, plans, sprints, designs)
- `lib/` — Shared utilities (store, config)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
