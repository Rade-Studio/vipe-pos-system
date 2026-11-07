-- F5a independent verifier probes (odd/tasks/fase3-operacion.md L34, L36;
-- migration 0021): grants, tenancy, routing, acks, one-way revocation.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(55);

-- 1. Function hygiene
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname LIKE 'desktop\_%'), 14, 'fourteen private.desktop_* functions');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname LIKE 'desktop\_%'
              AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'])), 0,
  'every desktop function is SECURITY DEFINER with search_path empty');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE n.nspname = 'private' AND p.proname LIKE 'desktop\_%' AND a.privilege_type = 'EXECUTE'
              AND a.grantee <> p.proowner AND a.grantee <> 'vipe_api'::regrole), 0,
  'no desktop function is executable by PUBLIC or any role but vipe_api');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname LIKE 'desktop\_%' AND NOT has_function_privilege('vipe_api', p.oid, 'EXECUTE')),
  ARRAY['desktop_live_device', 'desktop_pairing_blocked', 'desktop_pairing_restaurant'],
  'vipe_api cannot call the three internal helpers');
SELECT is((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
            WHERE c.relname LIKE 'desktop\_%' AND c.relkind = 'r' AND a.grantee <> c.relowner AND a.grantee <> 'vipe_api'::regrole), 0,
  'no desktop table is granted to PUBLIC or another role');

