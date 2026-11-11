-- Repair of table status that contradicts the orders (odd/tasks/qa-mesas-ordenes.md T8, S12, migration 0024).
--
-- public.repair_table_status() frees kitchen/served/delivered tables without
-- an open order and gives available/reserved tables with an open order the
-- status of the newest one. Occupied and agreeing tables are untouched.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(20);

SELECT has_function('public', 'repair_table_status', ARRAY[]::text[], 'public.repair_table_status() exists');
SELECT ok(NOT has_function_privilege('vipe_api', 'public.repair_table_status()', 'EXECUTE'), 'vipe_api cannot run the repair');

-- Fixtures: the seed restaurant, two of its profiles.
CREATE TEMP TABLE fx ON COMMIT DROP AS
SELECT 'a0eebc99-0000-0000-0000-000000000000'::uuid AS rid,
       (SELECT id FROM public.profiles WHERE email = 'maria@restaurant.com') AS waiter_a,
       (SELECT id FROM public.profiles WHERE email = 'carlos@restaurant.com') AS waiter_b;

INSERT INTO public.tables (id, number, status, waiter_id, restaurant_id, reservation_name, reservation_arrival_at, reserved_by, reserved_at, updated_at)
SELECT v.id, v.number, v.status, v.waiter_id, fx.rid, v.rname, v.rarrival, v.rby, v.rat, '2026-01-01'::timestamptz
  FROM fx, (VALUES
    ('35000000-0000-0000-0000-000000000001'::uuid, 9501, 'kitchen',   (SELECT waiter_a FROM fx), NULL, NULL::timestamptz, NULL::uuid, NULL::timestamptz),
    ('35000000-0000-0000-0000-000000000002'::uuid, 9502, 'served',    (SELECT waiter_a FROM fx), NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000003'::uuid, 9503, 'available', NULL,                      NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000004'::uuid, 9504, 'reserved',  NULL,                      'Ana', now() + interval '1 hour', (SELECT waiter_b FROM fx), now()),
    ('35000000-0000-0000-0000-000000000005'::uuid, 9505, 'occupied',  (SELECT waiter_a FROM fx), NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000006'::uuid, 9506, 'kitchen',   (SELECT waiter_b FROM fx), NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000007'::uuid, 9507, 'delivered', (SELECT waiter_a FROM fx), NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000008'::uuid, 9508, 'available', NULL,                      NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000009'::uuid, 9509, 'available', (SELECT waiter_a FROM fx), NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000010'::uuid, 9510, 'available', NULL,                      NULL, NULL, NULL, NULL),
    ('35000000-0000-0000-0000-000000000011'::uuid, 9511, 'occupied',  (SELECT waiter_a FROM fx), NULL, NULL, NULL, NULL)
  ) AS v(id, number, status, waiter_id, rname, rarrival, rby, rat);

INSERT INTO public.orders (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, total, waiter_id, created_at)
SELECT v.id, fx.rid, v.table_id, v.status, 0, 0, 0, 0, v.waiter_id, v.created_at
  FROM fx, (VALUES
    -- 9501: only a paid order -> no open order.
    ('35000000-0000-0000-0000-0000000000a1'::uuid, '35000000-0000-0000-0000-000000000001'::uuid, 'paid',      (SELECT waiter_a FROM fx), now() - interval '1 hour'),
    -- 9503: an older active and a newer delivered order -> served.
    ('35000000-0000-0000-0000-0000000000a3'::uuid, '35000000-0000-0000-0000-000000000003'::uuid, 'active',    (SELECT waiter_a FROM fx), now() - interval '2 hours'),
    ('35000000-0000-0000-0000-0000000000a4'::uuid, '35000000-0000-0000-0000-000000000003'::uuid, 'delivered', (SELECT waiter_b FROM fx), now() - interval '1 hour'),
    -- 9504: an active order -> occupied.
    ('35000000-0000-0000-0000-0000000000a5'::uuid, '35000000-0000-0000-0000-000000000004'::uuid, 'active',    (SELECT waiter_a FROM fx), now()),
    -- 9506: kitchen order agrees.
    ('35000000-0000-0000-0000-0000000000a6'::uuid, '35000000-0000-0000-0000-000000000006'::uuid, 'kitchen',   (SELECT waiter_b FROM fx), now()),
    -- 9507: only a cancelled order -> no open order.
    ('35000000-0000-0000-0000-0000000000a7'::uuid, '35000000-0000-0000-0000-000000000007'::uuid, 'cancelled', (SELECT waiter_a FROM fx), now()),
    -- 9508: a kitchen order -> kitchen.
    ('35000000-0000-0000-0000-0000000000a8'::uuid, '35000000-0000-0000-0000-000000000008'::uuid, 'kitchen',   (SELECT waiter_a FROM fx), now()),
    -- 9509: an active order of another waiter -> occupied, the table keeps its waiter.
    ('35000000-0000-0000-0000-0000000000a9'::uuid, '35000000-0000-0000-0000-000000000009'::uuid, 'active',    (SELECT waiter_b FROM fx), now()),
    -- 9511: occupied with a kitchen order -> untouched.
    ('35000000-0000-0000-0000-0000000000b1'::uuid, '35000000-0000-0000-0000-000000000011'::uuid, 'kitchen',   (SELECT waiter_a FROM fx), now())
  ) AS v(id, table_id, status, waiter_id, created_at);

-- An open delivery order has no table: it repairs nothing (9510, no orders, stays untouched).
INSERT INTO public.orders (id, restaurant_id, table_id, order_type, status, subtotal, tax, tax_percentage, total)
SELECT '35000000-0000-0000-0000-0000000000b2'::uuid, fx.rid, NULL, 'delivery', 'kitchen', 0, 0, 0, 0 FROM fx;

-- A second restaurant: its kitchen table without an order is repaired too.
INSERT INTO public.restaurants (id, slug, name)
VALUES ('35000000-0000-4000-8000-0000000000ff', 'repair-b', 'Repair B');
INSERT INTO public.tables (id, number, status, restaurant_id, updated_at)
VALUES ('35000000-0000-0000-0000-0000000000f1', 9601, 'kitchen', '35000000-0000-4000-8000-0000000000ff', '2026-01-01');

SELECT cmp_ok(public.repair_table_status(), '>=', 8, 'the repair reports at least the eight divergent rows');

SELECT is((SELECT (status, waiter_id IS NULL, updated_at > '2026-01-01') FROM public.tables WHERE number = 9501 AND restaurant_id = (SELECT rid FROM fx)),
  ('available'::varchar, true, true), 'kitchen without an open order becomes available with no waiter');
SELECT is((SELECT (status, waiter_id IS NULL, updated_at > '2026-01-01') FROM public.tables WHERE number = 9502 AND restaurant_id = (SELECT rid FROM fx)),
  ('available'::varchar, true, true), 'served without an open order becomes available with no waiter');
SELECT is((SELECT status FROM public.tables WHERE number = 9503 AND restaurant_id = (SELECT rid FROM fx)),
  'served', 'available with a newer delivered order becomes served');
SELECT is((SELECT waiter_id FROM public.tables WHERE number = 9503 AND restaurant_id = (SELECT rid FROM fx)),
  (SELECT waiter_b FROM fx), 'a table without waiter takes the waiter of the newest open order');
SELECT is((SELECT status FROM public.tables WHERE number = 9504 AND restaurant_id = (SELECT rid FROM fx)),
  'occupied', 'reserved with an active order becomes occupied');
SELECT is((SELECT (reservation_name, reservation_arrival_at, reserved_by, reserved_at) IS NULL FROM public.tables WHERE number = 9504 AND restaurant_id = (SELECT rid FROM fx)),
  true, 'leaving reserved clears every reservation field');
SELECT is((SELECT (status, waiter_id, updated_at) FROM public.tables WHERE number = 9505 AND restaurant_id = (SELECT rid FROM fx)),
  ('occupied'::varchar, (SELECT waiter_a FROM fx), '2026-01-01'::timestamptz), 'an occupied table is untouched');
SELECT is((SELECT (status, waiter_id, updated_at) FROM public.tables WHERE number = 9506 AND restaurant_id = (SELECT rid FROM fx)),
  ('kitchen'::varchar, (SELECT waiter_b FROM fx), '2026-01-01'::timestamptz), 'an agreeing kitchen table is untouched');

SELECT is((SELECT (status, waiter_id IS NULL) FROM public.tables WHERE number = 9507 AND restaurant_id = (SELECT rid FROM fx)),
  ('available'::varchar, true), 'a delivered table status with only a cancelled order becomes available');
SELECT is((SELECT status FROM public.tables WHERE number = 9508 AND restaurant_id = (SELECT rid FROM fx)),
  'kitchen', 'available with a kitchen order becomes kitchen');
SELECT is((SELECT (status, waiter_id) FROM public.tables WHERE number = 9509 AND restaurant_id = (SELECT rid FROM fx)),
  ('occupied'::varchar, (SELECT waiter_a FROM fx)), 'a table with a waiter keeps it when it takes the order status');
SELECT is((SELECT (status, updated_at) FROM public.tables WHERE number = 9510 AND restaurant_id = (SELECT rid FROM fx)),
  ('available'::varchar, '2026-01-01'::timestamptz), 'an available table without orders is untouched by an open delivery order');
SELECT is((SELECT (status, waiter_id, updated_at) FROM public.tables WHERE number = 9511 AND restaurant_id = (SELECT rid FROM fx)),
  ('occupied'::varchar, (SELECT waiter_a FROM fx), '2026-01-01'::timestamptz), 'an occupied table with an open order is untouched');
SELECT is((SELECT status FROM public.tables WHERE id = '35000000-0000-0000-0000-0000000000f1'),
  'available', 'a kitchen table of another restaurant without an order becomes available');

SELECT is(public.repair_table_status(), 0, 'a second run repairs nothing (idempotent)');
SELECT is((SELECT count(*)::int FROM public.tables t
            WHERE (t.status IN ('kitchen', 'served', 'delivered')
                   AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = t.id AND o.status IN ('active', 'kitchen', 'delivered')))
               OR (t.status IN ('available', 'reserved')
                   AND EXISTS (SELECT 1 FROM public.orders o WHERE o.table_id = t.id AND o.status IN ('active', 'kitchen', 'delivered')))),
  0, 'no table contradicts its orders in any restaurant');
SELECT is((SELECT count(*)::int FROM public.tables WHERE (status = 'reserved') <> (reservation_name IS NOT NULL)), 0,
  'tables_reservation_check still holds');

SELECT * FROM finish();
ROLLBACK;
