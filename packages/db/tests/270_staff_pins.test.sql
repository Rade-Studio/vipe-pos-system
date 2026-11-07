-- Staff PINs, terminal/acting sessions and supervisor authorizations
-- (odd/tasks/fase3-operacion.md, F2, migration 0017).
--
-- The PIN is stored only as an argon2id hash (no plaintext column, CHECK on
-- the encoded form); vipe_api reads only non-secret columns of its
-- restaurant and writes through the gated SECURITY DEFINER helpers.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(81);

-- Fixtures: restaurant A with an admin, a cashier, a waiter, a kitchen cook
-- and an inactive waiter; restaurant B with an admin and a waiter.
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('27000000-0000-0000-0000-0000000000a1', 't270-a', 'T270 A'),
  ('27000000-0000-0000-0000-0000000000b2', 't270-b', 'T270 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('27000000-0000-0000-0000-000000000001', 'admin@t270a.test', 'h'),
  ('27000000-0000-0000-0000-000000000002', 'cashier@t270a.test', 'h'),
  ('27000000-0000-0000-0000-000000000003', 'waiter@t270a.test', 'h'),
  ('27000000-0000-0000-0000-000000000004', 'cook@t270a.test', 'h'),
  ('27000000-0000-0000-0000-000000000005', 'off@t270a.test', 'h'),
  ('27000000-0000-0000-0000-000000000006', 'admin@t270b.test', 'h'),
  ('27000000-0000-0000-0000-000000000007', 'waiter@t270b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('28000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t270a.test', 'admin', true, '27000000-0000-0000-0000-0000000000a1'),
  ('28000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000002', 'Cashier A', 'cashier@t270a.test', 'cashier', true, '27000000-0000-0000-0000-0000000000a1'),
  ('28000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-000000000003', 'Waiter A', 'waiter@t270a.test', 'waiter', true, '27000000-0000-0000-0000-0000000000a1'),
  ('28000000-0000-0000-0000-000000000004', '27000000-0000-0000-0000-000000000004', 'Cook A', 'cook@t270a.test', 'kitchen', true, '27000000-0000-0000-0000-0000000000a1'),
  ('28000000-0000-0000-0000-000000000005', '27000000-0000-0000-0000-000000000005', 'Off A', 'off@t270a.test', 'waiter', false, '27000000-0000-0000-0000-0000000000a1'),
  ('28000000-0000-0000-0000-000000000006', '27000000-0000-0000-0000-000000000006', 'Admin B', 'admin@t270b.test', 'admin', true, '27000000-0000-0000-0000-0000000000b2'),
  ('28000000-0000-0000-0000-000000000007', '27000000-0000-0000-0000-000000000007', 'Waiter B', 'waiter@t270b.test', 'waiter', true, '27000000-0000-0000-0000-0000000000b2');
INSERT INTO public.auth_sessions (id, user_id, refresh_hash, expires_at) VALUES
  ('29000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 't270-admin', now() + interval '1 day'),
  ('29000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-000000000003', 't270-waiter', now() + interval '1 day'),
  ('29000000-0000-0000-0000-000000000006', '27000000-0000-0000-0000-000000000006', 't270-admin-b', now() + interval '1 day');

CREATE TEMP TABLE t270 (name text PRIMARY KEY, value text) ON COMMIT DROP;
GRANT ALL ON t270 TO vipe_api;
INSERT INTO t270 VALUES
  ('hash1', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g'),
  ('hash2', '$argon2id$v=19$m=65536,p=4,t=3$b3RoZXJzYWx0b3RoZXJzYQ$b3RoZXJoYXNob3RoZXJoYXNob3RoZXJoYXNob3RoZXI');

-- ============================================
-- 1. Schema: no plaintext, CHECKs, RLS, grants
-- ============================================
SELECT has_table('public', 'staff_pins', 'public.staff_pins exists');
SELECT columns_are('public', 'staff_pins',
  ARRAY['profile_id', 'restaurant_id', 'pin_hash', 'pin_pepper_version', 'set_by', 'set_at', 'updated_at'],
  'staff_pins has exactly the hash, pepper version and audit columns (no plaintext PIN column)');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.staff_pins'::regclass), 'staff_pins has RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.supervisor_authorizations'::regclass), 'supervisor_authorizations has RLS');
SELECT ok(NOT has_column_privilege('vipe_api', 'public.staff_pins', 'pin_hash', 'SELECT'), 'vipe_api cannot read pin_hash');
SELECT ok(has_column_privilege('vipe_api', 'public.staff_pins', 'set_at', 'SELECT'), 'vipe_api reads set_at');
SELECT ok(NOT has_table_privilege('vipe_api', 'private.pin_attempts', 'SELECT, INSERT, UPDATE, DELETE'), 'vipe_api has no privilege on the attempt counters');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.staff_pins', 'INSERT, UPDATE, DELETE'), 'vipe_api cannot write staff_pins');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.supervisor_authorizations', 'INSERT, UPDATE, DELETE'), 'vipe_api cannot write supervisor_authorizations');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.pin_attempt_keys(uuid, uuid, text[])', 'EXECUTE'), 'vipe_api cannot call the internal key resolver');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.pin_caller()', 'EXECUTE'), 'vipe_api cannot call the internal gate');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.stamp_created_by_profile()', 'EXECUTE'), 'vipe_api cannot call the stamping trigger function');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname = ANY(ARRAY['pin_caller', 'set_staff_pin', 'clear_staff_pin', 'change_own_pin', 'pin_check_target',
        'supervisor_pin_candidates', 'pin_attempt_keys', 'claim_pin_attempt', 'clear_pin_attempts', 'staff_pin_locks', 'rehash_staff_pin', 'create_terminal_session',
        'open_acting_session', 'session_is_live', 'rotate_session', 'revoke_session', 'revoke_session_by_id',
        'create_supervisor_authorization', 'consume_supervisor_authorization', 'stamp_created_by_profile'])
      AND NOT coalesce('search_path=""' = ANY(p.proconfig), false)),
  0, 'every 0017 helper pins an empty search_path');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname = ANY(ARRAY['set_staff_pin', 'clear_staff_pin', 'change_own_pin', 'rehash_staff_pin', 'claim_pin_attempt', 'clear_pin_attempts',
        'create_terminal_session', 'open_acting_session', 'create_supervisor_authorization', 'consume_supervisor_authorization'])
      AND p.prosecdef
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')),
  10, 'the write paths are SECURITY DEFINER helpers vipe_api may execute');

