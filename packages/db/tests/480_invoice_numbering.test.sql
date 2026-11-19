-- H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12, migration 0043): every
-- payment gets the restaurant's next invoice consecutive inside pay_order
-- (prefix + 6 digits, POS-000001 by default), with the DIAN data configured at
-- that moment as a snapshot. Gap-free: a failed payment uses no number; a
-- replay keeps the stored one; each restaurant counts on its own.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(24);

SELECT has_column('public', 'payments', 'invoice_seq', 'payments has invoice_seq');
SELECT has_column('public', 'payments', 'invoice_number', 'payments has invoice_number');
SELECT has_column('public', 'payments', 'invoice_fiscal', 'payments has invoice_fiscal');
SELECT has_trigger('public', 'payments', 'payments_assign_invoice_number', 'payments has the invoice number trigger');

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('48000000-0000-0000-0000-0000000000a1', 't480-a', 'T480 A'),
  ('48000000-0000-0000-0000-0000000000b2', 't480-b', 'T480 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('48000000-0000-0000-0000-000000000001', 'cashier@t480a.test', 'h'),
  ('48000000-0000-0000-0000-000000000002', 'cashier@t480b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('48100000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000001', 'Caja A', 'cashier@t480a.test', 'cashier', true, '48000000-0000-0000-0000-0000000000a1'),
  ('48100000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000002', 'Caja B', 'cashier@t480b.test', 'cashier', true, '48000000-0000-0000-0000-0000000000b2');
INSERT INTO public.dishes (id, restaurant_id, name, price, active) VALUES
  ('48300000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-0000000000a1', 'Arepa', 10000, true),
  ('48300000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-0000000000b2', 'Arepa', 10000, true);
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('48400000-0000-0000-0000-0000000000a1', '48000000-0000-0000-0000-0000000000a1', now(), 100000, 'open'),
  ('48400000-0000-0000-0000-0000000000b2', '48000000-0000-0000-0000-0000000000b2', now(), 100000, 'open');
-- Five takeaway orders in A (one Arepa, no tax) and one in B.
INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, subtotal, tax, tax_percentage, tip, tip_percentage, total)
SELECT ('48500000-0000-0000-0000-00000000000' || n)::uuid, '48000000-0000-0000-0000-0000000000a1', 'kitchen', 'takeaway', 'Ana', 10000, 0, 0, 0, 0, 10000
  FROM generate_series(1, 5) n;
INSERT INTO public.orders (id, restaurant_id, status, order_type, customer_name, subtotal, tax, tax_percentage, tip, tip_percentage, total)
VALUES ('48500000-0000-0000-0000-0000000000b1', '48000000-0000-0000-0000-0000000000b2', 'kitchen', 'takeaway', 'Bea', 10000, 0, 0, 0, 0, 10000);
INSERT INTO public.order_items (restaurant_id, order_id, dish_id, name, price, quantity)
SELECT o.restaurant_id, o.id, d.id, 'Arepa', 10000, 1
  FROM public.orders o JOIN public.dishes d ON d.restaurant_id = o.restaurant_id
 WHERE o.id::text LIKE '48500000-%';

-- pay(order, restaurant user, register, amount, key): one cash tender.
CREATE FUNCTION pg_temp.pay(p_order uuid, p_user uuid, p_register uuid, p_amount bigint, p_key uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('app.user_id', p_user::text, true);
  SET LOCAL ROLE vipe_api;
  v := public.pay_order(p_order, p_register, 0,
         jsonb_build_array(jsonb_build_object(
           'payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'),
           'amount', p_amount, 'cash_received', p_amount)),
         p_key);
  RESET ROLE;
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.number_of(p_order uuid) RETURNS text LANGUAGE sql AS $$
  SELECT invoice_number FROM public.payments WHERE order_id = p_order AND voided_at IS NULL
$$;

-- 1. Without configuration: POS prefix, from 1, no DIAN data.
SELECT lives_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 10000, '48a00000-0000-0000-0000-000000000001') $$, 'the first payment of A goes through');
SELECT is(pg_temp.number_of('48500000-0000-0000-0000-000000000001'), 'POS-000001', 'the first invoice of A is POS-000001');
SELECT is((SELECT invoice_seq FROM public.payments WHERE order_id = '48500000-0000-0000-0000-000000000001'), 1::bigint,
  'its consecutive is 1');
