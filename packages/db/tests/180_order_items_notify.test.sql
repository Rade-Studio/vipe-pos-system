-- order_items realtime and the orders API helpers (odd/tasks/migracion-backend-nestjs.md,
-- T8a design steps 2 and 5).
--
-- The kitchen screen subscribes to order_items and reads old.status, so the
-- table gets the notify_change trigger and joins the realtime_row whitelist.
-- The listener enriches orders and tables events through two tenant-checked
-- SECURITY DEFINER loaders, and the API recomputes a bill through a wrapper
-- that refuses orders of another restaurant (private.recompute_order_bill
-- itself has no tenant check and is not executable by vipe_api).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(14);

-- 1. order_items carries the notify trigger.
SELECT trigger_is('public', 'order_items', 'notify_change', 'private', 'notify_change', 'order_items notifies changes');

-- 2. It fires AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
SELECT ok(
  (SELECT t.tgtype & (1 | 2 | 4 | 8 | 16 | 64) = (1 | 4 | 8 | 16)
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'order_items' AND t.tgname = 'notify_change'),
  'order_items notify_change is AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW'
);

-- 3. An UPDATE payload carries the full old row (the kitchen reads old.status).
SELECT is(
  private.change_payload('order_items', 'UPDATE',
    '{"id": "18000000-0000-0000-0000-000000000031", "order_id": "18000000-0000-0000-0000-000000000011", "restaurant_id": "18000000-0000-0000-0000-0000000000aa", "status": "served"}'::jsonb,
    '{"id": "18000000-0000-0000-0000-000000000031", "order_id": "18000000-0000-0000-0000-000000000011", "restaurant_id": "18000000-0000-0000-0000-0000000000aa", "status": "kitchen"}'::jsonb),
  '{"table": "order_items", "op": "UPDATE", "id": "18000000-0000-0000-0000-000000000031", "restaurant_id": "18000000-0000-0000-0000-0000000000aa",
    "old": {"id": "18000000-0000-0000-0000-000000000031", "order_id": "18000000-0000-0000-0000-000000000011", "restaurant_id": "18000000-0000-0000-0000-0000000000aa", "status": "kitchen"}}'::jsonb,
  'order_items UPDATE payload carries the full old row'
);

-- 4. A truncated order_items old keeps order_id and status besides the keys.
SELECT is(
  private.change_payload('order_items', 'UPDATE',
    '{"id": "18000000-0000-0000-0000-000000000031", "restaurant_id": "18000000-0000-0000-0000-0000000000aa"}'::jsonb,
    jsonb_build_object('id', '18000000-0000-0000-0000-000000000031', 'order_id', '18000000-0000-0000-0000-000000000011',
                       'restaurant_id', '18000000-0000-0000-0000-0000000000aa', 'status', 'kitchen',
                       'comments', repeat('x', 10240))),
  '{"table": "order_items", "op": "UPDATE", "id": "18000000-0000-0000-0000-000000000031", "restaurant_id": "18000000-0000-0000-0000-0000000000aa",
    "old": {"id": "18000000-0000-0000-0000-000000000031", "order_id": "18000000-0000-0000-0000-000000000011",
            "restaurant_id": "18000000-0000-0000-0000-0000000000aa", "status": "kitchen"},
    "old_truncated": true}'::jsonb,
  'a truncated order_items old keeps id, order_id, restaurant_id and status'
);

-- 5. Truncation of the other tables is unchanged (orders has a status, not kept).
SELECT is(
  private.change_payload('orders', 'DELETE', NULL,
    jsonb_build_object('id', '18000000-0000-0000-0000-000000000011', 'restaurant_id', '18000000-0000-0000-0000-0000000000aa',
                       'status', 'kitchen', 'items_json', repeat('x', 10240))) -> 'old',
  '{"id": "18000000-0000-0000-0000-000000000011", "restaurant_id": "18000000-0000-0000-0000-0000000000aa"}'::jsonb,
  'orders truncation still keeps only the key columns'
);

-- 6. The new helpers are SECURITY DEFINER, pinned, vipe_api only.
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('realtime_order_items', 'realtime_waiter_name', 'recompute_caller_order_bill')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  3::bigint,
  'realtime_order_items, realtime_waiter_name and recompute_caller_order_bill are SECURITY DEFINER, pinned, vipe_api only'
);

