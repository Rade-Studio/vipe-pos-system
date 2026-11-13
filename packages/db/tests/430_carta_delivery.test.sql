-- Guest delivery from the public carta (odd/tasks/carta-digital.md T6, S2,
-- S15, migration 0037).
--
-- carta_delivery_requests: admin, cashier and delivery operator of the
-- restaurant read; nobody writes it directly. Guests (vipe_api with no
-- app.user_id) submit through guest_submit_delivery and follow their order
-- with its tracking token (guest_delivery_status); an operator confirms (the
-- API then creates the delivery order and links it) or rejects. Rejected
-- input leaves no row. The table notifies the staff room.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(112);

-- ============================================
-- 1. Schema, grants, policies, realtime
-- ============================================
SELECT has_table('public', 'carta_delivery_requests', 'carta_delivery_requests exists');
SELECT ok((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.carta_delivery_requests'::regclass),
  'RLS is enabled on carta_delivery_requests');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('guest_submit_delivery', 'guest_delivery_status', 'confirm_delivery_request',
                        'link_delivery_request', 'reject_delivery_request')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
      AND obj_description(p.oid, 'pg_proc') IS NOT NULL)::bigint,
  5::bigint,
  'the guest and staff functions are SECURITY DEFINER, pinned, commented, vipe_api only (PUBLIC/anon cannot execute)');
SELECT is(
  (SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'guest_delivery_status'),
  's'::"char", 'guest_delivery_status is STABLE');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname IN ('guest_submit_delivery', 'guest_delivery_status')
       AND p.prosrc ~ '(current_restaurant_id|current_user_id|current_app_role|current_profile_id)'),
  'the guest functions never read the staff identity');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.carta_delivery_staff_restaurant(text)', 'EXECUTE'),
  'the staff role helper is not granted to vipe_api');
SELECT is(
  (SELECT count(*) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
    WHERE has_table_privilege('vipe_api', 'public.carta_delivery_requests', p))::bigint,
  0::bigint, 'vipe_api holds no INSERT/UPDATE/DELETE on carta_delivery_requests');
SELECT trigger_is('public', 'carta_delivery_requests', 'notify_change', 'private', 'notify_change', 'carta_delivery_requests notifies changes');
SELECT is(
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.carta_delivery_requests'::regclass AND t.tgname = 'notify_change'
      AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 0 AND (t.tgtype & 28) = 28)::bigint,
  1::bigint, 'the notify trigger is AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW');

-- ============================================
-- Fixtures: A (published, delivery on, fee 4000), B (published, delivery on), C (unpublished).
-- ============================================
INSERT INTO public.restaurants (id, slug, name, timezone) VALUES
  ('43000000-0000-0000-0000-0000000000a1', 't430-a', 'T430 A', 'America/Bogota'),
  ('43000000-0000-0000-0000-0000000000b2', 't430-b', 'T430 B', 'America/Bogota'),
  ('43000000-0000-0000-0000-0000000000c3', 't430-c', 'T430 C', 'America/Bogota');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('43000000-0000-0000-0000-000000000001', 'admin@t430a.test', 'h'),
  ('43000000-0000-0000-0000-000000000002', 'waiter@t430a.test', 'h'),
  ('43000000-0000-0000-0000-000000000003', 'kitchen@t430a.test', 'h'),
  ('43000000-0000-0000-0000-000000000004', 'cashier@t430a.test', 'h'),
  ('43000000-0000-0000-0000-000000000005', 'admin@t430b.test', 'h'),
  ('43000000-0000-0000-0000-000000000006', 'delivery@t430a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('43100000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t430a.test', 'admin', true, '43000000-0000-0000-0000-0000000000a1'),
  ('43100000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@t430a.test', 'waiter', true, '43000000-0000-0000-0000-0000000000a1'),
  ('43100000-0000-0000-0000-000000000003', '43000000-0000-0000-0000-000000000003', 'Cocina A', 'kitchen@t430a.test', 'kitchen', true, '43000000-0000-0000-0000-0000000000a1'),
  ('43100000-0000-0000-0000-000000000004', '43000000-0000-0000-0000-000000000004', 'Caja A', 'cashier@t430a.test', 'cashier', true, '43000000-0000-0000-0000-0000000000a1'),
  ('43100000-0000-0000-0000-000000000005', '43000000-0000-0000-0000-000000000005', 'Admin B', 'admin@t430b.test', 'admin', true, '43000000-0000-0000-0000-0000000000b2'),
  ('43100000-0000-0000-0000-000000000006', '43000000-0000-0000-0000-000000000006', 'Domicilios A', 'delivery@t430a.test', 'delivery_operator', true, '43000000-0000-0000-0000-0000000000a1');
INSERT INTO public.dishes (id, restaurant_id, name, price, active) VALUES
  ('43300000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', 'Bandeja', 20000, true),
  ('43300000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-0000000000a1', 'Pausado', 15000, false),
  ('43300000-0000-0000-0000-000000000003', '43000000-0000-0000-0000-0000000000a1', 'Limonada', 5000, true),
  ('43300000-0000-0000-0000-000000000004', '43000000-0000-0000-0000-0000000000a1', 'Agotado', 9000, true),
  ('43300000-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-0000000000b2', 'Plato B', 9000, true);
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('43000000-0000-0000-0000-0000000000a1', 'inventory_control_enabled', 'true'),
  ('43000000-0000-0000-0000-0000000000a1', 'delivery_default_fee', '4000');
-- Agotado needs flour that has no stock.
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind, cost) VALUES
  ('43600000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', 'Harina', 'g', 'raw', 7);
