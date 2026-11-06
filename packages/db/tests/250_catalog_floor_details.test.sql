-- Catalog and floor details (odd/tasks/rediseno-pos.md, T16, S8).
--
-- dishes.sort_order (backfilled per category/subcategory in name order) and
-- dishes.quick_notes (modifier chips); tables.is_active (an inactive table
-- takes no new order); zones.width_m / depth_m (both or neither); and
-- public.menu_publications, the structure waiters and delivery see until the
-- admin publishes again.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(106);

-- ============================================
-- 1. Schema
-- ============================================
SELECT col_not_null('public', 'dishes', 'sort_order', 'dishes.sort_order is NOT NULL');
SELECT col_default_is('public', 'dishes', 'sort_order', '0', 'dishes.sort_order defaults to 0');
SELECT has_index('public', 'dishes', 'idx_dishes_menu_order', 'dishes has the menu order index');
SELECT col_not_null('public', 'dishes', 'quick_notes', 'dishes.quick_notes is NOT NULL');
SELECT col_type_is('public', 'dishes', 'quick_notes', 'text[]', 'dishes.quick_notes is text[]');
SELECT col_default_is('public', 'dishes', 'quick_notes', '{}', 'dishes.quick_notes defaults to an empty array');
SELECT col_not_null('public', 'tables', 'is_active', 'tables.is_active is NOT NULL');
SELECT col_default_is('public', 'tables', 'is_active', 'true', 'tables.is_active defaults to true');
SELECT col_is_null('public', 'zones', 'width_m', 'zones.width_m is nullable');
SELECT col_is_null('public', 'zones', 'depth_m', 'zones.depth_m is nullable');
SELECT col_type_is('public', 'zones', 'width_m', 'numeric', 'zones.width_m is numeric');

SELECT has_table('public', 'menu_publications', 'public.menu_publications exists');
SELECT columns_are('public', 'menu_publications',
  ARRAY['id', 'restaurant_id', 'published_at', 'published_by', 'snapshot'],
  'menu_publications has exactly the publication columns');
SELECT col_default_is('public', 'menu_publications', 'restaurant_id', 'private.current_restaurant_id()', 'menu_publications.restaurant_id defaults to the caller tenant');
SELECT col_not_null('public', 'menu_publications', 'snapshot', 'menu_publications.snapshot is NOT NULL');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.menu_publications'::regclass), 'menu_publications has row level security enabled');
SELECT policies_are('public', 'menu_publications',
  ARRAY['menu_publications_select_policy', 'menu_publications_insert_policy'],
  'menu_publications is insert-only: select and insert policies');
