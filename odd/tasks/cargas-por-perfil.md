# Feature: cargas-por-perfil

Every profile and screen loads only what it needs: no redundant requests, no full-screen reloads or flicker on selection.
Branch `perf/cargas-por-perfil` (from `dev` 46aa5aa). Builds on the earlier openspec change `optimizar-arquitectura-realtime` (S1-S5).

## Specs

- S1. "en cada perfil estoy viendo demasiadas cargas de informacion, demasiadas peticiones y ni si quiera se si es necesario"
  -> for every profile (waiter, kitchen, cashier, admin, delivery_operator) each screen issues only the requests it needs; redundant or duplicated requests are removed.
- S2. "hasta en domicilio cada que elijo una mesa hay una carga de pantalla como si espabilara"
  -> selecting an item (table, order, delivery) never reloads or remounts the whole screen.
- S3. "necesito revisar cada cosa en cada perfil y pantalla si esta cargando lo que deberia"
  -> an audit lists, per profile and screen, what is loaded on mount, on interaction and on realtime events, with a verdict (needed / redundant / missing).
- S4. Decision (user, 2026-10-07): integrate the existing `optimizar-arquitectura-realtime` work first (S1-S4 commits on
  `sdd/optimizar-arquitectura-realtime/s5-consumer-unification` plus the uncommitted S5 in the main checkout), then audit on that base.

## Tasks

- [x] T1. Commit the user's uncommitted S5 on its sdd branch (only S5 files; never `.env.local`, `.atl/`, `.gitignore`, unrelated docs). (S4) Route: inline. Commit `fe652d3` (sdd branch).
- [x] T2. Integrate the sdd branch into `perf/cargas-por-perfil`, resolve the 6 conflicts (CashierView, KitchenView, CompletedOrdersTable, package.json, pnpm-lock.yaml, vitest.config.ts) keeping pagos/domicilios behavior; full checks. (S2, S4) Route: worker + verify. Commit `6ca33f1`.
- [ ] T3. Deploy the integration to staging and confirm with the user that selecting no longer flickers. (S2) Route: inline. Deployed `cc5573b4` (dev `5639007`); user confirmation pending.
- [x] T4. Audit per profile and screen (see "## Audit"). (S1, S3) Route: 3 parallel explorers. Commit: docs.
- [ ] T5. Shell: role-scoped startup loads in parallel, no fixed 500 ms delay, no runtime `initializeDefaultConfig`, auth listener only on SIGNED_IN/OUT and unsubscribed, selector-based store reads, register loads owned by the views that need them, PasswordDialog reads the config store. (S1, S2) Route: worker. Commit: -
- [ ] T6. Waiter: realtime setup independent of `activeTable`; waiters as one shared query (view + WaiterSelectionModal); categories/dishes/promotions cached, menu not remounted per table; batched stock check. (S1, S2) Route: worker. Commit: -
- [ ] T7. Kitchen: use the realtime payload order instead of a second `getById`; skip echoes of local changes; no `setOrders([])` + re-add on refresh; patch single items; drop the redundant deliveries invalidate and dead `loadInitialData`. (S1, S2) Route: worker. Commit: -
- [ ] T8. Cashier: one `getByStatus` call; refreshes after pay/split/undo never blank the screen; PaymentMethodDialog reuses the loaded order; one register load; Transacciones without a duplicate register load. (S1, S2) Route: worker. Commit: -
- [ ] T9. Admin: drop the duplicate `loadActiveOrdersFromDB`; dashboard queries only while its tab is open, in parallel, bounded popular dishes; config sub-tabs cached with useQuery; no duplicate cash-transactions refetch; refresh without blanking; no perpetual pulse. (S1, S2) Route: worker. Commit: -
- [ ] T10. Delivery: `active-deliveries` realtime limited to delivery orders and debounced (board and cashier panel); lightweight "register open" check; suggested fee cached and form rendered immediately; card actions without a double reload. (S1, S2) Route: worker. Commit: -
- [ ] T11. Docs, before/after request counts per profile, full verification. Route: verify.

## Audit (T4, static reading of perf/cargas-por-perfil 6ca33f1)

Explorers: shell `muyij4tp-5-x03z`, waiter/kitchen `muyij6a8-6-rfjc`, cashier/admin/delivery `muyij7bb-7-uw6r`. Counts are per trigger, from code reading (not measured).

