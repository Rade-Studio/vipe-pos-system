-- Audited cancellations and voids (odd/tasks/fase3-operacion.md, F1,
-- migration 0018).
--
-- Nothing is deleted: cancel_order, void_order_items and void_payment store
-- events with reason, actor and supervisor; vipe_api cannot delete orders or
-- items, cannot move an order into or out of paid/cancelled, cannot change a
-- line's quantity or price and cannot write the four event tables; a voided
-- payment is invisible to vipe_api and counts in no total. The API consumes
-- the authorization first (0017); the fixtures stand in for that with rows
-- whose consumed_at is set.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(94);

-- ============================================
-- 1. Schema, RLS, grants
-- ============================================
SELECT has_table('public', 'audit_log', 'public.audit_log exists');
SELECT has_table('public', 'order_cancellations', 'public.order_cancellations exists');
SELECT has_table('public', 'order_item_voids', 'public.order_item_voids exists');
SELECT has_table('public', 'payment_voids', 'public.payment_voids exists');
SELECT is(
  (SELECT count(*)::int FROM pg_class WHERE oid = ANY(ARRAY['public.audit_log', 'public.order_cancellations', 'public.order_item_voids', 'public.payment_voids']::regclass[]) AND relrowsecurity),
  4, 'the four event tables have RLS');
SELECT has_column('public', 'payments', 'voided_at', 'payments.voided_at exists');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_id_key')
  AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'payments_order_id_live_key' AND indexdef LIKE '%UNIQUE%WHERE (voided_at IS NULL)%'),
  'one live payment per order: the unique key on order_id is partial');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('cancel_order', 'void_order_items', 'void_payment')
      AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig) AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')),
  3, 'the three writers are SECURITY DEFINER with an empty search_path and vipe_api may execute them');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('void_authorizer', 'void_reason_text', 'guard_order_lifecycle', 'guard_append_only', 'guard_payment_voided_final')
      AND (has_function_privilege('vipe_api', p.oid, 'EXECUTE') OR NOT coalesce('search_path=""' = ANY(p.proconfig), false))),
  0, 'the 0018 helpers pin an empty search_path and vipe_api cannot call them');
SELECT ok(has_function_privilege('vipe_api', 'public.delete_order_with_items(uuid)', 'EXECUTE'), 'delete_order_with_items keeps its grant (old callers get a refusal)');

