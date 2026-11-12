-- Informe Z (odd/tasks/caja-cierres.md T4, S8, S9, migration 0029).
-- public.z_reports keeps one numbered, immutable snapshot per restaurant and
-- business day: number unique per restaurant, business_day unique per
-- restaurant, emitted_by an admin of the same restaurant (ON DELETE SET
-- NULL), emitted_at from the server clock. vipe_api reads its restaurant's
-- rows and only an admin inserts; nobody updates or deletes through the API.
-- business_config accepts tax_type INC or IVA only.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(22);

-- ============================================
-- 1. Table, columns and grants
-- ============================================
SELECT has_table('public', 'z_reports', 'public.z_reports exists');
SELECT col_type_is('public', 'z_reports', 'number', 'integer', 'z_reports.number is an integer');
SELECT col_type_is('public', 'z_reports', 'business_day', 'date', 'z_reports.business_day is a date');
SELECT col_type_is('public', 'z_reports', 'snapshot', 'jsonb', 'z_reports.snapshot is jsonb');
SELECT col_type_is('public', 'z_reports', 'emitted_at', 'timestamp with time zone', 'z_reports.emitted_at is a timestamptz');
SELECT col_default_is('public', 'z_reports', 'emitted_at', 'now()', 'emitted_at defaults to the server clock');
SELECT fk_ok('public', 'z_reports', ARRAY['restaurant_id', 'emitted_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'a Z references its emitter through (restaurant_id, emitted_by)');
SELECT ok(
  has_table_privilege('vipe_api', 'public.z_reports', 'SELECT') AND has_table_privilege('vipe_api', 'public.z_reports', 'INSERT'),
  'vipe_api reads and inserts Zs');
SELECT ok(
  NOT has_table_privilege('vipe_api', 'public.z_reports', 'UPDATE') AND NOT has_table_privilege('vipe_api', 'public.z_reports', 'DELETE'),
  'vipe_api never updates or deletes a Z');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.z_reports'::regclass), 'z_reports has row level security');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('38000000-0000-0000-0000-0000000000a1', 't380-a', 'T380 A'),
  ('38000000-0000-0000-0000-0000000000b2', 't380-b', 'T380 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('38000000-0000-0000-0000-000000000001', 'admin@t380a.test', 'h'),
  ('38000000-0000-0000-0000-000000000002', 'admin@t380b.test', 'h'),
  ('38000000-0000-0000-0000-000000000003', 'cashier@t380a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('38100000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t380a.test', 'admin', true, '38000000-0000-0000-0000-0000000000a1'),
  ('38100000-0000-0000-0000-000000000002', '38000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t380b.test', 'admin', true, '38000000-0000-0000-0000-0000000000b2'),
  ('38100000-0000-0000-0000-000000000003', '38000000-0000-0000-0000-000000000003', 'Cajero A', 'cashier@t380a.test', 'cashier', true, '38000000-0000-0000-0000-0000000000a1');
INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot, emitted_by) VALUES
  ('38000000-0000-0000-0000-0000000000a1', 1, '2026-11-10', '{}', '38100000-0000-0000-0000-000000000001'),
  ('38000000-0000-0000-0000-0000000000b2', 1, '2026-11-10', '{}', '38100000-0000-0000-0000-000000000002');

-- ============================================
-- 3. Rules
-- ============================================
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot) VALUES ('38000000-0000-0000-0000-0000000000a1', 1, '2026-11-11', '{}') $$,
  '23505', NULL, 'a number is used once per restaurant');
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot) VALUES ('38000000-0000-0000-0000-0000000000a1', 2, '2026-11-10', '{}') $$,
  '23505', NULL, 'a business day gets one Z per restaurant');
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot) VALUES ('38000000-0000-0000-0000-0000000000a1', 0, '2026-11-12', '{}') $$,
  '23514', NULL, 'numbers start at 1');
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot, emitted_by) VALUES ('38000000-0000-0000-0000-0000000000a1', 3, '2026-11-13', '{}', '38100000-0000-0000-0000-000000000002') $$,
  '23503', NULL, 'a profile of another restaurant cannot be the emitter');
DELETE FROM public.profiles WHERE id = '38100000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT row(emitted_by, restaurant_id, number)::text FROM public.z_reports WHERE restaurant_id = '38000000-0000-0000-0000-0000000000a1' AND number = 1),
  '(,38000000-0000-0000-0000-0000000000a1,1)',
  'deleting the emitter clears emitted_by and keeps the Z');

SELECT throws_ok(
  $$ INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('38000000-0000-0000-0000-0000000000a1', 'tax_type', 'iva') $$,
  '23514', NULL, 'a tax type other than INC or IVA is refused');
SELECT lives_ok(
  $$ INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('38000000-0000-0000-0000-0000000000a1', 'tax_type', 'IVA') $$,
  'tax type IVA is accepted');

-- ============================================
-- 4. RLS as vipe_api
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '38000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.z_reports), 1, 'an admin sees only the Zs of their restaurant');
SELECT lives_ok(
  $$ INSERT INTO public.z_reports (number, business_day, snapshot) VALUES (2, '2026-11-11', '{}') $$,
  'an admin inserts a Z of their restaurant (restaurant and emitter by default)');
SELECT is(
  (SELECT emitted_by::text FROM public.z_reports WHERE number = 2),
  '38100000-0000-0000-0000-000000000002',
  'emitted_by defaults to the caller');
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot) VALUES ('38000000-0000-0000-0000-0000000000a1', 9, '2026-11-20', '{}') $$,
  '42501', NULL, 'an admin cannot insert a Z for another restaurant');
SELECT set_config('app.user_id', '38000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$ INSERT INTO public.z_reports (number, business_day, snapshot) VALUES (5, '2026-11-21', '{}') $$,
  '42501', NULL, 'a cashier cannot emit a Z');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
