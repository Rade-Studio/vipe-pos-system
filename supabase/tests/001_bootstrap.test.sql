-- Bootstrap contract test.
--
-- Asserts the state the Supabase CLI must reach after a clean
-- `supabase db reset`: every migration file applied, the schema fixes from the
-- `fix_*` migrations in place, and the seed loaded with one profile per auth
-- user.
--
-- Self-contained on purpose: `supabase test db` runs this file through
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
-- 38 files live in supabase/migrations/ (one more since the register_summary
-- / close_register RPCs).
-- The CLI records each applied file in supabase_migrations.schema_migrations;
-- the count proves none was skipped and that nothing ran outside the folder.
SELECT is(
  (SELECT count(*) FROM supabase_migrations.schema_migrations)::bigint,
  38::bigint,
  'all 38 migration files are recorded in supabase_migrations.schema_migrations'
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
SELECT has_column('public', 'profiles', 'auth_user_id', 'profiles.auth_user_id exists');
SELECT cmp_ok(
  (SELECT count(*) FROM public.restaurants)::bigint,
  '>',
  0::bigint,
  'at least one restaurant exists'
);

-- --- Seed ------------------------------------------------------------------
SELECT cmp_ok(
  (SELECT count(*) FROM auth.users)::bigint,
  '>',
  0::bigint,
  'seed created auth users'
);
-- handle_new_user() already links each seeded auth user to a profile, so a
-- second insert of the same users must not leave anybody without one.
SELECT is(
  (
    SELECT count(*)
    FROM auth.users u
    WHERE (SELECT count(*) FROM public.profiles p WHERE p.auth_user_id = u.id) <> 1
  )::bigint,
  0::bigint,
  'every seeded auth user has exactly one linked profile'
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
-- come from profiles.auth_user_id through private.current_restaurant_id().
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
      AND (qual LIKE '%auth.uid() IS NULL%' OR with_check LIKE '%auth.uid() IS NULL%')
  )::bigint,
  0::bigint,
  'no policy in schema public has an auth.uid() IS NULL bypass'
);

SELECT * FROM finish();
ROLLBACK;