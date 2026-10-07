-- ============================================
-- Anon lockdown: revoke every privilege the anon key can reach
-- ============================================
-- The anon key ships inside the browser bundle (lib/supabase/client.ts), so
-- anything `anon` can do, anyone who opens the login screen can do. Migration
-- 20261005120000 rewrote the tenant policies `TO authenticated`, which makes RLS
-- return zero rows to anon, but it deliberately left the privileges alone. Those
-- privileges were still the live hole, because four tables have no RLS at all
-- (business_config, ingredient_categories, ingredient_transactions_orders and
-- restaurants): there the grant *is* the authorization, so the anon key could
-- read every restaurant's branding, tax rate and NIT, and write to them.
--
-- Three more leaks, all inherited from 20250501000000_init.sql and the Supabase
-- baseline:
--   - `GRANT anon TO authenticated; GRANT service_role TO authenticated;` made
--     every logged-in account (waiter included) inherit the anon and
--     service_role grants. service_role carries BYPASSRLS, so the membership was
--     one privilege away from a full tenant bypass.
--   - PostgreSQL grants EXECUTE to PUBLIC on every new function, so the
--     SECURITY DEFINER RPCs complete_payment / delete_order_with_items were
--     callable with the anon key.
--   - The API roles hold CREATE on schema public through the schema ACL, so anon
--     could create objects (and therefore rows PostgREST exposes) in the schema
--     the Data API serves.
--
-- Step 0 audit (pre-login data access): the app has no pre-login data call, so
-- no exception is kept here.
--   - app/page.tsx gates every loader (config, tables, waiters, orders, cash
--     registers) behind isAuthenticated, and loadProfileFromAuth returns early
--     when supabase.auth.getUser() has no user.
--   - components/auth/LoginView.tsx only calls supabase.auth.signInWithPassword
--     (GoTrue, not a schema role).
--   - components/ClientProviders.tsx and app/layout.tsx render no data call;
--     the theme provider stores the theme in localStorage.
--   - store/use-config-store.ts loadConfigFromDB ->
--     lib/supabase/business-config-service.ts is the only business_config
--     reader and it is reached exclusively from the authenticated branch
--     (app/page.tsx:97, admin/ConfigurationPanel.tsx, profiles/PasswordDialog),
--     all of which render after login.
--   - pos/app.py (printer listener) reads no table at all: it subscribes to the
--     Realtime broadcasts room_commands / room_bills with PRINTER_TOKEN, which
--     resolves to a service-role JWT in production (dev falls back to the anon
--     key, but Realtime broadcast authorization is RLS on realtime.messages,
--     which this migration does not touch).
--
-- Idempotent: every statement is a REVOKE/GRANT that is safe to re-run, and the
-- two guarded blocks only act when the role membership / target role exists.
--
-- Residual, tracked outside this file:
--   - supabase_admin's pg_default_acl rows still grant anon everything on new
--     tables, because the CLI stack runs `postgres` with rolsuper = off and
--     ALTER DEFAULT PRIVILEGES FOR ROLE requires membership in the target role
--     (those memberships are reserved for superusers). The block in SECTION 6
--     tries and reports. Until supabase/config.toml sets
--     auto_expose_new_tables = false, a future table created by supabase_admin
--     would be auto-exposed to anon again.
--   - PUBLIC keeps the default EXECUTE on new functions (see SECTION 5), so a
--     future SECURITY DEFINER function is anon-callable until it is revoked
--     individually.
-- ============================================

-- ============================================
-- SECTION 1: schema public
-- ============================================
-- USAGE stays (it is what lets PostgREST resolve the objects and report a
-- table-level 42501 instead of a schema error); CREATE goes, for anon.
-- Supabase grants it through an explicit schema ACL entry, so REVOKE FROM
-- PUBLIC alone would not be enough.
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ============================================
-- SECTION 2: every existing object in schema public
-- ============================================
-- Covers the three RLS-less tenant tables, restaurants, and all sequences and
-- functions, present and future (see SECTION 6).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- schema private is not exposed by PostgREST, but its functions are SECURITY
-- DEFINER tenant resolvers, so anon gets nothing there either. Idempotent: the
-- schema-level revoke is already in place from 20261005120000.
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;

