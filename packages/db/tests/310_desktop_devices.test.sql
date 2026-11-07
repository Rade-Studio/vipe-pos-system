-- Desktop devices (odd/tasks/fase3-operacion.md F5a, L34, migration 0021).
--
-- The VIPE desktop app pairs with a 6-digit code, then authenticates with a
-- device token (only its sha256 is stored). Every device entry point is a
-- SECURITY DEFINER function keyed by the token hash that re-checks revoked_at.
-- Pending jobs: the device's restaurant, created at or after the device, not
-- acked by it, with no station or a station its printers serve.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(93);

-- ============================================
-- 1. Schema and grants
-- ============================================
SELECT has_table('public', 'desktop_devices', 'public.desktop_devices exists');
SELECT has_table('public', 'desktop_pairing_codes', 'public.desktop_pairing_codes exists');
SELECT has_table('public', 'desktop_printers', 'public.desktop_printers exists');
SELECT has_table('public', 'desktop_printer_stations', 'public.desktop_printer_stations exists');
SELECT has_table('public', 'desktop_job_acks', 'public.desktop_job_acks exists');
SELECT has_table('public', 'desktop_drawer_events', 'public.desktop_drawer_events exists');
SELECT has_table('public', 'desktop_releases', 'public.desktop_releases exists');
SELECT has_table('private', 'desktop_pairing_attempts', 'private.desktop_pairing_attempts exists');
SELECT is(
  (SELECT count(*)::int FROM pg_class
    WHERE oid IN ('public.desktop_devices'::regclass, 'public.desktop_pairing_codes'::regclass, 'public.desktop_printers'::regclass,
                  'public.desktop_printer_stations'::regclass, 'public.desktop_job_acks'::regclass,
                  'public.desktop_drawer_events'::regclass, 'public.desktop_releases'::regclass,
                  'private.desktop_pairing_attempts'::regclass)
      AND relrowsecurity),
  8, 'every desktop table has row level security enabled');
SELECT ok(NOT has_column_privilege('vipe_api', 'public.desktop_devices', 'token_hash', 'SELECT'), 'vipe_api cannot read desktop_devices.token_hash');
SELECT ok(has_column_privilege('vipe_api', 'public.desktop_devices', 'name', 'SELECT'), 'vipe_api reads desktop_devices.name');
SELECT ok(has_column_privilege('vipe_api', 'public.desktop_devices', 'name', 'UPDATE')
  AND has_column_privilege('vipe_api', 'public.desktop_devices', 'revoked_at', 'UPDATE'), 'vipe_api may update name and revoked_at');
SELECT ok(NOT has_column_privilege('vipe_api', 'public.desktop_devices', 'token_hash', 'UPDATE')
  AND NOT has_column_privilege('vipe_api', 'public.desktop_devices', 'restaurant_id', 'UPDATE'), 'vipe_api cannot rewrite token_hash or the tenant');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.desktop_devices', 'INSERT,DELETE,TRUNCATE'), 'vipe_api cannot insert or delete devices');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.desktop_pairing_codes', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_column_privilege('vipe_api', 'public.desktop_pairing_codes', 'code_hash', 'SELECT'), 'vipe_api has no grant on pairing codes');
SELECT ok(NOT has_table_privilege('vipe_api', 'private.desktop_pairing_attempts', 'SELECT,INSERT,UPDATE,DELETE'), 'vipe_api has no grant on pairing attempts');
SELECT ok(has_table_privilege('vipe_api', 'public.desktop_printers', 'SELECT')
  AND has_table_privilege('vipe_api', 'public.desktop_printer_stations', 'SELECT')
  AND has_table_privilege('vipe_api', 'public.desktop_drawer_events', 'SELECT')
  AND NOT has_table_privilege('vipe_api', 'public.desktop_printers', 'INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('vipe_api', 'public.desktop_printer_stations', 'INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('vipe_api', 'public.desktop_drawer_events', 'INSERT,UPDATE,DELETE'),
  'printers, printer stations and drawer events are read-only for vipe_api');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.desktop_job_acks', 'SELECT,INSERT,UPDATE,DELETE'), 'vipe_api has no grant on job acks');
SELECT ok(has_table_privilege('vipe_api', 'public.desktop_releases', 'SELECT')
  AND NOT has_table_privilege('vipe_api', 'public.desktop_releases', 'INSERT,UPDATE,DELETE'), 'releases are read-only for vipe_api');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'desktop%' AND has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'PUBLIC executes no desktop function');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.desktop_live_device(text)', 'EXECUTE')
  AND has_function_privilege('vipe_api', 'private.desktop_touch(text)', 'EXECUTE'), 'vipe_api calls the entry points, not the internal helper');

