# Design: investigar-mesa-sync-realtime

> Root-cause infra fix + bundled realtime bug fix, delivered as a single literal PR from `sdd/revision-completa-sistema/p6c-legacy-cleanup` → `main`.

---

## Root Cause

- **`postgis/postgis:16-3.4` ships no `supabase_realtime` extension** — `CREATE EXTENSION supabase_realtime` fails silently; without it, the `supabase_realtime` publication cannot exist.
- **`wal_level=replica`** (not `logical`) — Postgres refuses to emit logical replication events regardless of publication.
- **`/docker-entrypoint-initdb.d/` runs only on fresh volume** — the `supabase-db-data` volume was created before any `2025091709*` migration files existed; all 7 migrations are present on disk but never applied.
- **P1 migration written assuming the publication already existed** — `ALTER PUBLICATION supabase_realtime ADD TABLE …` would fail if applied directly to the existing volume.
- **`infra/gotrue/` Dockerfile missing** — GoTrue `v2.158.1` requires a PG-16-compatible migration patch (`id::text = user_id::text`) for the backfill email migration.
- **`subscribeToTables` double-call bug** — `WaiterView` and `TableGrid` both call `subscribeToTables` on mount; the current implementation returns a teardown that removes the channel on second call, silently dropping the first subscriber's callback.

---

## Architecture

Realtime events flow: Browser (Next.js, port 3003) → Kong (port 54321) → PostgREST (CRUD) + GoTrue (auth) + Realtime (WS via Phoenix/Elixir, port 4000). The Realtime service subscribes to Postgres logical replication slots fed by the `supabase_realtime` publication. The publication exists because the `supabase_realtime` extension is installed by `00_supabase_init.sql` on fresh volume init. `wal_level=logical` is set by the `supabase/postgres:15.8.1.085` image default for Supabase variants. All 7 migrations apply on `db reset` via `/docker-entrypoint-initdb.d` (numbered files run after `00_supabase_init.sql`).

```
Browser ──► Kong ──► PostgREST (CRUD)
                  └──► GoTrue (auth)
                  └──► Realtime (WS / Phoenix)
                              │
                              ▼
                        Postgres
                        (wal_level=logical,
                         supabase_realtime extension,
                         supabase_realtime publication)
```

---

## Infra Foundation (covers specs IF-01 / IF-02 / IF-03)

### 3.1 — Postgres Image Swap

**File**: `docker-compose.yml` — `db.service.image`

Replace `postgis/postgis:16-3.4` → `supabase/postgres:15.8.1.085`. Rationale: the Supabase-flavored image bundles `supabase_realtime` and sets `wal_level=logical` by default. Pin the exact tag — no `:latest` — so the apply phase is reproducible.

### 3.2 — `supabase/init.sql` (mounted as `00_supabase_init.sql`)

**New file**: `supabase/init.sql` — mounted to `/docker-entrypoint-initdb.d/00_supabase_init.sql` so it runs **before** the numbered migrations (`2025091709*`). Key statements (all idempotent with `CREATE OR REPLACE` / `IF NOT EXISTS`):

```sql
-- Enable the realtime extension (creates supabase_realtime publication automatically)
CREATE EXTENSION IF NOT EXISTS supabase_realtime;

-- Realtime schema (required by the realtime service)
CREATE SCHEMA IF NOT EXISTS realtime;

-- Supabase roles
DO $$
BEGIN
  CREATE ROLE authenticator WITH NOINHERIT LOGIN PASSWORD 'postgres';
  CREATE ROLE supabase_auth_admin WITH BYPASSRLS PASSWORD 'postgres';
  CREATE ROLE supabase_admin WITH BYPASSRLS PASSWORD 'postgres';
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grants
GRANT USAGE ON SCHEMA auth, public, storage TO authenticated, anon, service_role;
GRANT ALL ON SCHEMA auth, public, storage TO supabase_admin;
GRANT ALL ON SCHEMA realtime TO supabase_admin;

-- Baseline: all public tables readable/writable by authenticated
-- (individual RLS policies tighten further in migration 20250917090007)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
```

**Naming note**: `00_supabase_init.sql` must sort **before** `2025091709*` in lexical order. Postgres runs `/docker-entrypoint-initdb.d/*.sql` alphabetically. `00_` satisfies this. If there is a collision risk, prefix with `_` (e.g., `_00_supabase_init.sql`) to guarantee first position.

**Volume destruction warning**: `docker compose down -v` destroys `supabase-db-data` and `supabase-storage-data`. Data loss accepted per user confirmation.

### 3.3 — GoTrue Dockerfile + Migration Patch

**New directory**: `infra/gotrue/`

