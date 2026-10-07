-- Payment-method catalog contract test.
--
-- The POS checkout flow had no first-class payment-method catalog: methods were
-- free-text strings on the payment rows, so nothing could enforce "cash is the
-- only method that gives change", nothing could rename a method consistently,
-- and nothing kept one tenant's catalog out of another's.
--
-- This file pins the replacement contract on public.payment_methods:
--   - a per-tenant catalog: restaurant_id NOT NULL, defaulted to the caller's
--     tenant through private.default_restaurant_id(), UNIQUE (restaurant_id,
--     code) so the same code can exist in two tenants but not twice in one;
--   - `kind` ('cash' | 'electronic') is the ONLY column that decides whether a
--     method gives change - asserted here as an exact column count, so a later
--     `gives_change` boolean cannot quietly fork the rule;
--   - `code` is the stable key the payment rows will carry, so it is immutable
--     after insert for every non-service caller (42501), the same guard shape
--     public.profiles uses in 20261005140000;
--   - reads are same-tenant for every role (inactive rows included, so order
--     history still renders a method that was deactivated afterwards); writes
--     are admin-only and same-tenant;
--   - every existing restaurant gets the four defaults (Efectivo/Transferencia/
--     Nequi/Bancolombia) and so does every restaurant created later, through an
--     AFTER INSERT trigger on public.restaurants;
--   - anon holds nothing on the table.
--
-- Assertions read tenant identity with explicit `restaurant_id = ...` filters and
-- route every table-dependent read through pg_temp.pm_count/pm_text, so the file
-- compiles and runs to completion against the pre-migration schema: RED is a
-- wall of failed assertions rather than a file that dies on a missing relation.
--
-- Impersonation follows 010/030/040: SET LOCAL ROLE authenticated plus
-- request.jwt.claims, row counts read back through pg_temp.probe_exec because
-- an UPDATE/DELETE that RLS filters out raises nothing.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(58);