-- ============================================
-- Fixtures: restaurant A (admin, cashier, second cashier, waiter, a
-- supervisor removed later) and restaurant B (admin).
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('e8000000-0000-0000-0000-0000000000a1', 't280-a', 'T280 A'),
  ('e8000000-0000-0000-0000-0000000000b2', 't280-b', 'T280 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('e8100000-0000-0000-0000-000000000001', 'admin@t280a.test', 'h'),
  ('e8100000-0000-0000-0000-000000000002', 'cashier@t280a.test', 'h'),
  ('e8100000-0000-0000-0000-000000000003', 'cashier2@t280a.test', 'h'),
  ('e8100000-0000-0000-0000-000000000004', 'waiter@t280a.test', 'h'),
  ('e8100000-0000-0000-0000-000000000005', 'sup@t280a.test', 'h'),
  ('e8100000-0000-0000-0000-000000000006', 'admin@t280b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('e8200000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-000000000001', 'Admin A', 'admin@t280a.test', 'admin', true, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8200000-0000-0000-0000-000000000002', 'e8100000-0000-0000-0000-000000000002', 'Cajera A', 'cashier@t280a.test', 'cashier', true, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8200000-0000-0000-0000-000000000003', 'e8100000-0000-0000-0000-000000000003', 'Cajero Dos', 'cashier2@t280a.test', 'cashier', true, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8200000-0000-0000-0000-000000000004', 'e8100000-0000-0000-0000-000000000004', 'Mesero A', 'waiter@t280a.test', 'waiter', true, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8200000-0000-0000-0000-000000000005', 'e8100000-0000-0000-0000-000000000005', 'Supervisora Temporal', 'sup@t280a.test', 'cashier', true, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8200000-0000-0000-0000-000000000006', 'e8100000-0000-0000-0000-000000000006', 'Admin B', 'admin@t280b.test', 'admin', true, 'e8000000-0000-0000-0000-0000000000b2');
INSERT INTO public.tables (id, number, status, waiter_id, restaurant_id) VALUES
  ('e8300000-0000-0000-0000-000000000001', 1, 'kitchen', 'e8200000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8300000-0000-0000-0000-000000000002', 2, 'kitchen', NULL, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8300000-0000-0000-0000-000000000003', 3, 'kitchen', NULL, 'e8000000-0000-0000-0000-0000000000a1');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('e8400000-0000-0000-0000-000000000001', 'e8000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');
-- o1: cancel (2 lines), o2: empty, o3: paid then voided, o4: paid on the drawer closed later,
-- o5: item voids, o6: self-authorized cancel, o7: B, o8: paid and kept.
INSERT INTO public.orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total, restaurant_id) VALUES
  ('e8500000-0000-0000-0000-000000000001', 'e8300000-0000-0000-0000-000000000001', 'e8200000-0000-0000-0000-000000000004', 'kitchen', 13000, 0, 0, 0, 0, 13000, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000002', NULL, NULL, 'active', 0, 0, 0, 0, 0, 0, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000003', 'e8300000-0000-0000-0000-000000000002', NULL, 'delivered', 8000, 0, 0, 0, 0, 8000, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000004', NULL, NULL, 'delivered', 4000, 0, 0, 0, 0, 4000, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000005', 'e8300000-0000-0000-0000-000000000003', NULL, 'kitchen', 17000, 0, 0, 0, 0, 17000, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000006', NULL, NULL, 'kitchen', 2000, 0, 0, 0, 0, 2000, 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8500000-0000-0000-0000-000000000007', NULL, NULL, 'kitchen', 1000, 0, 0, 0, 0, 1000, 'e8000000-0000-0000-0000-0000000000b2'),
  ('e8500000-0000-0000-0000-000000000008', NULL, NULL, 'delivered', 3000, 0, 0, 0, 0, 3000, 'e8000000-0000-0000-0000-0000000000a1');
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES
  ('e8600000-0000-0000-0000-000000000011', 'e8500000-0000-0000-0000-000000000001', NULL, 'Arepa', 5000, 2, 'kitchen', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000012', 'e8500000-0000-0000-0000-000000000001', NULL, 'Jugo', 3000, 1, 'served', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000031', 'e8500000-0000-0000-0000-000000000003', NULL, 'Bandeja', 8000, 1, 'served', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000041', 'e8500000-0000-0000-0000-000000000004', NULL, 'Tinto', 4000, 1, 'served', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000051', 'e8500000-0000-0000-0000-000000000005', NULL, 'Arepa', 5000, 3, 'kitchen', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000052', 'e8500000-0000-0000-0000-000000000005', NULL, 'Jugo', 2000, 1, 'served', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000061', 'e8500000-0000-0000-0000-000000000006', NULL, 'Agua', 2000, 1, 'kitchen', 'e8000000-0000-0000-0000-0000000000a1'),
  ('e8600000-0000-0000-0000-000000000071', 'e8500000-0000-0000-0000-000000000007', NULL, 'B', 1000, 1, 'kitchen', 'e8000000-0000-0000-0000-0000000000b2'),
  ('e8600000-0000-0000-0000-000000000081', 'e8500000-0000-0000-0000-000000000008', NULL, 'Pan', 3000, 1, 'served', 'e8000000-0000-0000-0000-0000000000a1');

-- Consumed authorizations (as the API leaves them) plus traps: unconsumed,
-- another action, another restaurant.
CREATE TEMP TABLE t280_auth (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t280_auth TO vipe_api;
-- Each one is bound to a target and to the staff member who asked for it (0018, A1).
WITH rows (name, id, restaurant, action, supervisor, consumed, requester, target) AS (VALUES
  ('cancel1', 'e8700000-0000-0000-0000-000000000001'::uuid, 'e8000000-0000-0000-0000-0000000000a1'::uuid, 'cancel_order', 'e8200000-0000-0000-0000-000000000002'::uuid, true, 'e8200000-0000-0000-0000-000000000004'::uuid, 'e8500000-0000-0000-0000-000000000001'::uuid),
  ('unconsumed', 'e8700000-0000-0000-0000-000000000002', 'e8000000-0000-0000-0000-0000000000a1', 'cancel_order', 'e8200000-0000-0000-0000-000000000002', false, 'e8200000-0000-0000-0000-000000000004', 'e8500000-0000-0000-0000-000000000001'),
  ('wrong_action', 'e8700000-0000-0000-0000-000000000003', 'e8000000-0000-0000-0000-0000000000a1', 'void_item', 'e8200000-0000-0000-0000-000000000002', true, 'e8200000-0000-0000-0000-000000000004', 'e8500000-0000-0000-0000-000000000001'),
  ('other_restaurant', 'e8700000-0000-0000-0000-000000000004', 'e8000000-0000-0000-0000-0000000000b2', 'cancel_order', 'e8200000-0000-0000-0000-000000000006', true, 'e8200000-0000-0000-0000-000000000006', 'e8500000-0000-0000-0000-000000000001'),
  ('self_cancel', 'e8700000-0000-0000-0000-000000000005', 'e8000000-0000-0000-0000-0000000000a1', 'cancel_order', 'e8200000-0000-0000-0000-000000000002', true, 'e8200000-0000-0000-0000-000000000002', 'e8500000-0000-0000-0000-000000000006'),
  ('item1', 'e8700000-0000-0000-0000-000000000006', 'e8000000-0000-0000-0000-0000000000a1', 'void_item', 'e8200000-0000-0000-0000-000000000005', true, 'e8200000-0000-0000-0000-000000000004', 'e8500000-0000-0000-0000-000000000005'),
  ('item2', 'e8700000-0000-0000-0000-000000000007', 'e8000000-0000-0000-0000-0000000000a1', 'void_item', 'e8200000-0000-0000-0000-000000000003', true, 'e8200000-0000-0000-0000-000000000004', 'e8500000-0000-0000-0000-000000000005'),
  ('item_inactive', 'e8700000-0000-0000-0000-00000000000b', 'e8000000-0000-0000-0000-0000000000a1', 'void_item', 'e8200000-0000-0000-0000-000000000003', true, 'e8200000-0000-0000-0000-000000000004', 'e8500000-0000-0000-0000-000000000005')
), ins AS (
  INSERT INTO public.supervisor_authorizations
    (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
  SELECT id, restaurant, action, supervisor, requester, 'order', target, now() - interval '10 seconds', now() + interval '110 seconds', CASE WHEN consumed THEN now() END FROM rows
  RETURNING id
)
INSERT INTO t280_auth SELECT name, id FROM rows;

-- ============================================
-- 2. vipe_api cannot delete or bypass the lifecycle
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ DELETE FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000002' $$,
  '42501', 'orders rows are never deleted: cancel the order or void the item', 'vipe_api cannot DELETE an order');
SELECT throws_ok($$ DELETE FROM public.order_items WHERE id = 'e8600000-0000-0000-0000-000000000012' $$,
  '42501', 'order_items rows are never deleted: cancel the order or void the item', 'vipe_api cannot DELETE an order item');
SELECT throws_ok($$ SELECT public.delete_order_with_items('e8500000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'delete_order_with_items refuses');
SELECT is((SELECT count(*)::int FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000001'), 1, 'the order is still there');
SELECT throws_ok($$ UPDATE public.orders SET status = 'cancelled' WHERE id = 'e8500000-0000-0000-0000-000000000002' $$,
  '42501', NULL, 'vipe_api cannot set status cancelled directly');
SELECT throws_ok($$ UPDATE public.orders SET status = 'paid' WHERE id = 'e8500000-0000-0000-0000-000000000003' $$,
  '42501', NULL, 'vipe_api cannot set status paid directly');
SELECT throws_ok($$ UPDATE public.order_items SET quantity = 1 WHERE id = 'e8600000-0000-0000-0000-000000000011' $$,
  '42501', NULL, 'vipe_api cannot change an item quantity');
SELECT throws_ok($$ UPDATE public.order_items SET price = 1 WHERE id = 'e8600000-0000-0000-0000-000000000011' $$,
  '42501', NULL, 'vipe_api cannot change an item price');
SELECT throws_ok($$ UPDATE public.order_items SET status = 'cancelled' WHERE id = 'e8600000-0000-0000-0000-000000000011' $$,
  '42501', NULL, 'vipe_api cannot cancel an item directly');
SELECT lives_ok($$ UPDATE public.order_items SET status = 'served' WHERE id = 'e8600000-0000-0000-0000-000000000061' $$,
  'serving an item still works');
SELECT lives_ok($$ UPDATE public.orders SET status = 'delivered' WHERE id = 'e8500000-0000-0000-0000-000000000006' $$,
  'kitchen -> delivered still works');
SELECT throws_ok($$ INSERT INTO public.audit_log (restaurant_id, event_type, order_id, actor_name, reason_code, amount)
                    VALUES ('e8000000-0000-0000-0000-0000000000a1', 'order_cancelled', 'e8500000-0000-0000-0000-000000000002', 'x', 'waiter_error', 0) $$,
  '42501', NULL, 'vipe_api cannot write the audit log');

-- ============================================
-- 3. cancel_order (the waiter cancels, a cashier authorizes)
-- ============================================
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'customer_left') $$,
  '42501', 'cancel_order: authorization_required', 'an order with sent lines needs an authorization');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'customer_left', NULL, (SELECT id FROM t280_auth WHERE name = 'wrong_action')) $$,
  '42501', 'cancel_order: authorization_invalid', 'an authorization for another action is refused');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'customer_left', NULL, (SELECT id FROM t280_auth WHERE name = 'unconsumed')) $$,
  '42501', 'cancel_order: authorization_invalid', 'an authorization the API did not consume is refused');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'customer_left', NULL, (SELECT id FROM t280_auth WHERE name = 'other_restaurant')) $$,
  '42501', 'cancel_order: authorization_invalid', 'an authorization of another restaurant is refused');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'other', '  ', (SELECT id FROM t280_auth WHERE name = 'cancel1')) $$,
  '22023', 'cancel_order: reason_text_required', '"other" needs a text');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'bored', NULL, (SELECT id FROM t280_auth WHERE name = 'cancel1')) $$,
  '22023', 'cancel_order: reason_invalid', 'an unknown reason is refused');
