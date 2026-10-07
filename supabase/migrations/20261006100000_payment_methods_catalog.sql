-- ============================================
-- Payment-method catalog
-- ============================================
-- The checkout flow had no first-class payment-method catalog: a payment row
-- carried a free-text method string, so nothing could enforce "only cash gives
-- change", nothing could rename a method consistently across the POS, the
-- kitchen display and the reports, and nothing stopped one tenant's catalog
-- from showing up under another's. This migration adds the catalog.
--
-- public.payment_methods
--   restaurant_id  the tenant, NOT NULL and defaulted to the caller's own
--                  tenant through private.default_restaurant_id() (same
--                  pattern as every other tenant table since 20261005120000:
--                  authenticated -> own tenant or NULL when the account has no
--                  profile, postgres -> oldest restaurant ORDER BY created_at,
--                  id, every other role -> NULL so it must name the tenant).
--   code           the stable key the payment rows will carry. UNIQUE
--                  (restaurant_id, code): the same code may exist in two
--                  tenants, never twice in one. Immutable after insert.
--   name           the display name shown on the checkout picker.
--   kind           'cash' | 'electronic'. THIS COLUMN IS THE WHOLE RULE FOR
--                  GIVING CHANGE - there is deliberately no second boolean for
--                  it, so the checkout screen cannot read one rule and the
--                  reports another.
--   is_active      a soft delete. The row stays so historical payments keep
--                  resolving the method they were paid with; the checkout
--                  picker filters on it in the query, not in the read.
--   sort_order     the order of the checkout picker, indexed with restaurant_id.
--
-- Reads are same-tenant for every role (inactive rows included, so order
-- history renders a method that was deactivated afterwards). Writes are
-- admin-only and same-tenant, like business_config (20261005150000): the
-- catalog is configured by the admin, and every role consumes it.
--
-- `code` immutability is a trigger, not a policy, for the same reason as
-- public.guard_profiles_privileged_columns (20261005140000): RLS evaluates
-- USING and WITH CHECK against the row and the JWT, never against "who is
-- calling", so it cannot express "nobody below service_role may rename this".
--
-- Every existing restaurant gets the four defaults here, and every restaurant
-- created afterwards gets them from an AFTER INSERT trigger on
-- public.restaurants (seed.sql is not editable in this change, so the trigger
-- is what keeps the guarantee for tenants provisioned later).
--
-- Idempotent: re-running recreates the same policies, functions, triggers and
-- constraints, and the two default-catalog inserts are ON CONFLICT DO NOTHING.
-- ============================================

-- ============================================
-- SECTION 1: the table
-- ============================================
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                  REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  code          text NOT NULL
                  CONSTRAINT payment_methods_code_check CHECK (code ~ '^[a-z0-9_]{2,32}$'),
  name          text NOT NULL
                  CONSTRAINT payment_methods_name_check
                  CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind          text NOT NULL
                  CONSTRAINT payment_methods_kind_check
                  CHECK (kind IN ('cash', 'electronic')),
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_restaurant_id_code_key UNIQUE (restaurant_id, code)
);

-- The checkout picker always reads one tenant's catalog ordered by sort_order.
CREATE INDEX IF NOT EXISTS idx_payment_methods_restaurant_id_sort_order
  ON public.payment_methods USING btree (restaurant_id, sort_order);

COMMENT ON TABLE public.payment_methods IS
  'Per-tenant catalog of payment methods. Read by every role of the tenant (inactive rows included, so order history still resolves a method that was deactivated later), written by admins only. `kind = ''cash''` is the only value that gives change - there is no second column for it.';
COMMENT ON COLUMN public.payment_methods.code IS
  'Stable key the payment rows carry. Unique per tenant and immutable after insert (public.guard_payment_methods_code_immutable).';
