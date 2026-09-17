# Proposal: `revision-completa-sistema`

> Change name (verbatim, from user): "necesito hacer una revision completa del sistema, que cosas podrian mejorarse o que cosas estarian fallando, se debe incluir todo, siento que la informacion de las mesas en tiempo real no se estan reflejando corretamente cuando son dispositivos diferentes, pero quiero que revises todo el sistema y saber el estado completo del sistema y en que punto nos encontramos"

## Why

The system has accumulated enough foundational debt — missing `supabase_realtime` publication, zero Row-Level Security, plaintext passwords, non-atomic payment flows, no CI, root-running containers — that incremental fixes are riskier than a coordinated change. The user's reported symptom (mesas not syncing in realtime across devices) is a single class-level bug (`ALTER PUBLICATION supabase_realtime ADD TABLE` was never run), but shipping just that fix without the surrounding RLS / multi-tenant / payment-integrity work would leave the next symptom already in production. This change is the coordinated remediation.

## Intents

1. **Realtime mesa sync is observably correct.** Two browsers in different roles see the same `tables.status` change within ~500 ms.
2. **Multi-tenant data isolation is enforceable.** Every public table has RLS enabled and a per-tenant policy; an anon key on restaurant A's DB returns zero rows from restaurant B.
3. **Payments are atomic and idempotent.** `completePayment` runs in one Postgres transaction with `SELECT FOR UPDATE`; double-tap produces one `payment_transactions` row.
4. **CI catches TS / ESLint regressions before merge.** A push that breaks `tsc --noEmit` or `eslint` fails the build.
5. **The printer listener is reproducible, authenticated, and does not double-print.** `pos/requirements.txt` pins versions; Realtime auth works against the local stack; a short-lived LRU deduplicates broadcasts.
6. **No plaintext credentials live in the database or seed.** `profiles.password` and the four `business_config.*_password` values are gone, replaced by Supabase `auth.users.app_metadata.role`.
7. **Schema integrity is enforced at the database, not the client.** `ingredient_transactions_orders` exists, FK `ON DELETE CASCADE` covers `order_items.order_id` and `cash_transactions.cash_register_id`.
8. **The codebase tells one truth about state.** `usePOSStore` is split; `react-query` becomes the server-state source; `lib/supabase-service.ts` is deleted.

## Scope

### In scope
- One new SQL migration enabling `supabase_realtime` publication and `REPLICA IDENTITY FULL` on `tables`, `orders`, `order_items`.
- One new migration introducing `restaurants` table + `restaurant_id` FK on every tenant-relevant table + backfill + RLS policies per role.
- New Postgres functions: `complete_payment(uuid, text, numeric)` and `delete_order_with_items(uuid)`.
- New `supabase/migrations/2025XXXX_create_ingredient_transactions_orders.sql`.
- Drop `profiles.password`; remove role PINs from `business_config`; drop default `GRANT ALL TO anon` in `init.sql`.
- New `.github/workflows/ci.yml` running `tsc --noEmit`, `npm run lint`, `npm run build`.
- `next.config.mjs`: set both `ignoreBuildErrors` and `ignoreDuringBuilds` to `false`; add `outputFileTracingRoot`.
- `Dockerfile`: add non-root `USER`, switch to `pnpm`, add `.dockerignore`.
- `docker-compose.yml`: add `app` depends_on realtime healthcheck + startup probe calling `supabase.auth.getSession()`.
- `pos/requirements.txt` (pinned) + `pos/app.py` refactor (encoding, dedupe LRU, auth via service-role or dedicated GoTrue user).
- `lib/supabase-service.ts` deletion; `usePOSStore` split into `useTableStore` / `useCartStore` / `useOrderStore` / `useMenuStore`.
- `<QueryClientProvider>` wrapping `app/layout.tsx`; migration of table/order/menu reads to `useQuery`.
- `README.md` rewrite pointing at `supabase db reset` instead of the missing `.sql` files.

