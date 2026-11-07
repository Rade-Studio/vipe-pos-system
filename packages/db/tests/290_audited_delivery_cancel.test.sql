-- Audited delivery cancellations (odd/tasks/fase3-operacion.md, F3b,
-- migration 0019).
--
-- A delivery is cancelled only through public.cancel_order, the audited path
-- of F1: a reason is always required, order_cancellations and audit_log get
-- their rows, and orders.status and order_deliveries.delivery_status become
-- cancelled in the same transaction. A supervisor authorization is required
-- only when the delivery has a live payment; that payment is then voided under
-- the same authorization (payment_voids, audit_log payment_voided). A payment
-- of a closed drawer refuses the whole cancellation. set_delivery_status no
-- longer cancels. Deliveries cancelled before 0019 stay as they were.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(49);

-- ============================================
-- Fixtures: restaurant A (admin, cashier, second cashier, delivery operator,
-- waiter) and restaurant B (admin); an open and a soon-closed drawer.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('e9000000-0000-0000-0000-0000000000a1', 't290-a', 'T290 A'),
  ('e9000000-0000-0000-0000-0000000000b2', 't290-b', 'T290 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('e9100000-0000-0000-0000-000000000001', 'admin@t290a.test', 'h'),
  ('e9100000-0000-0000-0000-000000000002', 'cashier@t290a.test', 'h'),
  ('e9100000-0000-0000-0000-000000000003', 'cashier2@t290a.test', 'h'),
  ('e9100000-0000-0000-0000-000000000004', 'operator@t290a.test', 'h'),
  ('e9100000-0000-0000-0000-000000000005', 'waiter@t290a.test', 'h'),
  ('e9100000-0000-0000-0000-000000000006', 'admin@t290b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('e9200000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000001', 'Admin A', 'admin@t290a.test', 'admin', true, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9200000-0000-0000-0000-000000000002', 'e9100000-0000-0000-0000-000000000002', 'Cajera A', 'cashier@t290a.test', 'cashier', true, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9200000-0000-0000-0000-000000000003', 'e9100000-0000-0000-0000-000000000003', 'Cajero Dos', 'cashier2@t290a.test', 'cashier', true, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9200000-0000-0000-0000-000000000004', 'e9100000-0000-0000-0000-000000000004', 'Operadora A', 'operator@t290a.test', 'delivery_operator', true, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9200000-0000-0000-0000-000000000005', 'e9100000-0000-0000-0000-000000000005', 'Mesero A', 'waiter@t290a.test', 'waiter', true, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9200000-0000-0000-0000-000000000006', 'e9100000-0000-0000-0000-000000000006', 'Admin B', 'admin@t290b.test', 'admin', true, 'e9000000-0000-0000-0000-0000000000b2');
INSERT INTO public.customers (id, phone, name, restaurant_id) VALUES
  ('e9800000-0000-0000-0000-000000000001', '3101234567', 'Ana', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9800000-0000-0000-0000-000000000002', '3107654321', 'Bea', 'e9000000-0000-0000-0000-0000000000b2');
-- One open drawer per restaurant (0009): the second drawer opens after the first closes.
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('e9400000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');
-- d1 unpaid, d2 paid (open drawer), d3 paid (drawer closed later), d4 on its way,
-- d5 cancelled before 0019 (legacy), d6 restaurant B, d7 set_delivery_status, o8 a table order.
INSERT INTO public.orders (id, table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total, restaurant_id) VALUES
  ('e9500000-0000-0000-0000-000000000001', NULL, NULL, 'kitchen', 'delivery', 13000, 0, 0, 0, 0, 13000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000002', NULL, NULL, 'kitchen', 'delivery', 8000, 0, 0, 0, 0, 8000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000003', NULL, NULL, 'kitchen', 'delivery', 4000, 0, 0, 0, 0, 4000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000004', NULL, NULL, 'kitchen', 'delivery', 5000, 0, 0, 0, 0, 5000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000005', NULL, NULL, 'cancelled', 'delivery', 6000, 0, 0, 0, 0, 6000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000006', NULL, NULL, 'kitchen', 'delivery', 1000, 0, 0, 0, 0, 1000, 'e9000000-0000-0000-0000-0000000000b2'),
  ('e9500000-0000-0000-0000-000000000007', NULL, NULL, 'kitchen', 'delivery', 2000, 0, 0, 0, 0, 2000, 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9500000-0000-0000-0000-000000000008', NULL, NULL, 'kitchen', 'dine_in', 3000, 0, 0, 0, 0, 3000, 'e9000000-0000-0000-0000-0000000000a1');
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line, delivery_fee, payment_mode, delivery_status, cancelled_at) VALUES
  ('e9500000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 4000, 'cash_on_delivery', 'preparing', NULL),
  ('e9500000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 2000, 'prepaid', 'received', NULL),
  ('e9500000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 0, 'prepaid', 'ready', NULL),
  ('e9500000-0000-0000-0000-000000000004', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 0, 'cash_on_delivery', 'out_for_delivery', NULL),
  ('e9500000-0000-0000-0000-000000000005', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 0, 'cash_on_delivery', 'cancelled', now() - interval '1 day'),
  ('e9500000-0000-0000-0000-000000000006', 'e9000000-0000-0000-0000-0000000000b2', 'e9800000-0000-0000-0000-000000000002', 'Bea', '3107654321', 'Calle 9', 0, 'cash_on_delivery', 'received', NULL),
  ('e9500000-0000-0000-0000-000000000007', 'e9000000-0000-0000-0000-0000000000a1', 'e9800000-0000-0000-0000-000000000001', 'Ana', '3101234567', 'Calle 1', 0, 'cash_on_delivery', 'received', NULL);
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES
  ('e9600000-0000-0000-0000-000000000011', 'e9500000-0000-0000-0000-000000000001', NULL, 'Arepa', 5000, 2, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000012', 'e9500000-0000-0000-0000-000000000001', NULL, 'Jugo', 3000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000021', 'e9500000-0000-0000-0000-000000000002', NULL, 'Bandeja', 8000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000031', 'e9500000-0000-0000-0000-000000000003', NULL, 'Tinto', 4000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000041', 'e9500000-0000-0000-0000-000000000004', NULL, 'Arepa', 5000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000071', 'e9500000-0000-0000-0000-000000000007', NULL, 'Agua', 2000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1'),
  ('e9600000-0000-0000-0000-000000000081', 'e9500000-0000-0000-0000-000000000008', NULL, 'Pan', 3000, 1, 'kitchen', 'e9000000-0000-0000-0000-0000000000a1');

-- Consumed authorizations, as the API leaves them, each bound to an order and its requester.
CREATE TEMP TABLE t290_auth (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t290_auth TO vipe_api;
WITH rows (name, id, action, supervisor, requester, target) AS (VALUES
  ('paid', 'e9700000-0000-0000-0000-000000000001'::uuid, 'cancel_order', 'e9200000-0000-0000-0000-000000000002'::uuid, 'e9200000-0000-0000-0000-000000000004'::uuid, 'e9500000-0000-0000-0000-000000000002'::uuid),
  ('closed', 'e9700000-0000-0000-0000-000000000002', 'cancel_order', 'e9200000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000004', 'e9500000-0000-0000-0000-000000000003'),
  ('other_order', 'e9700000-0000-0000-0000-000000000003', 'cancel_order', 'e9200000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000004', 'e9500000-0000-0000-0000-000000000007'),
  ('self', 'e9700000-0000-0000-0000-000000000004', 'cancel_order', 'e9200000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001', 'e9500000-0000-0000-0000-000000000003')
), ins AS (
  INSERT INTO public.supervisor_authorizations
    (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
  SELECT id, 'e9000000-0000-0000-0000-0000000000a1', action, supervisor, requester, 'order', target, now() - interval '10 seconds', now() + interval '110 seconds', now() FROM rows
  RETURNING id
)
INSERT INTO t290_auth SELECT name, id FROM rows;

-- The operator pays d3 (pay_order) on the first drawer, which then closes;
-- d2 is paid on the second, open drawer (amount = bill + delivery fee).
CREATE TEMP TABLE t290_pay (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t290_pay TO vipe_api;
CREATE FUNCTION pg_temp.t290_pay(p_name text, p_order uuid, p_register uuid, p_amount bigint) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t290_pay
  SELECT p_name, (public.pay_order(p_order, p_register, 0,
           jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'),
                                                'amount', p_amount, 'cash_received', p_amount)), gen_random_uuid())->>'payment_id')::uuid
$$;
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000004', true);
SELECT pg_temp.t290_pay('p3', 'e9500000-0000-0000-0000-000000000003', 'e9400000-0000-0000-0000-000000000002', 4000);
RESET ROLE;
UPDATE public.cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = 'e9400000-0000-0000-0000-000000000002';
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('e9400000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000004', true);
SELECT pg_temp.t290_pay('p2', 'e9500000-0000-0000-0000-000000000002', 'e9400000-0000-0000-0000-000000000001', 10000);
RESET ROLE;

-- ============================================
-- 1. Schema: one audited path
-- ============================================
SELECT ok(
  (SELECT p.prosecdef AND 'search_path=""' = ANY(p.proconfig) AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
     FROM pg_proc p WHERE p.oid = 'public.cancel_order(uuid, text, text, uuid)'::regprocedure),
  'cancel_order stays SECURITY DEFINER with an empty search_path, executable by vipe_api');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_cancellations_previous_status_check'
             AND pg_get_constraintdef(oid) LIKE '%paid%'),
  'a cancellation may record a paid delivery as its previous status');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'audit_log_authorization_id_key')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'audit_log_authorization_target_key' AND indexdef LIKE '%UNIQUE%'),
  'an authorization backs one event per target (the order, each voided payment)');
SELECT is(
  (SELECT row(delivery_status, (SELECT count(*) FROM public.order_cancellations c WHERE c.order_id = od.order_id))::text
     FROM public.order_deliveries od WHERE od.order_id = 'e9500000-0000-0000-0000-000000000005'),
  '(cancelled,0)', 'a delivery cancelled before 0019 keeps its row and gets no invented cancellation');

-- ============================================
-- 2. An unpaid delivery: reason required, no supervisor, audited
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000001', NULL) $$,
  '22023', 'cancel_order: reason_invalid', 'a delivery is not cancelled without a reason');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000001', 'other', ' no ') $$,
  '22023', 'cancel_order: reason_text_required', '"Otro" needs 3..200 characters');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000001', 'other', repeat('x', 201)) $$,
  '22023', 'cancel_order: reason_text_required', 'a text over 200 characters is refused');