INSERT INTO public.recipes (id, restaurant_id, dish_id) VALUES
  ('43610000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', '43300000-0000-0000-0000-000000000004');
INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity) VALUES
  ('43000000-0000-0000-0000-0000000000a1', '43610000-0000-0000-0000-000000000001', '43600000-0000-0000-0000-000000000001', 100);
-- Bandeja: Término required (exactly 1).
INSERT INTO public.modifier_groups (id, restaurant_id, name, required, min_select, max_select, is_active) VALUES
  ('43400000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', 'Término', true, 1, 1, true);
INSERT INTO public.modifier_options (id, restaurant_id, group_id, name, price, is_active) VALUES
  ('43410000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', '43400000-0000-0000-0000-000000000001', 'Término medio', 0, true);
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('43000000-0000-0000-0000-0000000000a1', '43300000-0000-0000-0000-000000000001', '43400000-0000-0000-0000-000000000001', 0);
INSERT INTO public.carta_settings (restaurant_id, published, delivery_ordering_enabled) VALUES
  ('43000000-0000-0000-0000-0000000000a1', true, true),
  ('43000000-0000-0000-0000-0000000000b2', true, true),
  ('43000000-0000-0000-0000-0000000000c3', false, true);

-- Guest helpers: one valid body each, overridden per test.
CREATE FUNCTION pg_temp.cust(p_phone text DEFAULT '3001234567', p_name text DEFAULT ' Ana Gómez ',
                             p_address text DEFAULT 'Calle 10 # 5-20', p_neigh text DEFAULT 'Centro') RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_strip_nulls(jsonb_build_object('name', p_name, 'phone', p_phone, 'address', p_address, 'neighborhood', p_neigh)) $$;
CREATE FUNCTION pg_temp.lim(p_qty integer DEFAULT 1) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_array(jsonb_build_object('dishId', '43300000-0000-0000-0000-000000000003', 'quantity', p_qty)) $$;
CREATE FUNCTION pg_temp.cash(p_from integer DEFAULT 50000) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_strip_nulls(jsonb_build_object('method', 'cash', 'cashFrom', p_from)) $$;
GRANT EXECUTE ON FUNCTION pg_temp.cust(text, text, text, text), pg_temp.lim(integer), pg_temp.cash(integer) TO vipe_api;

