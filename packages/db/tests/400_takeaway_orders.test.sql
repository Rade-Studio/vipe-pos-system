-- "Para llevar" orders (odd/tasks/promociones-mejoras.md M5, S8, migration 0030).
--
-- order_type takeaway with the customer's name (required, trimmed, 2..60)
-- and an optional phone (7..15 digits), no table; customer fields refused on
-- the other types; tenant isolation through the orders policies; pay_order,
-- split_order (the child stays takeaway with the customer), undo_split and
-- cancel_order treat a takeaway order like a dine_in one.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(33);

-- ============================================
-- 1. Schema
-- ============================================
SELECT has_column('public', 'orders', 'customer_name', 'orders has customer_name');
SELECT has_column('public', 'orders', 'customer_phone', 'orders has customer_phone');
SELECT col_is_null('public', 'orders', 'customer_name', 'customer_name is nullable (only takeaway needs it)');
SELECT col_is_null('public', 'orders', 'customer_phone', 'customer_phone is nullable');
SELECT ok(has_column_privilege('vipe_api', 'public.orders', 'customer_name', 'INSERT')
      AND has_column_privilege('vipe_api', 'public.orders', 'customer_phone', 'UPDATE')
      AND has_column_privilege('vipe_api', 'public.orders', 'customer_name', 'SELECT'),
  'vipe_api reads and writes the customer columns (RLS decides the rows)');