SELECT is((SELECT row(o.status, od.delivery_status)::text FROM public.orders o JOIN public.order_deliveries od ON od.order_id = o.id
            WHERE o.id = 'e9500000-0000-0000-0000-000000000001'), '(kitchen,preparing)', 'a refused cancellation changes nothing');
SELECT lives_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000001', 'other', '  El cliente   no contesta ') $$,
  'the operator cancels an unpaid delivery with a reason and no supervisor');
SELECT is((SELECT row(o.status, od.delivery_status, od.cancelled_at IS NOT NULL)::text FROM public.orders o
             JOIN public.order_deliveries od ON od.order_id = o.id WHERE o.id = 'e9500000-0000-0000-0000-000000000001'),
  '(cancelled,cancelled,t)', 'the order and the delivery are cancelled together');
SELECT is((SELECT row(previous_status, reason_code, reason_text, cancelled_by, cancelled_by_name, authorized_by_name, total, jsonb_array_length(items))::text
             FROM public.order_cancellations WHERE order_id = 'e9500000-0000-0000-0000-000000000001'),
  '(kitchen,other,"El cliente no contesta",e9200000-0000-0000-0000-000000000004,"Operadora A",,17000.00,2)',
  'order_cancellations keeps the reason, the actor and the bill with the delivery fee');