-- ============================================
-- 2. guest_submit_delivery (S15): success
-- ============================================
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t430_r1 ON COMMIT DROP AS
  SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(),
    '[{"dishId": "43300000-0000-0000-0000-000000000001", "quantity": 2, "optionIds": ["43410000-0000-0000-0000-000000000001"], "note": "sin cebolla", "price": 1},
      {"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1}]',
    pg_temp.cash(), ' Timbre dañado ') AS r;
CREATE TEMP TABLE t430_r2 ON COMMIT DROP AS
  SELECT private.guest_submit_delivery('t430-a', pg_temp.cust('3007654321', 'Luis', 'Carrera 7 # 1-2', NULL), pg_temp.lim(3),
    '{"method": "card"}', NULL) AS r;
RESET ROLE;
GRANT SELECT ON t430_r1, t430_r2 TO vipe_api;
SELECT is((SELECT r ->> 'status' FROM t430_r1), 'pending', 'a valid delivery request is stored as pending');
SELECT ok((SELECT (r ->> 'requestId')::uuid IS NOT NULL AND (r ->> 'createdAt')::timestamptz IS NOT NULL
                  AND r ->> 'trackingToken' ~ '^[A-Za-z0-9_-]{24}$'
                  AND (SELECT count(*) FROM jsonb_object_keys(r)) = 4 FROM t430_r1),
  'guest_submit_delivery returns exactly {requestId, trackingToken (24 base64url), status, createdAt}');
SELECT isnt((SELECT r ->> 'trackingToken' FROM t430_r1), (SELECT r ->> 'trackingToken' FROM t430_r2), 'every request gets its own token');
SELECT is(
  (SELECT jsonb_build_object('r', d.restaurant_id, 't', d.tracking_token, 'n', d.customer_name, 'p', d.phone, 'a', d.address,
                             'b', d.neighborhood, 'o', d.notes, 'm', d.payment_method, 'c', d.cash_from, 'f', d.delivery_fee,
                             'i', d.items, 's', d.status, 'x', d.delivery_order_id, 'dt', d.decided_at)
     FROM public.carta_delivery_requests d WHERE d.id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1)),
  jsonb_build_object('r', '43000000-0000-0000-0000-0000000000a1', 't', (SELECT r ->> 'trackingToken' FROM t430_r1),
    'n', 'Ana Gómez', 'p', '3001234567', 'a', 'Calle 10 # 5-20', 'b', 'Centro', 'o', 'Timbre dañado', 'm', 'cash', 'c', 50000, 'f', 4000,
    'i', '[{"dishId": "43300000-0000-0000-0000-000000000001", "quantity": 2, "optionIds": ["43410000-0000-0000-0000-000000000001"], "note": "sin cebolla"},
           {"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1, "optionIds": [], "note": null}]'::jsonb,
    's', 'pending', 'x', NULL, 'dt', NULL),
  'the row keeps the slug''s restaurant, trimmed customer, payment, the delivery fee and lines normalized like proposals');
SELECT is(
  (SELECT jsonb_build_object('m', d.payment_method, 'c', d.cash_from, 'b', d.neighborhood, 'o', d.notes)
     FROM public.carta_delivery_requests d WHERE d.id = (SELECT (r ->> 'requestId')::uuid FROM t430_r2)),
  '{"m": "card", "c": null, "b": null, "o": null}'::jsonb, 'card without cashFrom, no neighborhood and no notes are stored as null');

