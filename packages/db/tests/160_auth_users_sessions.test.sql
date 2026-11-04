-- Login identities and refresh sessions for the API
-- (odd/tasks/migracion-backend-nestjs.md, T5 design steps 1b and 3).
--
-- vipe_api never reads password_hash: it holds column-level SELECT on the
-- non-secret columns of public.users and reaches hashes only through
-- private.find_user_for_login. Writes to users and auth_sessions go through
-- SECURITY DEFINER helpers; auth_sessions is readable only by its owner (RLS on
-- app.user_id).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(34);

-- Fixtures (as the test author): one active and one inactive user.
INSERT INTO public.users (id, email, password_hash, password_algo, is_active) VALUES
  ('16000000-0000-0000-0000-000000000001', 'Ana@T160.test', 'hash-ana', 'argon2id', true),
  ('16000000-0000-0000-0000-000000000002', 'off@t160.test', 'hash-off', 'bcrypt', false);

-- ============================================
-- 1. public.users privileges for vipe_api
-- ============================================
SELECT ok(
  NOT has_table_privilege('vipe_api', 'public.users', 'SELECT'),
  'vipe_api has no table-level SELECT on users'
);
SELECT ok(
  NOT has_column_privilege('vipe_api', 'public.users', 'password_hash', 'SELECT'),
  'vipe_api cannot SELECT users.password_hash'
);
SELECT ok(
  NOT has_column_privilege('vipe_api', 'public.users', 'password_algo', 'SELECT'),
  'vipe_api cannot SELECT users.password_algo'
);
SELECT ok(
  has_column_privilege('vipe_api', 'public.users', 'id', 'SELECT')
  AND has_column_privilege('vipe_api', 'public.users', 'email', 'SELECT')
  AND has_column_privilege('vipe_api', 'public.users', 'is_active', 'SELECT')
  AND has_column_privilege('vipe_api', 'public.users', 'created_at', 'SELECT')
  AND has_column_privilege('vipe_api', 'public.users', 'updated_at', 'SELECT'),
  'vipe_api can SELECT id, email, is_active, created_at, updated_at'
);
SELECT ok(
  NOT has_any_column_privilege('vipe_api', 'public.users', 'INSERT')
  AND NOT has_any_column_privilege('vipe_api', 'public.users', 'UPDATE')
  AND NOT has_table_privilege('vipe_api', 'public.users', 'DELETE'),
  'vipe_api has no INSERT, UPDATE or DELETE on users'
);

SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ SELECT password_hash FROM public.users $$,
  '42501', NULL,
  'vipe_api SELECT password_hash is permission denied'
);
SELECT throws_ok(
  $$ SELECT * FROM public.users $$,
  '42501', NULL,
  'vipe_api SELECT * on users is permission denied'
);
SELECT is(
  (SELECT email::text FROM public.users WHERE id = '16000000-0000-0000-0000-000000000001'),
  'Ana@T160.test',
  'vipe_api reads the non-secret columns'
);
SELECT throws_ok(
  $$ UPDATE public.users SET is_active = false $$,
  '42501', NULL,
  'vipe_api UPDATE users is permission denied'
);
SELECT throws_ok(
  $$ DELETE FROM public.users $$,
  '42501', NULL,
  'vipe_api DELETE users is permission denied'
);

-- ============================================
-- 2. Login lookup and user writes through SECURITY DEFINER helpers
-- ============================================
SELECT results_eq(
  $$ SELECT id, password_hash, password_algo, is_active
       FROM private.find_user_for_login('ana@t160.test') $$,
  $$ VALUES ('16000000-0000-0000-0000-000000000001'::uuid, 'hash-ana', 'argon2id', true) $$,
  'find_user_for_login returns the hash, case-insensitively, without app.user_id'
);
SELECT is(
  (SELECT count(*) FROM private.find_user_for_login('nobody@t160.test'))::bigint,
  0::bigint,
  'find_user_for_login returns no row for an unknown email'
);
SELECT is(
  (SELECT is_active FROM private.find_user_for_login('OFF@t160.test')),
  false,
  'find_user_for_login reports inactive users'
);

SELECT lives_ok(
  $$ SELECT private.create_user('new@t160.test', 'hash-new') $$,
  'vipe_api creates a user through private.create_user'
);
SELECT results_eq(
  $$ SELECT password_hash, password_algo FROM private.find_user_for_login('new@t160.test') $$,
  $$ VALUES ('hash-new', 'argon2id') $$,
  'create_user stores the hash with argon2id by default'
);
SELECT throws_ok(
  $$ SELECT private.create_user('NEW@t160.test', 'hash-dup') $$,
  '23505', NULL,
  'create_user rejects an email that differs only in case'
);
SELECT throws_ok(
  $$ SELECT private.create_user('md5@t160.test', 'x', 'md5') $$,
  '22023', NULL,
  'create_user rejects an unknown password_algo'
);

