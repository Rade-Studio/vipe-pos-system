# Delta for Payment and Order Atomicity (P3) — investigar-mesa-sync-realtime

## Purpose

Wrap `completePayment` and `deleteOrder` in atomic Postgres transactions; eliminate double-pay; create the missing `ingredient_transactions_orders` link table; enforce `ON DELETE CASCADE` on all FK child tables.

## ADDED Requirements

### Requirement: R3-01 — `complete_payment` Is Atomic

The system MUST provide a Postgres function `complete_payment(order_id uuid, payment_method text, amount numeric)` that executes as a single atomic transaction:

1. `SELECT ... FROM orders WHERE id = order_id FOR UPDATE` (row lock)
2. Validate order status is `'active'` or `'kitchen'`, not already `'paid'`
3. `UPDATE orders SET status = 'paid', updated_at = now() WHERE id = order_id`
4. `INSERT INTO payment_transactions (order_id, payment_method, amount, cash_register_id, ...)` with the caller's `restaurant_id`
5. `UPDATE tables SET status = 'free' WHERE id = order.table_id`

All steps MUST be in one `BEGIN...COMMIT` block. If any step throws, the entire transaction rolls back.

#### Scenario: R3-01-S1 — Happy path: payment completes and frees table

- GIVEN order X is in status `'kitchen'` on table 5
- WHEN `complete_payment(order_X, 'cash', 50000)` is called
- THEN exactly one `payment_transactions` row exists for `order_id = X`
- AND `orders.status = 'paid'` for order X
- AND `tables.status = 'free'` for table 5
- AND all three changes occur in a single committed transaction

#### Scenario: R3-01-S2 — Double-tap produces exactly one payment row

- GIVEN two concurrent calls to `complete_payment(order_X, 'cash', 50000)` arrive within the same 100 ms window
- WHEN both calls execute simultaneously
- THEN exactly one `payment_transactions` row is created for `order_X`
- AND `orders.status` is `'paid'`
- AND no error is returned to either caller (serialized by `FOR UPDATE`)

### Requirement: R3-02 — `complete_payment` Is Idempotent

If `order.status` is already `'paid'`, calling `complete_payment` again MUST return success without creating a duplicate `payment_transactions` row.

#### Scenario: R3-02-S1 — Idempotent re-call is safe

- GIVEN order X is already in status `'paid'`
- WHEN `complete_payment(order_X, 'cash', 50000)` is called again
- THEN the function returns success
- AND exactly zero new `payment_transactions` rows are created
- AND `orders.status` remains `'paid'`

### Requirement: R3-03 — Order Delete Cascades All Children

The system MUST provide a Postgres function `delete_order_with_items(order_id uuid)` that deletes in a single transaction:
1. `DELETE FROM order_items WHERE order_id = order_id`
2. `DELETE FROM ingredient_transactions_orders WHERE order_id = order_id` (via join subselect)
3. `DELETE FROM orders WHERE id = order_id`

`order_items.order_id` MUST have `ON DELETE CASCADE`. `cash_transactions.cash_register_id` MUST have `ON DELETE RESTRICT` (no cascade from cash register).

#### Scenario: R3-03-S1 — Order delete removes all children atomically

- GIVEN order X has 3 `order_items` rows, 2 `ingredient_transactions` linked via `ingredient_transactions_orders`
- WHEN `delete_order_with_items(order_X)` is called
- THEN `SELECT count(*) FROM order_items WHERE order_id = X` returns 0
- AND `SELECT count(*) FROM ingredient_transactions_orders WHERE order_id = X` returns 0
- AND `SELECT count(*) FROM orders WHERE id = X` returns 0
- AND no orphan `ingredient_transactions` rows exist

### Requirement: R3-04 — `ingredient_transactions_orders` Table Exists

The system MUST create `ingredient_transactions_orders` with:
- `order_id uuid references orders(id) on delete cascade`
- `ingredient_transaction_id uuid references ingredient_transactions(id) on delete cascade`
- `PRIMARY KEY (order_id, ingredient_transaction_id)`

#### Scenario: R3-04-S1 — Junction table links orders to ingredient consumption

- GIVEN an order that consumed 2 units of ingredient I
- WHEN `inventory-control-service` records `ingredient_transactions` for that order
- THEN rows are inserted into `ingredient_transactions_orders` linking each `ingredient_transaction` to the `order_id`
- AND the link is readable via `SELECT * FROM ingredient_transactions_orders WHERE order_id = X`

### Requirement: R3-05 — Multi-Payment Roundtrip Is Atomic

When a single order is paid using multiple payment methods (cash + card), the full sequence (both `payment_transactions` rows + `orders.status = 'paid'`) MUST be atomic.

The client MUST call a single `complete_payment` that accepts an array of payments, rather than making separate calls.

#### Scenario: R3-05-S1 — Multi-method payment atomicity

- GIVEN order X is in `'kitchen'` with total 75000; customer pays 50000 cash + 25000 card
- WHEN `complete_payment(order_X, ['cash:50000', 'card:25000'])` is called
- THEN exactly 2 `payment_transactions` rows exist for `order_X`
- AND `orders.status = 'paid'` for order X
- AND table is freed
- AND if either INSERT fails, zero `payment_transactions` rows exist and order status is unchanged

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Atomicity | All mutations MUST be in a Postgres transaction; no application-level rollback |
| Idempotency | `complete_payment` MUST NOT produce duplicate `payment_transactions` rows under any race condition |
| Performance | `complete_payment` MUST complete within 200 ms under normal load |
| Audit | Every state transition on `orders` MUST be reflected in `orders.updated_at` |

## MIGRATION / ROLLBACK

**Apply**: `supabase db reset` (same reset as P1/P2)

Key migration files:
- `supabase/migrations/20250917090006_create_ingredient_transactions_orders.sql`
- `supabase/migrations/20250917090008_complete_payment_and_delete_order_functions.sql`

**Rollback**: `DROP FUNCTION complete_payment(uuid, text, numeric);` and `DROP FUNCTION delete_order_with_items(uuid);`

## OUT OF SCOPE

- RLS policy design (P2)
- Realtime publication (P1)
- CI / build hardening (P4)
- React Query migration (P6)
