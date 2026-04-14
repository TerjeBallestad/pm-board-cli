# PM Board CLI

## Fixing bugs

The `pm` command runs from the **global npm install**, not this dev repo:

```
which pm  =>  ~/.nvm/.../lib/node_modules/@terjeballestad/pm-board-cli/bin/pm
```

Editing files in this repo has NO effect on the running `pm` command. After committing a fix, ask the user to publish and update:

```bash
npm version patch      # bump version
npm publish            # requires user login + OTP — agents cannot do this
pm update              # pulls the new version globally
```

**Server changes** (anything in `server.js`, `api/`, `lib/`) also require a server restart after updating:

```bash
pm serve --restart   # or kill the process and re-run pm serve
```

The server is a long-running process that caches code in memory. CLI changes take effect after `pm update`; server changes need both `pm update` and a restart.

## Architecture

- `bin/pm` — CLI entry point (argument parsing, API calls)
- `server.js` — Express server entry point
- `api/` — Route handlers (items, plans, sprints, designs)
- `lib/` — Shared utilities (store, config)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