SELECT fk_ok('public', 'menu_publications', ARRAY['restaurant_id', 'published_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'the publisher is a profile of the same restaurant');

-- ============================================
-- Fixtures: restaurants A and B; admin, waiter and kitchen in A; admin in B.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('25000000-0000-0000-0000-0000000000a1', 't250-a', 'T250 A'),
  ('25000000-0000-0000-0000-0000000000b2', 't250-b', 'T250 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('25000000-0000-0000-0000-000000000001', 'admin@t250a.test', 'h'),
  ('25000000-0000-0000-0000-000000000002', 'admin@t250b.test', 'h'),
  ('25000000-0000-0000-0000-000000000003', 'waiter@t250a.test', 'h'),
  ('25000000-0000-0000-0000-000000000004', 'kitchen@t250a.test', 'h'),
  ('25000000-0000-0000-0000-000000000005', 'cashier@t250a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('25100000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t250a.test', 'admin', true, '25000000-0000-0000-0000-0000000000a1'),
  ('25100000-0000-0000-0000-000000000002', '25000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t250b.test', 'admin', true, '25000000-0000-0000-0000-0000000000b2'),
  ('25100000-0000-0000-0000-000000000003', '25000000-0000-0000-0000-000000000003', 'Mesero A', 'waiter@t250a.test', 'waiter', true, '25000000-0000-0000-0000-0000000000a1'),
  ('25100000-0000-0000-0000-000000000004', '25000000-0000-0000-0000-000000000004', 'Cocina A', 'kitchen@t250a.test', 'kitchen', true, '25000000-0000-0000-0000-0000000000a1'),
  ('25100000-0000-0000-0000-000000000005', '25000000-0000-0000-0000-000000000005', 'Caja A', 'cashier@t250a.test', 'cashier', true, '25000000-0000-0000-0000-0000000000a1');
INSERT INTO public.categories (id, name, icon, restaurant_id) VALUES
  ('25200000-0000-0000-0000-0000000000a1', 'Platos', 'beef', '25000000-0000-0000-0000-0000000000a1'),
  ('25200000-0000-0000-0000-0000000000b1', 'Platos', 'beef', '25000000-0000-0000-0000-0000000000b2');
INSERT INTO public.subcategories (id, restaurant_id, category_id, name) VALUES
  ('25300000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1', '25200000-0000-0000-0000-0000000000a1', 'Carnes');
INSERT INTO public.dishes (id, name, price, category_id, subcategory_id, restaurant_id) VALUES
  ('25400000-0000-0000-0000-0000000000a1', 'churrasco', 40000, '25200000-0000-0000-0000-0000000000a1', NULL, '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000a2', 'Arroz', 20000, '25200000-0000-0000-0000-0000000000a1', NULL, '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000a3', 'Bandeja', 30000, '25200000-0000-0000-0000-0000000000a1', NULL, '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000a4', 'Sobrebarriga', 35000, '25200000-0000-0000-0000-0000000000a1', '25300000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000a5', 'Lomo', 45000, '25200000-0000-0000-0000-0000000000a1', '25300000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000a6', 'Agua', 3000, NULL, NULL, '25000000-0000-0000-0000-0000000000a1'),
  ('25400000-0000-0000-0000-0000000000b1', 'Zeta', 1000, '25200000-0000-0000-0000-0000000000b1', NULL, '25000000-0000-0000-0000-0000000000b2'),
  ('25400000-0000-0000-0000-0000000000b2', 'Alfa', 1000, '25200000-0000-0000-0000-0000000000b1', NULL, '25000000-0000-0000-0000-0000000000b2');
UPDATE public.dishes SET sort_order = 7 WHERE id = '25400000-0000-0000-0000-0000000000b1';

-- ============================================
-- 2. Backfill of the dish order
-- ============================================
SELECT lives_ok($$ SELECT private.backfill_dish_sort_order() $$, 'the dish order backfill runs');
SELECT is(
  (SELECT array_agg(name::text ORDER BY sort_order) FROM public.dishes
    WHERE category_id = '25200000-0000-0000-0000-0000000000a1' AND subcategory_id IS NULL),
  ARRAY['Arroz', 'Bandeja', 'churrasco'],
  'dishes directly under a category are numbered in case-insensitive name order');
SELECT is(
  (SELECT array_agg(sort_order ORDER BY sort_order) FROM public.dishes
    WHERE category_id = '25200000-0000-0000-0000-0000000000a1' AND subcategory_id IS NULL),
  ARRAY[0, 1, 2],
  'the order of a group starts at 0 without gaps');
SELECT is(
  (SELECT array_agg(name::text ORDER BY sort_order) FROM public.dishes WHERE subcategory_id = '25300000-0000-0000-0000-0000000000a1'),
  ARRAY['Lomo', 'Sobrebarriga'],
  'dishes of a subcategory are numbered as their own group');
SELECT is(
  (SELECT array_agg(sort_order ORDER BY name) FROM public.dishes WHERE restaurant_id = '25000000-0000-0000-0000-0000000000b2'),
  ARRAY[0, 7],
  'a group with an order already set is left untouched');
UPDATE public.dishes SET sort_order = 9 WHERE id = '25400000-0000-0000-0000-0000000000a2';
SELECT lives_ok($$ SELECT private.backfill_dish_sort_order() $$, 'the dish order backfill runs again');
SELECT is((SELECT sort_order FROM public.dishes WHERE id = '25400000-0000-0000-0000-0000000000a2'), 9,
  'the backfill is idempotent and keeps an order the admin set');
SELECT is(has_function_privilege('vipe_api', 'private.backfill_dish_sort_order()', 'EXECUTE'), false, 'vipe_api cannot run the dish order backfill');
UPDATE public.dishes SET sort_order = 0 WHERE id = '25400000-0000-0000-0000-0000000000a2';

-- ============================================
-- 3. Quick notes
-- ============================================
SELECT lives_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['Término medio', 'Sin cebolla'] WHERE id = '25400000-0000-0000-0000-0000000000a1' $$,
  'quick notes are accepted');
SELECT is((SELECT quick_notes FROM public.dishes WHERE id = '25400000-0000-0000-0000-0000000000a1'), ARRAY['Término medio', 'Sin cebolla'],
  'quick notes keep their order');
SELECT lives_ok(
  $$ UPDATE public.dishes SET quick_notes = (SELECT array_agg('Nota ' || i) FROM generate_series(1, 12) i) WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '12 quick notes are accepted');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = (SELECT array_agg('Nota ' || i) FROM generate_series(1, 13) i) WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, '13 quick notes are refused');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['Sin sal', '   '] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'a blank quick note is refused');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY[repeat('x', 31)] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'a quick note over 30 characters is refused');
