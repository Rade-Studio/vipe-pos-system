-- Daily production (odd/tasks/produccion-diaria.md T1, S3, S4, S6, migration 0025).
--
-- production_batches gains produced_on (NOT NULL, backfilled from created_at in
-- the restaurant timezone) and produced_by (profile, SET NULL, backfilled from
-- created_by). produce_preparation keeps its signature; produce_preparation_on
-- and produce_preparations are SECURITY DEFINER RPCs for vipe_api only.
-- production_templates is admin only through RLS, names unique per
-- restaurant ignoring case.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(31);

-- ============================================
-- 1. production_batches columns and backfill
-- ============================================
SELECT col_type_is('public', 'production_batches', 'produced_on', 'date', 'produced_on is a date');
SELECT col_not_null('public', 'production_batches', 'produced_on', 'produced_on is NOT NULL');
SELECT col_default_is('public', 'production_batches', 'produced_on', 'CURRENT_DATE', 'produced_on defaults to current_date');
SELECT col_type_is('public', 'production_batches', 'produced_by', 'uuid', 'produced_by is uuid');
SELECT col_is_null('public', 'production_batches', 'produced_by', 'produced_by is nullable');
SELECT fk_ok('public', 'production_batches', 'produced_by', 'public', 'profiles', 'id', 'produced_by references profiles');
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conname = 'production_batches_produced_by_fkey'), 'n',
  'deleting the profile sets produced_by to NULL');
SELECT has_index('public', 'production_batches', 'idx_production_batches_restaurant_id_produced_on',
  'batches are indexed by restaurant and produced_on');
SELECT is((SELECT count(*)::int FROM public.production_batches WHERE produced_on IS NULL), 0, 'every batch has a produced_on');
SELECT matches(col_description('public.production_batches'::regclass,
                 (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.production_batches'::regclass AND attname = 'produced_on')),
  'Backfilled from created_at in the restaurant timezone', 'produced_on documents its backfill');
SELECT ok(has_table_privilege('vipe_api', 'public.production_batches', 'SELECT'), 'vipe_api keeps SELECT on production_batches');

-- The backfill expression of 0025 maps a late-night batch to its local day.
SELECT is(('2026-03-11T04:30:00Z'::timestamptz AT TIME ZONE 'America/Bogota')::date, '2026-03-10'::date,
  '23:30 in Bogota is the local day before the UTC date');

-- ============================================
-- 2. RPCs
-- ============================================
SELECT has_function('public', 'produce_preparation', ARRAY['uuid','numeric','uuid','text','text'],
  'produce_preparation keeps its signature');
SELECT has_function('public', 'produce_preparation_on', ARRAY['uuid','numeric','uuid','text','text','date','uuid'],
  'produce_preparation_on exists');
SELECT has_function('public', 'produce_preparations', ARRAY['jsonb','uuid','date','uuid','text'],
  'produce_preparations exists');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('produce_preparation_on', 'produce_preparations')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')),
  2, 'the new RPCs are SECURITY DEFINER, pin search_path and are executable by vipe_api');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE ((n.nspname = 'public' AND p.proname IN ('produce_preparation_on', 'produce_preparations'))
        OR (n.nspname = 'private' AND p.proname IN ('production_context', 'produce_batch')))
      AND a.grantee = 0),
  0, 'no new function grants EXECUTE to PUBLIC');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.produce_batch(text, uuid, uuid, uuid, numeric, uuid, text, text, date, uuid, text, boolean)', 'EXECUTE'),
  'vipe_api cannot call the private production body');

-- ============================================
-- 3. production_templates
-- ============================================
SELECT has_table('public', 'production_templates', 'production_templates exists');
SELECT col_type_is('public', 'production_templates', 'lines', 'jsonb', 'lines is jsonb');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.production_templates'::regclass), 'RLS is enabled');
SELECT is((SELECT array_agg(cmd::text ORDER BY cmd) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'production_templates' AND roles = '{vipe_api}'),
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'], 'select, insert, update and delete policies for vipe_api');
SELECT ok(has_table_privilege('vipe_api', 'public.production_templates', 'SELECT,INSERT,UPDATE,DELETE'), 'vipe_api may read and write templates');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.production_templates', 'TRUNCATE'), 'vipe_api cannot truncate templates');

INSERT INTO public.production_templates (restaurant_id, name, lines)
VALUES ('a0eebc99-0000-0000-0000-000000000000', 'Lunes', '[]');
SELECT throws_ok($$ INSERT INTO public.production_templates (restaurant_id, name) VALUES ('a0eebc99-0000-0000-0000-000000000000', ' lunes ') $$,
  '23505', NULL, 'names are unique per restaurant ignoring case and spaces');
SELECT throws_ok($$ INSERT INTO public.production_templates (restaurant_id, name) VALUES ('a0eebc99-0000-0000-0000-000000000000', '  ') $$,
  '23514', NULL, 'a blank name is refused');
SELECT throws_ok($$ INSERT INTO public.production_templates (restaurant_id, name) VALUES ('a0eebc99-0000-0000-0000-000000000000', repeat('a', 81)) $$,
  '23514', NULL, 'a name longer than 80 characters is refused');
SELECT throws_ok($$ INSERT INTO public.production_templates (restaurant_id, name, lines) VALUES ('a0eebc99-0000-0000-0000-000000000000', 'Obj', '{}') $$,
  '23514', NULL, 'lines must be an array');

-- RLS: the restaurant's admin reads its own templates only; other roles read none.
INSERT INTO public.restaurants (id, slug, name) VALUES ('36000000-0000-4000-8000-000000000001', 'prod-daily-b', 'Prod Daily B');
INSERT INTO public.production_templates (restaurant_id, name) VALUES ('36000000-0000-4000-8000-000000000001', 'Lunes');
SELECT set_config('app.user_id', (SELECT user_id::text FROM public.profiles
                                   WHERE role = 'admin' AND restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' AND user_id IS NOT NULL LIMIT 1), true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT array_agg(restaurant_id::text) FROM public.production_templates), ARRAY['a0eebc99-0000-0000-0000-000000000000'],
  'an admin reads only the templates of its restaurant');
SELECT throws_ok($$ INSERT INTO public.production_templates (restaurant_id, name) VALUES ('36000000-0000-4000-8000-000000000001', 'X') $$,
  '42501', NULL, 'an admin cannot write another restaurant''s template');
RESET ROLE;
SELECT set_config('app.user_id', (SELECT user_id::text FROM public.profiles
                                   WHERE role = 'waiter' AND restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' AND user_id IS NOT NULL LIMIT 1), true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*)::int FROM public.production_templates), 0, 'a waiter reads no template');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