### Out of scope (deferred — see "Out of scope / explicitly deferred")
- Customer-facing order tracking, analytics dashboards, multi-language UI, mobile apps, inventory low-stock alerts beyond the audit-event row, payments via external processors.

## Confirmed decisions (orchestrator-gathered)

1. **Deployment target = local docker-compose.** Migrations land via `supabase db reset`; the realtime publication fix is a new SQL migration. Cloud path noted as "Assumption to confirm" below.
2. **Row-Level Security = INCLUDED.** RLS enabled on every public table; per-role and per-tenant policies written; default `GRANT ALL TO anon` removed from `init.sql`.
3. **Tenancy model = multi-tenant from day one.** New `restaurants` table + `restaurant_id` FK on tenant-relevant tables + policies filter by tenant.

## Assumptions to confirm with the user

| # | Question | Recommended default |
|---|----------|---------------------|
| A1 | Supabase Cloud path: do we need a parallel migration set, or is local-only enough for this change? | Local-only. Add a follow-up issue if Cloud is in scope. |
| A2 | Concurrent POS stations per typical shift? | ≤ 4 stations. Invalidation-only (no diff-merge). Upgrade if observed. |
| A3 | CI/CD on GitHub Actions or GitLab CI? | GitHub Actions. Default branch protection + required checks. |
| A4 | Are PINs `1234/5678/9999/0000` currently in production? | Assume yes. Treat the rotation as urgent, included in Phase 2. |
| A5 | Supabase plan (Free vs Pro)? | Assume Free. Design around the 500 ms Realtime SLA, no DB writes > 200 MB/mo. |
| A6 | Printer listener on every station or only kitchen? | Kitchen only. Service-role token scoped to print topic. |
| A7 | Multi-tenant: single restaurant per deploy, or many? | True multi-tenant (DB shared, `restaurant_id` on every tenant table). |
| A8 | UI copy stays Spanish? | Yes. Source identifiers and comments stay English (developer policy). |

## Approach — phased plan

The 38 findings cluster into six PR-shaped phases. Each phase ends with a verifiable checkpoint. Chained-PR candidates are flagged.

| Phase | Goal | Hot spots addressed | Rough size | PR strategy |
|-------|------|---------------------|------------|-------------|
| **P1. Realtime publication & skeleton** | Mesas sync across devices, no flicker | HS-01, HS-16, HS-23, HS-38 | ~120 lines (1 migration + small TS edits + skeleton guard in `TableGrid`) | **Chained PR #1**, independent. Single small migration, easy revert. |
| **P2. Multi-tenant schema + RLS + auth** | Data isolation, drop credentials, server-side role | HS-02, HS-03, HS-04, HS-15, HS-18, HS-30 | ~450 lines (2 migrations + 1 trigger + RLS policies + business-config refactor + seed rewrite) | **Chained PR #2a (schema) + #2b (policies)**. Must follow P1 because RLS will gate Realtime payloads. |
| **P3. Payment & order atomicity** | One transaction, one invoice, no double-pay | HS-06, HS-07, HS-13, HS-19, HS-21, HS-25 | ~350 lines (1 migration + 2 Postgres functions + ~150 line service.ts refactor + smoke test) | **Chained PR #3**, independent of P1/P2 in implementation but should land after RLS so policies can wrap the new functions. |
| **P4. Build & infra safety** | CI catches regressions; container is non-root; build waits for DB | HS-05, HS-14, HS-17, HS-29, HS-31, HS-34, HS-36 | ~200 lines (.github/workflows/ci.yml + next.config + Dockerfile + docker-compose + README rewrite) | **Chained PR #4**, independent. Largest absolute win for the smallest surface area. |
| **P5. Printer listener reliability** | Reproducible, authenticated, no double-print, correct encoding | HS-11, HS-12, HS-26, HS-27, HS-28 | ~250 lines (pos/requirements.txt + auth refactor + LRU + encoding negotiation) | **Chained PR #5**, independent. Windows-only; CI matrix opt-in. |
| **P6. State & data layer cleanup** | One source of truth per entity | HS-08, HS-09, HS-10, HS-22, HS-24, HS-33, HS-35 | ~700 lines (god-store split + react-query migration + legacy service deletion + log.ts + types cleanup) | **Chained PR #6a (stores split) + #6b (react-query migration) + #6c (legacy cleanup)**. Largest churn; benefits from P1 already landed because we touch `TableGrid`/realtime paths. |

