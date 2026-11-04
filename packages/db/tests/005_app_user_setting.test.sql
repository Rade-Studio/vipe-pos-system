-- Caller identity through app.user_id.
--
-- On plain Postgres there is no auth.uid(): the API runs
-- SET LOCAL app.user_id = '<uuid>' at the start of every request transaction
-- and connects as vipe_api. This file pins the contract the tenant helpers
-- and every RLS policy rest on:
--   - without app.user_id (absent or empty) the helpers return NULL and
--     vipe_api sees no rows at all;
--   - with app.user_id they resolve the seeded profile, and only its tenant.
--
-- Self-contained: pg_prove does not wrap anything, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(14);

-- ============================================
-- Fixtures (as the test author)
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000501', 'app-user-a', 'App User A'),
  ('bbbbbbbb-0000-4000-8000-000000000502', 'app-user-b', 'App User B');

INSERT INTO public.users (id, email, password_hash) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000005e1', 'app-user-a@example.com', 'x'),
  ('bbbbbbbb-0000-4000-8000-0000000005e2', 'app-user-b@example.com', 'x');

INSERT INTO public.profiles (id, user_id, restaurant_id, full_name, username, role, active) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000005f1', 'aaaaaaaa-0000-4000-8000-0000000005e1',
   'aaaaaaaa-0000-4000-8000-000000000501', 'Cashier A', 'app-cashier-a', 'cashier', true),
  ('bbbbbbbb-0000-4000-8000-0000000005f2', 'bbbbbbbb-0000-4000-8000-0000000005e2',
   'bbbbbbbb-0000-4000-8000-000000000502', 'Admin B', 'app-admin-b', 'admin', true);

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000005a1', 'aaaaaaaa-0000-4000-8000-000000000501', 'active', 0, 0, 0, 0),
  ('bbbbbbbb-0000-4000-8000-0000000005b1', 'bbbbbbbb-0000-4000-8000-000000000502', 'active', 0, 0, 0, 0);

-- ============================================
-- 1. vipe_api is a plain role: RLS always applies
-- ============================================
SELECT ok(
  NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'vipe_api'),
  'vipe_api is neither superuser nor BYPASSRLS'
);

-- ============================================
-- 2. No app.user_id: helpers are NULL, no rows
-- ============================================
SET LOCAL ROLE vipe_api;

SELECT is(private.current_user_id(), NULL::uuid,
  'without app.user_id current_user_id() is NULL');
SELECT is(private.current_restaurant_id(), NULL::uuid,
  'without app.user_id current_restaurant_id() is NULL');
SELECT is(private.current_app_role(), NULL::text,
  'without app.user_id current_app_role() is NULL');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 0::bigint,
  'without app.user_id vipe_api sees zero orders');

-- An empty setting (what RESET-style code leaves behind) is the same as none.
SELECT set_config('app.user_id', '', true);
SELECT is(private.current_user_id(), NULL::uuid,
  'an empty app.user_id is NULL, not an error');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 0::bigint,
  'an empty app.user_id sees zero orders');

-- ============================================
-- 3. app.user_id set: helpers resolve the profile
-- ============================================
SELECT set_config('app.user_id', 'aaaaaaaa-0000-4000-8000-0000000005e1', true);

SELECT is(private.current_user_id(), 'aaaaaaaa-0000-4000-8000-0000000005e1'::uuid,
  'current_user_id() reads app.user_id');
SELECT is(private.current_restaurant_id(), 'aaaaaaaa-0000-4000-8000-000000000501'::uuid,
  'current_restaurant_id() resolves the tenant through profiles.user_id');
SELECT is(private.current_app_role(), 'cashier'::text,
  'current_app_role() resolves the role through profiles.user_id');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 1::bigint,
  'vipe_api sees only the orders of the caller tenant');
SELECT is((SELECT id FROM public.orders), 'aaaaaaaa-0000-4000-8000-0000000005a1'::uuid,
  'the visible order is the tenant A one');

-- Switching the setting switches the tenant inside the same transaction.
SELECT set_config('app.user_id', 'bbbbbbbb-0000-4000-8000-0000000005e2', true);
SELECT is(private.current_restaurant_id(), 'bbbbbbbb-0000-4000-8000-000000000502'::uuid,
  'a new app.user_id resolves the other tenant');

-- A user with no profile is fail-closed.
SELECT set_config('app.user_id', 'cccccccc-0000-4000-8000-0000000005e3', true);
SELECT is((SELECT count(*) FROM public.orders)::bigint, 0::bigint,
  'an app.user_id with no profile sees zero orders');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