SELECT is((SELECT invoice_fiscal FROM public.payments WHERE order_id = '48500000-0000-0000-0000-000000000001'),
  '{"prefix": "POS", "range_to": null, "valid_to": null, "range_from": 1, "resolution": null, "tax_regime": null, "valid_from": null}'::jsonb,
  'without configuration the snapshot carries only the prefix and the default start');

-- 2. A failed payment uses no number.
SELECT throws_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 9999, '48a00000-0000-0000-0000-000000000002') $$, 'P0001', NULL,
  'a payment whose tenders do not add up is refused');
RESET ROLE;
SELECT lives_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 10000, '48a00000-0000-0000-0000-000000000003') $$, 'the corrected payment goes through');
SELECT is(pg_temp.number_of('48500000-0000-0000-0000-000000000002'), 'POS-000002',
  'the next payment after a refused one is POS-000002 (no gap)');

-- 3. A replay keeps the stored number and adds no row.
SELECT is(pg_temp.pay('48500000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 10000, '48a00000-0000-0000-0000-000000000003')->>'status', 'already_paid',
  'the same key again is a replay');
SELECT is((SELECT array_agg(invoice_number ORDER BY invoice_seq) FROM public.payments WHERE restaurant_id = '48000000-0000-0000-0000-0000000000a1'),
  ARRAY['POS-000001', 'POS-000002'], 'the replay leaves the numbers as they were');

-- 4. Configured prefix, range and DIAN data: the next number starts at the range.
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_prefix', 'FE'),
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_resolution', '18764000001234'),
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_range_from', '5000'),
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_range_to', '10000'),
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_valid_from', '2026-01-01'),
  ('48000000-0000-0000-0000-0000000000a1', 'invoice_valid_to', '2027-12-31'),
  ('48000000-0000-0000-0000-0000000000a1', 'tax_regime', 'responsable_iva');
SELECT lives_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-000000000003', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 10000, '48a00000-0000-0000-0000-000000000004') $$, 'a payment under the new resolution goes through');
SELECT is(pg_temp.number_of('48500000-0000-0000-0000-000000000003'), 'FE-005000', 'it takes the range start with the new prefix');
SELECT is((SELECT invoice_fiscal FROM public.payments WHERE order_id = '48500000-0000-0000-0000-000000000003'),
  '{"prefix": "FE", "range_to": 10000, "valid_to": "2027-12-31", "range_from": 5000, "resolution": "18764000001234", "tax_regime": "responsable_iva", "valid_from": "2026-01-01"}'::jsonb,
  'the snapshot keeps the DIAN data in force when it was charged');
SELECT lives_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-000000000004', '48000000-0000-0000-0000-000000000001',
  '48400000-0000-0000-0000-0000000000a1', 10000, '48a00000-0000-0000-0000-000000000005') $$, 'the next payment goes through');
SELECT is(pg_temp.number_of('48500000-0000-0000-0000-000000000004'), 'FE-005001', 'and is FE-005001');

-- 5. Each restaurant counts on its own.
SELECT lives_ok($$ SELECT pg_temp.pay('48500000-0000-0000-0000-0000000000b1', '48000000-0000-0000-0000-000000000002',
  '48400000-0000-0000-0000-0000000000b2', 10000, '48a00000-0000-0000-0000-0000000000b1') $$, 'the first payment of B goes through');
SELECT is(pg_temp.number_of('48500000-0000-0000-0000-0000000000b1'), 'POS-000001', 'restaurant B starts at POS-000001');

-- 6. Stored values the trigger could not read are refused.
SELECT throws_ok($$ INSERT INTO public.business_config (restaurant_id, key, value)
  VALUES ('48000000-0000-0000-0000-0000000000b2', 'invoice_prefix', 'pos-1') $$, '23514', NULL,
  'a prefix with lowercase letters or a dash is refused');
SELECT throws_ok($$ INSERT INTO public.business_config (restaurant_id, key, value)
  VALUES ('48000000-0000-0000-0000-0000000000b2', 'invoice_range_from', '0') $$, '23514', NULL,
  'a range start of 0 is refused');
SELECT throws_ok($$ INSERT INTO public.business_config (restaurant_id, key, value)
  VALUES ('48000000-0000-0000-0000-0000000000b2', 'tax_regime', 'simplificado') $$, '23514', NULL,
  'an unknown tax regime is refused');

-- 7. The API role cannot rewrite a stored number (payments are immutable).
SELECT set_config('app.user_id', '48000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ UPDATE public.payments SET invoice_number = 'POS-999999'
  WHERE order_id = '48500000-0000-0000-0000-000000000001' $$, '42501', NULL,
  'vipe_api cannot rewrite an invoice number');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
