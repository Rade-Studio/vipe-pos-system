-- Floor plan: zones and table layout (odd/tasks/rediseno-pos.md, T3, S4).
--
-- public.zones holds each restaurant's floors (name, aspect ratio, order,
-- wall labels); public.tables gains its place on a zone (x, y = centre and
-- w, h normalized 0-1, shape, rotation, optional seats). A table's zone is in
-- the same restaurant (composite foreign key), existing tables land in a
-- default zone "Salón principal", and zones stream through realtime.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(54);

-- ============================================
-- 1. Schema
-- ============================================
SELECT has_table('public', 'zones', 'public.zones exists');
SELECT columns_are('public', 'zones',
  ARRAY['id', 'restaurant_id', 'name', 'aspect', 'sort_order', 'labels', 'active', 'created_at', 'updated_at', 'width_m', 'depth_m'],
  'zones has exactly the floor plan columns');
SELECT col_default_is('public', 'zones', 'restaurant_id', 'private.current_restaurant_id()', 'zones.restaurant_id defaults to the caller tenant');
SELECT col_default_is('public', 'zones', 'aspect', '1.6', 'zones.aspect defaults to 1.6');
SELECT col_default_is('public', 'zones', 'sort_order', '0', 'zones.sort_order defaults to 0');
SELECT col_default_is('public', 'zones', 'labels', '[]'::text, 'zones.labels defaults to an empty array');
SELECT col_not_null('public', 'zones', 'name', 'zones.name is NOT NULL');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.zones'::regclass), 'zones has row level security enabled');
SELECT policies_are('public', 'zones',
  ARRAY['zones_select_policy', 'zones_insert_policy', 'zones_update_policy', 'zones_delete_policy'],
  'zones has the four tenant policies');

SELECT has_column('public', 'tables', 'zone_id', 'tables.zone_id exists');
SELECT col_is_null('public', 'tables', 'zone_id', 'tables.zone_id is nullable');
SELECT col_default_is('public', 'tables', 'shape', 'square', 'tables.shape defaults to square');
SELECT col_default_is('public', 'tables', 'rotation', '0', 'tables.rotation defaults to 0');
SELECT col_is_null('public', 'tables', 'seats', 'tables.seats is nullable (no chairs drawn)');
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tables' AND column_name IN ('x', 'y', 'w', 'h') AND data_type = 'numeric'),
  ARRAY['h', 'w', 'x', 'y'],
  'tables has numeric x, y, w, h');
SELECT fk_ok('public', 'tables', ARRAY['restaurant_id', 'zone_id'], 'public', 'zones', ARRAY['restaurant_id', 'id'],
  'a table references its zone through (restaurant_id, zone_id)');

