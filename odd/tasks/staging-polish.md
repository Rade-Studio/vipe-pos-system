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

- [ ] T1. S2 realtime admin card names. Route: worker. Commit: pending.
- [ ] T2. S3 "Meseros activos" refresh. Route: worker. Commit: pending.
- [ ] T3. S4 single Clock provider. Route: worker. Commit: pending.
- [ ] T4. S5 + S6 docs. Route: worker. Commit: pending.

## Log

- L1 (user, 2026-11-05): "quiero ambas cosas, aun no estamos listo para produccion asi que vamos trabajando cosas pendientes y mejoras en staging"
- L2 (evidence, 2026-11-05): explorer map. F2a closed in code (create-restaurant.sh:17,76; seed/test.sh:36,143,189; Tailscale docs). F2d: AdminView.tsx:226-232 maps INSERTs through `adminOrderFromDto(orderDtoFromWire(payload.new))`, fallbacks at lib/admin/orders.ts:50-55; whether the API realtime listener enriches table/waiter names was not checked. F3: OverviewPage.tsx:144-146,225 filters useProfileStore; no profiles realtime subscription. F2c: Clock in dashboard.module.ts:9 and delivery.module.ts:12; dashboard.integration.spec.ts:89 stubs `app.get(Clock)`.