**New file**: `infra/gotrue/Dockerfile`:
```dockerfile
FROM supabase/gotrue:v2.158.1
USER root
COPY migrations/20221208132122_backfill_email_last_sign_in_at.up.sql /usr/local/etc/auth/migrations/
USER gotrue
```

**New file**: `infra/gotrue/migrations/20221208132122_backfill_email_last_sign_in_at.up.sql` — identical content to the upstream migration but uses `id::text = user_id::text` (PG 16 compatible) instead of the PG 15 `user_id = id` cast that fails on PG 16.

**Update**: `docker-compose.yml` `auth.service`:
- `build.context: ./infra/gotrue` (instead of `image: vipe-gotrue-patched:v2.158.1`)
- `GOTRUE_DB_NAMESPACE: auth` (already present in current docker-compose.yml, confirmed at line 196)

### 3.4 — JWT Regeneration

After `db reset` + first GoTrue boot, fetch fresh anon and service_role JWTs via GoTrue admin endpoint. Update `env.docker.template` `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_KEY` with the new values. Document this as a one-time bootstrap step in the PR verification recipe. `GOTRUE_JWT_SECRET` must remain stable across resets — document the exact secret value (`super-secret-jwt-token-with-at-least-32-characters-long`) and never rotate it without regenerating all client keys.

---

## Migrations Applied on `db reset`

All 7 migrations run via `/docker-entrypoint-initdb.d/` after `00_supabase_init.sql`. Apply order (confirmed by lexical sorting):

| # | Migration file | What it does |
|---|---------------|--------------|
| 1 | `20250917090000_enable_realtime_publication.sql` | `REPLICA IDENTITY FULL` on `tables`, `orders`, `order_items`; `ALTER PUBLICATION supabase_realtime ADD TABLE` for those 3 tables (now succeeds because the publication exists via extension) |
| 2 | `20250917090005_create_restaurants_and_tenant_columns.sql` | Creates `restaurants` table; adds `restaurant_id uuid REFERENCES restaurants(id)` FK to 15 tenant-scoped tables; backfills `restaurant_id` for all existing rows |
| 3 | `20250917090006_create_ingredient_transactions_orders.sql` | Creates `ingredient_transactions_orders` junction table with `UNIQUE(order_id, ingredient_transaction_id)`; adds `REFERENCES orders(id) ON DELETE CASCADE` to `order_items` |
| 4 | `20250917090007_rls_policies_and_profiles_auth_link.sql` | Enables RLS on 15 tables; writes per-tenant SELECT/INSERT/UPDATE/DELETE policies; adds `profiles.auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE`; backfills via email JOIN; adds `handle_new_user()` trigger on `auth.users` INSERT; drops `profiles.password`; removes `business_config` role-PIN rows |
| 5 | `20250917090008_complete_payment_and_delete_order_functions.sql` | `complete_payment(p_order_id, p_payment_methods, p_cash_register_id)` with `FOR UPDATE` row lock + idempotency guard; `delete_order_with_items(p_order_id)` with cascading deletes |
| 6 | `20250917090099_drop_default_anon_grants.sql` | `ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM anon, service_role`; `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated`; drops anonymous storage policies on `dishes` bucket |

---

## P2–P6 Code Lifted (from stacked branches, per `apply-progress.md`)

- **P2 RLS-aware code**: `lib/supabase/client.ts` — removes hard-coded fallback URL/key; `store/use-config-store.ts` — reflects new `profiles.auth_user_id` link.
- **P3 RPC wrappers**: `lib/supabase/service.ts` — `completePaymentRpc` / `deleteOrderRpc` wrappers with deprecation shims; `components/cashier/PaymentMethodDialog.tsx` — calls `supabase.rpc('complete_payment', ...)` directly.
- **P4 build hardening**: `.github/workflows/ci.yml` — lint + typecheck + build + pos-deps-check jobs; `next.config.mjs` — `ignoreBuildErrors: false`; `Dockerfile` — non-root user + pnpm; `eslint.config.mjs` — flat config with `next/core-web-vitals`.
- **P5 printer**: `pos/requirements.txt` — pinned deps; `pos/app.py` — service-role token + LRU dedupe + encoding negotiation; `pos/print_renderer.py` — Python shared renderer; `lib/print/renderKitchenOrder.ts` — TypeScript shared renderer.
- **P6a store split**: `store/useTableStore.ts`, `store/useCartStore.ts`, `store/useOrderStore.ts`, `store/useMenuStore.ts`, `store/useAnalyticsStore.ts` — five focused stores; `store/use-pos-store.ts` — thin shim (deleted, confirmed by apply-progress).
- **P6b React Query**: `app/layout.tsx` — `QueryClientProvider` wrapper; `lib/queryClient.ts`; `components/views/WaiterView.tsx`, `KitchenView.tsx`, `CashierView.tsx`, `AdminView.tsx` — migrated to `useQuery` + `invalidateQueries`; `store/useProfileStore.ts` — profiles store.
- **P6c legacy cleanup**: `lib/supabase-service.ts` deleted (86 files changed); `types/models.ts` deleted; `lib/log.ts` created; `components/admin/ConfigurationPanel.tsx` password tab removed.

