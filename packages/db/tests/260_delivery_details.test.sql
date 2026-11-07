-- Delivery details for the dispatch console (odd/tasks/rediseno-pos.md, T19,
-- S3, S8).
--
-- create_delivery_order takes an optional prepaid payment method (only on a
-- prepaid order, an active method of the caller's restaurant);
-- set_delivery_status takes an optional courier ETA (after now, within 6 h)
-- and location (1..60 characters) on dispatch; return_courier records the
-- courier back (delivered or failed deliveries, once). The old call shapes
-- keep working. The delivery operator may create couriers and switch their
-- active flag, but not rename them or change their phone.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(67);

-- ============================================
-- 1. Signatures, grants, policies
-- ============================================
SELECT has_function('public', 'create_delivery_order',
  ARRAY['jsonb', 'jsonb', 'jsonb', 'bigint', 'text', 'bigint', 'text', 'uuid'],
  'create_delivery_order takes p_prepaid_method_id');
SELECT hasnt_function('public', 'create_delivery_order',
  ARRAY['jsonb', 'jsonb', 'jsonb', 'bigint', 'text', 'bigint', 'text'],
  'the 7-argument create_delivery_order is gone (no ambiguous overload)');
SELECT has_function('public', 'set_delivery_status',
  ARRAY['uuid', 'text', 'uuid', 'text', 'timestamp with time zone', 'text'],
  'set_delivery_status takes p_courier_eta and p_courier_location');
SELECT hasnt_function('public', 'set_delivery_status', ARRAY['uuid', 'text', 'uuid', 'text'],
  'the 4-argument set_delivery_status is gone (no ambiguous overload)');
SELECT has_function('public', 'return_courier', ARRAY['uuid'], 'return_courier exists');
SELECT ok(has_function_privilege('vipe_api', 'public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text,uuid)', 'EXECUTE')
      AND has_function_privilege('vipe_api', 'public.set_delivery_status(uuid,text,uuid,text,timestamptz,text)', 'EXECUTE')
      AND has_function_privilege('vipe_api', 'public.return_courier(uuid)', 'EXECUTE'),
  'vipe_api may execute the three delivery RPCs');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid IN ('public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text,uuid)'::regprocedure,
                     'public.set_delivery_status(uuid,text,uuid,text,timestamptz,text)'::regprocedure,
                     'public.return_courier(uuid)'::regprocedure)
       AND a.grantee = 0),
  'PUBLIC may not execute the three delivery RPCs');
SELECT ok((SELECT bool_and(prosecdef) FROM pg_proc
            WHERE oid IN ('public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text,uuid)'::regprocedure,
                          'public.set_delivery_status(uuid,text,uuid,text,timestamptz,text)'::regprocedure,
                          'public.return_courier(uuid)'::regprocedure)),
  'the three delivery RPCs are SECURITY DEFINER');
SELECT policies_are('public', 'couriers', ARRAY['couriers_insert_policy', 'couriers_select_policy', 'couriers_update_policy'],
  'couriers keeps three policies (no DELETE)');
SELECT trigger_is('public', 'couriers', 'couriers_operator_guard', 'private', 'guard_courier_operator_update',
  'couriers limits what a delivery operator may change');

