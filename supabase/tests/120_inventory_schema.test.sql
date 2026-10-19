-- Inventory logistics schema contract test.
--
-- odd/tasks/admin-dashboard-inventario.md, T4 (S3, S5), migration
-- 20261019100000_inventory_logistics.sql. Pins:
--   - the new tables (inventory_locations, suppliers, inventory_lots,
--     inventory_movements, purchase_orders(+lines), inventory_counts(+lines),
--     production_batches) and the widened / added columns on ingredients,
--     recipes, recipe_ingredients and order_items;
--   - one default location ("Bodega principal") per restaurant, existing and
--     new;
--   - SKU autogeneration MP-0001 (raw) / PR-0001 (prep) per restaurant, the
--     format CHECK, uppercase normalisation and per-restaurant uniqueness;
--   - the opening backfill (general lot + one opening movement per item with
--     stock <> 0), idempotent;
--   - formulas: exactly one of dish_id / ingredient_id, output must be a
--     preparation, no self-reference, no cycles;
--   - RLS: per-table role matrix and tenant isolation; lots / movements have
--     no write policy; ingredients / recipes / recipe_ingredients writes are
--     admin only while reads stay tenant-wide.
--
-- Every statement that touches the new schema goes through the pg_temp
-- sentinels below, so the file stays a complete RED on a pre-migration
-- database instead of aborting on the first missing column.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(80);

CREATE FUNCTION pg_temp.inv_text(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RETURN '<error: ' || SQLSTATE || '>';
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.inv_run(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RETURN SQLSTATE;
  END;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION pg_temp.inv_do(p_sql text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp.inv_run(p_sql);
END;
$$;

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_table('public', 'inventory_locations', 'inventory_locations exists');
SELECT has_table('public', 'suppliers', 'suppliers exists');
SELECT has_table('public', 'inventory_lots', 'inventory_lots exists');
SELECT has_table('public', 'inventory_movements', 'inventory_movements exists');
SELECT has_table('public', 'purchase_orders', 'purchase_orders exists');
SELECT has_table('public', 'purchase_order_lines', 'purchase_order_lines exists');
SELECT has_table('public', 'inventory_counts', 'inventory_counts exists');
SELECT has_table('public', 'inventory_count_lines', 'inventory_count_lines exists');
SELECT has_table('public', 'production_batches', 'production_batches exists');

SELECT has_column('public', 'ingredients', 'sku', 'ingredients.sku exists');
SELECT has_column('public', 'ingredients', 'kind', 'ingredients.kind exists');
SELECT has_column('public', 'ingredients', 'purchase_factor', 'ingredients.purchase_factor exists');
SELECT has_column('public', 'ingredients', 'shelf_life_days', 'ingredients.shelf_life_days exists');
SELECT has_column('public', 'order_items', 'stock_consumed_at', 'order_items.stock_consumed_at exists');
SELECT has_column('public', 'recipes', 'ingredient_id', 'recipes.ingredient_id exists');
SELECT has_column('public', 'recipes', 'yield_quantity', 'recipes.yield_quantity exists');
SELECT col_type_is('public', 'ingredients', 'stock', 'numeric(14,3)', 'ingredients.stock is numeric(14,3)');
SELECT col_type_is('public', 'ingredients', 'cost', 'numeric(14,4)', 'ingredients.cost is numeric(14,4)');
SELECT col_type_is('public', 'recipe_ingredients', 'quantity', 'numeric(14,4)', 'recipe_ingredients.quantity is numeric(14,4)');
SELECT col_is_null('public', 'recipes', 'dish_id', 'recipes.dish_id is nullable');

-- ============================================
-- 2. Default location per restaurant
-- ============================================
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text FROM public.restaurants r
     WHERE (SELECT count(*) FROM public.inventory_locations l
             WHERE l.restaurant_id = r.id AND l.is_default) <> 1
  $q$),
  '0',
  'every existing restaurant has exactly one default location'
);

INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000012a1', 'inv-schema-a', 'Inventory Schema A'),
  ('bbbbbbbb-0000-4000-8000-0000000012b1', 'inv-schema-b', 'Inventory Schema B');

SELECT is(
  pg_temp.inv_text($q$
    SELECT string_agg(name || '|' || is_default::text || '|' || is_active::text, ',')
      FROM public.inventory_locations
     WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000012a1'
  $q$),
  'Bodega principal|true|true',
  'a new restaurant gets one active default location "Bodega principal"'
);

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.inventory_locations (restaurant_id, name, code, is_default)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'Otra', 'OTRA', true)
  $q$),
  '23505',
  'a second default location in the same restaurant is rejected'
);

