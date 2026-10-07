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
- [ ] T2. Integrate the sdd branch into `perf/cargas-por-perfil`, resolve the 6 conflicts (CashierView, KitchenView, CompletedOrdersTable, package.json, pnpm-lock.yaml, vitest.config.ts) keeping pagos/domicilios behavior; full checks. (S2, S4) Route: worker + verify. Commit: -
- [ ] T3. Deploy the integration to staging and confirm with the user that selecting no longer flickers. (S2) Route: inline. Commit: -
- [ ] T4. Audit per profile and screen: mount / interaction / realtime loads with verdicts; table appended to this document. (S1, S3) Route: explore (parallel). Commit: docs.
- [ ] T5+. One fix task per profile from the audit verdicts (added after T4). (S1, S2) Route: per Writer rule.
- [ ] T9. Docs and full verification. Route: verify.

## Log

| # | Entry |
|---|-------|
| L1 | (user) "Necesito hacer una implementacion/fix/mejora con respecto a todas las pantallas, en cada perfil estoy viendo demasiadas cargas de informacion, demasiadas peticiones y ni si quiera se si es necesario, necesito revisar y ver porque hasta en domicilio cada que elijo una mesa hay una carga de pantalla como si espabilara, necesito revisar cada cosa en cada perfil y pantalla si esta cargando lo que deberia, es un trabajo grande que debes hacer con odd" |
| L2 | (evidence) Prior change `optimizar-arquitectura-realtime`: 12 commits (S1 acute flicker fix, S2 channel lifecycle, ST test runner, S3 single owner, S4 fan-out containment) on a local branch based on `1cbd88b`, never merged; S5 consumer unification uncommitted in the main checkout (S5.8 verification pending). `git merge-tree origin/dev HEAD` -> 6 conflicts. |
| L3 | (user decision) "Integrarlo primero (Recomendado)". |
| L4 | (T1) S5 committed as `fe652d3` on the sdd branch: 9 files (4 views, lib/realtime/order-merge.ts+test, components/views/order-apply.test.tsx, openspec tasks.md + apply-progress-s5.md). Pre-commit on that branch: Vitest 7 files / 52; tsc 0 errors. Excluded .env.local, .atl/, .gitignore, docs/PRESENTACION-COMERCIAL.md, odd/. |