-- ============================================
-- Fixtures: A with Cocina (default), Barra and Caja; B with Cocina B.
-- Devices: D1, D2 and a revoked D4 in A, D3 in B, all created an hour ago.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('31000000-0000-0000-0000-0000000000a1', 't310-a', 'Sede Norte'),
  ('31000000-0000-0000-0000-0000000000b2', 't310-b', 'T310 B');
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('31000000-0000-0000-0000-0000000000a1', 'business_name', 'La Fonda'),
  ('31000000-0000-0000-0000-0000000000a1', 'business_address', 'Calle 1 # 2-3');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('31000000-0000-0000-0000-000000000001', 'admin@t310a.test', 'h'),
  ('31000000-0000-0000-0000-000000000002', 'waiter@t310a.test', 'h'),
  ('31000000-0000-0000-0000-000000000003', 'admin@t310b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('31100000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t310a.test', 'admin', true, '31000000-0000-0000-0000-0000000000a1'),
  ('31100000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', 'Waiter A', 'waiter@t310a.test', 'waiter', true, '31000000-0000-0000-0000-0000000000a1'),
  ('31100000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003', 'Admin B', 'admin@t310b.test', 'admin', true, '31000000-0000-0000-0000-0000000000b2');
INSERT INTO public.stations (id, name, kind, sort_order, restaurant_id) VALUES
  ('31200000-0000-0000-0000-0000000000a1', 'Cocina', 'prep', 0, '31000000-0000-0000-0000-0000000000a1'),
  ('31200000-0000-0000-0000-0000000000a2', 'Barra', 'prep', 1, '31000000-0000-0000-0000-0000000000a1'),
  ('31200000-0000-0000-0000-0000000000a3', 'Caja', 'cashier', 2, '31000000-0000-0000-0000-0000000000a1'),
  ('31200000-0000-0000-0000-0000000000b1', 'Cocina B', 'prep', 0, '31000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, name, icon, sort_order, station_id, restaurant_id) VALUES
  ('31300000-0000-0000-0000-0000000000a1', 'Platos fuertes', 'beef', 0, NULL, '31000000-0000-0000-0000-0000000000a1'),
  ('31300000-0000-0000-0000-0000000000a2', 'Bebidas', 'water', 1, '31200000-0000-0000-0000-0000000000a2', '31000000-0000-0000-0000-0000000000a1'),
  ('31300000-0000-0000-0000-0000000000a3', 'Entradas', 'star', 2, '31200000-0000-0000-0000-0000000000a1', '31000000-0000-0000-0000-0000000000a1');
INSERT INTO public.dishes (id, name, price, category_id, station_id, restaurant_id) VALUES
  ('31400000-0000-0000-0000-0000000000a1', 'Bandeja', 30000, '31300000-0000-0000-0000-0000000000a1', NULL, '31000000-0000-0000-0000-0000000000a1'),
  ('31400000-0000-0000-0000-0000000000a2', 'Lulo', 8000, '31300000-0000-0000-0000-0000000000a2', NULL, '31000000-0000-0000-0000-0000000000a1'),
  ('31400000-0000-0000-0000-0000000000a3', 'Café', 3000, '31300000-0000-0000-0000-0000000000a2', '31200000-0000-0000-0000-0000000000a1', '31000000-0000-0000-0000-0000000000a1');
INSERT INTO public.desktop_devices (id, restaurant_id, name, app_version, token_hash, created_at, revoked_at) VALUES
  ('31500000-0000-0000-0000-0000000000d1', '31000000-0000-0000-0000-0000000000a1', 'Caja PC', '1.0.0', 'hash-d1', now() - interval '1 hour', NULL),
  ('31500000-0000-0000-0000-0000000000d2', '31000000-0000-0000-0000-0000000000a1', 'Cocina PC', '1.0.0', 'hash-d2', now() - interval '1 hour', NULL),
  ('31500000-0000-0000-0000-0000000000d3', '31000000-0000-0000-0000-0000000000b2', 'B PC', '1.0.0', 'hash-d3', now() - interval '1 hour', NULL),
  ('31500000-0000-0000-0000-0000000000d4', '31000000-0000-0000-0000-0000000000a1', 'Vieja', '1.0.0', 'hash-d4', now() - interval '1 hour', now() - interval '1 minute');
INSERT INTO public.desktop_printers (device_id, id, restaurant_id, name, connection, paper_mm, has_drawer) VALUES
  ('31500000-0000-0000-0000-0000000000d1', 'p1', '31000000-0000-0000-0000-0000000000a1', 'Epson', 'usb', 80, true),
  ('31500000-0000-0000-0000-0000000000d2', 'p2', '31000000-0000-0000-0000-0000000000a1', 'Bixolon', 'network', 58, false);
INSERT INTO public.desktop_printer_stations (device_id, printer_id, restaurant_id, station_id) VALUES
  ('31500000-0000-0000-0000-0000000000d1', 'p1', '31000000-0000-0000-0000-0000000000a1', '31200000-0000-0000-0000-0000000000a1'),
  ('31500000-0000-0000-0000-0000000000d2', 'p2', '31000000-0000-0000-0000-0000000000a1', '31200000-0000-0000-0000-0000000000a2');
INSERT INTO public.print_jobs (id, restaurant_id, kind, payload, station_id, created_at) VALUES
  ('31600000-0000-0000-0000-000000000000', '31000000-0000-0000-0000-0000000000a1', 'command', '{"n":0}', NULL, now() - interval '2 hours'),
  ('31600000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-0000000000a1', 'command', '{"n":1}', NULL, now() - interval '30 minutes'),
  ('31600000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-0000000000a1', 'command', '{"n":2}', '31200000-0000-0000-0000-0000000000a1', now() - interval '20 minutes'),
  ('31600000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-0000000000a1', 'command', '{"n":3}', '31200000-0000-0000-0000-0000000000a2', now() - interval '10 minutes'),
  ('31600000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-0000000000a1', 'invoice', '{"n":4}', '31200000-0000-0000-0000-0000000000a3', now() - interval '5 minutes'),
  ('31600000-0000-0000-0000-0000000000b1', '31000000-0000-0000-0000-0000000000b2', 'command', '{"n":5}', NULL, now() - interval '5 minutes');
INSERT INTO public.desktop_pairing_codes (restaurant_id, code_hash, created_at, expires_at) VALUES
  ('31000000-0000-0000-0000-0000000000a1', 'code-expired', now() - interval '20 minutes', now() - interval '10 minutes');

-- ============================================
-- 2. Pairing codes (admin, request transaction)
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '31000000-0000-0000-0000-000000000002', true);
SELECT throws_ok($$ SELECT * FROM private.desktop_create_pairing_code(ARRAY['code-1']) $$,
  '42501', 'desktop_create_pairing_code: admin_required', 'a waiter cannot create a pairing code');
SELECT set_config('app.user_id', '31000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT attempt FROM private.desktop_create_pairing_code(ARRAY['code-1'])), 1, 'an admin creates a code with the first candidate');
SELECT is((SELECT attempt FROM private.desktop_create_pairing_code(ARRAY['code-1', 'code-2'])), 2,
  'a live code hash is not reused: the next candidate is taken');
SELECT throws_ok($$ SELECT * FROM private.desktop_create_pairing_code(ARRAY['code-1', 'code-2']) $$,
  'P0001', 'desktop_create_pairing_code: collision', 'every candidate colliding is an error');
SELECT throws_ok($$ SELECT code_hash FROM public.desktop_pairing_codes $$, '42501', NULL, 'vipe_api cannot read pairing code hashes');
RESET ROLE;
SELECT is((SELECT expires_at - created_at FROM public.desktop_pairing_codes WHERE code_hash = 'code-1'), interval '10 minutes',
  'a code lives 10 minutes');
SELECT is((SELECT count(*)::int FROM public.desktop_pairing_codes WHERE code_hash = 'code-expired'), 0,
  'creating a code deletes the expired unclaimed ones');
INSERT INTO public.desktop_pairing_codes (restaurant_id, code_hash, created_at, expires_at) VALUES
  ('31000000-0000-0000-0000-0000000000a1', 'code-expired', now() - interval '20 minutes', now() - interval '10 minutes');

-- ============================================
-- 3. Preview and claim (no app.user_id), attempt limits
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '', true);
SELECT results_eq(
  $$ SELECT status, restaurant_id, restaurant_name, business_name, business_address FROM private.desktop_pairing_preview('code-1', 'ip:x') $$,
  $$ VALUES ('ok'::text, '31000000-0000-0000-0000-0000000000a1'::uuid, 'Sede Norte'::text, 'La Fonda'::text, 'Calle 1 # 2-3'::text) $$,
  'a live code previews its restaurant and branding');
SELECT is((SELECT status FROM private.desktop_pairing_preview('nope', 'ip:x')), 'invalid', 'an unknown code is invalid');
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-expired', 'ip:x')), 'expired', 'an expired code is expired');
RESET ROLE;
SELECT is((SELECT failures FROM private.desktop_pairing_attempts WHERE key = 'ip:x'), 1, 'only the unknown code counted as a wrong code');
SELECT is((SELECT failures FROM private.desktop_pairing_attempts WHERE key = 'global'), 1, 'the wrong code also counts globally');
SET LOCAL ROLE vipe_api;
SELECT is((SELECT array_agg(s.status) FROM generate_series(1, 5) g CROSS JOIN LATERAL private.desktop_pairing_preview('nope' || g, 'ip:y') s),
  ARRAY['invalid', 'invalid', 'invalid', 'invalid', 'invalid'], 'five wrong codes from one IP are each invalid');
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-1', 'ip:y')), 'attempts', 'after five wrong codes the IP is refused, even a right code');
SELECT is((SELECT status FROM private.desktop_pairing_claim('code-1', 'ip:y', 'PC', 'windows', '1.0.0', 'hash-new')), 'attempts', 'a blocked IP cannot claim');
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-1', 'ip:x')), 'ok', 'another IP still previews');
RESET ROLE;
UPDATE private.desktop_pairing_attempts SET window_started_at = now() - interval '11 minutes' WHERE key = 'ip:y';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-1', 'ip:y')), 'ok', 'the IP window resets after 10 minutes');
RESET ROLE;
UPDATE private.desktop_pairing_attempts SET failures = 100, window_started_at = now() WHERE key = 'global';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-1', 'ip:z')), 'attempts', '100 wrong codes globally refuse every IP');
RESET ROLE;
UPDATE private.desktop_pairing_attempts SET failures = 0 WHERE key = 'global';
SET LOCAL ROLE vipe_api;
SELECT results_eq(
  $$ SELECT status, restaurant_id, channel FROM private.desktop_pairing_claim('code-1', 'ip:x', 'Caja nueva', 'windows', '1.2.0', 'hash-new') $$,
  $$ VALUES ('ok'::text, '31000000-0000-0000-0000-0000000000a1'::uuid, 'stable'::text) $$,
  'claiming a live code creates the device and returns its restaurant and channel');
SELECT is((SELECT status FROM private.desktop_pairing_claim('code-1', 'ip:x', 'Otra', 'windows', '1.2.0', 'hash-other')), 'expired',
  'a claimed code answers expired');
SELECT is((SELECT status FROM private.desktop_pairing_preview('code-1', 'ip:x')), 'expired', 'a claimed code previews as expired');
SELECT is((SELECT status FROM private.desktop_pairing_claim('code-expired', 'ip:x', 'Otra', 'windows', '1.2.0', 'hash-other')), 'expired',
  'an expired code cannot be claimed');
RESET ROLE;
SELECT results_eq(
  $$ SELECT d.name, d.app_version, d.platform, c.claimed_at IS NOT NULL FROM public.desktop_devices d
       JOIN public.desktop_pairing_codes c ON c.device_id = d.id WHERE d.token_hash = 'hash-new' $$,
  $$ VALUES ('Caja nueva'::text, '1.2.0'::text, 'windows'::text, true) $$,
  'the claimed code points at the new device');
SELECT is((SELECT count(*)::int FROM public.desktop_devices WHERE token_hash = 'hash-other'), 0, 'refused claims create no device');

-- ============================================
-- 4. Device identity: touch re-checks revoked_at
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT results_eq($$ SELECT device_id, revoked FROM private.desktop_touch('hash-d1') $$,
  $$ VALUES ('31500000-0000-0000-0000-0000000000d1'::uuid, false) $$, 'a live token resolves to its device');
SELECT results_eq($$ SELECT device_id, revoked FROM private.desktop_touch('hash-d4') $$,
  $$ VALUES ('31500000-0000-0000-0000-0000000000d4'::uuid, true) $$, 'a revoked token is reported as revoked');
SELECT is_empty($$ SELECT * FROM private.desktop_touch('hash-unknown') $$, 'an unknown token resolves to nothing');
RESET ROLE;
SELECT results_eq(
  $$ SELECT (last_seen_at IS NOT NULL) FROM public.desktop_devices WHERE token_hash IN ('hash-d1', 'hash-d4') ORDER BY token_hash $$,
  $$ VALUES (true), (false) $$, 'touch records last_seen_at only for a live device');

-- ============================================
-- 5. Pending jobs: routing, device age, paging, revoked
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d1', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000001'::uuid), ('31600000-0000-0000-0000-000000000002'::uuid) $$,
  'D1 (Cocina) gets the job without station and the Cocina job, oldest first; never a job older than itself');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d2', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000001'::uuid), ('31600000-0000-0000-0000-000000000003'::uuid) $$,
  'D2 (Barra) gets the job without station and the Barra job');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d3', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-0000000000b1'::uuid) $$, 'D3 only sees its own restaurant');
