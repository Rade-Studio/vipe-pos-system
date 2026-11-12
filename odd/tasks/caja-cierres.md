# Caja: arqueo, cierres por día y período, informe Z

Implements the chosen design `design/caja-cierres/` (brief in `design/caja-cierres/brief.md`): the cashier's shift close with arqueo, the admin day view (tablero 02 as the main view, libro 03 as a detail tab), the period summary (04), and the closing slips (06). Branch `feat/caja-cierres` from `dev` (e5b5564). Three phases, each delivered on its own.

## Specs

Phase 1 — arqueo y cierre de turno
- S1 (L1, L3): closing a register records the count. `POST /registers/:id/close` takes `countedCash` (whole pesos, >= 0), required while the register is open (422 `counted_cash_required`). It optionally takes `denominations: [{ value, quantity }]`, where value is one of 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100 or 50 and quantity is an integer >= 0. When given, their sum must equal `countedCash` (422 `count_mismatch`). The difference is `countedCash − expected` (expected = `expected_cash_after_tips`). When it is not 0, `note` (3–300 characters, trimmed) is required (422 `note_required`). The register stores `counted_cash`, `cash_difference`, `close_note`, `denominations` and `closed_by` (the caller). `final_cash` keeps its meaning (expected after tips). The close result and every register read return `countedCash`, `cashDifference`, `closeNote`, `denominations` and `closedBy {id, name}`. `leaveOpenOrders` and the 409 `open_orders` gate work as today. An already closed register keeps answering as today.
- S2 (L1): every cash movement has a reason and an author. `POST /registers/:id/cash-transactions` requires `reason`, one of `change_fund` "Sencillo / base", `supplier` "Pago a proveedor", `petty_cash` "Caja menor", `tips_payout` "Propinas pagadas", `safe_deposit` "Caja fuerte / consignación" or `other` "Otro" (422 when missing or unknown). `other` requires `description`. The movement stores `created_by`, and lists return `reason` and `createdBy {id, name}`. Older movements read `reason: null` and `createdBy: null`.
- S3 (design 05): the cashier's "Cerrar turno" is a guided dialog in four steps:
  1. **Órdenes abiertas**, as today.
  2. **Movimientos y propinas**: the shift's entries and withdrawals with reason and author, and the tips to pay out.
  3. **Arqueo**: a grid of bills and coins with 44 px steppers and a live total, plus a switch "Arqueo rápido: solo total" that takes a single amount. A side card shows esperado, contado and the difference as Cuadra, Sobrante or Faltante; a note is required when the difference is not 0.
  4. **Confirmar**: a summary, "Imprimir cierre de turno" and "Cerrar turno".

  The add-cash and withdraw-cash dialogs ask for the reason.
- S4 (design 06): two slips print from the browser at 80 mm, with a 58 mm variant, using the business name and data from settings. "Informe X" can be printed at any time from the cashier header; it is a partial summary of the open shift and resets nothing. "Cierre de turno" prints from the close dialog and after closing; it includes the arqueo by denomination, the expected, counted and difference amounts, the note, and signature lines for Cajero and Supervisor.

Phase 2 — the admin's day and period
- S5: a business day groups registers by their opening time in the restaurant's timezone, moved back by a configurable cut-off hour (`businessDayCutoffHour`, 0–6, default 4): a register opened at 1:00 a.m. belongs to the previous day. Every admin cash figure uses this rule.
- S6: the admin Caja page has two views, Día and Período. Día shows the tablero (design 02) and a Libro tab (design 03). Período shows design 04. The page fixes the problems listed in the brief:
  - order number and table instead of raw ids;
  - the real waiter and cashier names;
  - every payment method;
  - movements shown once, with who made them;
  - correct sales totals;
  - no nested tabs.

  New API endpoints serve the day summary, the day ledger with a running cash balance, and the period report grouped by day, week or month, with a comparison against the previous period.
- S7: an admin validates a closed shift ("Validar turno"); the register stores `validated_by` and `validated_at`, and the day view shows them.

Phase 3 — Z and fiscal details
- S8: "Emitir informe Z" for a business day with every register closed. Z numbers are consecutive per restaurant; a Z stores a snapshot of the day, who emitted it and when. It can be reprinted, and the period view lists the Zs and flags any gap in the numbering. A day with an open register cannot get a Z (409).
- S9: the tax type is configurable: "INC" (impuesto nacional al consumo) or "IVA". Bills, slips and reports show that label instead of the hard-coded "IVA".
- S10: tips are reported per waiter in the day view, the period view and the Z, and always outside sales and the tax base (Ley 1935 de 2018).

## Tasks

- [x] T1. S1, S2: migration 0025, close contract, movement reasons, integration and pgTAP tests, OpenAPI, minimal dialogs (count input, reason select). Route: worker. Commit: see git log. RED: registers spec 17/27 failed, web 20 failed. GREEN: API 59 files / 820; cashier+store+lib/api 358; test:db 45 files / 2084 PASS (pgTAP 360 written after the migration, no RED); typecheck, api typecheck, api lint clean.
- [ ] T2. S3, S4: cashier close wizard, movement reason fields, Informe X and cierre de turno slips. Route: worker (after T1). Commit: -
- [ ] T3. S5, S6, S7: business day rule, admin day/ledger/period endpoints and pages, validate shift. Route: workers. Commit: -
- [ ] T4. S8, S9, S10: Z reports, tax type, tips per waiter. Route: workers. Commit: -

## Log

- L1 (user, 2026-11-11): "Actualmente no me gusta nada de como se ve la caja en administradores, el detalle de como se movio x plata, ciertas ventas, etc. Quisiera organizar ese diseño y ver que flujo tinee la caja (cajero) y que todo lleve su proceso bien estructurado, entender un flujo de restaurante grande y tambien uno pequeÑo quiero hacer el sistema entendible"; "y no me mencionaste el diseño del resumen de cierre de cada dia, mes, etc como lo va a ver el administrador"; "Tambien debemos soportar el como hacen los cierres los restaurante, que tirillas salen, con respecto al cierre que informacion normalmente estan acostumbrados a ver, etc"
- L2 (user, 2026-11-11): "Listo, implementemos eso", after the recommendation: the tablero (02) as the main day view, the libro (03) as a detail tab, built in three phases.
- L3 (decision, 2026-11-11): supervisor validation is not asked at close (a small restaurant has no second person at night); the admin validates a closed shift afterwards (S7). Several registers open at once (large restaurants) stay out of scope: it changes the one-open-register rule (0009).
- L4 (evidence, 2026-11-11): today `close_register` sets `final_cash = expected_cash_after_tips` and stores no count. The shift sheet's "Efectivo contado" is display only. Deposits take no reason. There is no `closed_by`, movement author, Z report or closing print. Dashboard, Caja and cashier use three different "day" rules. Colombia: DIAN no longer requires the daily POS report (Concepto 6259/2024), so the Z is internal control. Restaurants mostly charge INC 8 %, but the app hard-codes "IVA" with one rate. Tips are voluntary, outside sales and the tax base, and belong to staff.
- L5 (evidence, 2026-11-11): T1. The count is stored by the API in the close transaction after `close_register` (lock FOR UPDATE, then counted_cash / cash_difference / close_note / denominations / closed_by = private.current_profile_id()); note_required rolls the close back; an already_closed replay never overwrites. Movements: reason (six codes) and created_by (default current profile). Open for T2: the close dialog turns the server's 422 messages into a generic error.