-- ============================================
-- 3. Users
-- ============================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', u.email, crypt('pw', gen_salt('bf')), now(),
       '', '', '', '', '', '', '', '',
       jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                          'role', u.role, 'restaurant_id', u.rid),
       jsonb_build_object('full_name', u.email), now(), now()
  FROM (VALUES
    ('aaaaaaaa-0000-4000-8000-0000000012e1'::uuid, 'inv-admin-a@example.com', 'admin', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('aaaaaaaa-0000-4000-8000-0000000012e2'::uuid, 'inv-waiter-a@example.com', 'waiter', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('aaaaaaaa-0000-4000-8000-0000000012e3'::uuid, 'inv-kitchen-a@example.com', 'kitchen', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('bbbbbbbb-0000-4000-8000-0000000012e4'::uuid, 'inv-admin-b@example.com', 'admin', 'bbbbbbbb-0000-4000-8000-0000000012b1')
  ) AS u(id, email, role, rid);

UPDATE public.profiles p
   SET restaurant_id = u.rid::uuid, role = u.role
  FROM (VALUES
    ('aaaaaaaa-0000-4000-8000-0000000012e1'::uuid, 'admin', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('aaaaaaaa-0000-4000-8000-0000000012e2'::uuid, 'waiter', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('aaaaaaaa-0000-4000-8000-0000000012e3'::uuid, 'kitchen', 'aaaaaaaa-0000-4000-8000-0000000012a1'),
    ('bbbbbbbb-0000-4000-8000-0000000012e4'::uuid, 'admin', 'bbbbbbbb-0000-4000-8000-0000000012b1')
  ) AS u(id, role, rid)
 WHERE p.auth_user_id = u.id;

-- ============================================
-- 4. SKU autogeneration
-- ============================================
SELECT pg_temp.inv_do($q$
  INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind)
  VALUES
    ('aaaaaaaa-0000-4000-8000-0000000012f1', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Tomate', 'g', 'raw'),
    ('aaaaaaaa-0000-4000-8000-0000000012f2', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Cebolla', 'g', 'raw'),
    ('aaaaaaaa-0000-4000-8000-0000000012f3', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Salsa', 'ml', 'prep'),
    ('aaaaaaaa-0000-4000-8000-0000000012f4', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Base', 'ml', 'prep'),
    ('bbbbbbbb-0000-4000-8000-0000000012f9', 'bbbbbbbb-0000-4000-8000-0000000012b1', 'Tomate B', 'g', 'raw')
$q$);

SELECT is(
  pg_temp.inv_text($q$ SELECT sku FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f1' $q$),
  'MP-0001', 'first raw item gets MP-0001');
SELECT is(
  pg_temp.inv_text($q$ SELECT sku FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f2' $q$),
  'MP-0002', 'second raw item gets MP-0002');
SELECT is(
  pg_temp.inv_text($q$ SELECT sku FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f3' $q$),
  'PR-0001', 'first preparation gets PR-0001');
SELECT is(
  pg_temp.inv_text($q$ SELECT sku FROM public.ingredients WHERE id = 'bbbbbbbb-0000-4000-8000-0000000012f9' $q$),
  'MP-0001', 'the SKU counter is per restaurant');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.ingredients (restaurant_id, name, unit, sku)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'Dup', 'g', 'MP-0001')
  $q$),
  '23505', 'a duplicate SKU in the same restaurant is rejected');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.ingredients (restaurant_id, name, unit, sku)
    VALUES ('bbbbbbbb-0000-4000-8000-0000000012b1', 'Other', 'g', 'MP-0002')
  $q$),
  'ok', 'the same explicit SKU is allowed in another restaurant');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.ingredients (restaurant_id, name, unit, sku)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'Bad', 'g', 'bad sku!')
  $q$),
  '23514', 'a SKU outside ^[A-Z0-9][A-Z0-9-]{1,31}$ is rejected');
SELECT is(
  pg_temp.inv_text($q$
    INSERT INTO public.ingredients (restaurant_id, name, unit, sku)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'Lower', 'g', ' abc-1 ')
    RETURNING sku
  $q$),
  'ABC-1', 'an explicit SKU is trimmed and uppercased');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.ingredients (restaurant_id, name, unit, kind)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'Weird', 'g', 'other')
  $q$),
  '23514', 'kind outside raw|prep is rejected');

