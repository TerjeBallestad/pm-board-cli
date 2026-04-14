# PM Board CLI

## Testing changes

The `pm` command runs from the **global npm install**, not this dev repo:

```
which pm  =>  ~/.nvm/.../lib/node_modules/@terjeballestad/pm-board-cli/bin/pm
```

Editing files in this repo has NO effect on the running `pm` command unless you link first:

```bash
cd /Users/godstemning/dev/pm-board-cli
npm link
```

This symlinks the global `pm` to this dev copy. Edits to `bin/pm` take effect immediately. Undo with `npm unlink`.

**Server changes** (anything in `server.js`, `api/`, `lib/`) require a server restart after editing:

```bash
pm serve --restart   # or kill the process and re-run pm serve
```

The server runs as a background process (PID stays resident). Code changes to server files are NOT picked up until restart, even with `npm link` active.

## Architecture

- `bin/pm` — CLI entry point (argument parsing, API calls)
- `server.js` — Express server entry point
- `api/` — Route handlers (items, plans, sprints, designs)
- `lib/` — Shared utilities (store, config)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
