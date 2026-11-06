-- Menu tree: category order and colour, subcategories, dishes in a
-- subcategory (odd/tasks/rediseno-pos.md, T7, S5).
--
-- public.categories gains sort_order and a colour token from a closed set
-- (neutral by default); public.subcategories holds the second order step per
-- category; public.dishes.subcategory_id is guarded by a composite foreign key
-- so a dish only sits in a subcategory of its own restaurant and category.
-- "Sin subcategorías" is derived: a category with no subcategory in use.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(49);

-- ============================================
-- 1. Schema
-- ============================================
SELECT col_not_null('public', 'categories', 'sort_order', 'categories.sort_order is NOT NULL');
SELECT col_default_is('public', 'categories', 'sort_order', '0', 'categories.sort_order defaults to 0');
SELECT col_not_null('public', 'categories', 'color', 'categories.color is NOT NULL');
SELECT col_default_is('public', 'categories', 'color', 'neutral', 'categories.color defaults to neutral');

SELECT has_table('public', 'subcategories', 'public.subcategories exists');
SELECT columns_are('public', 'subcategories',
  ARRAY['id', 'restaurant_id', 'category_id', 'name', 'sort_order', 'active', 'created_at', 'updated_at'],
  'subcategories has exactly the menu tree columns');
SELECT col_default_is('public', 'subcategories', 'restaurant_id', 'private.current_restaurant_id()', 'subcategories.restaurant_id defaults to the caller tenant');
SELECT col_default_is('public', 'subcategories', 'sort_order', '0', 'subcategories.sort_order defaults to 0');
SELECT col_default_is('public', 'subcategories', 'active', 'true', 'subcategories.active defaults to true');
SELECT col_not_null('public', 'subcategories', 'category_id', 'subcategories.category_id is NOT NULL');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subcategories'::regclass), 'subcategories has row level security enabled');
SELECT policies_are('public', 'subcategories',
  ARRAY['subcategories_select_policy', 'subcategories_insert_policy', 'subcategories_update_policy', 'subcategories_delete_policy'],
  'subcategories has the four tenant policies');
SELECT trigger_is('public', 'subcategories', 'subcategories_set_updated_at', 'public', 'set_updated_at', 'subcategories keeps updated_at');
SELECT fk_ok('public', 'subcategories', ARRAY['restaurant_id', 'category_id'], 'public', 'categories', ARRAY['restaurant_id', 'id'],
  'a subcategory references its category through (restaurant_id, category_id)');

SELECT has_column('public', 'dishes', 'subcategory_id', 'dishes.subcategory_id exists');
SELECT col_is_null('public', 'dishes', 'subcategory_id', 'dishes.subcategory_id is nullable (dish directly under the category)');
SELECT fk_ok('public', 'dishes', ARRAY['restaurant_id', 'category_id', 'subcategory_id'],
  'public', 'subcategories', ARRAY['restaurant_id', 'category_id', 'id'],
  'a dish references its subcategory through (restaurant_id, category_id, subcategory_id)');