-- ============================================
-- Fixtures: restaurants A and B, one admin each, A with two unplaced tables.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('22000000-0000-0000-0000-0000000000a1', 't220-a', 'T220 A'),
  ('22000000-0000-0000-0000-0000000000b2', 't220-b', 'T220 B'),
  ('22000000-0000-0000-0000-0000000000c3', 't220-c', 'T220 C');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('22000000-0000-0000-0000-000000000001', 'admin@t220a.test', 'h'),
  ('22000000-0000-0000-0000-000000000002', 'admin@t220b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('22100000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t220a.test', 'admin', true, '22000000-0000-0000-0000-0000000000a1'),
  ('22100000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t220b.test', 'admin', true, '22000000-0000-0000-0000-0000000000b2');
INSERT INTO public.tables (id, number, restaurant_id) VALUES
  ('22200000-0000-0000-0000-000000000001', 1, '22000000-0000-0000-0000-0000000000a1'),
  ('22200000-0000-0000-0000-000000000002', 2, '22000000-0000-0000-0000-0000000000a1'),
  ('22200000-0000-0000-0000-000000000003', 1, '22000000-0000-0000-0000-0000000000b2');
INSERT INTO public.zones (id, restaurant_id, name) VALUES
  ('22300000-0000-0000-0000-0000000000b1', '22000000-0000-0000-0000-0000000000b2', 'Terraza');

-- ============================================
-- 2. Backfill: every table of a restaurant with tables gets a zone
-- ============================================
SELECT lives_ok($$ SELECT private.backfill_default_zones() $$, 'the default zone backfill runs');
SELECT lives_ok($$ SELECT private.backfill_default_zones() $$, 'the backfill runs again (idempotent)');
SELECT is(
  (SELECT count(*) FROM public.tables WHERE zone_id IS NULL)::bigint,
  0::bigint,
  'after the backfill no table is without a zone');
SELECT is(
  (SELECT count(*) FROM public.zones WHERE restaurant_id = '22000000-0000-0000-0000-0000000000a1' AND name = 'Salón principal')::bigint,
  1::bigint,
  'restaurant A got exactly one Salón principal');
SELECT is(
  (SELECT count(*) FROM public.zones WHERE restaurant_id = '22000000-0000-0000-0000-0000000000c3')::bigint,
  0::bigint,
  'a restaurant without tables gets no zone');
SELECT is(
  (SELECT count(DISTINCT (x, y)) FROM public.tables WHERE restaurant_id = '22000000-0000-0000-0000-0000000000a1' AND seats IS NULL
      AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND w > 0 AND h > 0)::bigint,
  2::bigint,
  'backfilled tables sit on distinct grid cells inside the floor with no invented seat count');
SELECT is(
  (SELECT array_agg(number ORDER BY number) FROM public.tables WHERE restaurant_id = '22000000-0000-0000-0000-0000000000a1'),
  ARRAY[1, 2],
  'table numbers are untouched by the backfill');
SELECT is(
  has_function_privilege('vipe_api', 'private.backfill_default_zones()', 'EXECUTE'),
  false,
  'vipe_api cannot run the backfill');

-- ============================================
-- 3. CHECK constraints
-- ============================================
SELECT throws_ok($$ UPDATE public.tables SET x = 1.01 WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'x > 1 is refused');
SELECT throws_ok($$ UPDATE public.tables SET y = -0.01 WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'y < 0 is refused');
SELECT throws_ok($$ UPDATE public.tables SET w = 0 WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'w = 0 is refused');
SELECT throws_ok($$ UPDATE public.tables SET shape = 'oval' WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'an unknown shape is refused');
SELECT throws_ok($$ UPDATE public.tables SET rotation = 360 WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'rotation 360 is refused');
SELECT throws_ok($$ UPDATE public.tables SET seats = 21 WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'seats 21 is refused');
SELECT throws_ok($$ UPDATE public.tables SET rotation = 'NaN' WHERE id = '22200000-0000-0000-0000-000000000001' $$, '23514', NULL, 'rotation NaN is refused');
SELECT throws_ok($$ UPDATE public.zones SET aspect = 4 WHERE id = '22300000-0000-0000-0000-0000000000b1' $$, '23514', NULL, 'aspect 4 is refused');
SELECT throws_ok($$ UPDATE public.zones SET restaurant_id = '22000000-0000-0000-0000-0000000000c3' WHERE restaurant_id = '22000000-0000-0000-0000-0000000000a1' AND name = 'Salón principal' $$, '23503', NULL, 'a zone in use cannot move to another restaurant');
SELECT lives_ok(
  $$ UPDATE public.tables SET shape = 'bar', rotation = 359.5, seats = 0, x = 1, y = 0, w = 1, h = 1 WHERE id = '22200000-0000-0000-0000-000000000001' $$,
  'the boundaries (bar, 359.5, 0 seats, x 1, y 0, w/h 1) are accepted');
SELECT throws_ok($$ INSERT INTO public.zones (restaurant_id, name) VALUES ('22000000-0000-0000-0000-0000000000a1', '  ') $$, '23514', NULL, 'a blank zone name is refused');
SELECT throws_ok($$ INSERT INTO public.zones (restaurant_id, name) VALUES ('22000000-0000-0000-0000-0000000000a1', repeat('x', 41)) $$, '23514', NULL, 'a zone name over 40 characters is refused');
SELECT throws_ok($$ INSERT INTO public.zones (restaurant_id, name, aspect) VALUES ('22000000-0000-0000-0000-0000000000a1', 'Ancha', 4) $$, '23514', NULL, 'aspect 4 is refused');
SELECT throws_ok($$ INSERT INTO public.zones (restaurant_id, name, aspect) VALUES ('22000000-0000-0000-0000-0000000000a1', 'Alta', 0.25) $$, '23514', NULL, 'aspect 0.25 is refused');
SELECT throws_ok(
  $$ INSERT INTO public.zones (restaurant_id, name, labels) VALUES ('22000000-0000-0000-0000-0000000000a1', 'Patio', '[{"text": "Cocina", "side": "up"}]') $$,
  '23514', NULL, 'a wall label with an unknown side is refused');
SELECT throws_ok(
  $$ INSERT INTO public.zones (restaurant_id, name, labels) VALUES ('22000000-0000-0000-0000-0000000000a1', 'Patio', '{"text": "Cocina", "side": "top"}') $$,
  '23514', NULL, 'labels that are not an array are refused');
SELECT lives_ok(
  $$ INSERT INTO public.zones (restaurant_id, name, labels) VALUES ('22000000-0000-0000-0000-0000000000a1', 'Patio', '[{"text": "Ventanal", "side": "top"}, {"text": "Cocina →", "side": "right"}]') $$,
  'valid wall labels are accepted');
SELECT throws_ok(
  $$ INSERT INTO public.zones (restaurant_id, name) VALUES ('22000000-0000-0000-0000-0000000000a1', 'SALÓN PRINCIPAL') $$,
  '23505', NULL, 'zone names are unique per restaurant, case-insensitively');
SELECT lives_ok(
  $$ INSERT INTO public.zones (restaurant_id, name) VALUES ('22000000-0000-0000-0000-0000000000b2', 'Patio') $$,
  'another restaurant may reuse a zone name');

-- ============================================
-- 4. Cross-restaurant zone assignment is refused
-- ============================================
SELECT throws_ok(
  $$ UPDATE public.tables SET zone_id = '22300000-0000-0000-0000-0000000000b1' WHERE id = '22200000-0000-0000-0000-000000000002' $$,
  '23503', NULL, 'a table of A cannot be placed on a zone of B');
SELECT throws_ok(
  $$ DELETE FROM public.zones WHERE restaurant_id = '22000000-0000-0000-0000-0000000000a1' AND name = 'Salón principal' $$,
  '23503', NULL, 'a zone with tables cannot be deleted');

-- ============================================
-- 5. RLS isolation for vipe_api
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.zones)::bigint, 0::bigint, 'without app.user_id vipe_api sees no zones');
SELECT set_config('app.user_id', '22000000-0000-0000-0000-000000000001', true);
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.zones),
  ARRAY['Patio', 'Salón principal'],
  'admin of A sees only the zones of A');
