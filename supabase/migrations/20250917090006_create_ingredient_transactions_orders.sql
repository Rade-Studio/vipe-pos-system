-- Migration: 20250917090006_create_ingredient_transactions_orders.sql
-- Phase: P3 Payment & Order Atomicity
-- Creates the junction table linking orders to ingredient consumption.
-- FKs are ON DELETE CASCADE so delete_order_with_items does not need to
-- manually delete junction rows (DB cascade handles it).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ingredient_transactions_orders (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                   uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ingredient_transaction_id   uuid NOT NULL REFERENCES public.ingredient_transactions(id) ON DELETE CASCADE,
  quantity_cents             bigint NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, ingredient_transaction_id)
);

COMMENT ON TABLE public.ingredient_transactions_orders IS
  'Junction table linking orders to ingredient_transactions consumed during cooking.';

COMMENT ON COLUMN public.ingredient_transactions_orders.quantity_cents IS
  'Units consumed in hundredths (e.g., 100 = 1 unit).';

COMMIT;