-- ============================================
-- 5. Opening backfill
-- ============================================
SELECT pg_temp.inv_do($q$
  UPDATE public.ingredients SET stock = 5, cost = 100
   WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f2'
$q$);
SELECT pg_temp.inv_do($q$ SELECT private.backfill_inventory_opening() $q$);

SELECT is(
  pg_temp.inv_text($q$
    SELECT lt.quantity::text || '|' || lt.unit_cost::text || '|' || l.is_default::text
      FROM public.inventory_lots lt
      JOIN public.inventory_locations l ON l.id = lt.location_id
     WHERE lt.ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000012f2'
       AND lt.lot_code IS NULL AND lt.expires_on IS NULL
  $q$),
  '5.000|100.0000|true',
  'backfill creates the general lot at the default location with the stock and cost');
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text || '|' || sum(quantity)::text
      FROM public.inventory_movements
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000012f2'
       AND movement_type = 'opening'
  $q$),
  '1|5.000',
  'backfill writes one opening movement');
SELECT pg_temp.inv_do($q$ SELECT private.backfill_inventory_opening() $q$);
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text FROM public.inventory_movements
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000012f2'
  $q$),
  '1',
  'backfill is idempotent');
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text FROM public.inventory_lots
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000012f1'
  $q$),
  '0',
  'backfill skips items with zero stock');

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.inventory_lots (restaurant_id, ingredient_id, location_id, lot_code, quantity)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012f2', l.id, 'L-1', -1
      FROM public.inventory_locations l
     WHERE l.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000012a1' AND l.is_default
  $q$),
  '23514',
  'only the general lot may go negative');

-- ============================================
-- 6. Formulas
-- ============================================
INSERT INTO public.categories (id, restaurant_id, name, icon, active)
VALUES ('aaaaaaaa-0000-4000-8000-0000000012c1', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Cat', 'Utensils', true);
INSERT INTO public.dishes (id, restaurant_id, name, price, category_id, active, allow_comments)
VALUES ('aaaaaaaa-0000-4000-8000-0000000012d1', 'aaaaaaaa-0000-4000-8000-0000000012a1', 'Burger', 15000,
        'aaaaaaaa-0000-4000-8000-0000000012c1', true, false);

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipes (restaurant_id, dish_id, ingredient_id)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012d1',
            'aaaaaaaa-0000-4000-8000-0000000012f3')
  $q$),
  '23514', 'a recipe cannot target a dish and a preparation at once');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipes (restaurant_id) VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1')
  $q$),
  '23514', 'a recipe must target a dish or a preparation');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipes (restaurant_id, ingredient_id)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012f1')
  $q$),
  '22023', 'a formula output must be a preparation');

SELECT pg_temp.inv_do($q$
  INSERT INTO public.recipes (id, restaurant_id, ingredient_id, yield_quantity)
  VALUES ('aaaaaaaa-0000-4000-8000-0000000012b7', 'aaaaaaaa-0000-4000-8000-0000000012a1',
          'aaaaaaaa-0000-4000-8000-0000000012f3', 500),
         ('aaaaaaaa-0000-4000-8000-0000000012b8', 'aaaaaaaa-0000-4000-8000-0000000012a1',
          'aaaaaaaa-0000-4000-8000-0000000012f4', 1)
$q$);

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012b7',
            'aaaaaaaa-0000-4000-8000-0000000012f3', 1)
  $q$),
  '22023', 'a preparation cannot use itself');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012b8',
            'aaaaaaaa-0000-4000-8000-0000000012f3', 10)
  $q$),
  'ok', 'a preparation may use another preparation');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012b7',
            'aaaaaaaa-0000-4000-8000-0000000012f4', 10)
  $q$),
  '22023', 'a cycle (Salsa -> Base -> Salsa) is rejected');
SELECT is(
  pg_temp.inv_run($q$
    UPDATE public.ingredients SET kind = 'raw' WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f3'
  $q$),
  'P0001', 'a preparation with a formula cannot become raw');

