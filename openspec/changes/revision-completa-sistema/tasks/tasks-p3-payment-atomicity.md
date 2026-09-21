# Tasks: P3 — Payment & Order Atomicity

## Phase Goal
Wrap `completePayment` and `deleteOrder` in atomic Postgres transactions (`SELECT FOR UPDATE` + idempotency); create the missing `ingredient_transactions_orders` junction table; enforce `ON DELETE CASCADE` on `order_items.order_id`; eliminate double-pay.

## PR Slice Recommendation
- **One PR** (P3). Estimated ~330 changed lines, under the 400-line budget.
- **Branch base**: `main` per `stacked-to-main`. PR branch: `sdd/revision-completa-sistema/p3-payment-atomicity`.
- P3 can land in parallel with P2 in CI (no shared file edits) but should not merge to `main` before P2 — P3's RPC relies on `restaurant_id` columns and on the `auth.uid()` join from P2.

## Tasks

### T3-01 — Create `ingredient_transactions_orders` junction table
- **description**: Migration creates `ingredient_transactions_orders(id uuid pk, order_id uuid references orders(id) on delete cascade, ingredient_transaction_id uuid references ingredient_transactions(id) on delete cascade, quantity_cents bigint not null, created_at, unique(order_id, ingredient_transaction_id))`. Closes HS-07. The FKs are `ON DELETE CASCADE` so `delete_order_with_items` (T3-03) does not need to manually delete junction rows.
- **touches**: [`supabase/migrations/20250917090006_create_ingredient_transactions_orders.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "\d ingredient_transactions_orders"` → table exists with both FKs.
- **acceptance_criteria**: [a] migration applies; [b] `INSERT INTO ingredient_transactions_orders (order_id, ingredient_transaction_id) VALUES (...)` succeeds when both parents exist; [c] re-running is a no-op.
- **depends_on**: []
- **size_lines_estimate**: ~15 lines
- **commit_split_hint**: Single commit: `feat(db): create ingredient_transactions_orders junction table`.
- **spec_refs**: R3-04 / S3-05.

### T3-02 — `complete_payment` Postgres function with FOR UPDATE + idempotency
- **description**: Migration creates `public.complete_payment(p_order_id uuid, p_payment_methods text[], p_cash_register_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`. Resolves caller restaurant via `profiles WHERE auth_user_id = auth.uid()`, raises if null. Acquires `SELECT ... FOR UPDATE` on the order. Idempotent: if `status='paid'`, returns existing row without inserting. Validates status in `('active','kitchen')`. Inserts one `payment_transactions` row per method, updates order to `'paid'`, frees the table. Returns `{status, change_cents, payment_rows}`. Computes tax/tip server-side (Q3-A).
- **touches**: [`supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "SELECT proname FROM pg_proc WHERE proname='complete_payment';"` → one row. `pnpm verify:p3` exercises the happy path + idempotency + double-tap.
- **acceptance_criteria**: [a] function exists; [b] happy path returns `{status:'paid'}` and writes 1+ `payment_transactions` rows + frees table; [c] second call returns `{status:'already_paid'}` with zero new rows; [d] concurrent calls produce exactly one row (verified via two psql sessions).
- **depends_on**: [T3-01]
- **size_lines_estimate**: ~80 lines
- **commit_split_hint**: Single commit: `feat(db): atomic complete_payment function with FOR UPDATE + idempotency`.
- **spec_refs**: R3-01, R3-02 / S3-01, S3-02, S3-03.

### T3-03 — `delete_order_with_items` function + `ON DELETE CASCADE` on `order_items.order_id`
- **description**: Migration adds `ON DELETE CASCADE` to `order_items.order_id` FK. Creates `public.delete_order_with_items(p_order_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` that: resolves caller restaurant, locks order with `FOR UPDATE`, deletes order_items, deletes junction rows, deletes order. Atomic — all in one transaction. Fixes HS-06.
- **touches**: [`supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql`]
- **command**: `pnpm verify:p3` exercises: create order + 3 items + 2 junction rows → call function → all four counts = 0.
- **acceptance_criteria**: [a] function exists; [b] deletes order + items + junction rows in one tx; [c] FK CASCADE on `order_items.order_id` enforces the invariant at the DB; [d] no orphan rows.
- **depends_on**: [T3-01, T3-02]
- **size_lines_estimate**: ~50 lines
- **commit_split_hint**: Single commit: `feat(db): atomic delete_order_with_items function + FK CASCADE`.
- **spec_refs**: R3-03 / S3-04.

### T3-04 — Refactor `lib/supabase/service.ts` to call `complete_payment` RPC instead of two-step pattern
- **description**: Replace the two-step `completePayment()` in `lib/supabase/service.ts` with a single `supabase.rpc('complete_payment', {p_order_id, p_payment_methods, p_cash_register_id})` call. Replace the manual `deleteOrder` block (lines ~1141–1222) with a single `supabase.rpc('delete_order_with_items', {p_order_id})`. Keep the function signatures backward-compatible so call sites don't change.
- **touches**: [`lib/supabase/service.ts`]
- **command**: `pnpm tsc --noEmit` exits 0; manual: trigger payment from CashierView → exactly one `payment_transactions` row.
- **acceptance_criteria**: [a] `service.ts.completePayment` calls the RPC; [b] `service.ts.deleteOrder` calls the RPC; [c] no client-side transaction wrapping; [d] error handling maps RPC errors to user-friendly Spanish toast messages.
- **depends_on**: [T3-02, T3-03]
- **size_lines_estimate**: ~60 lines (replace ~120 lines with ~60)
- **commit_split_hint**: Single commit: `refactor(payments): call complete_payment + delete_order_with_items RPCs`.
- **spec_refs**: R3-01, R3-03 / S3-01, S3-04.

### T3-05 — Update `PaymentMethodDialog` to use a single RPC call (multi-payment)
- **description**: Refactor `components/pos/PaymentMethodDialog.tsx` to build a single `paymentMethods` array (e.g. `['cash:50000','card:25000']`) and call the new RPC once. Removes the previous `addTransaction` then `completePayment` sequence that produced two round-trips and could partially commit. Fixes HS-25.
- **touches**: [`components/pos/PaymentMethodDialog.tsx`]
- **command**: `pnpm verify:p3` runs the multi-method test: `['cash:50000','card:25000']` → 2 `payment_transactions` rows + `status='paid'`.
- **acceptance_criteria**: [a] single RPC call from the dialog; [b] multi-method produces N rows; [c] no double-fire on click; [d] UI toasts match the response status (`paid` vs `already_paid`).
- **depends_on**: [T3-04]
- **size_lines_estimate**: ~40 lines
- **commit_split_hint**: Single commit: `feat(payments): single RPC call from PaymentMethodDialog`.
- **spec_refs**: R3-05 / S3-06.

### T3-06 — Idempotency + concurrency smoke test harness
- **description**: Add `pnpm verify:p3` script that (1) inserts a test order + items via psql, (2) calls `complete_payment` once, (3) calls it again — asserts exactly one `payment_transactions` row. Also runs two concurrent calls in separate psql sessions against the same order id — asserts exactly one row total. Documents the test recipe in `docs/payment-atomicity-test.md`.
- **touches**: [`package.json`, `docs/payment-atomicity-test.md`]
- **command**: `pnpm verify:p3`.
- **acceptance_criteria**: [a] single-call returns 1 row; [b] repeat call returns 0 new rows; [c] concurrent calls produce exactly 1 row (the first one wins, second returns `already_paid`).
- **depends_on**: [T3-02, T3-03, T3-04, T3-05]
- **size_lines_estimate**: ~40 lines
- **commit_split_hint**: Single commit: `chore(verify): add p3 payment-atomicity smoke harness`.
- **spec_refs**: R3-01, R3-02, R3-05 / S3-02, S3-03, S3-06.

## Verification (apply agent will run)
```
docker compose down -v && docker compose up -d
supabase db reset
pnpm docker:dev:seed
pnpm verify:p3
# Expect: idempotency OK, concurrent calls produce 1 row, multi-method produces N rows.
```

## Known environmental failures
- `pnpm docker:dev:seed` must run after the migrations land; the seed inserts orders and the smoke harness depends on them.
- The `inventory-control-service.ts:481` insert path into `ingredient_transactions_orders` (T3-01 prerequisite) must be updated in a follow-up — outside this phase's strict scope but referenced by S3-05. If unupdated, the link table will exist but unused.

## Rollback Plan
1. `git revert <merge-sha>` — reverts migration + service.ts + dialog in one commit.
2. Surgical: `DROP FUNCTION complete_payment(uuid, text[], uuid); DROP FUNCTION delete_order_with_items(uuid); ALTER TABLE order_items DROP CONSTRAINT order_items_order_id_fkey; ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);` (restores no-action default).

## Out-of-phase items
- Updating `inventory-control-service.ts` to actually insert into `ingredient_transactions_orders` (the table exists, the wiring is a follow-up so the test S3-05 only proves the schema).
- Replacing the legacy `cashRegisterService.addTransaction` direct call from SSR paths (covered in P6 store cleanup).
- Issuing `invoiceNumber` from a server-side sequence (`gen_random_uuid()` already covers P3; human-readable INV-{year}{seq} deferred).
- `stock_violation` audit events when `Math.max(0, ...)` clamps inventory to zero (HS-20, deferred).