SELECT is((SELECT row(event_type, actor_name, reason_text, amount, authorization_id IS NULL, details->>'order_type',
                      details->>'delivery_fee', details->>'customer_name', details->>'delivery_status')::text
             FROM public.audit_log WHERE order_id = 'e9500000-0000-0000-0000-000000000001'),
  '(order_cancelled,"Operadora A","El cliente no contesta",17000.00,t,delivery,4000,Ana,preparing)',
  'the audit log records the delivery cancellation; its amount includes the delivery fee');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000001', 'customer_left') $$,
  'P0001', 'cancel_order: order_cancelled', 'a cancelled delivery is not cancelled twice');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000005', 'customer_left') $$,
  'P0001', 'cancel_order: order_cancelled', 'a legacy cancelled delivery is not cancelled again');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE order_id = 'e9500000-0000-0000-0000-000000000005'), 0,
  'and no audit row is invented for it');

-- ============================================
-- 3. Who may cancel what; delivery state
-- ============================================
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000008', 'customer_left') $$,
  '42501', 'cancel_order: role delivery_operator may not call this function', 'the operator does not cancel table orders');
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000005', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000007', 'customer_left') $$,
  'P0001', 'cancel_order: delivery_order', 'a waiter does not cancel deliveries');
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000007', 'customer_left') $$,
  'P0001', 'cancel_order: delivery_order', 'nor does a cashier');
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000004', 'customer_left') $$,
  'P0001', 'cancel_order: delivery_not_cancellable', 'a delivery on its way is not cancelled');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000006', 'customer_left') $$,
  'P0002', 'cancel_order: order_not_found', 'another restaurant''s delivery is not found');