-- ============================================
-- 3. guest_submit_delivery: every rejection, no row written
-- ============================================
CREATE TEMP TABLE t430_count ON COMMIT DROP AS SELECT count(*) AS n FROM public.carta_delivery_requests;
UPDATE public.carta_settings SET delivery_ordering_enabled = false WHERE restaurant_id = '43000000-0000-0000-0000-0000000000b2';
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.guest_submit_delivery('nope', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  'P0002', 'guest_submit_delivery: carta_not_found', 'an unknown slug is not found');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-c', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  'P0002', 'guest_submit_delivery: carta_not_found', 'an unpublished carta is not found');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-b', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: delivery_ordering_disabled', 'online delivery off refuses requests');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', '"Ana"', pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: customer_invalid', 'the customer must be an object');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_name => '   '), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: name_invalid', 'a blank name is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_name => NULL), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: name_invalid', 'a missing name is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_name => repeat('n', 121)), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: name_invalid', 'a name has at most 120 characters');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust('300-123-4567'), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: phone_invalid', 'a phone is digits only');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust('123456'), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: phone_invalid', 'a phone has at least 7 digits');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust('1234567890123456'), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: phone_invalid', 'a phone has at most 15 digits');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_address => 'Cl 1 '), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: address_invalid', 'an address has at least 6 characters');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_address => repeat('a', 201)), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: address_invalid', 'an address has at most 200 characters');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(p_neigh => repeat('b', 81)), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: neighborhood_invalid', 'a neighborhood has at most 80 characters');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(), repeat('o', 201)) $$,
  '22023', 'guest_submit_delivery: note_invalid', 'notes have at most 200 characters');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '{"method": "bitcoin"}', NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'an unknown payment method is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '"cash"', NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'the payment must be an object');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(-1), NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'cashFrom is not negative');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '{"method": "cash", "cashFrom": 1.5}', NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'cashFrom is an integer');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '{"method": "cash", "cashFrom": "50000"}', NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'cashFrom is a number');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '{"method": "transfer", "cashFrom": 50000}', NULL) $$,
  '22023', 'guest_submit_delivery: payment_invalid', 'cashFrom only with cash');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), '[]', pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: items_invalid', 'items need at least one line');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(21), pg_temp.cash(), NULL) $$,
  '22023', 'guest_submit_delivery: items_invalid', 'quantity is at most 20 (the proposals rule)');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-000000000002", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: dish_unavailable', 'a paused dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-000000000004", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: dish_unavailable', 'a sold-out dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: dish_unavailable', 'another restaurant''s dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-000000000001", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: options_invalid', 'a required option group must be chosen');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), (SELECT n FROM t430_count), 'no refused request wrote a row');
UPDATE public.carta_settings SET delivery_ordering_enabled = true WHERE restaurant_id = '43000000-0000-0000-0000-0000000000b2';

-- ============================================
-- 4. Limits: 2 pending per phone and restaurant, 30 pending per restaurant an hour
-- ============================================
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t430_r3 ON COMMIT DROP AS
  SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), '{"method": "transfer"}', NULL) AS r;
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: too_many_pending', 'a third pending request of the same phone is refused');
SELECT lives_ok($$ SELECT private.guest_submit_delivery('t430-b', pg_temp.cust(),
  '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'the phone limit is per restaurant: B still accepts the same phone');
RESET ROLE;
GRANT SELECT ON t430_r3 TO vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests WHERE restaurant_id = '43000000-0000-0000-0000-0000000000a1' AND phone = '3001234567'),
  2::bigint, 'the refused third request wrote nothing');
-- B: 5 pending from two hours ago do not count; 28 recent pending + the one above = 29.
INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items, created_at)
  SELECT '43000000-0000-0000-0000-0000000000b2', private.new_table_qr_token(), 'Cliente', (3100000000 + g)::text, 'Calle 1 # 2-3', 'cash',
         '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1, "optionIds": [], "note": null}]',
         CASE WHEN g <= 5 THEN now() - interval '2 hours' ELSE now() END
    FROM generate_series(1, 33) g;
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.guest_submit_delivery('t430-b', pg_temp.cust('3200000001'),
  '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'the 30th pending request of the hour is accepted (older ones do not count)');
SELECT throws_ok($$ SELECT private.guest_submit_delivery('t430-b', pg_temp.cust('3200000002'),
  '[{"dishId": "43300000-0000-0000-0000-0000000000b1", "quantity": 1}]', pg_temp.cash(), NULL) $$,
  'P0001', 'guest_submit_delivery: too_busy', 'a 31st pending request within the hour is refused');
SELECT lives_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust('3200000002'), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  'the hourly limit is per restaurant: A still accepts');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests WHERE restaurant_id = '43000000-0000-0000-0000-0000000000b2' AND status = 'pending'),
  35::bigint, 'the refused 31st request wrote nothing');