SELECT is_empty($$ SELECT * FROM private.desktop_pending_jobs('hash-new', NULL, 500) $$, 'a device paired now replays no old job');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d1', '31600000-0000-0000-0000-000000000001', 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000002'::uuid) $$, 'after pages by (created_at, id)');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d1', NULL, 1) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000001'::uuid) $$, 'limit bounds the page');
SELECT results_eq(
  $$ SELECT kind, station_id, payload FROM private.desktop_pending_jobs('hash-d1', '31600000-0000-0000-0000-000000000001', 500) $$,
  $$ VALUES ('command'::text, '31200000-0000-0000-0000-0000000000a1'::uuid, '{"n":2}'::jsonb) $$, 'a job carries kind, station and payload');
SELECT throws_ok($$ SELECT * FROM private.desktop_pending_jobs('hash-d4', NULL, 500) $$,
  '42501', 'desktop: device_revoked', 'a revoked device gets nothing');
SELECT throws_ok($$ SELECT * FROM private.desktop_pending_jobs('hash-unknown', NULL, 500) $$,
  '42501', 'desktop: device_revoked', 'an unknown token gets nothing');

-- ============================================
-- 6. Acks: first ack wins, per device, own restaurant only
-- ============================================
SELECT is(private.desktop_ack_job('hash-d1', '31600000-0000-0000-0000-000000000001', 'printed', NULL), true, 'D1 acks a job of its restaurant');
SELECT is(private.desktop_ack_job('hash-d1', '31600000-0000-0000-0000-000000000001', 'skipped', 'again'), true, 'repeating the ack succeeds');
SELECT is(private.desktop_ack_job('hash-d1', '31600000-0000-0000-0000-0000000000b1', 'printed', NULL), false, 'a job of another restaurant is not acked');
SELECT is(private.desktop_ack_job('hash-d1', '31600000-0000-0000-0000-000000000099', 'printed', NULL), false, 'an unknown job is not acked');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d1', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000002'::uuid) $$, 'an acked job stops being pending for that device');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d2', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000001'::uuid), ('31600000-0000-0000-0000-000000000003'::uuid) $$,
  'another device still gets the job without station');