SELECT lives_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'other', '  El   cliente cambió de mesa ', (SELECT id FROM t280_auth WHERE name = 'cancel1')) $$,
  'the waiter cancels with a cashier authorization');
SELECT is((SELECT status FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000001'), 'cancelled', 'the order is cancelled, not deleted');
SELECT is((SELECT count(*)::int FROM public.order_items WHERE order_id = 'e8500000-0000-0000-0000-000000000001' AND quantity > 0), 2, 'its lines are kept');
SELECT is(
  (SELECT row(previous_status, reason_code, reason_text, cancelled_by_name, authorized_by_name, self_authorized, total, sent_items, jsonb_array_length(items))::text
     FROM public.order_cancellations WHERE order_id = 'e8500000-0000-0000-0000-000000000001'),
  '(kitchen,other,"El cliente cambió de mesa","Mesero A","Cajera A",f,13000.00,2,2)',
  'order_cancellations keeps reason, actor, authorizer and the bill at that moment');
SELECT is(
  (SELECT row(event_type, actor_profile_id, authorized_by_profile_id, self_authorized, amount)::text
     FROM public.audit_log WHERE order_id = 'e8500000-0000-0000-0000-000000000001'),
  '(order_cancelled,e8200000-0000-0000-0000-000000000004,e8200000-0000-0000-0000-000000000002,f,13000.00)',
  'the audit log records the cancellation');
RESET ROLE;
SELECT is((SELECT row(status, waiter_id)::text FROM public.tables WHERE id = 'e8300000-0000-0000-0000-000000000001'), '(available,)', 'the table is free');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000006', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'cancel1')) $$,
  '42501', 'cancel_order: authorization_invalid', 'an authorization backs one event only');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000001', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'self_cancel')) $$,
  'P0001', 'cancel_order: order_cancelled', 'a cancelled order cannot be cancelled again');
