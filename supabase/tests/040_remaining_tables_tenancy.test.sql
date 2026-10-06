-- Remaining-tables tenancy contract test.
--
-- Three tables plus the tenant root reached the stack with no `restaurant_id`
-- and no RLS at all, so the *grant* was the authorization: any authenticated
-- account could read every other restaurant's business_config (branding, tax
-- rate, NIT and the role PINs the admin panel stores there) and write it, and
-- could read or rewrite tenant B's ingredient catalog and order/consumption
-- links. `restaurants` had the same hole on the root table.
--
-- This file pins the replacement contract:
--   - business_config and ingredient_categories get `restaurant_id`
--     (NOT NULL, defaulted to the caller's tenant) and the same four
--     same-tenant policies the other tenant tables carry;
--   - business_config writes are admin-only, because the ConfigurationPanel is
--     the only writer (lib/supabase/business-config-service.ts is reached from
--     admin/ConfigurationPanel.tsx) while every role reads the config after
--     login (app/page.tsx:97, profiles/PasswordDialog.tsx);
--   - business_config is unique per (restaurant_id, key), not per key, so two
--     tenants can both own a 'business_name' row - the `.eq("key").single()`
--     call in business-config-service.ts must keep returning exactly one row;
--   - ingredient_transactions_orders has no tenant column of its own and keeps
--     none: it is scoped through the order it points at;
--   - restaurants is readable by a tenant's own row only and is never writable
--     by `authenticated` (service_role bypasses RLS for the admin/dashboard).
--
-- Assertions read tenant identity through `to_jsonb(row) ->> 'restaurant_id'`
-- and fixtures are inserted through a column-detecting helper, so the whole
-- file compiles and runs against the pre-migration schema as well: RED is a
-- wall of failed assertions rather than a file that dies on a missing column.
--
-- Impersonation follows 010/030: SET LOCAL ROLE authenticated plus
-- request.jwt.claims, row counts read back through a data-modifying probe
-- because an UPDATE/DELETE that RLS filters out raises nothing.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(60);

-- ============================================
-- Helpers
-- ============================================
-- Runs the caller's statement with the caller's privileges (SECURITY
-- INVOKER), so RLS and the privilege guards apply exactly as they do for the
-- API, and returns the affected row count.
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

-- Fixture writers. They must name restaurant_id explicitly once the column
-- exists: a fixture that relied on the DEFAULT would land in the oldest
-- restaurant instead of the tenant under test. Before the migration the column
-- is absent, so the insert is built from the catalogue.
CREATE FUNCTION pg_temp.seed_business_config(p_restaurant uuid, p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_config'
      AND column_name = 'restaurant_id'
  ) THEN
    EXECUTE format(
      'INSERT INTO public.business_config (restaurant_id, key, value) VALUES (%L, %L, %L)',
      p_restaurant, p_key, p_value);
  ELSE
    -- Before the migration UNIQUE(key) is global, so a key the seed or another
    -- fixture already owns cannot be inserted twice. Skipping the duplicate is
    -- what keeps this file runnable (and RED) on the old schema; the branch
    -- above, taken once the column exists, keeps both tenants' rows.
    EXECUTE format(
      'INSERT INTO public.business_config (key, value)
         SELECT %L, %L
        WHERE NOT EXISTS (SELECT 1 FROM public.business_config WHERE key = %L)',
      p_key, p_value, p_key);
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.seed_ingredient_category(p_restaurant uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ingredient_categories'
      AND column_name = 'restaurant_id'
  ) THEN
    EXECUTE format(
      'INSERT INTO public.ingredient_categories (id, restaurant_id, name) VALUES (%L, %L, %L)',
      gen_random_uuid(), p_restaurant, p_name);
  ELSE
    EXECUTE format(
      'INSERT INTO public.ingredient_categories (id, name) VALUES (%L, %L)',
      gen_random_uuid(), p_name);
  END IF;
END;
$$;

-- ============================================
-- Fixtures (as the test author / postgres)
-- ============================================
-- Tenant A and tenant B. The seed restaurant (a0eebc99-..., created by
-- 20250917090005) is older than both and is where the pre-existing
-- business_config rows live, so it doubles as the third tenant that A and B
-- must not see.
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000041', 'tenant-a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-000000000042', 'tenant-b', 'Tenant B'),
  -- Tenant C carries no rows anywhere. It exists only as an empty delete
  -- target for section 7: before the migration (no RLS) the DELETE below
  -- succeeds on it, and a restaurant with children would instead trip a
  -- foreign key and kill the file.
  ('cccccccc-0000-4000-8000-000000000043', 'tenant-c-empty', 'Tenant C Empty');

-- Tenant A gets an admin and a waiter, tenant B an admin. The tenant and the
-- role ride on raw_app_meta_data, the server-controlled half of the identity
-- that handle_new_user() reads (20261005140000).
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rest-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000041"}'::jsonb,
   '{"full_name":"Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rest-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000041"}'::jsonb,
   '{"full_name":"Waiter A"}'::jsonb, now(), now()),
  -- Tenant B admin.
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rest-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000042"}'::jsonb,
   '{"full_name":"Admin B"}'::jsonb, now(), now()),
  -- A fourth account with no profile at all: fail-closed tenant.
  ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rest-noprofile@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"No Profile"}'::jsonb, now(), now());