-- ============================================
-- Fixtures: restaurants A and B (default payment methods from the restaurant
-- trigger), staff, a dish and couriers.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('26000000-0000-0000-0000-0000000000a1', 't260-a', 'T260 A'),
  ('26000000-0000-0000-0000-0000000000b2', 't260-b', 'T260 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('26000000-0000-0000-0000-000000000001', 'operator@t260a.test', 'h'),
  ('26000000-0000-0000-0000-000000000002', 'admin@t260a.test', 'h'),
  ('26000000-0000-0000-0000-000000000003', 'waiter@t260a.test', 'h'),
  ('26000000-0000-0000-0000-000000000004', 'kitchen@t260a.test', 'h'),
  ('26000000-0000-0000-0000-000000000005', 'cashier@t260a.test', 'h'),
  ('26000000-0000-0000-0000-000000000006', 'operator@t260b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('26100000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Operador A', 'operator@t260a.test', 'delivery_operator', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26100000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', 'Admin A', 'admin@t260a.test', 'admin', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26100000-0000-0000-0000-000000000003', '26000000-0000-0000-0000-000000000003', 'Mesero A', 'waiter@t260a.test', 'waiter', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26100000-0000-0000-0000-000000000004', '26000000-0000-0000-0000-000000000004', 'Cocina A', 'kitchen@t260a.test', 'kitchen', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26100000-0000-0000-0000-000000000005', '26000000-0000-0000-0000-000000000005', 'Caja A', 'cashier@t260a.test', 'cashier', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26100000-0000-0000-0000-000000000006', '26000000-0000-0000-0000-000000000006', 'Operador B', 'operator@t260b.test', 'delivery_operator', true, '26000000-0000-0000-0000-0000000000b2');
INSERT INTO public.dishes (id, name, price, active, restaurant_id) VALUES
  ('26200000-0000-0000-0000-0000000000a1', 'Arepa', 5000, true, '26000000-0000-0000-0000-0000000000a1');
INSERT INTO public.couriers (id, name, phone, is_active, restaurant_id) VALUES
  ('26300000-0000-0000-0000-0000000000a1', 'Pedro', '3001112233', true, '26000000-0000-0000-0000-0000000000a1'),
  ('26300000-0000-0000-0000-0000000000b1', 'Courier B', NULL, true, '26000000-0000-0000-0000-0000000000b2');
UPDATE public.payment_methods SET is_active = false
 WHERE restaurant_id = '26000000-0000-0000-0000-0000000000a1' AND code = 'bancolombia';

SELECT set_config('t260.nequi_a', (SELECT id::text FROM public.payment_methods
  WHERE restaurant_id = '26000000-0000-0000-0000-0000000000a1' AND code = 'nequi'), true);
SELECT set_config('t260.inactive_a', (SELECT id::text FROM public.payment_methods
  WHERE restaurant_id = '26000000-0000-0000-0000-0000000000a1' AND code = 'bancolombia'), true);
SELECT set_config('t260.nequi_b', (SELECT id::text FROM public.payment_methods
  WHERE restaurant_id = '26000000-0000-0000-0000-0000000000b2' AND code = 'nequi'), true);

-- ============================================
-- 2. create_delivery_order: prepaid method
-- ============================================
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;

-- The old 7-argument positional call still works and records no method.
SELECT set_config('t260.old', public.create_delivery_order(
  '{"phone": "3101234567", "name": "Ana"}', '{"address_line": "Calle 1"}',
  '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]',
  3000::bigint, 'cash_on_delivery', 20000::bigint, NULL) ->> 'order_id', true);
SELECT set_config('t260.prepaid', public.create_delivery_order(
  p_customer => '{"phone": "3101234567"}', p_address => '{"address_line": "Calle 1"}',
  p_items => '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 2}]',
  p_delivery_fee => 4500::bigint, p_payment_mode => 'prepaid',
  p_prepaid_method_id => current_setting('t260.nequi_a')::uuid) ->> 'order_id', true);
SELECT set_config('t260.prepaid_no_method', public.create_delivery_order(
  '{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
  '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]',
  0::bigint, 'prepaid') ->> 'order_id', true);

SELECT is(
  (public.create_delivery_order(
    '{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
    '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]',
    0::bigint, 'prepaid', NULL, NULL, current_setting('t260.nequi_a')::uuid) -> 'delivery' ->> 'prepaid_method_id'),
  current_setting('t260.nequi_a'),
  'the returned delivery row carries prepaid_method_id');
SELECT throws_ok(
  format($$ SELECT public.create_delivery_order('{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
    '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]', 0::bigint, 'cash_on_delivery', NULL, NULL, %L::uuid) $$,
    current_setting('t260.nequi_a')),
  '22023', 'create_delivery_order: p_prepaid_method_id is only allowed when p_payment_mode = ''prepaid''',
  'a prepaid method on a cash-on-delivery order is refused');
SELECT throws_ok(
  format($$ SELECT public.create_delivery_order('{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
    '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]', 0::bigint, 'prepaid', NULL, NULL, %L::uuid) $$,
    current_setting('t260.nequi_b')),
  'P0002', format('create_delivery_order: payment method %s not found', current_setting('t260.nequi_b')),
  'a payment method of another restaurant is not found');
SELECT throws_ok(
  $$ SELECT public.create_delivery_order('{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
    '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]', 0::bigint, 'prepaid', NULL, NULL,
    '26999999-0000-0000-0000-000000000000'::uuid) $$,
  'P0002', 'create_delivery_order: payment method 26999999-0000-0000-0000-000000000000 not found',
  'an unknown payment method is not found');
SELECT throws_ok(
  format($$ SELECT public.create_delivery_order('{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
    '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]', 0::bigint, 'prepaid', NULL, NULL, %L::uuid) $$,
    current_setting('t260.inactive_a')),
  '22023', format('create_delivery_order: payment method %s is not active', current_setting('t260.inactive_a')),
  'an inactive payment method is refused');
RESET ROLE;

SELECT is(
  (SELECT row(payment_mode, prepaid_method_id, delivery_fee, cash_change_for)::text FROM public.order_deliveries
    WHERE order_id = current_setting('t260.old')::uuid),
  '(cash_on_delivery,,3000,20000)',
  'the old call shape stores the order as before, without a method');
SELECT is(
  (SELECT row(payment_mode, prepaid_method_id::text, delivery_fee)::text FROM public.order_deliveries
    WHERE order_id = current_setting('t260.prepaid')::uuid),
  format('(prepaid,%s,4500)', current_setting('t260.nequi_a')),
  'a prepaid order records its payment method and the per-order fee');
SELECT is(
  (SELECT prepaid_method_id FROM public.order_deliveries WHERE order_id = current_setting('t260.prepaid_no_method')::uuid),
  NULL,
  'a prepaid order without a method stores NULL (not captured)');
SELECT is((SELECT count(*) FROM public.order_deliveries WHERE restaurant_id = '26000000-0000-0000-0000-0000000000a1'), 4::bigint,
  'only the four accepted calls wrote a delivery (refused calls wrote nothing)');

-- ============================================
-- 3. set_delivery_status: courier ETA and location on dispatch
-- ============================================
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.old')::uuid, 'mark_ready') $$, 'mark_ready, 2-argument call');
SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'mark_ready', NULL, NULL) $$,
  'mark_ready, old 4-argument call');
SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.prepaid_no_method')::uuid, 'mark_ready') $$, 'mark_ready, third order');

-- The old 4-argument dispatch records neither ETA nor location.
SELECT is(
  (SELECT row(r ->> 'delivery_status', r ->> 'courier_eta', r ->> 'courier_location')::text
     FROM public.set_delivery_status(current_setting('t260.old')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL) r),
  '(out_for_delivery,,)',
  'the old dispatch call shape stores no ETA and no location');

SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL, now(), NULL) $$,
  '22023', 'set_delivery_status: p_courier_eta must be after now and within 6 hours',
  'an ETA of now is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL, now() - interval '1 minute', NULL) $$,
  '22023', 'set_delivery_status: p_courier_eta must be after now and within 6 hours',
  'an ETA in the past is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL, now() + interval '6 hours 1 second', NULL) $$,
  '22023', 'set_delivery_status: p_courier_eta must be after now and within 6 hours',
  'an ETA beyond 6 hours is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL, NULL, '   ') $$,
  '22023', 'set_delivery_status: p_courier_location must be 1..60 characters',
  'a blank location is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL, NULL, repeat('x', 61)) $$,
  '22023', 'set_delivery_status: p_courier_location must be 1..60 characters',
  'a location over 60 characters is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'cancel', NULL, NULL, now() + interval '10 minutes', NULL) $$,
  '22023', 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch',
  'an ETA on another action is refused');
SELECT throws_ok(
  $$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'cancel', NULL, NULL, NULL, 'Laureles') $$,
  '22023', 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch',
  'a location on another action is refused');
RESET ROLE;
SELECT is(
  (SELECT row(delivery_status, courier_id, courier_eta, courier_location)::text FROM public.order_deliveries
    WHERE order_id = current_setting('t260.prepaid')::uuid),
  '(ready,,,)',
  'the refused calls changed nothing');

SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT row(r ->> 'delivery_status', (r ->> 'courier_eta')::timestamptz = now() + interval '6 hours', r ->> 'courier_location')::text
     FROM public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL,
                                     now() + interval '6 hours', '  Laureles  ') r),
  '(out_for_delivery,t,Laureles)',
  'dispatch stores an ETA of exactly 6 hours and the trimmed location');
