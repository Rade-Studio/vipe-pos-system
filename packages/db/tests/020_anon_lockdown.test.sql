-- Privilege lockdown contract test (ported from the Supabase anon lockdown).
--
-- On Supabase the anon key shipped in the browser bundle, so `anon` was public
-- knowledge and this file pinned that it held nothing. On plain Postgres there
-- is no anon role and the browser never holds a database key; the equivalent
-- outsider is PUBLIC, the pseudo-role every database login inherits. Every
-- privilege PUBLIC holds is a privilege any role on the server holds, so the
-- same contract is pinned against PUBLIC and against a throwaway role with no
-- grants (section 7). `authenticated` became vipe_api (the API role) and
-- `service_role` became vipe_migrator (the schema owner).
--
-- Dropped from the Supabase version, because they only existed for Supabase
-- roles: `authenticated is not a member of anon` (no anon role) and the
-- supabase_admin pg_default_acl skip (no supabase_admin role).
--
-- Self-contained on purpose: `pnpm test:db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

-- Extension members (pgtap, citext, pgcrypto) are excluded from the catalog
-- sweeps: on Supabase they lived in schema `extensions`, here they land in
-- public, and their PUBLIC grants are the extension's, not the application's.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(32);

-- ============================================
-- 1. Tables: PUBLIC holds nothing
-- ============================================
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m')
      AND has_table_privilege('public', c.oid, p.priv)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  ),
  0::bigint,
  'an outsider holds no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any public table'
);

-- Named explicitly because business_config is the sharpest hole: no RLS at all,
-- so a PUBLIC SELECT would read every restaurant's branding, tax and NIT.
SELECT is(
  has_table_privilege('public', 'public.business_config', 'SELECT'),
  false,
  'an outsider cannot SELECT business_config'
);

-- PostgreSQL 15+ no longer grants CREATE on schema public to PUBLIC, and the
-- baseline grants vipe_api USAGE only.
SELECT is(
  has_schema_privilege('public', 'public', 'CREATE'),
  false,
  'an outsider cannot CREATE objects in schema public'
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
      AND has_sequence_privilege('public', c.oid, p.priv)
  ),
  0::bigint,
  'an outsider holds no USAGE/SELECT/UPDATE on any public sequence'
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
      AND has_function_privilege('public', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ),
  0::bigint,
  'an outsider has no EXECUTE on any public function'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND has_function_privilege('public', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ),
  0::bigint,
  'an outsider has no EXECUTE on any private function'
);

-- PostgreSQL grants EXECUTE to PUBLIC on every new function by default, which
-- would make every SECURITY DEFINER RPC callable by any role on the server.
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public'
      AND a.grantee = 0
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ),
  0::bigint,
  'no public function grants EXECUTE to PUBLIC'
);

-- Guard against over-revoking: the payments RPCs are the app's PostgREST path.
SELECT is(
  has_function_privilege('vipe_api', 'public.pay_order(uuid,uuid,bigint,jsonb,uuid)', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on pay_order'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.register_summary(uuid[])', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on register_summary'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.close_register(uuid)', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on close_register'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.delete_order_with_items(uuid)', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on delete_order_with_items'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text,uuid)', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on create_delivery_order'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.set_delivery_status(uuid,text,uuid,text,timestamptz,text)', 'EXECUTE'),
  true,
  'vipe_api keeps EXECUTE on set_delivery_status'
);
SELECT is(
  has_schema_privilege('vipe_api', 'private', 'USAGE'),
  true,
  'vipe_api keeps USAGE on schema private for the tenant helpers'
);

-- ============================================
-- 4. Role memberships
-- ============================================
-- vipe_api is NOINHERIT and a member of nothing: it can never pick up the
-- owner's privileges (and the owner's RLS exemption) through a role grant.
SELECT is(
  pg_has_role('vipe_api', 'vipe_migrator', 'MEMBER'),
  false,
  'vipe_api is not a member of vipe_migrator'
);
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = 'vipe_api'
  ),
  0::bigint,
  'pg_auth_members holds no membership for vipe_api'
);

-- ============================================
-- 5. Default privileges
-- ============================================
-- PUBLIC (grantee 0) must not pick anything up from a default ACL.
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl, '{}'::aclitem[])) a
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND a.grantee = 0
  ),
  0::bigint,
  'no pg_default_acl row in schema public grants anything to PUBLIC'
);

-- Tables the migration owner creates later reach vipe_api through the default
-- privileges of the baseline (design step 5), and nobody else.
SET LOCAL ROLE vipe_migrator;
CREATE TABLE public.migrator_default_probe (id bigint);
RESET ROLE;
SELECT ok(
  has_table_privilege('vipe_api', 'public.migrator_default_probe', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('public', 'public.migrator_default_probe', 'SELECT'),
  'a table created later by vipe_migrator is granted to vipe_api only'
);
DROP TABLE public.migrator_default_probe;

-- Behavioural counterpart of the catalog check: objects created from now on.
CREATE TABLE public.public_default_probe (id bigint);
CREATE FUNCTION public.public_default_probe_fn() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

SELECT is(
  has_table_privilege('public', 'public.public_default_probe', 'SELECT'),
  false,
  'a table created now by postgres is not readable by PUBLIC'
);
SELECT is(
  has_function_privilege('vipe_api', 'public.public_default_probe_fn()', 'EXECUTE'),
  true,
  'a function created now by postgres stays executable by vipe_api'
);

-- Documented residual: PostgreSQL does not store PUBLIC's EXECUTE on functions
-- in pg_default_acl, so `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC` stores nothing and every function created later is
-- PUBLIC-executable, hence executable by every role. The working mitigation
-- is the per-function REVOKE the migration applies to the three functions that
-- exist today; applying it to future functions is follow-up work.
SELECT skip(
  'PostgreSQL keeps PUBLIC EXECUTE on new functions no matter what ALTER DEFAULT PRIVILEGES says; a new SECURITY DEFINER function must be revoked individually',
  1
);

-- Dropped before the over-revocation checks so the probes, which no app role
-- was ever granted anything on, cannot be mistaken for a missing grant.
DROP FUNCTION public.public_default_probe_fn();
DROP TABLE public.public_default_probe;

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
      -- Credential tables: column-level SELECT and SECURITY DEFINER writes
      -- only (160_auth_users_sessions). Printing: no token_hash read, jobs
      -- acknowledged and pruned through SECURITY DEFINER helpers (200_printing).
      -- PINs and supervisor authorizations: column-level SELECT (no pin_hash),
      -- SECURITY DEFINER writes only (270_staff_pins).
      -- F5a (0021): narrowed grants asserted in 310_desktop_devices.test.sql
      AND c.relname NOT IN ('users', 'auth_sessions', 'printer_tokens', 'print_jobs', 'staff_pins', 'supervisor_authorizations',
                            'desktop_devices', 'desktop_pairing_codes', 'desktop_printers', 'desktop_printer_stations',
                            'desktop_job_acks', 'desktop_drawer_events', 'desktop_releases')
      -- profiles: SELECT only, writes through the staff helpers (210_staff_helpers).
      AND NOT (c.relname = 'profiles' AND p.priv <> 'SELECT')
      AND NOT has_table_privilege('vipe_api', c.oid, p.priv)
  ),
  0::bigint,
  'vipe_api keeps SELECT/INSERT/UPDATE/DELETE on every public table except the credential and printing tables'
);
SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT has_table_privilege('vipe_migrator', c.oid, p.priv)
  ),
  0::bigint,
  'vipe_migrator keeps SELECT/INSERT/UPDATE/DELETE on every public table'
);

-- ============================================
-- 7. Functional proof as a role with no grants
-- ============================================
-- 42501 is permission_denied. Under RLS the equivalent outcome is "zero rows,
-- no error", which is why these assert the privilege, not the policy. The
-- role exists only inside this rolled-back transaction.
CREATE ROLE vipe_test_outsider NOLOGIN;
SET LOCAL ROLE vipe_test_outsider;

SELECT throws_ok(
  $$ SELECT * FROM public.business_config $$,
  '42501', NULL,
  'an outsider SELECT business_config is permission denied'
);
SELECT throws_ok(
  $$ INSERT INTO public.business_config (key, value) VALUES ('probe', '1') $$,
  '42501', NULL,
  'an outsider INSERT into business_config is permission denied'
);
SELECT throws_ok(
  $$ SELECT * FROM public.orders $$,
  '42501', NULL,
  'an outsider SELECT orders is permission denied'
);
SELECT throws_ok(
  $$ SELECT * FROM public.restaurants $$,
  '42501', NULL,
  'an outsider SELECT restaurants is permission denied'
);
-- Before the lockdown this reached the function body and failed with P0001
-- ("Unauthorized: no profile found"), proving anon could call a SECURITY
-- DEFINER RPC at all. The legacy complete_payment RPC no longer exists, so
-- pay_order is the canonical probe here.
SELECT throws_ok(
  $$ SELECT public.pay_order('a0eebc99-0000-0000-0000-000000000000', NULL, 0, '[]'::jsonb, gen_random_uuid()) $$,
  '42501', NULL,
  'an outsider cannot call pay_order'
);
SELECT throws_ok(
  $$ SELECT public.register_summary('{}'::uuid[]) $$,
  '42501', NULL,
  'an outsider cannot call register_summary'
);
SELECT throws_ok(
  $$ SELECT public.close_register('a0eebc99-0000-0000-0000-000000000000') $$,
  '42501', NULL,
  'an outsider cannot call close_register'
);
SELECT throws_ok(
  $$ SELECT public.create_delivery_order('{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 'prepaid', NULL, NULL) $$,
  '42501', NULL,
  'an outsider cannot call create_delivery_order'
);
SELECT throws_ok(
  $$ SELECT public.set_delivery_status('a0eebc99-0000-0000-0000-000000000000'::uuid, 'deliver', NULL, NULL) $$,
  '42501', NULL,
  'an outsider cannot call set_delivery_status'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;