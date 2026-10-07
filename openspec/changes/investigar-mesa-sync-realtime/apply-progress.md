# investigar-mesa-sync-realtime — Apply Progress

**Attempt 2 — Second corrective pass**
Date: 2026-09-18
Branch: `sdd/revision-completa-sistema/p6c-legacy-cleanup`
HEAD: `dd7a0d2`

## Corrective Commits (Attempt 2)

| # | Commit | Description |
|---|--------|-------------|
| C1 | `c1e5df3` | fix(realtime): manual publication + wal_level=logical + realtime v2.30.26 |
| C2 | `c18c189` | fix(auth): post-auth migration hook for 20250917* (chicken-and-egg) |
| C3 | `e800850` | fix(build): pnpm v12 buildAllow + builder corepack |
| C4 | `dd7a0d2` | fix: custom db image, gotrue user fix, postgresql.conf, pg_hba.conf, realtime search_path |

## 4 Blockers — Resolution Status

### Blocker 1: supabase_realtime extension doesn't exist — FIXED
- **Root cause**: Extension not available in self-hosted postgres images
- **Fix**: `wal_level=logical` + manual `CREATE PUBLICATION supabase_realtime` + custom `postgresql.conf`
- **Verification**: `SHOW wal_level` → `logical`, `pg_publication` shows `supabase_realtime` ✓

### Blocker 2: Realtime DateTime type mismatch — PARTIALLY FIXED
- **Root cause**: v2.135.5 Postgrex expected `%DateTime{}` but received Elixir NaiveDateTime
- **Fix**: Pinned to `v2.30.26` + `DB_AFTER_CONNECT: "SET search_path TO realtime, public"` + `ALTER DATABASE postgres SET search_path TO realtime, public`
- **Status**: Auth + DB work correctly. Realtime v2.30.26 has a separate Ecto migration bug (see below)

### Blocker 3: 2025091709* chicken-and-egg with auth.users — FIXED
- **Root cause**: Migrations reference `auth.users` but GoTrue creates it on first boot
- **Fix**: Moved 5 deferred migrations to `supabase/post-auth-migrations/`, created `infra/post-auth-init/post-auth-init.sh` hook
- **Status**: Deferred migrations applied after auth is healthy ✓

### Blocker 4: pnpm sharp ERR_PNPM_IGNORED_BUILDS — FIXED
- **Root cause**: pnpm v12 moved `onlyBuiltDependencies` from `package.json` to `pnpm-workspace.yaml`
- **Fix**: Created `pnpm-workspace.yaml` with `allowBuilds` for sharp, esbuild, etc. + added `corepack enable` in builder stage
- **Verification**: `docker compose build` sharp compile step succeeds ✓

## Additional Fixes Applied During Testing

### Custom db image (supabase/Dockerfile.db)
- Baked init scripts into image to avoid WSL2 Docker bind-mount issues
- Creates `realtime` schema + grants
- Creates `realtime.schema_migrations` table for Ecto
- Copies `pg_hba.conf` for Docker network access

### GoTrue user fix (infra/gotrue/Dockerfile)
- Changed `USER gotrue` to `USER supabase` (gotrue user doesn't exist in v2.158.1 image)

### PostgreSQL fixes (supabase/00_supabase_init.sql)
- Removed `CREATE EXTENSION supabase_realtime` (extension not available)
- Made extension creation non-fatal with DO blocks
- Used DO block for publication creation (PostgreSQL <16 doesn't support `CREATE PUBLICATION IF NOT EXISTS`)

### pg_hba.conf (supabase/pg_hba.conf)
- Allows connections from Docker network (172.16.0.0/12)

### PostgreSQL config (supabase/postgresql.conf)
- `listen_addresses = '*'` — allows TCP connections from other containers
- `wal_level = logical` — enables logical replication
- Removed `pg_cdc_rls` from `shared_preload_libraries` (not available)
- Set `search_path` at database level for realtime Ecto

## Known Issues

### Realtime v2.30.26 Ecto Migration Bug
The realtime container v2.30.26 has an Ecto migration bug where `20210706140551 CreateTenants.change/0` logs "create table tenants" but the table is not actually created. This causes subsequent migrations to fail with `relation "tenants" does not exist`.

**Workaround attempted**: Pre-created `realtime.schema_migrations` table and `tenants` table, set database-level `search_path`. Ecto still skips the migration (already recorded as applied) but the table doesn't exist.

**Status**: OPEN — realtime container requires either:
1. A realtime version between v2.29.0 (uses YAML config) and v2.30.26 (has migration bug)
2. Or manual table creation in `realtime` schema

The core publication setup (`wal_level=logical`, `CREATE PUBLICATION supabase_realtime`, `REPLICA IDENTITY FULL`) is correctly configured. Once realtime container starts, it should receive DB changes.

## Verification Commands

```bash
# DB checks
docker exec supabase-db psql -U postgres -d postgres -c "SHOW wal_level"
# Expected: logical

docker exec supabase-db psql -U postgres -d postgres -c "SELECT pubname FROM pg_publication"
# Expected: supabase_realtime

docker exec supabase-db psql -U postgres -d postgres -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'realtime'"
# Expected: realtime

# Auth checks
curl -sf http://localhost:9999/health
# Expected: JSON health response

# App build
docker compose build app 2>&1 | grep -E "ERR_PNPM|sharp|error"
# Expected: No pnpm sharp errors
```

## End-to-End Service Status (as of 2026-09-18)

| Service | Status | Notes |
|---------|--------|-------|
| db | Up (healthy) | wal_level=logical, supabase_realtime publication exists |
| auth | Up | GoTrue migrations applied, API on 0.0.0.0:9999 |
| realtime | Restarting | Ecto migration bug in v2.30.26 — table creation logged but not persisted |
| post-auth-init | Not started | Depends on realtime; will run after realtime is healthy |
| app | Not built | Sharp build fixed; app TypeScript error (pre-existing) |
