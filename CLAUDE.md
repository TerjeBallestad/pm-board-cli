# PM Board CLI

## Testing

`npm test` runs integration tests via supertest against an in-process Express app, with a tmpdir-backed store per test. This is the primary verification path for route/store changes — faster and more isolated than booting a server.

- Test files live in `tests/*.test.js`, run via `node --test`.
- Use `setupTestApp()` from `tests/helpers.js`. Always pair it with `t.after(cleanup)` — `cleanup` both removes the tmpdir and calls `store.reset()`.
- **Module-state gotcha**: `lib/store.js` caches `DATA_DIR` and `data` at module scope. Calling `loadConfig()` for a different dir without `store.reset()` first is a silent no-op for paths. The helper handles this; if you stand up tests outside it, mirror that order.

For CLI behavior (arg parsing, alias resolution, output formatting), still verify by running the dev copy against a real server — see "Fixing bugs" below.

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
- `server.js` — Thin entry: load config, build app, bind port
- `lib/app.js` — `createApp()` builds the Express app from loaded config. **Mount new routes here, not in `server.js`** — tests construct apps via this function.
- `api/` — Route handlers (items, plans, sprints, designs, ...)
- `lib/` — Shared utilities (store, config, app, frontmatter, templates)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
- `tests/` — Integration tests; `helpers.js` provides `setupTestApp()`
