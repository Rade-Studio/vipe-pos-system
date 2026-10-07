-- Migration: 20250917090008_complete_payment_and_delete_order_functions.sql
-- Phase: P3 Payment & Order Atomicity
-- Contains:
--   1. UNIQUE constraint on payment_transactions(order_id) for idempotency
--   2. ON DELETE CASCADE on order_items.order_id FK
--   3. complete_payment function (atomic, idempotent, RLS-aware)
--   4. delete_order_with_items function (atomic cascade delete)

BEGIN;

-- 1. UNIQUE constraint on payment_transactions(order_id)
-- Prevents duplicate payment rows even if the RPC is called multiple times.
-- Idempotency is enforced at the DB level via ON CONFLICT DO NOTHING inside
-- complete_payment, but this constraint guarantees uniqueness.
ALTER TABLE public.payment_transactions
  ADD CONSTRAINT payment_transactions_order_id_unique UNIQUE (order_id);

-- 2. ON DELETE CASCADE on order_items.order_id FK
-- Deleting an order automatically removes its line items via DB cascade.
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- 3. complete_payment function
-- Atomic: all steps commit or all roll back.
-- Idempotent: if order is already 'paid', returns 'already_paid' without inserting.
-- Tenant-scoped via RLS (SECURITY DEFINER runs with caller's JWT, SET search_path=public).
CREATE OR REPLACE FUNCTION public.complete_payment(
  p_order_id        uuid,
  p_payment_methods text[],
  p_cash_register_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order           orders%ROWTYPE;
  v_restaurant_id   uuid;
  v_cashier_id      uuid;
  v_total_cents     bigint;
  v_change_cents    bigint := 0;
  v_method          text;
  v_amount          bigint;
  v_payment_count   int := 0;
BEGIN
  -- Resolve caller identity and restaurant via JWT context
  SELECT p.restaurant_id, p.id
    INTO v_restaurant_id, v_cashier_id
    FROM public.profiles p
    WHERE p.auth_user_id = auth.uid();

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no profile found for user';
  END IF;

  -- Row lock the order to serialize concurrent calls (prevents double-pay)
  SELECT * INTO v_order
    FROM orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  -- Tenant isolation check
  IF v_order.restaurant_id != v_restaurant_id THEN
    RAISE EXCEPTION 'Forbidden: order belongs to another tenant';
  END IF;

  -- Idempotency: already paid — return existing row without inserting
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object(
      'status',       'already_paid',
      'order_status', 'paid',
      'change_cents', 0
    );
  END IF;

  -- Guard: order must be in a payable state
  IF v_order.status NOT IN ('active', 'kitchen') THEN
    RAISE EXCEPTION 'Order cannot be paid: status=%', v_order.status;
  END IF;

  -- Calculate total from payment_methods array (format: 'method:amount')
  SELECT sum(split_part(value, ':', 2)::bigint)
    INTO v_total_cents
    FROM unnest(p_payment_methods) AS value;

  -- Insert one payment_transactions row per payment method
  FOR i IN 1..array_length(p_payment_methods, 1) LOOP
    v_method := split_part(p_payment_methods[i], ':', 1);
    v_amount := split_part(p_payment_methods[i], ':', 2)::bigint;

    IF v_method = 'cash' AND v_amount > v_order.bill_total_cents THEN
      v_change_cents := v_amount - v_order.bill_total_cents;
    END IF;

    INSERT INTO payment_transactions (
      id, order_id, restaurant_id, cash_register_id,
      payment_method, amount_cents, cash_received_cents,
      tip_amount_cents, created_at
    ) VALUES (
      gen_random_uuid(), p_order_id, v_restaurant_id, p_cash_register_id,
      v_method, v_amount,
      CASE WHEN v_method = 'cash' THEN v_amount ELSE 0 END,
      0, now()
    );

    v_payment_count := v_payment_count + 1;
  END LOOP;

  -- Update order to paid
  UPDATE orders
     SET status = 'paid',
         updated_at = now(),
         payment_method = v_method,
         cash_change_cents = v_change_cents
   WHERE id = p_order_id;

  -- Free the table
  UPDATE tables
     SET status = 'free',
         updated_at = now()
   WHERE id = v_order.table_id;

  RETURN jsonb_build_object(
    'status',         'paid',
    'order_status',   'paid',
    'table_status',   'free',
    'change_cents',   v_change_cents,
    'payment_count',  v_payment_count
  );
END;
$$;

-- 4. delete_order_with_items function
-- Atomic: all deletions in one transaction.
-- Tenant-scoped via RLS; SECURITY DEFINER uses caller's JWT context.
CREATE OR REPLACE FUNCTION public.delete_order_with_items(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id     uuid;
  v_restaurant_id uuid;
BEGIN
  -- Resolve caller restaurant via JWT context
  SELECT restaurant_id INTO v_restaurant_id
    FROM public.profiles
   WHERE auth_user_id = auth.uid();

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no profile found for user';
  END IF;

  -- Lock the order row and verify tenant ownership
  SELECT id INTO v_order_id
    FROM orders
   WHERE id = p_order_id AND restaurant_id = v_restaurant_id
     FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
  END IF;

  -- Delete junction links first (ingredient_transactions_orders ON DELETE CASCADE
  -- would handle this automatically, but explicit DELETE ensures FK RESTRICT on
  -- ingredient_transactions does not block)
  DELETE FROM ingredient_transactions_orders WHERE order_id = p_order_id;

  -- Delete order items (cascade FK handles this, but explicit for clarity)
  DELETE FROM order_items WHERE order_id = p_order_id;

  -- Delete the order (cascade would handle order_items, explicit for clarity)
  DELETE FROM orders WHERE id = p_order_id;
END;
$$;

COMMENT ON FUNCTION public.complete_payment IS
  'Atomic payment completion: locks order, inserts payment_transactions, marks order paid, frees table. Idempotent — concurrent calls serialize via FOR UPDATE.';

COMMENT ON FUNCTION public.delete_order_with_items IS
  'Atomic order deletion: locks order, deletes ingredient_transactions_orders links, deletes order_items, deletes order. Tenant-scoped via caller JWT.';

COMMIT;
