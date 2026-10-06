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
- [ ] 8. Register summary, transaction lists, close-register and admin reports grouped by
      catalog (server-side summary).
- [ ] 9. Admin payment-methods screen (create, rename, disable, reorder).
- [ ] 10. Invoices (web print, `lib/print`, `pos/` Python) list tenders, tip and change.
- [ ] 11. Rewrite `docs/payment-atomicity-test.md` for the new flow.

## Known follow-ups (out of scope)

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