-- ============================================
-- Fixtures: restaurants A and B, one admin each, unordered categories in A.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('23000000-0000-0000-0000-0000000000a1', 't230-a', 'T230 A'),
  ('23000000-0000-0000-0000-0000000000b2', 't230-b', 'T230 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('23000000-0000-0000-0000-000000000001', 'admin@t230a.test', 'h'),
  ('23000000-0000-0000-0000-000000000002', 'admin@t230b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('23100000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t230a.test', 'admin', true, '23000000-0000-0000-0000-0000000000a1'),
  ('23100000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t230b.test', 'admin', true, '23000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, name, icon, restaurant_id) VALUES
  ('23200000-0000-0000-0000-0000000000a1', 'Platos fuertes', 'beef', '23000000-0000-0000-0000-0000000000a1'),
  ('23200000-0000-0000-0000-0000000000a2', 'bebidas', 'water', '23000000-0000-0000-0000-0000000000a1'),
  ('23200000-0000-0000-0000-0000000000a3', 'Entradas', 'salad', '23000000-0000-0000-0000-0000000000a1'),
  ('23200000-0000-0000-0000-0000000000b1', 'Platos fuertes', 'beef', '23000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, name, icon, sort_order, restaurant_id) VALUES
  ('23200000-0000-0000-0000-0000000000b2', 'Bebidas', 'water', 5, '23000000-0000-0000-0000-0000000000b2');

-- ============================================
-- 2. Backfill of the category order
-- ============================================
SELECT lives_ok($$ SELECT private.backfill_category_sort_order() $$, 'the category order backfill runs');
SELECT is(
  (SELECT array_agg(name::text ORDER BY sort_order) FROM public.categories WHERE restaurant_id = '23000000-0000-0000-0000-0000000000a1'),
  ARRAY['bebidas', 'Entradas', 'Platos fuertes'],
  'unordered categories are numbered in name order, case-insensitively');
SELECT is(
  (SELECT array_agg(sort_order ORDER BY sort_order) FROM public.categories WHERE restaurant_id = '23000000-0000-0000-0000-0000000000a1'),
  ARRAY[0, 1, 2],
  'the backfilled order starts at 0 without gaps');
SELECT is(
  (SELECT array_agg(sort_order ORDER BY name) FROM public.categories WHERE restaurant_id = '23000000-0000-0000-0000-0000000000b2'),
  ARRAY[5, 0],
  'a restaurant with an order already set is left untouched');
UPDATE public.categories SET sort_order = 9 WHERE id = '23200000-0000-0000-0000-0000000000a2';
SELECT lives_ok($$ SELECT private.backfill_category_sort_order() $$, 'the backfill runs again');
SELECT is(
  (SELECT sort_order FROM public.categories WHERE id = '23200000-0000-0000-0000-0000000000a2'),
  9,
  'the backfill is idempotent and keeps an order the admin set');
SELECT is(
  has_function_privilege('vipe_api', 'private.backfill_category_sort_order()', 'EXECUTE'),
  false,
  'vipe_api cannot run the backfill');

-- ============================================
-- 3. CHECK constraints and unique names
-- ============================================
SELECT throws_ok($$ UPDATE public.categories SET color = 'purple' WHERE id = '23200000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a colour outside the closed set is refused');
SELECT lives_ok(
  $$ INSERT INTO public.categories (name, icon, color, restaurant_id)
     SELECT 'Color ' || c, 'salad', c, '23000000-0000-0000-0000-0000000000b2'
       FROM unnest(ARRAY['neutral', 'yellow', 'orange', 'sky', 'violet', 'emerald', 'rose']) c $$,
  'every colour token of the closed set is accepted');

INSERT INTO public.subcategories (id, restaurant_id, category_id, name) VALUES
  ('23300000-0000-0000-0000-0000000000a1', '23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a1', 'Carnes'),
  ('23300000-0000-0000-0000-0000000000a2', '23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a2', 'Jugos'),
  ('23300000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000b2', '23200000-0000-0000-0000-0000000000b1', 'Carnes');
SELECT throws_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a1', 'CARNES') $$,
  '23505', NULL, 'subcategory names are unique per category, case-insensitively');
SELECT lives_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a3', 'Carnes') $$,
  'another category may reuse a subcategory name');
SELECT throws_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a1', '  ') $$,
  '23514', NULL, 'a blank subcategory name is refused');
SELECT throws_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a1', repeat('x', 41)) $$,
  '23514', NULL, 'a subcategory name over 40 characters is refused');
SELECT lives_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000a1', repeat('x', 40)) $$,
  'a subcategory name of 40 characters is accepted');
SELECT throws_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000a1', '23200000-0000-0000-0000-0000000000b1', 'Intrusa') $$,
  '23503', NULL, 'a subcategory cannot hang off a category of another restaurant');

-- ============================================
-- 4. Dishes in a subcategory: same restaurant, same category
-- ============================================
INSERT INTO public.dishes (id, name, price, category_id, restaurant_id) VALUES
  ('23400000-0000-0000-0000-0000000000a1', 'Churrasco', 40000, '23200000-0000-0000-0000-0000000000a1', '23000000-0000-0000-0000-0000000000a1'),
  ('23400000-0000-0000-0000-0000000000a2', 'Sin categoría', 1000, NULL, '23000000-0000-0000-0000-0000000000a1');
SELECT lives_ok(
  $$ UPDATE public.dishes SET subcategory_id = '23300000-0000-0000-0000-0000000000a1' WHERE id = '23400000-0000-0000-0000-0000000000a1' $$,
  'a dish goes into a subcategory of its own category');