COMMENT ON COLUMN public.payment_methods.kind IS
  '''cash'' gives change, ''electronic'' does not. This column is the whole rule: do not add a parallel boolean.';
COMMENT ON COLUMN public.payment_methods.is_active IS
  'Soft delete. The row is kept so historical payments keep resolving their method; filter on it in the checkout picker query, not in the row-level read.';

-- ============================================
-- SECTION 2: RLS
-- ============================================
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_methods_select_policy ON public.payment_methods;
DROP POLICY IF EXISTS payment_methods_insert_policy ON public.payment_methods;
DROP POLICY IF EXISTS payment_methods_update_policy ON public.payment_methods;
DROP POLICY IF EXISTS payment_methods_delete_policy ON public.payment_methods;

-- Read: every role of the tenant, active or not. A waiter closing an order that
-- was paid yesterday must still see the method that was used yesterday.
CREATE POLICY payment_methods_select_policy ON public.payment_methods
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- Write: admin of the same tenant only. The private helpers are wrapped in
-- (SELECT ...) so each is evaluated once per statement.
CREATE POLICY payment_methods_insert_policy ON public.payment_methods
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_methods_update_policy ON public.payment_methods
  FOR UPDATE TO authenticated
  USING ((SELECT private.current_app_role()) = 'admin'
         AND restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_methods_delete_policy ON public.payment_methods
  FOR DELETE TO authenticated
  USING ((SELECT private.current_app_role()) = 'admin'
         AND restaurant_id = (SELECT private.current_restaurant_id()));

-- ============================================
-- SECTION 3: triggers
-- ============================================
-- updated_at maintenance, same shape every other table in this chain expects.
CREATE OR REPLACE FUNCTION public.payment_methods_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.payment_methods_set_updated_at() IS
  'BEFORE UPDATE on public.payment_methods: stamps updated_at.';

-- The frozen key. `code` is what payment rows will reference, so renaming it
-- would orphan history; the same reasoning as the profiles identity guard.
--
-- SECURITY INVOKER on purpose: the guard must reason about the caller, so it
-- must run as the caller. It cannot be bypassed from the Data API either - only
-- the table owner (postgres) can create or replace a trigger on this table.
--
-- IS DISTINCT FROM so an UPDATE that does not mention `code` (the admin form
-- PATCHes the whole row it selected) does not raise.
--
-- The skip list is the service path, not an app one: postgres (migrations,
-- seeds, CLI), service_role and supabase_admin. Everything else - which is to
-- say every request carrying a user JWT, and therefore the whole browser attack
-- surface - goes through the guard.
CREATE OR REPLACE FUNCTION public.guard_payment_methods_code_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'payment_methods.code is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_payment_methods_code_immutable() IS
  'BEFORE UPDATE guard on public.payment_methods: code is immutable for every caller except postgres/service_role/supabase_admin, admin included. Raises insufficient_privilege (42501).';

DROP TRIGGER IF EXISTS payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.payment_methods_set_updated_at();

DROP TRIGGER IF EXISTS payment_methods_code_immutable ON public.payment_methods;
CREATE TRIGGER payment_methods_code_immutable
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_methods_code_immutable();

-- ============================================
-- SECTION 4: the default catalog
-- ============================================
-- One place for the default list, so the backfill below and the trigger on
-- public.restaurants cannot drift apart.
CREATE OR REPLACE FUNCTION private.insert_default_payment_methods(p_restaurant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO public.payment_methods (restaurant_id, code, name, kind, sort_order)
  VALUES
    (p_restaurant_id, 'cash',        'Efectivo',      'cash',       10),
    (p_restaurant_id, 'transfer',    'Transferencia', 'electronic', 20),
    (p_restaurant_id, 'nequi',       'Nequi',         'electronic', 30),
    (p_restaurant_id, 'bancolombia', 'Bancolombia',   'electronic', 40)
  ON CONFLICT (restaurant_id, code) DO NOTHING;
$$;

COMMENT ON FUNCTION private.insert_default_payment_methods(uuid) IS
  'Installs the four default payment methods (Efectivo/Transferencia/Nequi/Bancolombia) for one restaurant. Idempotent (ON CONFLICT DO NOTHING). Called by public.seed_payment_methods_defaults() for new restaurants and by migration 20261006100000 for the ones that already exist.';

-- AFTER INSERT on the tenant root. SECURITY DEFINER because the new tenant's row
-- has to be written on behalf of whoever provisioned the restaurant, and
-- search_path = '' with every reference schema-qualified.
--
-- The defaults are written through private.insert_default_payment_methods, which
-- is SECURITY INVOKER and therefore runs as this function's owner (postgres):
-- RLS on payment_methods is not in the way for a tenant that does not exist yet.
CREATE OR REPLACE FUNCTION public.seed_payment_methods_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.insert_default_payment_methods(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_payment_methods_defaults() IS
  'AFTER INSERT on public.restaurants: installs the default payment-method catalog for the new tenant. SECURITY DEFINER, so it works for a tenant no authenticated session can resolve yet.';

DROP TRIGGER IF EXISTS restaurants_seed_payment_methods ON public.restaurants;
CREATE TRIGGER restaurants_seed_payment_methods
  AFTER INSERT ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_payment_methods_defaults();

-- Same lockdown pattern as 20261005120000 / 20261005130000 / 20261005140000:
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and trigger
-- functions are not privilege-checked when they fire, so the revoke cannot
-- break the guards themselves.
REVOKE ALL ON FUNCTION public.payment_methods_set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_methods_set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.guard_payment_methods_code_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_payment_methods_code_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.seed_payment_methods_defaults() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seed_payment_methods_defaults() FROM anon;
-- Trigger functions fire without EXECUTE; strip the default-ACL grant so the
-- SECURITY DEFINER seeder is reachable only through its trigger.
REVOKE ALL ON FUNCTION public.payment_methods_set_updated_at() FROM authenticated;
REVOKE ALL ON FUNCTION public.guard_payment_methods_code_immutable() FROM authenticated;
REVOKE ALL ON FUNCTION public.seed_payment_methods_defaults() FROM authenticated;
REVOKE ALL ON FUNCTION private.insert_default_payment_methods(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.insert_default_payment_methods(uuid) FROM anon;

-- Backfill for the restaurants that already exist. At this point in the chain
-- that is the one created by 20250917090005, but the statement is written over
-- the whole table so a re-run on a multi-tenant database covers every tenant.
SELECT private.insert_default_payment_methods(r.id) FROM public.restaurants r;

-- ============================================
-- SECTION 5: privileges
-- ============================================
-- The policies above are the authorization; the grants are what let the Data API
-- reach them at all. anon gets nothing (020_anon_lockdown enumerates every
-- public table and function), and both app roles keep the full set, which
-- 020_anon_lockdown also asserts against over-revocation.
REVOKE ALL ON TABLE public.payment_methods FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_methods TO service_role;