-- Fixtures (prefix 99)
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('99000000-0000-0000-0000-0000000000a1', 'v990-a', 'V990 A'), ('99000000-0000-0000-0000-0000000000b2', 'v990-b', 'V990 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('99000000-0000-0000-0000-000000000001', 'admin@v990a.test', 'h'), ('99000000-0000-0000-0000-000000000003', 'admin@v990b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('99100000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001', 'Admin A', 'admin@v990a.test', 'admin', true, '99000000-0000-0000-0000-0000000000a1'),
  ('99100000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000003', 'Admin B', 'admin@v990b.test', 'admin', true, '99000000-0000-0000-0000-0000000000b2');
INSERT INTO public.stations (id, name, kind, sort_order, restaurant_id) VALUES
  ('99200000-0000-0000-0000-0000000000a1', 'Cocina', 'prep', 0, '99000000-0000-0000-0000-0000000000a1'),
  ('99200000-0000-0000-0000-0000000000a2', 'Barra', 'prep', 1, '99000000-0000-0000-0000-0000000000a1'),
  ('99200000-0000-0000-0000-0000000000b1', 'Cocina B', 'prep', 0, '99000000-0000-0000-0000-0000000000b2');
INSERT INTO public.desktop_devices (id, restaurant_id, name, app_version, token_hash, created_at, revoked_at) VALUES
  ('99500000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1', 'A1', '1.0.0', 'v-a1', now() - interval '1 hour', NULL),
  ('99500000-0000-0000-0000-0000000000a2', '99000000-0000-0000-0000-0000000000a1', 'A2 sin impresoras', '1.0.0', 'v-a2', now() - interval '1 hour', NULL),
  ('99500000-0000-0000-0000-0000000000a9', '99000000-0000-0000-0000-0000000000a1', 'A revocado', '1.0.0', 'v-a9', now() - interval '1 hour', now() - interval '1 minute'),
  ('99500000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000b2', 'B1', '1.0.0', 'v-b1', now() - interval '1 hour', NULL);
INSERT INTO public.printer_tokens (id, restaurant_id, name, token_hash) VALUES
  ('99700000-0000-0000-0000-0000000000a1', '99000000-0000-0000-0000-0000000000a1', 'Legacy A', 'vpt-legacy-a');
INSERT INTO public.print_jobs (id, restaurant_id, kind, payload, station_id, created_at) VALUES
  ('99600000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":1}', NULL, now() - interval '30 minutes'),
  ('99600000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":2}', '99200000-0000-0000-0000-0000000000a1', now() - interval '20 minutes'),
  ('99600000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":3}', '99200000-0000-0000-0000-0000000000a2', now() - interval '10 minutes'),
  ('99600000-0000-0000-0000-000000000004', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":4}', NULL, now() - interval '1 hour'),
  ('99600000-0000-0000-0000-000000000005', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":5}', NULL, now() - interval '5 minutes'),
  ('99600000-0000-0000-0000-000000000006', '99000000-0000-0000-0000-0000000000a1', 'command', '{"n":6}', NULL, now() - interval '4 minutes'),
  ('99600000-0000-0000-0000-0000000000b1', '99000000-0000-0000-0000-0000000000b2', 'command', '{"n":"b"}', NULL, now() - interval '5 minutes');
-- job 4 has created_at = the device's created_at (boundary, same now())

-- 2. Direct writes as vipe_api with an admin of A
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '99000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ INSERT INTO public.desktop_devices (restaurant_id, name, app_version, token_hash) VALUES ('99000000-0000-0000-0000-0000000000a1', 'x', '1', 'h') $$, '42501', NULL, 'admin cannot INSERT a device directly');
SELECT throws_ok($$ DELETE FROM public.desktop_devices $$, '42501', NULL, 'admin cannot DELETE devices');
SELECT throws_ok($$ UPDATE public.desktop_devices SET token_hash = 'mine' $$, '42501', NULL, 'admin cannot UPDATE token_hash');
SELECT throws_ok($$ UPDATE public.desktop_devices SET restaurant_id = '99000000-0000-0000-0000-0000000000b2' $$, '42501', NULL, 'admin cannot move a device to another restaurant');
SELECT throws_ok($$ UPDATE public.desktop_devices SET created_at = now() - interval '30 days' $$, '42501', NULL, 'admin cannot back-date a device (replay of old jobs)');
SELECT throws_ok($$ UPDATE public.desktop_devices SET token_hash = token_hash RETURNING token_hash $$, '42501', NULL, 'RETURNING token_hash is refused');
SELECT throws_ok($$ INSERT INTO public.desktop_printers (device_id, id, restaurant_id, name, connection, paper_mm) VALUES ('99500000-0000-0000-0000-0000000000a1', 'x', '99000000-0000-0000-0000-0000000000a1', 'x', 'usb', 80) $$, '42501', NULL, 'admin cannot INSERT printers');
SELECT throws_ok($$ UPDATE public.desktop_printers SET name = 'x' $$, '42501', NULL, 'admin cannot UPDATE printers');
SELECT throws_ok($$ DELETE FROM public.desktop_printer_stations $$, '42501', NULL, 'admin cannot DELETE printer stations');
SELECT throws_ok($$ INSERT INTO public.desktop_printer_stations VALUES ('99500000-0000-0000-0000-0000000000a1', 'x', '99000000-0000-0000-0000-0000000000a1', '99200000-0000-0000-0000-0000000000a1') $$, '42501', NULL, 'admin cannot INSERT printer stations');
SELECT throws_ok($$ SELECT * FROM public.desktop_job_acks $$, '42501', NULL, 'admin cannot read job acks');
SELECT throws_ok($$ INSERT INTO public.desktop_job_acks (job_id, device_id, status) VALUES ('99600000-0000-0000-0000-000000000001', '99500000-0000-0000-0000-0000000000a1', 'printed') $$, '42501', NULL, 'admin cannot forge an ack');
SELECT throws_ok($$ INSERT INTO public.desktop_drawer_events (restaurant_id, device_id, printer_id, opened_at, reason) VALUES ('99000000-0000-0000-0000-0000000000a1', '99500000-0000-0000-0000-0000000000a1', 'p', now(), 'manual') $$, '42501', NULL, 'admin cannot forge a drawer event');
SELECT throws_ok($$ INSERT INTO public.desktop_releases (channel, target, version, file, signature) VALUES ('stable', 'windows', '9.9.9', 'f', 's') $$, '42501', NULL, 'vipe_api cannot INSERT releases');
SELECT throws_ok($$ UPDATE public.desktop_releases SET required = true $$, '42501', NULL, 'vipe_api cannot UPDATE releases');
SELECT throws_ok($$ DELETE FROM public.desktop_releases $$, '42501', NULL, 'vipe_api cannot DELETE releases');
SELECT throws_ok($$ INSERT INTO public.desktop_pairing_codes (restaurant_id, code_hash) VALUES ('99000000-0000-0000-0000-0000000000a1', 'x') $$, '42501', NULL, 'vipe_api cannot INSERT pairing codes');
SELECT throws_ok($$ SELECT * FROM private.desktop_pairing_attempts $$, '42501', NULL, 'vipe_api cannot read pairing attempts');
SELECT throws_ok($$ UPDATE private.desktop_pairing_attempts SET failures = 0 $$, '42501', NULL, 'vipe_api cannot reset pairing attempts');
SELECT throws_ok($$ SELECT private.desktop_pairing_blocked('ip:x') $$, '42501', NULL, 'vipe_api cannot call desktop_pairing_blocked');
SELECT throws_ok($$ UPDATE public.desktop_devices SET revoked_at = NULL WHERE id = '99500000-0000-0000-0000-0000000000a9' $$,
  '42501', 'desktop_devices: revocation_final', 'an admin connection cannot un-revoke a device by SQL');
-- Admin B cannot touch A's devices
SELECT set_config('app.user_id', '99000000-0000-0000-0000-000000000003', true);
UPDATE public.desktop_devices SET revoked_at = now(), name = 'pwn' WHERE id = '99500000-0000-0000-0000-0000000000a1';
SELECT is((SELECT count(*)::int FROM public.desktop_devices WHERE restaurant_id = '99000000-0000-0000-0000-0000000000a1'), 0, 'admin B sees no device of A');
SELECT set_config('app.user_id', '', true);

-- 3. Tenancy through the device functions
SELECT throws_ok($$ SELECT * FROM private.desktop_put_printers('v-b1', '[{"id":"p","name":"P","model":"","connection":"usb","paperMm":80,"hasDrawer":false,"stationIds":["99200000-0000-0000-0000-0000000000a1"]}]') $$,
  '22023', 'desktop_put_printers: station_invalid', 'device of B cannot register a station of A');
SELECT throws_ok($$ SELECT * FROM private.desktop_put_printers('v-a1', '[{"id":"p","name":"P","model":"","connection":"usb","paperMm":80,"hasDrawer":false,"stationIds":["not-a-uuid"]}]') $$,
  '22023', 'desktop_put_printers: station_invalid', 'a malformed station id is station_invalid, not a cast error');
SELECT is((SELECT count(*)::int FROM private.desktop_put_printers('v-a1', '[{"id":"p1","name":"Epson","model":"","connection":"usb","paperMm":80,"hasDrawer":true,"stationIds":["99200000-0000-0000-0000-0000000000a1"]}]')), 1,
  'device A1 serves Cocina');
SELECT is(private.desktop_ack_job('v-b1', '99600000-0000-0000-0000-000000000001', 'printed', NULL), false, 'device of B cannot ack a job of A');
SELECT is_empty($$ SELECT * FROM private.desktop_pending_jobs('v-b1', '99600000-0000-0000-0000-000000000001', 500) $$, 'B paging after a job id of A gets nothing');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('v-b1', NULL, 500) $$, $$ VALUES ('99600000-0000-0000-0000-0000000000b1'::uuid) $$, 'B sees only its own job');
SELECT is((SELECT array_agg(name ORDER BY name) FROM private.desktop_stations('v-b1')), ARRAY['Cocina B'], 'B lists only its stations');
SELECT lives_ok($$ SELECT private.desktop_drawer_event('v-a1', 'p1', now(), 'manual', '99100000-0000-0000-0000-000000000003') $$, 'drawer event with a profile of B');

-- 4. Routing, boundary, limits
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('v-a1', NULL, 500) $$,
  $$ VALUES ('99600000-0000-0000-0000-000000000004'::uuid), ('99600000-0000-0000-0000-000000000001'::uuid), ('99600000-0000-0000-0000-000000000002'::uuid), ('99600000-0000-0000-0000-000000000005'::uuid), ('99600000-0000-0000-0000-000000000006'::uuid) $$,
  'A1: null-station jobs, Cocina, the boundary job at created_at = device; not Barra');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('v-a2', NULL, 500) $$,
  $$ VALUES ('99600000-0000-0000-0000-000000000004'::uuid), ('99600000-0000-0000-0000-000000000001'::uuid), ('99600000-0000-0000-0000-000000000005'::uuid), ('99600000-0000-0000-0000-000000000006'::uuid) $$,
  'A2 (no printers): only null-station jobs');
