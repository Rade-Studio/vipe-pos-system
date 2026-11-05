-- Realtime change notifications (odd/tasks/migracion-backend-nestjs.md, T6,
-- design steps 1 and 2).
--
-- Triggers on orders, tables and order_deliveries call pg_notify('pos_changes')
-- with {table, op, id, restaurant_id} only; the API loads the row through
-- private.realtime_row, the one deliberate cross-tenant read vipe_api gets.
-- This restores the check dropped with the supabase_realtime publication (100).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(20);

-- 1-3. The three realtime tables carry the notify trigger.
SELECT trigger_is('public', 'orders', 'notify_change', 'private', 'notify_change', 'orders notifies changes');
SELECT trigger_is('public', 'tables', 'notify_change', 'private', 'notify_change', 'tables notifies changes');
SELECT trigger_is('public', 'order_deliveries', 'notify_change', 'private', 'notify_change', 'order_deliveries notifies changes');

-- 4. Each trigger fires AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
SELECT is(
  (SELECT count(*)
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('orders', 'tables', 'order_deliveries')
      AND t.tgname = 'notify_change'
      AND NOT t.tgisinternal
      -- ROW (1), no BEFORE (2) or INSTEAD (64), INSERT (4) + DELETE (8) + UPDATE (16)
      AND t.tgtype & (1 | 2 | 4 | 8 | 16 | 64) = (1 | 4 | 8 | 16))::bigint,
  3::bigint,
  'notify_change is AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW on the three tables'
);

-- 5. No other table notifies: the fan-out whitelist and the triggers agree
-- (order_items joined in T8a, 180_order_items_notify).
SELECT is(
  (SELECT count(*)
     FROM pg_trigger t
     JOIN pg_proc p ON p.oid = t.tgfoid
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'notify_change')::bigint,
  4::bigint,
  'only the realtime tables (and order_items since T8a) use private.notify_change'
);

-- 6. Both payload functions pin search_path to the empty string.
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('change_payload', 'notify_change')
      AND p.proconfig @> ARRAY['search_path=""'])::bigint,
  2::bigint,
  'change_payload and notify_change set search_path to the empty string'
);

-- 7. change_payload is IMMUTABLE and not executable by PUBLIC.
SELECT ok(
  (SELECT p.provolatile = 'i' AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'change_payload'),
  'change_payload is IMMUTABLE and not executable by PUBLIC'
);

-- 8-12. Exact payloads. id and restaurant_id come from coalesce(new, old); new
-- is never carried (the API loads it); old is the full previous row, like the
-- REPLICA IDENTITY FULL payloads Supabase delivers today, unless it would push
-- the payload past 7000 bytes.
SELECT is(
  private.change_payload('orders', 'INSERT',
    '{"id": "17000000-0000-0000-0000-000000000001", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "order_type": "dine_in", "total": 10}'::jsonb,
    NULL),
  '{"table": "orders", "op": "INSERT", "id": "17000000-0000-0000-0000-000000000001", "restaurant_id": "17000000-0000-0000-0000-0000000000aa"}'::jsonb,
  'INSERT payload comes from new only and carries no old'
);
SELECT is(
  private.change_payload('tables', 'UPDATE',
    '{"id": "17000000-0000-0000-0000-000000000002", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "status": "occupied"}'::jsonb,
    '{"id": "17000000-0000-0000-0000-000000000002", "restaurant_id": "17000000-0000-0000-0000-0000000000bb", "status": "free"}'::jsonb),
  '{"table": "tables", "op": "UPDATE", "id": "17000000-0000-0000-0000-000000000002", "restaurant_id": "17000000-0000-0000-0000-0000000000aa",
    "old": {"id": "17000000-0000-0000-0000-000000000002", "restaurant_id": "17000000-0000-0000-0000-0000000000bb", "status": "free"}}'::jsonb,
  'UPDATE payload takes id and tenant from new and carries the full old row'
);
SELECT is(
  private.change_payload('orders', 'DELETE',
    NULL,
    '{"id": "17000000-0000-0000-0000-000000000003", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "order_type": "delivery", "total": 30}'::jsonb),
  '{"table": "orders", "op": "DELETE", "id": "17000000-0000-0000-0000-000000000003", "restaurant_id": "17000000-0000-0000-0000-0000000000aa",
    "old": {"id": "17000000-0000-0000-0000-000000000003", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "order_type": "delivery", "total": 30}}'::jsonb,
  'DELETE payload comes from old and carries the full old row'
);
SELECT is(
  private.change_payload('order_deliveries', 'DELETE',
    NULL,
    '{"order_id": "17000000-0000-0000-0000-000000000004", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "status": "pending"}'::jsonb),
  '{"table": "order_deliveries", "op": "DELETE", "id": "17000000-0000-0000-0000-000000000004", "restaurant_id": "17000000-0000-0000-0000-0000000000aa",
    "old": {"order_id": "17000000-0000-0000-0000-000000000004", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "status": "pending"}}'::jsonb,
  'order_deliveries payload id is its primary key order_id; old keeps its natural columns'
);
SELECT is(
  private.change_payload('orders', 'UPDATE',
    '{"id": "17000000-0000-0000-0000-000000000005", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "order_type": "delivery"}'::jsonb,
    jsonb_build_object('id', '17000000-0000-0000-0000-000000000005', 'restaurant_id', '17000000-0000-0000-0000-0000000000aa',
                       'order_type', 'delivery', 'items_json', repeat('x', 10240))),
  '{"table": "orders", "op": "UPDATE", "id": "17000000-0000-0000-0000-000000000005", "restaurant_id": "17000000-0000-0000-0000-0000000000aa",
    "old": {"id": "17000000-0000-0000-0000-000000000005", "restaurant_id": "17000000-0000-0000-0000-0000000000aa", "order_type": "delivery"},
    "old_truncated": true}'::jsonb,
  'an old row that would exceed 7000 bytes falls back to its key columns with old_truncated'
);