SELECT lives_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY[repeat('x', 30)] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  'a quick note of 30 characters is accepted');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['Sin sal', ' sin SAL '] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'duplicate quick notes (trimmed, case-insensitive) are refused');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['Sin cebolla', 'Sin  cebolla'] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'quick notes that differ only in inner spaces are duplicates');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['ÁRBOL', 'árbol'] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'duplicate quick notes with accented capitals are refused');
SELECT lives_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['  Sin   sal ', E'Poco\t picante'] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  'quick notes with extra spaces are accepted');
SELECT is((SELECT quick_notes FROM public.dishes WHERE id = '25400000-0000-0000-0000-0000000000a2'), ARRAY['Sin sal', 'Poco picante'],
  'quick notes are stored trimmed with single inner spaces');
SELECT lives_ok(
  $$ INSERT INTO public.dishes (id, name, price, restaurant_id, quick_notes)
     VALUES ('25400000-0000-0000-0000-0000000000a8', 'Jugo', 5000, '25000000-0000-0000-0000-0000000000a1', ARRAY[' Sin  hielo']) $$,
  'a dish is inserted with quick notes');
SELECT is((SELECT quick_notes FROM public.dishes WHERE id = '25400000-0000-0000-0000-0000000000a8'), ARRAY['Sin hielo'],
  'quick notes are normalised on insert');
DELETE FROM public.dishes WHERE id = '25400000-0000-0000-0000-0000000000a8';
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = ARRAY['Sin sal', NULL] WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'a NULL quick note is refused');
SELECT throws_ok(
  $$ UPDATE public.dishes SET quick_notes = NULL WHERE id = '25400000-0000-0000-0000-0000000000a2' $$,
  '23502', NULL, 'quick_notes cannot be NULL');

-- ============================================
-- 4. Zone dimensions
-- ============================================
INSERT INTO public.zones (id, restaurant_id, name) VALUES
  ('25500000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1', 'Salón'),
  ('25500000-0000-0000-0000-0000000000b1', '25000000-0000-0000-0000-0000000000b2', 'Salón');