---

## Bundled Realtime Bug Fix (covers specs R1-05 / R1-06)

### Problem

`realtime-service.ts` `subscribeToTables(callback)` is called twice on app load: once by `WaiterView` (its `useEffect`) and once by `TableGrid` (its `useEffect`, rendered inside WaiterView). The current implementation (lines 52–57) returns a teardown that calls `supabase.removeChannel` on second call, which tears down the channel created by the first call. Only the second subscriber receives events; the first is silently dropped.

### Fix

Replace the single-channel singleton with a `Map<string, ChannelEntry>` keyed by channel name. Each entry holds the `RealtimeChannel` and a `Set<callback>` so multiple callers register independently. The teardown removes only the caller's callback; the channel is closed only when the last callback deregisters.

```typescript
// lib/supabase/realtime-service.ts  (subscribeToTables only)

type ChannelEntry = {
  channel: RealtimeChannel;
  callbacks: Set<(payload: RealtimePostgresChangesPayload<any>) => void>;
};

const channels = new Map<string, ChannelEntry>();

subscribeToTables: (callback: TableCallback, role = "waiter") => {
  const key = roleChannelName("tables", role);  // "tables-waiter"
  let entry = channels.get(key);

  if (!entry) {
    entry = {
      channel: supabase.channel(key),
      callbacks: new Set(),
    };
    entry.channel
      .on("postgres_changes", { event: "*", schema: "public", table: "tables" }, (payload) => {
        entry!.callbacks.forEach(cb => cb(payload));
      })
      .subscribe();
    channels.set(key, entry);
  }

  entry.callbacks.add(callback);
  realtimeService.isConnected = true;

  return () => {
    entry!.callbacks.delete(callback);
    if (entry!.callbacks.size === 0) {
      entry!.channel.unsubscribe();
      channels.delete(key);
    }
  };
},
```

### Verification

Two-tab test (documented in PR verification recipe):
1. Open browser tab A at `http://localhost:3003`; log in as `tester@restaurant.com`.
2. Open browser tab B at `http://localhost:3003`; log in as the same user.
3. In tab A, flip table 5 to `occupied`.
4. Tab B `TableGrid` updates within ~500 ms — both `WaiterView` and `TableGrid` handlers fire.
5. Close tab A; tab B continues receiving events normally.

---

## Commit Slicing

Following `work-unit-commits`: each commit is one deliverable behavior, compilable independently, with tests/docs in the same commit.

| # | Subject | Files | What the commit delivers |
|---|---------|-------|--------------------------|
| 1 | `infra: swap postgres image + add init.sql + gotrue Dockerfile` | `docker-compose.yml`, `supabase/init.sql` (new), `infra/gotrue/Dockerfile` (new), `infra/gotrue/migrations/20221208132122_backfill_email_last_sign_in_at.up.sql` (new) | Infra foundation: correct image, init roles/extensions, patched GoTrue |
| 2 | `feat(supabase): realtime publication + tenant tables` | `supabase/migrations/20250917090000*.sql`, `20250917090005*.sql`, `20250917090006*.sql` | P1 publication + P2 restaurants + P3 junction table |
| 3 | `feat(supabase): RLS policies + profiles auth link + payment RPCs + drop anon grants` | `supabase/migrations/20250917090007*.sql`, `20250917090008*.sql`, `20250917090099*.sql` | P2 RLS + auth trigger + P3 payment fns + anon hardening |
| 4 | `feat(auth): seed users with bcrypt hashes for all 4 roles` | `supabase/seed.sql` | 4 seed users (admin/cashier/waiter/kitchen) with bcrypt hashes |
| 5 | `feat(hooks): migrate POS views to React Query` | `app/layout.tsx`, `lib/queryClient.ts`, `components/views/WaiterView.tsx`, `KitchenView.tsx`, `CashierView.tsx`, `AdminView.tsx`, `store/useProfileStore.ts` | P6b React Query migration |
| 6 | `refactor(store): split usePOSStore into focused stores` | `store/useTableStore.ts`, `useCartStore.ts`, `useOrderStore.ts`, `useMenuStore.ts`, `useAnalyticsStore.ts` | P6a store split |
| 7 | `refactor(views): migrate views to useQuery` | `components/views/WaiterView.tsx`, `KitchenView.tsx`, `CashierView.tsx`, `AdminView.tsx` (refined from commit 5) | P6b view refinement |
| 8 | `fix(realtime): subscribeToTables multi-callback bug` | `lib/supabase/realtime-service.ts` | R1-06: Map-based multi-callback channel registry |
| 9 | `chore: delete legacy files, add lib/log.ts` | `lib/supabase-service.ts` (del), `types/models.ts` (del), `lib/log.ts` (new), `components/admin/ConfigurationPanel.tsx` | P6c legacy deletion + logging |
| 10 | `docs: regenerate apply-progress` | `openspec/changes/revision-completa-sistema/apply-progress.md` | Updated to reflect all PRs as merged |