-- ============================================
-- Fixtures: restaurants A and B, staff, a dish, a table, a register.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('40000000-0000-0000-0000-0000000000a1', 't400-a', 'T400 A'),
  ('40000000-0000-0000-0000-0000000000b2', 't400-b', 'T400 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('40000000-0000-0000-0000-000000000002', 'cashier@t400a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('40100000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Caja A', 'cashier@t400a.test', 'cashier', true, '40000000-0000-0000-0000-0000000000a1');
INSERT INTO public.dishes (id, restaurant_id, name, price, active) VALUES
  ('40300000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'Hamburguesa', 20000, true),
  ('40300000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a1', 'Limonada', 6000, true);
INSERT INTO public.tables (id, restaurant_id, number) VALUES
  ('40200000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 1);
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('40400000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');

-- ============================================
-- 2. Valid takeaway rows
-- ============================================
SELECT lives_ok($$
  INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, customer_phone, subtotal, tax, tax_percentage, tip, tip_percentage, total)
  VALUES ('40500000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'kitchen', 'takeaway', 'Ana', '3150001122', 0, 0, 8, 0, 0, 0)
$$, 'a takeaway order with a name and a phone and no table is valid');
SELECT lives_ok($$
  INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, subtotal, tax, tax_percentage, tip, tip_percentage, total)
  VALUES ('40500000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a1', 'kitchen', 'takeaway', 'Jo', 0, 0, 8, 0, 0, 0)
$$, 'a takeaway order without a phone and a 2-character name is valid');
SELECT lives_ok($$
  INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, subtotal, tax, tax_percentage, tip, tip_percentage, total)
  VALUES ('40500000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000a1', 'kitchen', 'takeaway', repeat('a', 60), 0, 0, 8, 0, 0, 0)
$$, 'a 60-character name is valid');
SELECT is((SELECT order_type FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000001'), 'takeaway',
  'the takeaway order keeps its own order_type');

-- ============================================
-- 3. Rejected rows
-- ============================================
CREATE TEMP TABLE t400_bad (label text, cols text, vals text) ON COMMIT DROP;
INSERT INTO t400_bad VALUES
  ('a takeaway without a name', 'order_type', $$'takeaway'$$),
  ('a takeaway with a 1-character name', 'order_type, customer_name', $$'takeaway', 'A'$$),
  ('a takeaway with a 61-character name', 'order_type, customer_name', $$'takeaway', repeat('a', 61)$$),
  ('a takeaway with an untrimmed name', 'order_type, customer_name', $$'takeaway', ' Ana '$$),
  ('a takeaway with a 6-digit phone', 'order_type, customer_name, customer_phone', $$'takeaway', 'Ana', '315000'$$),
  ('a takeaway with a phone that is not digits', 'order_type, customer_name, customer_phone', $$'takeaway', 'Ana', '+57 315 000 1122'$$),
  ('a takeaway on a table', 'order_type, customer_name, table_id', $$'takeaway', 'Ana', '40200000-0000-0000-0000-000000000001'$$),
  ('a dine_in with a customer name', 'order_type, customer_name, table_id', $$'dine_in', 'Ana', '40200000-0000-0000-0000-000000000001'$$),
  ('a dine_in with a customer phone', 'order_type, customer_phone', $$'dine_in', '3150001122'$$),
  ('a delivery with a customer name', 'order_type, customer_name', $$'delivery', 'Ana'$$),
  ('an unknown order type', 'order_type, customer_name', $$'drive_thru', 'Ana'$$);
SELECT throws_ok(format('INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total, %s) VALUES (%L, ''kitchen'', 0, 0, 8, 0, 0, 0, %s)',
                        b.cols, '40000000-0000-0000-0000-0000000000a1', b.vals),
                 '23514', NULL, 'orders rejects ' || b.label)
  FROM t400_bad b ORDER BY b.label;
SELECT is((SELECT count(*)::int FROM public.orders WHERE restaurant_id = '40000000-0000-0000-0000-0000000000a1'), 3,
  'the rejected rows left orders unchanged');

-- ============================================
-- 4. Tenant isolation through the orders policies
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, subtotal, tax, tax_percentage, tip, tip_percentage, total)
VALUES ('40500000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000b2', 'kitchen', 'takeaway', 'Bea', 0, 0, 8, 0, 0, 0);
SELECT set_config('app.user_id', '40000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT array_agg(customer_name ORDER BY id) FROM public.orders WHERE order_type = 'takeaway'),
          ARRAY['Ana', 'Jo', repeat('a', 60)], 'the cashier sees only the own restaurant''s takeaway orders');
UPDATE public.orders SET customer_name = 'Hacked' WHERE id = '40500000-0000-0000-0000-0000000000b1';
RESET ROLE;
SELECT is((SELECT customer_name FROM public.orders WHERE id = '40500000-0000-0000-0000-0000000000b1'), 'Bea',
  'an UPDATE of another restaurant''s takeaway order changes nothing');

-- ============================================
-- 5. split_order and undo_split keep the takeaway customer
-- ============================================
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity) VALUES
  ('40600000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', '40500000-0000-0000-0000-000000000001', '40300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000, 1),
  ('40600000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a1', '40500000-0000-0000-0000-000000000001', '40300000-0000-0000-0000-000000000002', 'Limonada', 6000, 2),
  ('40600000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-0000000000a1', '40500000-0000-0000-0000-000000000002', '40300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000, 1);
CREATE TEMP TABLE t400 (key text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t400 TO vipe_api;
SELECT set_config('app.user_id', '40000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
DO $$ BEGIN PERFORM private.recompute_caller_order_bill('40500000-0000-0000-0000-000000000001'); END $$;
DO $$ BEGIN PERFORM private.recompute_caller_order_bill('40500000-0000-0000-0000-000000000002'); END $$;
INSERT INTO t400
SELECT 'child', (public.split_order('40500000-0000-0000-0000-000000000001',
  '[{"order_item_id": "40600000-0000-0000-0000-000000000002", "quantity": 1}]'::jsonb)->>'child_order_id')::uuid;
RESET ROLE;
SELECT is((SELECT array[subtotal, tax, total] FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000002'),
          ARRAY[20000, 1600, 21600]::numeric[], 'the bill of a takeaway order is recomputed like a dine_in one');
SELECT is((SELECT row(order_type, customer_name, customer_phone, table_id, is_partial_order)::text
             FROM public.orders WHERE id = (SELECT id FROM t400 WHERE key = 'child')),
          row('takeaway', 'Ana', '3150001122', NULL::uuid, true)::text,
  'the split child stays takeaway with the parent''s customer and no table');
SELECT is((SELECT array[subtotal, total] FROM public.orders WHERE id = (SELECT id FROM t400 WHERE key = 'child')),
          ARRAY[6000, 6480]::numeric[], 'the child bill: one Limonada plus 8 % tax');
SELECT is((SELECT array[subtotal, total] FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000001'),
          ARRAY[26000, 28080]::numeric[], 'the parent bill: Hamburguesa and one Limonada plus 8 % tax');
SELECT set_config('app.user_id', '40000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT public.undo_split((SELECT id FROM t400 WHERE key = 'child')) $$, 'undo_split merges a takeaway child back');
RESET ROLE;
SELECT is((SELECT array[subtotal, total] FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000001'),
          ARRAY[32000, 34560]::numeric[], 'the merged takeaway bill is whole again');

-- ============================================
-- 6. pay_order and cancel_order
-- ============================================
SELECT set_config('app.user_id', '40000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((public.pay_order('40500000-0000-0000-0000-000000000002', '40400000-0000-0000-0000-000000000001', 0,
            jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'),
                                                 'amount', 21600, 'cash_received', 30000)),
            '40a00000-0000-0000-0000-000000000001')->>'amount_due')::bigint,
          21600::bigint, 'pay_order charges a takeaway order its subtotal + tax');
SELECT lives_ok($$ SELECT public.cancel_order('40500000-0000-0000-0000-000000000003', 'customer_left') $$,
  'cancel_order cancels an empty takeaway order without a supervisor');
RESET ROLE;
SELECT is((SELECT status FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000002'), 'paid', 'the paid takeaway order is paid');
SELECT is((SELECT status FROM public.orders WHERE id = '40500000-0000-0000-0000-000000000003'), 'cancelled', 'the cancelled takeaway order is cancelled');

SELECT * FROM finish();
ROLLBACK;
