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
- [x] T2. S3, S4: cashier close wizard, Informe X and cierre de turno slips (browser print, 80 mm; 58 mm via paperMm prop, not wired). Route: worker (after T1). Commit: f37253a (plus b5a31d2: CashierView mocks spread the real modules, fixing 84 tests T1 broke). RED: modules missing, dialog 10/13, payments 4, store 2, status 1/2. GREEN: cashier/printing/views/store/lib 820 passed, 1 skipped; typecheck clean.
- [x] T3. S5, S6, S7: business day rule, admin day/ledger/period endpoints and pages, validate shift. Route: workers. T3a (API): f9d2b55. T3b (pages): Caja page Día (Tablero | Libro) and Período, cut-off hour in Negocio settings, old CashRegisterSummary / TransactionsByRegisterId / RegisterSelector removed; RED lib cash 14, CashPage 10/10, BusinessSettings 3; GREEN admin+lib/admin+hooks+lib/api+AdminView 80 files / 808; typecheck and eslint clean. Commit: see git log.
- [x] T4. S8, S9, S10: Z reports, tax type, tips per waiter. Route: workers. S8 API + UI + Z slip and S10 in the WIP commit (API 60 files / 848, web 178 files / 2074). Finish: pgTAP 020 test 22 now exempts z_reports UPDATE/DELETE (append-only by design, 0028 grants SELECT, INSERT); S9 remainder: CashRegisterStatus and CloseRegisterDialog pass `tax` (useTaxType + taxPercentage) to the Informe X and cierre de turno slips; renderInvoice takes optional `invoice.taxType` and prints `INC (8 %):` (legacy `IVA:` when absent), fed by InvoicePrintView. RED: status 1, dialog 1, renderInvoice 2 failed. GREEN: those files 17 + 26 passed. Checks in L12. Commit: delivered as PRs #181 (0029_z_reports), #182 (Z API), #183 (Z UI), #184 (tax type) and #185 (Z tax from orders); see L13.

## Log

