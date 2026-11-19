-- H-080 (odd/tasks/qa-noviembre-2026.md T13, S3): migration 0044 adds a
-- "delivery" block to public.register_summary. The close shows "Domicilios"
-- apart from the food sales and, per courier, the cash they bring (cash
-- tenders of cash_on_delivery orders) and the fees owed to them (the
-- delivery_fee of their paid orders, whatever the payment mode). Every key
-- that existed before 0044 keeps its value: the delivery block only splits
-- out money already counted in total_billed and expected_cash.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(16);

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('48000000-0000-4000-8000-0000000000a1', 't480-a', 'T480 A');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('48100000-0000-4000-8000-000000000001', 'cashier@t480a.test', 'h'),
  ('48100000-0000-4000-8000-000000000002', 'operator@t480a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('48200000-0000-4000-8000-000000000001', '48100000-0000-4000-8000-000000000001', 'Cajera', 'cashier@t480a.test', 'cashier', true, '48000000-0000-4000-8000-0000000000a1'),
  ('48200000-0000-4000-8000-000000000002', '48100000-0000-4000-8000-000000000002', 'Operadora', 'operator@t480a.test', 'delivery_operator', true, '48000000-0000-4000-8000-0000000000a1');
INSERT INTO public.couriers (id, restaurant_id, name) VALUES
  ('48300000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-0000000000a1', 'Carlos'),
  ('48300000-0000-4000-8000-000000000002', '48000000-0000-4000-8000-0000000000a1', 'Beto');
INSERT INTO public.customers (id, phone, name, restaurant_id) VALUES
  ('48400000-0000-4000-8000-000000000001', '3101234567', 'Ana', '48000000-0000-4000-8000-0000000000a1');

-- r2 (closed later, one Carlos delivery), r1 (open, the shift under test),
-- r0 (closed, nothing sold).
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('48500000-0000-4000-8000-000000000000', '48000000-0000-4000-8000-0000000000a1', now(), 50000, 'closed'),
  ('48500000-0000-4000-8000-000000000002', '48000000-0000-4000-8000-0000000000a1', now(), 30000, 'open');

-- o1 table order 20000 cash; d1 COD Carlos 30000+5000 cash; d2 COD Carlos
-- 10000+3000 paid with Nequi; d3 prepaid Beto 20000+4000 Nequi; d4 COD
-- without courier 8000+2000 cash; d5 COD Beto 10000+2000 cash, voided;
-- d6 COD Carlos 1000+1000 cash on r2.
INSERT INTO public.orders (id, table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total, restaurant_id) VALUES
  ('48600000-0000-4000-8000-000000000001', NULL, NULL, 'kitchen', 'dine_in', 20000, 0, 0, 0, 0, 20000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d1', NULL, NULL, 'kitchen', 'delivery', 30000, 0, 0, 0, 0, 35000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d2', NULL, NULL, 'kitchen', 'delivery', 10000, 0, 0, 0, 0, 13000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d3', NULL, NULL, 'kitchen', 'delivery', 20000, 0, 0, 0, 0, 24000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d4', NULL, NULL, 'kitchen', 'delivery', 8000, 0, 0, 0, 0, 10000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d5', NULL, NULL, 'kitchen', 'delivery', 10000, 0, 0, 0, 0, 12000, '48000000-0000-4000-8000-0000000000a1'),
  ('48600000-0000-4000-8000-0000000000d6', NULL, NULL, 'kitchen', 'delivery', 1000, 0, 0, 0, 0, 2000, '48000000-0000-4000-8000-0000000000a1');
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line, delivery_fee, payment_mode, courier_id, delivery_status) VALUES
  ('48600000-0000-4000-8000-0000000000d1', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 5000, 'cash_on_delivery', '48300000-0000-4000-8000-000000000001', 'ready'),
  ('48600000-0000-4000-8000-0000000000d2', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 3000, 'cash_on_delivery', '48300000-0000-4000-8000-000000000001', 'ready'),
  ('48600000-0000-4000-8000-0000000000d3', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 4000, 'prepaid', '48300000-0000-4000-8000-000000000002', 'ready'),
  ('48600000-0000-4000-8000-0000000000d4', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 2000, 'cash_on_delivery', NULL, 'ready'),
  ('48600000-0000-4000-8000-0000000000d5', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 2000, 'cash_on_delivery', '48300000-0000-4000-8000-000000000002', 'ready'),
  ('48600000-0000-4000-8000-0000000000d6', '48000000-0000-4000-8000-0000000000a1', '48400000-0000-4000-8000-000000000001', 'Ana', '3101234567', 'Calle 1', 1000, 'cash_on_delivery', '48300000-0000-4000-8000-000000000001', 'ready');
INSERT INTO public.order_items (order_id, dish_id, name, price, quantity, status, restaurant_id)
SELECT o.id, NULL, 'Plato', o.subtotal, 1, 'kitchen', o.restaurant_id
  FROM public.orders o WHERE o.restaurant_id = '48000000-0000-4000-8000-0000000000a1';

CREATE TEMP TABLE t480_pay (order_id uuid PRIMARY KEY, payment_id uuid) ON COMMIT DROP;
GRANT ALL ON t480_pay TO vipe_api;
CREATE FUNCTION pg_temp.t480_pay(p_order uuid, p_register uuid, p_code text, p_amount bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t480_pay
  SELECT p_order, (public.pay_order(p_order, p_register, 0,
           jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'payment_method_id', (SELECT id FROM public.payment_methods WHERE code = p_code),
             'amount', p_amount,
             'cash_received', CASE WHEN p_code = 'cash' THEN p_amount END))), gen_random_uuid())->>'payment_id')::uuid