SELECT lives_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000002', 'waiter_error') $$,
  'an order with nothing on it is cancelled without an authorization');
SELECT is((SELECT row(authorized_by, authorization_id, total)::text FROM public.order_cancellations WHERE order_id = 'e8500000-0000-0000-0000-000000000002'),
  '(,,0.00)', 'and is recorded without an authorizer');

-- vipe_api cannot feed a cancelled order or write a cancelled line directly (A4).
SELECT throws_ok($$ INSERT INTO public.order_items (order_id, name, price, quantity, status, restaurant_id) VALUES ('e8500000-0000-0000-0000-000000000001', 'Extra', 1000, 1, 'kitchen', 'e8000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'no line is added to a cancelled order');
SELECT throws_ok($$ INSERT INTO public.order_items (order_id, name, price, quantity, status, restaurant_id) VALUES ('e8500000-0000-0000-0000-000000000008', 'Cero', 1000, 0, 'kitchen', 'e8000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'no line with quantity 0 is inserted');
SELECT throws_ok($$ INSERT INTO public.order_items (order_id, name, price, quantity, status, restaurant_id) VALUES ('e8500000-0000-0000-0000-000000000008', 'Anulada', 1000, 1, 'cancelled', 'e8000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL, 'no cancelled line is inserted');
SELECT throws_ok($$ UPDATE public.order_items SET order_id = 'e8500000-0000-0000-0000-000000000008' WHERE id = 'e8600000-0000-0000-0000-000000000012' $$,
  '42501', NULL, 'a line does not leave a cancelled order');

-- ============================================
-- 4. Self-authorization (L14: off by default)
-- ============================================
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000006', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'self_cancel')) $$,
  '42501', 'cancel_order: self_authorization_not_allowed', 'the cashier cannot authorize their own cancellation');
RESET ROLE;
SELECT throws_ok($$ INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('e8000000-0000-0000-0000-0000000000a1', 'allow_self_authorization', 'yes') $$,
  '23514', NULL, 'allow_self_authorization is true or false');
INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('e8000000-0000-0000-0000-0000000000a1', 'allow_self_authorization', 'true');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
SELECT lives_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000006', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'self_cancel')) $$,
  'with the setting on, the cashier authorizes their own cancellation');
SELECT is((SELECT row(self_authorized, actor_name, authorized_by_name)::text FROM public.audit_log WHERE order_id = 'e8500000-0000-0000-0000-000000000006'),
  '(t,"Cajera A","Cajera A")', 'and the event is flagged self_authorized');
RESET ROLE;
DELETE FROM public.business_config WHERE restaurant_id = 'e8000000-0000-0000-0000-0000000000a1' AND key = 'allow_self_authorization';
SET LOCAL ROLE vipe_api;

-- ============================================
-- 5. void_order_items
-- ============================================
RESET ROLE;
UPDATE public.users SET is_active = false WHERE id = 'e8100000-0000-0000-0000-000000000003';
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'item_inactive')) $$,
  '42501', 'void_order_items: authorization_invalid', 'a supervisor whose user is inactive authorizes nothing (A5)');
RESET ROLE;
UPDATE public.users SET is_active = true WHERE id = 'e8100000-0000-0000-0000-000000000003';
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1}]', 'dish_returned') $$,
  '42501', 'void_order_items: authorization_required', 'voiding a sent line needs an authorization');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":4}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'item1')) $$,
  '22023', 'void_order_items: void_quantity_exceeded', 'more units than the line has are refused');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000011","quantity":1}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'item1')) $$,
  'P0002', 'void_order_items: item_not_found', 'a line of another order is refused');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1},{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'item1')) $$,
  '22023', 'void_order_items: items_invalid', 'a repeated line is refused');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'cancel1')) $$,
  '42501', 'void_order_items: authorization_invalid', 'a cancel_order authorization does not void items');