-- ============================================
-- 5. guest_delivery_status while pending
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') - 'createdAt' FROM t430_r1),
  '{"status": "pending", "stage": "pending", "rejectReason": null, "total": null, "deliveryFee": 4000, "paymentMethod": "cash",
    "orderNumber": null, "lines": [{"name": "Bandeja", "quantity": 2}, {"name": "Limonada", "quantity": 1}]}'::jsonb,
  'a pending request shows its stage, lines, fee and payment, no total and no customer data');
SELECT ok((SELECT (private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'createdAt')::timestamptz IS NOT NULL FROM t430_r1),
  'the status carries createdAt');
SELECT is((SELECT private.guest_delivery_status('t430-b', r ->> 'trackingToken') FROM t430_r1), NULL, 'another slug never resolves the token');
SELECT is(private.guest_delivery_status('t430-a', 'AAAAAAAAAAAAAAAAAAAAAAAA'), NULL, 'an unknown token is NULL');
SELECT is(private.guest_delivery_status('t430-a', NULL), NULL, 'a NULL token is NULL');
SELECT is(private.guest_delivery_status('nope', 'AAAAAAAAAAAAAAAAAAAAAAAA'), NULL, 'an unknown slug is NULL');
RESET ROLE;
UPDATE public.carta_settings SET published = false WHERE restaurant_id = '43000000-0000-0000-0000-0000000000a1';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') FROM t430_r1), NULL, 'an unpublished carta resolves nothing');
RESET ROLE;
UPDATE public.carta_settings SET published = true WHERE restaurant_id = '43000000-0000-0000-0000-0000000000a1';

-- ============================================
-- 6. Staff read, no direct writes, realtime row
-- ============================================
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000006', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), 4::bigint, 'a delivery operator reads the requests of their restaurant only');
SELECT throws_ok($$ INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items)
  VALUES ('43000000-0000-0000-0000-0000000000a1', 'BBBBBBBBBBBBBBBBBBBBBBBB', 'X', '3000000000', 'Calle 1 # 2', 'cash', '[]') $$,
  '42501', NULL, 'vipe_api cannot insert requests');
SELECT throws_ok($$ UPDATE public.carta_delivery_requests SET status = 'confirmed' $$, '42501', NULL, 'vipe_api cannot update requests');
SELECT throws_ok($$ DELETE FROM public.carta_delivery_requests $$, '42501', NULL, 'vipe_api cannot delete requests');
SELECT is((private.realtime_row('carta_delivery_requests', (SELECT (r ->> 'requestId')::uuid FROM t430_r1))) ->> 'restaurant_id',
  '43000000-0000-0000-0000-0000000000a1', 'realtime_row loads a delivery request for the staff room');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), 4::bigint, 'a cashier reads them');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), 4::bigint, 'an admin reads them');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), 0::bigint, 'a waiter reads none (customer data)');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests), 0::bigint, 'the kitchen reads none');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests WHERE restaurant_id = '43000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another restaurant''s admin reads none of A''s requests');
RESET ROLE;
SELECT ok((SELECT private.change_payload('carta_delivery_requests', 'INSERT', to_jsonb(d), NULL)
                  = jsonb_build_object('table', 'carta_delivery_requests', 'op', 'INSERT', 'id', d.id::text, 'restaurant_id', d.restaurant_id::text)
             FROM public.carta_delivery_requests d WHERE d.id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1)),
  'the notify payload names the table, id and restaurant room');

-- ============================================
-- 7. Role and tenant checks of the staff functions
-- ============================================
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) $$,
  '42501', 'confirm_delivery_request: role_not_allowed', 'the kitchen cannot confirm');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) $$,
  '42501', 'confirm_delivery_request: role_not_allowed', 'a waiter cannot confirm');
SELECT throws_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), NULL) $$,
  '42501', 'reject_delivery_request: role_not_allowed', 'a waiter cannot reject');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), gen_random_uuid()) $$,
  '42501', 'link_delivery_request: role_not_allowed', 'a waiter cannot link');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) $$,
  '42501', 'confirm_delivery_request: role_not_allowed', 'a guest (no app.user_id) cannot confirm');