SELECT is(
  (SELECT row((r ->> 'courier_eta')::timestamptz = now() + interval '25 minutes', r ->> 'courier_location')::text
     FROM public.set_delivery_status(p_order_id => current_setting('t260.prepaid_no_method')::uuid, p_action => 'dispatch',
                                     p_courier_id => '26300000-0000-0000-0000-0000000000a1',
                                     p_courier_eta => now() + interval '25 minutes') r),
  '(t,)',
  'an ETA alone (named arguments) is accepted');
RESET ROLE;

-- ============================================
-- 4. return_courier
-- ============================================
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.old')::uuid) $$,
  'P0001', format('return_courier: delivery for order %s is in state ''out_for_delivery'' (allowed: delivered, failed)', current_setting('t260.old')),
  'a courier still on the way cannot return');
SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.old')::uuid, 'deliver') $$, 'deliver the first order');
SELECT is(
  (SELECT row(r ->> 'delivery_status', (r ->> 'returned_at')::timestamptz = now())::text
     FROM public.return_courier(current_setting('t260.old')::uuid) r),
  '(delivered,t)',
  'return_courier stamps returned_at on a delivered order and returns the row');
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.old')::uuid) $$,
  'P0001', format('return_courier: the courier of order %s already returned', current_setting('t260.old')),
  'a second return is refused');

SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'fail', NULL, 'No contesta') $$, 'fail the second order');
SELECT is(
  (SELECT (r ->> 'delivery_status') FROM public.return_courier(current_setting('t260.prepaid')::uuid) r),
  'failed',
  'a courier returns from a failed delivery');
SELECT is(
  (SELECT row(r ->> 'delivery_status', r ->> 'returned_at', (r ->> 'courier_eta')::timestamptz = now() + interval '40 minutes', r ->> 'courier_location')::text
     FROM public.set_delivery_status(current_setting('t260.prepaid')::uuid, 'dispatch', '26300000-0000-0000-0000-0000000000a1', NULL,
                                     now() + interval '40 minutes', NULL) r),
  '(out_for_delivery,,t,)',
  're-dispatch clears returned_at and replaces the ETA and location');

SELECT throws_ok(
  $$ SELECT public.return_courier('26999999-0000-0000-0000-000000000000') $$,
  'P0002', 'return_courier: delivery for order 26999999-0000-0000-0000-000000000000 not found',
  'an unknown order is not found');

SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000006', true);
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.prepaid_no_method')::uuid) $$,
  'P0002', format('return_courier: delivery for order %s not found', current_setting('t260.prepaid_no_method')),
  'another restaurant cannot see the delivery');
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000004', true);
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.prepaid_no_method')::uuid) $$,
  '42501', 'return_courier: only admin or delivery_operator may record a courier return',
  'the kitchen may not record a return');
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.prepaid_no_method')::uuid) $$,
  '42501', 'return_courier: only admin or delivery_operator may record a courier return',
  'a waiter may not record a return');
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000002', true);
SELECT lives_ok($$ SELECT public.set_delivery_status(current_setting('t260.prepaid_no_method')::uuid, 'deliver') $$, 'admin delivers');
SELECT lives_ok($$ SELECT public.return_courier(current_setting('t260.prepaid_no_method')::uuid) $$, 'an admin may record a return');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.order_deliveries WHERE returned_at IS NOT NULL AND restaurant_id = '26000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'two deliveries carry a return (the re-dispatched one was cleared)');

-- A cancelled delivery has no courier to return.
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT set_config('t260.cancelled', public.create_delivery_order(
  '{"phone": "3101234567"}', '{"address_line": "Calle 1"}',
  '[{"dish_id": "26200000-0000-0000-0000-0000000000a1", "quantity": 1}]', 0::bigint, 'cash_on_delivery') ->> 'order_id', true);
SELECT lives_ok($$ SELECT public.cancel_order(current_setting('t260.cancelled')::uuid, 'customer_left') $$, 'cancel a fresh order (audited cancel_order, 0019)');
SELECT throws_ok(
  $$ SELECT public.return_courier(current_setting('t260.cancelled')::uuid) $$,
  'P0001', format('return_courier: delivery for order %s is in state ''cancelled'' (allowed: delivered, failed)', current_setting('t260.cancelled')),
  'a cancelled delivery cannot record a return');
RESET ROLE;

