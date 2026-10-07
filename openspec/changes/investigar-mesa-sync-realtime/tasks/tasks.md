# Tasks: investigar-mesa-sync-realtime

> Single literal PR from `sdd/revision-completa-sistema/p6c-legacy-cleanup` → `main`. `size:exception` granted by user-as-maintainer.
>
> **Apply path**: `db reset` → seed → two-tab verification.
> **Sequencing**: Tasks are numbered globally and grouped by commit. Each commit is independently buildable.

---

## Commit 1 — Infra foundation

### T1.1 — Create `infra/gotrue/Dockerfile`

- **description**: Add `infra/gotrue/Dockerfile` based on `supabase/gotrue:v2.158.1`, switches to `USER root` to copy the patched migration, then back to `USER gotrue`. Resolves GoTrue PG-16 cast incompatibility (`id::text = user_id::text`).
- **files**: [`infra/gotrue/Dockerfile`]
- **command(s)**: `docker build -t vipe-gotrue-patched:v2.158.1 ./infra/gotrue/`
- **acceptance_criteria**: [a] build exits 0; [b] image tagged `vipe-gotrue-patched:v2.158.1`; [c] no migration error in build log; [d] final `USER` is `gotrue`.

### T1.2 — Create `infra/gotrue/migrations/20221208132122_backfill_email_last_sign_in_at.up.sql`

- **description**: Copy of upstream migration with `id::text = user_id::text` cast fix for PG-16 compatibility. Required by GoTrue v2.158.1 migration runner.
- **files**: [`infra/gotrue/migrations/20221208132122_backfill_email_last_sign_in_at.up.sql`]
- **command(s)**: `docker run --rm --entrypoint ls vipe-gotrue-patched:v2.158.1 -la /usr/local/etc/auth/migrations/` (file present)
- **acceptance_criteria**: [a] file present in image at expected path; [b] uses `id::text = user_id::text`; [c] GoTrue container stays healthy after boot.

### T1.3 — Create `supabase/00_supabase_init.sql`

- **description**: New init script mounted to `/docker-entrypoint-initdb.d/00_supabase_init.sql` that runs **before** the `2025091709*` migrations on fresh volume. Creates Supabase roles (`authenticator`, `supabase_auth_admin`, `supabase_admin`, `anon`, `authenticated`, `service_role`), enables `supabase_realtime` extension, creates `realtime` schema, and applies baseline grants.
- **files**: [`supabase/00_supabase_init.sql`]
- **command(s)**: `docker compose down -v && docker compose up -d` → `docker exec supabase-db psql -U postgres -c "SELECT rolname FROM pg_roles WHERE rolname IN ('authenticator','supabase_auth_admin','supabase_admin','anon','authenticated','service_role')"`
- **acceptance_criteria**: [a] 6 roles returned after fresh reset; [b] `supabase_realtime` extension present; [c] all statements idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS`); [d] script runs before any `2025091709*` file.

### T1.4 — Update `docker-compose.yml`

- **description**: Replace `db.image: postgis/postgis:16-3.4` with `supabase/postgres:15.8.1.085`; mount `supabase/00_supabase_init.sql` to `/docker-entrypoint-initdb.d/`; replace `auth.image: vipe-gotrue-patched:v2.158.1` with `build.context: ./infra/gotrue`; set `GOTRUE_DB_NAMESPACE: auth`.
- **files**: [`docker-compose.yml`]
- **command(s)**: `docker compose config` (lists expected services + build context); `docker compose build`
- **acceptance_criteria**: [a] `db.image == supabase/postgres:15.8.1.085`; [b] `auth.build.context == ./infra/gotrue`; [c] `GOTRUE_DB_NAMESPACE=auth` present; [d] `docker compose build` exits 0.

### T1.5 — Verify infra foundation

- **description**: After Commit 1 lands, sanity check the infra: image pulls, container boots, auth health endpoint returns 200, WAL level is `logical`.
- **files**: N/A (verification only)
- **command(s)**: `docker image inspect supabase/postgres:15.8.1.085 > /dev/null && echo present`; `docker compose up -d`; `until curl -sf http://localhost:54321/auth/v1/health; do sleep 1; done`; `docker exec supabase-db psql -U postgres -c "SHOW wal_level"`
- **acceptance_criteria**: [a] image present locally; [b] auth health returns 200; [c] `wal_level == logical`; [d] no GoTrue crash logs.

---

## Commit 2 — Realtime publication + tenant tables

### T2.1 — `20250917090000_enable_realtime_publication.sql`