SELECT is((SELECT count(*)::int FROM private.desktop_pending_jobs('v-a1', NULL, 0)), 1, 'limit 0 is clamped to 1');
SELECT is((SELECT count(*)::int FROM private.desktop_pending_jobs('v-a1', NULL, -5)), 1, 'negative limit is clamped to 1');
SELECT is((SELECT count(*)::int FROM private.desktop_pending_jobs('v-a1', NULL, NULL)), 5, 'null limit = 500');
SELECT is_empty($$ SELECT * FROM private.desktop_pending_jobs('v-a1', '99999999-0000-0000-0000-000000000000', 500) $$, 'unknown after returns nothing');

-- 5. Acks and print_jobs.printed_at (legacy listener)
SELECT is((SELECT count(*)::int FROM private.printer_pending_jobs('vpt-legacy-a', NULL) WHERE id::text LIKE '996%'), 6, 'legacy listener sees the 6 jobs of A');
SELECT is(private.desktop_ack_job('v-a1', '99600000-0000-0000-0000-000000000005', 'skipped', 'viejo'), true, 'skipped ack');
SELECT is(private.desktop_ack_job('v-a1', '99600000-0000-0000-0000-000000000006', 'cancelled', NULL), true, 'cancelled ack');
SELECT is(private.desktop_ack_job('v-a1', '99600000-0000-0000-0000-000000000005', 'printed', NULL), true, 'printed after skipped (first wins)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.print_jobs WHERE id IN ('99600000-0000-0000-0000-000000000005', '99600000-0000-0000-0000-000000000006') AND printed_at IS NOT NULL), 0,
  'skipped and cancelled (and a later printed of the same device) leave printed_at null');