RESET ROLE;
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) $$,
  'P0002', 'confirm_delivery_request: delivery_request_not_found', 'another restaurant''s admin cannot confirm');
SELECT throws_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), NULL) $$,
  'P0002', 'reject_delivery_request: delivery_request_not_found', 'another restaurant''s admin cannot reject');
RESET ROLE;
SELECT is((SELECT status FROM public.carta_delivery_requests WHERE id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1)), 'pending',
  'the refused staff calls changed nothing');

-- ============================================
-- 8. confirm, link, delivery stages (S15)
-- ============================================
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000006', true);
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t430_c1 ON COMMIT DROP AS SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) AS r;
RESET ROLE;
SELECT is((SELECT r FROM t430_c1),
  jsonb_build_object('requestId', (SELECT r ->> 'requestId' FROM t430_r1),
    'customer', '{"name": "Ana Gómez", "phone": "3001234567"}'::jsonb, 'address', 'Calle 10 # 5-20', 'neighborhood', 'Centro',
    'notes', 'Timbre dañado', 'paymentMethod', 'cash', 'cashFrom', 50000, 'deliveryFee', 4000,
    'items', (SELECT items FROM public.carta_delivery_requests WHERE id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1))),
  'confirm returns what the API needs to create the delivery order');
SELECT is(
  (SELECT jsonb_build_object('s', status, 'by', decided_by, 'at', decided_at IS NOT NULL)
     FROM public.carta_delivery_requests WHERE id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1)),
  '{"s": "confirmed", "by": "43100000-0000-0000-0000-000000000006", "at": true}'::jsonb, 'confirm records the status, time and operator');
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1)) $$,
  'P0001', 'confirm_delivery_request: delivery_request_not_pending', 'a request is confirmed once');
SELECT throws_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), NULL) $$,
  'P0001', 'reject_delivery_request: delivery_request_not_pending', 'a confirmed request cannot be rejected');
SELECT throws_ok($$ SELECT private.confirm_delivery_request(gen_random_uuid()) $$,
  'P0002', 'confirm_delivery_request: delivery_request_not_found', 'an unknown request is not found');
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r1), 'received',
  'a confirmed request not yet linked reads received');
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') -> 'total' FROM t430_r1), 'null'::jsonb,
  'no total before the delivery order is linked');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r2), '43900000-0000-0000-0000-000000000001') $$,
  'P0001', 'link_delivery_request: delivery_request_not_confirmed', 'a pending request cannot be linked');
RESET ROLE;
-- The delivery orders the API would create (create_delivery_order), a dine-in order and B's delivery.
INSERT INTO public.orders (id, restaurant_id, waiter_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total, order_type) VALUES
  ('43900000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', '43100000-0000-0000-0000-000000000006', 'kitchen', 45000, 0, 0, 0, 0, 45000, 'delivery'),
  ('43900000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-0000000000a1', '43100000-0000-0000-0000-000000000006', 'kitchen', 15000, 0, 0, 0, 0, 15000, 'delivery'),
  ('43900000-0000-0000-0000-000000000003', '43000000-0000-0000-0000-0000000000a1', '43100000-0000-0000-0000-000000000002', 'active', 0, 0, 0, 0, 0, 0, 'dine_in'),
  ('43900000-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-0000000000b2', '43100000-0000-0000-0000-000000000005', 'kitchen', 9000, 0, 0, 0, 0, 9000, 'delivery');
INSERT INTO public.customers (id, restaurant_id, phone, name) VALUES
  ('43910000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', '3001234567', 'Ana Gómez'),
  ('43910000-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-0000000000b2', '3001234567', 'Ana Gómez');
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line, delivery_fee, payment_mode) VALUES
  ('43900000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-0000000000a1', '43910000-0000-0000-0000-000000000001', 'Ana Gómez', '3001234567', 'Calle 10 # 5-20', 4000, 'cash_on_delivery'),
  ('43900000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-0000000000a1', '43910000-0000-0000-0000-000000000001', 'Ana Gómez', '3001234567', 'Calle 10 # 5-20', 4000, 'cash_on_delivery'),
  ('43900000-0000-0000-0000-0000000000b1', '43000000-0000-0000-0000-0000000000b2', '43910000-0000-0000-0000-0000000000b1', 'Ana Gómez', '3001234567', 'Calle 1', 0, 'cash_on_delivery');