SELECT is(private.desktop_ack_job('hash-d2', '31600000-0000-0000-0000-000000000003', 'cancelled', 'sin papel'), true, 'D2 cancels its job');
SELECT throws_ok($$ SELECT private.desktop_ack_job('hash-d4', '31600000-0000-0000-0000-000000000001', 'printed', NULL) $$,
  '42501', 'desktop: device_revoked', 'a revoked device cannot ack');
RESET ROLE;
SELECT results_eq(
  $$ SELECT status, reason FROM public.desktop_job_acks WHERE job_id = '31600000-0000-0000-0000-000000000001' $$,
  $$ VALUES ('printed'::text, NULL::text) $$, 'the first ack is kept');
SELECT results_eq(
  $$ SELECT id, printed_at IS NOT NULL FROM public.print_jobs WHERE id IN ('31600000-0000-0000-0000-000000000001', '31600000-0000-0000-0000-000000000003') ORDER BY id $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000001'::uuid, true), ('31600000-0000-0000-0000-000000000003'::uuid, false) $$,
  'printed sets print_jobs.printed_at; cancelled does not');

-- ============================================
-- 7. Printers registry, stations, heartbeat, drawer
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ SELECT * FROM private.desktop_put_printers('hash-d1', '[{"id":"p1","name":"Epson","model":"","connection":"usb","paperMm":80,"hasDrawer":true,"stationIds":["31200000-0000-0000-0000-0000000000b1"]}]') $$,
  '22023', 'desktop_put_printers: station_invalid', 'a station of another restaurant is refused');