$$;

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '48100000-0000-4000-8000-000000000001', true);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d6', '48500000-0000-4000-8000-000000000002', 'cash', 2000);
RESET ROLE;
UPDATE public.cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = '48500000-0000-4000-8000-000000000002';
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('48500000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-0000000000a1', now(), 100000, 'open');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '48100000-0000-4000-8000-000000000001', true);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-000000000001', '48500000-0000-4000-8000-000000000001', 'cash', 20000);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d1', '48500000-0000-4000-8000-000000000001', 'cash', 35000);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d2', '48500000-0000-4000-8000-000000000001', 'nequi', 13000);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d3', '48500000-0000-4000-8000-000000000001', 'nequi', 24000);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d4', '48500000-0000-4000-8000-000000000001', 'cash', 10000);
SELECT pg_temp.t480_pay('48600000-0000-4000-8000-0000000000d5', '48500000-0000-4000-8000-000000000001', 'cash', 12000);
RESET ROLE;
-- d5's payment is voided (as public.void_payment leaves it): it counts nowhere.
UPDATE public.payments SET voided_at = now()
 WHERE id = (SELECT payment_id FROM t480_pay WHERE order_id = '48600000-0000-4000-8000-0000000000d5');

CREATE TEMP TABLE t480_sum (name text PRIMARY KEY, s jsonb) ON COMMIT DROP;
GRANT ALL ON t480_sum TO vipe_api;
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '48100000-0000-4000-8000-000000000001', true);
INSERT INTO t480_sum VALUES
  ('r1', public.register_summary(ARRAY['48500000-0000-4000-8000-000000000001']::uuid[])),
  ('r12', public.register_summary(ARRAY['48500000-0000-4000-8000-000000000001', '48500000-0000-4000-8000-000000000002']::uuid[])),
  ('r0', public.register_summary(ARRAY['48500000-0000-4000-8000-000000000000']::uuid[]));
SELECT set_config('app.user_id', '48100000-0000-4000-8000-000000000002', true);
INSERT INTO t480_sum VALUES
  ('op', public.register_summary(ARRAY['48500000-0000-4000-8000-000000000001']::uuid[]));
RESET ROLE;

-- 1. The keys that existed before 0044 keep their arithmetic.
SELECT is(
  (SELECT jsonb_build_object(
     'payments_count', s->'payments_count', 'total_billed', s->'total_billed',
     'total_sales', s->'total_sales', 'total_tips', s->'total_tips', 'total_change', s->'total_change',
     'initial_cash', s->'initial_cash', 'expected_cash', s->'expected_cash',
     'expected_cash_after_tips', s->'expected_cash_after_tips')
     FROM t480_sum WHERE name = 'r1'),
  '{"payments_count": 5, "total_billed": 102000, "total_sales": 102000, "total_tips": 0, "total_change": 0,
    "initial_cash": 100000, "expected_cash": 165000, "expected_cash_after_tips": 165000}'::jsonb,
  'the pre-0044 totals stay as they were: expected cash = 100000 initial + 65000 cash tenders');
SELECT is(
  (SELECT jsonb_object_agg(m->>'code', (m->>'total')::bigint)
     FROM t480_sum, jsonb_array_elements(s->'methods') m
    WHERE name = 'r1' AND m->>'code' IN ('cash', 'nequi')),
  '{"cash": 65000, "nequi": 37000}'::jsonb,
  'the totals by method stay as they were (delivery fees still inside them)');
SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM t480_sum, jsonb_object_keys(s) k WHERE name = 'r1'),
  ARRAY['cash_deposits', 'cash_withdrawals', 'delivery', 'expected_cash', 'expected_cash_after_tips',
        'initial_cash', 'legacy', 'methods', 'payments_count', 'registers_count', 'tips_payout',
        'total_billed', 'total_change', 'total_sales', 'total_tips'],
  'the only new top-level key is delivery');

-- 2. The delivery block.
SELECT is((SELECT (s->'delivery'->>'fees')::bigint FROM t480_sum WHERE name = 'r1'), 14000::bigint,
  'delivery.fees sums the fees of the live delivery payments (5000 + 3000 + 4000 + 2000; the voided one is out)');
SELECT is((SELECT (s->'delivery'->>'orders_count')::bigint FROM t480_sum WHERE name = 'r1'), 4::bigint,
  'delivery.orders_count counts the paid deliveries of the shift');
SELECT is((SELECT (s->'delivery'->>'food_billed')::bigint FROM t480_sum WHERE name = 'r1'), 88000::bigint,
  'delivery.food_billed = total_billed - fees (102000 - 14000)');
SELECT is((SELECT (s->'delivery'->>'cash_collected')::bigint FROM t480_sum WHERE name = 'r1'), 45000::bigint,
  'delivery.cash_collected sums the cash tenders of cash-on-delivery orders (35000 + 10000)');
SELECT is(
  (SELECT s->'delivery'->'couriers' FROM t480_sum WHERE name = 'r1'),
  '[{"courier_id": "48300000-0000-4000-8000-000000000002", "name": "Beto", "orders_count": 1, "cash_collected": 0, "fees_owed": 4000},
    {"courier_id": "48300000-0000-4000-8000-000000000001", "name": "Carlos", "orders_count": 2, "cash_collected": 35000, "fees_owed": 8000},
    {"courier_id": null, "name": null, "orders_count": 1, "cash_collected": 10000, "fees_owed": 2000}]'::jsonb,
  'per courier, by name, unassigned last: cash brought back (COD cash tenders only) and fees owed (any payment mode)');

-- 3. Scope: several registers add up; another register does not leak in.
SELECT is(
  (SELECT c FROM t480_sum, jsonb_array_elements(s->'delivery'->'couriers') c
    WHERE name = 'r12' AND c->>'name' = 'Carlos'),
  '{"courier_id": "48300000-0000-4000-8000-000000000001", "name": "Carlos", "orders_count": 3, "cash_collected": 37000, "fees_owed": 9000}'::jsonb,
  'two registers add up per courier');
SELECT is((SELECT (s->'delivery'->>'fees')::bigint FROM t480_sum WHERE name = 'r12'), 15000::bigint,
  'two registers add up the fees');
SELECT is((SELECT (s->>'expected_cash')::bigint FROM t480_sum WHERE name = 'r12'), 197000::bigint,
  'expected cash of two registers is unchanged (130000 initial + 67000 cash)');

-- 4. A shift without deliveries (or older data) gets a zero block.
SELECT is((SELECT s->'delivery' FROM t480_sum WHERE name = 'r0'),
  '{"fees": 0, "orders_count": 0, "food_billed": 0, "cash_collected": 0, "couriers": []}'::jsonb,
  'a register without deliveries has a zero delivery block');
SELECT is((SELECT (s->>'expected_cash')::bigint FROM t480_sum WHERE name = 'r0'), 50000::bigint,
  'a register without sales still expects its initial cash');

-- 5. The delivery operator reads the same block.
SELECT is((SELECT s FROM t480_sum WHERE name = 'op'), (SELECT s FROM t480_sum WHERE name = 'r1'),
  'the delivery operator reads the same summary as the cashier');

-- 6. close_register returns the same block in its summary.
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '48100000-0000-4000-8000-000000000001', true);
INSERT INTO t480_sum VALUES ('close', public.close_register('48500000-0000-4000-8000-000000000001'));
RESET ROLE;
SELECT is((SELECT s->'summary'->'delivery' FROM t480_sum WHERE name = 'close'),
  (SELECT s->'delivery' FROM t480_sum WHERE name = 'r1'),
  'close_register carries the delivery block');
SELECT is((SELECT (s->>'final_cash')::bigint FROM t480_sum WHERE name = 'close'), 165000::bigint,
  'close_register final cash is unchanged');

SELECT * FROM finish();
ROLLBACK;