-- ============================================
-- 7. RLS: admin
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000012e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_locations $q$),
  '1', 'admin A sees only the tenant A location');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.suppliers (id, name) VALUES ('aaaaaaaa-0000-4000-8000-0000000012b5', 'Proveedor A')
  $q$),
  'ok', 'admin creates a supplier');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.inventory_locations (name, code) VALUES ('Cocina', 'COCINA')
  $q$),
  'ok', 'admin creates a location');
SELECT is(
  pg_temp.inv_text($q$
    INSERT INTO public.purchase_orders (supplier_id, location_id)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012b5', id FROM public.inventory_locations WHERE is_default
    RETURNING number::text || '|' || status
  $q$),
  '1|draft', 'the first purchase order is number 1 in draft');
SELECT is(
  pg_temp.inv_text($q$
    INSERT INTO public.purchase_orders (supplier_id, location_id)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012b5', id FROM public.inventory_locations WHERE is_default
    RETURNING number::text
  $q$),
  '2', 'purchase order numbers increase per restaurant');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.inventory_lots (ingredient_id, location_id, quantity)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012f1', id, 1 FROM public.inventory_locations WHERE is_default
  $q$),
  '42501', 'admin cannot write lots directly (RPC only)');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.inventory_movements (ingredient_id, location_id, movement_type, quantity)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012f1', id, 'adjustment', 1 FROM public.inventory_locations WHERE is_default
  $q$),
  '42501', 'admin cannot write movements directly (RPC only)');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_lots $q$),
  '1', 'admin reads tenant A lots');

RESET ROLE;

-- ============================================
-- 8. RLS: waiter
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000012e2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_locations $q$),
  '2', 'waiter reads the tenant locations');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.suppliers $q$),
  '0', 'waiter does not read suppliers');
SELECT is(
  pg_temp.inv_run($q$ INSERT INTO public.suppliers (name) VALUES ('Nope') $q$),
  '42501', 'waiter cannot create a supplier');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_lots $q$),
  '0', 'waiter does not read lots');
SELECT is(
  pg_temp.inv_text($q$ SELECT (count(*) > 0)::text FROM public.ingredients $q$),
  'true', 'waiter still reads ingredients');
SELECT is(
  pg_temp.inv_run($q$ INSERT INTO public.ingredients (name, unit) VALUES ('Nope', 'g') $q$),
  '42501', 'waiter cannot create ingredients');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipe_ingredients (recipe_id, ingredient_id, quantity)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012b8', 'aaaaaaaa-0000-4000-8000-0000000012f1', 1)
  $q$),
  '42501', 'waiter cannot write formula lines');

RESET ROLE;

-- ============================================
-- 9. RLS: kitchen and tenant B
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000012e3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_lots $q$),
  '1', 'kitchen reads lots');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_movements $q$),
  '0', 'kitchen does not read movements');

RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000012e4","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$
    SELECT (SELECT count(*) FROM public.suppliers)::text || '|' ||
           (SELECT count(*) FROM public.purchase_orders)::text || '|' ||
           (SELECT count(*) FROM public.inventory_lots)::text
  $q$),
  '0|0|0', 'admin B sees no tenant A suppliers, purchase orders or lots');

RESET ROLE;

-- ============================================
-- 10. Direct writes outside the RPCs (verifier B1, B2, B3, note 6)
-- ============================================
-- Fixtures as the test author: an open count in tenant A and a tenant B
-- formula that tenant A must not be able to attach lines to.
SELECT pg_temp.inv_do($q$
  INSERT INTO public.inventory_counts (id, restaurant_id, location_id)
  SELECT 'aaaaaaaa-0000-4000-8000-0000000012c7', 'aaaaaaaa-0000-4000-8000-0000000012a1', id
    FROM public.inventory_locations WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000012a1' AND is_default
$q$);
SELECT pg_temp.inv_do($q$
  INSERT INTO public.inventory_count_lines (restaurant_id, count_id, ingredient_id)
  VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'aaaaaaaa-0000-4000-8000-0000000012c7', 'aaaaaaaa-0000-4000-8000-0000000012f1')