SELECT throws_ok(
  $$ SELECT * FROM private.desktop_put_printers('hash-d1', (SELECT jsonb_agg(jsonb_build_object('id', 'p' || g, 'name', 'P', 'model', '', 'connection', 'usb', 'paperMm', 80, 'hasDrawer', false, 'stationIds', '[]'::jsonb)) FROM generate_series(1, 21) g)) $$,
  '22023', 'desktop_put_printers: too_many_printers', 'more than 20 printers are refused');
RESET ROLE;
SELECT results_eq($$ SELECT printer_id, station_id FROM public.desktop_printer_stations WHERE device_id = '31500000-0000-0000-0000-0000000000d1' $$,
  $$ VALUES ('p1'::text, '31200000-0000-0000-0000-0000000000a1'::uuid) $$, 'a refused list leaves the stored one');
SET LOCAL ROLE vipe_api;
SELECT results_eq(
  $$ SELECT id, name, connection, paper_mm, has_drawer, station_ids FROM private.desktop_put_printers('hash-d1',
       '[{"id":"p1","name":"Epson","model":"TM-T20","connection":"usb","paperMm":80,"hasDrawer":true,"stationIds":["31200000-0000-0000-0000-0000000000a2","31200000-0000-0000-0000-0000000000a1"]},
         {"id":"p9","name":"Caja","model":"","connection":"bluetooth","paperMm":58,"hasDrawer":false,"stationIds":[]}]') $$,
  $$ VALUES ('p1'::text, 'Epson'::text, 'usb'::text, 80, true, ARRAY['31200000-0000-0000-0000-0000000000a1', '31200000-0000-0000-0000-0000000000a2']::uuid[]),
            ('p9', 'Caja', 'bluetooth', 58, false, '{}'::uuid[]) $$,
  'the list is replaced and returned');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('hash-d1', NULL, 500) $$,
  $$ VALUES ('31600000-0000-0000-0000-000000000002'::uuid), ('31600000-0000-0000-0000-000000000003'::uuid) $$,
  'serving Barra too, D1 now also gets the Barra job');
