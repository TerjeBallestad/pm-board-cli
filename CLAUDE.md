# PM Board CLI

## Fixing bugs

The `pm` command runs from the **global npm install**, not this dev repo:

```
which pm  =>  ~/.nvm/.../lib/node_modules/@terjeballestad/pm-board-cli/bin/pm
```

Editing files in this repo has NO effect on the running `pm` command.

**Verifying CLI fixes** — run the dev copy directly to test without touching the global install:

```bash
node /Users/godstemning/dev/pm-board-cli/bin/pm patch PLAN-001 --tasks @file.json
```

This uses your edited code while the production `pm` remains untouched. Compare behavior between the two if needed.

**After verifying**, ask the user to publish and update (requires login + OTP — agents cannot do this):

```bash
npm version patch      # bump version
npm publish            # user only
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