---

## Apply Path (single PR → `main`)

The PR lands on `main`. Apply phase (documented for the PR description verification recipe):

```bash
# 1. Fetch + checkout the PR
git fetch origin
gh pr checkout <PR-number>

# 2. Destroy old volumes (data loss — accepted)
docker compose down -v

# 3. Rebuild images (includes infra/gotrue/ + vipe-pos-app Dockerfile)
docker compose build

# 4. Start fresh — init.sql runs first, then all 7 migrations
docker compose up -d

# 5. Wait for auth to be healthy
until curl -sf http://localhost:54321/auth/v1/health; do sleep 1; done

# 6. Apply seed data
docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql

# 7. Verify publication
docker exec supabase-db psql -U postgres -d postgres \
  -c "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'"

# 8. Two-tab realtime test (R1-05)
# Open http://localhost:3003 in two tabs; log in as tester@restaurant.com
# Flip table 5 to occupied in tab A; tab B updates within ~500ms
```

**Expected outputs per step**:

| Step | Success | Failure mode |
|------|---------|-------------|
| `docker compose build` | Exit 0 | `infra/gotrue/Dockerfile` missing migration file; image tag not found |
| Auth health | HTTP 200 | GoTrue pod crash; `GOTRUE_DB_NAMESPACE` mismatch |
| `pg_publication_tables` | Lists `tables`, `orders`, `order_items` | `supabase_realtime` extension not installed (wrong image) |
| Two-tab test | Tab B updates < 500ms | Channel subscription broken; publication empty |

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|------------|
| 1 | `infra/gotrue/Dockerfile` assumes migration file at exact path inside image | Medium | Extract original image (`docker pull supabase/gotrue:v2.158.1`) and `docker run --rm` to inspect `/usr/local/etc/auth/migrations/` before writing the Dockerfile |
| 2 | `00_supabase_init.sql` naming collision with `202505*` existing migrations | Low | Name with leading `_` → `_00_supabase_init.sql` to guarantee lexical sort before any `2025*` file |
| 3 | `supabase/postgres:15.8.1.085` tag does not exist | Low | Verify pull succeeds before PR: `docker pull supabase/postgres:15.8.1.085`; fallback to `supabase/postgres:15.6.1.135` if needed |
| 4 | `GOTRUE_JWT_SECRET` instability across db resets | High | Document exact value (`super-secret-jwt-token-with-at-least-32-characters-long`) in verification recipe; never regenerate without also regenerating all client anon keys |
| 5 | Image pull ~500 MB on slow connection | Medium | Gate on image presence: `docker image inspect supabase/postgres:15.8.1.085 > /dev/null && echo "present"` before `docker compose up` |
| 6 | `subscribeToTables` bug bundled — two-tab test gates merge | High | Test is in the PR verification recipe; CI cannot run it; must be verified manually before merge |

---

## Threat Matrix

**N/A** — no routing, shell commands, subprocesses, VCS/PR automation, executable-file classification, or process-integration boundary is introduced by this change. All changes are declarative (SQL, YAML, Dockerfile, TypeScript). No shell commands are run at runtime by this code.

---

## Out of Scope

- New features beyond the 9-phase consolidation
- Multi-tenant UI (P2 schema and RLS land; admin UI for tenant management is separate)
- P4 hardening beyond the realtime infra fix (P4 CI/build work is included as a code lift, not new hardening)
- Archiving `revision-completa-sistema` (separate `sdd-archive` after merge)

---

## Open Questions

None. All four open questions from `exploration.md` were answered by the user before this design was written:
1. "un único PR" — confirmed literal single PR.
2. DB data loss — accepted (`docker compose down -v` is required).
3. Docker pull — network access available.
4. Uncommitted docker-compose change (`vipe-gotrue-patched:v2.158.1`) — committed as part of this PR via `infra/gotrue/Dockerfile`.