-- ============================================
-- SECTION 3: function EXECUTE for the API roles
-- ============================================
-- PostgreSQL's default is EXECUTE to PUBLIC on every function, so the revoke
-- above is not enough on its own. Then give back exactly what the app calls:
-- lib/supabase/service.ts and components/cashier/PaymentMethodDialog.tsx reach
-- these two over PostgREST/RPC as `authenticated`; service_role keeps them for
-- the dashboard and edge functions.
REVOKE EXECUTE ON FUNCTION public.complete_payment(uuid, text[], uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_payment(uuid, text[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_payment(uuid, text[], uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_order_with_items(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_order_with_items(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_order_with_items(uuid) TO authenticated, service_role;

-- public.handle_new_user() is an AFTER INSERT trigger on auth.users, fired by
-- GoTrue, not by an API caller. PostgreSQL checks a trigger function's EXECUTE
-- privilege when the trigger is created, not when it fires, so no revoke here
-- can break signup. PUBLIC must not keep the default though: it would expose a
-- SECURITY DEFINER function that writes profiles rows to the anon key. The
-- authenticated/service_role entries are left as they are; a direct call is
-- inert because NEW is unassigned outside a trigger context.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;

-- ============================================
-- SECTION 4: role memberships
-- ============================================
-- REVOKE errors with "role X is not a member of role Y" when the membership is
-- already gone, which would abort a re-run of this migration, so both are
-- guarded. Nothing in the app depends on these memberships: `authenticated`
-- already holds its own explicit grants (asserted by supabase/tests/
-- 020_anon_lockdown.test.sql) and service_role's BYPASSRLS attribute is not
-- inherited through membership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE member.rolname = 'authenticated' AND granted.rolname = 'anon'
  ) THEN
    EXECUTE 'REVOKE anon FROM authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles granted ON granted.oid = m.roleid
    WHERE member.rolname = 'authenticated' AND granted.rolname = 'service_role'
  ) THEN
    EXECUTE 'REVOKE service_role FROM authenticated';
  END IF;
END $$;

-- ============================================
-- SECTION 5: default privileges for objects created later
-- ============================================
-- Same statement family as 20250917090099, completed: it only covered tables
-- and sequences, so functions created later still carried the baseline's
-- explicit `anon=X` default ACL entry.
--
-- Known PostgreSQL limitation, verified locally: PUBLIC's EXECUTE on functions
-- is not stored in pg_default_acl, so `REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`
-- here is a no-op and a function created later is still PUBLIC-executable (and
-- therefore anon-executable). The only working mitigation is a per-function
-- REVOKE, which SECTION 3 applies to the three functions that exist today.
-- Tracked as follow-up work: every new SECURITY DEFINER function in public must
-- be revoked from PUBLIC individually.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

-- New tables stay usable by the app: the tenant policies in 20261005120000 are
-- what isolate them, these grants only let the connection reach the table.
-- Sequences get USAGE/SELECT (nextval/currval) and functions get EXECUTE for
-- the API roles that must call them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
  SELECT, INSERT, UPDATE, DELETE
  ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
  USAGE, SELECT
  ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
  EXECUTE
  ON FUNCTIONS TO authenticated, service_role;

-- ============================================
-- SECTION 6: same defaults for supabase_admin
-- ============================================
-- Objects created by supabase_admin inherit Supabase's own defaults
-- (auto_expose_new_tables), which grant anon everything on new tables. Stripping
-- them requires membership in supabase_admin, which `postgres` does not have and
-- cannot obtain (those memberships are reserved for superusers), so this block
-- is best-effort by design: it succeeds on a managed project or wherever the
-- migration runs with more privilege, and only reports otherwise.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE
      'skipped supabase_admin default privileges (%); run with a superuser or set auto_expose_new_tables = false',
      SQLERRM;
END $$;