DELETE FROM public.profiles WHERE auth_user_id = 'cccccccc-0000-4000-8000-0000000000c1';

-- The fixture only means something if handle_new_user() really placed the
-- three profiles, so say so before any of the assertions below relies on it.
SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1')::text,
  'aaaaaaaa-0000-4000-8000-000000000041'::text,
  'fixture: the admin A profile is linked and placed in tenant A');
SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2')::text,
  'waiter'::text,
  'fixture: the waiter A profile carries the waiter role');
SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1')::text,
  'bbbbbbbb-0000-4000-8000-000000000042'::text,
  'fixture: the admin B profile is placed in tenant B');

-- Rows per tenant. business_config carries the two keys the admin panel edits
-- (admin/ConfigurationPanel.tsx) plus, for tenant B, the extra one the
-- triangulation below needs. 'business_name' exists in both tenants: that is
-- exactly what the old UNIQUE(key) forbade.
SELECT pg_temp.seed_business_config(
  'aaaaaaaa-0000-4000-8000-000000000041', 'business_name', 'Tenant A Name');
SELECT pg_temp.seed_business_config(
  'aaaaaaaa-0000-4000-8000-000000000041', 'business_address', 'Tenant A Street');
SELECT pg_temp.seed_business_config(
  'bbbbbbbb-0000-4000-8000-000000000042', 'business_name', 'Tenant B Name');
SELECT pg_temp.seed_business_config(
  'bbbbbbbb-0000-4000-8000-000000000042', 'business_phone', 'Tenant B Phone');

SELECT pg_temp.seed_ingredient_category(
  'aaaaaaaa-0000-4000-8000-000000000041', 'Produce');
SELECT pg_temp.seed_ingredient_category(
  'bbbbbbbb-0000-4000-8000-000000000042', 'Produce');

-- One order and one ingredient transaction per tenant, then one junction link
-- per tenant (lib/supabase/inventory-control-service.ts inserts these as the
-- logged-in user while cooking).
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total)
VALUES
  ('e4000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000041', 'active', 0, 0, 0, 0),
  ('e4000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000042', 'active', 0, 0, 0, 0);

INSERT INTO public.ingredient_transactions (
  id, restaurant_id, quantity, total_cost, unit_cost, transaction_type
)
VALUES
  ('f4000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000041', 1, 100, 100, 'entrada'),
  ('f4000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000042', 1, 200, 200, 'entrada'),
  -- A second consumption in tenant A, so the "allowed" insert below links a
  -- pair that does not already exist.
  ('f4000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000041', 1, 300, 300, 'salida');

INSERT INTO public.ingredient_transactions_orders (
  id, order_id, ingredient_transaction_id, quantity_cents
)
VALUES
  ('a4000000-0000-4000-8000-000000000001',
   'e4000000-0000-4000-8000-000000000001',
   'f4000000-0000-4000-8000-000000000001', 100),
  ('b4000000-0000-4000-8000-000000000002',
   'e4000000-0000-4000-8000-000000000002',
   'f4000000-0000-4000-8000-000000000002', 200);