- L1 (user, 2026-11-11): "Actualmente no me gusta nada de como se ve la caja en administradores, el detalle de como se movio x plata, ciertas ventas, etc. Quisiera organizar ese diseño y ver que flujo tinee la caja (cajero) y que todo lleve su proceso bien estructurado, entender un flujo de restaurante grande y tambien uno pequeÑo quiero hacer el sistema entendible"; "y no me mencionaste el diseño del resumen de cierre de cada dia, mes, etc como lo va a ver el administrador"; "Tambien debemos soportar el como hacen los cierres los restaurante, que tirillas salen, con respecto al cierre que informacion normalmente estan acostumbrados a ver, etc"
- L2 (user, 2026-11-11): "Listo, implementemos eso", after the recommendation: the tablero (02) as the main day view, the libro (03) as a detail tab, built in three phases.
- L3 (decision, 2026-11-11): supervisor validation is not asked at close (a small restaurant has no second person at night); the admin validates a closed shift afterwards (S7). Several registers open at once (large restaurants) stay out of scope: it changes the one-open-register rule (0009).
- L4 (evidence, 2026-11-11): today `close_register` sets `final_cash = expected_cash_after_tips` and stores no count. The shift sheet's "Efectivo contado" is display only. Deposits take no reason. There is no `closed_by`, movement author, Z report or closing print. Dashboard, Caja and cashier use three different "day" rules. Colombia: DIAN no longer requires the daily POS report (Concepto 6259/2024), so the Z is internal control. Restaurants mostly charge INC 8 %, but the app hard-codes "IVA" with one rate. Tips are voluntary, outside sales and the tax base, and belong to staff.
- L5 (evidence, 2026-11-11): T1. The count is stored by the API in the close transaction after `close_register` (lock FOR UPDATE, then counted_cash / cash_difference / close_note / denominations / closed_by = private.current_profile_id()); note_required rolls the close back; an already_closed replay never overwrites. Movements: reason (six codes) and created_by (default current profile). Open for T2: the close dialog turns the server's 422 messages into a generic error.
- L6 (evidence, 2026-11-11): T1's check list missed components/views; its CASH_MOVEMENT_REASONS import broke 84 CashierView tests whose mocks listed only the stubbed functions. Fixed in b5a31d2 by spreading the real module in the mocks. Slips print through a browser window (like KitchenOrderPrintView); the thermal print API has no endpoint for them yet.
- L7 (evidence, 2026-11-11): full web suite after phase 1: 212 files, 2330 passed, 1 skipped, 1 failed: CashierView.rebill "P4 realtime tip % change re-seeds the suggested tip". It passed twice when run alone, and T3a was editing files in parallel during the full run. Rerun the full suite before the PR; if it fails again, investigate it as a timing-dependent test.
- L8 (evidence, 2026-11-12): T3a. Business day = date((opening_timestamp AT TIME ZONE restaurants.timezone) - cutoff hours). RLS hides voided payments (0018), so ledger void entries are built from the payment_voids snapshot. Ledger cash balance per register ends at expected cash BEFORE the tips payout. Order cancellations are attributed to the register open at that moment (null when none). byCashier = register opener.
- L9 (evidence, 2026-11-12): T3b. The Caja page computes the default business day from the browser clock (the server applies the rule on the restaurant timezone). "Efectivo de ventas" in the cajón breakdown is derived (esperado − fondo − entradas + salidas + propinas pagadas). The Período chart draws the previous period as an average line. The Libro scrolls sideways on phones. BusinessSettings saves the cut-off through fetchConfig/saveConfig directly (the config store does not know the key). Not checked visually.
- L10 (evidence, 2026-11-12): paused for a computer shutdown. T4 work is in a WIP commit on feat/caja-cierres. Resume order: (1) fix pgTAP 020 test 22 for z_reports and rerun the isolated test:db (compose override container name + port, never the default project); (2) wire the tax label into the cashier slips and the thermal bill (S9); (3) full web + API suites (watch CashierView.rebill P4, L7); (4) renumber this branch's migrations 0025_register_count, 0026_cash_reports and 0027_z_reports to 0026, 0027 and 0028 after dev's 0025_production_daily (#164), with journal `when` values greater than 0025's; rebase on dev; (5) PR to dev, CI, merge, staging deploy. The Z's tax uses today's configured rate, not the rate each order was billed at.
- L11 (coordination, 2026-11-12): agreed with session vipepos-promociones (feat/promociones, worktree vipe-pos-system-worktrees/promociones, unmerged):
  - **Migrations:** whoever merges second renumbers on top of dev, with a journal `when` greater than dev's last.
  - **Discounts:** promotions adds `orders.total_discounts` (sum of `order_discounts.amount`, voided lines excluded). `orders.subtotal` becomes the NET base, so `payments.amount_due` is net, and gross sales = subtotal + total_discounts. Detail lives in `public.order_discounts` (kind, source automatic | manual, label, amount, reason, authorized_by).
  - **What the caja uses:** "Descuentos" in the day view and the Z = sum(orders.total_discounts) of paid orders; courtesies = source 'manual'.
  - **Fully discounted orders:** a 100 % discounted order closes with one cash tender of 0. Ticket and tender counts include it with amount 0.
  - **Expected merge conflicts:** schema.ts, _journal.json, openapi.json, schema.d.ts, InvoicePrintView.tsx (promotions adds discount lines, T10).
  - **Promotions does not modify:** pay_order, recompute_order_bill and split are not modified by caja-cierres.
- L12 (evidence, 2026-11-12): after merging dev (5273153), this branch's migrations are 0026_register_count, 0027_cash_reports and 0028_z_reports (after dev's 0025_production_daily); comments, COMMENT ON strings, pgTAP headers, DTO descriptions and lib/api comments renumbered; OpenAPI and schema.d.ts regenerated. Final checks: web vitest 219 files / 2435 passed, 1 skipped (CashierView.rebill P4 passed); typecheck clean; lint clean (warnings only); API vitest 61 files / 860 passed; api typecheck and api lint clean; isolated test:db 48 files / 2152 PASS.
- L13 (evidence, 2026-11-12): delivered to dev and staging as a chain of small PRs, because the native review could not read the whole branch at once (lens_context_budget_exceeded above ~1,400 changed lines):
  - **Phase 1–2 (cashier):** #165 count at close and movement reasons (0026_register_count), #166 Informe X and shift close slip, #172 four-step close wizard.
  - **Phase 3 (admin API):** #173 validate shift and cut-off hour (0027_cash_reports), #174 day summary, #175 ledger, #177 period report.
  - **Phase 3 (admin pages):** #178 day board and cut-off setting, #179 Caja page with Libro and Período, #180 old screens removed.
  - **Phase 4 (Z and tax):** #181 migration 0029_z_reports (renumbered after promociones' 0028_promotions_discounts from #176, journal `when` 1793896481411, snapshot chained to theirs), #182 Z API, #183 Z UI and slip, #184 INC/IVA tax type, #185 Z tax from the paid orders.
  - **Found during delivery:**
    - An independent check of the chain on top of promociones (API 949, web 2568/2570, pgTAP 2311 PASS) showed the Z worked its tax back out of net sales at today's rate, so delivery fees inflated the base and the tax. #185 sums the orders' stored subtotal and tax instead (RED: delivery and manual-discount tests).
    - The native review of #184 confirmed (refuter) that Zs issued before the tax type would reprint `undefined`; corrected in the same PR with a fallback to `Impuesto (N %)` and optional CashTaxes fields (RED/GREEN), approved by the targeted validator.
  - **Advisory follow-ups (non-blocking review findings):**
    - CSV cells starting with `=`/`+` are not escaped, and the separator ignores the locale.
    - A ledger load error shows as an empty list.
    - A Z can be issued before the cut-off hour of the day has passed.
    - The Z label shows the configured rate even when a day mixed rates.
    - The validate set-once race.
    - Who issued a Z is not shown.
