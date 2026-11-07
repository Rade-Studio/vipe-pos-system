-- Stations and routing (odd/tasks/fase3-operacion.md F6, L10, L11, migration 0020).
--
-- public.stations per restaurant (prep stations plus one fixed cashier
-- station, "Caja"); categories.station_id is the default route and
-- dishes.station_id an exception; each new order line stores the station it
-- resolved to (dish -> category -> the default prep station, flagged
-- 'fallback'); public.delete_station moves the routes in the same
-- transaction; business_config printing_enabled.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(70);

-- ============================================
-- 1. Schema
-- ============================================
SELECT has_table('public', 'stations', 'public.stations exists');
SELECT columns_are('public', 'stations',
  ARRAY['id', 'restaurant_id', 'name', 'kind', 'color', 'sort_order', 'is_default', 'created_at', 'updated_at'],
  'stations has exactly the routing columns');
SELECT col_default_is('public', 'stations', 'restaurant_id', 'private.current_restaurant_id()', 'stations.restaurant_id defaults to the caller tenant');
SELECT col_default_is('public', 'stations', 'kind', 'prep', 'stations.kind defaults to prep');
SELECT col_default_is('public', 'stations', 'is_default', 'false', 'stations.is_default defaults to false');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stations'::regclass), 'stations has row level security enabled');
SELECT policies_are('public', 'stations',
  ARRAY['stations_select_policy', 'stations_insert_policy', 'stations_update_policy'],
  'stations has select, insert and update policies (no delete: public.delete_station)');
SELECT fk_ok('public', 'categories', ARRAY['restaurant_id', 'station_id'], 'public', 'stations', ARRAY['restaurant_id', 'id'],
  'a category routes to a station of its own restaurant');
SELECT fk_ok('public', 'dishes', ARRAY['restaurant_id', 'station_id'], 'public', 'stations', ARRAY['restaurant_id', 'id'],
  'a dish exception routes to a station of its own restaurant');
SELECT fk_ok('public', 'order_items', ARRAY['restaurant_id', 'station_id'], 'public', 'stations', ARRAY['restaurant_id', 'id'],
  'an order line stores a station of its own restaurant');
SELECT fk_ok('public', 'print_jobs', ARRAY['restaurant_id', 'station_id'], 'public', 'stations', ARRAY['restaurant_id', 'id'],
  'a print job is tagged with a station of its own restaurant');
SELECT col_is_null('public', 'order_items', 'station_source', 'order_items.station_source is nullable (no stations)');
SELECT ok(has_function_privilege('vipe_api', 'public.delete_station(uuid, uuid)', 'EXECUTE'), 'vipe_api may call public.delete_station');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.route_dish_in(uuid, uuid)', 'EXECUTE'), 'the restaurant-keyed resolver is not callable by vipe_api');

