-- order_deliveries deletes through the trusted path (odd/tasks/migracion-backend-nestjs.md,
-- T6 verification advisory 1). guard_order_deliveries_immutable is a BEFORE
-- UPDATE OR DELETE trigger; its trusted branch returned NEW, which is NULL on
-- DELETE, so every delete (the ON DELETE CASCADE from orders included) was
-- silently skipped and no DELETE realtime event ever fired.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(4);

INSERT INTO public.restaurants (id, slug, name)
  VALUES ('17500000-0000-0000-0000-0000000000aa', 'rest-t175', 'Restaurant T175');
INSERT INTO public.customers (id, restaurant_id, phone, name)
  VALUES ('17500000-0000-0000-0000-000000000021', '17500000-0000-0000-0000-0000000000aa', '3001234567', 'Cliente T175');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id, order_type)
  VALUES ('17500000-0000-0000-0000-000000000001', 'active', 10, 0, 0, 10, '17500000-0000-0000-0000-0000000000aa', 'delivery'),
         ('17500000-0000-0000-0000-000000000002', 'active', 10, 0, 0, 10, '17500000-0000-0000-0000-0000000000aa', 'delivery'),
         ('17500000-0000-0000-0000-000000000003', 'active', 10, 0, 0, 10, '17500000-0000-0000-0000-0000000000aa', 'delivery');
INSERT INTO public.order_deliveries (order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line)
  SELECT o, '17500000-0000-0000-0000-0000000000aa', '17500000-0000-0000-0000-000000000021', 'Cliente T175', '3001234567', 'Calle 1'
    FROM unnest(ARRAY['17500000-0000-0000-0000-000000000001', '17500000-0000-0000-0000-000000000002',
                      '17500000-0000-0000-0000-000000000003']::uuid[]) AS o;

-- 1. Deleting the order as vipe_migrator cascades to its delivery row.
SET LOCAL ROLE vipe_migrator;
DELETE FROM public.orders WHERE id = '17500000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.order_deliveries WHERE order_id = '17500000-0000-0000-0000-000000000001')::bigint,
  0::bigint,
  'ON DELETE CASCADE from orders removes the order_deliveries row'
);

-- 2. A direct delete through the trusted path removes the row.
SET LOCAL ROLE vipe_migrator;
DELETE FROM public.order_deliveries WHERE order_id = '17500000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.order_deliveries WHERE order_id = '17500000-0000-0000-0000-000000000002')::bigint,
  0::bigint,
  'a trusted DELETE on order_deliveries removes the row'
);

-- 3. Other roles are still refused (the RLS DELETE policy would let a tenant
-- admin through, so this proves the guard still raises).
INSERT INTO public.users (id, email, password_hash)
  VALUES ('17500000-0000-0000-0000-000000000031', 'admin@t175.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id)
  VALUES ('17500000-0000-0000-0000-000000000041', '17500000-0000-0000-0000-000000000031', 'Admin T175',
          'admin@t175.test', 'admin', '17500000-0000-0000-0000-0000000000aa');
SELECT set_config('app.user_id', '17500000-0000-0000-0000-000000000031', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ DELETE FROM public.order_deliveries WHERE order_id = '17500000-0000-0000-0000-000000000003' $$,
  '42501',
  'order_deliveries rows are immutable: writes are done by the task 3 SECURITY DEFINER RPCs',
  'vipe_api still cannot delete order_deliveries directly'
);
RESET ROLE;

-- 4. The guard keeps its shape: invoker, search_path pinned.
SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_order_deliveries_immutable'),
  'guard_order_deliveries_immutable stays SECURITY INVOKER with search_path pinned'
);

SELECT * FROM finish();
ROLLBACK;
