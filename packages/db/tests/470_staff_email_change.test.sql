-- H-029 (odd/tasks/qa-noviembre-2026.md T7): migration 0042 adds
-- private.set_staff_email, gated like the other staff helpers of 0011.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(9);

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('47000000-0000-0000-0000-0000000000a1', 't470-a', 'T470 A'),
  ('47000000-0000-0000-0000-0000000000b2', 't470-b', 'T470 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('47000000-0000-0000-0000-000000000001', 'admin@t470a.test', 'h'),
  ('47000000-0000-0000-0000-000000000002', 'admin2@t470a.test', 'h'),
  ('47000000-0000-0000-0000-000000000003', 'waiter@t470a.test', 'h'),
  ('47000000-0000-0000-0000-000000000004', 'cook@t470a.test', 'h'),
  ('47000000-0000-0000-0000-000000000005', 'waiter@t470b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('48000000-0000-0000-0000-000000000001', '47000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t470a.test', 'admin', true, '47000000-0000-0000-0000-0000000000a1'),
  ('48000000-0000-0000-0000-000000000002', '47000000-0000-0000-0000-000000000002', 'Admin A2', 'admin2@t470a.test', 'admin', true, '47000000-0000-0000-0000-0000000000a1'),
  ('48000000-0000-0000-0000-000000000003', '47000000-0000-0000-0000-000000000003', 'Waiter A', 'waiter@t470a.test', 'waiter', true, '47000000-0000-0000-0000-0000000000a1'),
  ('48000000-0000-0000-0000-000000000004', '47000000-0000-0000-0000-000000000004', 'Cook A', 'cook@t470a.test', 'kitchen', true, '47000000-0000-0000-0000-0000000000a1'),
  ('48000000-0000-0000-0000-000000000005', '47000000-0000-0000-0000-000000000005', 'Waiter B', 'waiter@t470b.test', 'waiter', true, '47000000-0000-0000-0000-0000000000b2');

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '47000000-0000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000003', 'nuevo.mesero@t470a.test') $$,
  'an admin changes the login email of a member of the restaurant'
);
RESET ROLE;
SELECT is(
  (SELECT u.email::text || ' ' || p.email FROM public.users u JOIN public.profiles p ON p.user_id = u.id
    WHERE p.id = '48000000-0000-0000-0000-000000000003'),
  'nuevo.mesero@t470a.test nuevo.mesero@t470a.test',
  'users.email and profiles.email both carry the new email'
);
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000004', 'NUEVO.MESERO@t470a.test') $$,
  '23505', NULL, 'an email in use (any case) is refused'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000002', 'x@t470a.test') $$,
  '42501', NULL, 'an admin target is refused'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000001', 'x@t470a.test') $$,
  '42501', NULL, 'the caller is refused'
);
SELECT throws_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000005', 'x@t470a.test') $$,
  'P0002', NULL, 'a member of another restaurant is refused'
);
SELECT set_config('app.user_id', '47000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$ SELECT private.set_staff_email('48000000-0000-0000-0000-000000000004', 'x@t470a.test') $$,
  '42501', NULL, 'a waiter cannot change emails'
);
RESET ROLE;
SELECT is(
  (SELECT u.email::text FROM public.users u WHERE u.id = '47000000-0000-0000-0000-000000000004'),
  'cook@t470a.test',
  'the refused changes leave the email unchanged'
);
SELECT ok(
  NOT has_function_privilege('public', 'private.set_staff_email(uuid, public.citext)', 'EXECUTE'),
  'PUBLIC cannot execute set_staff_email'
);

SELECT * FROM finish();
ROLLBACK;