SELECT results_eq(
  $$ SELECT name, kind, fixed, prints, product_count FROM private.desktop_stations('hash-d1') $$,
  $$ VALUES ('Cocina'::text, 'prep'::text, false, 'Platos fuertes, Entradas'::text, 2),
            ('Barra', 'prep', false, 'Bebidas', 1),
            ('Caja', 'cashier', true, 'Facturas y precuentas', 0) $$,
  'stations with the read-only "Qué imprime" and the dishes routed to each');
SELECT throws_ok($$ SELECT * FROM private.desktop_stations('hash-d4') $$, '42501', 'desktop: device_revoked', 'a revoked device lists no stations');
SELECT results_eq($$ SELECT channel, printing_enabled FROM private.desktop_heartbeat('hash-d1', '1.3.0', '[{"id":"p1","status":"ready"}]', 2, 1) $$,
  $$ VALUES ('stable'::text, true) $$, 'heartbeat answers the default channel and printing on');
RESET ROLE;
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('31000000-0000-0000-0000-0000000000a1', 'desktop_update_channel', 'pilot'),
  ('31000000-0000-0000-0000-0000000000a1', 'printing_enabled', 'false');
SET LOCAL ROLE vipe_api;
SELECT results_eq($$ SELECT channel, printing_enabled FROM private.desktop_heartbeat('hash-d1', '1.3.0', '[]', 0, 0) $$,
  $$ VALUES ('pilot'::text, false) $$, 'heartbeat answers the restaurant channel and printing setting');
