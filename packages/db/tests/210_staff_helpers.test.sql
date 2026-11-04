-- Staff management through gated SECURITY DEFINER helpers
-- (odd/tasks/migracion-backend-nestjs.md, T12 design step 1; closes the T5
-- open risk: users had no RLS and create_user/set_password had no gate).
--
-- Every helper resolves the caller from app.user_id and checks INSIDE the
-- function that it is an active admin, that the target is in the caller's
-- restaurant, is not an admin and is not the caller, and that the role is one
-- of waiter|kitchen|cashier|delivery_operator.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(55);

-- Fixtures (as the test author): restaurant 1 with two admins, an inactive
-- admin, a waiter and a waiter assigned to a table; restaurant 2 with an admin
-- and a waiter.
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('21000000-0000-0000-0000-0000000000a1', 't210-a', 'T210 A'),
  ('21000000-0000-0000-0000-0000000000b2', 't210-b', 'T210 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('21000000-0000-0000-0000-000000000001', 'admin@t210a.test', 'h'),
  ('21000000-0000-0000-0000-000000000002', 'admin2@t210a.test', 'h'),
  ('21000000-0000-0000-0000-000000000003', 'off-admin@t210a.test', 'h'),
  ('21000000-0000-0000-0000-000000000004', 'waiter@t210a.test', 'h'),
  ('21000000-0000-0000-0000-000000000005', 'tabled@t210a.test', 'h'),
  ('21000000-0000-0000-0000-000000000006', 'admin@t210b.test', 'h'),
  ('21000000-0000-0000-0000-000000000007', 'waiter@t210b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('22000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t210a.test', 'admin', true, '21000000-0000-0000-0000-0000000000a1'),
  ('22000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Admin A2', 'admin2@t210a.test', 'admin', true, '21000000-0000-0000-0000-0000000000a1'),
  ('22000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000003', 'Off Admin', 'off-admin@t210a.test', 'admin', false, '21000000-0000-0000-0000-0000000000a1'),
  ('22000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000004', 'Waiter A', 'waiter@t210a.test', 'waiter', true, '21000000-0000-0000-0000-0000000000a1'),
  ('22000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000005', 'Tabled A', 'tabled@t210a.test', 'waiter', true, '21000000-0000-0000-0000-0000000000a1'),
  ('22000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000006', 'Admin B', 'admin@t210b.test', 'admin', true, '21000000-0000-0000-0000-0000000000b2'),
  ('22000000-0000-0000-0000-000000000007', '21000000-0000-0000-0000-000000000007', 'Waiter B', 'waiter@t210b.test', 'waiter', true, '21000000-0000-0000-0000-0000000000b2');
INSERT INTO public.tables (number, status, waiter_id, restaurant_id) VALUES
  (2101, 'occupied', '22000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-0000000000a1');

-- ============================================
-- 1. users RLS: only users of the caller's restaurant (plus the caller)
-- ============================================
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass),
  'public.users has row level security enabled'
);

SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT count(*) FROM public.users)::bigint,
  0::bigint,
  'without app.user_id vipe_api sees no users'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT is(
  (SELECT count(*) FROM public.users WHERE email::text LIKE '%@t210b.test')::bigint,
  0::bigint,
  'an admin of A sees no user of B'
);
SELECT is(
  (SELECT count(*) FROM public.users WHERE email::text LIKE '%@t210a.test')::bigint,
  5::bigint,
  'an admin of A sees every user with a profile in A'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000007', true);
SELECT is(
  (SELECT array_agg(email::text ORDER BY email) FROM public.users WHERE email::text LIKE '%t210%'),
  ARRAY['admin@t210b.test', 'waiter@t210b.test'],
  'a waiter of B sees only the users of B'
);

-- ============================================
-- 2. create_staff_user
-- ============================================
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ SELECT private.create_staff_user('New.Cook@T210a.test', 'hash-cook', 'argon2id', 'Cook A', 'cook', 'kitchen', false) $$,
  'an active admin creates a kitchen account'
);
SELECT results_eq(
  $$ SELECT p.full_name::text, p.username::text, p.email::text, p.role::text, p.active, p.restaurant_id
       FROM public.profiles p JOIN public.users u ON u.id = p.user_id
      WHERE u.email = 'new.cook@t210a.test' $$,
  $$ VALUES ('Cook A', 'cook', 'New.Cook@T210a.test', 'kitchen', false, '21000000-0000-0000-0000-0000000000a1'::uuid) $$,
  'the profile is created in the caller''s restaurant with every field'
);
SELECT results_eq(
  $$ SELECT password_hash, password_algo, is_active FROM private.find_user_for_login('new.cook@t210a.test') $$,
  $$ VALUES ('hash-cook', 'argon2id', true) $$,
  'the login identity stores the given hash'
);
SELECT lives_ok(
  $$ SELECT private.create_staff_user('w@t210a.test', 'h', 'argon2id', 'W', NULL, 'waiter', true),
            private.create_staff_user('c@t210a.test', 'h', 'argon2id', 'C', NULL, 'cashier', true),
            private.create_staff_user('d@t210a.test', 'h', 'argon2id', 'D', NULL, 'delivery_operator', true) $$,
  'waiter, cashier and delivery_operator are creatable'
);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('boss@t210a.test', 'h', 'argon2id', 'Boss', NULL, 'admin', true) $$,
  '22023', 'El rol no es válido',
  'an admin account is never created through the helper'
);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('root@t210a.test', 'h', 'argon2id', 'Root', NULL, 'superuser', true) $$,
  '22023', 'El rol no es válido',
  'a role outside the allow-list is refused'
);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('WAITER@t210a.test', 'h', 'argon2id', 'Dup', NULL, 'waiter', true) $$,
  '23505', NULL,
  'a duplicate email (any case) raises 23505'
);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('md5@t210a.test', 'h', 'md5', 'X', NULL, 'waiter', true) $$,
  '22023', NULL,
  'an unknown password algorithm is refused'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000004', true);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('x1@t210a.test', 'h', 'argon2id', 'X', NULL, 'waiter', true) $$,
  '42501', NULL,
  'a waiter cannot create staff'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('x2@t210a.test', 'h', 'argon2id', 'X', NULL, 'waiter', true) $$,
  '42501', NULL,
  'an inactive admin cannot create staff'
);
SELECT set_config('app.user_id', '', true);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('x3@t210a.test', 'h', 'argon2id', 'X', NULL, 'waiter', true) $$,
  '42501', NULL,
  'no app.user_id cannot create staff'
);

