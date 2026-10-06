-- ============================================
-- Profile privilege guards: admin-only roles, frozen identity columns
-- ============================================
-- Migration 20261005120000 left the role question on profiles open on purpose
-- ("Role restrictions (admin-only writes, self-service limits) are deliberately
-- NOT enforced here"). What it shipped was:
--
--   UPDATE  USING (auth_user_id = auth.uid())  WITH CHECK (restaurant_id = ...)
--   INSERT  WITH CHECK (restaurant_id = ...)
--   DELETE  USING (restaurant_id = ...)
--
-- Those policies are tenant-correct but privilege-blind, which leaves three
-- holes an authenticated account can reach from the browser:
--
--   1. Self-promotion. `role` is in no USING and no WITH CHECK, so
--      PATCH /rest/v1/profiles?id=eq.<own id> {"role":"admin"} succeeds and the
--      caller then inherits every admin policy. A waiter becomes the tenant
--      administrator with one HTTP request.
--   2. Identity rewriting. `auth_user_id` is in no WITH CHECK either, so a user
--      can re-point its own row at another auth account; `restaurant_id` is
--      caught by WITH CHECK only because the row has to stay in *some* tenant.
--   3. INSERT/DELETE are open to every account of the tenant, so a waiter can
--      plant a profile (any role, no auth_user_id) or delete a colleague.
--
-- The rules this migration enforces:
--
--   SELECT  anyone authenticated, whole roster of its own tenant (unchanged:
--           the POS profile picker and orders.waiter_id need colleagues, and
--           staff rows without auth_user_id).
--   UPDATE  your own row, always; any row of your tenant if and only if you are
--           an admin of it. WITH CHECK keeps the row inside your tenant.
--   INSERT  admin of the tenant only.
--   DELETE  admin of the tenant only.
--   Frozen columns, enforced by a trigger rather than by a policy, because a
--   policy can only see the row and the JWT, never "who is calling":
--     - restaurant_id and auth_user_id are immutable for every non-service
--       caller, admin included (admin reassigns roles and names, never tenants);
--     - role may only change when private.current_app_role() = 'admin'.
--
-- The trigger is the part a policy cannot replace: RLS evaluates USING and
-- WITH CHECK with no notion of the statement that produced the new tuple, so
-- "admin may not change restaurant_id" cannot be written as a policy - the
-- WITH CHECK that would express it also blocks the legitimate own-row update.
--
-- handle_new_user() is replaced in the same file because it is the third door
-- into the same privilege: it read `role` from raw_user_meta_data, the jsonb the
-- signup client writes, so "sign up as admin" was self-service escalation. The
-- role now comes from raw_app_meta_data (writable only with the service role or
-- through the Supabase admin API) and falls back to 'waiter'. Signup is turned
-- off in supabase/config.toml ([auth] enable_signup = false); on Cloud the same
-- toggle lives in Authentication -> Providers -> Email -> "Allow new users to
-- sign up".
--
-- Idempotent: re-running drops and recreates the same policies, trigger and
-- function bodies, and re-applies the same grants.
-- ============================================

-- ============================================
-- SECTION 1: profiles policies
-- ============================================
-- The admin checks read private.current_app_role(), the same server-controlled
-- helper the policies already use for the tenant, so a caller cannot declare
-- itself an admin through the JWT: the role lives in profiles, which the
-- Data API only reaches through these very policies.
--
-- A caller with no profile gets NULL from the helper, `NULL = 'admin'` is NULL,
-- and every expression below therefore matches nothing.

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

  -- Admin-only. The admin UI (components/admin/staff/WaiterForm.tsx,
  -- lib/supabase/service.ts) creates staff rows here as the logged-in admin,
  -- with an explicit restaurant_id and no auth_user_id.
  EXECUTE '
    CREATE POLICY profiles_insert_policy ON public.profiles
      FOR INSERT TO authenticated
      WITH CHECK (
        (SELECT private.current_app_role()) = ''admin''
        AND restaurant_id = (SELECT private.current_restaurant_id())
      )';

  -- Own row (any role, so a user can still correct its own name), or any row of
  -- the tenant when the caller is that tenant's admin.
  EXECUTE '
    CREATE POLICY profiles_update_policy ON public.profiles
      FOR UPDATE TO authenticated
      USING (
        auth_user_id = auth.uid()
        OR (
          (SELECT private.current_app_role()) = ''admin''
          AND restaurant_id = (SELECT private.current_restaurant_id())
        )
      )
      WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()))';

  EXECUTE '
    CREATE POLICY profiles_delete_policy ON public.profiles
      FOR DELETE TO authenticated
      USING (
        (SELECT private.current_app_role()) = ''admin''
        AND restaurant_id = (SELECT private.current_restaurant_id())
      )';