| Profile | Trigger | What happens today | Verdict |
|---|---|---|---|
| all | start/login | `app/page.tsx` runs ~24-26 sequential requests for every role (8 one-by-one `business_config` reads from `initializeDefaultConfig`, all registers + all transactions unbounded, tables, waiters, kitchen and delivered orders as 2 calls, open register + its transactions), then a fixed 500 ms delay behind a full-screen loader | redundant / over-fetch |
| all | auth events | `onAuthStateChange` reloads the profile on every event (incl. token refresh) and is never unsubscribed; resets an impersonating admin | duplicate |
| all | profile PIN | `PasswordDialog` reloads the config (9 requests) on each open | redundant |
| all | store writes | `useCashRegisterStore()` / `useConfigStore()` read without selectors at the root: every register load (3 writes) re-renders the whole app | flicker |
| waiter | select a table | realtime setup depends on `activeTable`: channels torn down and resubscribed + waiters list refetched and replaced; MenuSection remounts -> categories, dishes (+ whole `promotion_dishes`), ~3 stock queries per dish, skeletons again | main S2 cause |
| waiter | open waiter picker | waiters refetched | duplicate |
| kitchen | each realtime item/order event | `getById` in the service and again in the view (2 full order reads); local changes echo back as 2 more reads | duplicate |
| kitchen | refresh | `setOrders([])` then re-add one by one | flicker |
| cashier | mount / after pay, split, undo | orders read as 3 status calls; local `isLoading` replaces the whole Órdenes tab with skeletons on every reload | duplicate + flicker |
| cashier | open payment | dialog refetches the order already loaded | redundant |
| cashier/delivery/admin | mount | `loadCurrentRegister` (3 requests) called by 5-6 components independently | duplicate |
| admin | mount (any tab) | active orders loaded twice (query + `loadActiveOrdersFromDB`); dashboard ~7 sequential requests even when the tab is closed; popular dishes reads every paid item ever | duplicate / over-fetch |
| admin | config sub-tabs | each list reloads on every visit (no cache) | redundant |
| admin | Órdenes activas | skeletons on refresh; cards pulse forever (`isNewOrder` from `new Date()` each render) | flicker |
| delivery | any `orders` change anywhere | whole board refetched (also in the cashier panel), including table orders | over-fetch |
| delivery | open "Nuevo domicilio" | form blank until the fee loads; first visit of each category shows skeletons | flicker |
| delivery | card action | RPC + explicit refetch + realtime refetch | duplicate |

## Log

| # | Entry |
|---|-------|
| L1 | (user) "Necesito hacer una implementacion/fix/mejora con respecto a todas las pantallas, en cada perfil estoy viendo demasiadas cargas de informacion, demasiadas peticiones y ni si quiera se si es necesario, necesito revisar y ver porque hasta en domicilio cada que elijo una mesa hay una carga de pantalla como si espabilara, necesito revisar cada cosa en cada perfil y pantalla si esta cargando lo que deberia, es un trabajo grande que debes hacer con odd" |
| L2 | (evidence) Prior change `optimizar-arquitectura-realtime`: 12 commits (S1 acute flicker fix, S2 channel lifecycle, ST test runner, S3 single owner, S4 fan-out containment) on a local branch based on `1cbd88b`, never merged; S5 consumer unification uncommitted in the main checkout (S5.8 verification pending). `git merge-tree origin/dev HEAD` -> 6 conflicts. |
| L3 | (user decision) "Integrarlo primero (Recomendado)". |
| L4 | (T1) S5 committed as `fe652d3` on the sdd branch: 9 files (4 views, lib/realtime/order-merge.ts+test, components/views/order-apply.test.tsx, openspec tasks.md + apply-progress-s5.md). Pre-commit on that branch: Vitest 7 files / 52; tsc 0 errors. Excluded .env.local, .atl/, .gitignore, docs/PRESENTACION-COMERCIAL.md, odd/. |
| L5 | (T2 worker muyhnupq-3-pd6l) 7 conflicts resolved hunk by hunk; RED in order-apply.test.tsx: delivery INSERT painted into waiter cache (expected ["o-1"] got ["o-1","d-1"]) and orderType dropped by the S5 wire mapper -> shared wireRowToPartialOrder + mergeOrdersForWaiter (+15 tests). Lockfile regenerated; test.projects node (34 files) + dom (4 files). Vitest 38 files / 600; typecheck 0; lint 0 errors / 84 warnings; build OK. |
| L6 | (T2 verify muyhzdh9-4-7tik) 6/6 pass, no blockers: no dev behavior lost, no invalidateQueries in postgres_changes handlers, S13/S14 hold through realtime, dropped KitchenView lookups confirmed dead, pins kept, no conflict markers. Advisories: S14 relies on full UPDATE rows; cashier INSERT ignores statuses outside active/kitchen/delivered until refetch. S2 not exercised in a running app (T3). Merge commit `6ca33f1`. |
| L7 | (T2 RDD) assess: medium, reviewDue (slice_budget_reached, 37 paths / 6159 lines). START with baseRef 52e3a2a + lenses reliability,resilience -> stopped `lens_context_budget_exceeded` (lineage review-85f32c7fc4466605, no authority created). A merge commit cannot be split without rewriting history; independent verify (L6) stands. Open decision for the user. |
| L8 | (T3) Staging deploy `cc5573b4` SUCCESS on dev `5639007`, GET / 200. |
| L9 | (T4) Audit consolidated in "## Audit"; T5-T11 planned from its verdicts. Delivery S2 click not identified in code: the board never blanks on click; candidates are app-wide re-renders from register loads, constant board refetches, the empty "Nuevo domicilio" dialog. |