SELECT is((SELECT count(*)::int FROM public.order_deliveries WHERE order_id = 'e9500000-0000-0000-0000-000000000006'), 0,
  'nor visible');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000007', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'paid')) $$,
  '42501', 'cancel_order: authorization_invalid', 'an authorization for another order is refused even when none is needed');

-- ============================================
-- 4. set_delivery_status no longer cancels; the other transitions stay
-- ============================================
SELECT throws_ok($$ SELECT public.set_delivery_status('e9500000-0000-0000-0000-000000000007', 'cancel') $$,
  'P0001', 'set_delivery_status: cancel goes through cancel_order (a reason is required)', 'the unaudited cancel is gone');
SELECT is((SELECT row(o.status, od.delivery_status)::text FROM public.orders o JOIN public.order_deliveries od ON od.order_id = o.id
            WHERE o.id = 'e9500000-0000-0000-0000-000000000007'), '(kitchen,received)', 'and it changed nothing');
SELECT is(public.set_delivery_status('e9500000-0000-0000-0000-000000000007', 'start_preparing')->>'delivery_status', 'preparing',
  'start_preparing still works');
SELECT is(public.set_delivery_status('e9500000-0000-0000-0000-000000000007', 'mark_ready')->>'delivery_status', 'ready',
  'mark_ready still works');
SELECT throws_ok($$ SELECT public.set_delivery_status('e9500000-0000-0000-0000-000000000007', 'cancel', NULL, NULL, now() + interval '10 minutes', NULL) $$,
  '22023', 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch', 'the input checks still answer first');

-- ============================================
-- 5. A paid delivery: one supervisor PIN cancels it and voids its payment
-- ============================================
SELECT is((SELECT row(o.status, count(p.id))::text FROM public.orders o LEFT JOIN public.payments p ON p.order_id = o.id
            WHERE o.id = 'e9500000-0000-0000-0000-000000000002' GROUP BY o.status), '(paid,1)', 'd2 is paid with a live payment');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000002', 'customer_left') $$,
  '42501', 'cancel_order: authorization_required', 'a paid delivery needs a supervisor authorization');
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000002', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'other_order')) $$,
  '42501', 'cancel_order: authorization_invalid', 'the authorization must be for this order');