SELECT lives_ok($$ UPDATE public.zones SET width_m = 12.5, depth_m = 8 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, 'a zone takes both dimensions');
SELECT lives_ok($$ UPDATE public.zones SET width_m = NULL, depth_m = NULL WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, 'a zone may have no dimensions');
SELECT throws_ok($$ UPDATE public.zones SET width_m = 10, depth_m = NULL WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a width without a depth is refused');
SELECT throws_ok($$ UPDATE public.zones SET width_m = NULL, depth_m = 10 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a depth without a width is refused');
SELECT throws_ok($$ UPDATE public.zones SET width_m = 0, depth_m = 10 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a zero width is refused');
SELECT throws_ok($$ UPDATE public.zones SET width_m = 10, depth_m = 200.01 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a depth over 200 m is refused');
SELECT lives_ok($$ UPDATE public.zones SET width_m = 200, depth_m = 0.5 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '200 m and fractions are accepted');
SELECT throws_ok($$ UPDATE public.zones SET width_m = 'NaN', depth_m = 10 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'a NaN width is refused');
SELECT throws_ok($$ UPDATE public.zones SET width_m = 'Infinity', depth_m = 5 WHERE id = '25500000-0000-0000-0000-0000000000a1' $$, '23514', NULL, 'an infinite width is refused');

-- ============================================
-- 5. Inactive tables take no new order
-- ============================================
INSERT INTO public.tables (id, number, restaurant_id) VALUES
  ('25600000-0000-0000-0000-0000000000a1', 1, '25000000-0000-0000-0000-0000000000a1'),
  ('25600000-0000-0000-0000-0000000000a2', 2, '25000000-0000-0000-0000-0000000000a1'),
  ('25600000-0000-0000-0000-0000000000a3', 3, '25000000-0000-0000-0000-0000000000a1');
INSERT INTO public.orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
  ('25700000-0000-0000-0000-0000000000a1', '25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'active', 0, 0, 0, 0, '25000000-0000-0000-0000-0000000000a1'),
  ('25700000-0000-0000-0000-0000000000a9', '25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'paid', 0, 0, 0, 0, '25000000-0000-0000-0000-0000000000a1');
SELECT lives_ok($$ UPDATE public.tables SET is_active = false WHERE id = '25600000-0000-0000-0000-0000000000a1' $$, 'a table with an open order can be deactivated');
SELECT is((SELECT status FROM public.orders WHERE id = '25700000-0000-0000-0000-0000000000a1'), 'active', 'the open order of a deactivated table is unaffected');
SELECT lives_ok($$ UPDATE public.orders SET status = 'kitchen' WHERE id = '25700000-0000-0000-0000-0000000000a1' $$, 'the open order of a deactivated table keeps working');

SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ INSERT INTO public.orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total)
     VALUES ('25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'active', 0, 0, 0, 0) $$,
  '23514', 'table 25600000-0000-0000-0000-0000000000a1 is inactive', 'a new order on an inactive table is refused');
SELECT lives_ok(
  $$ INSERT INTO public.orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total)
     VALUES ('25700000-0000-0000-0000-0000000000a2', '25600000-0000-0000-0000-0000000000a2', '25100000-0000-0000-0000-000000000003', 'active', 0, 0, 0, 0) $$,
  'a new order on an active table is accepted');
SELECT throws_ok(
  $$ UPDATE public.orders SET table_id = '25600000-0000-0000-0000-0000000000a1' WHERE id = '25700000-0000-0000-0000-0000000000a2' $$,
  '23514', 'table 25600000-0000-0000-0000-0000000000a1 is inactive', 'an order cannot move to an inactive table');
SELECT lives_ok(
  $$ INSERT INTO public.orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total, is_partial_order, parent_order_id)
     VALUES ('25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'kitchen', 0, 0, 0, 0, true, '25700000-0000-0000-0000-0000000000a1') $$,
  'a split of the open order of an inactive table is accepted');
SELECT throws_ok(
  $$ INSERT INTO public.orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total, is_partial_order, parent_order_id)
     VALUES ('25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'active', 0, 0, 0, 0, true, '25700000-0000-0000-0000-0000000000a2') $$,
  '23514', 'table 25600000-0000-0000-0000-0000000000a1 is inactive', 'a child of an order on another table cannot open an inactive table');
SELECT throws_ok(
  $$ INSERT INTO public.orders (table_id, waiter_id, status, subtotal, tax, tax_percentage, total, is_partial_order, parent_order_id)
     VALUES ('25600000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000003', 'active', 0, 0, 0, 0, true, '25700000-0000-0000-0000-0000000000a9') $$,
  '23514', 'table 25600000-0000-0000-0000-0000000000a1 is inactive', 'a child of a closed order cannot open an inactive table');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.orders WHERE table_id = '25600000-0000-0000-0000-0000000000a1'), 3,
  'the refused orders left nothing behind');

-- A cashier splits and pays both bills of a table deactivated meanwhile.
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('25800000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');
INSERT INTO public.orders (id, table_id, waiter_id, status, subtotal, tax, tax_percentage, total, restaurant_id) VALUES
  ('25700000-0000-0000-0000-0000000000b3', '25600000-0000-0000-0000-0000000000a3', '25100000-0000-0000-0000-000000000003', 'kitchen', 0, 0, 0, 0, '25000000-0000-0000-0000-0000000000a1');
INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, restaurant_id, status) VALUES
  ('25900000-0000-0000-0000-0000000000a1', '25700000-0000-0000-0000-0000000000b3', NULL, 'Item 1', 10000, 1, '25000000-0000-0000-0000-0000000000a1', 'pending'),
  ('25900000-0000-0000-0000-0000000000a2', '25700000-0000-0000-0000-0000000000b3', NULL, 'Item 2', 20000, 1, '25000000-0000-0000-0000-0000000000a1', 'pending');
UPDATE public.tables SET status = 'occupied', is_active = false WHERE id = '25600000-0000-0000-0000-0000000000a3';
SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT set_config('t250.child',
  public.split_order('25700000-0000-0000-0000-0000000000b3', '[{"order_item_id": "25900000-0000-0000-0000-0000000000a2", "quantity": 1}]') ->> 'child_order_id', true);
SELECT isnt(current_setting('t250.child'), '', 'the cashier splits the order of a deactivated table');
SELECT is(
  public.pay_order(current_setting('t250.child')::uuid, '25800000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'), 'amount', 20000, 'cash_received', 20000)),
    '25a00000-0000-0000-0000-000000000001') ->> 'status',
  'paid', 'the cashier pays the child of a deactivated table');