SELECT lives_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":2}]', 'dish_returned', NULL, (SELECT id FROM t280_auth WHERE name = 'item1')) $$,
  'two of three units are voided');
SELECT is((SELECT row(quantity, status)::text FROM public.order_items WHERE id = 'e8600000-0000-0000-0000-000000000051'), '(1,kitchen)', 'the line keeps one unit');
SELECT is((SELECT row(subtotal, total)::text FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000005'), '(7000.00,7000.00)', 'the bill is recomputed');
SELECT is(
  (SELECT row(quantity, remaining_quantity, unit_price, amount, sent_to_kitchen, voided_by_name, authorized_by_name, self_authorized)::text
     FROM public.order_item_voids WHERE order_item_id = 'e8600000-0000-0000-0000-000000000051'),
  '(2,1,5000.00,10000.00,t,"Mesero A","Supervisora Temporal",f)',
  'order_item_voids records units, price, amount and that the line had been sent');
SELECT lives_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000005', '[{"order_item_id":"e8600000-0000-0000-0000-000000000051","quantity":1},{"order_item_id":"e8600000-0000-0000-0000-000000000052","quantity":1}]', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'item2')) $$,
  'every remaining unit is voided in one event');
SELECT is((SELECT array_agg(row(quantity, status)::text ORDER BY id) FROM public.order_items WHERE order_id = 'e8500000-0000-0000-0000-000000000005'),
  ARRAY['(0,cancelled)', '(0,cancelled)'], 'fully voided lines are cancelled with quantity 0');
SELECT is((SELECT row(status, subtotal)::text FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000005'), '(delivered,0.00)', 'nothing is left for the kitchen');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE order_id = 'e8500000-0000-0000-0000-000000000005' AND event_type = 'items_voided'), 2, 'one audit event per request');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000001', '[{"order_item_id":"e8600000-0000-0000-0000-000000000011","quantity":1}]', 'waiter_error') $$,
  'P0001', 'void_order_items: order_closed', 'a cancelled order takes no voids');
RESET ROLE;
SELECT throws_ok($$ UPDATE public.order_items SET quantity = 0 WHERE id = 'e8600000-0000-0000-0000-000000000081' $$,
  '23514', NULL, 'quantity 0 means cancelled (CHECK)');
SELECT throws_ok($$ UPDATE public.order_items SET quantity = -1, status = 'kitchen' WHERE id = 'e8600000-0000-0000-0000-000000000081' $$,
  '23514', NULL, 'a negative quantity is refused (CHECK)');
SET LOCAL ROLE vipe_api;

-- ============================================
-- 6. void_payment (a cashier voids, the other cashier authorizes)
-- ============================================
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
CREATE TEMP TABLE t280_pay (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO t280_pay
SELECT o.name, (public.pay_order(o.id, 'e8400000-0000-0000-0000-000000000001', 0,
         jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'),
                                              'amount', o.amount, 'cash_received', o.amount)), o.key)->>'payment_id')::uuid
  FROM (VALUES ('p3', 'e8500000-0000-0000-0000-000000000003'::uuid, 8000, 'e8800000-0000-0000-0000-000000000003'::uuid),
               ('p4', 'e8500000-0000-0000-0000-000000000004', 4000, 'e8800000-0000-0000-0000-000000000004'),
               ('p8', 'e8500000-0000-0000-0000-000000000008', 3000, 'e8800000-0000-0000-0000-000000000008')) AS o(name, id, amount, key);