$q$);
SELECT pg_temp.inv_do($q$
  INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind)
  VALUES ('bbbbbbbb-0000-4000-8000-0000000012f8', 'bbbbbbbb-0000-4000-8000-0000000012b1', 'Salsa B', 'ml', 'prep')
$q$);
SELECT pg_temp.inv_do($q$
  INSERT INTO public.recipes (id, restaurant_id, ingredient_id)
  VALUES ('bbbbbbbb-0000-4000-8000-0000000012b9', 'bbbbbbbb-0000-4000-8000-0000000012b1',
          'bbbbbbbb-0000-4000-8000-0000000012f8')
$q$);

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000012a1', 'bbbbbbbb-0000-4000-8000-0000000012b9', 'bbbbbbbb-0000-4000-8000-0000000012f9', 1)
  $q$),
  'P0002', 'a formula line must share the tenant of its recipe and its ingredient');

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000012e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.purchase_orders (supplier_id, location_id, status)
    SELECT 'aaaaaaaa-0000-4000-8000-0000000012b5', id, 'received' FROM public.inventory_locations WHERE is_default
  $q$),
  'P0001', 'admin cannot insert a purchase order as received');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.purchase_order_lines (purchase_order_id, ingredient_id, quantity, received_quantity)
    SELECT id, 'aaaaaaaa-0000-4000-8000-0000000012f1', 10, 7 FROM public.purchase_orders WHERE number = 1
  $q$),
  '42501', 'admin cannot insert a line with received_quantity');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.purchase_order_lines (purchase_order_id, ingredient_id, quantity, unit_cost)
    SELECT id, 'aaaaaaaa-0000-4000-8000-0000000012f1', 10, 2 FROM public.purchase_orders WHERE number = 1
  $q$),
  'ok', 'admin still adds lines to a draft purchase order');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.purchase_orders SET status = 'ordered' WHERE number = 1 $q$),
  'ok', 'admin still moves a purchase order from draft to ordered');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.purchase_orders SET status = 'received' WHERE number = 1 $q$),
  'P0001', 'admin cannot move a purchase order to received directly');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.purchase_order_lines SET received_quantity = 10 $q$),
  '42501', 'admin cannot write received_quantity directly');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.inventory_counts SET status = 'applied' WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012c7' $q$),
  'P0001', 'admin cannot mark a count applied directly');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.inventory_count_lines SET expected_quantity = 5 $q$),
  '42501', 'admin cannot rewrite the expected quantity of a count line');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.inventory_count_lines SET counted_quantity = 3 $q$),
  'ok', 'admin still fills counted_quantity on an open count');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.ingredients SET stock = 999 WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f1' $q$),
  '42501', 'admin cannot write ingredients.stock directly');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.ingredients SET cost = 1 WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f1' $q$),
  '42501', 'admin cannot write ingredients.cost directly');
SELECT is(
  pg_temp.inv_run($q$ INSERT INTO public.ingredients (name, unit, stock) VALUES ('Stocked', 'g', 5) $q$),
  '42501', 'a new ingredient cannot carry stock');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.ingredients (name, unit, cost) VALUES ('Costed', 'g', 3);
    UPDATE public.ingredients SET name = 'Tomate chonto' WHERE id = 'aaaaaaaa-0000-4000-8000-0000000012f1'
  $q$),
  'ok', 'admin still creates an item with a reference cost and renames items');
SELECT is(
  pg_temp.inv_run($q$
    INSERT INTO public.recipes (ingredient_id) VALUES ('aaaaaaaa-0000-4000-8000-0000000012f3')
  $q$),
  '42501', 'formulas are written through save_formula only (recipes)');
SELECT is(
  pg_temp.inv_run($q$
    DELETE FROM public.recipe_ingredients WHERE recipe_id = 'aaaaaaaa-0000-4000-8000-0000000012b8'
  $q$),
  '42501', 'formulas are written through save_formula only (recipe_ingredients)');
SELECT is(
  pg_temp.inv_run($q$ UPDATE public.inventory_locations SET is_default = false WHERE is_default $q$),
  'P0001', 'the only default location cannot be unset');
SELECT is(
  pg_temp.inv_text($q$
    UPDATE public.inventory_locations SET is_default = true WHERE code = 'COCINA';
    SELECT string_agg(code, ',') FROM public.inventory_locations WHERE is_default
  $q$),
  'COCINA', 'marking another location as default moves the default');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