SELECT is(
  public.pay_order('25700000-0000-0000-0000-0000000000b3', '25800000-0000-0000-0000-0000000000a1', 0,
    jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'), 'amount', 10000, 'cash_received', 10000)),
    '25a00000-0000-0000-0000-000000000002') ->> 'status',
  'paid', 'the cashier pays the parent of a deactivated table');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SELECT is((SELECT status FROM public.tables WHERE id = '25600000-0000-0000-0000-0000000000a3'), 'available',
  'the deactivated table is available once both bills are paid');

-- ============================================
-- 6. Menu publication: snapshot, backfill, pending changes
-- ============================================
SELECT is(
  private.menu_structure('25000000-0000-0000-0000-0000000000a1') -> 'dishes' -> '25400000-0000-0000-0000-0000000000a4',
  jsonb_build_object('name', 'Sobrebarriga', 'category_id', '25200000-0000-0000-0000-0000000000a1',
    'subcategory_id', '25300000-0000-0000-0000-0000000000a1', 'sort_order', 1),
  'the structure holds a dish name, category, subcategory and order, no price or availability');
SELECT is(
  private.menu_structure('25000000-0000-0000-0000-0000000000a1') -> 'categories' -> '25200000-0000-0000-0000-0000000000a1',
  jsonb_build_object('name', 'Platos', 'icon', 'beef', 'color', 'neutral', 'sort_order', 0, 'active', true),
  'the structure holds a category name, icon, colour, order and active flag');
SELECT is(
  private.menu_structure('25000000-0000-0000-0000-0000000000a1') -> 'subcategories' -> '25300000-0000-0000-0000-0000000000a1',
  jsonb_build_object('category_id', '25200000-0000-0000-0000-0000000000a1', 'name', 'Carnes', 'sort_order', 0, 'active', true),
  'the structure holds a subcategory category, name, order and active flag');
SELECT ok(private.menu_structure('25000000-0000-0000-0000-0000000000a1') -> 'dishes' ? '25400000-0000-0000-0000-0000000000a6',
  'a dish without category is part of the structure');
SELECT is(private.menu_structure('25000000-0000-0000-0000-0000000000a1') -> 'dishes' ? '25400000-0000-0000-0000-0000000000b1', false,
  'the structure of a restaurant holds no dish of another');

SELECT lives_ok($$ SELECT private.backfill_menu_publications() $$, 'the publication backfill runs');
SELECT is(
  (SELECT count(*)::int FROM public.restaurants r WHERE NOT EXISTS (SELECT 1 FROM public.menu_publications p WHERE p.restaurant_id = r.id)),
  0, 'every restaurant has a publication after the backfill');