**Dependency graph**: P1 → (P2 ∥ P3) → P6, with P4 and P5 each independent.

## Affected components

### Migrations
- `supabase/migrations/20250917090000_enable_realtime_publication.sql` (new)
- `supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql` (new)
- `supabase/migrations/20250917090006_create_ingredient_transactions_orders.sql` (new)
- `supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql` (new)
- `supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql` (new)
- `supabase/migrations/20250917090099_drop_default_anon_grants.sql` (new)
- `supabase/init.sql` (edit: remove default GRANT to anon)

### Frontend
- `app/layout.tsx` — wrap in `<QueryClientProvider>`.
- `next.config.mjs` — `ignoreBuildErrors:false`, `ignoreDuringBuilds:false`, `experimental.outputFileTracingRoot`.
- `package.json` — rename to `vipe-pos-system`.
- `lib/supabase/realtime-service.ts` — merge-on-payload instead of full reload.
- `lib/supabase/client.ts` — remove hard-coded fallback URL/key.
- `lib/supabase-service.ts` — **delete**.
- `lib/supabase/service.ts` — `completePayment` and `deleteOrder` rewritten to call Postgres functions; `createPartialOrder` strips client tax/tip.
- `store/use-pos-store.ts` — split into `useTableStore`, `useCartStore`, `useOrderStore`, `useMenuStore` (~748 lines → 4 files of ~150 each).
- `store/use-config-store.ts` — drop role-PIN state.
- `store/use-cash-register-store.ts` — guard the `addTransaction` call site.
- `components/views/{Waiter,Kitchen,Cashier,Admin}View.tsx` — replace `useEffect` loaders with `useQuery`.
- `components/pos/TableGrid.tsx` — drop the `setLoading(true)` on every event.
- `components/printing/{KitchenOrderPrintView,InvoicePrintView}.tsx` — document, share renderer with `pos/`.

### POS listener (`pos/`)
- `pos/requirements.txt` — pinned versions for `customtkinter`, `pystray`, `Pillow`, `html2text`, `escpos-python`, `pywin32`, `usb`, `realtime`, `python-dotenv`.
- `pos/app.py` — auth via service-role token or GoTrue user; `recently_printed` LRU; encoding negotiation; reconnect backoff with `tenacity`.
- `pos/README.md` — install + driver guidance.
- `vipe_pos_installer.iss` — ship the WinUSB driver installer as an optional step.

### Build & infra
- `.github/workflows/ci.yml` (new).
- `Dockerfile` — non-root `USER`, pnpm, `.dockerignore`.
- `docker-compose.yml` — `depends_on: realtime: condition: service_healthy`; startup probe.
- `docker-compose.prod.yml` — leave alone for this change (noted in deferred).
- `README.md` — replace missing `.sql` references with `supabase db reset && pnpm docker:dev:seed`.

## Hot-spot disposition (38 findings)

