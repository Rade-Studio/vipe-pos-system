# Delta for Build and Infrastructure Safety (P4) — investigar-mesa-sync-realtime

## Purpose

Fix the GoTrue auth service migration compatibility (PG 16 fix) and complete the Docker Compose image swap as part of the realtime infra fix. Broader P4 hardening (CI gating, non-root containers, pnpm in Dockerfile, `.github/workflows/ci.yml`) is OUT OF SCOPE for this PR per the proposal's Out of Scope section.

## ADDED Requirements

### Requirement: R4-01 — GoTrue Uses Patched Local Dockerfile

The GoTrue auth service MUST build from `infra/gotrue/Dockerfile` — a locally patched rebuild of `supabase/gotrue:v2.158.1`.

The patch targets `migrations/20221208132122_backfill_email_last_sign_in_at.up.sql` which uses `user_id = id` (UUID text comparison) that fails on PostgreSQL 16. The patched version uses `id::text = user_id::text`.

`docker-compose.yml` gotrue service MUST use `build: ./infra/gotrue` and set `GOTRUE_DB_NAMESPACE: auth`.

#### Scenario: R4-01-S1 — Patched Gotrue image builds

- GIVEN `infra/gotrue/Dockerfile` exists
- WHEN `docker build -t vipe-gotrue-patched:v2.158.1 ./infra/gotrue/` is executed on this host
- THEN the build exits with code 0
- AND no PG 16 migration error appears

#### Scenario: R4-01-S2 — docker-compose uses local build with correct namespace

- GIVEN `docker compose config` is run
- THEN the gotrue service shows `build: ./infra/gotrue`
- AND `GOTRUE_DB_NAMESPACE=auth` is set in the service environment

### Requirement: R4-02 — Docker Compose Uses Supabase Postgres Image

`docker-compose.yml` `db` service MUST use `supabase/postgres:15.8.1.085` as its image. The `postgis/postgis:16-3.4` image MUST NOT be used.

The `db` service MUST run with `wal_level=logical`.

#### Scenario: R4-02-S1 — Correct Postgres image in use

- GIVEN `docker inspect $(docker compose ps -q db) --format '{{.Config.Image}}'` is run
- THEN the output contains `supabase/postgres`
- AND does NOT contain `postgis/postgis`

#### Scenario: R4-02-S2 — WAL level is logical

- GIVEN the db container is running
- WHEN `docker exec supabase-db psql -U postgres -c "SHOW wal_level"` is run
- THEN the output is `logical`

## OUT OF SCOPE (Not in this PR)

The following P4 requirements from `revision-completa-sistema` are deliberately NOT included in this single-PR change:

- TypeScript `ignoreBuildErrors: false` blocking build (R4-01 in revision-completa-sistema)
- ESLint `ignoreDuringBuilds: false` blocking build (R4-02 in revision-completa-sistema)
- `.github/workflows/ci.yml` CI workflow (R4-03)
- Non-root container user (R4-04)
- pnpm in Dockerfile (R4-05)
- `app` waiting for `realtime` healthy (R4-06)
- Package rename to `vipe-pos-system` (R4-07)

These items are tracked as follow-up work after the realtime fix lands.

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Build | `docker build ./infra/gotrue/` MUST succeed on the development machine before PR opens |
| Image pull | `supabase/postgres:15.8.1.085` MUST be pulled before `docker compose up -d` is run; gate on image presence |