CREATE TEMP TABLE t430_onum ON COMMIT DROP AS SELECT order_number AS n FROM public.orders WHERE id = '43900000-0000-0000-0000-000000000001';
GRANT SELECT ON t430_onum TO vipe_api;
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), gen_random_uuid()) $$,
  'P0002', 'link_delivery_request: delivery_order_not_found', 'an unknown order cannot be linked');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), '43900000-0000-0000-0000-0000000000b1') $$,
  'P0002', 'link_delivery_request: delivery_order_not_found', 'another restaurant''s delivery cannot be linked');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), '43900000-0000-0000-0000-000000000003') $$,
  'P0002', 'link_delivery_request: delivery_order_not_found', 'a dine-in order cannot be linked');
SELECT lives_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), '43900000-0000-0000-0000-000000000001') $$,
  'the operator links the delivery order created on confirm');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r1), '43900000-0000-0000-0000-000000000002') $$,
  'P0001', 'link_delivery_request: delivery_request_already_linked', 'a request is linked once');
RESET ROLE;
SELECT is((SELECT delivery_order_id FROM public.carta_delivery_requests WHERE id = (SELECT (r ->> 'requestId')::uuid FROM t430_r1)),
  '43900000-0000-0000-0000-000000000001'::uuid, 'the request keeps the delivery order');
-- A cashier confirms too; the same delivery order cannot serve two requests.
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.confirm_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r2)) $$, 'a cashier can confirm');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r2), '43900000-0000-0000-0000-000000000001') $$,
  'P0001', 'link_delivery_request: delivery_order_already_linked', 'one delivery order per request');
SELECT lives_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r2), '43900000-0000-0000-0000-000000000002') $$,
  'the second request links its own delivery order');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') - 'createdAt' FROM t430_r1),
  jsonb_build_object('status', 'confirmed', 'stage', 'received', 'rejectReason', NULL, 'total', 49000, 'deliveryFee', 4000,
    'paymentMethod', 'cash', 'orderNumber', (SELECT n FROM t430_onum),
    'lines', '[{"name": "Bandeja", "quantity": 2}, {"name": "Limonada", "quantity": 1}]'::jsonb),
  'once linked: received, the order number and the delivery order''s total plus its fee');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'preparing' WHERE order_id = '43900000-0000-0000-0000-000000000001';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r1), 'preparing', 'preparing follows the delivery');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'ready' WHERE order_id = '43900000-0000-0000-0000-000000000001';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r1), 'ready', 'ready follows the delivery');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'out_for_delivery', dispatched_at = now() WHERE order_id = '43900000-0000-0000-0000-000000000001';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r1), 'out_for_delivery', 'En camino follows the delivery');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'delivered', delivered_at = now() WHERE order_id = '43900000-0000-0000-0000-000000000001';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r1), 'delivered', 'Entregado follows the delivery');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'failed', failed_at = now(), failure_reason = 'No contestó' WHERE order_id = '43900000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r2), 'failed', 'a failed delivery reads failed');
SELECT ok((SELECT NOT (private.guest_delivery_status('t430-a', r ->> 'trackingToken') ?| ARRAY['failureReason', 'courier', 'phone', 'address', 'customerName']) FROM t430_r2),
  'the status never carries the failure reason, courier or customer data');
RESET ROLE;
UPDATE public.order_deliveries SET delivery_status = 'cancelled', cancelled_at = now(), failure_reason = NULL WHERE order_id = '43900000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') ->> 'stage' FROM t430_r2), 'cancelled', 'a cancelled delivery reads cancelled');
RESET ROLE;

-- ============================================
-- 9. reject (S15)
-- ============================================
SELECT set_config('app.user_id', '43000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r3), repeat('r', 141)) $$,
  '22023', 'reject_delivery_request: reason_invalid', 'a reason has at most 140 characters');
