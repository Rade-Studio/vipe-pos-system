-- ============================================
-- Tenant-scope the remaining tables
-- ============================================
-- 20261005120000 closed the tenant policies on the tables that already carried
-- restaurant_id and named the three it could not close: business_config,
-- ingredient_categories and ingredient_transactions_orders. Those reached the
-- stack with no restaurant_id and no RLS at all, so on them the *grant* was the
-- authorization: any authenticated account of any tenant could read every
-- other restaurant's branding, tax rate, NIT and role PINs, rewrite it, and do
-- the same with the ingredient catalog and the order/consumption links.
-- `restaurants` itself, the tenant root, had no RLS either.
--
-- What this migration does, per table:
--
--   business_config            + restaurant_id, UNIQUE(key) -> UNIQUE(restaurant_id,
--                              key), RLS: same-tenant SELECT for every role,
--                              admin-only same-tenant INSERT/UPDATE/DELETE.
--   ingredient_categories      + restaurant_id, RLS: the same four same-tenant
--                              policies the other tenant tables carry.
--   ingredient_transactions_orders
--                              no new column: it is scoped through the order it
--                              points at, RLS on the EXISTS predicate.
--   restaurants                RLS: a tenant reads its own row; no write policy at
--                              all for `authenticated` (service_role bypasses
--                              RLS and keeps the provisioning path).
--
-- Why business_config writes are admin-only: lib/supabase/
-- business-config-service.ts is the only writer (reached from admin/
-- ConfigurationPanel.tsx and admin/BusinessConfigForm.tsx), while every role
-- reads the config after login (app/page.tsx:97 and profiles/PasswordDialog.tsx
-- both call loadConfigFromDB). Restricting the writes to the admin role keeps
-- both app paths working.
--
-- The default is NOT plain private.current_restaurant_id(), and the difference
-- matters. supabase/seed.sql inserts business_config rows without naming
-- restaurant_id, and the seed runs as `postgres`, outside any authenticated
-- session, where that helper resolves NULL - a plain helper default would fail
-- the NOT NULL constraint and break `supabase db reset`. seed.sql is not
-- editable in this change, so the default is a wrapper that keeps the
-- fail-closed behaviour for the caller that matters (SECTION 1):
--
--   * current_user = 'authenticated' (every PostgREST Data API request): the
--     caller's tenant, NULL when the account has no profile, so a profile-less
--     caller still cannot land a row anywhere - the row is rejected, not
--     silently filed under somebody else's tenant.
--   * any trusted provisioning caller (postgres running the seed or a
--     migration, service_role, the dashboard SQL editor): the oldest restaurant,
--     ORDER BY created_at, id - the same deterministic fallback
--     handle_new_user() uses, and the same target as the backfill below.
--
-- Backfill target for the rows that predate the column: the oldest restaurant
-- (ORDER BY created_at, id, LIMIT 1) - deterministic, and the only tenant that
-- exists at this point of the migration chain (20250917090005 seeds it). A
-- database with no restaurant at all cannot be backfilled and is not a state
-- this chain can reach.
--
-- Idempotent: re-running drops and recreates the same policies and re-derives
-- the same column constraints.
-- ============================================

-- ============================================
-- SECTION 1: the column default
-- ============================================
-- SECURITY INVOKER on purpose: current_user inside the function has to be the
-- caller, and a SECURITY DEFINER function would see its owner instead (that
-- also rules out a pg_has_role membership test, because postgres is a member of
-- every role - verified locally, it returns true for the superuser too).
--
-- STABLE so the result is computed once per statement, keeping it eligible for
-- init-plan reuse.
CREATE OR REPLACE FUNCTION private.default_restaurant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN current_user = 'authenticated' THEN private.current_restaurant_id()
    WHEN current_user = 'postgres'
      THEN (SELECT r.id FROM public.restaurants r ORDER BY r.created_at, r.id LIMIT 1)
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION private.default_restaurant_id() IS
  'Column default for the newly tenant-scoped tables. For `authenticated` it is the caller''s own tenant and NULL when the account has no profile (fail closed); for postgres (seed.sql and migrations) it is the oldest restaurant, ORDER BY created_at, id; for every other role (service_role webhooks, dashboard) it is NULL, so a write that omits restaurant_id fails NOT NULL instead of landing in an arbitrary tenant.';

