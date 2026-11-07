# Reservas de mesas con nombre

Fix the waiter's quick "Reservar" button (today it opens the waiter picker and leaves the table occupied) and let admin, caja and waiters reserve a free table under a name with an optional arrival time.
Branch `feat/reservas-mesas` from `dev` (after #151); migration 0022. UI copy in Spanish, code and docs in English.

## Specs

- S1. "Ese boton rapido de reservar no funciona": the "Reservar" action must actually reserve the table (status `reserved`). It appears only on free tables (user's answer: "Solo en mesas libres (Recomendado)"); occupied tables do not show it.
- S2. "la reserva me gustaria que desde el admin o caja se pudiera reservar con nombre para saber a nombre de quien esta esa reserva". Reserving asks "Nombre y hora" (user's answer): the name is required, the arrival time is optional. Both show on the reserved table wherever tables are shown.
- S3. Who reserves: "Admin, caja y meseros (Recomendado)". The same reserve sheet in the three roles.
- S4. Caja: "Plano de mesas en caja (Recomendado)": caja gets a "Mesas" view that reuses the existing floor map and table panel (no parallel UI), where it can reserve and release.
- S5. A reserved table can be released (cancelling the reservation) and seated when the guests arrive (it becomes occupied and the reservation is cleared). Both from every role that can reserve.
- S6. Light and dark at 390/768/1024/1440, no overflow, targets ≥ 44 px (phase rule).

## Tasks

- [ ] T1. DB + API (S1, S2, S3, S5): migration 0022, reserve / cancel / seat endpoints for admin, cashier and waiter, table DTO fields, tests. Route: worker; verify (contract + migration). Evidence: migration 0022 (backfill verified on 0000-0021 data), pgTAP 330 (22), API specs tables.reservations (23) + tables (26), lib/api/tables.test.ts; `POST /tables/:id/reserve`, release cancels, assign seats, PATCH `reservationName`. Commit: pending.
- [ ] T2. Reserve sheet and reserved-table display in the waiter view and admin (S1, S2, S3, S5, S6). Route: worker. Commit: pending.
- [ ] T3. Caja "Mesas" view reusing the floor map and table panel (S4, S5, S6). Route: worker. Commit: pending.

## Log

- L1 (user, 2026-11-07): "Ese boton rapido de reservar no funciona, y de paso la reserva me gustaria que desde el admin o caja se pudiera reservar con nombre para saber a nombre de quien esta esa reserva" (screenshot: waiter table panel of Mesa 7, "Ocupada", "Valentina Cardona · sin sillas · Salón …", buttons "Agregar productos", "Reservar", "Liberar mesa").
- L2 (evidence, 2026-11-07): the button calls `handleReserveTable` (components/views/WaiterView.tsx), which opens `WaiterSelectionModal` and then `POST /tables/:id/assign`, which sets `status = 'occupied'`; nothing in the client sets `reserved`. Only admins can PATCH a table's status. The waiter view also refuses to release a reserved table ("No se puede liberar una mesa en estado reserved") while its panel offers "Liberar mesa" for it. No reservation name or time exists in the data model.
- L3 (user, 2026-11-07, answers): "¿En qué mesas debe aparecer?" → "Solo en mesas libres (Recomendado)"; "¿Qué se pide al reservar?" → "Nombre y hora"; "¿Quién puede reservar?" → "Admin, caja y meseros (Recomendado)"; "¿Dónde reserva el cajero?" → "Plano de mesas en caja (Recomendado)".
- L4 (decision, 2026-11-07): name 1..80 characters, trimmed; arrival time optional, today or later, shown as "8:30 p. m." in the restaurant's timezone. Seating a reserved table goes through the existing assign (open table) path, which clears the reservation. Releasing a reserved table cancels it. Reserving needs the table to be free (409 `table_not_available` otherwise).
- L5 (decision, 2026-11-07): tables already `reserved` before 0022 (admin PATCH, no name) are backfilled with `reservation_name = 'Sin nombre'` (`reserved_at` = their `updated_at`, `reserved_by` NULL, shown as no author) before `tables_reservation_check` is added fully validated. A NOT VALID CHECK was rejected: Postgres still checks it on every later UPDATE of those rows, so renumbering or moving a legacy reserved table would fail. Admin PATCH accepts `reservationName`/`reservationArrivalAt` with `status: reserved` (422 `reservation_name_required` without a name when the table is not already reserved) and clears them on any other status. `reserved` is no longer in the release guard: every floor role may cancel a reservation.
