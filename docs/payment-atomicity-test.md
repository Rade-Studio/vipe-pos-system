# Payment Atomicity Test Recipes

> Manual test recipes for P3 Payment & Order Atomicity.
> Run against a live Supabase instance (`docker compose up -d`).
> These are smoke tests, not automated unit tests (`strict_tdd: false`).

## Prerequisites

```bash
# Reset DB and seed
docker compose down -v && docker compose up -d
supabase db reset
docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql

# Get a valid order ID for testing
ORDER_ID=$(docker exec -i supabase-db psql -U postgres -d postgres -t \
  -c "SELECT id FROM orders WHERE status IN ('active','kitchen') LIMIT 1;" | tr -d ' ')
echo "Testing with order: $ORDER_ID"
```

## Recipe 1: Happy Path — Single Payment

**Scenario**: S3-01 — Payment completes and frees table.

```sql
-- 1. Verify order is in 'kitchen' or 'active' status
SELECT id, status, bill_total_cents, table_id
FROM orders
WHERE id = '<ORDER_ID>';

-- 2. Call complete_payment RPC (single method)
DO $$
DECLARE
  result jsonb;
BEGIN
  result := public.complete_payment(
    p_order_id        => '<ORDER_ID>'::uuid,
    p_payment_methods => ARRAY['cash:50000'],
    p_cash_register_id => (
      SELECT cr.id FROM cash_registers cr
      JOIN profiles p ON p.restaurant_id = cr.restaurant_id
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1
    )::uuid
  );
  RAISE NOTICE 'Result: %', result;
END;
$$;

-- 3. Verify exactly one payment_transactions row was created
SELECT id, order_id, payment_method, amount_cents
FROM payment_transactions
WHERE order_id = '<ORDER_ID>';

-- Expected: 1 row, payment_method='cash', amount_cents=50000

-- 4. Verify order status is 'paid'
SELECT id, status FROM orders WHERE id = '<ORDER_ID>';
-- Expected: status = 'paid'

-- 5. Verify table is 'free'
SELECT id, status FROM tables
WHERE id = (SELECT table_id FROM orders WHERE id = '<ORDER_ID>');
-- Expected: status = 'free'
```

## Recipe 2: Idempotency — Second Call Returns `already_paid`

**Scenario**: S3-03 — Idempotent re-call is safe.

```sql
-- Given the order from Recipe 1 is now 'paid'
DO $$
DECLARE
  result jsonb;
BEGIN
  -- Call complete_payment again on the same order
  result := public.complete_payment(
    p_order_id        => '<ORDER_ID>'::uuid,
    p_payment_methods => ARRAY['cash:50000'],
    p_cash_register_id => (
      SELECT cr.id FROM cash_registers cr
      JOIN profiles p ON p.restaurant_id = cr.restaurant_id
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1
    )::uuid
  );
  RAISE NOTICE 'Second call result: %', result;
  -- Expected: result.status = 'already_paid', no new payment_transactions row
END;
$$;

-- 6. Verify exactly ONE payment_transactions row still exists (no duplicate)
SELECT count(*) AS payment_count
FROM payment_transactions
WHERE order_id = '<ORDER_ID>';
-- Expected: 1 (not 2)
```

## Recipe 3: Double-Tap — Concurrent Calls Produce One Row

**Scenario**: S3-02 — Two concurrent calls within the same 100ms window.

Requires two terminal sessions.

**Terminal A**:
```sql
BEGIN;
SELECT public.complete_payment(
  p_order_id        => '<ORDER_ID>'::uuid,
  p_payment_methods => ARRAY['cash:50000'],
  p_cash_register_id => '<CASH_REGISTER_ID>'::uuid
);
-- Do NOT commit yet
```

**Terminal B** (run immediately after Terminal A, before Terminal A commits):
```sql
-- This call will block on the FOR UPDATE row lock from Terminal A
SELECT public.complete_payment(
  p_order_id        => '<ORDER_ID>'::uuid,
  p_payment_methods => ARRAY['cash:50000'],
  p_cash_register_id => '<CASH_REGISTER_ID>'::uuid
);
-- Will return after Terminal A commits (serialized)
```

**Expected outcome**: Terminal B's call succeeds with `status: 'already_paid'`; exactly 1 `payment_transactions` row exists for the order.

**Cleanup**:
```sql
-- Terminal A: commit or rollback
COMMIT;  -- or ROLLBACK;
```

**Verification** (in a third terminal):
```sql
SELECT count(*) AS payment_count
FROM payment_transactions
WHERE order_id = '<ORDER_ID>';
-- Expected: 1
```

## Recipe 4: Multi-Method Payment — Two Payment Rows

**Scenario**: S3-06 — Cash + card payment is atomic.