SELECT is(
  (SELECT snapshot FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'),
  private.menu_structure('25000000-0000-0000-0000-0000000000a1'),
  'the backfilled publication equals the current structure');
SELECT is((SELECT published_by FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'), NULL::uuid,
  'the backfilled publication has no publisher');
SELECT lives_ok($$ SELECT private.backfill_menu_publications() $$, 'the publication backfill runs again');
SELECT is((SELECT count(*)::int FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'), 1,
  'the publication backfill is idempotent');
SELECT is(has_function_privilege('vipe_api', 'private.backfill_menu_publications()', 'EXECUTE'), false, 'vipe_api cannot run the publication backfill');
SELECT is(
  private.menu_pending_changes((SELECT snapshot FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'),
                               private.menu_structure('25000000-0000-0000-0000-0000000000a1')),
  0, 'nothing is pending right after a publication');
SELECT is(private.menu_pending_changes(NULL, '{"categories":{},"subcategories":{},"dishes":{}}'::jsonb), 0, 'no publication counts 0 (header contract)');
SELECT is(private.menu_pending_changes(NULL, private.menu_structure('25000000-0000-0000-0000-0000000000a1')), 0,
  'no publication counts 0 for a non-empty live menu');

UPDATE public.dishes SET name = 'Arroz con coco', price = 21000 WHERE id = '25400000-0000-0000-0000-0000000000a2';
UPDATE public.dishes SET price = 50000, active = false, quick_notes = ARRAY['Sin sal'] WHERE id = '25400000-0000-0000-0000-0000000000a5';
INSERT INTO public.dishes (id, name, price, category_id, restaurant_id) VALUES
  ('25400000-0000-0000-0000-0000000000a7', 'Nuevo', 1000, '25200000-0000-0000-0000-0000000000a1', '25000000-0000-0000-0000-0000000000a1');
UPDATE public.categories SET color = 'rose' WHERE id = '25200000-0000-0000-0000-0000000000a1';
SELECT is(
  private.menu_pending_changes((SELECT snapshot FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'),
                               private.menu_structure('25000000-0000-0000-0000-0000000000a1')),
  3, 'a renamed dish, a new dish and a recoloured category are 3 pending changes; price, availability and quick notes are not');

-- ============================================
-- 7. Publication RLS per role and tenant
-- ============================================
SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*)::int FROM public.menu_publications), 1, 'a waiter reads the publication of the restaurant');
SELECT throws_ok($$ SELECT public.publish_menu() $$, '42501', NULL, 'a waiter cannot publish the menu');
SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000004', true);
SELECT is((SELECT count(*)::int FROM public.menu_publications), 1, 'kitchen staff read the publication of the restaurant');
SELECT throws_ok(
  $$ INSERT INTO public.menu_publications (snapshot) VALUES ('{}') $$,
  '42501', NULL, 'kitchen staff cannot insert a publication');
SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT (public.publish_menu()).published_by), '25100000-0000-0000-0000-000000000001'::uuid, 'the admin publishes the menu as themself');
SELECT is(
  (SELECT snapshot FROM public.menu_publications ORDER BY published_at DESC, id DESC LIMIT 1) -> 'dishes' -> '25400000-0000-0000-0000-0000000000a2' ->> 'name',
  'Arroz con coco', 'the latest publication holds the current structure');
SELECT is(
  private.menu_pending_changes((SELECT snapshot FROM public.menu_publications ORDER BY published_at DESC, id DESC LIMIT 1),
                               private.menu_structure(private.current_restaurant_id())),
  0, 'nothing is pending after the admin publishes');
SELECT is((SELECT count(*)::int FROM public.menu_publications WHERE restaurant_id <> '25000000-0000-0000-0000-0000000000a1'), 0,
  'the admin of A sees no publication of another restaurant');
SELECT throws_ok(
  $$ INSERT INTO public.menu_publications (restaurant_id, snapshot) VALUES ('25000000-0000-0000-0000-0000000000b2', '{}') $$,
  '42501', NULL, 'the admin of A cannot publish for B');