SELECT lives_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r3), '  No llegamos a tu barrio  ') $$,
  'a cashier rejects a pending request with a reason');
SELECT throws_ok($$ SELECT private.reject_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r3), NULL) $$,
  'P0001', 'reject_delivery_request: delivery_request_not_pending', 'a request is rejected once');
SELECT throws_ok($$ SELECT private.link_delivery_request((SELECT (r ->> 'requestId')::uuid FROM t430_r3), '43900000-0000-0000-0000-000000000002') $$,
  'P0001', 'link_delivery_request: delivery_request_not_confirmed', 'a rejected request cannot be linked');
RESET ROLE;
SELECT is(
  (SELECT jsonb_build_object('s', status, 'r', reject_reason, 'by', decided_by, 'x', delivery_order_id)
     FROM public.carta_delivery_requests WHERE id = (SELECT (r ->> 'requestId')::uuid FROM t430_r3)),
  '{"s": "rejected", "r": "No llegamos a tu barrio", "by": "43100000-0000-0000-0000-000000000004", "x": null}'::jsonb,
  'reject stores the trimmed reason and the cashier');
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT private.guest_delivery_status('t430-a', r ->> 'trackingToken') - 'createdAt' - 'lines' FROM t430_r3),
  '{"status": "rejected", "stage": "rejected", "rejectReason": "No llegamos a tu barrio", "total": null, "deliveryFee": 4000,
    "paymentMethod": "transfer", "orderNumber": null}'::jsonb,
  'the guest sees the rejection and its reason');
SELECT lives_ok($$ SELECT private.guest_submit_delivery('t430-a', pg_temp.cust(), pg_temp.lim(), pg_temp.cash(), NULL) $$,
  'only pending requests count: after the decisions the phone can order again');
RESET ROLE;

-- ============================================
-- 10. Constraints and the shared item helper
-- ============================================
SELECT throws_ok($$ INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items)
  VALUES ('43000000-0000-0000-0000-0000000000a1', (SELECT tracking_token FROM public.carta_delivery_requests LIMIT 1),
          'X', '3000000000', 'Calle 1 # 2', 'cash', '[{"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1}]') $$,
  '23505', NULL, 'tracking tokens are unique');
SELECT throws_ok($$ INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, cash_from, items)
  VALUES ('43000000-0000-0000-0000-0000000000a1', private.new_table_qr_token(), 'X', '3000000000', 'Calle 1 # 2', 'card', 1000,
          '[{"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1}]') $$,
  '23514', NULL, 'cash_from only with cash (CHECK)');
SELECT throws_ok($$ INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items, status, decided_at, delivery_order_id)
  VALUES ('43000000-0000-0000-0000-0000000000a1', private.new_table_qr_token(), 'X', '3000000000', 'Calle 1 # 2', 'cash',
          '[{"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1}]', 'confirmed', now(), '43900000-0000-0000-0000-0000000000b1') $$,
  '23503', NULL, 'the delivery order belongs to the same restaurant (FK)');
SELECT throws_ok($$ INSERT INTO public.carta_delivery_requests (restaurant_id, tracking_token, customer_name, phone, address, payment_method, items)
  VALUES ('43000000-0000-0000-0000-0000000000a1', 'short', 'X', '3000000000', 'Calle 1 # 2', 'cash',
          '[{"dishId": "43300000-0000-0000-0000-000000000003", "quantity": 1}]') $$,
  '23514', NULL, 'a tracking token is 24 base64url characters (CHECK)');
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t430-a', 'AAAAAAAAAAAAAAAAAAAAAAAA', 'guest-key-one_0001', '[]', NULL) $$,
  'P0002', 'guest_submit_proposal: table_not_found', 'the table proposals keep their own behavior');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_delivery_requests WHERE restaurant_id = '43000000-0000-0000-0000-0000000000a1'), 5::bigint,
  'A holds exactly the five accepted requests');

SELECT * FROM finish();
ROLLBACK;
