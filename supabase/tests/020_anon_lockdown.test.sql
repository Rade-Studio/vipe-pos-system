-- Anon lockdown contract test.
--
-- The anon key ships in the browser bundle, so `anon` is public knowledge: any
-- privilege it holds is a privilege every visitor of the login screen holds.
-- Migration 20261005120000 rewrote the tenant policies `TO authenticated`, which
-- makes RLS return zero rows to `anon`, but it left the privileges in place, and
-- three tables have no RLS at all (business_config, ingredient_categories,
-- ingredient_transactions_orders) plus restaurants. Privileges, not policies,
-- are what this file pins down.
--
-- It also pins the two role memberships the init migration created
-- (`GRANT anon TO authenticated; GRANT service_role TO authenticated;`), which
-- let every logged-in account inherit the anon and service_role grants.
--
-- Step 0 audit (pre-login data access): the Next.js client makes no Supabase
-- data call before a session exists. app/page.tsx gates every loader on
-- isAuthenticated, LoginView only calls supabase.auth.signInWithPassword,
-- ClientProviders/layout.tsx/theme touch no data, and useConfigStore
-- loadConfigFromDB -> business_config is only reached from the authenticated
-- branch (the ConfigurationPanel/PasswordDialog callers render post-login).
-- pos/app.py (printer listener) reads no table; it only subscribes to Realtime
-- broadcasts with PRINTER_TOKEN. Therefore NO pre-login exception is granted
-- here and every `anon` privilege in schema public is revoked.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(29);

-- ============================================
-- 1. Tables: anon holds nothing
-- ============================================
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m')
      AND has_table_privilege('anon', c.oid, p.priv)
  ),
  0::bigint,
  'anon holds no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any public table'
);

-- Named explicitly because business_config is the sharpest hole: no RLS at all,
-- so the anon SELECT reads every restaurant's branding, tax and NIT.
SELECT is(
  has_table_privilege('anon', 'public.business_config', 'SELECT'),
  false,
  'anon cannot SELECT business_config'
);

-- Supabase grants the API roles CREATE on schema public through the schema ACL
-- (`anon=UC/...`), not through PUBLIC, so revoking from PUBLIC is not enough.
SELECT is(
  has_schema_privilege('anon', 'public', 'CREATE'),
  false,
  'anon cannot CREATE objects in schema public'
);

-- ============================================
-- 2. Sequences
-- ============================================
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND has_sequence_privilege('anon', c.oid, p.priv)
  ),
  0::bigint,
  'anon holds no USAGE/SELECT/UPDATE on any public sequence'
);

-- ============================================
-- 3. Functions
-- ============================================
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0::bigint,
  'anon has no EXECUTE on any public function'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0::bigint,
  'anon has no EXECUTE on any private function'
);

-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default, which
-- makes every SECURITY DEFINER RPC callable by the anon key.
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public'
      AND a.grantee = 0
  ),
  0::bigint,
  'no public function grants EXECUTE to PUBLIC'
);

-- Guard against over-revoking: the payments RPCs are the app's PostgREST path.
SELECT is(
  has_function_privilege('authenticated', 'public.pay_order(uuid,uuid,bigint,jsonb,uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on pay_order'
);
SELECT is(
  has_function_privilege('authenticated', 'public.register_summary(uuid[])', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on register_summary'
);
SELECT is(
  has_function_privilege('authenticated', 'public.close_register(uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on close_register'
);
SELECT is(
  has_function_privilege('authenticated', 'public.delete_order_with_items(uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on delete_order_with_items'
);
SELECT is(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  true,
  'authenticated keeps USAGE on schema private for the tenant helpers'
);

-- ============================================
-- 4. Role memberships (init migration leak)
-- ============================================
SELECT is(
  pg_has_role('authenticated', 'anon', 'MEMBER'),
  false,
  'authenticated is not a member of anon'
);
SELECT is(
  pg_has_role('authenticated', 'service_role', 'MEMBER'),
  false,
  'authenticated is not a member of service_role'
);
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE member.rolname = 'authenticated'
      AND granted.rolname IN ('anon', 'service_role')
  ),
  0::bigint,
  'pg_auth_members holds no authenticated -> anon/service_role row'
);

-- ============================================
-- 5. Default privileges
-- ============================================
-- Scoped to defaclrole = postgres, the role the migration runs as: those are
-- the defaults this migration can change. supabase_admin's rows are covered by
-- the skip below.
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl, '{}'::aclitem[])) a
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclrole = 'postgres'::regrole
      AND a.grantee = 'anon'::regrole
  ),
  0::bigint,
  'no pg_default_acl row in schema public grants anything to anon for objects created by postgres'
);

