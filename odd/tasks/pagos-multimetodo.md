# Feature: pagos-multimetodo

Branch: `feat/pagos-multimetodo` (cut from `feat/base-esquema-seguridad` tip `f3bb5a7`, stacked on PR #74)
Worktree: `../vipe-pos-system-worktrees/pagos-multimetodo`
Engram mirror: `odd/pagos-multimetodo/tasks`

## Goal

Replace the hardcoded 4-method payment flow and the broken `complete_payment` RPC with a
data-driven payment-method catalog, multi-tender payments with a live "remaining" amount,
an explicit tip amount (surplus can become tip instead of change), and atomic server-side
split/undo of partial payments.

## Decisions (user, 2026-10-06)

- Tip: suggested from `tip_percentage` and preloaded as an amount; cashier can set 0, any
  amount, or "surplus is tip". Tip is persisted.
- Partial payments: redesign now - split and undo become atomic SQL functions.
- Catalog: admin screen to create/disable/reorder methods; no payment reference field.
- Cash drawer: warn only. Payment is recorded even if the drawer lacks change; the RPC
  returns a warning the UI shows.
- Money: whole COP pesos (integer) in new tables.
- Tests: pgTAP for SQL (`pnpm test:db`), Vitest for pure payment logic in `lib/payments`.
- Register summary (task 8): legacy `payment_transactions` shown as a separate read-only
  section, never part of new expected cash; the server computes final cash at close
  (`close_register`); tips are paid to waiters at close, so they are deducted from the
  expected cash as a payout; multi-register (per-day) totals sum each register's initial cash.

## Tasks

- [x] 1. Pin the 14 `latest` dependency specifiers to the locked versions, then add Vitest
      (+ config, `pnpm test`) without lockfile drift; CI runs `pnpm test`.
- [x] 2. `payment_methods` catalog (per tenant, RLS read same-tenant, admin-only write,
      seeded with cash/transfer/nequi/bancolombia for every restaurant and new restaurants).
- [x] 3. `payments` + `payment_tenders` tables (integer pesos, RLS, tenant-scoped), legacy
      `payment_transactions` kept read-only for history.
- [x] 4. `pay_order` RPC: atomic, idempotent, validates tenant/open register/order status,
      paid = due + tip, only cash yields change, drawer-shortage warning, table release only
      when no open orders remain; drop `complete_payment` and update pinned tests.
- [x] 5. Atomic `split_order` / `undo_split` RPCs (items by id, totals recomputed server-side).
- [x] 6. `lib/payments` pure logic (tenders, remaining, suggested tip, surplus-as-tip, change)
      with Vitest; services for catalog, pay, split/undo; single payment-method type.
- [x] 7. New payment dialog + CashierView integration (tenders, remaining, tip, warning),
      partial-payment dialogs on the new RPCs.
- [x] 8. Register summary, transaction lists, close-register and admin reports grouped by
      catalog (server-side summary). Regression since 7a: the client summary reads only
      legacy `payment_transactions`, so `pay_order` sales are missing from closing totals.
  - [x] 8a. SQL: `register_summary(uuid[])` + `close_register(uuid)` RPCs, pgTAP 090.
  - [x] 8b. Client: service wrappers, store, close dialog, status/add/withdraw cash,
        payment-dialog drawer check, admin summary.
  - [x] 8c. Transaction lists (TransactionsList, TransactionsByRegisterId, CSV), completed
        orders method label (lib/supabase/service.ts), retire legacy payment_transactions writers.
- [x] 9. Admin payment-methods screen (create, rename, disable, reorder).
- [x] 10. Invoices (web print, `lib/print`, `pos/` Python) list tenders, tip and change.
  - [x] 10a. Web + lib/print: invoice tenders from the server pay_order result and the ledger
        (reprints), catalog names resolved before broadcast, fix 7a label bug (single non-cash
        line printed as cash). Additive payload: keep paymentMethod/cashReceived/cashChange.
  - [x] 10b. pos/print_renderer.py prints tenders when present (stdlib unittest), README
        note: installed listeners keep the old single-label ticket until rebuilt.
- [x] 11. Rewrite `docs/payment-atomicity-test.md` for the new flow.

## Known follow-ups (out of scope)

- CI does not run pos/test_print_renderer.py yet (stdlib unittest, no deps).
- Python legacy label prints "Multiple" while TS prints "MÚLTIPLES" (pre-existing).

- components/views/CashierView.tsx showInvoice is dead code (no callers).

- pos/app.py:617-689 generate_invoice_pos/obtener_texto_pago are dead code.

- Completed-orders invoice shows a non-default method by its code (e.g. datafono) until task 10 prints tenders with their names.

- CSV export columns changed (new ledger shape plus a legacy block); spreadsheet templates may need re-mapping.

- register-summary.ts cleanups from RDD 8b: dead `continue` after fail() in the legacy by_method loop; derive the method kind check from one constant; split the summaryRows active/zero test.

- Regenerate types/supabase.ts against the new migrations (still lists complete_payment; services cast rpc as any).
- pickSplitParent returns null when a table has two splittable non-partial orders; the cashier sees an error toast.

- Task 7 UI must disable the split button while `split_order` runs: a second call on the same
  parent is serialized by the lock but would create another child with the remaining items.

- Merge conflicts expected with the realtime chain (`st-test-runner` also adds Vitest).

## Evidence log

| Task | Commit | Checks |
|---|---|---|
| 1 | `14138b0` | 14 `latest` specifiers pinned to locked versions: lockfile `version:` diff shows only the new vitest entry. RED: `pnpm test` failed (module missing); GREEN: 2 files / 5 tests. `pnpm install --frozen-lockfile` ok, typecheck 0, lint 0. CI `unit-tests` job added. RDD lineage `review-39f41315605aae28`: 4 lenses (readability refused once for a misspelled path, retry ok) -> **approved**, acknowledged; 23 informational findings. |
| 2 | `6108ed5` | RED: `050_payment_methods` 57/58 failed. GREEN: Files=7 Tests=217 PASS (incl. 020 anon lockdown); db reset clean. Orchestrator hardening: revoked default-ACL EXECUTE of authenticated on the three trigger functions (SECURITY DEFINER seeder reachable only via trigger); triggers still fire (050 green). RDD lineage `review-8abc3f5bc3851ea0` (medium, reliability): **approved** first try, acknowledged; 1 informational suggestion. |
| 3 | (this commit) | RED: `060_payments_tenders` 94/104 failed. GREEN: Files=8 Tests=323 PASS; real COMMIT of a 999/1000 payment rejected 23514 with 0 rows left. Deviation accepted: write grants kept for authenticated (020 contract) but no INSERT policy (42501) and UPDATE/DELETE hit a guard raising 42501, so tampering fails loudly instead of silently affecting 0 rows. pay_order must run as postgres-owned SECURITY DEFINER and snapshot method_code/kind from the catalog. |
| 4 | `75c007d` | RED: `070_pay_order` 56/57 failed (function missing). GREEN: Files=9 Tests=381 PASS; db reset clean (36 migrations). Orchestrator check: tenant/role resolved before any write; order locked FOR UPDATE (concurrent double charge serialized), register FOR SHARE; anon/PUBLIC revoked; complete_payment dropped and its pinned tests (001/020) moved to pay_order. Contract: errors 42501 (role/profile), P0002 (order not found, incl. other tenant), P0001 (business rule), 22023 (bad input); replay returns status already_paid. RDD lineage `review-7d6341eaf123fb7e` (medium, reliability): 5 CRITICAL claimed; verified 4 false (tenant check precedes payment lookup; message has tender index; SUM without GROUP BY adds initial cash once; tenant check precedes active check) and 1 real (no cap on tender lines). Correction `aa0a092` (75 of 80 lines): cap 20 lines (RED then GREEN) + 4 regression tests green before the fix proving the false claims (drawer_cash_before exact 83892). 386/386 PASS. Validator rejected -> escalated `targeted_validator_rejected` (false findings cannot be fixed in code). |
| 5 | `257e24f` | Worker interrupted by a session crash; orchestrator finished it: removed leftover debug NOTICEs, fixed duplicate detection (`array_length` of an empty array is NULL -> `array_position`), fixed test fixtures (non-hex uuid, duplicate e004 insert -> UPDATE as postgres, integration tip 5000 = 10% suggested on 54000 due), plan 108 -> 70 (all required cases present). RED reproduced: without the migration 70/70 fail (`split_order` does not exist). GREEN: Files=10 Tests=456 PASS. RDD lineage `review-3b24a44f94602432` (medium, reliability + refuter): correction_required on R3-split-deadlock-races, verified FALSE (both functions lock the parent order first; the in-loop lock is on order_items). Live two-session probe: undo_split waited 3.5 s on an open split_order then succeeded, no 40P01, quantities conserved (7), parent total 82600 exact. Correction `381b9e2` (10 of 12 lines): lock-order invariant documented. Validator: 529 overload, retry returned invalid JSON -> left without verdict. |
| 6 | `5cd7925` | First worker run failed before writing (transient assistant error); retry completed. RED: each test file failed with module missing before its implementation. GREEN: Vitest 5 files / 49 tests; typecheck 0; lint 0 (pre-existing warnings only). Orchestrator check: bill rounding `(subtotal * pct) / 100` matches Postgres half-up for 1,000,000 subtotals (0 mismatches). Service RPCs use `as any` until types/supabase.ts is regenerated (follow-up). RDD lineage `review-10ae07f1edb86198` (high): risk, resilience, readability admitted; reliability refused twice (invalid JSON). Read its 12 claims manually: 10 describe intended design (state still computed, submit gated by issues); 2 real -> follow-up commit 6b: decimal price float drift vs Postgres (137 mismatches, e.g. 4.10 x 15 = 61 vs 62) and null RPC payload throwing TypeError. |
| 6b | `d5d3af4` | RED: 2 failing tests (61 != 62; TypeError instead of PaymentServiceError). GREEN: 51/51, typecheck 0; parity re-check 0 mismatches over 200,000 prices x 20 quantities. RDD lineage `review-9713bc02435b43ab` (high, 4 lenses + refuter): correction_required on R3-requireData-coercion (real: `{}` returned a payment of undefined fields as success). Correction `ee4c2b6` (18 of 20 lines, RED then GREEN 52/52): require each RPC's key field. Validator **approved**, acknowledged. |
| 7a | `6254654` | New multi-tender PaymentMethodDialog on a pure reducer (lib/payments/draft.ts). RED: draft tests failed (module missing), 2 partial-red rounds fixed. Orchestrator: idempotency fallback produced an all-zero key without getRandomValues (every later payment would replay the first) -> extracted newIdempotencyKey (canonical v4, throws without randomness), RED then GREEN. Vitest 7 files / 83 tests; typecheck 0; lint no new; build OK. Removed: 4 hardcoded methods, "multiple" radio, unpersisted tip switch, completePaymentRpc + broken completePartialPayment double call. Manual UI check pending (user). RDD lineage `review-4077deb9425d9172` (high): risk, resilience, reliability admitted; readability refused (invalid JSON) then native failure; escalated `unknown_causality` on 2 downgraded claims, both verified FALSE (receipt cashReceived = cash handed over and cashChange derives only from cash lines, so received - applied = change; error mapping self-described as correct). |
| 7b | `54cf754` | Partial payments on split_order/undo_split via pure lib/payments/split.ts (pickSplitParent, buildSplitItems). RED: module missing; GREEN Vitest 8 files / 100 tests; typecheck 0; build OK. Fixed: parent was tableOrders[0] (could be a partial child) and the dialog listed items of every order on the table. Split/undo buttons disabled while running. Removed dead legacy code (+141/-561): orderService.createPartialOrder/deletePartialOrder/completePaymentRpc/completePayment/completePartialPayment and the useOrderStore 8%/10% actions; grep shows 0 callers. |
| 7b RDD | review-52bbf4c9fa90da59 | 4 lenses admitted; refuter refuted R3-rollback-on-close then failed natively; state escalated (unknown_causality) on R2-cashier-split-error-message-table, R2-partial-payment-dialog-silent-guard, R3-busy-not-applied, R3-fragmenting-no-parent, R3-reentrancy, R4-split-dialog-stays-open-on-success, R4-split-parent-not-freed. Manual check: dialog closes on success (setPartialPaymentDialogOpen(false)); pickSplitParent ignores partial children, so the parent stays selectable after a split; busy disables both dialog buttons. Reentrancy guard uses React state (safe under React 19 discrete-event flush) but a ref guard is cheap hardening, tracked as follow-up. |
| 7c | `b1c215d` | RDD 7b follow-up: synchronous re-entrancy gate lib/payments/single-flight.ts (RED: module missing; GREEN 5 tests) wraps split and undo in CashierView; the partial order's Eliminar button is now disabled while undo runs (it never was: confirms R3-busy-not-applied). Vitest 9 files / 105 tests; typecheck 0; build OK. |
| 7c RDD | review-f9da7c7659d312e5 | risk, resilience, readability admitted; reliability refused (missing proof ref) then failed natively. Its rejected CRITICAL single-flight claim was retracted by the reviewer itself. Escalated (unknown_causality) on R2-stale-gate-closure-trap: false, gates are created once via useState(createSingleFlight) and isRunning() reads mutable state, not a render snapshot. |
| 8a | `5ffc0df` | register_summary(uuid[]) (INVOKER, STABLE, cashier/admin) + close_register(uuid) (DEFINER, tenant check before summary, FOR UPDATE vs pay_order FOR SHARE), migration 20261006140000. RED: 090 58/58 failed (functions missing). GREEN pgTAP 11 files / 519 tests (parent re-run). Expected cash equals pay_order drawer_cash_before; legacy payment_transactions reported separately; tips paid out at close (expected_cash_after_tips, not clamped). |
| 8a RDD | review-5d3d51ed16135316 + `3c526f4` | Medium tier, reliability lens admitted; refuter confirmed 5 findings -> correction_required. Verified: R3-001 wrong as written (duplicate check works, pinned by 090) but its block hid a real defect: the NULL-id check used count(*), which counts NULL rows, so it never fired (probe: count(*)=2, count(v)=1); fixed in 3c526f4 (2 diff lines), pgTAP 519 PASS after db reset. R3-002 (P0002 same for missing and foreign, correct), R3-003 (per-register rounding intended, matches pay_order), R3-004 (false: pay_order coalesces drawer_cash_before to initial_cash), R3-005 (hypothetical; tenant checked explicitly) are not defects. Targeted validator failed natively -> escalated targeted_validator_rejected (terminal). |
| 8b | `37e429b` | Client on register_summary/close_register: pure lib/payments/register-summary.ts (RED: module missing; GREEN 25 tests), service wrappers (+12 tests), useRegisterSummary hook invalidated after pay, deposit, withdrawal and close. Close dialog renders catalog rows, tips payout, non-blocking shortfall warning, legacy block, server final cash; single-flight confirm. Drawer check uses expected_cash. Removed calculateMultipleRegistersSummary, store getCurrentRegisterSummary/hasEnoughCashForChange (grep: 0 callers). Vitest 10 files / 142; typecheck 0; build OK. |
| 8b RDD | review-dc2284b94bbe10d7 | 4 lenses admitted; refuter corroborated R2-004, R3-002, R3-003, R4-tip-payout-mismatch and refuted R3-001, R3-007, then failed natively -> escalated (unknown_causality, 15 undecided). Verified: tip-payout warning is the user's warn-only decision; R2-004/R3-002/R3-003 are readability/maintainability (follow-ups); no-invalidation-on-deposit false (dialogs call onSuccess -> refreshSummary); no-rollback-on-failed-close false (store untouched on throw, retry gets already_closed); close-replay false (currentRegister null after close, server idempotent); stale cash_transactions tab is pre-existing (8c). |
| 8c | `15e9f46` | Transaction lists, CSV and completed-orders label on payments/payment_tenders via pure lib/payments/payment-list.ts (RED: module missing; GREEN 23 tests) and listRegisterPayments/getPaymentsByOrderIds (+7 tests); legacy rows in a collapsed read-only section; Movimientos tab refetches on open; payments list invalidated with the summary after pay, deposit, withdrawal and close. Removed legacy writers (store addTransaction, cashRegisterService.addTransaction), calculateRegisterSummary and the CashRegisterSummary types; grep shows no writer to payment_transactions. Vitest 11 files / 172; typecheck 0; build OK. |
| 8c RDD | review-c4b83ae31d212552 | risk, resilience admitted; readability refused (invalid JSON) then admitted on retry; reliability refused twice at admission (location without line, evidence path out of scope) -> retry budget spent, lineage left open in reviewing. Read both rejected payloads: R3-vitest-disabled is a note (no skip/only); CSV collapse claim false (sums per payment_method_id); fallback-mask false (failed read -> [] -> legacy label); invoice label coercion to "cash" for non-default codes is real -> fixed in the next commit. |
| 8c fix | `cf0db1d` | invoicePaymentMethod in lib/payments/payment-list.ts (RED: not a function; GREEN 4 tests) replaces the getOrdersByDate branch that relabelled non-default catalog codes as cash; the invoice already renders unknown codes as-is. Vitest 11 files / 176; typecheck 0. |
| 8c fix RDD | review-c728d1be18067a6b | risk, resilience, readability admitted; reliability refused (CRITICAL without evidence_class; the claim itself confirms the fix is correct) then failed natively -> escalated (unknown_causality) on R3-getOrdersByDate-relabel-regression: not a regression, a non-default method now shows its own code instead of a false "cash". |
| 9 | `1baf541` | Admin "Métodos de pago" tab: pure lib/payments/catalog-admin.ts (slugifyMethodCode, validateMethodName, moveMethod, canDeactivate; RED: module missing; GREEN 35 tests) and create/update/reorder service mutations (+11 tests). No delete (history); last active method and last cash method cannot be deactivated. Cashier still offers active methods only (dialog filter + pay_order rejects inactive). Vitest 12 files / 222; typecheck 0; build OK. |
| 9 RDD | review-91bb59d275b2b9df | risk admitted; resilience refused (invalid JSON) then admitted; readability admitted; reliability refused twice (location without line; uppercase evidence class) -> retry spent, lineage left in reviewing. Rejected payloads read: second has no BLOCKER/CRITICAL; first is mostly noise (self-contradicting claims), one real: a failed reorder never reloaded the server order -> fixed in the next commit. |
| 9 fix | `ac71886` | Reload the catalog after a failed reorder (sequential updates may have partly landed). Component without jsdom: no meaningful RED; typecheck 0, lint clean, build OK. |
| 9 fix RDD | review-ca7d8c83f53b0ea4 | Medium tier, reliability lens admitted -> APPROVED; acknowledgement burned authority. Advisory only: no component test for the failed-reorder reload (no jsdom). |
| 10a | `12276f5` | Invoice tenders from the server: lib/payments/invoice-tenders.ts (RED: module missing; GREEN 12 tests incl. single-Nequi regression for the 7a bug that printed it as cash) and renderInvoice tender path (RED: change double-counted 6.000 vs 3.000; GREEN 7 tests). Reprints use the ledger payment kept by getOrdersByDate. Additive payload: tenders[] {methodCode, methodName, methodKind, amount, cashReceived} + change; legacy fields still set. Parent check: legacy renderInvoice output byte-identical to the previous version for 4 inputs. Vitest 14 files / 241; typecheck 0; build OK. |
| 10a RDD | review-9c33c7d0a295292d + `3df79bd` | risk, resilience admitted; readability refused (invalid JSON) then admitted; reliability refused (location without line) then admitted -> correction_required on 4 findings. Real: uncatalogued pay_order line with cash_received typed electronic (lost RECIBIDO/CAMBIO) and a failed catalog lookup on reprint silently dropped the breakdown; fixed in 3df79bd within the 40-line plan (RED: expected cash, got electronic; GREEN Vitest 242). Not defects: two cash lines are one method ("Efectivo" matches methodLabel); cashChange undefined at 0 mirrors the payment dialog. Targeted validator refused twice (result not bound to the correction request) -> retry spent, lineage left in correction_required. |
| 10b | `eed9df7` | pos/print_renderer.py prints FORMAS DE PAGO with per-cash RECIBIDO/CAMBIO and total CAMBIO when tenders are present; malformed tenders are skipped or fall back to the legacy block (never raises). stdlib unittest pos/test_print_renderer.py: RED 6 failures + 1 error, GREEN 11/11. Parent check: the 3 legacy byte snapshots also pass against the previous renderer (HEAD), so the old output is unchanged. README: installed listeners need a rebuild to show the breakdown. |
| 10b RDD | review-2f3dac43e4fca091 | Medium tier, reliability refused (invalid JSON) then failed natively -> retry spent, lineage left in reviewing. Rejected payload read: bool/float/cashReceived=0 claims are guarded or unreachable from the web; one real: when every tender was malformed the fallback printed "Efectivo" whenever cashReceived was set, overriding paymentMethod "multiple" -> fixed in the next commit. |
| 10b fix | `2f811a5` | Malformed-tender fallback keeps the sent paymentMethod label. RED: mixed payment printed FORMA DE PAGO: Efectivo; GREEN unittest 12/12. |
| 10b fix RDD | review-ba72269fbd0c0eb7 | Medium tier, reliability admitted -> APPROVED; acknowledgement burned authority. |
| 11 | `c6be878` | docs/payment-atomicity-test.md rewritten for the ledger flow (guarantee -> pgTAP file table, commands, UI smoke checklist, psql recipes). Documentation only, no RED. Parent fixes before commit: legacy payment_transactions columns (method/amount/timestamp), payments query no longer filtered by current_restaurant_id() (NULL as postgres), default methods (no card), reprint location (Admin, Factura), installed vs rebuilt listener behavior. Every psql query run against the local DB. |
| 11 RDD | review-2dce5dafe8183de2 | Low tier (non-executable only), approved without lenses; acknowledgement burned authority. |
| verify | (this commit) | Full branch verification (gentle-ai-verify): Vitest 14 files / 242, typecheck 0, lint 0 errors / 87 warnings, build OK, db reset + pgTAP 11 files / 519 PASS, Python unittest 12 OK. Found CI risk: workflow pinned Node 20 but vitest 5.0.3 (task 1) requires ^22.12 \|\| ^24; bumped the 4 Node jobs to Node 24, the version used for every local check. Not verifiable locally: pnpm 9 in CI vs pnpm 11 locally. |