SELECT is_empty($$ SELECT * FROM private.desktop_heartbeat('hash-d3', '1.3.0', '[{"id":"x","status":"error","error":"Sin papel"}]', 4, 3) $$
  || ' WHERE channel <> ''stable''', 'B keeps its own channel');
SELECT is(private.desktop_channel('hash-d1'), 'pilot', 'the updates channel follows the restaurant');
SELECT throws_ok($$ SELECT private.desktop_channel('hash-d4') $$, '42501', 'desktop: device_revoked', 'a revoked device has no channel');
SELECT throws_ok($$ SELECT * FROM private.desktop_heartbeat('hash-d4', '1.3.0', '[]', 0, 0) $$, '42501', 'desktop: device_revoked', 'a revoked device cannot heartbeat');
SELECT lives_ok($$ SELECT private.desktop_drawer_event('hash-d1', 'p1', now(), 'manual', '31100000-0000-0000-0000-000000000003') $$, 'a drawer event with a foreign profile is recorded');
SELECT lives_ok($$ SELECT private.desktop_drawer_event('hash-d1', 'p1', now(), 'cash_payment', '31100000-0000-0000-0000-000000000002') $$, 'a drawer event with a staff profile is recorded');
RESET ROLE;
SELECT results_eq($$ SELECT reason, profile_id FROM public.desktop_drawer_events ORDER BY reason DESC $$,
  $$ VALUES ('manual'::text, NULL::uuid), ('cash_payment', '31100000-0000-0000-0000-000000000002'::uuid) $$,
  'a profile of another restaurant is dropped, one of the restaurant kept');
SELECT results_eq($$ SELECT app_version, queue_pending, queue_failed, printer_status FROM public.desktop_devices WHERE token_hash = 'hash-d3' $$,
  $$ VALUES ('1.3.0'::text, 4, 3, '[{"id":"x","status":"error","error":"Sin papel"}]'::jsonb) $$, 'heartbeat stores version, queue and printer status');

-- ============================================
-- 8. Admin reads and revocation (RLS)
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '31000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT count(*)::int FROM public.desktop_devices), 4, 'admin A sees the devices of A only');
SELECT is((SELECT count(*)::int FROM public.desktop_printers), 3, 'admin A sees the printers of A');
SELECT throws_ok($$ SELECT token_hash FROM public.desktop_devices $$, '42501', NULL, 'admin A cannot read token hashes');
UPDATE public.desktop_devices SET revoked_at = now() WHERE id = '31500000-0000-0000-0000-0000000000d2';
SELECT throws_ok($$ SELECT * FROM private.desktop_pending_jobs('hash-d2', NULL, 500) $$, '42501', 'desktop: device_revoked', 'revoking is immediate');
SELECT set_config('app.user_id', '31000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.desktop_devices), 0, 'a waiter sees no device');
UPDATE public.desktop_devices SET name = 'hack' WHERE id = '31500000-0000-0000-0000-0000000000d1';
SELECT set_config('app.user_id', '31000000-0000-0000-0000-000000000003', true);
SELECT is((SELECT count(*)::int FROM public.desktop_devices), 1, 'admin B sees only B');
UPDATE public.desktop_devices SET name = 'hack' WHERE id = '31500000-0000-0000-0000-0000000000d1';
SELECT set_config('app.user_id', '', true);
SELECT is((SELECT count(*)::int FROM public.desktop_releases), 0, 'releases are readable without a user');
RESET ROLE;
SELECT is((SELECT name FROM public.desktop_devices WHERE id = '31500000-0000-0000-0000-0000000000d1'), 'Caja PC', 'neither a waiter nor another admin renames a device');

SELECT * FROM finish();
ROLLBACK;