SELECT is(private.menu_structure('25000000-0000-0000-0000-0000000000b2'), '{"categories": {}, "subcategories": {}, "dishes": {}}'::jsonb,
  'the structure of another restaurant reads empty under RLS');
SELECT set_config('t250.pub', (public.publish_menu()).id::text, true);
SELECT is((SELECT published_by FROM public.menu_publications WHERE id = current_setting('t250.pub')::uuid),
  '25100000-0000-0000-0000-000000000001'::uuid, 'publish_menu records the admin');
SELECT lives_ok(
  $$ INSERT INTO public.menu_publications (id, published_at, published_by, snapshot)
     VALUES ('25b00000-0000-0000-0000-000000000001', '2099-01-01', '25100000-0000-0000-0000-000000000003', '{"x": 1}') $$,
  'a direct insert by the admin with a future date and another publisher runs');
SELECT ok((SELECT published_at <= clock_timestamp() FROM public.menu_publications WHERE id = '25b00000-0000-0000-0000-000000000001'),
  'a client published_at is replaced by the server time');
SELECT is((SELECT published_by FROM public.menu_publications WHERE id = '25b00000-0000-0000-0000-000000000001'),
  '25100000-0000-0000-0000-000000000001'::uuid, 'a client published_by is replaced by the caller profile');
SELECT lives_ok(
  $$ INSERT INTO public.menu_publications (id, published_by, snapshot) VALUES ('25b00000-0000-0000-0000-000000000002', '25100000-0000-0000-0000-000000000002', '{"x": 2}') $$,
  'a direct insert naming a publisher of another restaurant runs');
SELECT is((SELECT published_by FROM public.menu_publications WHERE id = '25b00000-0000-0000-0000-000000000002'),
  '25100000-0000-0000-0000-000000000001'::uuid, 'a publisher of another restaurant is replaced by the caller profile');
SELECT lives_ok($$ UPDATE public.menu_publications SET snapshot = '{}' $$, 'an update of a publication by the admin runs (RLS filters every row)');
SELECT lives_ok($$ DELETE FROM public.menu_publications $$, 'a delete of a publication by the admin runs (RLS filters every row)');
SELECT set_config('app.user_id', '25000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*)::int FROM public.menu_publications), 1, 'the admin of B reads only the publication of B');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SELECT is((SELECT count(*)::int FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000b2'), 1,
  'the refused writes added nothing to B');
SELECT is(
  ARRAY[(SELECT count(*)::int FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1'),
        (SELECT count(*)::int FROM public.menu_publications WHERE snapshot = '{}')],
  ARRAY[5, 0], 'no publication was changed or deleted: the history is insert-only');
SELECT is(
  (SELECT id FROM public.menu_publications WHERE restaurant_id = '25000000-0000-0000-0000-0000000000a1' ORDER BY published_at DESC, id DESC LIMIT 1),
  '25b00000-0000-0000-0000-000000000002'::uuid, 'the latest publication is the last one inserted, not a future-dated one');
-- Outside an API session (no caller profile, as the deploy backfill) the
-- publisher is kept as given and still checked against the restaurant.
SELECT throws_ok(
  $$ INSERT INTO public.menu_publications (restaurant_id, published_by, snapshot)
     VALUES ('25000000-0000-0000-0000-0000000000a1', '25100000-0000-0000-0000-000000000002', '{}') $$,
  '23503', NULL, 'a publisher of another restaurant is refused');
SELECT lives_ok(
  $$ INSERT INTO public.menu_publications (id, restaurant_id, published_by, snapshot)
     VALUES ('25b00000-0000-0000-0000-000000000003', '25000000-0000-0000-0000-0000000000a1', NULL, '{}') $$,
  'a publication without publisher is accepted outside an API session');
SELECT is((SELECT published_by FROM public.menu_publications WHERE id = '25b00000-0000-0000-0000-000000000003'), NULL::uuid,
  'the publisher stays NULL outside an API session');

SELECT * FROM finish();
ROLLBACK;
