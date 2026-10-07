# Delta for Infra Foundation (investigar-mesa-sync-realtime)

## Purpose

Fix the root-cause infrastructure blockers that prevent Supabase Realtime from functioning: wrong Postgres image (no `supabase_realtime` extension), missing `wal_level=logical`, absent Supabase roles/schema, and broken GoTrue migration. All 7 `2025091709*` migrations require this infra to be in place before they can apply.

## ADDED Requirements

### Requirement: IF-01 — Postgres Base Image Bundles supabase_realtime Extension

The system MUST use `supabase/postgres:15.8.1.085` (or equivalent that bundles the `supabase_realtime` extension) as the database image. The current `postgis/postgis:16-3.4` image does NOT bundle it, which is why the `supabase_realtime` publication cannot be created and WAL logical replication is unavailable.

`docker-compose.yml` `image:` for the `db` service MUST be `supabase/postgres:15.8.1.085`.

The container MUST be started with `wal_level=logical` (not `replica`).

#### Scenario: IF-01-S1 — Realtime extension present in image

- GIVEN `docker compose up -d` has completed
- WHEN `docker exec supabase-db psql -U postgres -d postgres -c "SELECT extname FROM pg_extension WHERE extname='supabase_realtime'"` is run
- THEN exactly 1 row is returned
- AND `extname = supabase_realtime`

#### Scenario: IF-01-S2 — WAL level is logical

- GIVEN the `db` container is running
- WHEN `docker exec supabase-db psql -U postgres -c "SHOW wal_level"` is run
- THEN the result is `logical`
- AND not `replica`

### Requirement: IF-02 — Init.sql Mounts Supabase Roles, Grants, and Extensions on Fresh Volume

A `supabase/init.sql` file MUST be mounted to `/docker-entrypoint-initdb.d/` so that on a fresh (empty) volume, Postgres is initialized with the Supabase auth/admin roles, the `supabase_realtime` extension, the `supabase_realtime` publication, and the necessary grants. This script runs exactly once when the volume is first created.

The init.sql MUST create or ensure: `authenticator`, `supabase_auth_admin`, `supabase_admin`, `anon`, `authenticated`, `service_role` roles; `supabase_realtime` extension; `supabase_realtime` publication including `tables`, `orders`, `order_items`, `cash_registers`, `cash_transactions`, `payment_transactions`.

#### Scenario: IF-02-S1 — Supabase roles exist after fresh reset

- GIVEN `docker compose down -v && docker compose up -d` has completed with a fresh volume
- WHEN `docker exec supabase-db psql -U postgres -c "SELECT rolname FROM pg_roles WHERE rolname IN ('authenticator','supabase_auth_admin','supabase_admin','anon','authenticated','service_role')"` is run
- THEN 6 rows are returned
- AND all six role names are present

#### Scenario: IF-02-S2 — supabase_realtime schema and publication exist

- GIVEN the stack is up with a fresh volume
- WHEN `docker exec supabase-db psql -U postgres -c "SELECT nspname FROM pg_namespace WHERE nspname='supabase_realtime'"` is run
- THEN 1 row is returned
- AND `SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'` returns 1 row
- AND `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'` includes `tables`, `orders`, `order_items`

### Requirement: IF-03 — GoTrue Auth Service Builds from Local Dockerfile with Patched Migration

The auth service MUST build from `infra/gotrue/Dockerfile` — a locally rebuilt image of `supabase/gotrue:v2.158.1` that includes a patched `20221208132122_backfill_email_last_sign_in_at.up.sql` migration using `id::text = user_id::text` for PostgreSQL 16 compatibility.

`docker-compose.yml` gotrue service MUST use `build: ./infra/gotrue` instead of a remote image, and MUST set `GOTRUE_DB_NAMESPACE: auth`.

#### Scenario: IF-03-S1 — Patched Gotrue image builds successfully

- GIVEN `infra/gotrue/Dockerfile` exists in the repo
- WHEN `docker build -t vipe-gotrue-patched:v2.158.1 ./infra/gotrue/` is run
- THEN the build exits with code 0
- AND no migration error appears in the build log

#### Scenario: IF-03-S2 — GOTRUE_DB_NAMESPACE is set to auth

- GIVEN the stack is up after the image swap
- WHEN `docker exec supabase-gotrue env | grep GOTRUE_DB_NAMESPACE` is run
- THEN `GOTRUE_DB_NAMESPACE=auth` is returned
- AND the env var is present without manual docker-compose override

#### Scenario: IF-03-S3 — Gotrue health endpoint returns 200

- GIVEN the stack is fully up
- WHEN `curl -s http://localhost:54321/auth/v1/health` is run
- THEN the HTTP status code is 200
- AND the response body indicates the service is healthy

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Image size | `supabase/postgres:15.8.1.085` is ~500 MB; plan for network pull on first run |
| Init idempotency | Init.sql script MUST be idempotent (use `CREATE OR REPLACE` / `IF NOT EXISTS`) — it runs only on fresh volume but handles re-run safely |
| Data loss | `docker compose down -v` destroys all DB data — accepted pre-merge per user confirmation |

## MIGRATION / ROLLBACK

**Migration**: `docker compose down -v && docker compose up -d` (fresh volume + init.sql runs automatically)

**Rollback**: `git revert` restores `postgis/postgis:16-3.4` in docker-compose.yml; `docker compose down -v && up -d` reverts infra state; DB data is lost.

## OUT OF SCOPE

- Application-level migrations (P2–P6)
- React Query migration
- Store split
- Printer listener