- **description**: Set `REPLICA IDENTITY FULL` on `public.tables`, `public.orders`, `public.order_items`; `ALTER PUBLICATION supabase_realtime ADD TABLE` for those three. Succeeds only because Commit 1 created the publication via the extension.
- **files**: [`supabase/migrations/20250917090000_enable_realtime_publication.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'"`
- **acceptance_criteria**: [a] migration applies on `db reset`; [b] output includes `tables`, `orders`, `order_items`; [c] `pg_class.relreplident == 'f'` for each table.

### T2.2 — `20250917090005_create_restaurants_and_tenant_columns.sql`

- **description**: Creates `restaurants` table + adds `restaurant_id uuid REFERENCES restaurants(id)` FK to 15 tenant-scoped tables; seeds one restaurant; backfills `restaurant_id` on existing rows.
- **files**: [`supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "\d orders"` (lists `restaurant_id`); same for every tenant table
- **acceptance_criteria**: [a] migration applies; [b] all 15 tenant tables have `restaurant_id` column; [c] one seed restaurant row exists; [d] idempotent on re-run.

### T2.3 — `20250917090006_create_ingredient_transactions_orders.sql`

- **description**: Creates the `ingredient_transactions_orders` junction table with `UNIQUE(order_id, ingredient_transaction_id)` and cascading FKs to `orders` and `ingredient_transactions`. Adds `REFERENCES orders(id) ON DELETE CASCADE` to `order_items.order_id`.
- **files**: [`supabase/migrations/20250917090006_create_ingredient_transactions_orders.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "\d ingredient_transactions_orders"`; `docker exec supabase-db psql -U postgres -d postgres -c "\d order_items"`
- **acceptance_criteria**: [a] junction table exists with both FKs; [b] unique constraint present; [c] `order_items.order_id` shows `ON DELETE CASCADE`.

### T2.4 — Verify publication + schema

- **description**: Confirm after `db reset` that the publication contains the three realtime tables and the new schema additions are present.
- **files**: N/A (verification only)
- **command(s)**: same as T2.1 + `\d` checks from T2.2/T2.3
- **acceptance_criteria**: [a] 3+ rows in `pg_publication_tables`; [b] 15 tables have `restaurant_id`; [c] junction table + cascade FK present.

---

## Commit 3 — RLS + profiles auth link + payment RPCs + grants

### T3.1 — `20250917090007_rls_policies_and_profiles_auth_link.sql`

- **description**: Enables RLS on 15 tables, writes per-tenant SELECT/INSERT/UPDATE/DELETE policies, adds `profiles.auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE` with email-based backfill, creates `handle_new_user()` trigger on `auth.users` INSERT, drops `profiles.password`, drops `business_config.*_password` role-PIN columns.
- **files**: [`supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true"`; `docker exec supabase-db psql -U postgres -d postgres -c "\d profiles"`; `docker exec supabase-db psql -U postgres -d postgres -c "\d business_config"`
- **acceptance_criteria**: [a] RLS enabled on every public table except `restaurants`; [b] `profiles` no longer has `password` column; [c] `business_config` no longer has `*_password` columns; [d] `auth_user_id` populated on existing seed profiles.

### T3.2 — `20250917090008_complete_payment_and_delete_order_functions.sql`

- **description**: Creates `public.complete_payment(p_order_id uuid, p_payment_methods text[], p_cash_register_id uuid) RETURNS jsonb` with `SELECT ... FOR UPDATE` + idempotency guard, and `public.delete_order_with_items(p_order_id uuid) RETURNS void` with cascading deletes. Both `SECURITY DEFINER`.
- **files**: [`supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "SELECT proname FROM pg_proc WHERE proname IN ('complete_payment','delete_order_with_items')"`
- **acceptance_criteria**: [a] both functions exist; [b] `complete_payment` idempotent (second call returns `already_paid`); [c] `delete_order_with_items` removes order + items + junction rows in one transaction.

### T3.3 — `20250917090099_drop_default_anon_grants.sql`

- **description**: `ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM anon, service_role`; grants `SELECT, INSERT, UPDATE, DELETE` on tables + `USAGE, SELECT` on sequences to `authenticated`. Drops anonymous storage policies on `dishes` bucket.
- **files**: [`supabase/migrations/20250917090099_drop_default_anon_grants.sql`]
- **command(s)**: `docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM pg_default_acl WHERE grantee='anon'"` (expect zero); anon-key upload attempt returns 400
- **acceptance_criteria**: [a] no default ACL for `anon`; [b] anon storage upload fails; [c] `authenticated` retains CRUD on tables.

### T3.4 — Verify RLS + payment RPCs

- **description**: Cross-check that the column drops and function creations are reflected in `\d` output.
- **files**: N/A (verification only)
- **command(s)**: `\d profiles`; `\d business_config`; `SELECT proname FROM pg_proc WHERE proname IN ('complete_payment','delete_order_with_items')`
- **acceptance_criteria**: [a] `profiles.password` absent; [b] `business_config.*_password` absent; [c] both functions present.

---

## Commit 4 — Auth seed with bcrypt hashes

### T4.1 — Rewrite `supabase/seed.sql` with bcrypt hashes

- **description**: Insert 4 role users (`admin@restaurant.com`, `cashier@restaurant.com`, `waiter@restaurant.com`, `kitchen@restaurant.com`) plus the existing `tester@restaurant.com` test user into `auth.users` using `crypt('...', gen_salt('bf'))` for the password hash. Create matching `profiles` rows with role + `restaurant_id` link.
- **files**: [`supabase/seed.sql`]
- **command(s)**: `docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql`; `docker exec supabase-db psql -U postgres -d postgres -c "SELECT email FROM auth.users"`; `curl -X POST http://localhost:54321/auth/v1/token?grant_type=password -d '{"email":"admin@restaurant.com","password":"admin123"}'`
- **acceptance_criteria**: [a] 5 rows in `auth.users`; [b] `signInWithPassword` returns valid JWT for each role user; [c] `profiles.auth_user_id` populated for every seed user; [d] no plaintext passwords in seed file.

---

## Commit 5 — React Query migration (P6b)

### T5.1 — `app/layout.tsx` + `lib/queryClient.ts`

- **description**: Create `QueryClient` with `staleTime: 30_000`, `refetchOnWindowFocus: false`, `retry: 2`. Wrap `{children}` in `<QueryClientProvider client={queryClient}>`. Add `devtools` behind `NODE_ENV !== 'production'`.
- **files**: [`app/layout.tsx`, `lib/queryClient.ts`]
- **command(s)**: `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] `<QueryClientProvider>` wraps the tree; [b] `staleTime` set; [c] DevTools visible in dev only; [d] `tsc --noEmit` exit code delta vs baseline documented.

### T5.2 — Migrate `hooks/use-realtime-*.ts` to `useQuery` + `invalidateQueries`

- **description**: Convert realtime hooks from `useEffect` loaders to `useQuery` subscriptions; realtime events call `queryClient.invalidateQueries(...)` instead of re-fetching via the legacy service.
- **files**: [`hooks/use-realtime-*.ts`]
- **command(s)**: `pnpm tsc --noEmit`; `grep -r "useEffect.*loadTables\|useEffect.*loadOrders" hooks/`
- **acceptance_criteria**: [a] no `useEffect` loaders remain in realtime hooks; [b] realtime event triggers `invalidateQueries`; [c] no flicker on refetch.

---

## Commit 6 — Store split (P6a)

### T6.1 — Create focused stores

- **description**: Create `store/useTableStore.ts`, `store/useCartStore.ts`, `store/useOrderStore.ts`, `store/useMenuStore.ts`, `store/useAnalyticsStore.ts`. Each holds UI/draft state only — server state flows via React Query from Commit 5.
- **files**: [`store/useTableStore.ts`, `store/useCartStore.ts`, `store/useOrderStore.ts`, `store/useMenuStore.ts`, `store/useAnalyticsStore.ts`]
- **command(s)**: `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] 5 stores created; [b] each exports its hook + typed state; [c] no cross-imports between them; [d] `tsc --noEmit` exits 0.

### T6.2 — Migrate view components to new stores

- **description**: Update `components/views/WaiterView.tsx`, `CashierView.tsx`, `KitchenView.tsx`, `AdminView.tsx` to consume the focused stores instead of `usePOSStore`.
- **files**: [`components/views/WaiterView.tsx`, `components/views/CashierView.tsx`, `components/views/KitchenView.tsx`, `components/views/AdminView.tsx`]
- **command(s)**: `pnpm tsc --noEmit`; `grep -r "usePOSStore" components/views/`
- **acceptance_criteria**: [a] zero `usePOSStore` references in views; [b] all four views compile; [c] functional behavior unchanged (manual smoke test).

### T6.3 — Defer deletion of `use-pos-store.ts`

- **description**: This commit only CREATES the new stores and migrates callers. `store/use-pos-store.ts` is deleted in Commit 9 per the P6c ordering.
- **files**: N/A (deferral note)
- **command(s)**: N/A
- **acceptance_criteria**: [a] `use-pos-store.ts` still exists; [b] removal scheduled for Commit 9.

---

## Commit 7 — Views migrate to useQuery (P6b cont.)

### T7.1 — Finish `WaiterView.tsx` useQuery migration

- **description**: Per `apply-progress.md`, `WaiterView` is mostly migrated; finish any remaining `useEffect` loaders and ensure the realtime invalidation path is intact.
- **files**: [`components/views/WaiterView.tsx`]
- **command(s)**: `grep "useEffect.*load" components/views/WaiterView.tsx` (zero data-loader matches); `pnpm dev` smoke
- **acceptance_criteria**: [a] no `useEffect` data loaders; [b] no infinite re-render loops; [c] hot-reload doesn't crash.

### T7.2 — Same for CashierView, AdminView, KitchenView

- **description**: Finish `useQuery` migration in the remaining three view components; replace manual loaders with `useQuery` + `invalidateQueries`.
- **files**: [`components/views/CashierView.tsx`, `components/views/AdminView.tsx`, `components/views/KitchenView.tsx`]
- **command(s)**: `grep "useEffect.*load" components/views/{Cashier,Admin,Kitchen}View.tsx` (zero data-loader matches); `pnpm dev` smoke
- **acceptance_criteria**: [a] zero `useEffect` data loaders in any view; [b] realtime events trigger refetch via `invalidateQueries`; [c] no flicker.

---

## Commit 8 — Realtime subscribe bug fix (BUNDLED, covers R1-06)

### T8.1 — Refactor `lib/supabase/realtime-service.ts`

- **description**: Replace single-channel singleton with `Map<string, { channel: RealtimeChannel; callbacks: Set }>` keyed by channel name. Each caller registers independently; teardown removes only the caller's callback; channel closes when the last callback deregisters.
- **files**: [`lib/supabase/realtime-service.ts`]
- **command(s)**: `pnpm tsc --noEmit`; manual unit check (see T8.2)
- **acceptance_criteria**: [a] Map-based registry in place; [b] teardown removes only the caller's callback; [c] channel closes on last teardown; [d] `subscribeToTables/subscribeToOrders/subscribeToKitchen` all use the new pattern.

### T8.2 — Two-tab verification

- **description**: Manual unit-level smoke: subscribe twice, both callbacks fire on a mock UPDATE event; unsubscribe one, the other still fires; unsubscribe both, channel closes.
- **files**: N/A (verification only)
- **command(s)**: dev-mode manual test using `supabase.channel('tables-waiter').on('postgres_changes', ...)` with two registered handlers
- **acceptance_criteria**: [a] both callbacks fire on a single UPDATE; [b] first teardown leaves second intact; [c] second teardown closes the channel; [d] `supabase.removeChannel` invoked exactly once after both unsubscribe.

---

## Commit 9 — Legacy cleanup (P6c)

### T9.1 — Delete `lib/supabase-service.ts`

- **description**: Remove the 229-line legacy service file; all callers already migrated in Commit 7.
- **files**: [`lib/supabase-service.ts`] (deleted)
- **command(s)**: `grep -r "lib/supabase-service" lib/ components/` (zero matches); `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] file does not exist; [b] zero imports reference it; [c] `tsc --noEmit` exits 0.

### T9.2 — Delete `types/models.ts`

- **description**: Remove `types/models.ts` (enum values disagreed with `types/index.ts` and DB CHECK); all imports routed to `types/index.ts` or `types/supabase.ts` in earlier commits.
- **files**: [`types/models.ts`] (deleted)
- **command(s)**: `grep -r "from.*types/models" lib/ components/ hooks/` (zero matches); `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] file does not exist; [b] zero imports reference it; [c] `tsc --noEmit` exits 0.

### T9.3 — Delete `store/use-pos-store.ts` (deferred from Commit 6)

- **description**: Final deletion of `usePOSStore` shim; all callers already migrated in Commit 6.
- **files**: [`store/use-pos-store.ts`] (deleted)
- **command(s)**: `grep -r "usePOSStore" lib/ components/ hooks/ store/` (zero matches); `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] file does not exist; [b] zero references; [c] `tsc --noEmit` exits 0.

### T9.4 — Create `lib/log.ts`

- **description**: Wrapper for `console.log/warn/error` with structured context (`{component, action, ...meta}`); gates on `NODE_ENV !== 'production'` unless `LOG_LEVEL` env var explicitly enables.
- **files**: [`lib/log.ts`]
- **command(s)**: `NODE_ENV=production node -e "import('./lib/log.ts').then(m => m.log.info('test'))"` (no stdout)
- **acceptance_criteria**: [a] `lib/log.ts` exports `log.info/warn/error`; [b] `NODE_ENV=production` gates output; [c] structured-context param accepted.

### T9.5 — Migrate ~120 `console.*` calls to `lib/log.ts`

- **description**: Replace ~120 `console.log/warn/error` calls across 40+ files in `components/`, `lib/`, `store/`, `hooks/` with the corresponding `log.*` calls.
- **files**: [`components/**/*.tsx`, `lib/**/*.ts`, `store/**/*.ts`, `hooks/**/*.ts`]
- **command(s)**: `grep -r "console\.\(log\|warn\|error\)" components/ lib/ store/ hooks/` (zero matches outside `lib/log.ts`); `pnpm tsc --noEmit`
- **acceptance_criteria**: [a] zero bare `console.*` outside `lib/log.ts`; [b] `pnpm tsc --noEmit` exits 0; [c] `pnpm build` exits 0.

### T9.6 — Record `pnpm tsc --noEmit` baseline error count

- **description**: Capture the exact `pnpm tsc --noEmit` error count BEFORE any commit lands; document the baseline in the PR description so subsequent commits can track delta. Per proposal §6: pre-existing 484 errors are accepted; delta is documented.
- **files**: N/A (baseline recording)
- **command(s)**: `pnpm tsc --noEmit 2>&1 | grep -c "error TS"` → save to PR description
- **acceptance_criteria**: [a] baseline count captured; [b] count documented in PR description; [c] delta vs subsequent commits tracked.

---

## Commit 10 — Docs

### T10.1 — Rewrite `openspec/changes/revision-completa-sistema/apply-progress.md`

- **description**: Update the 9-PR attempt log to reflect actual reality: 9 local-only stacked branches attempted, 1 PR actually landing (this one). Include commit-by-commit summary.
- **files**: [`openspec/changes/revision-completa-sistema/apply-progress.md`]
- **command(s)**: N/A
- **acceptance_criteria**: [a] reflects 9 local attempts, 1 PR landing; [b] includes the 10-commit summary; [c] explains why chained-PR was rejected.

### T10.2 — `README.md` quick-start with `db reset` note

- **description**: Rewrite `README.md` quick-start to include `docker compose down -v` (existing data will be lost) and `supabase db reset` step. Removes references to missing SQL files.
- **files**: [`README.md`]
- **command(s)**: `grep "create-database-schema.sql\|create-storage-bucket.sql" README.md` (zero matches); `grep "supabase db reset" README.md` (matches)
- **acceptance_criteria**: [a] quick-start includes `db reset` + data-loss warning; [b] no references to missing SQL files; [c] setup sequence matches `docker-compose.yml`.

---

## Review Workload Forecast

- **Chained PRs recommended**: No (user chose single-PR literal)
- **400-line budget risk**: High (~10,742 lines, 124 files; `size:exception` granted)
- **Estimated changed lines**: 10,742 net additions, 2,796 deletions
- **Files most likely to draw review attention**:
  1. `docker-compose.yml` (+~30/-~20) — infra swap, gotrue patch reference
  2. `supabase/00_supabase_init.sql` (+~80) — NEW
  3. `infra/gotrue/Dockerfile` (+~10) — NEW
  4. `supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql` (+705) — biggest single migration
  5. `store/usePOSStore.ts` (-748) — deletion
  6. `components/views/WaiterView.tsx` (+394) — large refactor
  7. `pos/print_renderer.py` (+336) — new printer renderer
- **Decision needed before apply**: No (user pre-decided: single-PR, db reset, docker pull OK, commit uncommitted changes)
- **Apply path**: db reset (user accepted data loss)

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

---

## Verification Recipe

Run after merging the PR and rebuilding:

```bash
# 1. Tear down + fresh volume
docker compose down -v

# 2. Build images (rebuilds gotrue patch + next app)
docker compose build

# 3. Start stack
docker compose up -d

# 4. Wait for auth health
until curl -sf http://localhost:54321/auth/v1/health; do sleep 1; done

# 5. Apply seed
docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql

# 6. Verify publication
docker exec supabase-db psql -U postgres -d postgres -c \
  "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'"
# Expected: 3+ rows including public.tables, public.orders, public.order_items

# 7. Two-tab functional test
# - Open http://localhost:3003 in two browser tabs
# - Log in as admin@restaurant.com / admin123 in both
# - Tab A: mark table 1 as occupied
# - Tab B: status updates within ~2s without manual refresh
```
