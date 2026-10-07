-- Tenant isolation contract test.
--
-- Proves that the caller's tenant is resolved from the JWT `sub` through
-- public.profiles (the only server-controlled link), never from the
-- user-editable `user_metadata` in the JWT, and that a JWT-less caller gets
-- no rows instead of an "auth.uid() IS NULL" bypass.
--
-- The impersonated user A carries a JWT whose user_metadata.restaurant_id
-- lies and points at tenant B: every assertion below must still resolve to
-- tenant A.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(17);

-- ============================================
-- Fixtures (all as the test author / postgres)
-- ============================================
--
-- Restaurant A = the caller's real tenant. Restaurant B = the tenant that the
-- forged user_metadata claims. Seed restaurant (a0eebc99-...) is the default
-- row created by 20250917090005 and is used as the "no profile at all"
-- fallback tenant, because it already holds seed rows.

INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'tenant-a', 'Tenant A'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'tenant-b', 'Tenant B');

-- Minimal valid auth.users rows; handle_new_user() fires and creates one
-- profile per user, which is then re-pointed at the right tenant below.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'user-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"User A","role":"admin"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'user-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"User B","role":"admin"}'::jsonb, now(), now()),
  ('cccccccc-0000-4000-8000-000000000033', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'user-c@example.com',
   crypt('c-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"User C","role":"waiter"}'::jsonb, now(), now());

-- Point the trigger-created profiles at their real tenants.
UPDATE public.profiles SET restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001'
 WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-000000000011';
UPDATE public.profiles SET restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002'
 WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-000000000022';
-- User C is an authenticated account with no profile at all.
DELETE FROM public.profiles WHERE auth_user_id = 'cccccccc-0000-4000-8000-000000000033';

-- A tenant-A waiter that has no auth_user_id (staff invited by an admin).
INSERT INTO public.profiles (id, restaurant_id, full_name, username, role, active)
VALUES ('aaaaaaaa-0000-4000-8000-0000000000a1',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Waiter A', 'waiter-a', 'waiter', true);

-- Two rows per tenant in the tables the app reads most often.
INSERT INTO public.tables (id, restaurant_id, number, status) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 9001, 'available'),
  ('a1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 9002, 'available'),
  ('b1000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 9003, 'available');

INSERT INTO public.categories (id, restaurant_id, name, icon) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'A one', 'Salad'),
  ('c1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'A two', 'Wine'),
  ('c1000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'B one', 'Beef');

INSERT INTO public.dishes (id, restaurant_id, name, price, category_id) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Dish A1', 1000, 'c1000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Dish A2', 2000, 'c1000000-0000-4000-8000-000000000002'),
  ('d1000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Dish B1', 3000, 'c1000000-0000-4000-8000-000000000003');

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'active', 0, 0, 0, 0),
  ('e1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'active', 0, 0, 0, 0),
  ('e1000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'active', 0, 0, 0, 0);

-- ============================================
-- 1. User A, JWT metadata LIES and claims tenant B
-- ============================================
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated",'
  '"user_metadata":{"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000002"}}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.tables)::bigint, 2::bigint,
  'user A sees only its own tables');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 2::bigint,
  'user A sees only its own orders');
SELECT is((SELECT count(*) FROM public.dishes)::bigint, 2::bigint,
  'user A sees only its own dishes');
SELECT is((SELECT count(*) FROM public.profiles)::bigint, 2::bigint,
  'user A sees only tenant A profiles (own profile + unlinked waiter)');
SELECT is((SELECT count(*) FROM public.profiles WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002')::bigint, 0::bigint,
  'user A sees zero tenant B profiles');

SELECT throws_ok(
  $$ INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'active', 0, 0, 0, 0) $$,
  '42501',
  'new row violates row-level security policy for table "orders"',
  'insert into another tenant orders is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.tables (restaurant_id, number, status)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 9010, 'available') $$,
  '42501',
  'new row violates row-level security policy for table "tables"',
  'insert into another tenant tables is rejected'
);
SELECT lives_ok(
  $$ INSERT INTO public.tables (number, status) VALUES (9011, 'available') $$,
  'user A can insert a table without passing restaurant_id'
);

RESET ROLE;

-- The column default must resolve to the caller tenant, not a fixed seed uuid.
SELECT is(
  (SELECT count(*) FROM public.tables WHERE number = 9011 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001')::bigint,
  1::bigint,
  'restaurant_id default resolves from the caller profile'
);

-- ============================================
-- 2. Cross-tenant writes are filtered out, not applied
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000011","role":"authenticated",'
  '"user_metadata":{"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000002"}}',
  true
);
SET LOCAL ROLE authenticated;
UPDATE public.orders SET status = 'cancelled' WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
DELETE FROM public.tables WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.orders WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002' AND status = 'cancelled')::bigint,
  0::bigint,
  'cross-tenant UPDATE affects zero rows'
);
SELECT is(
  (SELECT count(*) FROM public.tables WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000002')::bigint,
  1::bigint,
  'cross-tenant DELETE affects zero rows'
);

-- ============================================
-- 3. Authenticated user with no profile
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-000000000033","role":"authenticated",'
  '"user_metadata":{"restaurant_id":"a0eebc99-0000-0000-0000-000000000000"}}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.tables)::bigint, 0::bigint,
  'profileless user sees zero tables');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 0::bigint,
  'profileless user sees zero orders');
SELECT throws_ok(
  $$ INSERT INTO public.tables (restaurant_id, number, status)
     VALUES ('a0eebc99-0000-0000-0000-000000000000', 9020, 'available') $$,
  '42501',
  'new row violates row-level security policy for table "tables"',
  'profileless user cannot insert'
);

-- ============================================
-- 4. JWT without sub (no auth.uid() IS NULL bypass)
-- ============================================
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is((SELECT count(*) FROM public.tables)::bigint, 0::bigint,
  'a JWT without sub sees zero tables');
SELECT is((SELECT count(*) FROM public.orders)::bigint, 0::bigint,
  'a JWT without sub sees zero orders');
SELECT is((SELECT count(*) FROM public.profiles)::bigint, 0::bigint,
  'a JWT without sub sees zero profiles');

SELECT * FROM finish();
ROLLBACK;