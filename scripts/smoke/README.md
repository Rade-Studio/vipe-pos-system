# Smoke and visual QA

- `staging-browser.mjs`: per-role smoke against a deployed staging/production (see its header).
- `app-stack.sh up|down|status` (`pnpm qa:stack up`): isolated local stack for visual QA. Its own
  `postgres:16` container `vipe-screens-db` on `127.0.0.1:55900` (`QA_DB_CONTAINER`, `QA_DB_PORT`),
  roles, migrations and `packages/db/seed/dev.sql`, then the API and `next dev` on free ports. Logs, pids
  and the web URL live in `/tmp/vipe-screens-stack` (`QA_STATE_DIR`). `down` stops only what `up` started
  (the container carries the label `vipe.qa-stack=1`). It never uses `docker-compose.yml`, so it does not
  collide with the dev stack or other worktrees. The demo seed is not loaded: `seed/demo/demo-db.sh` only
  targets the compose `db` service.
- `app-screens.mjs` (`pnpm qa:screens`): logs in each dev role (`*@vipe.local`, password `vipe-dev-2026`)
  through the login form and captures its main screen plus the admin sections at 390x844, 1024x768 and
  1440x900, light and dark. Runs the overflow check of `scripts/design-qa/qa.mjs`, records console errors
  and failed requests, and writes PNGs + `report.json` to `--out` (default `$TMPDIR/app-screens`).
  Options: `--base <url>` (default: the running app-stack), `--roles`, `--sizes`, `--themes`, `--paths`
  (admin `#hash` sections, default `overview,orders,tables,menu`). A full run takes about 2–3.5 minutes.

```sh
pnpm qa:stack up
pnpm qa:screens --out /tmp/app-screens/run1
pnpm qa:stack down
```
