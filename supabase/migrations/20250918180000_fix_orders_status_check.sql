-- ============================================
-- Fix: orders.status CHECK constraint
-- ============================================
-- El CHECK original de 20250510151942_create_orders_table.sql solo permite
-- 'active', 'cancelled', 'paid'. La app evolucionó para usar también
-- 'kitchen' (mesero envía) y 'delivered' (cocina marca listo).
-- Esta migración reemplaza la constraint para incluir todos los estados.

DO $$
BEGIN
  -- Drop old constraint si existe
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_status_check'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
  END IF;
END $$;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('active', 'kitchen', 'delivered', 'cancelled', 'paid'));