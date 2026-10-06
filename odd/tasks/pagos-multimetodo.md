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
- [ ] 6. `lib/payments` pure logic (tenders, remaining, suggested tip, surplus-as-tip, change)
      with Vitest; services for catalog, pay, split/undo; single payment-method type.
- [ ] 7. New payment dialog + CashierView integration (tenders, remaining, tip, warning),
      partial-payment dialogs on the new RPCs.
- [ ] 8. Register summary, transaction lists, close-register and admin reports grouped by
      catalog (server-side summary).
- [ ] 9. Admin payment-methods screen (create, rename, disable, reorder).
- [ ] 10. Invoices (web print, `lib/print`, `pos/` Python) list tenders, tip and change.
- [ ] 11. Rewrite `docs/payment-atomicity-test.md` for the new flow.

## Known follow-ups (out of scope)

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
