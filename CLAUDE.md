# PM Board CLI

## Testing

`npm test` runs integration tests via supertest against an in-process Express app, with a tmpdir-backed store per test. This is the primary verification path for route/store changes — faster and more isolated than booting a server.

- Test files live in `tests/*.test.js`, run via `node --test`.
- Use `setupTestApp()` from `tests/helpers.js`. Always pair it with `t.after(cleanup)` — `cleanup` both removes the tmpdir and calls `store.reset()`.
- **Module-state gotcha**: `lib/store.js` caches `DATA_DIR` and `data` at module scope. Calling `loadConfig()` for a different dir without `store.reset()` first is a silent no-op for paths. The helper handles this; if you stand up tests outside it, mirror that order.

For CLI behavior (arg parsing, alias resolution, output formatting), run the dev copy directly — the CLI is serverless, so it needs no server: `node bin/pm <cmd>` against a tmpdir with a `pm.config.json` — see "Fixing bugs" below.

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

- `bin/pm` — CLI entry point. Serverless by default: routes through `lib/dispatch.js` in-process. Uses HTTP only when `PM_URL` or `--server` is set.
- `server.js` — Thin entry: load config, build app, bind port
- `lib/app.js` — `createApp()` builds the Express app from loaded config. **Mount new routes here, not in `server.js`** — tests construct apps via this function. Re-reads the store on every `/api` request so the dashboard never serves stale data.
- `api/` — Route handlers. Each route body is an **exported pure `(req,res)` function** (e.g. `createDesign`) registered on the router by reference. They touch only `req.{body,query,params}` + `res.{status,json,end}`.
- `lib/dispatch.js` — In-process router: maps verb+path to the exported `api/` handlers via a mock req/res. This is what makes the CLI serverless; it shares the exact handler code with the Express server (no logic duplication).
- `lib/` — Shared utilities (store, config, app, dispatch, frontmatter, templates)
- `dashboard/` — Web UI
- `defaults/` — Default configuration templates
- `tests/` — Integration tests; `helpers.js` provides `setupTestApp()`; `dispatch.test.js` covers the serverless path.

**IDs (`store.nextId`)** are derived from `max(existing ids on disk)+1`, not a persisted counter — this is deliberate (a counter drifts across git branches / stale RAM and overwrites records). Nested plan tasks are included in the scan; batch allocation passes already-assigned ids via the second arg. Overwrite protection is the derivation itself: `max+1` over every id pool (active, archive, nested tasks, **and quarantined files**) can't collide with anything on disk, so create handlers never need a separate existence check.

**Malformed files don't brick the CLI.** A data file whose name doesn't match its embedded `id`, or that fails to parse, is **skipped with a warning** during `store.load()` (see `quarantineFile`) instead of throwing. Its filename-derived id is still added to the id pool (`allIdPools` includes `quarantined`), so a later create can't reuse the slot and overwrite the file being fixed. `store.getQuarantined()` reports what was skipped.

**Data-loss guards** (issue #1 — a `git reset` in the surrounding repo rewound the data dir unnoticed for hours):
- `autoCommit` config flag → `lib/autocommit.js`: debounced git commit of the data dir after every store write, pathspec-scoped so a data dir inside a bigger repo never commits unrelated files. Flushed on process exit and on server SIGTERM.
- Rewind detection → `lib/rewind.js` + `store.load()`: newest observed timestamp is remembered **outside** the repo (`~/.pm-board-cli/state/`, override with `PM_STATE_DIR` — tests must set it, `setupTestApp` does). If a load sees only older data, it warns loudly and `/api/health` reports `rewound`. API-driven deletes force-sync the state down so they don't false-positive.
- `pm stop` / `pm update` / `pm serve --restart` wait for the old process to actually exit (SIGKILL fallback) before rebinding the port; `server.js` drains on SIGTERM.

**When adding a route**: write the handler as an exported function, register it on the router, AND add it to the `ROUTE_TABLE` in `lib/dispatch.js` (specific paths before `:id` catch-alls) or the CLI can't reach it.