RESET ROLE;
INSERT INTO public.supervisor_authorizations
  (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
SELECT a.id, a.restaurant, 'void_payment', a.supervisor, a.requester, 'payment', (SELECT id FROM t280_pay WHERE name = a.payment),
       now() - interval '10 seconds', now() + interval '110 seconds', now()
  FROM (VALUES ('e8700000-0000-0000-0000-000000000008'::uuid, 'e8000000-0000-0000-0000-0000000000a1'::uuid, 'e8200000-0000-0000-0000-000000000003'::uuid, 'e8200000-0000-0000-0000-000000000002'::uuid, 'p3'),
               ('e8700000-0000-0000-0000-000000000009', 'e8000000-0000-0000-0000-0000000000a1', 'e8200000-0000-0000-0000-000000000003', 'e8200000-0000-0000-0000-000000000002', 'p4'),
               ('e8700000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-0000000000b2', 'e8200000-0000-0000-0000-000000000006', 'e8200000-0000-0000-0000-000000000006', 'p8')) AS a(id, restaurant, supervisor, requester, payment);
INSERT INTO t280_auth VALUES ('pay1', 'e8700000-0000-0000-0000-000000000008'), ('pay2', 'e8700000-0000-0000-0000-000000000009'), ('pay_b', 'e8700000-0000-0000-0000-00000000000a');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.payments WHERE order_id = 'e8500000-0000-0000-0000-000000000003'), 1, 'the payment is visible before the void');
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000003', 'duplicate_charge', NULL, (SELECT id FROM t280_auth WHERE name = 'self_cancel')) $$,
  'P0001', 'cancel_order: order_paid', 'a paid order is not cancelled: its payment is voided first');