-- ============================================
-- 1. Structure: the columns, the RLS switches and the policies
-- ============================================
SELECT has_column('public', 'business_config', 'restaurant_id',
  'business_config is tenant-scoped');
SELECT has_column('public', 'ingredient_categories', 'restaurant_id',
  'ingredient_categories is tenant-scoped');

SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.business_config'::regclass), true,
  'RLS is enabled on business_config');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ingredient_categories'::regclass), true,
  'RLS is enabled on ingredient_categories');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ingredient_transactions_orders'::regclass), true,
  'RLS is enabled on ingredient_transactions_orders');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.restaurants'::regclass), true,
  'RLS is enabled on restaurants');

SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'business_config'), 4::bigint,
  'business_config carries one policy per command');
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ingredient_categories'), 4::bigint,
  'ingredient_categories carries one policy per command');
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ingredient_transactions_orders'), 4::bigint,
  'ingredient_transactions_orders carries one policy per command');
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurants'), 1::bigint,
  'restaurants carries a single read policy and no write policy');

-- UNIQUE(key) is what stops two tenants from sharing a key today. The
-- constraint that survives must span the tenant.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = 'public.business_config'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%restaurant_id%'), 1::bigint,
  'business_config uniqueness is per (restaurant_id, key)');

-- ============================================
-- 2. business_config read as a waiter: own tenant only, no writes
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.business_config)::bigint, 2::bigint,
  'a waiter of tenant A sees exactly the two tenant A config rows');

-- .eq("key", key).single() (business-config-service.getConfigValue): it must
-- match one row, and it must be tenant A's, even though tenant B and the seed
-- restaurant hold the same key.
SELECT is((SELECT count(*) FROM public.business_config WHERE key = 'business_name')::bigint, 1::bigint,
  'business_name resolves to a single row per tenant');
SELECT is((SELECT value FROM public.business_config WHERE key = 'business_name')::text,
  'Tenant A Name'::text,
  'the single business_name row is the caller''s own');

-- Only the admin ConfigurationPanel writes business_config.
SELECT throws_ok(
  $$ INSERT INTO public.business_config (key, value) VALUES ('waiter_key', 'x') $$,
  '42501', NULL,
  'a waiter cannot insert a config row');
SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.business_config SET value = 'hijacked'
        WHERE key = 'business_name' $$),
  0,
  'a waiter updating config affects zero rows');
SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.business_config WHERE key = 'business_address' $$),
  0,
  'a waiter deleting config affects zero rows');

RESET ROLE;

-- ============================================
-- 3. business_config write as an admin of the same tenant
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.business_config)::bigint, 2::bigint,
  'an admin of tenant A still sees only tenant A config');

-- saveConfigValue inserts `{ key, value }` with no restaurant_id
-- (lib/supabase/business-config-service.ts): the DEFAULT has to place it.
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.business_config (key, value) VALUES ('tenant_a_tax', '19') $$),
  1,
  'an admin can insert a config key without naming restaurant_id');

-- Cross-tenant writes are filtered out, never applied.
SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.business_config SET value = 'stolen'
        WHERE key = 'business_name'
          AND (to_jsonb(business_config) ->> 'restaurant_id')
              = 'bbbbbbbb-0000-4000-8000-000000000042' $$),
  0,
  'an admin of tenant A affects zero rows in tenant B');
SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.business_config
        WHERE key = 'business_phone'
          AND (to_jsonb(business_config) ->> 'restaurant_id')
              = 'bbbbbbbb-0000-4000-8000-000000000042' $$),
  0,
  'an admin of tenant A deletes zero rows in tenant B');

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.business_config SET value = 'Tenant A Street 2'
        WHERE key = 'business_address' $$),
  1,
  'an admin can update its own tenant''s config row');
SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.business_config WHERE key = 'business_address' $$),
  1,
  'an admin can delete its own tenant''s config row');

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.business_config
    WHERE (to_jsonb(business_config) ->> 'restaurant_id')
          = 'aaaaaaaa-0000-4000-8000-000000000041')::bigint,
  2::bigint,
  'tenant A keeps business_name plus the key the admin inserted, and lost business_address');