SELECT is((SELECT row(o.status, od.delivery_status, (SELECT count(*) FROM public.payments p WHERE p.order_id = o.id))::text
             FROM public.orders o JOIN public.order_deliveries od ON od.order_id = o.id WHERE o.id = 'e9500000-0000-0000-0000-000000000002'),
  '(paid,received,1)', 'the refusals changed nothing');
SELECT is((public.cancel_order('e9500000-0000-0000-0000-000000000002', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'paid'))
             - 'audit_id' - 'order_id')::text,
  '{"total": 10000.00, "authorized_by": "e9200000-0000-0000-0000-000000000002", "payments_voided": 1, "self_authorized": false}',
  'the operator cancels the paid delivery with the cashier''s authorization');
SELECT is((SELECT row(o.status, od.delivery_status)::text FROM public.orders o JOIN public.order_deliveries od ON od.order_id = o.id
            WHERE o.id = 'e9500000-0000-0000-0000-000000000002'), '(cancelled,cancelled)', 'order and delivery are cancelled');
SELECT is((SELECT count(*)::int FROM public.payments WHERE order_id = 'e9500000-0000-0000-0000-000000000002'), 0,
  'the payment is voided: vipe_api no longer sees it');
SELECT is((SELECT row(previous_status, cancelled_by_name, authorized_by_name, self_authorized, total)::text
             FROM public.order_cancellations WHERE order_id = 'e9500000-0000-0000-0000-000000000002'),
  '(paid,"Operadora A","Cajera A",f,10000.00)', 'the cancellation records the paid status and the supervisor');
SELECT is((SELECT row(total_charged, methods, reason_code, voided_by_name, authorized_by_name, authorization_id)::text
             FROM public.payment_voids WHERE payment_id = (SELECT id FROM t290_pay WHERE name = 'p2')),
  '(10000,cash,customer_left,"Operadora A","Cajera A",e9700000-0000-0000-0000-000000000001)',
  'payment_voids keeps the amounts, the same reason and the same authorization');
SELECT is((SELECT string_agg(row(event_type, amount, authorization_id)::text, ' ' ORDER BY event_type)
             FROM public.audit_log WHERE order_id = 'e9500000-0000-0000-0000-000000000002'),
  '(order_cancelled,10000.00,e9700000-0000-0000-0000-000000000001) (payment_voided,10000.00,e9700000-0000-0000-0000-000000000001)',
  'two audit events under one authorization: the cancellation and the payment void');
SELECT is((SELECT (v.details->>'cancellation_audit_id')::uuid = c.id
             FROM public.audit_log v JOIN public.audit_log c ON c.order_id = v.order_id AND c.event_type = 'order_cancelled'
            WHERE v.order_id = 'e9500000-0000-0000-0000-000000000002' AND v.event_type = 'payment_voided'), true,
  'the payment void points at its cancellation');
SELECT is((SELECT (details->'payments_voided'->0->>'total_charged')::int FROM public.audit_log
            WHERE order_id = 'e9500000-0000-0000-0000-000000000002' AND event_type = 'order_cancelled'), 10000,
  'the cancellation lists the voided payment');
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000002', true);
SELECT is((public.register_summary(ARRAY['e9400000-0000-0000-0000-000000000001'::uuid])->>'payments_count')::int, 0,
  'register_summary no longer counts the voided payment');
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000004', true);