SELECT throws_ok(
  $$ INSERT INTO public.staff_pins (profile_id, restaurant_id, pin_hash) VALUES ('28000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-0000000000a1', '4821') $$,
  '23514', NULL, 'a plain PIN is refused by the argon2id CHECK');
SELECT throws_ok(
  $$ INSERT INTO public.staff_pins (profile_id, restaurant_id, pin_hash) VALUES ('28000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-0000000000a1', '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012') $$,
  '23514', NULL, 'a bcrypt hash is refused');
SELECT throws_ok(
  format($$ INSERT INTO public.staff_pins (profile_id, restaurant_id, pin_hash, pin_pepper_version) VALUES ('28000000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-0000000000a1', %L, 3) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  '23514', NULL, 'the pepper version is 1 or 2');
SELECT throws_ok(
  format($$ INSERT INTO public.staff_pins (profile_id, restaurant_id, pin_hash) VALUES ('28000000-0000-0000-0000-000000000007', '27000000-0000-0000-0000-0000000000a1', %L) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  '23503', NULL, 'the tenant key refuses a profile of another restaurant');
SELECT throws_ok(
  $$ INSERT INTO public.business_config (key, value, restaurant_id) VALUES ('waiter_access_mode', 'mixed', '27000000-0000-0000-0000-0000000000a1') $$,
  '23514', NULL, 'waiter_access_mode accepts only own_accounts | shared_terminal');
SELECT lives_ok(
  $$ INSERT INTO public.business_config (key, value, restaurant_id) VALUES ('waiter_access_mode', 'shared_terminal', '27000000-0000-0000-0000-0000000000b2') $$,
  'waiter_access_mode = shared_terminal is stored');
SELECT throws_ok(
  $$ INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at, kind) VALUES ('27000000-0000-0000-0000-000000000003', 't270-x', now() + interval '1 hour', 'acting') $$,
  '23514', NULL, 'an acting session needs a parent');
SELECT throws_ok(
  $$ INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at, kind) VALUES ('27000000-0000-0000-0000-000000000003', 't270-y', now() + interval '1 hour', 'kiosk') $$,
  '23514', NULL, 'session kind is user | terminal | acting');
SELECT throws_ok(
  $$ INSERT INTO public.supervisor_authorizations (restaurant_id, action, created_at, expires_at) VALUES ('27000000-0000-0000-0000-0000000000a1', 'void_item', now(), now() + interval '1 hour') $$,
  '23514', NULL, 'an authorization lives at most 10 minutes');