SELECT is(
  (SELECT to_jsonb(business_config) ->> 'restaurant_id'
    FROM public.business_config WHERE key = 'tenant_a_tax')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000041'::uuid,
  'the key inserted without restaurant_id landed in the caller''s own tenant');
SELECT is(
  (SELECT value FROM public.business_config
    WHERE key = 'business_phone'
      AND (to_jsonb(business_config) ->> 'restaurant_id')
          = 'bbbbbbbb-0000-4000-8000-000000000042'
    LIMIT 1)::text,
  'Tenant B Phone'::text,
  'tenant B''s row is untouched by the tenant A admin');

-- ============================================
-- 4. The same key in two tenants at once (UNIQUE(restaurant_id, key))
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.business_config)::bigint, 2::bigint,
  'an admin of tenant B sees only the two tenant B config rows');
SELECT is((SELECT count(*) FROM public.business_config WHERE key = 'business_name')::bigint, 1::bigint,
  'the shared key still resolves to exactly one row for tenant B');
SELECT is((SELECT value FROM public.business_config WHERE key = 'business_name')::text,
  'Tenant B Name'::text,
  'tenant B reads its own business_name, not tenant A''s');
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.business_config (key, value) VALUES ('tenant_b_pin', '4321') $$),
  1,
  'tenant B can own a key tenant A also owns');

RESET ROLE;

SELECT is(
  (SELECT to_jsonb(business_config) ->> 'restaurant_id'
    FROM public.business_config WHERE key = 'tenant_b_pin')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000042'::uuid,
  'the tenant B key landed in tenant B, not in tenant A');

-- ============================================
-- 5. ingredient_categories
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.ingredient_categories)::bigint, 1::bigint,
  'a waiter of tenant A sees only tenant A ingredient categories');

-- components/admin/inventory/IngredientForm.tsx inserts `{ name, ... }` with no
-- restaurant_id.
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.ingredient_categories (name) VALUES ('Dairy') $$),
  1,
  'a category can be inserted without naming restaurant_id');

SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.ingredient_categories SET name = 'Stolen'
        WHERE name = 'Produce'
          AND (to_jsonb(ingredient_categories) ->> 'restaurant_id')
              = 'bbbbbbbb-0000-4000-8000-000000000042' $$),
  0,
  'a tenant A write affects zero rows in tenant B');
SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.ingredient_categories
        WHERE name = 'Produce'
          AND (to_jsonb(ingredient_categories) ->> 'restaurant_id')
              = 'bbbbbbbb-0000-4000-8000-000000000042' $$),
  0,
  'a tenant A delete affects zero rows in tenant B');

RESET ROLE;

SELECT is(
  (SELECT to_jsonb(ingredient_categories) ->> 'restaurant_id'
    FROM public.ingredient_categories WHERE name = 'Dairy')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000041'::uuid,
  'the category inserted without restaurant_id landed in the caller''s tenant');
SELECT is(
  (SELECT count(*) FROM public.ingredient_categories
    WHERE (to_jsonb(ingredient_categories) ->> 'restaurant_id')
          = 'bbbbbbbb-0000-4000-8000-000000000042')::bigint,
  1::bigint,
  'tenant B still has its own Produce category, unrenamed');

-- Triangulation: ingredient_categories has no unique name constraint today, so
-- nothing stops two tenants from sharing a category name. The catalog then has
-- to keep the two rows apart by tenant instead of by name.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000b1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.ingredient_categories (name) VALUES ('Produce') $$),
  1,
  'two tenants may hold a category with the same name');
SELECT is((SELECT count(*) FROM public.ingredient_categories)::bigint, 2::bigint,
  'each tenant sees only its own copy of that category');

RESET ROLE;

-- ============================================
-- 6. ingredient_transactions_orders: scoped through the order
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.ingredient_transactions_orders)::bigint, 1::bigint,
  'tenant A sees only the links whose order is in tenant A');