-- ============================================
-- Helpers
-- ============================================
-- pm_count / pm_text run the caller's query with the caller's privileges
-- (SECURITY INVOKER), so RLS applies exactly as it does for the API, and turn
-- any error into a sentinel. Against the pre-migration schema the relation does
-- not exist, and a sentinel is what keeps this file runnable (and RED) there
-- instead of aborting the whole transaction on the first assertion.
CREATE FUNCTION pg_temp.pm_count(p_sql text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v bigint;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RETURN -1;
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.pm_text(p_sql text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RETURN '<pm-error>';
  END;
  RETURN v;
END;
$$;

-- Privilege probe that tolerates a missing relation (returns NULL instead of
-- aborting), so the pre-migration run stays a complete RED. NULL fails every
-- expected boolean.
CREATE FUNCTION pg_temp.pm_has_privilege(p_role text, p_table text, p_priv text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_table regclass;
  v boolean;
BEGIN
  BEGIN
    v_table := to_regclass(p_table);
    IF v_table IS NULL THEN
      RETURN NULL;
    END IF;
    v := has_table_privilege(p_role, v_table, p_priv);
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

-- Runs the caller's statement with the caller's privileges and returns the
-- affected row count, so "this write touches zero rows" can be measured. An
-- errored statement returns -1 instead of aborting the file, which keeps the
-- pre-migration run (where the relation does not exist yet) a complete RED
-- rather than a truncated one; -1 still fails every expected count.
CREATE FUNCTION pg_temp.probe_exec(p_sql text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_rows integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN others THEN
    RETURN -1;
  END;
  RETURN v_rows;
END;
$$;

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_table('public', 'payment_methods', 'public.payment_methods exists');

SELECT has_column('public', 'payment_methods', 'restaurant_id',
  'payment_methods is tenant-scoped');
SELECT has_column('public', 'payment_methods', 'code',
  'payment_methods carries a stable code');
SELECT has_column('public', 'payment_methods', 'name',
  'payment_methods carries a display name');
SELECT has_column('public', 'payment_methods', 'kind',
  'payment_methods carries a kind');
SELECT has_column('public', 'payment_methods', 'is_active',
  'payment_methods carries an is_active flag');
SELECT has_column('public', 'payment_methods', 'sort_order',
  'payment_methods carries a sort_order');

-- `kind = 'cash'` is the whole rule for "this method gives change", so there is
-- deliberately no second boolean for it. An exact column count pins that: a
-- later `gives_change` column would fork the rule and make the two disagree.
SELECT is(
  (SELECT count(*)::bigint FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payment_methods'), 9::bigint,
  'payment_methods has exactly the nine contracted columns (no extra change column)');

SELECT is(
  pg_temp.pm_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.payment_methods') $$),
  'true'::text,
  'RLS is enabled on payment_methods');

SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_methods'), 4::bigint,
  'payment_methods carries one policy per command');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payment_methods')
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%restaurant_id%'), 1::bigint,
  'payment_methods uniqueness spans (restaurant_id, code)');

-- The catalog is read ordered by sort_order on every checkout screen, and the
-- catalog is per tenant, so the index has to be per tenant too.
SELECT is(
  (SELECT count(*)::bigint FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'payment_methods'
      AND indexdef LIKE '%(restaurant_id, sort_order)%'), 1::bigint,
  'payment_methods is indexed on (restaurant_id, sort_order)');

SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.payment_methods')
      AND p.proname = 'payment_methods_set_updated_at'
      AND (tg.tgtype::int & 2) = 2      -- BEFORE
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'a BEFORE UPDATE trigger maintains payment_methods.updated_at');

-- A policy can only see the row and the JWT, never "who is calling", so the
-- immutability of `code` has to be a trigger (same reasoning as
-- public.guard_profiles_privileged_columns in 20261005140000).
SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.payment_methods')
      AND p.proname = 'guard_payment_methods_code_immutable'
      AND (tg.tgtype::int & 2) = 2      -- BEFORE
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'a BEFORE UPDATE trigger freezes payment_methods.code');

SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.restaurants')
      AND p.proname = 'seed_payment_methods_defaults'
      AND (tg.tgtype::int & 4) = 4),    1::bigint,
  'an AFTER INSERT trigger on restaurants seeds the default payment methods');

-- ============================================
-- 2. Fixtures: tenant A and tenant B
-- ============================================
-- The trigger above must fire for rows inserted after the migration ran, which
-- is exactly what these two restaurants exercise.
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000051', 'pay-tenant-a', 'Pay Tenant A'),
  ('bbbbbbbb-0000-4000-8000-000000000052', 'pay-tenant-b', 'Pay Tenant B');

-- Tenant and role ride on raw_app_meta_data, the server-controlled half of the
-- identity handle_new_user() reads (20261005140000).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pay-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000051"}'::jsonb,
   '{"full_name":"Pay Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pay-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000051"}'::jsonb,
   '{"full_name":"Pay Cashier A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pay-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000052"}'::jsonb,
   '{"full_name":"Pay Admin B"}'::jsonb, now(), now());

SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::text,
  'cashier'::text,
  'fixture: the tenant A cashier profile carries the cashier role');

-- ============================================
-- 3. The seeded defaults
-- ============================================
-- The restaurant created by 20250917090005 predates this migration, so its
-- four defaults come from the migration's own backfill.
SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods
                      WHERE restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' $$),
  4::bigint,
  'the pre-existing restaurant got exactly the four default payment methods');

SELECT is(
  pg_temp.pm_text($$ SELECT string_agg(code || ':' || kind || ':' || sort_order::text,
                                         ',' ORDER BY sort_order, code)
                      FROM public.payment_methods
                     WHERE restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' $$),
  'cash:cash:10,transfer:electronic:20,nequi:electronic:30,bancolombia:electronic:40'::text,
  'the seeded defaults carry the contracted codes, kinds and order');

SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods
                      WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000051' $$),
  4::bigint,
  'a restaurant created after the migration got the four defaults too');

SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods
                      WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000052' $$),
  4::bigint,
  'and so did the second one');

SELECT is(
  pg_temp.pm_text($$ SELECT string_agg(code, ',' ORDER BY sort_order, code)
                      FROM public.payment_methods
                     WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000051' $$),
  'cash,transfer,nequi,bancolombia'::text,
  'the defaults for a new restaurant are the same four codes, in order');

-- ============================================
-- 4. A cashier of tenant A: read its own catalog, write nothing
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.pm_count('SELECT count(*) FROM public.payment_methods'), 4::bigint,
  'a cashier of tenant A sees only the four tenant A methods');

SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('cashier_own', 'Cashier Owned', 'electronic') $$,
  '42501', NULL,
  'a cashier cannot create a payment method');
SELECT is(
  pg_temp.probe_exec($$ UPDATE public.payment_methods SET name = 'Hijacked'
                       WHERE code = 'cash' $$),
  0,
  'a cashier renaming a method affects zero rows');
SELECT is(
  pg_temp.probe_exec($$ DELETE FROM public.payment_methods WHERE code = 'cash' $$),
  0,
  'a cashier deleting a method affects zero rows');

RESET ROLE;

-- ============================================
-- 5. An admin of tenant A: the full catalog write path
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- The admin payment-method form will POST { code, name, kind } and no
-- restaurant_id, so the DEFAULT has to place it.
SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.payment_methods (code, name, kind)
                       VALUES ('card', 'Tarjeta', 'electronic') $$),
  1,
  'an admin can create a method without naming restaurant_id');

SELECT is(
  pg_temp.pm_text($$ SELECT restaurant_id::text FROM public.payment_methods
                       WHERE code = 'card' $$),
  'aaaaaaaa-0000-4000-8000-000000000051'::text,
  'the method inserted without restaurant_id landed in the caller''s own tenant');

SELECT is(
  pg_temp.probe_exec($$ UPDATE public.payment_methods SET name = 'Tarjeta de credito'
                       WHERE code = 'card' $$),
  1,
  'an admin can rename its own tenant''s method');

SELECT is(
  pg_temp.pm_text($$ SELECT name FROM public.payment_methods WHERE code = 'card' $$),
  'Tarjeta de credito'::text,
  'the rename took effect');

-- Deactivating is a soft delete: the row stays so historical payments keep
-- resolving their method.
SELECT is(
  pg_temp.probe_exec($$ UPDATE public.payment_methods SET is_active = false
                       WHERE code = 'card' $$),
  1,
  'an admin can deactivate a method');

SELECT is(
  pg_temp.pm_text($$ SELECT is_active::text FROM public.payment_methods WHERE code = 'card' $$),
  'false'::text,
  'the method is inactive');

SELECT is(
  pg_temp.probe_exec($$ UPDATE public.payment_methods SET sort_order = 5
                       WHERE code = 'card' $$),
  1,
  'an admin can reorder a method');

SELECT is(
  pg_temp.pm_text($$ SELECT sort_order::text FROM public.payment_methods WHERE code = 'card' $$),
  '5'::text,
  'the new sort order took effect');

RESET ROLE;

-- ============================================
-- 6. A deactivated method is still readable by the cashier
-- ============================================
-- Order history renders the method that was used, so is_active must filter the
-- checkout picker in the query, not in the row-level read.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.pm_count('SELECT count(*) FROM public.payment_methods'), 5::bigint,
  'the cashier now sees the fifth method the admin added');
SELECT is(
  pg_temp.pm_count('SELECT count(*) FROM public.payment_methods WHERE NOT is_active'), 1::bigint,
  'the inactive method is still visible to the cashier');
SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods
                      WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000052' $$),
  0::bigint,
  'the cashier sees none of tenant B''s methods');

RESET ROLE;

-- ============================================
-- 7. An admin of tenant A cannot touch tenant B
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ UPDATE public.payment_methods SET name = 'Stolen'
                       WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000052' $$),
  0,
  'an admin of tenant A affects zero rows in tenant B');