-- ============================================
-- 5. Couriers: the delivery operator creates and switches them on and off
-- ============================================
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok(
  $$ INSERT INTO public.couriers (id, name, phone) VALUES ('26300000-0000-0000-0000-0000000000a2', 'Rosa', '3150001122') $$,
  'the operator creates a courier');
SELECT lives_ok(
  $$ UPDATE public.couriers SET is_active = false WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  'the operator deactivates a courier');
SELECT lives_ok(
  $$ UPDATE public.couriers SET is_active = true, name = name, phone = phone WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  'the operator activates a courier (other columns written unchanged are fine)');
SELECT throws_ok(
  $$ UPDATE public.couriers SET name = 'Rosa María' WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  '42501', 'couriers: a delivery operator may only change is_active',
  'the operator may not rename a courier');
SELECT throws_ok(
  $$ UPDATE public.couriers SET phone = NULL WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  '42501', 'couriers: a delivery operator may only change is_active',
  'the operator may not change a courier phone');
SELECT lives_ok(
  $$ DELETE FROM public.couriers WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  'an operator DELETE runs but matches no row (no DELETE policy; checked below)');
SELECT lives_ok(
  $$ UPDATE public.couriers SET is_active = false WHERE id = '26300000-0000-0000-0000-0000000000b1' $$,
  'an operator UPDATE of another restaurant''s courier matches no row (checked below)');
SELECT throws_ok(
  $$ INSERT INTO public.couriers (name, restaurant_id) VALUES ('Intruso', '26000000-0000-0000-0000-0000000000b2') $$,
  '42501', NULL,
  'the operator cannot create a courier in another restaurant');

SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$ INSERT INTO public.couriers (name) VALUES ('Mesero') $$, '42501', NULL, 'a waiter may not create a courier');
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000005', true);
SELECT throws_ok($$ INSERT INTO public.couriers (name) VALUES ('Caja') $$, '42501', NULL, 'a cashier may not create a courier');
SELECT lives_ok(
  $$ UPDATE public.couriers SET is_active = false WHERE id = '26300000-0000-0000-0000-0000000000a1' $$,
  'a cashier UPDATE matches no row (checked below)');
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000002', true);
SELECT lives_ok(
  $$ UPDATE public.couriers SET name = 'Rosa María', phone = NULL WHERE id = '26300000-0000-0000-0000-0000000000a2' $$,
  'an admin still renames a courier and clears the phone');
RESET ROLE;

SELECT is(
  (SELECT row(name, phone, is_active, restaurant_id)::text FROM public.couriers WHERE id = '26300000-0000-0000-0000-0000000000a2'),
  '("Rosa María",,t,26000000-0000-0000-0000-0000000000a1)',
  'the courier the operator created belongs to restaurant A and only the admin renamed it');
SELECT is(
  (SELECT bool_and(is_active) FROM public.couriers WHERE id IN ('26300000-0000-0000-0000-0000000000a1', '26300000-0000-0000-0000-0000000000b1')),
  true,
  'the cashier and the other restaurant''s operator switch left Pedro and Courier B active');
SELECT is((SELECT count(*) FROM public.couriers WHERE restaurant_id IN ('26000000-0000-0000-0000-0000000000a1', '26000000-0000-0000-0000-0000000000b2')),
  3::bigint, 'refused inserts wrote no courier and the operator DELETE removed none');

-- Verifier regressions (T19): an operator may only switch is_active, whatever the statement shape.
SELECT set_config('app.user_id', '26000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ INSERT INTO public.couriers (id, name) VALUES ('26300000-0000-0000-0000-0000000000a1', 'Hack')
  ON CONFLICT (id) DO UPDATE SET name = excluded.name $$, '42501',
  'couriers: a delivery operator may only change is_active', 'an operator upsert cannot rename a courier');
SELECT throws_ok($$ UPDATE public.couriers SET phone = NULL WHERE id = '26300000-0000-0000-0000-0000000000a1' $$, '42501',
  'couriers: a delivery operator may only change is_active', 'an operator cannot clear a courier phone');
SELECT throws_ok($$ UPDATE public.couriers SET is_active = false, name = 'pedro' WHERE id = '26300000-0000-0000-0000-0000000000a1' $$, '42501',
  'couriers: a delivery operator may only change is_active', 'is_active with a case-only rename is refused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