SELECT lives_ok(
  $$ INSERT INTO public.zones (name, sort_order) VALUES ('Barra', 2) $$,
  'admin of A creates a zone in A through the default tenant');
SELECT is(
  (SELECT count(*) FROM public.tables t JOIN public.zones z ON z.id = t.zone_id)::bigint,
  2::bigint,
  'admin of A sees the layout of the tables of A only');
UPDATE public.zones SET name = 'Hackeado' WHERE id = '22300000-0000-0000-0000-0000000000b1';
SELECT throws_ok(
  $$ INSERT INTO public.zones (restaurant_id, name) VALUES ('22000000-0000-0000-0000-0000000000b2', 'Intruso') $$,
  '42501', NULL, 'admin of A cannot create a zone in B');
SELECT set_config('app.user_id', '22000000-0000-0000-0000-000000000002', true);
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.zones),
  ARRAY['Patio', 'Salón principal', 'Terraza'],
  'admin of B sees only the zones of B, untouched by A');
RESET ROLE;

-- ============================================
-- 6. Outsiders and realtime
-- ============================================
SELECT is(has_table_privilege('public', 'public.zones', 'SELECT'), false, 'an outsider (PUBLIC) cannot SELECT zones');
SELECT trigger_is('public', 'zones', 'notify_change', 'private', 'notify_change', 'zones notifies changes');
SELECT is(
  private.realtime_row('zones', '22300000-0000-0000-0000-0000000000b1') ->> 'restaurant_id',
  '22000000-0000-0000-0000-0000000000b2',
  'realtime_row loads a zones row');

SELECT * FROM finish();
ROLLBACK;