```sql
-- Requires a new 'active' or 'kitchen' order
ORDER_ID_2=$(docker exec -i supabase-db psql -U postgres -d postgres -t \
  -c "SELECT id FROM orders WHERE status IN ('active','kitchen') LIMIT 1;" | tr -d ' ')
echo "Testing multi-method with order: $ORDER_ID_2"

DO $$
DECLARE
  result jsonb;
BEGIN
  result := public.complete_payment(
    p_order_id        => '<ORDER_ID_2>'::uuid,
    p_payment_methods => ARRAY['cash:30000', 'card:25000'],
    p_cash_register_id => '<CASH_REGISTER_ID>'::uuid
  );
  RAISE NOTICE 'Multi-method result: %', result;
END;
$$;

-- Verify exactly 2 payment_transactions rows
SELECT id, order_id, payment_method, amount_cents
FROM payment_transactions
WHERE order_id = '<ORDER_ID_2>'
ORDER BY created_at;

-- Expected: 2 rows — one for 'cash:30000', one for 'card:25000'
```

## Recipe 5: Atomic Delete — Cascade Removes All Children

**Scenario**: S3-04 — Order delete removes all children atomically.

```sql
-- 1. Create a test order with items for deletion
-- (Use an existing 'kitchen' order that can be safely deleted)
DELETE_ORDER_ID=$(docker exec -i supabase-db psql -U postgres -d postgres -t \
  -c "SELECT id FROM orders WHERE status = 'kitchen' LIMIT 1;" | tr -d ' ')
echo "Testing delete with order: $DELETE_ORDER_ID"

-- 2. Count items before delete
SELECT count(*) AS order_items_count
FROM order_items
WHERE order_id = '<DELETE_ORDER_ID>';

SELECT count(*) AS junction_rows_count
FROM ingredient_transactions_orders
WHERE order_id = '<DELETE_ORDER_ID>';

-- 3. Call delete_order_with_items
DO $$
BEGIN
  PERFORM public.delete_order_with_items('<DELETE_ORDER_ID>'::uuid);
  RAISE NOTICE 'Delete succeeded';
END;
$$;

-- 4. Verify all children are gone
SELECT count(*) AS remaining_order_items
FROM order_items
WHERE order_id = '<DELETE_ORDER_ID>';
-- Expected: 0

SELECT count(*) AS remaining_junction_rows
FROM ingredient_transactions_orders
WHERE order_id = '<DELETE_ORDER_ID>';
-- Expected: 0

SELECT count(*) AS order_still_exists
FROM orders
WHERE id = '<DELETE_ORDER_ID>';
-- Expected: 0 (order itself was deleted)
```

## Recipe 6: Cross-Tenant Rejection

**Scenario**: RLS enforcement — Tenant B cannot pay Tenant A's order.

```sql
-- Requires setting a different tenant's JWT claims
-- This simulates a user from restaurant B trying to pay an order from restaurant A

-- First, get tenant B's user and a tenant A order
SET request.jwt.claims = '{"sub":"<TENANT_B_USER_ID>","app_metadata":{"role":"cashier","restaurant_id":"<TENANT_B_RESTAURANT_ID>"}}';

-- Attempt to call complete_payment on tenant A's order
DO $$
DECLARE
  result jsonb;
BEGIN
  -- This should raise an exception: 'Forbidden: order belongs to another tenant'
  result := public.complete_payment(
    p_order_id        => '<TENANT_A_ORDER_ID>'::uuid,
    p_payment_methods => ARRAY['cash:50000'],
    p_cash_register_id => '<CASH_REGISTER_ID>'::uuid
  );
  -- If we get here without exception, the test failed
  RAISE EXCEPTION 'UNEXPECTED: cross-tenant payment succeeded when it should have been rejected';
EXCEPTION
  WHEN raise_exception THEN
    RAISE NOTICE 'Expected exception caught: %', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE 'Cross-tenant rejection confirmed: %', SQLERRM;
END;
$$;

RESET request.jwt.claims;
-- Expected: function raises 'Forbidden: order belongs to another tenant'
```

## Recipe 7: Order in Non-Payable Status Rejection

```sql
-- Attempt to pay an order that is already 'paid'
DO $$
DECLARE
  result jsonb;
BEGIN
  result := public.complete_payment(
    p_order_id        => '<ORDER_ID>'::uuid,  -- already 'paid' from Recipe 1
    p_payment_methods => ARRAY['cash:50000'],
    p_cash_register_id => '<CASH_REGISTER_ID>'::uuid
  );
  -- Should return 'already_paid' without error (idempotent)
  RAISE NOTICE 'Result on already-paid order: %', result;
END;
$$;
-- Expected: result.status = 'already_paid' (not an exception)
```

## RPC Interface Reference

### `complete_payment(p_order_id uuid, p_payment_methods text[], p_cash_register_id uuid) RETURNS jsonb`

| Field | Type | Description |
|-------|------|-------------|
| `p_order_id` | uuid | The order to complete payment for |
| `p_payment_methods` | text[] | Array of `'method:amount'` strings, e.g. `['cash:50000','card:25000']` |
| `p_cash_register_id` | uuid | Cash register ID for the transaction |

**Returns**:
- `status: 'paid'` — payment succeeded
- `status: 'already_paid'` — order already paid (idempotent)
- Raises exception on error (order not found, tenant mismatch, invalid status)

### `delete_order_with_items(p_order_id uuid) RETURNS void`

| Field | Type | Description |
|-------|------|-------------|
| `p_order_id` | uuid | The order to delete with all its items |

**Behavior**: Deletes `order_items`, `ingredient_transactions_orders` links, and the `orders` row atomically. Raises exception if order not found or access denied.
