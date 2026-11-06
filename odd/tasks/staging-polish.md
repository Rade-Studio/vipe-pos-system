# Staging polish before production

Follow-ups left by the NestJS migration (odd/tasks/migracion-backend-nestjs.md) and the profile-loading work (odd/tasks/cargas-por-perfil.md), fixed on staging before the production cut-over. Branch `fix/staging-polish` from `dev` (c6a3f92).

## Specs

- S1 (L1): "vamos trabajando cosas pendientes y mejoras en staging". Production is not touched.
- S2 (F2d): an order created live (realtime INSERT on the admin orders screen) shows its table number and waiter name at once, not "N/A" / "Desconocido" until a refetch (`components/views/AdminView.tsx`, `lib/admin/orders.ts`).
- S3 (F3, cargas-por-perfil.md L27): the admin Overview "Meseros activos" count reflects staff created, activated or deactivated in the same session without a page reload (`components/admin/admin-pages/OverviewPage.tsx`, `store/useProfileStore`).
- S4 (F2c, migracion-backend-nestjs.md L38): the API provides one `Clock` instance (today registered in both `dashboard.module.ts` and `delivery.module.ts`), so a test stub of `Clock` reaches every consumer and the dashboard spec does not depend on the wall clock.
- S5 (F2b): docs describe the pnpm scripts as they are: `docs/despliegue.md:122-124` (`pnpm docker:prod*` vs the `docker-compose` binary) matches `package.json`.
- S6 (F2a): the migration feature log records that the L35 seed/test advisories are closed in code.

## Tasks

- [x] T1. S2 realtime admin card names. Route: worker. Commit: 6ae1b76. RED: AdminView.test.tsx, 3 new tests fail (the admin card never printed a waiter: no "Mesero: Ana"). GREEN: 17/17.
- [x] T2. S3 "Meseros activos" refresh. Route: worker. Commit: aac430d. RED: WaiterList.test.tsx, 2 new tests fail (profiles stay [Ana] after delete and save). GREEN: 11/11 in components/admin/staff.
- [x] T3. S4 single Clock provider. Route: worker. Commit: 1510b5f. RED: delivery spec stubbing app.get(Clock) fails 6 boundary tests. GREEN: dashboard + delivery 59/59.
- [x] T4. S5 + S6 docs. Route: worker. Commit: 6a9201f. Scripts switched to `docker compose`; migration log L45. `pnpm -s vitest run lib/docs` 15/15.

## Log

- L1 (user, 2026-11-05): "quiero ambas cosas, aun no estamos listo para produccion asi que vamos trabajando cosas pendientes y mejoras en staging"
- L2 (evidence, 2026-11-05): explorer map. F2a closed in code (create-restaurant.sh:17,76; seed/test.sh:36,143,189; Tailscale docs). F2d: AdminView.tsx:226-232 maps INSERTs through `adminOrderFromDto(orderDtoFromWire(payload.new))`, fallbacks at lib/admin/orders.ts:50-55; whether the API realtime listener enriches table/waiter names was not checked. F3: OverviewPage.tsx:144-146,225 filters useProfileStore; no profiles realtime subscription. F2c: Clock in dashboard.module.ts:9 and delivery.module.ts:12; dashboard.integration.spec.ts:89 stubs `app.get(Clock)`.
- L3 (evidence, 2026-11-05): T1. The API `orders` event carries `order_items` only (apps/api/src/realtime/pg-listener.service.ts:50-62); adding names there needs a packages/db migration, so the INSERT takes them from the shell stores in AdminView. The card already resolved "Mesa N" from useTableStore; the gap was that OrderCard never printed the waiter in the admin grid, and that the grid ignored the API's tableNumber/waiterName when the stores lacked them. "N/A" / "Desconocido" fallbacks in lib/admin/orders.ts unchanged.
- L4 (evidence, 2026-11-05): T2. Every staff mutation (create, update/activate, delete) lands in WaiterList.invalidateStaffReaders, so the waiter directory (useProfileStore.profiles) is reloaded there through fetchWaiters; one trigger instead of a refetch on every Overview mount.
- L5 (evidence, 2026-11-05): T3. Before the fix the dashboard spec passed on a 2026-11-05 wall clock while asserting a 2026-11-04 window, so app.get(Clock) already resolved to the dashboard's instance; the delivery spec had to stub Clock.prototype. A global CommonModule now provides the one Clock; both specs stub app.get(Clock).
- L6 (evidence, 2026-11-05): final checks: pnpm test 124 files / 1345 tests passed; pnpm typecheck exit 0; pnpm lint exit 0 (0 errors, 39 existing warnings); pnpm api:test 29 files / 426 tests passed.