SELECT throws_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p3'), 'duplicate_charge') $$,
  '42501', 'void_payment: authorization_required', 'a payment void always needs an authorization');
SELECT lives_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p3'), 'wrong_payment_method', NULL, (SELECT id FROM t280_auth WHERE name = 'pay1')) $$,
  'the cashier voids the payment with the other cashier''s authorization');
SELECT is((SELECT count(*)::int FROM public.payments WHERE order_id = 'e8500000-0000-0000-0000-000000000003'), 0, 'vipe_api no longer sees the voided payment');
SELECT is((SELECT count(*)::int FROM public.payment_tenders WHERE payment_id = (SELECT id FROM t280_pay WHERE name = 'p3')), 0, 'nor its tenders');
SELECT is((SELECT row(total_charged, methods, jsonb_array_length(tenders), voided_by_name, authorized_by_name, self_authorized)::text
             FROM public.payment_voids WHERE payment_id = (SELECT id FROM t280_pay WHERE name = 'p3')),
  '(8000,cash,1,"Cajera A","Cajero Dos",f)', 'payment_voids keeps the amounts and tenders, readable by the restaurant');
SELECT is((SELECT row(event_type, amount)::text FROM public.audit_log WHERE payment_id = (SELECT id FROM t280_pay WHERE name = 'p3')),
  '(payment_voided,8000.00)', 'the audit log records the payment void');
SELECT is((SELECT status FROM public.orders WHERE id = 'e8500000-0000-0000-0000-000000000003'), 'delivered', 'the order is open again');
SELECT is((public.register_summary(ARRAY['e8400000-0000-0000-0000-000000000001'::uuid])->>'payments_count')::int, 2,
  'register_summary counts only live payments');
SELECT is((public.register_summary(ARRAY['e8400000-0000-0000-0000-000000000001'::uuid])->>'total_sales')::int, 7000,
  'register_summary sales exclude the voided payment');
SELECT throws_ok($$ SELECT public.pay_order('e8500000-0000-0000-0000-000000000003', 'e8400000-0000-0000-0000-000000000001', 0,
                      jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'), 'amount', 8000, 'cash_received', 8000)),
                      'e8800000-0000-0000-0000-000000000003') $$,
  'P0001', NULL, 'the key of a voided payment stays spent');
SELECT is(public.pay_order('e8500000-0000-0000-0000-000000000003', 'e8400000-0000-0000-0000-000000000001', 0,
            jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'), 'amount', 8000, 'cash_received', 10000)),
            'e8800000-0000-0000-0000-000000000033')->>'status',
  'paid', 'the order is paid again with a new key');
RESET ROLE;
SELECT throws_ok($$ INSERT INTO public.payments (restaurant_id, order_id, cash_register_id, amount_due, total_charged, idempotency_key)
                    VALUES ('e8000000-0000-0000-0000-0000000000a1', 'e8500000-0000-0000-0000-000000000003', 'e8400000-0000-0000-0000-000000000001', 8000, 8000, gen_random_uuid()) $$,
  '23505', NULL, 'a second live payment for the order is still refused');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p3'), 'duplicate_charge', NULL, (SELECT id FROM t280_auth WHERE name = 'pay2')) $$,
  'P0001', 'void_payment: payment_voided', 'a voided payment is not voided twice');
