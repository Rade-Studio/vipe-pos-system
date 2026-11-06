-- Order details for the cashier, kitchen, waiter and delivery redesign
-- (odd/tasks/rediseno-pos.md, T15, S8).
--
-- public.orders gains order_number (per-restaurant counter assigned by a
-- BEFORE INSERT trigger; a value the client sends is ignored and a change is
-- refused), guests and notes; public.payment_tenders gains reference, captured
-- through pay_order without changing amounts or idempotency;
-- public.cash_registers gains opened_by (default: the caller's profile);
-- public.order_deliveries gains prepaid_method_id, courier_eta,
-- courier_location and returned_at. Every new key is tenant-safe through a
-- composite foreign key. Concurrency of the counter is a row lock on
-- private.inventory_counters (two sessions are checked outside pgTAP); here
-- the sequential and multi-row cases.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(88);

-- ============================================
-- 1. Schema
-- ============================================
SELECT col_type_is('public', 'orders', 'order_number', 'integer', 'orders.order_number is an integer');
SELECT col_not_null('public', 'orders', 'order_number', 'orders.order_number is NOT NULL');
SELECT col_is_unique('public', 'orders', ARRAY['restaurant_id', 'order_number'], 'order_number is unique per restaurant');
SELECT trigger_is('public', 'orders', 'orders_assign_order_number', 'private', 'assign_order_number', 'orders numbers every insert');
SELECT trigger_is('public', 'orders', 'orders_order_number_immutable', 'private', 'guard_order_number', 'orders keeps its number');
SELECT col_type_is('public', 'orders', 'guests', 'smallint', 'orders.guests is a smallint');
SELECT col_is_null('public', 'orders', 'guests', 'orders.guests is nullable');
SELECT col_type_is('public', 'orders', 'notes', 'text', 'orders.notes is text');
SELECT col_is_null('public', 'orders', 'notes', 'orders.notes is nullable');
SELECT col_type_is('public', 'payment_tenders', 'reference', 'text', 'payment_tenders.reference is text');
SELECT col_is_null('public', 'payment_tenders', 'reference', 'payment_tenders.reference is nullable');
SELECT col_type_is('public', 'cash_registers', 'opened_by', 'uuid', 'cash_registers.opened_by is a uuid');
SELECT col_default_is('public', 'cash_registers', 'opened_by', 'private.current_profile_id()', 'cash_registers.opened_by defaults to the caller profile');
SELECT fk_ok('public', 'cash_registers', ARRAY['restaurant_id', 'opened_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'a register references its opener through (restaurant_id, opened_by)');
SELECT fk_ok('public', 'order_deliveries', ARRAY['restaurant_id', 'prepaid_method_id'], 'public', 'payment_methods', ARRAY['restaurant_id', 'id'],
  'a delivery references its prepaid method through (restaurant_id, prepaid_method_id)');
SELECT col_type_is('public', 'order_deliveries', 'courier_eta', 'timestamp with time zone', 'order_deliveries.courier_eta is a timestamptz');
SELECT col_type_is('public', 'order_deliveries', 'courier_location', 'text', 'order_deliveries.courier_location is text');
SELECT col_type_is('public', 'order_deliveries', 'returned_at', 'timestamp with time zone', 'order_deliveries.returned_at is a timestamptz');

-- RLS unchanged: the same policies as before the migration.
SELECT policies_are('public', 'orders', ARRAY['orders_select_policy', 'orders_insert_policy', 'orders_update_policy', 'orders_delete_policy'],
  'orders keeps its four tenant policies');
SELECT policies_are('public', 'payment_tenders', ARRAY['payment_tenders_select_policy', 'payment_tenders_update_policy', 'payment_tenders_delete_policy'],
  'payment_tenders keeps its policies (no INSERT: pay_order writes)');
SELECT policies_are('public', 'cash_registers', ARRAY['cash_registers_select_policy', 'cash_registers_insert_policy', 'cash_registers_update_policy', 'cash_registers_delete_policy'],
  'cash_registers keeps its four tenant policies');
SELECT policies_are('public', 'order_deliveries', ARRAY['order_deliveries_select_policy', 'order_deliveries_update_policy', 'order_deliveries_delete_policy'],
  'order_deliveries keeps its policies (no INSERT: the delivery RPCs write)');

-- ============================================
-- Fixtures: restaurants A and B (default payment methods from the restaurant
-- trigger), staff of A and B.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('24000000-0000-0000-0000-0000000000a1', 't240-a', 'T240 A'),
  ('24000000-0000-0000-0000-0000000000b2', 't240-b', 'T240 B'),
  ('24000000-0000-0000-0000-0000000000c3', 't240-c', 'T240 C');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('24000000-0000-0000-0000-000000000001', 'cashier@t240a.test', 'h'),
  ('24000000-0000-0000-0000-000000000002', 'waiter@t240a.test', 'h'),
  ('24000000-0000-0000-0000-000000000003', 'kitchen@t240a.test', 'h'),
  ('24000000-0000-0000-0000-000000000004', 'cashier@t240b.test', 'h'),
  ('24000000-0000-0000-0000-000000000005', 'admin@t240a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('24100000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', 'Cajera A', 'cashier@t240a.test', 'cashier', true, '24000000-0000-0000-0000-0000000000a1'),
  ('24100000-0000-0000-0000-000000000002', '24000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@t240a.test', 'waiter', true, '24000000-0000-0000-0000-0000000000a1'),
  ('24100000-0000-0000-0000-000000000003', '24000000-0000-0000-0000-000000000003', 'Cocina A', 'kitchen@t240a.test', 'kitchen', true, '24000000-0000-0000-0000-0000000000a1'),
  ('24100000-0000-0000-0000-000000000004', '24000000-0000-0000-0000-000000000004', 'Cajero B', 'cashier@t240b.test', 'cashier', true, '24000000-0000-0000-0000-0000000000b2'),
  ('24100000-0000-0000-0000-000000000005', '24000000-0000-0000-0000-000000000005', 'Admin A', 'admin@t240a.test', 'admin', true, '24000000-0000-0000-0000-0000000000a1');

-- ============================================
-- 2. Order number: per restaurant, from 1, never set by the client
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24200000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a1', 'active', 0, 0, 0, 0),
  ('24200000-0000-0000-0000-0000000000b1', '24000000-0000-0000-0000-0000000000b2', 'active', 0, 0, 0, 0),
  ('24200000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a1', 'active', 0, 0, 0, 0);
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24200000-0000-0000-0000-0000000000a3', '24000000-0000-0000-0000-0000000000a1', 'active', 0, 0, 0, 0);
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24200000-0000-0000-0000-0000000000b2', '24000000-0000-0000-0000-0000000000b2', 'active', 0, 0, 0, 0);

SELECT is(
  (SELECT array_agg(order_number ORDER BY id) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000a1'),
  ARRAY[1, 2, 3],
  'restaurant A numbers its orders from 1 in insert order');
SELECT is(
  (SELECT array_agg(order_number ORDER BY id) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000b2'),
  ARRAY[1, 2],
  'restaurant B has its own counter');
SELECT is(
  (SELECT value FROM private.inventory_counters WHERE restaurant_id = '24000000-0000-0000-0000-0000000000a1' AND counter = 'order_number'),
  3::bigint,
  'the counter of A holds the last number');

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total, order_number) VALUES
  ('24200000-0000-0000-0000-0000000000a4', '24000000-0000-0000-0000-0000000000a1', 'active', 0, 0, 0, 0, 999);
SELECT is(
  (SELECT order_number FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a4'),
  4,
  'an order_number sent on INSERT is ignored: the trigger assigns the next one');
SELECT throws_ok(
  $$ UPDATE public.orders SET order_number = 50 WHERE id = '24200000-0000-0000-0000-0000000000a1' $$,
  '42501', 'orders.order_number is assigned by the database and cannot change',
  'changing order_number is refused');
SELECT lives_ok(
  $$ UPDATE public.orders SET status = 'kitchen', order_number = order_number WHERE id = '24200000-0000-0000-0000-0000000000a1' $$,
  'other columns still update (order_number left as is)');
SELECT is(
  (SELECT order_number FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a1'),
  1,
  'the number survives an update');

INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total)
SELECT '24000000-0000-0000-0000-0000000000b2', 'active', 0, 0, 0, 0 FROM generate_series(1, 3);
SELECT is(
  (SELECT array_agg(order_number ORDER BY order_number) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000b2'),
  ARRAY[1, 2, 3, 4, 5],
  'a multi-row insert gets distinct consecutive numbers');

DELETE FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a4';
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24200000-0000-0000-0000-0000000000a5', '24000000-0000-0000-0000-0000000000a1', 'active', 0, 0, 0, 0);
SELECT is(
  (SELECT order_number FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a5'),
  5,
  'a deleted order''s number is not reused');

-- The API path: the waiter inserts as vipe_api, the restaurant comes from the
-- session default.
SELECT set_config('app.user_id', '24000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, order_number, guests, notes) VALUES
  ('24200000-0000-0000-0000-0000000000a6', 'active', 0, 0, 0, 0, 1, 4, 'Cumpleaños, traer vela');
SELECT is(
  (SELECT order_number FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a6'),
  6,
  'an order inserted by vipe_api gets the next number of its restaurant, whatever it sent');
SELECT is(
  (SELECT row(guests, notes)::text FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a6'),
  '(4,"Cumpleaños, traer vela")',
  'vipe_api writes guests and notes');
SELECT throws_ok(
  $$ UPDATE public.orders SET order_number = 1 WHERE id = '24200000-0000-0000-0000-0000000000a6' $$,
  '42501', 'orders.order_number is assigned by the database and cannot change',
  'vipe_api cannot renumber an order');
SELECT is(
  (SELECT count(*) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'RLS: the waiter of A sees no order of B');
SELECT is(
  (SELECT count(*) FROM public.order_deliveries),
  0::bigint,
  'RLS: a waiter still reads no delivery');
RESET ROLE;

SELECT is(has_function_privilege('vipe_api', 'private.next_inventory_counter(uuid, text)', 'EXECUTE'), false,
  'vipe_api cannot bump a counter directly');
SELECT is(has_table_privilege('vipe_api', 'private.inventory_counters', 'UPDATE'), false,
  'vipe_api cannot write the counters');
SELECT is(has_function_privilege('vipe_api', 'private.assign_order_number()', 'EXECUTE'), false,
  'vipe_api cannot call the numbering trigger function');

-- ============================================
-- 3. Backfill: existing orders numbered per restaurant by (created_at, id)
-- ============================================
-- Replays the pre-migration state for restaurant C: orders without a number
-- (trigger off, NOT NULL dropped inside this rolled-back transaction).
ALTER TABLE public.orders DISABLE TRIGGER orders_assign_order_number;
ALTER TABLE public.orders ALTER COLUMN order_number DROP NOT NULL;
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total, created_at, order_number) VALUES
  ('24200000-0000-0000-0000-0000000000c4', '24000000-0000-0000-0000-0000000000c3', 'paid', 0, 0, 0, 0, '2026-01-03 10:00-05', NULL),
  ('24200000-0000-0000-0000-0000000000c2', '24000000-0000-0000-0000-0000000000c3', 'paid', 0, 0, 0, 0, '2026-01-01 10:00-05', NULL),
  ('24200000-0000-0000-0000-0000000000c1', '24000000-0000-0000-0000-0000000000c3', 'paid', 0, 0, 0, 0, '2026-01-01 10:00-05', NULL),
  ('24200000-0000-0000-0000-0000000000c3', '24000000-0000-0000-0000-0000000000c3', 'paid', 0, 0, 0, 0, '2026-01-02 10:00-05', NULL);
SELECT lives_ok($$ SELECT private.backfill_order_numbers() $$, 'the order number backfill runs');
SELECT is(
  (SELECT array_agg(id::text ORDER BY order_number) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000c3'),
  ARRAY['24200000-0000-0000-0000-0000000000c1', '24200000-0000-0000-0000-0000000000c2',
        '24200000-0000-0000-0000-0000000000c3', '24200000-0000-0000-0000-0000000000c4'],
  'backfilled numbers follow created_at, id breaking ties');
SELECT is(
  (SELECT array_agg(order_number ORDER BY order_number) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000c3'),
  ARRAY[1, 2, 3, 4],
  'the backfill numbers from 1 without gaps');
SELECT is(
  (SELECT value FROM private.inventory_counters WHERE restaurant_id = '24000000-0000-0000-0000-0000000000c3' AND counter = 'order_number'),
  4::bigint,
  'the backfill sets the counter to the highest number');
SELECT is(
  (SELECT array_agg(order_number ORDER BY order_number) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000a1'),
  ARRAY[1, 2, 3, 5, 6],
  'orders that have a number keep it');
SELECT lives_ok($$ SELECT private.backfill_order_numbers() $$, 'the backfill runs again');
SELECT is(
  (SELECT array_agg(order_number ORDER BY id) FROM public.orders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000c3'),
  ARRAY[1, 2, 3, 4],
  'the backfill is idempotent');
ALTER TABLE public.orders ALTER COLUMN order_number SET NOT NULL;
ALTER TABLE public.orders ENABLE TRIGGER orders_assign_order_number;
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24200000-0000-0000-0000-0000000000c5', '24000000-0000-0000-0000-0000000000c3', 'active', 0, 0, 0, 0);
SELECT is(
  (SELECT order_number FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000c5'),
  5,
  'the next order after the backfill continues the counter');
SELECT is(has_function_privilege('vipe_api', 'private.backfill_order_numbers()', 'EXECUTE'), false,
  'vipe_api cannot run the backfill');

-- ============================================
-- 4. Guests and notes
-- ============================================
SELECT is(
  (SELECT row(guests, notes)::text FROM public.orders WHERE id = '24200000-0000-0000-0000-0000000000a1'),
  '(,)',
  'guests and notes stay NULL when not captured');
SELECT throws_ok($$ UPDATE public.orders SET guests = 0 WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'guests 0 is refused');
SELECT throws_ok($$ UPDATE public.orders SET guests = 100 WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'guests 100 is refused');
SELECT lives_ok($$ UPDATE public.orders SET guests = 1 WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, 'guests 1 is accepted');
SELECT lives_ok($$ UPDATE public.orders SET guests = 99 WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, 'guests 99 is accepted');
SELECT throws_ok($$ UPDATE public.orders SET notes = '   ' WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a blank order note is refused');
SELECT throws_ok($$ UPDATE public.orders SET notes = repeat('x', 301) WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'an order note over 300 characters is refused');
SELECT lives_ok($$ UPDATE public.orders SET notes = repeat('x', 300) WHERE id = '24200000-0000-0000-0000-0000000000a1' $$, 'an order note of 300 characters is accepted');

-- ============================================
-- 5. Register opener
-- ============================================
SELECT set_config('app.user_id', '24000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
INSERT INTO public.cash_registers (id, opening_timestamp, initial_cash, status) VALUES
  ('24300000-0000-0000-0000-0000000000a1', now(), 50000, 'open');
SELECT is(
  (SELECT opened_by FROM public.cash_registers WHERE id = '24300000-0000-0000-0000-0000000000a1'),
  '24100000-0000-0000-0000-000000000001'::uuid,
  'a register opened through the API records the caller as opener');
SELECT throws_ok(
  $$ INSERT INTO public.cash_registers (opening_timestamp, initial_cash, status, opened_by) VALUES (now(), 0, 'closed', '24100000-0000-0000-0000-000000000004') $$,
  '23503', NULL, 'a profile of another restaurant cannot be the opener');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('24300000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a1', now(), 0, 'closed');
SELECT is(
  (SELECT opened_by FROM public.cash_registers WHERE id = '24300000-0000-0000-0000-0000000000a2'),
  NULL::uuid,
  'a register written outside a session has no opener (nothing invented)');
INSERT INTO public.users (id, email, password_hash) VALUES ('24000000-0000-0000-0000-000000000006', 'gone@t240a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('24100000-0000-0000-0000-000000000006', '24000000-0000-0000-0000-000000000006', 'Gone A', 'gone@t240a.test', 'cashier', true, '24000000-0000-0000-0000-0000000000a1');
UPDATE public.cash_registers SET opened_by = '24100000-0000-0000-0000-000000000006' WHERE id = '24300000-0000-0000-0000-0000000000a2';
DELETE FROM public.profiles WHERE id = '24100000-0000-0000-0000-000000000006';
SELECT is(
  (SELECT row(opened_by, restaurant_id)::text FROM public.cash_registers WHERE id = '24300000-0000-0000-0000-0000000000a2'),
  '(,24000000-0000-0000-0000-0000000000a1)',
  'deleting the opener clears opened_by and keeps the register''s restaurant');

-- ============================================
-- 6. pay_order with and without a tender reference
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('24400000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0),
  ('24400000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0),
  ('24400000-0000-0000-0000-0000000000a3', '24000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0);
INSERT INTO public.order_items (order_id, name, price, quantity, restaurant_id, status)
SELECT o, 'Bandeja', 25000, 2, '24000000-0000-0000-0000-0000000000a1', 'kitchen'
  FROM unnest(ARRAY['24400000-0000-0000-0000-0000000000a1', '24400000-0000-0000-0000-0000000000a2', '24400000-0000-0000-0000-0000000000a3']::uuid[]) o;

CREATE FUNCTION pg_temp.method(p_restaurant uuid, p_code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.payment_methods WHERE restaurant_id = p_restaurant AND code = p_code
$$;
CREATE TABLE pg_temp.results (k text PRIMARY KEY, r jsonb);
GRANT ALL ON pg_temp.results TO vipe_api;

SELECT set_config('app.user_id', '24000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
-- Bill: 50000 + 8 % tax = 54000, tip 2000 -> tenders 56000.
INSERT INTO pg_temp.results SELECT 'with', public.pay_order(
  '24400000-0000-0000-0000-0000000000a1', '24300000-0000-0000-0000-0000000000a1', 2000,
  jsonb_build_array(
    jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi'), 'amount', 36000, 'reference', '  NQ-778812  '),
    jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'cash'), 'amount', 20000, 'cash_received', 20000, 'reference', null)),
  '24500000-0000-0000-0000-0000000000a1');
INSERT INTO pg_temp.results SELECT 'without', public.pay_order(
  '24400000-0000-0000-0000-0000000000a2', '24300000-0000-0000-0000-0000000000a1', 2000,
  jsonb_build_array(
    jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi'), 'amount', 36000),
    jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'cash'), 'amount', 20000, 'cash_received', 20000)),
  '24500000-0000-0000-0000-0000000000a2');
SELECT is(
  (SELECT r - 'payment_id' - 'drawer_cash_before' FROM pg_temp.results WHERE k = 'with'),
  (SELECT r - 'payment_id' - 'drawer_cash_before' FROM pg_temp.results WHERE k = 'without'),
  'pay_order answers the same with and without references');
SELECT is(
  (SELECT r ->> 'total_charged' FROM pg_temp.results WHERE k = 'with'),
  '56000',
  'amounts are unchanged by a reference');
SELECT is(
  (SELECT array_agg(coalesce(t.reference, '<null>') ORDER BY t.line_no) FROM public.payment_tenders t
     JOIN public.payments p ON p.id = t.payment_id WHERE p.order_id = '24400000-0000-0000-0000-0000000000a1'),
  ARRAY['NQ-778812', '<null>'],
  'the reference is stored trimmed per tender; JSON null stores NULL');
SELECT is(
  (SELECT count(*) FROM public.payment_tenders t JOIN public.payments p ON p.id = t.payment_id
    WHERE p.order_id = '24400000-0000-0000-0000-0000000000a2' AND t.reference IS NULL),
  2::bigint,
  'an old payload without reference stores NULL references');
SELECT is(
  public.pay_order(
    '24400000-0000-0000-0000-0000000000a1', '24300000-0000-0000-0000-0000000000a1', 2000,
    jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi'), 'amount', 56000, 'reference', 'OTHER')),
    '24500000-0000-0000-0000-0000000000a1') ->> 'status',
  'already_paid',
  'a replay with the same key stays idempotent');
SELECT is(
  (SELECT count(*) FROM public.payment_tenders t JOIN public.payments p ON p.id = t.payment_id
    WHERE p.order_id = '24400000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'the replay writes no tender');
SELECT throws_ok(
  format($$ SELECT public.pay_order('24400000-0000-0000-0000-0000000000a3', '24300000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', %L::uuid, 'amount', 54000, 'reference', '   ')),
    '24500000-0000-0000-0000-0000000000a3') $$, pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi')),
  '22023', 'pay_order: tender[1].reference must be 1 to 60 characters',
  'a blank reference is refused');
SELECT throws_ok(
  format($$ SELECT public.pay_order('24400000-0000-0000-0000-0000000000a3', '24300000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', %L::uuid, 'amount', 54000, 'reference', repeat('9', 61))),
    '24500000-0000-0000-0000-0000000000a3') $$, pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi')),
  '22023', 'pay_order: tender[1].reference must be 1 to 60 characters',
  'a reference over 60 characters is refused');
SELECT throws_ok(
  format($$ SELECT public.pay_order('24400000-0000-0000-0000-0000000000a3', '24300000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', %L::uuid, 'amount', 54000, 'reference', 4242)),
    '24500000-0000-0000-0000-0000000000a3') $$, pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi')),
  '22023', 'pay_order: tender[1].reference must be a string',
  'a non-string reference is refused');
SELECT is(
  (SELECT count(*) FROM public.payments WHERE order_id = '24400000-0000-0000-0000-0000000000a3'),
  0::bigint,
  'a refused reference writes no payment');
SELECT is(
  public.pay_order(
    '24400000-0000-0000-0000-0000000000a3', '24300000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'transfer'), 'amount', 54000, 'reference', repeat('9', 60))),
    '24500000-0000-0000-0000-0000000000a3') ->> 'status',
  'paid',
  'a reference of 60 characters is accepted');
SELECT is(
  (SELECT count(*) FROM public.payment_tenders WHERE restaurant_id = '24000000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'RLS: the cashier of A sees no tender of B');
SELECT throws_ok(
  $$ UPDATE public.payment_tenders SET reference = 'X' WHERE reference IS NULL $$,
  '42501', NULL, 'a tender reference cannot be edited after the payment');
RESET ROLE;
SELECT throws_ok(
  $$ UPDATE public.payment_tenders SET reference = repeat('x', 61) WHERE reference = 'NQ-778812' $$,
  '23514', NULL, 'the reference CHECK refuses over 60 characters');

-- ============================================
-- 7. Delivery details
-- ============================================
INSERT INTO public.customers (id, restaurant_id, phone, name) VALUES
  ('24600000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a1', '3001234567', 'Cliente A');
INSERT INTO public.orders (id, restaurant_id, status, order_type, subtotal, tax, tax_percentage, total) VALUES
  ('24700000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a1', 'kitchen', 'delivery', 0, 0, 0, 0),
  ('24700000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a1', 'kitchen', 'delivery', 0, 0, 0, 0);
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line, payment_mode) VALUES
  ('24700000-0000-0000-0000-0000000000a1', '24000000-0000-0000-0000-0000000000a1', '24600000-0000-0000-0000-0000000000a1', 'Cliente A', '3001234567', 'Calle 1', 'prepaid'),
  ('24700000-0000-0000-0000-0000000000a2', '24000000-0000-0000-0000-0000000000a1', '24600000-0000-0000-0000-0000000000a1', 'Cliente A', '3001234567', 'Calle 1', 'cash_on_delivery');
SELECT is(
  (SELECT row(prepaid_method_id, courier_eta, courier_location, returned_at)::text FROM public.order_deliveries WHERE order_id = '24700000-0000-0000-0000-0000000000a1'),
  '(,,,)',
  'the new delivery columns stay NULL until captured');
SELECT lives_ok(
  format($$ UPDATE public.order_deliveries SET prepaid_method_id = %L WHERE order_id = '24700000-0000-0000-0000-0000000000a1' $$,
    pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi')),
  'a prepaid delivery records a method of its restaurant');
SELECT throws_ok(
  format($$ UPDATE public.order_deliveries SET prepaid_method_id = %L WHERE order_id = '24700000-0000-0000-0000-0000000000a1' $$,
    pg_temp.method('24000000-0000-0000-0000-0000000000b2', 'nequi')),
  '23503', NULL, 'a method of another restaurant is refused');
SELECT throws_ok(
  format($$ UPDATE public.order_deliveries SET prepaid_method_id = %L WHERE order_id = '24700000-0000-0000-0000-0000000000a2' $$,
    pg_temp.method('24000000-0000-0000-0000-0000000000a1', 'nequi')),
  '23514', NULL, 'a cash-on-delivery order has no prepaid method');
SELECT throws_ok($$ UPDATE public.order_deliveries SET courier_location = ' ' WHERE order_id = '24700000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a blank courier location is refused');
SELECT throws_ok($$ UPDATE public.order_deliveries SET courier_location = repeat('x', 61) WHERE order_id = '24700000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a courier location over 60 characters is refused');
SELECT lives_ok($$ UPDATE public.order_deliveries SET courier_location = repeat('x', 60), courier_eta = now() + interval '20 minutes' WHERE order_id = '24700000-0000-0000-0000-0000000000a1' $$,
  'a courier location of 60 characters and an ETA are accepted');
SELECT throws_ok($$ UPDATE public.order_deliveries SET returned_at = now() WHERE order_id = '24700000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'a courier cannot return from a delivery never dispatched');
SELECT throws_ok($$ UPDATE public.order_deliveries SET dispatched_at = now(), returned_at = now() - interval '1 minute' WHERE order_id = '24700000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'returned_at before dispatched_at is refused');
SELECT lives_ok($$ UPDATE public.order_deliveries SET dispatched_at = now(), returned_at = now() WHERE order_id = '24700000-0000-0000-0000-0000000000a2' $$,
  'returned_at at or after dispatched_at is accepted');

SELECT set_config('app.user_id', '24000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT count(*) FROM public.order_deliveries WHERE restaurant_id = '24000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'RLS: the kitchen still reads the deliveries of its restaurant');
SELECT throws_ok($$ UPDATE public.order_deliveries SET courier_location = 'Laureles' $$,
  '42501', NULL, 'the delivery guard still refuses direct writes from the API role');
SELECT set_config('app.user_id', '24000000-0000-0000-0000-000000000004', true);
SELECT is(
  (SELECT count(*) FROM public.order_deliveries),
  0::bigint,
  'RLS: the cashier of B reads no delivery of A');
SELECT is(
  (SELECT count(*) FROM public.cash_registers WHERE restaurant_id = '24000000-0000-0000-0000-0000000000a1'),
  0::bigint,
  'RLS: the cashier of B reads no register of A');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