| HS | Disposition |
|----|-------------|
| HS-01 (critical, realtime publication) | **Address in P1** |
| HS-02 (critical, no RLS) | **Address in P2** |
| HS-03 (critical, role PINs) | **Address in P2** (server-side role on `auth.users`) |
| HS-04 (critical, plaintext passwords) | **Address in P2** (`profiles.password` dropped) |
| HS-05 (critical, build errors swallowed) | **Address in P4** |
| HS-06 (high, non-transactional delete) | **Address in P3** (`delete_order_with_items`) |
| HS-07 (high, missing `ingredient_transactions_orders`) | **Address in P3** (new migration) |
| HS-08 (high, no client cache invalidation) | **Address in P6** |
| HS-09 (high, god-store) | **Address in P6** |
| HS-10 (high, legacy service) | **Address in P6** |
| HS-11 (high, no requirements.txt) | **Address in P5** |
| HS-12 (high, anon realtime disabled) | **Address in P5** |
| HS-13 (high, non-atomic payment) | **Address in P3** |
| HS-14 (high, runs as root) | **Address in P4** |
| HS-15 (high, `auth.users` ↔ `profiles` gap) | **Address in P2** |
| HS-16 (medium, channel race / leak) | **Address in P1** (single service-level subscription) |
| HS-17 (medium, --legacy-peer-deps + copy whole repo) | **Address in P4** |
| HS-18 (medium, anon storage policies) | **Address in P2** |
| HS-19 (medium, addTransaction only via store) | **Address in P3** + smoke test |
| HS-20 (medium, stock clamps silently) | **Out of scope — follow-up issue**. Documented, not blocking. |
| HS-21 (medium, partial order trusts client tax/tip) | **Address in P3** (server-side computation in Postgres fn) |
| HS-22 (medium, duplicate component state) | **Address in P6** |
| HS-23 (medium, no realtime skeleton) | **Address in P1** |
| HS-24 (medium, hand-rolled `useEffect`) | **Address in P6** |
| HS-25 (medium, multi-payment non-atomic) | **Address in P3** |
| HS-26 (medium, no print dedupe) | **Address in P5** |
| HS-27 (medium, CP1252 hard-coded) | **Address in P5** |
| HS-28 (medium, printing components misnamed) | **Address in P5** (taxonomy doc + shared renderer) |
| HS-29 (medium, no realtime wait in compose) | **Address in P4** |
| HS-30 (medium, no `auth_user_id` link) | **Address in P2** |
| HS-31 (low, package name `my-v0-project`) | **Address in P4** |
| HS-32 (low, mixed-language logs) | **Address in P6** (single `lib/log.ts`) |
| HS-33 (low, 100+ console.log) | **Address in P6** |
| HS-34 (low, README references missing files) | **Address in P4** |
| HS-35 (low, types/models.ts disagrees) | **Address in P6** |
| HS-36 (low, container hostname binding) | **Address in P4** |
| HS-37 (low, registerSummary duplicated) | **Address in P6** |
| HS-38 (medium, `subscribeToPosEvents` no unsubscribe) | **Address in P1** |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| RLS policy blocks legitimate writes on first cut-over | Med | Per-role test users + smoke tests in P2; roll out to staging first. |
| Multi-tenant backfill duplicates or loses rows | Med | Idempotent migration in a transaction; dry-run on a copy of prod; verify row counts before/after. |
| Realtime publication fix triggers a flood of stale events during first boot | Med | `supabase db reset` cleans the slot; add a "first sync" gate in `TableGrid` to swallow events for the first 1 s. |
| Printer listener auth refactor breaks the kitchen workstation | Low | Service-role token with topic-scoped RLS first; fall back to anon only if regression is observed. |
| God-store split changes behaviour subtly | Med | Pin a snapshot integration test before splitting; mirror `usePOSStore` re-exports during migration so existing imports keep working until consumers are moved. |
| CI enabling tsc/eslint blocks existing PRs that haven't fixed lint yet | Low | Run `pnpm lint:fix` as a one-shot before opening the CI PR. |
| Supabase Cloud path left unverified (A1) | Med | Cloud path documented in ADR; out-of-scope follow-up issue. |
| Multi-tenant introduces a N+1 at the policy layer | Low | All policies keyed on `auth.uid()` joined to `profiles`; add `EXPLAIN` smoke test. |

## Rollout / migration plan

### Local dev (every phase)
1. `docker compose down -v` to clear the WAL slot.
2. `docker compose up -d`.
3. Wait for `realtime` healthcheck before continuing.
4. `supabase db reset` (applies all migrations idempotently).
5. `pnpm docker:dev:seed`.
6. Run the phase-specific smoke test (see Success metrics).