SELECT throws_ok($$ UPDATE public.payments SET voided_at = now() WHERE id = (SELECT id FROM t280_pay WHERE name = 'p4') $$,
  '42501', NULL, 'vipe_api cannot stamp voided_at by hand');
SELECT throws_ok($$ UPDATE public.audit_log SET reason_code = 'other' $$, '42501', NULL, 'the audit log is append-only (UPDATE)');
SELECT throws_ok($$ DELETE FROM public.audit_log $$, '42501', NULL, 'the audit log is append-only (DELETE)');
SELECT throws_ok($$ DELETE FROM public.order_cancellations $$, '42501', NULL, 'order_cancellations is append-only');
SELECT throws_ok($$ UPDATE public.payment_voids SET reason_code = 'other' $$, '42501', NULL, 'payment_voids is append-only');
SELECT throws_ok($$ UPDATE public.order_item_voids SET quantity = 1 $$, '42501', NULL, 'order_item_voids is append-only');
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000004', true);
SELECT throws_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p4'), 'duplicate_charge', NULL, (SELECT id FROM t280_auth WHERE name = 'pay2')) $$,
  '42501', NULL, 'a waiter cannot void a payment');
RESET ROLE;
SET LOCAL ROLE vipe_migrator;
SELECT throws_ok($$ UPDATE public.payments SET voided_at = NULL WHERE order_id = 'e8500000-0000-0000-0000-000000000003' AND voided_at IS NOT NULL $$,
  '42501', 'payments.voided_at is final once set', 'voided_at never clears, even for the trusted role');
RESET ROLE;
UPDATE public.cash_registers SET status = 'closed', closing_timestamp = now() WHERE id = 'e8400000-0000-0000-0000-000000000001';
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p4'), 'duplicate_charge', NULL, (SELECT id FROM t280_auth WHERE name = 'pay2')) $$,
  'P0001', 'void_payment: register_closed', 'a payment of a closed drawer is not voided');

-- ============================================
-- 7. Tenant isolation
-- ============================================
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000006', true);
SELECT throws_ok($$ SELECT public.cancel_order('e8500000-0000-0000-0000-000000000004', 'waiter_error', NULL, (SELECT id FROM t280_auth WHERE name = 'other_restaurant')) $$,
  'P0002', 'cancel_order: order_not_found', 'B cannot cancel an order of A');
SELECT throws_ok($$ SELECT public.void_payment((SELECT id FROM t280_pay WHERE name = 'p8'), 'duplicate_charge', NULL, (SELECT id FROM t280_auth WHERE name = 'pay_b')) $$,
  'P0002', 'void_payment: payment_not_found', 'B cannot void a payment of A');
SELECT throws_ok($$ SELECT public.void_order_items('e8500000-0000-0000-0000-000000000008', '[{"order_item_id":"e8600000-0000-0000-0000-000000000081","quantity":1}]', 'waiter_error') $$,
  'P0002', 'void_order_items: order_not_found', 'B cannot void items of A');
SELECT is((SELECT count(*)::int FROM public.audit_log) + (SELECT count(*)::int FROM public.order_cancellations)
          + (SELECT count(*)::int FROM public.order_item_voids) + (SELECT count(*)::int FROM public.payment_voids), 0,
  'B reads none of A''s events');
SELECT set_config('app.user_id', 'e8100000-0000-0000-0000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.audit_log), 6, 'A reads its six events');

-- ============================================
-- 8. History survives a removed profile
-- ============================================
RESET ROLE;
DELETE FROM public.profiles WHERE id = 'e8200000-0000-0000-0000-000000000005';
SELECT is(
  (SELECT row(authorized_by, authorized_by_name)::text FROM public.order_item_voids WHERE order_item_id = 'e8600000-0000-0000-0000-000000000051' AND quantity = 2),
  '(,"Supervisora Temporal")', 'the authorizer''s name stays when their profile is removed');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE restaurant_id = 'e8000000-0000-0000-0000-0000000000a1'), 6, 'no event is lost');

SELECT * FROM finish();
ROLLBACK;
