-- Profile privilege contract test.
--
-- 20261005120000 left the role question open on purpose: it wrote "only your own
-- row" on profiles UPDATE and "same tenant" on INSERT/DELETE, and its comment
-- deferred the role limits. That leaves three live holes:
--
--   1. A waiter can escalate itself. `USING (auth_user_id = auth.uid())` plus
--      `WITH CHECK (restaurant_id = ...)` never looks at `role`, so
--      PATCH /rest/v1/profiles?id=eq.<own id> {"role":"admin"}` promotes the
--      caller, and a promoted caller inherits every admin policy.
--   2. Anyone can rewrite its own restaurant_id / auth_user_id: moving the row
--      to another tenant is blocked by WITH CHECK, but re-pointing auth_user_id
--      is not, which swaps the row's identity link.
--   3. handle_new_user() read `role` from raw_user_meta_data, the jsonb a client
--      controls at signup, so signup was self-service privilege escalation.
--
-- This file pins the replacement contract:
--   - any authenticated user may UPDATE its own non-privileged columns;
--   - role changes require an admin of the same tenant; restaurant_id and
--     auth_user_id are immutable for every non-service caller;
--   - INSERT / DELETE are admin-only, same tenant;
--   - a new auth user's role comes from raw_app_meta_data (only the service role
--     or the admin API can write it), falling back to 'waiter'.
--
-- Impersonation follows 010_tenant_isolation.test.sql: SET LOCAL ROLE
-- authenticated plus request.jwt.claims. Row counts are read back as
-- `authenticated` through a data-modifying CTE, because an UPDATE that RLS
-- filters out raises nothing - it just touches zero rows.
--
-- Self-contained on purpose: `supabase test db` runs this file through pg_prove,
-- which does not wrap anything for us, so the file opens its own transaction
-- and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(37);

-- ============================================
-- Row-count probe
-- ============================================
-- The property under test is often "this statement touches N rows and nothing
-- else", and a data-modifying CTE cannot be nested inside a scalar subquery.
-- probe_exec() runs the caller's statement with the caller's privileges
-- (SECURITY INVOKER), so RLS and the privilege-guard trigger still apply
-- exactly as they do for the API, and returns the affected row count.
-- Created in pg_temp, so the test never leaves an object in schema public.
CREATE FUNCTION pg_temp.probe_exec(p_sql text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_rows integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- ============================================
-- Fixtures (as the test author / postgres)
-- ============================================
-- Tenant B is deliberately the OLDEST: the handle_new_user() fallback must
-- pick it, which no unordered "first row" can be relied on to do.
INSERT INTO public.restaurants (id, slug, name, created_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'priv-tenant-a', 'Privilege Tenant A', now() - interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'priv-tenant-b', 'Privilege Tenant B', now() - interval '2 days');

-- Tenant A: an admin, a waiter and a cashier. Tenant B: an admin.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Admin A","role":"admin"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Waiter A","role":"waiter"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Cashier A","role":"cashier"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Admin B","role":"admin"}'::jsonb, now(), now());

-- An admin-UI staff row: no auth_user_id, so `auth_user_id = auth.uid()` is
-- NULL for it rather than false.
INSERT INTO public.profiles (id, restaurant_id, full_name, username, role)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000ff', 'aaaaaaaa-0000-4000-8000-000000000001',
        'Unlinked A', 'unlinked-a', 'waiter');

-- handle_new_user() created one profile per user above; pin the tenant and the
-- role explicitly so this fixture does not depend on which metadata key the
-- trigger reads (that is what the section 4 assertions below measure).
UPDATE public.profiles
   SET restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001',
       role = CASE auth_user_id
                WHEN 'aaaaaaaa-0000-4000-8000-0000000000a1' THEN 'admin'
                WHEN 'aaaaaaaa-0000-4000-8000-0000000000a2' THEN 'waiter'
                WHEN 'aaaaaaaa-0000-4000-8000-0000000000a3' THEN 'cashier'
              END
 WHERE auth_user_id IN (
   'aaaaaaaa-0000-4000-8000-0000000000a1',
   'aaaaaaaa-0000-4000-8000-0000000000a2',
   'aaaaaaaa-0000-4000-8000-0000000000a3');
UPDATE public.profiles
   SET restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002',
       role = 'admin'
 WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1';

-- ============================================
-- 1. A waiter may edit itself, and only itself
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET full_name = 'Waiter A Renamed'
        WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$),
  1,
  'a waiter can update the non-privileged columns of its own row'
);

-- Self-promotion: the row is its own, and WITH CHECK passes because the tenant
-- does not change. Only a role check can stop this.
SELECT throws_ok(
  $$ UPDATE public.profiles
       SET role = 'admin'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'only an admin of the same tenant may change profiles.role',
  'a waiter cannot promote itself to admin'
);

SELECT throws_ok(
  $$ UPDATE public.profiles
       SET restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'profiles.restaurant_id is immutable',
  'a waiter cannot move its own row to tenant B'
);

SELECT throws_ok(
  $$ UPDATE public.profiles
       SET auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'profiles.auth_user_id is immutable',
  'a waiter cannot re-point its own row at another auth user'
);

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET full_name = 'Owned By Waiter'
        WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a3' $$),
  0,
  'a waiter updating a colleague''s row affects zero rows'
);

SELECT throws_ok(
  $$ INSERT INTO public.profiles (restaurant_id, full_name, username, role)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Intruder', 'intruder-a1', 'admin') $$,
  '42501', NULL,
  'a waiter cannot insert a profile'
);

SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.profiles
      WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a3' $$),
  0,
  'a waiter deleting a colleague''s row affects zero rows'
);

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles SET full_name = 'By Waiter' WHERE auth_user_id IS NULL $$),
  0,
  'a waiter updating an unlinked same-tenant profile affects zero rows'
);

SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.profiles WHERE auth_user_id IS NULL $$),
  0,
  'a waiter deleting an unlinked same-tenant profile affects zero rows'
);

RESET ROLE;

-- ============================================
-- 2. Nothing the waiter tried actually landed
-- ============================================
SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::text,
  'waiter'::text,
  'the waiter role is still waiter'
);
SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'the waiter row is still in tenant A'
);
SELECT is(
  (SELECT auth_user_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::uuid,
  'aaaaaaaa-0000-4000-8000-0000000000a2'::uuid,
  'the waiter row is still linked to its own auth user'
);
SELECT is(
  (SELECT full_name FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a3')::text,
  'Cashier A'::text,
  'the cashier row keeps its name'
);
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000ff')::text,
  'Unlinked A'::text, 'the unlinked same-tenant profile a waiter targeted still exists');
SELECT is(
  (SELECT count(*) FROM public.profiles WHERE username = 'intruder-a1')::bigint,
  0::bigint,
  'the waiter inserted no profile at all'
);

-- ============================================
-- 3. An admin of the same tenant runs the roster
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET role = 'cashier',
              full_name = 'Waiter A Reassigned'
        WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$),
  1,
  'an admin can change a colleague''s role and name in its own tenant'
);

-- Admin is not omnipotent: the two identity columns stay frozen for every
-- non-service caller, admin included.
SELECT throws_ok(
  $$ UPDATE public.profiles
       SET restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'profiles.restaurant_id is immutable',
  'an admin cannot move a profile to another tenant'
);
SELECT throws_ok(
  $$ UPDATE public.profiles
       SET auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'profiles.auth_user_id is immutable',
  'an admin cannot re-point a profile at another auth user'
);

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET full_name = 'Admin A Cross Tenant'
        WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1' $$),
  0,
  'a tenant A admin affects zero rows in tenant B'
);

-- The admin UI (components/admin/staff/WaiterForm.tsx) creates staff rows with
-- no auth_user_id; that path must keep working.
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.profiles (id, restaurant_id, full_name, username, role)
       VALUES ('aaaaaaaa-0000-4000-8000-00000000ff01',
               'aaaaaaaa-0000-4000-8000-000000000001', 'Guest Waiter', 'guest-waiter', 'waiter') $$),
  1,
  'an admin can insert a staff profile with no auth_user_id in its own tenant'
);

SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-00000000ff01' $$),
  1,
  'an admin can delete that profile again'
);

-- private.current_app_role() is re-read from profiles on every statement, so a
-- self-demotion lands at once: RLS stops treating the next statement as an
-- admin's, and the guard rejects the one row the demoter can still see.
SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles SET role = 'waiter'
      WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' $$),
  1,
  'an admin can demote itself'
);

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles SET role = 'cashier'
      WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$),
  0,
  'right after demoting itself, the next statement is filtered as a waiter'
);

SELECT throws_ok(
  $$ UPDATE public.profiles
       SET role = 'admin'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' $$,
  '42501',
  'only an admin of the same tenant may change profiles.role',
  'a self-demoted admin cannot promote itself back on the next statement'
);

RESET ROLE;

SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::text,
  'cashier'::text,
  'the admin role change landed'
);
SELECT is(
  (SELECT full_name FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::text,
  'Waiter A Reassigned'::text,
  'the admin name change landed'
);
SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'the admin could not move the profile out of its tenant'
);
SELECT is(
  (SELECT auth_user_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::uuid,
  'aaaaaaaa-0000-4000-8000-0000000000a2'::uuid,
  'the admin could not re-point the profile auth link'
);
SELECT is(
  (SELECT full_name FROM public.profiles
    WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1')::text,
  'Admin B'::text,
  'the tenant B admin row is untouched'
);

-- ============================================
-- 4. handle_new_user(): role is server-controlled, not signup-controlled
-- ============================================
-- User #1 claims admin in raw_user_meta_data, which the signup client writes.
-- User #2 claims kitchen in raw_user_meta_data while raw_app_meta_data (only
-- writable with the service role or the admin API) says cashier + tenant B.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-selfpromoted@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Self Promoted","role":"admin"}'::jsonb, now(), now()),
  ('dddddddd-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'priv-appmeta@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000002"}'::jsonb,
   '{"full_name":"App Meta User","role":"kitchen"}'::jsonb, now(), now());

SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'cccccccc-0000-4000-8000-0000000000c1')::text,
  'waiter'::text,
  'a signup claiming role=admin in user_metadata lands as waiter'
);
SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'dddddddd-0000-4000-8000-0000000000d1')::text,
  'cashier'::text,
  'app_metadata role=cashier wins over a user_metadata claim of kitchen'
);
SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'dddddddd-0000-4000-8000-0000000000d1')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000002'::uuid,
  'app_metadata restaurant_id places the new profile in tenant B'
);

-- User #3 carries no restaurant_id, so the fallback alone picks its tenant:
-- the oldest restaurant, deterministically. (Failing closed instead of guessing
-- is a stricter variant tracked as a follow-up, not done in this migration.)
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('eeeeeeee-0000-4000-8000-0000000000e1', 'priv-notenant@example.com',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"No Tenant"}'::jsonb);

SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'eeeeeeee-0000-4000-8000-0000000000e1')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000002'::uuid,
  'a signup with no app_metadata restaurant_id lands in the OLDEST restaurant'
);

-- ============================================
-- 5. Triangulation: the two edges the app depends on
-- ============================================
-- (a) The app PATCHes the whole row it selected (components/admin/staff/
-- WaiterForm.tsx, lib/supabase/service.ts), so a non-admin sending its own
-- current role back must not be rejected. The guard compares with IS DISTINCT
-- FROM exactly so this stays possible.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET full_name = 'Waiter A Renamed Again',
              role = 'cashier'
        WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$),
  1,
  'a waiter may PATCH its whole row while role keeps its current value'
);

-- (b) The role guard is not a promotion guard: any role change needs an admin,
-- lateral move to a different non-admin role included.
SELECT throws_ok(
  $$ UPDATE public.profiles
       SET role = 'kitchen'
     WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2' $$,
  '42501',
  'only an admin of the same tenant may change profiles.role',
  'a waiter cannot change its role to another non-admin role either'
);

RESET ROLE;

-- (c) The documented service escape hatch must keep working: the dashboard /
-- SQL editor / provisioning path runs as service_role and is trusted by
-- definition, otherwise migrations and admin tooling could never fix a profile.
SET LOCAL ROLE service_role;

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.profiles
          SET role = 'admin',
              restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002'
        WHERE auth_user_id = 'cccccccc-0000-4000-8000-0000000000c1' $$),
  1,
  'service_role still bypasses the guard (dashboard / provisioning path)'
);

RESET ROLE;

SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'cccccccc-0000-4000-8000-0000000000c1')::text,
  'admin'::text,
  'the service_role role change landed'
);

SELECT * FROM finish();
ROLLBACK;