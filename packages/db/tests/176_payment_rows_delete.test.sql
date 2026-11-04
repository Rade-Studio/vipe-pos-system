-- Trusted deletes of payment history rows (odd/tasks/migracion-backend-nestjs.md,
-- T6 closing audit). guard_payment_rows_immutable is a BEFORE UPDATE OR DELETE
-- trigger on payments, payment_tenders and payment_transactions; its trusted
-- branch returned NEW, which is NULL on DELETE, so a trusted delete was silently
-- skipped. With cash_registers -> payment_transactions ON DELETE CASCADE that
-- left payment_transactions rows pointing at a deleted register.
-- The 42501 raise for every other role is covered by 060_payments_tenders.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(3);

INSERT INTO public.restaurants (id, slug, name)
  VALUES ('17600000-0000-0000-0000-0000000000aa', 'rest-t176', 'Restaurant T176');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id)
  VALUES ('17600000-0000-0000-0000-000000000001', 'active', 10, 0, 0, 10, '17600000-0000-0000-0000-0000000000aa'),
         ('17600000-0000-0000-0000-000000000002', 'active', 10, 0, 0, 10, '17600000-0000-0000-0000-0000000000aa');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status)
  VALUES ('17600000-0000-0000-0000-0000000000c1', '17600000-0000-0000-0000-0000000000aa', now(), 0, 'open'),
         ('17600000-0000-0000-0000-0000000000c2', '17600000-0000-0000-0000-0000000000aa', now(), 0, 'closed');
INSERT INTO public.payment_transactions (id, restaurant_id, order_id, amount, method, cash_received, cash_change, timestamp, cash_register_id)
  VALUES ('17600000-0000-0000-0000-0000000000f1', '17600000-0000-0000-0000-0000000000aa', '17600000-0000-0000-0000-000000000001',
          10, 'Efectivo', 10, 0, now(), '17600000-0000-0000-0000-0000000000c1'),
         ('17600000-0000-0000-0000-0000000000f2', '17600000-0000-0000-0000-0000000000aa', '17600000-0000-0000-0000-000000000002',
          10, 'Efectivo', 10, 0, now(), '17600000-0000-0000-0000-0000000000c2');

-- 1. A direct trusted delete removes the row.
SET LOCAL ROLE vipe_migrator;
DELETE FROM public.payment_transactions WHERE id = '17600000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.payment_transactions WHERE id = '17600000-0000-0000-0000-0000000000f1')::bigint,
  0::bigint,
  'vipe_migrator can delete a payment_transactions row'
);

-- 2. Deleting a cash register cascades to its payment_transactions rows.
SET LOCAL ROLE vipe_migrator;
DELETE FROM public.cash_registers WHERE id = '17600000-0000-0000-0000-0000000000c2';
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.payment_transactions WHERE cash_register_id = '17600000-0000-0000-0000-0000000000c2')::bigint,
  0::bigint,
  'deleting a cash register leaves no payment_transactions pointing at it'
);

-- 3. The guard keeps its security shape.
SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_payment_rows_immutable'),
  'guard_payment_rows_immutable stays SECURITY INVOKER with an empty search_path'
);

SELECT * FROM finish();
ROLLBACK;