SELECT is(
  pg_temp.probe_exec($$ DELETE FROM public.payment_methods
                       WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000052' $$),
  0,
  'an admin of tenant A deletes zero rows in tenant B');
SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (restaurant_id, code, name, kind)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000052', 'sneaky', 'Sneaky', 'electronic') $$,
  '42501', NULL,
  'an admin cannot create a method inside another tenant');

RESET ROLE;

SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods
                      WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000052' $$),
  4::bigint,
  'tenant B still holds exactly its four untouched defaults');

-- ============================================
-- 8. `code` is immutable, admin included
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ UPDATE public.payment_methods SET code = 'card_renamed' WHERE code = 'card' $$,
  '42501', NULL,
  'an admin cannot change the code of a payment method');

RESET ROLE;

SELECT is(
  pg_temp.pm_text($$ SELECT code FROM public.payment_methods WHERE code = 'card' $$),
  'card'::text,
  'the code is unchanged after the rejected update');

-- ============================================
-- 9. Uniqueness is per tenant
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 'card' already exists in tenant A: a second tenant may still own it.
SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.payment_methods (code, name, kind)
                       VALUES ('card', 'Tarjeta B', 'electronic') $$),
  1,
  'tenant B may own a code that tenant A already uses');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('cash', 'Efectivo duplicado', 'cash') $$,
  '23505', NULL,
  'the same tenant cannot create the same code twice');

RESET ROLE;

SELECT is(
  pg_temp.pm_count($$ SELECT count(*) FROM public.payment_methods WHERE code = 'card' $$),
  2::bigint,
  'the code shared by two tenants exists once in each');

-- ============================================
-- 10. Invalid values are rejected
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('Bad-Code', 'Upper and dash', 'electronic') $$,
  '23514', NULL,
  'a code outside [a-z0-9_] is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('   ', 'Blank code', 'electronic') $$,
  '23514', NULL,
  'a code shorter than two characters is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('blank_name', '   ', 'electronic') $$,
  '23514', NULL,
  'a blank display name is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('long_name', repeat('x', 61), 'electronic') $$,
  '23514', NULL,
  'a display name longer than 60 characters is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.payment_methods (code, name, kind)
     VALUES ('crypto', 'Cripto', 'crypto') $$,
  '23514', NULL,
  'a kind outside (cash, electronic) is rejected');

RESET ROLE;

-- ============================================
-- 11. Privileges
-- ============================================
-- The anon key ships in the browser bundle, so every privilege here is a
-- privilege every visitor of the login screen holds (see 020_anon_lockdown).
SELECT is(pg_temp.pm_has_privilege('anon', 'public.payment_methods', 'SELECT'), false,
  'anon cannot SELECT payment_methods');
SELECT is(pg_temp.pm_has_privilege('anon', 'public.payment_methods', 'INSERT'), false,
  'anon cannot INSERT payment_methods');
SELECT is(pg_temp.pm_has_privilege('anon', 'public.payment_methods', 'UPDATE'), false,
  'anon cannot UPDATE payment_methods');
SELECT is(pg_temp.pm_has_privilege('anon', 'public.payment_methods', 'DELETE'), false,
  'anon cannot DELETE payment_methods');

-- Guard against over-revoking: every role reads the catalog at checkout.
SELECT is(pg_temp.pm_has_privilege('authenticated', 'public.payment_methods', 'SELECT'), true,
  'authenticated keeps SELECT on payment_methods');
SELECT is(pg_temp.pm_has_privilege('authenticated', 'public.payment_methods', 'INSERT'), true,
  'authenticated keeps INSERT on payment_methods');
SELECT is(pg_temp.pm_has_privilege('authenticated', 'public.payment_methods', 'UPDATE'), true,
  'authenticated keeps UPDATE on payment_methods');
SELECT is(pg_temp.pm_has_privilege('authenticated', 'public.payment_methods', 'DELETE'), true,
  'authenticated keeps DELETE on payment_methods');

SELECT * FROM finish();
ROLLBACK;