-- 13-14. The 7000-byte limit counts bytes, not characters: pad a two-byte
-- character so the full payload is exactly 7000 bytes (kept) or 7001 (cut).
CREATE TEMP TABLE t170_pad AS
  SELECT n,
         private.change_payload('tables', 'DELETE', NULL,
           jsonb_build_object('id', '17000000-0000-0000-0000-000000000006',
                              'restaurant_id', '17000000-0000-0000-0000-0000000000aa',
                              'pad', repeat('ñ', n / 2) || repeat('x', n % 2))) AS payload
    FROM (SELECT 7000 - octet_length(private.change_payload('tables', 'DELETE', NULL,
                   jsonb_build_object('id', '17000000-0000-0000-0000-000000000006',
                                      'restaurant_id', '17000000-0000-0000-0000-0000000000aa',
                                      'pad', ''))::text) AS base) b,
         LATERAL (VALUES (base), (base + 1)) AS v(n);
SELECT ok(
  (SELECT octet_length(payload::text) = 7000 AND payload ? 'old' AND NOT payload ? 'old_truncated'
          AND payload -> 'old' ? 'pad'
     FROM t170_pad ORDER BY n LIMIT 1),
  'a 7000-byte payload (multibyte counted as bytes) keeps the full old row'
);
SELECT is(
  (SELECT payload FROM t170_pad ORDER BY n DESC LIMIT 1),
  '{"table": "tables", "op": "DELETE", "id": "17000000-0000-0000-0000-000000000006", "restaurant_id": "17000000-0000-0000-0000-0000000000aa",
    "old": {"id": "17000000-0000-0000-0000-000000000006", "restaurant_id": "17000000-0000-0000-0000-0000000000aa"}, "old_truncated": true}'::jsonb,
  'a 7001-byte payload falls back to the key columns'
);

-- Fixtures as the test author: one tenant with an order and a table.
INSERT INTO public.restaurants (id, slug, name)
  VALUES ('17000000-0000-0000-0000-0000000000aa', 'rest-t170', 'Restaurant T170');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id)
  VALUES ('17000000-0000-0000-0000-000000000011', 'active', 10, 0, 0, 10, '17000000-0000-0000-0000-0000000000aa'),
         ('17000000-0000-0000-0000-000000000012', 'active', 10, 0, 0, 10, '17000000-0000-0000-0000-0000000000aa');
INSERT INTO public.customers (id, restaurant_id, phone, name)
  VALUES ('17000000-0000-0000-0000-000000000021', '17000000-0000-0000-0000-0000000000aa', '3001234567', 'Cliente T170');
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line)
  VALUES ('17000000-0000-0000-0000-000000000012', '17000000-0000-0000-0000-0000000000aa',
          '17000000-0000-0000-0000-000000000021', 'Cliente T170', '3001234567', 'Calle 1');

-- 15. realtime_row is SECURITY DEFINER, pinned, executable by vipe_api only.
SELECT ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
          AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'realtime_row'),
  'realtime_row is SECURITY DEFINER, search_path pinned, vipe_api only'
);

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '', true);

-- 16. Without app.user_id, vipe_api loads a realtime row by primary key.
SELECT is(
  private.realtime_row('orders', '17000000-0000-0000-0000-000000000011') ->> 'restaurant_id',
  '17000000-0000-0000-0000-0000000000aa',
  'vipe_api loads an orders row by id through realtime_row without app.user_id'
);

-- 17. order_deliveries rows are looked up by their primary key order_id.
SELECT is(
  private.realtime_row('order_deliveries', '17000000-0000-0000-0000-000000000012') ->> 'order_id',
  '17000000-0000-0000-0000-000000000012',
  'realtime_row loads order_deliveries by order_id, keeping its natural columns'
);

-- 18. An unknown id yields NULL (deleted between NOTIFY and the load).
SELECT is(
  private.realtime_row('tables', '17000000-0000-0000-0000-0000000000ff'),
  NULL::jsonb,
  'realtime_row returns NULL for an unknown id'
);

-- 19. Any table outside the whitelist is rejected.
SELECT throws_ok(
  $$ SELECT private.realtime_row('profiles', '17000000-0000-0000-0000-000000000011') $$,
  '22023',
  'realtime_row: table profiles is not a realtime table',
  'realtime_row rejects tables outside orders, tables, order_deliveries'
);

-- 20. RLS still hides the three tables from a plain SELECT without app.user_id.
SELECT is(
  (SELECT count(*) FROM public.orders)
    + (SELECT count(*) FROM public.tables)
    + (SELECT count(*) FROM public.order_deliveries),
  0::bigint,
  'a plain SELECT as vipe_api without app.user_id still returns no rows'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