-- ============================================
-- Fixtures: restaurants A and B; admin and waiter in A, admin in B.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('30000000-0000-0000-0000-0000000000a1', 't300-a', 'T300 A'),
  ('30000000-0000-0000-0000-0000000000b2', 't300-b', 'T300 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('30000000-0000-0000-0000-000000000001', 'admin@t300a.test', 'h'),
  ('30000000-0000-0000-0000-000000000002', 'waiter@t300a.test', 'h'),
  ('30000000-0000-0000-0000-000000000003', 'admin@t300b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('30100000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t300a.test', 'admin', true, '30000000-0000-0000-0000-0000000000a1'),
  ('30100000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Waiter A', 'waiter@t300a.test', 'waiter', true, '30000000-0000-0000-0000-0000000000a1'),
  ('30100000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Admin B', 'admin@t300b.test', 'admin', true, '30000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, name, icon, restaurant_id) VALUES
  ('30200000-0000-0000-0000-0000000000a1', 'Platos fuertes', 'beef', '30000000-0000-0000-0000-0000000000a1'),
  ('30200000-0000-0000-0000-0000000000a2', 'Bebidas', 'water', '30000000-0000-0000-0000-0000000000a1'),
  ('30200000-0000-0000-0000-0000000000a3', 'Especiales', 'star', '30000000-0000-0000-0000-0000000000a1'),
  ('30200000-0000-0000-0000-0000000000b1', 'Bebidas', 'water', '30000000-0000-0000-0000-0000000000b2');
INSERT INTO public.dishes (id, name, price, category_id, restaurant_id) VALUES
  ('30300000-0000-0000-0000-0000000000a1', 'Bandeja paisa', 30000, '30200000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1'),
  ('30300000-0000-0000-0000-0000000000a2', 'Jugo de lulo', 8000, '30200000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a1'),
  ('30300000-0000-0000-0000-0000000000a3', 'Limonada de coco', 9000, '30200000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a1'),
  ('30300000-0000-0000-0000-0000000000a4', 'Lechona', 25000, '30200000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-0000000000a1'),
  ('30300000-0000-0000-0000-0000000000b1', 'Gaseosa', 5000, '30200000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b2');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
  ('30400000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, '30000000-0000-0000-0000-0000000000a1');

-- ============================================
-- 2. No stations: lines keep no station (today's behaviour)
-- ============================================
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, restaurant_id) VALUES
  ('30500000-0000-0000-0000-000000000001', '30400000-0000-0000-0000-0000000000a1', '30300000-0000-0000-0000-0000000000a1', 'Bandeja paisa', 30000, 1, '30000000-0000-0000-0000-0000000000a1');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000001'),
  row(NULL::uuid, NULL::text)::text, 'without stations a new line has no station and no source');

-- ============================================
-- 3. Stations as the admin of A (RLS, defaults, constraints)
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '30000000-0000-0000-0000-000000000001', true);
SELECT lives_ok($$ INSERT INTO public.stations (id, name, color, sort_order) VALUES
  ('30600000-0000-0000-0000-000000000001', 'Cocina', 'kitchen', 0) $$, 'the admin creates Cocina');
SELECT is((SELECT is_default FROM public.stations WHERE id = '30600000-0000-0000-0000-000000000001'), true,
  'the first prep station becomes the default (fallback) station');
SELECT lives_ok($$ INSERT INTO public.stations (id, name, color, sort_order) VALUES
  ('30600000-0000-0000-0000-000000000002', 'Barra', 'served', 1),
  ('30600000-0000-0000-0000-000000000003', 'Postres', 'free', 2) $$, 'the admin creates Barra and Postres');
SELECT is((SELECT count(*) FROM public.stations WHERE is_default)::int, 1, 'only one default station per restaurant');
SELECT lives_ok($$ INSERT INTO public.stations (id, name, kind, color, sort_order) VALUES
  ('30600000-0000-0000-0000-000000000009', 'Caja', 'cashier', 'occupied', 9) $$, 'the admin creates the Caja station');
SELECT is((SELECT is_default FROM public.stations WHERE id = '30600000-0000-0000-0000-000000000009'), false, 'Caja is never the default');
SELECT throws_ok($$ INSERT INTO public.stations (name, kind, color) VALUES ('Caja 2', 'cashier', 'occupied') $$,
  '23505', NULL, 'a restaurant has at most one cashier station');
SELECT throws_ok($$ INSERT INTO public.stations (name, color) VALUES ('cocina', 'kitchen') $$,
  '23505', NULL, 'station names are unique per restaurant, case-insensitively');
SELECT throws_ok($$ INSERT INTO public.stations (name, color) VALUES ('   ', 'kitchen') $$,
  '23514', NULL, 'a blank station name is refused');
SELECT throws_ok($$ INSERT INTO public.stations (name, color) VALUES ('Horno', 'pink') $$,
  '23514', NULL, 'a colour outside the token set is refused');
SELECT throws_ok($$ INSERT INTO public.stations (name, kind, color) VALUES ('Bodega', 'storage', 'kitchen') $$,
  '23514', NULL, 'a kind other than prep or cashier is refused');
SELECT throws_ok($$ INSERT INTO public.stations (name, color, restaurant_id) VALUES ('Intrusa', 'kitchen', '30000000-0000-0000-0000-0000000000b2') $$,
  '42501', NULL, 'an admin cannot create a station in another restaurant');
DELETE FROM public.stations WHERE id = '30600000-0000-0000-0000-000000000003';
SELECT is((SELECT count(*) FROM public.stations)::int, 4, 'a direct DELETE removes no station (no delete policy)');
SELECT throws_ok($$ UPDATE public.stations SET is_default = true WHERE id = '30600000-0000-0000-0000-000000000002' $$,
  '42501', 'stations: managed_column', 'vipe_api cannot move the default station by UPDATE');
SELECT throws_ok($$ UPDATE public.stations SET kind = 'cashier' WHERE id = '30600000-0000-0000-0000-000000000003' $$,
  '42501', 'stations: managed_column', 'vipe_api cannot change a station kind');
SELECT lives_ok($$ UPDATE public.stations SET name = 'Postres y café', color = 'reserved', sort_order = 3 WHERE id = '30600000-0000-0000-0000-000000000003' $$,
  'the admin renames and recolours a station');

-- Routes: category defaults and a dish exception.
SELECT lives_ok($$ UPDATE public.categories SET station_id = '30600000-0000-0000-0000-000000000001' WHERE id = '30200000-0000-0000-0000-0000000000a1' $$,
  'Platos fuertes routes to Cocina');
SELECT lives_ok($$ UPDATE public.categories SET station_id = '30600000-0000-0000-0000-000000000002' WHERE id = '30200000-0000-0000-0000-0000000000a2' $$,
  'Bebidas routes to Barra');
SELECT lives_ok($$ UPDATE public.dishes SET station_id = '30600000-0000-0000-0000-000000000001' WHERE id = '30300000-0000-0000-0000-0000000000a3' $$,
  'Limonada de coco is an exception to Cocina');
SELECT throws_ok($$ UPDATE public.categories SET station_id = '30600000-0000-0000-0000-000000000009' WHERE id = '30200000-0000-0000-0000-0000000000a3' $$,
  '23514', 'route_station: cashier_station', 'a category cannot route to Caja');
SELECT throws_ok($$ UPDATE public.dishes SET station_id = '30600000-0000-0000-0000-000000000009' WHERE id = '30300000-0000-0000-0000-0000000000a4' $$,
  '23514', 'route_station: cashier_station', 'a dish cannot route to Caja');

-- The waiter reads the stations but cannot write them.
SELECT set_config('app.user_id', '30000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*) FROM public.stations)::int, 4, 'a waiter of A reads the four stations of A');
SELECT throws_ok($$ INSERT INTO public.stations (name, color) VALUES ('Parrilla', 'kitchen') $$,
  '42501', NULL, 'a waiter cannot create stations');
UPDATE public.stations SET name = 'X';
SELECT is((SELECT count(*) FROM public.stations WHERE name = 'X')::int, 0, 'a waiter cannot rename stations');
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000003', '30600000-0000-0000-0000-000000000001') $$,
  '42501', 'delete_station: admin_required', 'a waiter cannot delete stations');

-- Admin B sees nothing of A and cannot route to it.
SELECT set_config('app.user_id', '30000000-0000-0000-0000-000000000003', true);
SELECT is((SELECT count(*) FROM public.stations)::int, 0, 'the admin of B sees no station of A');
SELECT throws_ok($$ UPDATE public.categories SET station_id = '30600000-0000-0000-0000-000000000002' WHERE id = '30200000-0000-0000-0000-0000000000b1' $$,
  '23503', NULL, 'B cannot route a category to a station of A');
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000003', NULL) $$,
  'P0002', 'delete_station: station_not_found', 'B cannot delete a station of A');
SELECT is((SELECT count(*) FROM private.route_dishes(ARRAY['30300000-0000-0000-0000-0000000000a1']::uuid[]) WHERE station_id IS NOT NULL)::int, 0,
  'route_dishes gives B no station of A');
RESET ROLE;

-- ============================================
-- 4. Resolution on new lines: dish -> category -> default ('fallback')
-- ============================================
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, restaurant_id) VALUES
  ('30500000-0000-0000-0000-000000000011', '30400000-0000-0000-0000-0000000000a1', '30300000-0000-0000-0000-0000000000a1', 'Bandeja paisa', 30000, 2, '30000000-0000-0000-0000-0000000000a1'),
  ('30500000-0000-0000-0000-000000000012', '30400000-0000-0000-0000-0000000000a1', '30300000-0000-0000-0000-0000000000a2', 'Jugo de lulo', 8000, 2, '30000000-0000-0000-0000-0000000000a1'),
  ('30500000-0000-0000-0000-000000000013', '30400000-0000-0000-0000-0000000000a1', '30300000-0000-0000-0000-0000000000a3', 'Limonada de coco', 9000, 1, '30000000-0000-0000-0000-0000000000a1'),
  ('30500000-0000-0000-0000-000000000014', '30400000-0000-0000-0000-0000000000a1', '30300000-0000-0000-0000-0000000000a4', 'Lechona', 25000, 1, '30000000-0000-0000-0000-0000000000a1');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000011'),
  row('30600000-0000-0000-0000-000000000001'::uuid, 'category')::text, 'a dish without exception takes its category station');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000012'),
  row('30600000-0000-0000-0000-000000000002'::uuid, 'category')::text, 'a drink goes to Barra through Bebidas');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000013'),
  row('30600000-0000-0000-0000-000000000001'::uuid, 'dish')::text, 'the dish exception wins over its category');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000014'),
  row('30600000-0000-0000-0000-000000000001'::uuid, 'fallback')::text, 'a dish of a category without station goes to the default station, flagged fallback');