SELECT throws_ok(
  $$ INSERT INTO public.supervisor_authorizations (restaurant_id, action, created_at, expires_at) VALUES ('27000000-0000-0000-0000-0000000000a1', 'Void Item!', now(), now() + interval '2 minutes') $$,
  '23514', NULL, 'the action is a snake_case identifier');

-- ============================================
-- 2. Admin sets, resets and clears PINs
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  format($$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000003', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  'an admin sets a waiter PIN');
SELECT lives_ok(
  format($$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000001', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  'an admin sets their own PIN');
SELECT lives_ok(
  format($$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000002', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  'an admin sets a cashier PIN');
SELECT results_eq(
  $$ SELECT profile_id, set_by FROM public.staff_pins ORDER BY profile_id $$,
  $$ VALUES ('28000000-0000-0000-0000-000000000001'::uuid, '28000000-0000-0000-0000-000000000001'::uuid),
            ('28000000-0000-0000-0000-000000000002'::uuid, '28000000-0000-0000-0000-000000000001'::uuid),
            ('28000000-0000-0000-0000-000000000003'::uuid, '28000000-0000-0000-0000-000000000001'::uuid) $$,
  'vipe_api sees its restaurant PINs with who set them');
SELECT throws_ok($$ SELECT pin_hash FROM public.staff_pins $$, '42501', NULL, 'selecting pin_hash is denied');
SELECT throws_ok(
  format($$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000007', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  'P0002', NULL, 'an admin of A cannot set a PIN in B');
SELECT throws_ok(
  $$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000004', '1234', 1::smallint) $$,
  '23514', NULL, 'the helper refuses a plain PIN too');

SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  format($$ SELECT private.set_staff_pin('28000000-0000-0000-0000-000000000004', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  '42501', NULL, 'a waiter cannot set PINs');
SELECT throws_ok($$ SELECT private.clear_staff_pin('28000000-0000-0000-0000-000000000003') $$, '42501', NULL, 'a waiter cannot clear PINs');
SELECT lives_ok(
  format($$ SELECT private.change_own_pin(%L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash2')),
  'a waiter changes their own PIN');
SELECT is((SELECT set_by FROM public.staff_pins WHERE profile_id = '28000000-0000-0000-0000-000000000003'),
  '28000000-0000-0000-0000-000000000003'::uuid, 'the own change records the waiter as set_by');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000004', true);
SELECT throws_ok(
  format($$ SELECT private.change_own_pin(%L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash2')),
  'P0002', NULL, 'without a PIN the own change is refused');

-- ============================================
-- 3. Reading hashes for verification, tenant scoped
-- ============================================
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT is((SELECT count(*) FROM private.pin_check_target('28000000-0000-0000-0000-000000000002'))::int, 1, 'a profile of the caller restaurant is found');
SELECT is((SELECT role FROM private.pin_check_target('28000000-0000-0000-0000-000000000002')), 'cashier', 'with its role');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000006', true);
SELECT is((SELECT count(*) FROM private.pin_check_target('28000000-0000-0000-0000-000000000003'))::int, 0, 'an admin of B never sees a PIN of A');
SELECT is((SELECT count(*) FROM private.supervisor_pin_candidates(now()))::int, 0, 'B has no supervisor PINs');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT results_eq(
  $$ SELECT profile_id FROM private.supervisor_pin_candidates(now()) ORDER BY profile_id $$,
  $$ VALUES ('28000000-0000-0000-0000-000000000001'::uuid), ('28000000-0000-0000-0000-000000000002'::uuid) $$,
  'supervisor candidates are the admin and the cashier with PINs (no waiter)');
SELECT set_config('app.user_id', '', true);
SELECT throws_ok($$ SELECT * FROM private.pin_check_target('28000000-0000-0000-0000-000000000003') $$, '42501', NULL, 'without a caller nothing is read');

-- ============================================
-- 4. Lockout: attempts claimed before verifying; 5 lock 5 minutes
-- ============================================
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000001', true);
SELECT is(
  (SELECT count(*)::int FROM generate_series(1, 4) g
    WHERE private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003',
                                    ARRAY['session', 'profile'], '2026-11-07 12:00:00+00') IS NULL),
  4, '4 attempts are claimed');
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003',
                                    ARRAY['session', 'profile'], '2026-11-07 12:00:00+00'),
  NULL, 'the 5th attempt is still claimed (and verified)');
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003',
                                    ARRAY['profile'], '2026-11-07 12:04:59+00'),
  '2026-11-07 12:05:00+00'::timestamptz, 'then the profile is locked for 5 minutes: no 6th claim');
SELECT is(
  (SELECT locked_until FROM private.staff_pin_locks('2026-11-07 12:01:00+00') WHERE profile_id = '28000000-0000-0000-0000-000000000003'),
  '2026-11-07 12:05:00+00'::timestamptz, 'the admin sees the running lockout');
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', NULL, ARRAY['session'], '2026-11-07 12:01:00+00'),
  '2026-11-07 12:05:00+00'::timestamptz, 'the session is locked too');
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003',
                                    ARRAY['session', 'profile'], '2026-11-07 12:05:00+00'),
  NULL, 'after exactly 5 minutes an attempt is claimed again');
SELECT throws_ok(
  $$ SELECT private.claim_pin_attempt('29000000-0000-0000-0000-000000000006', NULL, ARRAY['session'], now()) $$,
  '42501', NULL, 'an attempt cannot be claimed on another user''s session');
SELECT throws_ok(
  $$ SELECT private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', NULL, ARRAY['everything'], now()) $$,
  '22023', NULL, 'unknown scopes are refused');
SELECT lives_ok($$ SELECT private.clear_pin_attempts('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003', ARRAY['session', 'profile']) $$,
  'a correct PIN clears the claimed scopes');
-- The caller scope is keyed by profile: a new session of the same user keeps it.
SELECT private.claim_pin_attempt('29000000-0000-0000-0000-000000000001', NULL, ARRAY['caller', 'supervisors'], '2026-11-07 13:00:00+00')
  FROM generate_series(1, 5);
RESET ROLE;
INSERT INTO public.auth_sessions (id, user_id, refresh_hash, expires_at) VALUES
  ('29000000-0000-0000-0000-000000000011', '27000000-0000-0000-0000-000000000001', 't270-admin-2', now() + interval '1 day');
SET LOCAL ROLE vipe_api;
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000011', NULL, ARRAY['session', 'caller'], '2026-11-07 13:01:00+00'),
  '2026-11-07 13:05:00+00'::timestamptz, 'a fresh session of the same user is still locked by the caller scope');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000003', NULL, ARRAY['supervisors'], '2026-11-07 13:01:00+00'),
  '2026-11-07 13:05:00+00'::timestamptz, 'the restaurant supervisor set is locked for every caller');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000006', true);
SELECT is(private.claim_pin_attempt('29000000-0000-0000-0000-000000000006', '28000000-0000-0000-0000-000000000003',
                                    ARRAY['session', 'profile', 'supervisors'], '2026-11-07 13:01:00+00'),
  NULL, 'another restaurant is not locked by A and never counts on a profile of A');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT count(*)::int FROM private.staff_pin_locks('2026-11-07 13:01:00+00')), 0, 'no profile of A is locked');