-- Fixtures as the test author: restaurant A with a waiter, an order with two
-- items; restaurant B with its own user.
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('18000000-0000-0000-0000-0000000000aa', 'rest-t180-a', 'Restaurant T180 A'),
  ('18000000-0000-0000-0000-0000000000bb', 'rest-t180-b', 'Restaurant T180 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('18000000-0000-0000-0000-000000000001', 'waiter@t180a.test', 'x'),
  ('18000000-0000-0000-0000-000000000002', 'admin@t180b.test', 'x');
INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
  ('18000000-0000-0000-0000-000000000101', '18000000-0000-0000-0000-000000000001', 'Mesera T180', 'waiter@t180a.test', 'waiter', '18000000-0000-0000-0000-0000000000aa'),
  ('18000000-0000-0000-0000-000000000102', '18000000-0000-0000-0000-000000000002', 'Admin T180 B', 'admin@t180b.test', 'admin', '18000000-0000-0000-0000-0000000000bb');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, tip_percentage, total, restaurant_id)
  VALUES ('18000000-0000-0000-0000-000000000011', 'kitchen', 0, 0, 10, 5, 0, '18000000-0000-0000-0000-0000000000aa');
INSERT INTO public.order_items (id, order_id, name, price, quantity, restaurant_id, added_at) VALUES
  ('18000000-0000-0000-0000-000000000031', '18000000-0000-0000-0000-000000000011', 'Arepa', 1500, 2, '18000000-0000-0000-0000-0000000000aa', now() - interval '1 minute'),
  ('18000000-0000-0000-0000-000000000032', '18000000-0000-0000-0000-000000000011', 'Jugo', 2000.50, 1, '18000000-0000-0000-0000-0000000000aa', now());

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '', true);

-- 7. realtime_row accepts order_items.
SELECT is(
  private.realtime_row('order_items', '18000000-0000-0000-0000-000000000031') ->> 'status',
  'kitchen',
  'realtime_row loads an order_items row by id without app.user_id'
);

-- 8. realtime_order_items returns the order's items oldest first.
SELECT is(
  (SELECT array_agg(e ->> 'id' ORDER BY ord)
     FROM jsonb_array_elements(private.realtime_order_items('18000000-0000-0000-0000-000000000011',
                                                             '18000000-0000-0000-0000-0000000000aa'))
          WITH ORDINALITY AS x(e, ord)),
  ARRAY['18000000-0000-0000-0000-000000000031', '18000000-0000-0000-0000-000000000032'],
  'realtime_order_items returns the order items in insertion order'
);

-- 9. ...and nothing when the restaurant does not match.
SELECT is(
  private.realtime_order_items('18000000-0000-0000-0000-000000000011', '18000000-0000-0000-0000-0000000000bb'),
  '[]'::jsonb,
  'realtime_order_items returns [] for another restaurant'
);

-- 10-11. realtime_waiter_name is tenant-checked too.
SELECT is(
  private.realtime_waiter_name('18000000-0000-0000-0000-000000000101', '18000000-0000-0000-0000-0000000000aa'),
  'Mesera T180',
  'realtime_waiter_name returns the full name in the same restaurant'
);
SELECT is(
  private.realtime_waiter_name('18000000-0000-0000-0000-000000000101', '18000000-0000-0000-0000-0000000000bb'),
  NULL,
  'realtime_waiter_name returns NULL for another restaurant'
);

-- 12. recompute_caller_order_bill refuses an order of another restaurant.
SELECT set_config('app.user_id', '18000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$ SELECT private.recompute_caller_order_bill('18000000-0000-0000-0000-000000000011') $$,
  'P0002',
  'Order not found',
  'recompute_caller_order_bill raises P0002 for an order of another restaurant'
);

-- 13-14. In the caller's restaurant it writes the bill recompute_order_bill computes
-- (subtotal round(price*qty) per line: 3000 + 2001; tax 10 %, tip 5 %).
SELECT set_config('app.user_id', '18000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ SELECT private.recompute_caller_order_bill('18000000-0000-0000-0000-000000000011') $$,
  'recompute_caller_order_bill runs for an order of the caller restaurant'
);
RESET ROLE;
SELECT is(
  (SELECT ARRAY[subtotal, tax, tip, total] FROM public.orders WHERE id = '18000000-0000-0000-0000-000000000011'),
  ARRAY[5001, 500, 250, 5751]::numeric[],
  'the bill is the one private.recompute_order_bill computes'
);

SELECT * FROM finish();
ROLLBACK;