-- ============================================
-- 3. update_staff_profile
-- ============================================
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000004', 'Waiter Renamed', 'wr', false, 'cashier') $$,
  'an admin updates a staff profile of the same restaurant'
);
SELECT results_eq(
  $$ SELECT full_name::text, username::text, active, role::text FROM public.profiles WHERE id = '22000000-0000-0000-0000-000000000004' $$,
  $$ VALUES ('Waiter Renamed', 'wr', false, 'cashier') $$,
  'every field is written'
);
SELECT lives_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000004', NULL, '', NULL, NULL) $$,
  'null fields keep their value and an empty username clears it'
);
SELECT results_eq(
  $$ SELECT full_name::text, username::text, active, role::text FROM public.profiles WHERE id = '22000000-0000-0000-0000-000000000004' $$,
  $$ VALUES ('Waiter Renamed', NULL::text, false, 'cashier') $$,
  'only the username changed'
);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000004', NULL, NULL, NULL, 'admin') $$,
  '22023', 'El rol no es válido',
  'a staff profile cannot be promoted to admin'
);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000002', 'X', NULL, NULL, NULL) $$,
  '42501', NULL,
  'another admin cannot be updated'
);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000001', 'Me', NULL, NULL, NULL) $$,
  '42501', NULL,
  'the caller cannot update their own profile'
);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000007', 'X', NULL, NULL, NULL) $$,
  'P0002', NULL,
  'a profile of another restaurant is not found'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000005', true);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000004', 'X', NULL, NULL, NULL) $$,
  '42501', NULL,
  'a waiter cannot update staff'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000006', true);
SELECT throws_ok(
  $$ SELECT private.update_staff_profile('22000000-0000-0000-0000-000000000004', 'X', NULL, NULL, NULL) $$,
  'P0002', NULL,
  'an admin of B cannot update staff of A'
);

-- ============================================
-- 4. set_staff_password
-- ============================================
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ SELECT private.set_staff_password('22000000-0000-0000-0000-000000000004', 'hash-new', 'argon2id') $$,
  'an admin sets the password of a staff member'
);
SELECT results_eq(
  $$ SELECT password_hash, password_algo FROM private.find_user_for_login('waiter@t210a.test') $$,
  $$ VALUES ('hash-new', 'argon2id') $$,
  'the new hash is stored'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_password('22000000-0000-0000-0000-000000000002', 'x', 'argon2id') $$,
  '42501', NULL,
  'the password of another admin cannot be set'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_password('22000000-0000-0000-0000-000000000001', 'x', 'argon2id') $$,
  '42501', NULL,
  'the caller cannot set their own password through the staff helper'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_password('22000000-0000-0000-0000-000000000007', 'x', 'argon2id') $$,
  'P0002', NULL,
  'the password of another restaurant''s staff cannot be set'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000005', true);
SELECT throws_ok(
  $$ SELECT private.set_staff_password('22000000-0000-0000-0000-000000000004', 'x', 'argon2id') $$,
  '42501', NULL,
  'a waiter cannot set passwords'
);

-- ============================================
-- 5. delete_staff_user
-- ============================================
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000005', true);
SELECT throws_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000004') $$,
  '42501', NULL,
  'a waiter cannot delete staff'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000006', true);
SELECT throws_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000004') $$,
  'P0002', NULL,
  'an admin of B cannot delete staff of A'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT throws_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000002') $$,
  '42501', NULL,
  'another admin cannot be deleted'
);
SELECT throws_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000001') $$,
  '42501', NULL,
  'the caller cannot delete themselves'
);
SELECT throws_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000005') $$,
  'P0001', 'El integrante tiene mesas asignadas',
  'a staff member with assigned tables is not deleted'
);
SELECT lives_ok(
  $$ SELECT private.delete_staff_user('22000000-0000-0000-0000-000000000004') $$,
  'an admin deletes a staff member of the same restaurant'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.users WHERE id = '21000000-0000-0000-0000-000000000004')::bigint
    + (SELECT count(*) FROM public.profiles WHERE id = '22000000-0000-0000-0000-000000000004')::bigint,
  0::bigint,
  'the user row is gone and the profile cascaded'
);