-- Behavioural counterpart of the catalog check: objects created from now on.
CREATE TABLE public.anon_default_probe (id bigint);
CREATE FUNCTION public.anon_default_probe_fn() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

SELECT is(
  has_table_privilege('anon', 'public.anon_default_probe', 'SELECT'),
  false,
  'a table created now by postgres is not readable by anon'
);
SELECT is(
  has_function_privilege('authenticated', 'public.anon_default_probe_fn()', 'EXECUTE'),
  true,
  'a function created now by postgres stays executable by authenticated'
);

-- Documented residual: PostgreSQL does not store PUBLIC's EXECUTE on functions
-- in pg_default_acl, so `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC` stores nothing and every function created later is
-- PUBLIC-executable, hence anon-executable (verified locally on PG 17: the
-- default-ACL row for the role is {authenticated=X} and the created function
-- still comes out as {=X,postgres=X,authenticated=X}). The working mitigation
-- is the per-function REVOKE the migration applies to the three functions that
-- exist today; applying it to future functions is follow-up work.
SELECT skip(
  'PostgreSQL keeps PUBLIC EXECUTE on new functions no matter what ALTER DEFAULT PRIVILEGES says; a new SECURITY DEFINER function must be revoked individually',
  1
);

-- Dropped before the over-revocation checks so the probes, which no app role
-- was ever granted anything on, cannot be mistaken for a missing grant.
DROP FUNCTION public.anon_default_probe_fn();
DROP TABLE public.anon_default_probe;

-- Documented residual: the Supabase CLI stack runs `postgres` with
-- rolsuper = off, and ALTER DEFAULT PRIVILEGES FOR ROLE requires membership in
-- the target role. "supabase_admin" memberships are reserved (only a superuser
-- can grant them), so a migration run by `postgres` cannot strip anon from
-- supabase_admin's pg_default_acl rows. Until supabase/config.toml sets
-- auto_expose_new_tables = false, a future table created by supabase_admin would
-- still be auto-exposed to anon.
SELECT skip(
  'supabase_admin pg_default_acl cannot be changed by the migration role (postgres is not a member and the membership is reserved)',
  1
);

-- ============================================
-- 6. Guard against over-revoking the app roles
-- ============================================
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT has_table_privilege('authenticated', c.oid, p.priv)
  ),
  0::bigint,
  'authenticated keeps SELECT/INSERT/UPDATE/DELETE on every public table'
);
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT has_table_privilege('service_role', c.oid, p.priv)
  ),
  0::bigint,
  'service_role keeps SELECT/INSERT/UPDATE/DELETE on every public table'
);

-- ============================================
-- 7. Functional proof as the anon role
-- ============================================
-- 42501 is permission_denied. Under RLS the equivalent outcome is "zero rows,
-- no error", which is why these assert the privilege, not the policy.
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT * FROM public.business_config $$,
  '42501', NULL,
  'anon SELECT business_config is permission denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_config (key, value) VALUES ('probe', '1') $$,
  '42501', NULL,
  'anon INSERT into business_config is permission denied'
);
SELECT throws_ok(
  $$ SELECT * FROM public.orders $$,
  '42501', NULL,
  'anon SELECT orders is permission denied'
);
SELECT throws_ok(
  $$ SELECT * FROM public.restaurants $$,
  '42501', NULL,
  'anon SELECT restaurants is permission denied'
);
-- Before the lockdown this reached the function body and failed with P0001
-- ("Unauthorized: no profile found"), proving anon could call a SECURITY
-- DEFINER RPC at all. The legacy complete_payment RPC no longer exists, so
-- pay_order is the canonical probe here.
SELECT throws_ok(
  $$ SELECT public.pay_order('a0eebc99-0000-0000-0000-000000000000', NULL, 0, '[]'::jsonb, gen_random_uuid()) $$,
  '42501', NULL,
  'anon cannot call pay_order'
);
SELECT throws_ok(
  $$ SELECT public.register_summary('{}'::uuid[]) $$,
  '42501', NULL,
  'anon cannot call register_summary'
);
SELECT throws_ok(
  $$ SELECT public.close_register('a0eebc99-0000-0000-0000-000000000000') $$,
  '42501', NULL,
  'anon cannot call close_register'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;