END $$;

-- ============================================
-- SECTION 2: BEFORE UPDATE guard on the identity columns
-- ============================================
-- SECURITY INVOKER on purpose: the guard must reason about the caller, so it
-- must run as the caller. It also cannot be bypassed from the Data API - only
-- the table owner (postgres) can create or replace a trigger on public.profiles,
-- and creating a function with the same name would not replace this one.
--
-- The three privileged columns are compared with IS DISTINCT FROM so an UPDATE
-- that does not mention them (the app PATCHes the whole row it selected) does
-- not raise.
--
-- The skip list is the service path, not an app one:
--   - postgres             migrations, seeds and the CLI;
--   - service_role         PostgREST/SQL editor sessions of the dashboard
--                          (BYPASSRLS, and trusted by definition);
--   - supabase_admin       pg-meta / Studio administration.
-- Everything else - which is to say every request that carries a user JWT, and
-- therefore the whole browser attack surface - goes through the guards.

CREATE OR REPLACE FUNCTION public.guard_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id THEN
    RAISE EXCEPTION 'profiles.restaurant_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'profiles.auth_user_id is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND (SELECT private.current_app_role()) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an admin of the same tenant may change profiles.role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profiles_privileged_columns() IS
  'BEFORE UPDATE guard on public.profiles: restaurant_id and auth_user_id are immutable for every caller except postgres/service_role/supabase_admin, and role only changes for an admin of the same tenant. Raises insufficient_privilege (42501).';

-- PostgreSQL grants EXECUTE to PUBLIC on every new function; 20261005130000
-- pins that to zero for schema public, so this one is revoked individually too.
-- Trigger functions are not privilege-checked when they fire, so the revoke
-- cannot break the guard itself.
REVOKE ALL ON FUNCTION public.guard_profiles_privileged_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_profiles_privileged_columns() FROM anon;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_privileged_columns();

-- ============================================
-- SECTION 3: handle_new_user()
-- ============================================
-- SECURITY DEFINER (it writes profiles as its owner, RLS and the guard trigger
-- aside) and search_path = '' with every reference schema-qualified.
--
-- Role: raw_app_meta_data ->> 'role', falling back to 'waiter'.
-- raw_user_meta_data is written by the client at signup and stays client-writable
-- through auth.updateUser, so it can only contribute the display name now.
-- raw_app_meta_data is only writable server-side (service role / admin API), so
-- it is the only metadata a new account's privilege may come from. No whitelist
-- is applied to the value: profiles.role carries no CHECK constraint today, and
-- narrowing it to the four known roles is a separate decision from this one.
--
-- Tenant: raw_app_meta_data ->> 'restaurant_id' when the provisioning code sets
-- it, else the pre-existing fallback of "the first row of public.restaurants".
-- The fallback is kept for compatibility but is arbitrary (no ORDER BY, one
-- tenant is picked by chance) and is only reachable with signup disabled and a
-- provisioning step that knows which restaurant the account belongs to; new
-- accounts must therefore carry restaurant_id in app metadata.
--
-- ON CONFLICT (auth_user_id) DO NOTHING is preserved: re-signup and any
-- provisioning that re-inserts an auth.users row must not duplicate or reset a
-- profile that already exists.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_restaurant_id uuid;
  v_role text;
BEGIN
  v_role := COALESCE(NEW.raw_app_meta_data ->> 'role', 'waiter');

  v_restaurant_id := NULLIF(NEW.raw_app_meta_data ->> 'restaurant_id', '')::uuid;

  IF v_restaurant_id IS NULL THEN
    SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id, auth_user_id, email, full_name, role, restaurant_id, active, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    v_role,
    v_restaurant_id,
    true,
    now(),
    now()
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'AFTER INSERT on auth.users (Supabase Auth). Creates the profile with the role from raw_app_meta_data (server-controlled, defaults to waiter) and the tenant from raw_app_meta_data->>restaurant_id, else the first row of public.restaurants.';

-- CREATE OR REPLACE keeps the existing ACL ({postgres, authenticated,
-- service_role}, PUBLIC and anon already revoked by 20261005130000); restated so
-- a re-run cannot leave it half-defined.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;