-- ============================================
-- 6. A payment of a closed drawer refuses the whole cancellation
-- ============================================
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000003', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'closed')) $$,
  'P0001', 'cancel_order: register_closed', 'a paid delivery of a closed drawer is not cancelled');
SELECT is((SELECT row(o.status, od.delivery_status, (SELECT count(*) FROM public.payments p WHERE p.order_id = o.id),
                      (SELECT count(*) FROM public.audit_log a WHERE a.order_id = o.id))::text
             FROM public.orders o JOIN public.order_deliveries od ON od.order_id = o.id WHERE o.id = 'e9500000-0000-0000-0000-000000000003'),
  '(paid,ready,1,0)', 'nothing changed: payment live, no audit row');

-- ============================================
-- 7. Self-authorization (admin) follows the restaurant setting
-- ============================================
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000003', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'self')) $$,
  'P0001', 'cancel_order: register_closed', 'the drawer check comes before the authorizer');
RESET ROLE;
UPDATE public.cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = 'e9400000-0000-0000-0000-000000000001';
UPDATE public.cash_registers SET status = 'open', closing_timestamp = NULL WHERE id = 'e9400000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000003', 'customer_left', NULL, (SELECT id FROM t290_auth WHERE name = 'self')) $$,
  '42501', 'cancel_order: self_authorization_not_allowed', 'the admin may not authorize their own cancellation by default');
RESET ROLE;
INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('e9000000-0000-0000-0000-0000000000a1', 'allow_self_authorization', 'true');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$ SELECT public.cancel_order('e9500000-0000-0000-0000-000000000003', 'duplicate_charge', NULL, (SELECT id FROM t290_auth WHERE name = 'self')) $$,
  'with allow_self_authorization the admin cancels it');
SELECT is((SELECT string_agg(row(event_type, self_authorized)::text, ' ' ORDER BY event_type) FROM public.audit_log
            WHERE order_id = 'e9500000-0000-0000-0000-000000000003'),
  '(order_cancelled,t) (payment_voided,t)', 'both events are flagged self-authorized');

-- ============================================
-- 8. Tenancy of the records
-- ============================================
SELECT set_config('app.user_id', 'e9100000-0000-0000-0000-000000000006', true);
SELECT is((SELECT count(*)::int FROM public.order_cancellations WHERE restaurant_id = 'e9000000-0000-0000-0000-0000000000a1')
          + (SELECT count(*)::int FROM public.audit_log WHERE restaurant_id = 'e9000000-0000-0000-0000-0000000000a1')
          + (SELECT count(*)::int FROM public.payment_voids WHERE restaurant_id = 'e9000000-0000-0000-0000-0000000000a1'), 0,
  'restaurant B reads none of A''s cancellations');
SELECT throws_ok($$ INSERT INTO public.order_cancellations (restaurant_id, order_id, audit_id, previous_status, reason_code, cancelled_by_name, subtotal, tax, tip, total, items, sent_items)
                    VALUES ('e9000000-0000-0000-0000-0000000000b2', 'e9500000-0000-0000-0000-000000000006', gen_random_uuid(), 'active', 'customer_left', 'x', 0, 0, 0, 0, '[]', 0) $$,
  '42501', NULL, 'vipe_api cannot write a cancellation itself');
RESET ROLE;

-- ============================================
-- 9. One authorization never backs events of two orders (defence in depth)
-- ============================================
SELECT throws_ok($$ INSERT INTO public.audit_log (restaurant_id, event_type, order_id, actor_name, authorized_by_name, authorization_id, reason_code, amount)
                    VALUES ('e9000000-0000-0000-0000-0000000000a1', 'order_cancelled', 'e9500000-0000-0000-0000-000000000007', 'x', 'Cajera A',
                            (SELECT id FROM t290_auth WHERE name = 'paid'), 'customer_left', 0) $$,
  '23P01', NULL, 'even a writer that passes every guard cannot reuse an authorization on another order');

SELECT * FROM finish();
ROLLBACK;