-- Same lockdown pattern as 20261005120000 / 20261005130000: PostgreSQL grants
-- EXECUTE to PUBLIC on every new function, and schema private holds the tenant
-- resolvers, so revoke from PUBLIC and anon first and then give back exactly
-- what the app needs.
REVOKE ALL ON FUNCTION private.default_restaurant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.default_restaurant_id() FROM anon;
GRANT EXECUTE ON FUNCTION private.default_restaurant_id() TO authenticated, service_role;

-- ============================================
-- SECTION 2: business_config
-- ============================================
ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS restaurant_id uuid;

-- Every pre-existing row belongs to the oldest restaurant. Written as a
-- correlated UPDATE rather than a scalar subquery so the target is resolved
-- once and the statement stays set-based.
UPDATE public.business_config bc
   SET restaurant_id = target.id
  FROM (SELECT r.id FROM public.restaurants r ORDER BY r.created_at, r.id LIMIT 1) AS target
 WHERE bc.restaurant_id IS NULL;

ALTER TABLE public.business_config
  ALTER COLUMN restaurant_id SET NOT NULL,
  ALTER COLUMN restaurant_id SET DEFAULT private.default_restaurant_id();

ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_business_config_restaurant_id
  ON public.business_config USING btree (restaurant_id);

-- UNIQUE(key) is global today, which is what makes a second tenant unable to
-- own a 'business_name' row. The app resolves a single key with
-- .eq("key", key).single() (business-config-service.getConfigValue), so the
-- constraint has to move to the tenant, not disappear.
ALTER TABLE public.business_config DROP CONSTRAINT IF EXISTS business_config_key_key;
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_restaurant_id_key_key UNIQUE (restaurant_id, key);

ALTER TABLE public.business_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_config_select_policy ON public.business_config;
DROP POLICY IF EXISTS business_config_insert_policy ON public.business_config;
DROP POLICY IF EXISTS business_config_update_policy ON public.business_config;
DROP POLICY IF EXISTS business_config_delete_policy ON public.business_config;

-- Read: every role of the tenant. tax_percentage, business_name and the NIT are
-- needed by the POS of every waiter, cashier and kitchen account.
CREATE POLICY business_config_select_policy ON public.business_config
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- Write: admin of the same tenant only (ConfigurationPanel). The private
-- helpers are wrapped in (SELECT ...) so each is evaluated once per statement.
CREATE POLICY business_config_insert_policy ON public.business_config
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY business_config_update_policy ON public.business_config
  FOR UPDATE TO authenticated
  USING ((SELECT private.current_app_role()) = 'admin'
         AND restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY business_config_delete_policy ON public.business_config
  FOR DELETE TO authenticated
  USING ((SELECT private.current_app_role()) = 'admin'
         AND restaurant_id = (SELECT private.current_restaurant_id()));

COMMENT ON TABLE public.business_config IS
  'Per-tenant business settings (branding, tax/tip rates, NIT, role PINs). Read by every role of the tenant, written by admins only.';

-- ============================================
-- SECTION 3: ingredient_categories
-- ============================================
-- Same shape as the other tenant tables: 20250510151737 declares no UNIQUE on
-- name (only the primary key on id), so there is no global key constraint to
-- make per-tenant here. Two tenants may legitimately hold categories with the
-- same name, and the catalog keeps them apart by restaurant_id, not by name -
-- pinned in 040_remaining_tables_tenancy.test.sql.
ALTER TABLE public.ingredient_categories
  ADD COLUMN IF NOT EXISTS restaurant_id uuid;

UPDATE public.ingredient_categories ic
   SET restaurant_id = target.id
  FROM (SELECT r.id FROM public.restaurants r ORDER BY r.created_at, r.id LIMIT 1) AS target
 WHERE ic.restaurant_id IS NULL;

ALTER TABLE public.ingredient_categories
  ALTER COLUMN restaurant_id SET NOT NULL,
  ALTER COLUMN restaurant_id SET DEFAULT private.default_restaurant_id();

ALTER TABLE public.ingredient_categories
  ADD CONSTRAINT ingredient_categories_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ingredient_categories_restaurant_id
  ON public.ingredient_categories USING btree (restaurant_id);

ALTER TABLE public.ingredient_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredient_categories_select_policy ON public.ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_insert_policy ON public.ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_update_policy ON public.ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_delete_policy ON public.ingredient_categories;

CREATE POLICY ingredient_categories_select_policy ON public.ingredient_categories
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY ingredient_categories_insert_policy ON public.ingredient_categories
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY ingredient_categories_update_policy ON public.ingredient_categories
  FOR UPDATE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY ingredient_categories_delete_policy ON public.ingredient_categories
  FOR DELETE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- ============================================
-- SECTION 4: ingredient_transactions_orders
-- ============================================
-- No tenant column: a junction row belongs to whoever owns the order it links
-- (lib/supabase/inventory-control-service.ts inserts it while cooking an order
-- of the caller's own tenant), and the order is the row every read of the link
-- starts from. A restaurant_id column here would have to be kept consistent with
-- orders by a trigger; the EXISTS predicate below cannot drift.
--
-- The subquery is wrapped in (SELECT ...) so the helper and the EXISTS run once
-- per statement rather than once per row.
ALTER TABLE public.ingredient_transactions_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingredient_transactions_orders_select_policy
  ON public.ingredient_transactions_orders;
DROP POLICY IF EXISTS ingredient_transactions_orders_insert_policy
  ON public.ingredient_transactions_orders;
DROP POLICY IF EXISTS ingredient_transactions_orders_update_policy
  ON public.ingredient_transactions_orders;
DROP POLICY IF EXISTS ingredient_transactions_orders_delete_policy
  ON public.ingredient_transactions_orders;

CREATE POLICY ingredient_transactions_orders_select_policy
  ON public.ingredient_transactions_orders
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.restaurant_id = (SELECT private.current_restaurant_id())
  ));