SELECT lives_ok(
  $$ SELECT private.set_password('16000000-0000-0000-0000-000000000002', 'hash-rehashed', 'argon2id') $$,
  'vipe_api re-hashes a password through private.set_password'
);
SELECT results_eq(
  $$ SELECT password_hash, password_algo FROM private.find_user_for_login('off@t160.test') $$,
  $$ VALUES ('hash-rehashed', 'argon2id') $$,
  'set_password replaces hash and algorithm'
);
SELECT throws_ok(
  $$ SELECT private.set_password('16000000-0000-0000-0000-0000000000ff', 'x', 'argon2id') $$,
  'P0002', NULL,
  'set_password raises P0002 for an unknown user'
);

-- ============================================
-- 3. auth_sessions
-- ============================================
RESET ROLE;
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auth_sessions'::regclass),
  'auth_sessions has row level security enabled'
);
SELECT ok(
  NOT has_column_privilege('vipe_api', 'public.auth_sessions', 'refresh_hash', 'SELECT')
  AND has_column_privilege('vipe_api', 'public.auth_sessions', 'user_id', 'SELECT')
  AND NOT has_any_column_privilege('vipe_api', 'public.auth_sessions', 'INSERT')
  AND NOT has_any_column_privilege('vipe_api', 'public.auth_sessions', 'UPDATE')
  AND NOT has_table_privilege('vipe_api', 'public.auth_sessions', 'DELETE'),
  'vipe_api reads auth_sessions without refresh_hash and never writes it directly'
);

SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT private.create_session('16000000-0000-0000-0000-000000000001', 'r1', now() + interval '1 day') IS NOT NULL),
  true,
  'vipe_api creates a session through private.create_session'
);
SELECT throws_ok(
  $$ SELECT private.create_session('16000000-0000-0000-0000-000000000002', 'r-off', now() + interval '1 day') $$,
  '42501', NULL,
  'create_session refuses an inactive user'
);
SELECT throws_ok(
  $$ INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at)
     VALUES ('16000000-0000-0000-0000-000000000001', 'direct', now()) $$,
  '42501', NULL,
  'vipe_api INSERT into auth_sessions is permission denied'
);

SELECT is(
  (SELECT count(*) FROM public.auth_sessions)::bigint,
  0::bigint,
  'without app.user_id no session is visible'
);
SELECT set_config('app.user_id', '16000000-0000-0000-0000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM public.auth_sessions)::bigint,
  1::bigint,
  'the owner sees its own session'
);
SELECT set_config('app.user_id', '16000000-0000-0000-0000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM public.auth_sessions)::bigint,
  0::bigint,
  'another user sees no session'
);
SELECT set_config('app.user_id', '', true);

SELECT results_eq(
  $$ SELECT s.user_id FROM private.rotate_session('r1', 'r2', now() + interval '1 day') s $$,
  $$ VALUES ('16000000-0000-0000-0000-000000000001'::uuid) $$,
  'rotate_session swaps the refresh hash and returns the session owner'
);
SELECT is(
  (SELECT count(*) FROM private.rotate_session('r1', 'r3', now() + interval '1 day'))::bigint,
  0::bigint,
  'a refresh hash is rejected after it was rotated'
);

SELECT private.create_session('16000000-0000-0000-0000-000000000001', 'expired', now() - interval '1 second');
SELECT is(
  (SELECT count(*) FROM private.rotate_session('expired', 'e2', now() + interval '1 day'))::bigint,
  0::bigint,
  'an expired session does not rotate'
);

SELECT private.revoke_session('r2');
SELECT is(
  (SELECT count(*) FROM private.rotate_session('r2', 'r4', now() + interval '1 day'))::bigint,
  0::bigint,
  'a revoked session does not rotate'
);

RESET ROLE;
UPDATE public.users SET is_active = false WHERE id = '16000000-0000-0000-0000-000000000001';
INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at)
  VALUES ('16000000-0000-0000-0000-000000000001', 'deactivated', now() + interval '1 day');
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT count(*) FROM private.rotate_session('deactivated', 'd2', now() + interval '1 day'))::bigint,
  0::bigint,
  'a session of a deactivated user does not rotate'
);
RESET ROLE;

-- ============================================
-- 4. Helper EXECUTE grants
-- ============================================
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('find_user_for_login', 'create_user', 'set_password',
                        'create_session', 'rotate_session', 'revoke_session')
      AND p.prosecdef
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  6::bigint,
  'the six auth helpers are SECURITY DEFINER, executable by vipe_api, not by PUBLIC'
);

SELECT * FROM finish();
ROLLBACK;