SELECT is((SELECT row(station_id, station_source)::text FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000001'),
  row(NULL::uuid, NULL::text)::text, 'a line written before the stations keeps no station');
-- A send waits for a delete_station in flight (the exclusive form of the same lock), so it lands on the target.
SELECT ok(EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.mode = 'ShareLock' AND l.granted
    AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('stations:30000000-0000-0000-0000-0000000000a1', 0)),
  'routing a new line holds the shared stations:<restaurant> lock');
SELECT ok(pg_get_functiondef('public.delete_station(uuid, uuid)'::regprocedure) ~ 'FOR NO KEY UPDATE'
    AND pg_get_functiondef('public.delete_station(uuid, uuid)'::regprocedure) !~ '\mFOR UPDATE\M',
  'delete_station locks its stations FOR NO KEY UPDATE (no 40P01 with the FK share locks of route writes)');

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '30000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT array_agg(row(dish_id, station_id, source)::text ORDER BY dish_id) FROM private.route_dishes(ARRAY[
    '30300000-0000-0000-0000-0000000000a2', '30300000-0000-0000-0000-0000000000a3', '30300000-0000-0000-0000-0000000000a4']::uuid[])),
  ARRAY[row('30300000-0000-0000-0000-0000000000a2'::uuid, '30600000-0000-0000-0000-000000000002'::uuid, 'category')::text,
        row('30300000-0000-0000-0000-0000000000a3'::uuid, '30600000-0000-0000-0000-000000000001'::uuid, 'dish')::text,
        row('30300000-0000-0000-0000-0000000000a4'::uuid, '30600000-0000-0000-0000-000000000001'::uuid, 'fallback')::text],
  'route_dishes resolves with the same rule for the caller restaurant');
