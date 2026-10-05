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

SELECT plan(9);

-- --- Migration history -----------------------------------------------------
-- 29 files live in supabase/migrations/. The CLI records each applied file in
-- supabase_migrations.schema_migrations; the count proves none was skipped and
-- that nothing ran outside the folder.
SELECT is(
  (SELECT count(*) FROM supabase_migrations.schema_migrations)::bigint,
  29::bigint,
  'all 29 migration files are recorded in supabase_migrations.schema_migrations'
);

-- --- orders.status ---------------------------------------------------------
-- 20250918180000_fix_orders_status_check.sql widens the CHECK so the kitchen
-- flow works. Asserted behaviourally: the rows are inserted for real and the
-- enclosing ROLLBACK discards them.
SELECT lives_ok(
  $$ INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total)
     VALUES ('11111111-0000-0000-0000-000000000001', 'kitchen', 0, 0, 0, 0) $$,
  'orders accepts status = kitchen'
);
SELECT lives_ok(
  $$ INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total)
     VALUES ('11111111-0000-0000-0000-000000000002', 'delivered', 0, 0, 0, 0) $$,
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
SELECT has_function('public', 'complete_payment', 'complete_payment() exists');
SELECT has_function('public', 'delete_order_with_items', 'delete_order_with_items() exists');

SELECT * FROM finish();
ROLLBACK;