-- undo_split after a partial void (odd/tasks/fase3-operacion.md, F1,
-- verifier round 2, B2). A line with void history must never be merged back
-- (and deleted) by undo_split: the void row references it. undo_split refuses
-- with P0001 `undo_split: split_has_voids` instead of a 23503, and the void
-- row stays.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(2);

INSERT INTO public.restaurants (id, slug, name) VALUES ('e8100000-0000-0000-0000-0000000281a1', 't281-a', 'T281 A');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('e8110000-0000-0000-0000-000000000001', 'admin@t281.test', 'h'),
  ('e8110000-0000-0000-0000-000000000002', 'cashier@t281.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('e8120000-0000-0000-0000-000000000001', 'e8110000-0000-0000-0000-000000000001', 'Admin 281', 'admin@t281.test', 'admin', true, 'e8100000-0000-0000-0000-0000000281a1'),
  ('e8120000-0000-0000-0000-000000000002', 'e8110000-0000-0000-0000-000000000002', 'Cajera 281', 'cashier@t281.test', 'cashier', true, 'e8100000-0000-0000-0000-0000000281a1');
INSERT INTO public.dishes (id, name, price, active, restaurant_id) VALUES
  ('e8130000-0000-0000-0000-000000000001', 'X', 1000, true, 'e8100000-0000-0000-0000-0000000281a1'),
  ('e8130000-0000-0000-0000-000000000002', 'Y', 2000, true, 'e8100000-0000-0000-0000-0000000281a1');
INSERT INTO public.tables (id, number, status, restaurant_id) VALUES
  ('e8140000-0000-0000-0000-000000000001', 1, 'kitchen', 'e8100000-0000-0000-0000-0000000281a1');
INSERT INTO public.orders (id, table_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
  ('e8150000-0000-0000-0000-000000000001', 'e8140000-0000-0000-0000-000000000001', 'kitchen', 8000, 0, 0, 8000, 'e8100000-0000-0000-0000-0000000281a1');
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, status, restaurant_id) VALUES
  ('e8160000-0000-0000-0000-000000000001', 'e8150000-0000-0000-0000-000000000001', 'e8130000-0000-0000-0000-000000000001', 'X', 1000, 5, 'kitchen', 'e8100000-0000-0000-0000-0000000281a1'),
  ('e8160000-0000-0000-0000-000000000002', 'e8150000-0000-0000-0000-000000000001', 'e8130000-0000-0000-0000-000000000001', 'X', 1000, 1, 'kitchen', 'e8100000-0000-0000-0000-0000000281a1'),
  ('e8160000-0000-0000-0000-000000000003', 'e8150000-0000-0000-0000-000000000001', 'e8130000-0000-0000-0000-000000000002', 'Y', 2000, 1, 'kitchen', 'e8100000-0000-0000-0000-0000000281a1');
-- A consumed void_item authorization from the cashier, requested by the admin
-- for this order (the target columns exist from 0018 on; written so the file
-- also runs against a schema without them).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'supervisor_authorizations' AND column_name = 'target_id') THEN
    EXECUTE $i$INSERT INTO public.supervisor_authorizations
      (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
      VALUES ('e8170000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-0000000281a1', 'void_item', 'e8120000-0000-0000-0000-000000000002',
              'e8120000-0000-0000-0000-000000000001', 'order', 'e8150000-0000-0000-0000-000000000001', now() - interval '5 seconds', now() + interval '1 minute', now())$i$;
  ELSE
    INSERT INTO public.supervisor_authorizations
      (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, created_at, expires_at, consumed_at)
      VALUES ('e8170000-0000-0000-0000-000000000001', 'e8100000-0000-0000-0000-0000000281a1', 'void_item', 'e8120000-0000-0000-0000-000000000002',
              'e8120000-0000-0000-0000-000000000001', now() - interval '5 seconds', now() + interval '1 minute', now());
  END IF;
END
$$;

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', 'e8110000-0000-0000-0000-000000000001', true);
CREATE TEMP TABLE t281 (child uuid) ON COMMIT DROP;
-- Void 2 of the 5-unit line, then split the 3 left to a child order.
SELECT public.void_order_items('e8150000-0000-0000-0000-000000000001',
  '[{"order_item_id":"e8160000-0000-0000-0000-000000000001","quantity":2}]', 'dish_returned', NULL, 'e8170000-0000-0000-0000-000000000001');
INSERT INTO t281
SELECT (public.split_order('e8150000-0000-0000-0000-000000000001',
  '[{"order_item_id":"e8160000-0000-0000-0000-000000000001","quantity":3}]')->>'child_order_id')::uuid;

SELECT throws_ok($$ SELECT public.undo_split((SELECT child FROM t281)) $$,
  'P0001', NULL, 'undo_split refuses a split with void history (not 23503)');
SELECT is((SELECT count(*)::int FROM public.order_item_voids WHERE order_item_id = 'e8160000-0000-0000-0000-000000000001'), 1,
  'the void row stays');

SELECT * FROM finish();
ROLLBACK;