SELECT throws_ok($$ UPDATE public.order_items SET station_id = '30600000-0000-0000-0000-000000000002' WHERE id = '30500000-0000-0000-0000-000000000014' $$,
  '42501', 'order_items: station_is_stored', 'vipe_api cannot rewrite the station of a line');
SELECT lives_ok($$ INSERT INTO public.print_jobs (kind, payload, station_id) VALUES ('command', '{}'::jsonb, '30600000-0000-0000-0000-000000000002') $$,
  'a print job is tagged with its station');

-- ============================================
-- 5. delete_station moves the routes in the same transaction
-- ============================================
SELECT set_config('app.user_id', '30000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000009', '30600000-0000-0000-0000-000000000001') $$,
  'P0001', 'delete_station: cashier_station', 'Caja cannot be deleted');
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000002', NULL) $$,
  '22023', 'delete_station: move_required', 'deleting a station while others exist needs a target');
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000002', '30600000-0000-0000-0000-000000000009') $$,
  '22023', 'delete_station: target_invalid', 'the routes cannot move to Caja');
SELECT throws_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000002', '30600000-0000-0000-0000-000000000002') $$,
  '22023', 'delete_station: target_invalid', 'the routes cannot move to the station being deleted');
SELECT lives_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000002', '30600000-0000-0000-0000-000000000003') $$,
  'Barra is deleted, its routes moving to Postres');
SELECT is((SELECT station_id FROM public.categories WHERE id = '30200000-0000-0000-0000-0000000000a2'),
  '30600000-0000-0000-0000-000000000003'::uuid, 'Bebidas now routes to Postres');
SELECT is((SELECT station_id FROM public.order_items WHERE id = '30500000-0000-0000-0000-000000000012'),
  '30600000-0000-0000-0000-000000000003'::uuid, 'the open line of Barra moved to Postres');
SELECT is((SELECT station_id FROM public.print_jobs WHERE payload = '{}'::jsonb), NULL::uuid, 'its print jobs lose the station tag');
SELECT lives_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000001', '30600000-0000-0000-0000-000000000003') $$,
  'the default station Cocina is deleted into Postres');
SELECT is((SELECT array_agg(name ORDER BY name) FROM public.stations WHERE is_default), ARRAY['Postres y café'], 'the target becomes the default station');
SELECT is((SELECT station_id FROM public.dishes WHERE id = '30300000-0000-0000-0000-0000000000a3'),
  '30600000-0000-0000-0000-000000000003'::uuid, 'the dish exception moved too');
SELECT lives_ok($$ SELECT public.delete_station('30600000-0000-0000-0000-000000000003', NULL) $$,
  'the last prep station is deleted without a target');
SELECT is((SELECT count(*) FROM public.categories WHERE station_id IS NOT NULL)::int + (SELECT count(*) FROM public.dishes WHERE station_id IS NOT NULL)::int, 0,
  'with no prep station left, no route remains');
SELECT is((SELECT count(*) FROM public.order_items WHERE station_id IS NOT NULL OR station_source IS NOT NULL)::int, 0,
  'and no line keeps a station');

-- ============================================
-- 6. printing_enabled
-- ============================================
SELECT lives_ok($$ INSERT INTO public.business_config (key, value) VALUES ('printing_enabled', 'false') $$, 'the admin turns printing off');
SELECT throws_ok($$ UPDATE public.business_config SET value = 'maybe' WHERE key = 'printing_enabled' $$,
  '23514', NULL, 'printing_enabled is true or false');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