SELECT lives_ok(
  format($$ SELECT private.rehash_staff_pin('28000000-0000-0000-0000-000000000003', %L, 2::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash1')),
  'a correct PIN upgrades the pepper version');
SELECT lives_ok(
  format($$ SELECT private.rehash_staff_pin('28000000-0000-0000-0000-000000000003', %L, 1::smallint) $$, (SELECT value FROM t270 WHERE name = 'hash2')),
  'a downgrade is a no-op');
RESET ROLE;
SELECT is((SELECT pin_pepper_version FROM public.staff_pins WHERE profile_id = '28000000-0000-0000-0000-000000000003'), 2::smallint,
  'the PIN stays on pepper version 2');

-- ============================================
-- 5. Terminal and acting sessions
-- ============================================
RESET ROLE;
SELECT throws_ok(
  $$ SELECT private.create_terminal_session('27000000-0000-0000-0000-000000000003', 't270-term-w', now() + interval '1 day') $$,
  '42501', NULL, 'a waiter cannot open a terminal');
SELECT lives_ok(
  $$ INSERT INTO t270 VALUES ('terminal', private.create_terminal_session('27000000-0000-0000-0000-000000000002', 't270-term', now() + interval '1 day')::text) $$,
  'a cashier opens a terminal');
SELECT is((SELECT kind FROM public.auth_sessions WHERE refresh_hash = 't270-term'), 'terminal', 'the session kind is terminal');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$ SELECT private.open_acting_session('29000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000003', 't270-act-x', now() + interval '5 minutes') $$,
  '42501', NULL, 'an acting session needs a terminal of the caller');
SELECT throws_ok(
  format($$ SELECT private.open_acting_session(%L, '28000000-0000-0000-0000-000000000007', 't270-act-b', now() + interval '5 minutes') $$, (SELECT value FROM t270 WHERE name = 'terminal')),
  'P0002', NULL, 'a waiter of B cannot act on a terminal of A');
SELECT throws_ok(
  format($$ SELECT private.open_acting_session(%L, '28000000-0000-0000-0000-000000000004', 't270-act-c', now() + interval '5 minutes') $$, (SELECT value FROM t270 WHERE name = 'terminal')),
  'P0002', NULL, 'a profile without PIN cannot act');
SELECT lives_ok(
  format($$ INSERT INTO t270 VALUES ('acting', private.open_acting_session(%L, '28000000-0000-0000-0000-000000000003', 't270-act', now() + interval '1 hour')::text) $$, (SELECT value FROM t270 WHERE name = 'terminal')),
  'the waiter with a PIN acts on the terminal');
RESET ROLE;
SELECT ok((SELECT expires_at <= now() + interval '10 minutes' AND user_id = '27000000-0000-0000-0000-000000000003' FROM public.auth_sessions WHERE refresh_hash = 't270-act'),
  'the acting session belongs to the waiter and expires within 10 minutes');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT ok(private.session_is_live((SELECT value FROM t270 WHERE name = 'acting')::uuid), 'the acting session is live');
SELECT ok(NOT private.session_is_live((SELECT value FROM t270 WHERE name = 'terminal')::uuid), 'the waiter cannot probe the terminal session');
SELECT is((SELECT count(*) FROM private.rotate_session('t270-act', 't270-act-2', now() + interval '1 day'))::int, 0, 'an acting session never rotates');
SELECT private.revoke_session_by_id((SELECT value FROM t270 WHERE name = 'terminal')::uuid);
SELECT ok(NOT private.session_is_live((SELECT value FROM t270 WHERE name = 'acting')::uuid), 'revoking the terminal ends its acting sessions');
SELECT is((SELECT kind FROM private.rotate_session('t270-waiter', 't270-waiter-2', now() + interval '1 day')), 'user', 'rotation returns the session kind');

-- ============================================
-- 6. Supervisor authorizations: role, single use, expiry, tenant
-- ============================================
SELECT throws_ok(
  $$ SELECT private.create_supervisor_authorization('28000000-0000-0000-0000-000000000003', 'void_item', now()) $$,
  '42501', NULL, 'a waiter is not a supervisor');
SELECT lives_ok(
  $$ INSERT INTO t270 VALUES ('auth', private.create_supervisor_authorization('28000000-0000-0000-0000-000000000002', 'void_item', '2026-11-07 12:00:00+00')::text) $$,
  'a cashier with a PIN authorizes');
SELECT is(private.consume_supervisor_authorization((SELECT value FROM t270 WHERE name = 'auth')::uuid, 'cancel_order', '2026-11-07 12:01:00+00'), NULL,
  'it does not authorize another action');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000006', true);
SELECT is(private.consume_supervisor_authorization((SELECT value FROM t270 WHERE name = 'auth')::uuid, 'void_item', '2026-11-07 12:01:00+00'), NULL,
  'another restaurant cannot consume it');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
SELECT is(private.consume_supervisor_authorization((SELECT value FROM t270 WHERE name = 'auth')::uuid, 'void_item', '2026-11-07 12:02:00+00'), NULL,
  'it expires after 2 minutes');
SELECT is(private.consume_supervisor_authorization((SELECT value FROM t270 WHERE name = 'auth')::uuid, 'void_item', '2026-11-07 12:01:59+00'),
  '28000000-0000-0000-0000-000000000002'::uuid, 'consumed once within 2 minutes, returning the supervisor');
SELECT is(private.consume_supervisor_authorization((SELECT value FROM t270 WHERE name = 'auth')::uuid, 'void_item', '2026-11-07 12:01:59+00'), NULL,
  'never twice');

-- ============================================
-- 7. Orders and items record who took them
-- ============================================
SELECT has_column('public', 'order_items', 'created_by_profile_id', 'order_items records who added each item');
SELECT set_config('app.user_id', '27000000-0000-0000-0000-000000000003', true);
INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total) VALUES ('active', 0, 0, 0, 0);
SELECT is((SELECT created_by_profile_id FROM public.orders WHERE restaurant_id = '27000000-0000-0000-0000-0000000000a1'),
  '28000000-0000-0000-0000-000000000003'::uuid, 'an order inserted by the waiter records the waiter as created_by');
RESET ROLE;
INSERT INTO public.orders (status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES ('active', 0, 0, 0, 0, '27000000-0000-0000-0000-0000000000b2');
SELECT is((SELECT created_by_profile_id FROM public.orders WHERE restaurant_id = '27000000-0000-0000-0000-0000000000b2'), NULL,
  'an order written for another restaurant than the caller''s is not stamped');

SELECT * FROM finish();
ROLLBACK;
