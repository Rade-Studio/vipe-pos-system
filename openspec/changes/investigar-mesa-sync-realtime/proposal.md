# Proposal: investigar-mesa-sync-realtime

## Why

Mesa realtime sync is broken at the **infra layer**, not the client. `postgis/postgis:16-3.4` ships no `supabase_realtime` extension, `wal_level=replica` blocks WAL events, no publication exists, and none of the 7 new `2025091709*` migrations applied (volume predates the files). Client subscriptions are correct; nothing is published, so nothing arrives. The 9 phases of `revision-completa-sistema` work (37 commits on `p6c-legacy-cleanup`) live as local-only stacked branches — zero PRs. The user, as maintainer, consciously chose a single literal PR over the chained-PR recommendation.

## What Changes

One PR from `sdd/revision-completa-sistema/p6c-legacy-cleanup` → `main` (~10,742 / −2,796 lines, 124 files): infra fix (DB image swap + `supabase/init.sql` + `infra/gotrue/Dockerfile` + JWT regen) → all 7 migrations via `db reset` → P2 RLS-aware code → P3 RPC wrappers → P5 printer listener → P6a store split → P6b React Query → P6c legacy deletion + `lib/log.ts` → bundled bug fix (`subscribeToTables` double-call teardown + seed bcrypt hashes for 4 role users) → doc rewrite.

## Capabilities

### New Capabilities

- `realtime-publication`: postgres_changes for `tables/orders/order_items` via `supabase_realtime` extension + publication + `wal_level=logical`.
- `multi-tenant-rls`: `restaurants` + `restaurant_id` FK on 15 tables + per-role policies + `auth.users ↔ profiles` link.
- `payment-atomicity`: `complete_payment` + `delete_order_with_items` Postgres fns with `FOR UPDATE` + idempotency.
- `printer-listener-reliability`: pinned deps, service-role auth, LRU dedupe, UTF-8/CP1252, shared renderer.
- `state-data-layer-cleanup`: god-store split into 5 stores; React Query migration; delete legacy service + `types/models.ts`; `lib/log.ts`.

### Modified Capabilities

None (no existing root specs in `openspec/specs/`).

## Approach

Rebase `p6c-legacy-cleanup` onto main; 10 atomic commits following `work-unit-commits` (infra → migrations → RLS → auth seed → React Query → store split → view migration → realtime bug fix → legacy cleanup → docs). Apply infra + migrations via `supabase db reset` (data loss accepted).

## Impact

`infra/gotrue/Dockerfile` (new) · `supabase/init.sql` (new) · `docker-compose.yml` (DB → `supabase/postgres:15.8.1.085`, gotrue → local build, `GOTRUE_DB_NAMESPACE: auth`) · `env.docker.template` (regen JWTs) · `supabase/migrations/2025091709*.sql` (7 files via `db reset`) · `supabase/seed.sql` (bcrypt hashes for admin/cashier/waiter/kitchen) · `lib/supabase/{client,service,realtime-service}.ts` + `hooks/` + `components/auth/` (P2 + realtime bug fix) · `components/cashier/PaymentMethodDialog.tsx` (P3) · `pos/{app.py,print_renderer.py,requirements.txt,README.md}` + `lib/print/` (P5) · `store/use{Table,Cart,Order,Menu,Analytics}Store.ts`; `store/use-pos-store.ts` deleted (P6a) · `hooks/use-realtime-*.ts` + `components/views/{Waiter,Cashier,Admin,Kitchen}View.tsx` + `app/layout.tsx` + `lib/queryClient.ts` (P6b) · `lib/supabase-service.ts` + `types/models.ts` deleted; `lib/log.ts` + `components/admin/ConfigurationPanel.tsx` (P6c) · `openspec/changes/revision-completa-sistema/apply-progress.md` rewritten.

## Verification

1. Infra up: `docker compose down -v && docker compose up -d`; `curl http://localhost:54321/auth/v1/health` → 200.
2. Publication: `SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime'` → 1 row; `pg_publication_tables` includes `tables/orders/order_items/cash_registers/cash_transactions/payment_transactions`.
3. RLS: `SELECT * FROM pg_policies WHERE tablename='tables'` → tenant policy present.
4. Migrations: `SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 10` → all `2025091709*` present.
5. Functional: two browser tabs at `http://localhost:3003` as `tester@restaurant.com / tester123`; flip table 1 to `occupied` in A; B updates within ~2 s.
6. `pnpm tsc --noEmit` baseline recorded; delta vs 484 pre-existing errors documented.

## Risks

1. `db reset` destroys data — accepted. 2. DB image pull (~1 GB) may fail — gate on image present. 3. `infra/gotrue/` build must succeed — gate on `docker build` exit 0. 4. `subscribeToTables` bug bundled — two-tab test gates merge. 5. 484 pre-existing TS errors surface in CI — document delta; remainder as follow-up. 6. Single PR is ~10 K lines — `size:exception` granted by user-as-maintainer.

## Rollback Plan

`git revert <merge-commit>` restores main; `docker compose down -v && up -d` reverts infra; DB data lost via `db reset` is unrecoverable — accepted pre-merge.

## Out of Scope

New features; multi-tenant UI; P4 hardening beyond realtime fix; archiving `revision-completa-sistema` (separate `sdd-archive` after merge).

## Size Exception

Single-PR delivery confirmed by user-as-maintainer despite ~10 K-line diff and 400-line review cap. `size:exception` granted explicitly. Commits sliced per `work-unit-commits`; each commit independently compilable.

## Ready for Spec / Design

Yes. Capabilities align with the 7 existing delta specs from `revision-completa-sistema` (P1-P6c), liftable for single-PR delivery. Next: `sdd-spec` writes the 5 capability specs.