CREATE POLICY ingredient_transactions_orders_insert_policy
  ON public.ingredient_transactions_orders
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.restaurant_id = (SELECT private.current_restaurant_id())
  ));

CREATE POLICY ingredient_transactions_orders_update_policy
  ON public.ingredient_transactions_orders
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.restaurant_id = (SELECT private.current_restaurant_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.restaurant_id = (SELECT private.current_restaurant_id())
  ));

CREATE POLICY ingredient_transactions_orders_delete_policy
  ON public.ingredient_transactions_orders
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.restaurant_id = (SELECT private.current_restaurant_id())
  ));

-- ============================================
-- SECTION 5: restaurants
-- ============================================
-- The tenant root. RLS was never enabled here, so any authenticated account
-- could read the whole restaurant list - other tenants' names, slugs and
-- timezone/currency - and rewrite or delete a row (the FKs to it cascade, so a
-- delete takes a tenant's data with it).
--
-- Read your own row, write nothing. Creating and editing restaurants is a
-- provisioning job (dashboard / SQL editor / service_role), which bypasses RLS;
-- 040_remaining_tables_tenancy.test.sql pins that service_role still writes.
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurants_select_policy ON public.restaurants;

CREATE POLICY restaurants_select_policy ON public.restaurants
  FOR SELECT TO authenticated
  USING (id = (SELECT private.current_restaurant_id()));

-- ============================================
-- SECTION 6: privileges
-- ============================================
-- The policies above are the authorization; the grants are what let the Data API
-- reach them at all, and 020_anon_lockdown asserts both directions: `anon` must
-- hold nothing anywhere in schema public, and `authenticated` /
-- `service_role` must keep SELECT/INSERT/UPDATE/DELETE on every public table.
-- Restated here so the four tables above keep their grants after this change.
REVOKE ALL ON TABLE public.business_config FROM anon;
REVOKE ALL ON TABLE public.ingredient_categories FROM anon;
REVOKE ALL ON TABLE public.ingredient_transactions_orders FROM anon;
REVOKE ALL ON TABLE public.restaurants FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingredient_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingredient_transactions_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.restaurants TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingredient_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ingredient_transactions_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.restaurants TO service_role;