SELECT throws_ok(
  $$ UPDATE public.dishes SET subcategory_id = '23300000-0000-0000-0000-0000000000a2' WHERE id = '23400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'a dish without a category cannot have a subcategory');
SELECT throws_ok(
  $$ INSERT INTO public.dishes (name, price, category_id, subcategory_id, restaurant_id) VALUES ('Jugo', 5000, '23200000-0000-0000-0000-0000000000a1', '23300000-0000-0000-0000-0000000000a2', '23000000-0000-0000-0000-0000000000a1') $$,
  '23503', NULL, 'a dish cannot sit in a subcategory of another category');
SELECT throws_ok(
  $$ INSERT INTO public.dishes (name, price, category_id, subcategory_id, restaurant_id) VALUES ('Intruso', 5000, '23200000-0000-0000-0000-0000000000a1', '23300000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000a1') $$,
  '23503', NULL, 'a dish cannot sit in a subcategory of another restaurant');
SELECT throws_ok(
  $$ UPDATE public.dishes SET category_id = '23200000-0000-0000-0000-0000000000a2' WHERE id = '23400000-0000-0000-0000-0000000000a1' $$,
  '23503', NULL, 'moving a dish to another category while it keeps the old subcategory is refused');
SELECT lives_ok(
  $$ UPDATE public.dishes SET category_id = '23200000-0000-0000-0000-0000000000a2', subcategory_id = '23300000-0000-0000-0000-0000000000a2' WHERE id = '23400000-0000-0000-0000-0000000000a1' $$,
  'moving a dish with a subcategory of the new category is accepted');
SELECT throws_ok(
  $$ UPDATE public.subcategories SET category_id = '23200000-0000-0000-0000-0000000000a3' WHERE id = '23300000-0000-0000-0000-0000000000a2' $$,
  '23503', NULL, 'a subcategory in use cannot move to another category');
SELECT throws_ok(
  $$ DELETE FROM public.subcategories WHERE id = '23300000-0000-0000-0000-0000000000a2' $$,
  '23503', NULL, 'a subcategory with dishes cannot be deleted');
SELECT throws_ok(
  $$ DELETE FROM public.categories WHERE id = '23200000-0000-0000-0000-0000000000a1' $$,
  '23503', NULL, 'a category with subcategories cannot be deleted');
SELECT lives_ok(
  $$ DELETE FROM public.subcategories WHERE id = '23300000-0000-0000-0000-0000000000a1' $$,
  'an empty subcategory can be deleted');

-- ============================================
-- 5. RLS isolation for vipe_api
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.subcategories)::bigint, 0::bigint, 'without app.user_id vipe_api sees no subcategories');
SELECT set_config('app.user_id', '23000000-0000-0000-0000-000000000001', true);
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.subcategories),
  ARRAY['Carnes', 'Jugos', repeat('x', 40)],
  'admin of A sees only the subcategories of A');
SELECT lives_ok(
  $$ INSERT INTO public.subcategories (category_id, name, sort_order) VALUES ('23200000-0000-0000-0000-0000000000a3', 'Patacones', 1) $$,
  'admin of A creates a subcategory in A through the default tenant');
UPDATE public.subcategories SET name = 'Hackeada' WHERE id = '23300000-0000-0000-0000-0000000000b1';
SELECT throws_ok(
  $$ INSERT INTO public.subcategories (restaurant_id, category_id, name) VALUES ('23000000-0000-0000-0000-0000000000b2', '23200000-0000-0000-0000-0000000000b1', 'Intrusa') $$,
  '42501', NULL, 'admin of A cannot create a subcategory in B');
SELECT set_config('app.user_id', '23000000-0000-0000-0000-000000000002', true);
SELECT is(
  (SELECT array_agg(name ORDER BY name) FROM public.subcategories),
  ARRAY['Carnes'],
  'admin of B sees only the subcategories of B, untouched by A');
RESET ROLE;

-- ============================================
-- 6. Outsiders and realtime
-- ============================================
SELECT is(has_table_privilege('public', 'public.subcategories', 'SELECT'), false, 'an outsider (PUBLIC) cannot SELECT subcategories');
SELECT is(
  (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.categories'::regclass, 'public.subcategories'::regclass, 'public.dishes'::regclass) AND tgname = 'notify_change')::bigint,
  0::bigint,
  'menu tables stay out of realtime (the menu is read when an order starts)');

SELECT * FROM finish();
ROLLBACK;
