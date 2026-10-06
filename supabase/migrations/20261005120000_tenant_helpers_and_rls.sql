-- ============================================
-- Tenant helpers (private schema) + RLS rewrite
-- ============================================
-- Replaces the 20250918180001 model, which had two holes:
--
--   1. `auth.uid() IS NULL OR ...` let any caller that carried no `sub`
--      (anon, malformed JWT) read and write every tenant.
--   2. The tenant came from `auth.jwt() -> 'user_metadata' ->>
--      'restaurant_id'`. user_metadata is supplied by the user at signup and
--      is editable afterwards through auth.updateUser, so any account could
--      declare itself a member of any tenant.
--
-- The only server-controlled link between a JWT and a tenant is
-- profiles.auth_user_id (unique, FK to auth.users). These helpers resolve the
-- tenant through it, so the JWT can only ever *narrow* access, never widen it.
--
-- Also drops the fixed seed uuid DEFAULT from every tenant table: an INSERT
-- that omits restaurant_id used to silently land in the seed restaurant,
-- which defeats tenant isolation for any client that forgets the column.
--
-- Out of scope here and left for later migrations:
--   - anon grants, role-based policy restrictions, handle_new_user / signup
--     (tenant assignment of brand-new users).
--   - business_config / ingredient_categories / ingredient_transactions_orders,
--     which have no restaurant_id column yet.
--   - the payments RPCs (complete_payment, delete_order_with_items).
--
-- Idempotent: re-running drops and recreates the same objects.
-- ============================================

-- ============================================
-- SECTION 1: private schema
-- ============================================
-- Not in PostgREST's exposed schemas, so it is unreachable over the API even
-- though `authenticated` needs USAGE on it to call the helpers.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ============================================
-- SECTION 2: tenant resolution helpers
-- ============================================
-- SECURITY DEFINER because the callers must be able to read public.profiles
-- from inside an RLS policy on public.profiles itself; running as the owner
-- bypasses RLS and keeps the lookup free of recursion.
--
-- search_path = '' so the resolution cannot be hijacked by a caller-controlled
-- search_path; every reference is schema-qualified.
--
-- STABLE (read-only) so PostgreSQL can cache them per statement, which also
-- keeps the `(SELECT ...)` form in the policies eligible for init-plan reuse.

CREATE OR REPLACE FUNCTION private.current_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.restaurant_id
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1
$$;

COMMENT ON FUNCTION private.current_restaurant_id() IS
  'Tenant of the caller, resolved from profiles.auth_user_id = auth.uid(). NULL when the caller has no profile; callers with no profile must match nothing.';

CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1
$$;

COMMENT ON FUNCTION private.current_app_role() IS
  'App role of the caller (admin/cashier/kitchen/waiter), resolved from profiles.auth_user_id = auth.uid(). NULL when the caller has no profile.';

-- Public EXECUTE would let anon call these; the policies are the only intended
-- consumer, and they run as the policy owner.
REVOKE ALL ON FUNCTION private.current_restaurant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_restaurant_id() FROM anon;
GRANT EXECUTE ON FUNCTION private.current_restaurant_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.current_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_app_role() FROM anon;
GRANT EXECUTE ON FUNCTION private.current_app_role() TO authenticated, service_role;

-- ============================================
-- SECTION 3: policies on the tenant tables
-- ============================================
-- The tenant table set is read from the catalogue rather than hardcoded, so
-- this migration always covers exactly the tables that carry restaurant_id
-- (14 today: tables, orders, order_items, payment_transactions,
-- cash_registers, cash_transactions, categories, dishes, ingredients,
-- recipes, recipe_ingredients, ingredient_transactions, promotions,
-- promotion_dishes) plus profiles, handled separately below.
--
-- There is no `auth.uid() IS NULL` escape: with no resolvable profile
-- current_restaurant_id() is NULL, `restaurant_id = NULL` is NULL, and NULL is
-- not true, so such a caller matches nothing and passes no WITH CHECK.
--
-- Wrapped in SELECT so the helper is evaluated once per statement instead of
-- once per row.
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'restaurant_id'
      AND c.table_name <> 'profiles'
    ORDER BY c.table_name
  LOOP
    -- Drop every pre-existing policy on this table (SELECT/INSERT/UPDATE/DELETE
    -- and anything the older migrations may have added under another name).
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (restaurant_id = (SELECT private.current_restaurant_id()))',
      tbl || '_select_policy', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
         WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()))',
      tbl || '_insert_policy', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (restaurant_id = (SELECT private.current_restaurant_id()))
         WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()))',
      tbl || '_update_policy', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
         USING (restaurant_id = (SELECT private.current_restaurant_id()))',
      tbl || '_delete_policy', tbl);
  END LOOP;
END $$;

-- ============================================
-- SECTION 4: profiles
-- ============================================
-- Read: the whole tenant roster. The POS profile picker and the
-- orders.waiter_id selector both need colleagues from the same restaurant,
-- including staff rows that have no auth_user_id yet.
-- Update: only your own row, and you may not move it to another tenant.
-- Insert/delete: same tenant only.
--
-- Role restrictions (admin-only writes, self-service limits) are deliberately
-- NOT enforced here; that belongs with the role-freezing work.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY';

  EXECUTE '
    CREATE POLICY profiles_select_policy ON public.profiles
      FOR SELECT TO authenticated
      USING (restaurant_id = (SELECT private.current_restaurant_id()))';

  EXECUTE '
    CREATE POLICY profiles_insert_policy ON public.profiles
      FOR INSERT TO authenticated
      WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()))';

  -- Own row only: a caller cannot edit a colleague''s profile.
  EXECUTE '
    CREATE POLICY profiles_update_policy ON public.profiles
      FOR UPDATE TO authenticated
      USING (auth_user_id = auth.uid())
      WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()))';

  EXECUTE '
    CREATE POLICY profiles_delete_policy ON public.profiles
      FOR DELETE TO authenticated
      USING (restaurant_id = (SELECT private.current_restaurant_id()))';
END $$;

-- ============================================
-- SECTION 5: restaurant_id column DEFAULT
-- ============================================
-- Replaces DEFAULT 'a0eebc99-0000-0000-0000-000000000000' (the seed
-- restaurant, from 20250917090005) with the caller's tenant, so an INSERT that
-- omits the column can no longer escape into another tenant.
--
-- The default is a function call, so it runs with the inserting role's
-- privileges: authenticated and service_role hold EXECUTE, everything else is
-- denied instead of silently defaulting.
--
-- Note: handle_new_user() passes restaurant_id explicitly (it takes the first
-- row of public.restaurants), so auth signups are unaffected by this default.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'restaurant_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN restaurant_id SET DEFAULT private.current_restaurant_id()',
      tbl);
  END LOOP;
END $$;