-- ============================================
-- 6. Ungated helpers
-- ============================================
SELECT ok(
  NOT has_function_privilege('vipe_api', 'private.create_user(public.citext, text, text)', 'EXECUTE'),
  'vipe_api can no longer execute the ungated private.create_user'
);
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT throws_ok(
  $$ SELECT private.set_password('21000000-0000-0000-0000-000000000006', 'x', 'argon2id') $$,
  '42501', NULL,
  'set_password refuses a user other than the caller'
);
SELECT set_config('app.user_id', '', true);
SELECT throws_ok(
  $$ SELECT private.set_password('21000000-0000-0000-0000-000000000006', 'x', 'argon2id') $$,
  '42501', NULL,
  'set_password refuses a caller without app.user_id'
);
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000006', true);
SELECT lives_ok(
  $$ SELECT private.set_password('21000000-0000-0000-0000-000000000006', 'hash-self', 'argon2id') $$,
  'set_password re-hashes the caller''s own password'
);
SELECT results_eq(
  $$ SELECT password_hash FROM private.find_user_for_login('admin@t210b.test') $$,
  $$ VALUES ('hash-self') $$,
  'the caller''s own hash is replaced'
);
RESET ROLE;

-- ============================================
-- 6b. Direct profiles DML cannot bypass the helpers
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT throws_ok(
  $$ UPDATE public.profiles SET role = 'admin' WHERE id = '22000000-0000-0000-0000-000000000005' $$,
  '42501', NULL,
  'an admin cannot promote a waiter to admin with direct DML'
);
SELECT throws_ok(
  $$ DELETE FROM public.profiles WHERE id = '22000000-0000-0000-0000-000000000002' $$,
  '42501', NULL,
  'an admin cannot delete another admin with direct DML'
);
SELECT throws_ok(
  $$ INSERT INTO public.profiles (full_name, role, restaurant_id) VALUES ('X', 'admin', '21000000-0000-0000-0000-0000000000a1') $$,
  '42501', NULL,
  'an admin cannot insert an admin profile with direct DML'
);
RESET ROLE;

-- set_staff_password ends the member's sessions.
INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at)
VALUES ('21000000-0000-0000-0000-000000000005', 't210-session', now() + interval '1 day');
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000001', true);
SELECT private.set_staff_password('22000000-0000-0000-0000-000000000005', 'hash-tabled', 'argon2id');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.auth_sessions WHERE user_id = '21000000-0000-0000-0000-000000000005' AND revoked_at IS NULL)::bigint,
  0::bigint,
  'set_staff_password revokes the member''s open sessions'
);

-- An admin whose login is inactive cannot create staff.
UPDATE public.users SET is_active = false WHERE id = '21000000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '21000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$ SELECT private.create_staff_user('x4@t210a.test', 'h', 'argon2id', 'X', NULL, 'waiter', true) $$,
  '42501', NULL,
  'an admin with an inactive user cannot create staff'
);
RESET ROLE;

SELECT ok(
  NOT has_function_privilege('vipe_api', 'private.staff_target(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('vipe_api', 'private.check_staff_role(text)', 'EXECUTE'),
  'the internal gates staff_target and check_staff_role are not callable by vipe_api'
);
SELECT ok(
  NOT has_table_privilege('vipe_api', 'public.profiles', 'INSERT')
  AND NOT has_table_privilege('vipe_api', 'public.profiles', 'UPDATE')
  AND NOT has_table_privilege('vipe_api', 'public.profiles', 'DELETE'),
  'vipe_api writes profiles only through the helpers'
);

-- ============================================
-- 7. Grants
-- ============================================
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('create_staff_user', 'update_staff_profile', 'delete_staff_user', 'set_staff_password')
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  4::bigint,
  'the four staff helpers are SECURITY DEFINER, pinned, executable by vipe_api, not by PUBLIC'
);
SELECT ok(
  NOT has_function_privilege('vipe_api', 'private.staff_admin_restaurant()', 'EXECUTE'),
  'the internal admin gate is not callable by vipe_api'
);
SELECT ok(
  NOT has_any_column_privilege('vipe_api', 'public.users', 'INSERT')
  AND NOT has_any_column_privilege('vipe_api', 'public.users', 'UPDATE')
  AND NOT has_table_privilege('vipe_api', 'public.users', 'DELETE'),
  'vipe_api still writes users only through the helpers'
);
SELECT ok(
  NOT has_column_privilege('vipe_api', 'public.users', 'password_hash', 'SELECT'),
  'vipe_api still cannot read password_hash'
);

SELECT * FROM finish();
ROLLBACK;