-- inventory-control-service.ts links a consumption to the order being cooked.
-- A tenant must not be able to attach a link to another tenant''s order.
SELECT throws_ok(
  $$ INSERT INTO public.ingredient_transactions_orders
       (order_id, ingredient_transaction_id, quantity_cents)
     VALUES ('e4000000-0000-4000-8000-000000000002',
             'f4000000-0000-4000-8000-000000000001', 100) $$,
  '42501', NULL,
  'linking a tenant A consumption to a tenant B order is rejected');
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.ingredient_transactions_orders
         (order_id, ingredient_transaction_id, quantity_cents)
       VALUES ('e4000000-0000-4000-8000-000000000001',
               'f4000000-0000-4000-8000-000000000003', 250) $$),
  1,
  'linking to its own tenant''s order is allowed');

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.ingredient_transactions_orders ito
     JOIN public.orders o ON o.id = ito.order_id
    WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000041')::bigint, 2::bigint,
  'tenant A holds both of its own links and none of the rejected ones');
SELECT is(
  (SELECT count(*) FROM public.ingredient_transactions_orders ito
     JOIN public.orders o ON o.id = ito.order_id
    WHERE o.restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000042')::bigint, 1::bigint,
  'tenant B still holds exactly its own link, untouched');

-- ============================================
-- 7. restaurants: own row readable, never writable
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.restaurants)::bigint, 1::bigint,
  'a tenant sees exactly its own restaurant row');
SELECT is(
  (SELECT count(*) FROM public.restaurants
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041')::bigint, 1::bigint,
  'and that row is its own');
SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.restaurants SET name = 'Renamed By Waiter'
        WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041' $$),
  0,
  'a waiter updating its own restaurant row affects zero rows');
SELECT is(
  pg_temp.probe_exec(
    $$ DELETE FROM public.restaurants
        WHERE id = 'cccccccc-0000-4000-8000-000000000043' $$),
  0,
  'a waiter deleting a restaurant row affects zero rows');
SELECT throws_ok(
  $$ INSERT INTO public.restaurants (slug, name) VALUES ('sneaky', 'Sneaky') $$,
  '42501', NULL,
  'a waiter cannot create a restaurant');

RESET ROLE;

SELECT is(
  (SELECT name FROM public.restaurants
    WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041')::text,
  'Tenant A'::text,
  'the restaurant row keeps its name');
SELECT is(
  (SELECT count(*) FROM public.restaurants
    WHERE id = 'cccccccc-0000-4000-8000-000000000043')::bigint,
  1::bigint,
  'the restaurant row the waiter targeted still exists');

-- service_role keeps the provisioning path (dashboard / SQL editor / seed).
SET LOCAL ROLE service_role;
SELECT is(
  pg_temp.probe_exec(
    $$ UPDATE public.restaurants SET name = 'Tenant A Renamed By Service'
        WHERE id = 'aaaaaaaa-0000-4000-8000-000000000041' $$),
  1,
  'service_role still writes restaurants (RLS bypass)');

-- Server-side callers (future webhooks) must name the tenant explicitly: the
-- oldest-restaurant fallback is reserved for postgres (seed and migrations).
SELECT throws_ok(
  $$ INSERT INTO public.business_config (key, value) VALUES ('svc_probe', 'x') $$,
  '23502',
  NULL,
  'service_role cannot insert business_config without restaurant_id');

-- ...and the provisioning path works once the tenant is named.
SELECT is(
  pg_temp.probe_exec(
    $$ INSERT INTO public.business_config (restaurant_id, key, value)
       VALUES ('bbbbbbbb-0000-4000-8000-000000000042', 'svc_probe', 'x') $$),
  1,
  'service_role inserts business_config when it names restaurant_id');
RESET ROLE;
SELECT is(
  (SELECT restaurant_id FROM public.business_config WHERE key = 'svc_probe')::uuid,
  'bbbbbbbb-0000-4000-8000-000000000042'::uuid,
  'the service_role row lands in the tenant it named');

-- ============================================
-- 8. Fail closed: an authenticated account with no profile
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-0000000000c1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.business_config)::bigint, 0::bigint,
  'a profileless caller sees no business_config row');
SELECT is((SELECT count(*) FROM public.restaurants)::bigint, 0::bigint,
  'a profileless caller sees no restaurant row');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;