SELECT is((SELECT status FROM public.desktop_job_acks WHERE job_id = '99600000-0000-0000-0000-000000000005'), 'skipped', 'first status stays');
SELECT is((SELECT profile_id FROM public.desktop_drawer_events WHERE device_id = '99500000-0000-0000-0000-0000000000a1'), NULL, 'profile of B stored as null');
SET LOCAL ROLE vipe_api;
-- Job 3 is Barra, not served by A1.
SELECT is(private.desktop_ack_job('v-a1', '99600000-0000-0000-0000-000000000003', 'printed', NULL), false,
  'a device cannot ack a job not routed to it');
SELECT is(private.desktop_ack_job('v-a1', '99600000-0000-0000-0000-000000000001', 'printed', NULL), true, 'A1 prints job 1');
SELECT is((SELECT array_agg(id ORDER BY id) FROM private.printer_pending_jobs('vpt-legacy-a', NULL) WHERE id::text LIKE '996%'),
  ARRAY['99600000-0000-0000-0000-000000000002'::uuid, '99600000-0000-0000-0000-000000000003'::uuid, '99600000-0000-0000-0000-000000000004'::uuid, '99600000-0000-0000-0000-000000000005'::uuid, '99600000-0000-0000-0000-000000000006'::uuid],
  'legacy listener no longer sees desktop-printed job 1; the refused ack of job 3 leaves it');
SELECT results_eq($$ SELECT id FROM private.desktop_pending_jobs('v-a2', NULL, 500) $$,
  $$ VALUES ('99600000-0000-0000-0000-000000000004'::uuid), ('99600000-0000-0000-0000-000000000001'::uuid), ('99600000-0000-0000-0000-000000000005'::uuid), ('99600000-0000-0000-0000-000000000006'::uuid) $$,
  'another device still gets a job printed by A1 (acks are per device; desktop ignores printed_at)');
SELECT is(private.ack_print_job('vpt-legacy-a', '99600000-0000-0000-0000-000000000002'), true, 'legacy listener prints job 2');
SELECT is((SELECT count(*)::int FROM private.desktop_pending_jobs('v-a1', NULL, 500) WHERE id = '99600000-0000-0000-0000-000000000002'), 1,
  'known (L36 A2): a job the legacy listener printed is still pending for the desktop (run only one per restaurant)');
RESET ROLE;
SELECT ok((SELECT printed_at FROM public.print_jobs WHERE id = '99600000-0000-0000-0000-000000000001') IS NOT NULL, 'printed sets printed_at');

SELECT * FROM finish();
ROLLBACK;
