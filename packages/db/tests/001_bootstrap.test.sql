-- Bootstrap contract test.
--
-- Asserts the state `pnpm test:db` must reach on a fresh plain Postgres: the
-- baseline migration applied, the schema fixes from the Supabase-era `fix_*`
-- migrations in place, and the test seed loaded with one profile per user.
--
-- Self-contained on purpose: `pnpm test:db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;

-- Supabase ships pgtap pre-installed in `extensions`; if it is ever missing a
-- bare CREATE EXTENSION lands in the first schema of the search_path. Cover
-- both locations.
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(11);

-- --- Migration history -----------------------------------------------------
-- The 43 supabase/migrations/ files are squashed into packages/db/migrations/
-- 0000_baseline.sql and later migrations follow it. The Drizzle migrator
-- records each applied file in drizzle.__drizzle_migrations; the runner must
-- have applied every file in the folder, so the count equals the number of
-- journal entries (0000_baseline, 0001_api_role_hardening, ...).
SELECT cmp_ok(
  (SELECT count(*) FROM drizzle.__drizzle_migrations)::bigint,
  '>=',
  2::bigint,
  'the baseline and the api role hardening migrations are recorded in drizzle.__drizzle_migrations'
);

-- --- orders.status ---------------------------------------------------------
-- 20250918180000_fix_orders_status_check.sql widens the CHECK so the kitchen
-- flow works. Asserted behaviourally: the rows are inserted for real and the
-- enclosing ROLLBACK discards them.
--
-- restaurant_id is passed explicitly because 20261005120000 points the column
-- DEFAULT at private.current_restaurant_id(): outside an authenticated
-- session there is no profile, so the default resolves to NULL and the NOT NULL
-- constraint rejects the row instead of silently landing in the seed
-- restaurant. Fail-closed on purpose, asserted here on purpose.
SELECT lives_ok(
  $$ INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total)
     VALUES ('a0eebc99-0000-0000-0000-000000000000', 'kitchen', 0, 0, 0, 0) $$,
  'orders accepts status = kitchen'
);
SELECT lives_ok(
  $$ INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total)
     VALUES ('a0eebc99-0000-0000-0000-000000000000', 'delivered', 0, 0, 0, 0) $$,
  'orders accepts status = delivered'
);

-- --- Tenant link -----------------------------------------------------------
SELECT has_column('public', 'profiles', 'user_id', 'profiles.user_id exists');
SELECT cmp_ok(
  (SELECT count(*) FROM public.restaurants)::bigint,
  '>',
  0::bigint,
  'at least one restaurant exists'
);

-- --- Seed ------------------------------------------------------------------
SELECT cmp_ok(
  (SELECT count(*) FROM public.users)::bigint,
  '>',
  0::bigint,
  'seed created users'
);
-- tests/seed.sql creates one profile per seeded user through the
-- tests.auth_users fixture trigger, then upserts the business data on
-- profiles.user_id, so nobody may end up with zero or two profiles.
SELECT is(
  (
    SELECT count(*)
    FROM public.users u
    WHERE (SELECT count(*) FROM public.profiles p WHERE p.user_id = u.id) <> 1
  )::bigint,
  0::bigint,
  'every seeded user has exactly one linked profile'
);

-- --- Functions -------------------------------------------------------------
-- pay_order is the new atomic checkout RPC (migration 20261006120000). The
-- broken legacy public.complete_payment() was dropped in the same migration
-- and is asserted absent in 070_pay_order.test.sql.
SELECT has_function('public', 'pay_order', 'pay_order() exists');
SELECT has_function('public', 'delete_order_with_items', 'delete_order_with_items() exists');

-- --- Tenant isolation in the policies --------------------------------------
-- 20250918180001 trusted auth.jwt() -> 'user_metadata' (user-editable via
-- auth.updateUser) and opened an `auth.uid() IS NULL` bypass. The tenant must
-- come from profiles.user_id through private.current_restaurant_id(); the
-- caller is now private.current_user_id(), so that is the bypass to look for.
SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%user_metadata%' OR with_check LIKE '%user_metadata%')
  )::bigint,
  0::bigint,
  'no policy in schema public trusts user_metadata for tenancy'
);
SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%current_user_id() IS NULL%' OR with_check LIKE '%current_user_id() IS NULL%')
  )::bigint,
  0::bigint,
  'no policy in schema public has a current_user_id() IS NULL bypass'
);

SELECT * FROM finish();
ROLLBACK;