### Per-phase rollback strategy
- **P1**: drop the new migration; `ALTER PUBLICATION supabase_realtime DROP TABLE ...` reverses it without touching other migrations.
- **P2**: revert migration order in a single down script (drop policies, drop FKs, restore columns nullable, restore `init.sql` defaults).
- **P3**: `DROP FUNCTION` is reversible; the client keeps the old `service.ts` code path during a feature-flag window.
- **P4**: workflow file deletion + revert `next.config.mjs` flags. No DB impact.
- **P5**: revert `pos/requirements.txt` and keep the old `app.py` in git history; rollback is a redeploy.
- **P6**: split in small commits; each commit is individually compilable. If something breaks, revert the offending commit only.

### Production cut-over
- Out of scope of this change. The Cloud path (A1) is the gate to a production rollout. The change lands locally and is exercised by `pnpm docker:dev:seed` + a staging environment before any prod migration runs.

## Success metrics

- [ ] Two browsers (incognito + normal) on different roles both reflect a `tables.status` UPDATE within 500 ms (P1).
- [ ] RLS denies: anon key cannot SELECT any row when `restaurant_id` ≠ caller tenant (P2). Verified by a failing integration test that turns green after the policy.
- [ ] `count(payment_transactions WHERE order_id IN (SELECT id FROM orders WHERE status='paid'))` equals `count(orders WHERE status='paid')` after running the payment smoke script 50 times (P3).
- [ ] `pnpm tsc --noEmit` and `pnpm lint` both pass in CI; a deliberate `@ts-expect-error` in a feature branch fails the build (P4).
- [ ] Docker image runs as non-root; `docker compose up` `app` healthcheck waits for `realtime` healthy (P4).
- [ ] `pos/requirements.txt` exists with pinned versions; `pip install -r pos/requirements.txt && python pos/app.py` starts the listener with no ImportError (P5).
- [ ] No duplicate print observed after 20 forced `room_bills` broadcasts over a flaky network in a test harness (P5).
- [ ] `usePOSStore` is deleted; `lib/supabase-service.ts` is deleted; `grep -r "usePOSStore" components/` returns zero (P6).
- [ ] `next.config.mjs` has `ignoreBuildErrors:false` AND `ignoreDuringBuilds:false` (P4).
- [ ] `git grep "console.log" components/ lib/ store/` returns zero matches except inside `lib/log.ts` (P6).

## Open questions surfaced by the proposal

- **Q1**: Should the service-role token approach (for the printer listener) be one token shared across all listeners, or per-station tokens rotated by the operator? (Default: one per station, scoped to the print topic only.)
- **Q2**: When RLS lands, should we issue a one-shot "data migration" script to backfill `restaurant_id` for the existing seed data, or expect the operator to wipe and re-seed? (Default: provide both — a backfill migration that does nothing if all rows already have `restaurant_id`, plus a `supabase db reset` path for clean installs.)
- **Q3**: For Phase 6, should we keep `usePOSStore` as a thin re-export shim during the split, or do a hard rename? (Default: thin shim for one release, then delete.)
- **Q4**: For the multi-tenant model, is `restaurant_id` a `uuid` (matches the project's PK style) or a `text` slug for human-readable URLs? (Default: `uuid`, slug derived in a view.)

## Out of scope / explicitly deferred

- Analytics dashboards beyond what the AdminView already shows.
- Multi-language UI (Spanish stays as-is per developer policy).
- Customer-facing order tracking (no public token endpoint yet).
- External payment processor integration (Stripe / Wompi / Mercado Pago).
- Inventory low-stock proactive alerts.
- Hardening of `docker-compose.prod.yml` (no reverse proxy, no SSL, no rate limiting).
- Mobile-first PWA install + offline support.
- Replacing DPAPI credential storage with OS keychain (HS-12 leaves DPAPI in place).
- Migration to pnpm workspaces for the `pos/` subproject.

## Next recommended phase

**`spec`**. The proposal is sized for chained PRs; once the user approves the scope, we move to delta specs — one per bounded domain (realtime, rls/tenancy, payments, build/ci, printer, state) — following the rules in `openspec/config.yaml` (`rules.specs`: Given/When/Then, RFC 2119 keywords, one delta per domain).