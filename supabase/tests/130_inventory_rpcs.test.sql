-- Inventory RPCs contract test.
--
-- odd/tasks/admin-dashboard-inventario.md, T4 (S3, S5), migration
-- 20261019110000_inventory_rpcs.sql. Pins the SECURITY DEFINER inventory
-- RPCs on top of the schema contract in 120_inventory_schema.test.sql:
--   inventory_adjust, inventory_transfer, save_formula,
--   receive_purchase_order, open_inventory_count, apply_inventory_count,
--   produce_preparation, consume_order_stock, check_dishes_stock,
--   inventory_overview.
-- Role matrix, tenant isolation (P0002), input errors (22023), business
-- rules (P0001), FEFO, weighted-average cost, idempotent sale consumption and
-- the invariant ingredients.stock = sum(inventory_lots.quantity).
--
-- Every RPC call goes through the pg_temp sentinels so the file stays a
-- complete RED on a pre-migration database.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(76);

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
    RETURN '<error: ' || SQLSTATE || ' ' || SQLERRM || '>';
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
-- 1. Structure and privileges
-- ============================================
SELECT has_function('public', 'inventory_adjust',
  ARRAY['uuid','uuid','text','numeric','numeric','text','text','uuid','text','date'], 'inventory_adjust exists');
SELECT has_function('public', 'inventory_transfer',
  ARRAY['uuid','uuid','uuid','numeric','text'], 'inventory_transfer exists');
SELECT has_function('public', 'save_formula',
  ARRAY['text','uuid','numeric','jsonb','text'], 'save_formula exists');
SELECT has_function('public', 'receive_purchase_order',
  ARRAY['uuid','jsonb'], 'receive_purchase_order exists');
SELECT has_function('public', 'open_inventory_count',
  ARRAY['uuid','uuid[]','text'], 'open_inventory_count exists');
SELECT has_function('public', 'apply_inventory_count',
  ARRAY['uuid'], 'apply_inventory_count exists');
SELECT has_function('public', 'produce_preparation',
  ARRAY['uuid','numeric','uuid','text','text'], 'produce_preparation exists');
SELECT has_function('public', 'consume_order_stock',
  ARRAY['uuid'], 'consume_order_stock exists');
SELECT has_function('public', 'check_dishes_stock',
  ARRAY['jsonb'], 'check_dishes_stock exists');
SELECT has_function('public', 'inventory_overview',
  ARRAY['integer'], 'inventory_overview exists');

CREATE TEMP TABLE inv_rpcs (name text) ON COMMIT DROP;
INSERT INTO inv_rpcs VALUES
  ('inventory_adjust'), ('inventory_transfer'), ('save_formula'),
  ('receive_purchase_order'), ('open_inventory_count'), ('apply_inventory_count'),
  ('produce_preparation'), ('consume_order_stock'), ('check_dishes_stock'),
  ('inventory_overview');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (SELECT name FROM inv_rpcs)
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.prosecdef),
  10, 'the 10 RPCs are SECURITY DEFINER, executable by authenticated, not by anon');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public' AND p.proname IN (SELECT name FROM inv_rpcs) AND a.grantee = 0),
  0, 'no inventory RPC grants EXECUTE to PUBLIC');
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (SELECT name FROM inv_rpcs)
      AND p.proconfig @> ARRAY['search_path=""']),
  10, 'every inventory RPC pins search_path = ''''');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000013a1', 'inv-rpc-a', 'Inventory RPC A'),
  ('bbbbbbbb-0000-4000-8000-0000000013b1', 'inv-rpc-b', 'Inventory RPC B');

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
    ('aaaaaaaa-0000-4000-8000-0000000013e1'::uuid, 'inv-rpc-admin-a@example.com', 'admin', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('aaaaaaaa-0000-4000-8000-0000000013e2'::uuid, 'inv-rpc-waiter-a@example.com', 'waiter', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('aaaaaaaa-0000-4000-8000-0000000013e3'::uuid, 'inv-rpc-kitchen-a@example.com', 'kitchen', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('bbbbbbbb-0000-4000-8000-0000000013e5'::uuid, 'inv-rpc-admin-b@example.com', 'admin', 'bbbbbbbb-0000-4000-8000-0000000013b1')
  ) AS u(id, email, role, rid);

UPDATE public.profiles p
   SET restaurant_id = u.rid::uuid, role = u.role
  FROM (VALUES
    ('aaaaaaaa-0000-4000-8000-0000000013e1'::uuid, 'admin', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('aaaaaaaa-0000-4000-8000-0000000013e2'::uuid, 'waiter', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('aaaaaaaa-0000-4000-8000-0000000013e3'::uuid, 'kitchen', 'aaaaaaaa-0000-4000-8000-0000000013a1'),
    ('bbbbbbbb-0000-4000-8000-0000000013e5'::uuid, 'admin', 'bbbbbbbb-0000-4000-8000-0000000013b1')
  ) AS u(id, role, rid)
 WHERE p.auth_user_id = u.id;

SELECT pg_temp.inv_do($q$
  INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind, shelf_life_days)
  VALUES
    ('aaaaaaaa-0000-4000-8000-0000000013f1', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Tomate', 'g', 'raw', NULL),
    ('aaaaaaaa-0000-4000-8000-0000000013f2', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Cebolla', 'g', 'raw', NULL),
    ('aaaaaaaa-0000-4000-8000-0000000013f3', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Salsa', 'ml', 'prep', 3),
    ('aaaaaaaa-0000-4000-8000-0000000013f4', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Base', 'ml', 'prep', NULL),
    ('bbbbbbbb-0000-4000-8000-0000000013f9', 'bbbbbbbb-0000-4000-8000-0000000013b1', 'Tomate B', 'g', 'raw', NULL)
$q$);

INSERT INTO public.categories (id, restaurant_id, name, icon, active)
VALUES ('aaaaaaaa-0000-4000-8000-0000000013c1', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Cat', 'Utensils', true);
INSERT INTO public.dishes (id, restaurant_id, name, price, category_id, active, allow_comments)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000013d1', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'Burger', 15000,
   'aaaaaaaa-0000-4000-8000-0000000013c1', true, false),
  ('bbbbbbbb-0000-4000-8000-0000000013d9', 'bbbbbbbb-0000-4000-8000-0000000013b1', 'Dish B', 15000,
   'aaaaaaaa-0000-4000-8000-0000000013c1', true, false);

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001301', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'kitchen', 30000, 0, 0, 30000),
  ('aaaaaaaa-0000-4000-8000-000000001302', 'aaaaaaaa-0000-4000-8000-0000000013a1', 'kitchen', 1500000, 0, 0, 1500000),
  ('bbbbbbbb-0000-4000-8000-000000001309', 'bbbbbbbb-0000-4000-8000-0000000013b1', 'kitchen', 15000, 0, 0, 15000);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001311', 'aaaaaaaa-0000-4000-8000-0000000013a1',
   'aaaaaaaa-0000-4000-8000-000000001301', 'aaaaaaaa-0000-4000-8000-0000000013d1', 'Burger', 15000, 2),
  ('aaaaaaaa-0000-4000-8000-000000001312', 'aaaaaaaa-0000-4000-8000-0000000013a1',
   'aaaaaaaa-0000-4000-8000-000000001302', 'aaaaaaaa-0000-4000-8000-0000000013d1', 'Burger', 15000, 100),
  ('bbbbbbbb-0000-4000-8000-000000001319', 'bbbbbbbb-0000-4000-8000-0000000013b1',
   'bbbbbbbb-0000-4000-8000-000000001309', 'bbbbbbbb-0000-4000-8000-0000000013d9', 'Dish B', 15000, 1);

-- ============================================
-- 3. Admin A: opening stock, adjust errors
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000013e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$
    SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'opening', 1000, 2)->>'stock'
  $q$),
  '1000.000', 'opening 1000 g of Tomate at the default location');

SELECT pg_temp.inv_do($q$
  SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'opening', 100, 2,
                                 NULL, NULL, NULL, 'L-A', current_date + 5)
$q$);
SELECT pg_temp.inv_do($q$
  SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'opening', 100, 3,
                                 NULL, NULL, NULL, 'L-B', current_date + 2)
$q$);
SELECT pg_temp.inv_do($q$
  SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f2', NULL, 'opening', 500, 1)
$q$);

SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f1' $q$),
  '1200.000', 'lots with code and expiry add to the total stock');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'adjustment', 0) $q$),
  '22023', 'a zero quantity is rejected');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'purchase', 1) $q$),
  '22023', 'inventory_adjust only accepts opening / adjustment / waste');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'waste', 99999) $q$),
  'P0001', 'waste larger than the available stock is rejected');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('bbbbbbbb-0000-4000-8000-0000000013f9', NULL, 'opening', 1) $q$),
  'P0002', 'an item from another tenant is not found');

-- ============================================
-- 4. Admin A: save_formula
-- ============================================
SELECT is(
  pg_temp.inv_text($q$
    SELECT public.save_formula('prep', 'aaaaaaaa-0000-4000-8000-0000000013f3', 500,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":300},
        {"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f2","quantity":100}]'::jsonb)->>'lines_count'
  $q$),
  '2', 'save_formula stores the Salsa formula');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('prep', 'aaaaaaaa-0000-4000-8000-0000000013f1', 1,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f2","quantity":1}]'::jsonb)
  $q$),
  '22023', 'save_formula rejects a raw item as prep output');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('prep', 'aaaaaaaa-0000-4000-8000-0000000013f3', 500,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f3","quantity":1}]'::jsonb)
  $q$),
  '22023', 'save_formula rejects self-reference');
SELECT pg_temp.inv_do($q$
  SELECT public.save_formula('prep', 'aaaaaaaa-0000-4000-8000-0000000013f4', 1,
    '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f3","quantity":10}]'::jsonb)
$q$);
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('prep', 'aaaaaaaa-0000-4000-8000-0000000013f3', 500,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":300},
        {"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f4","quantity":5}]'::jsonb)
  $q$),
  '22023', 'save_formula rejects a cycle (Salsa -> Base -> Salsa)');
SELECT is(
  pg_temp.inv_text($q$
    SELECT string_agg(i.name || ':' || ri.quantity::text, ',' ORDER BY i.name)
      FROM public.recipe_ingredients ri
      JOIN public.recipes r ON r.id = ri.recipe_id
      JOIN public.ingredients i ON i.id = ri.ingredient_id
     WHERE r.ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f3'
  $q$),
  'Cebolla:100.0000,Tomate:300.0000', 'a rejected save leaves the previous formula intact');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-0000000013d1', 1,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f3","quantity":50},
        {"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":20}]'::jsonb)
  $q$),
  'ok', 'save_formula stores a dish formula that uses a preparation');
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text FROM pg_locks
     WHERE locktype = 'advisory' AND pid = pg_backend_pid()
       AND objid = hashtext('save_formula:aaaaaaaa-0000-4000-8000-0000000013a1')::oid
  $q$),
  '1', 'save_formula serializes formula saves per tenant with an advisory lock');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('dish', 'bbbbbbbb-0000-4000-8000-0000000013d9', 1,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":1}]'::jsonb)
  $q$),
  'P0002', 'save_formula does not reach another tenant''s dish');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-0000000013d1', 1,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":1},
        {"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":2}]'::jsonb)
  $q$),
  '22023', 'save_formula rejects duplicate lines');

-- ============================================
-- 5. Admin A: produce_preparation
-- ============================================
-- 1000 ml of Salsa with yield 500 = factor 2: 600 g Tomate (FEFO: L-B 100 @3,
-- L-A 100 @2, general 400 @2 = 1300) + 200 g Cebolla @1 = 200. 1500 / 1000.
SELECT is(
  pg_temp.inv_text($q$
    SELECT (r->>'unit_cost') || '|' || (r->>'expires_on')
      FROM (SELECT public.produce_preparation('aaaaaaaa-0000-4000-8000-0000000013f3', 1000) AS r) s
  $q$),
  '1.5000|' || (current_date + 3)::text, 'production unit cost = consumed cost / quantity, expiry = today + shelf life');
SELECT is(
  pg_temp.inv_text($q$
    SELECT string_agg(quantity::text, ',' ORDER BY expires_on NULLS LAST)
      FROM public.inventory_lots WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f1'
  $q$),
  '0.000,0.000,600.000', 'production consumes Tomate FEFO (nearest expiry first, general lot last)');
SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f3' $q$),
  '1000.000', 'the preparation stock grows by the produced quantity');
SELECT is(
  pg_temp.inv_text($q$
    SELECT count(*)::text FROM public.inventory_movements WHERE movement_type = 'production_consume'
  $q$),
  '4', 'one production_consume movement per consumed lot');
SELECT set_config('inv.movements_before',
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_movements $q$), true);
SELECT is(
  pg_temp.inv_text($q$
    SELECT public.produce_preparation('aaaaaaaa-0000-4000-8000-0000000013f3', 10000)::text
  $q$) LIKE '<error: P0001 %Tomate%',
  true, 'insufficient stock raises P0001 naming the short item');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.inventory_movements $q$),
  current_setting('inv.movements_before'), 'a rejected production writes nothing');

RESET ROLE;

-- ============================================
-- 6. Waiter A: roles and sale consumption
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000013e2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f1', NULL, 'opening', 1) $q$),
  '42501', 'waiter cannot adjust stock');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.produce_preparation('aaaaaaaa-0000-4000-8000-0000000013f3', 1) $q$),
  '42501', 'waiter cannot produce');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-0000000013d1', 1,
      '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-0000000013f1","quantity":1}]'::jsonb)
  $q$),
  '42501', 'waiter cannot save formulas');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_overview(30) $q$),
  '42501', 'waiter cannot read the inventory overview');
SELECT is(
  pg_temp.inv_text($q$ SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001301')->>'enabled' $q$),
  'false', 'consume_order_stock is a no-op while inventory control is disabled');
SELECT is(
  pg_temp.inv_text($q$
    SELECT (stock_consumed_at IS NULL)::text FROM public.order_items WHERE id = 'aaaaaaaa-0000-4000-8000-000000001311'
  $q$),
  'true', 'a disabled consumption does not mark the item');

RESET ROLE;
INSERT INTO public.business_config (restaurant_id, key, value)
VALUES ('aaaaaaaa-0000-4000-8000-0000000013a1', 'inventory_control_enabled', 'true');
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_text($q$
    SELECT public.check_dishes_stock('[{"dish_id":"aaaaaaaa-0000-4000-8000-0000000013d1","quantity":2}]'::jsonb)->>'ok'
  $q$),
  'true', 'check_dishes_stock reports ok when stock covers the items');
SELECT pg_temp.inv_do($q$ SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001301') $q$);
SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f3' $q$),
  '900.000', 'a sold Burger x2 consumes 100 ml of Salsa');
SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f1' $q$),
  '560.000', 'a sold Burger x2 consumes 40 g of Tomate');
SELECT is(
  pg_temp.inv_text($q$
    SELECT (stock_consumed_at IS NOT NULL)::text FROM public.order_items WHERE id = 'aaaaaaaa-0000-4000-8000-000000001311'
  $q$),
  'true', 'the consumed order item is stamped');
SELECT is(
  pg_temp.inv_text($q$ SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001301')->>'consumed_items' $q$),
  '0', 'a second consumption of the same order consumes nothing');
SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f3' $q$),
  '900.000', 'consumption is idempotent per order item');
SELECT is(
  pg_temp.inv_text($q$
    SELECT s->>'missing'
      FROM jsonb_array_elements(public.check_dishes_stock(
             '[{"dish_id":"aaaaaaaa-0000-4000-8000-0000000013d1","quantity":100}]'::jsonb)->'shortages') s
     WHERE s->>'ingredient_id' = 'aaaaaaaa-0000-4000-8000-0000000013f3'
  $q$),
  '4100.000', 'check_dishes_stock reports the missing Salsa quantity');
SELECT is(
  pg_temp.inv_text($q$ SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001302')->>'consumed_items' $q$),
  '1', 'a sale with shortage is still consumed');
SELECT is(
  pg_temp.inv_text($q$ SELECT stock::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f3' $q$),
  '-4100.000', 'the shortage drives the stock negative');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.consume_order_stock('bbbbbbbb-0000-4000-8000-000000001309') $q$),
  'P0002', 'consume_order_stock does not reach another tenant''s order');

RESET ROLE;

-- ============================================
-- 7. Kitchen A
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000013e3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_run($q$ SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001301') $q$),
  '42501', 'kitchen cannot consume sale stock');
SELECT is(
  pg_temp.inv_text($q$
    SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f2', NULL, 'waste', 10, NULL, 'Dañado')->>'quantity'
  $q$),
  '-10.000', 'kitchen records waste (signed negative)');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f2', NULL, 'adjustment', 5) $q$),
  '42501', 'kitchen cannot record adjustments');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.produce_preparation('aaaaaaaa-0000-4000-8000-0000000013f4', 1) $q$),
  'P0001', 'kitchen may produce (rejected here only for the Salsa shortage)');

RESET ROLE;

SELECT is(
  pg_temp.inv_text($q$ SELECT quantity::text FROM public.inventory_lots
    WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f3' AND lot_code IS NULL AND expires_on IS NULL $q$),
  '-4100.000', 'the shortage lands on the general lot');
SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.ingredients i
    WHERE i.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000013a1'
      AND i.stock <> COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l WHERE l.ingredient_id = i.id), 0) $q$),
  '0', 'ingredients.stock equals the sum of lots after sales and production');

-- ============================================
-- 8. Admin A: purchase orders
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000013e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.inv_do($q$
  INSERT INTO public.suppliers (id, name) VALUES ('aaaaaaaa-0000-4000-8000-000000001351', 'Proveedor')
$q$);
SELECT pg_temp.inv_do($q$
  INSERT INTO public.purchase_orders (id, supplier_id, location_id, status)
  SELECT 'aaaaaaaa-0000-4000-8000-00000000130a', 'aaaaaaaa-0000-4000-8000-000000001351', id, 'ordered'
    FROM public.inventory_locations WHERE is_default
$q$);
SELECT pg_temp.inv_do($q$
  INSERT INTO public.purchase_order_lines (id, purchase_order_id, ingredient_id, quantity, unit_cost)
  VALUES ('aaaaaaaa-0000-4000-8000-00000000130b', 'aaaaaaaa-0000-4000-8000-00000000130a',
          'aaaaaaaa-0000-4000-8000-0000000013f2', 1000, 2)
$q$);

-- Cebolla: 500 - 200 (production) - 10 (waste) = 290 @1.
SELECT is(
  pg_temp.inv_text($q$
    SELECT public.receive_purchase_order('aaaaaaaa-0000-4000-8000-00000000130a',
      '[{"line_id":"aaaaaaaa-0000-4000-8000-00000000130b","quantity":400}]'::jsonb)->>'status'
  $q$),
  'partially_received', 'a partial receipt moves the order to partially_received');
SELECT is(
  pg_temp.inv_text($q$ SELECT cost::text FROM public.ingredients WHERE id = 'aaaaaaaa-0000-4000-8000-0000000013f2' $q$),
  '1.5797', 'receipt updates the moving weighted-average cost ((290*1 + 400*2) / 690)');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.receive_purchase_order('aaaaaaaa-0000-4000-8000-00000000130a',
      '[{"line_id":"aaaaaaaa-0000-4000-8000-00000000130b","quantity":700}]'::jsonb)
  $q$),
  'P0001', 'receiving more than ordered is rejected');
SELECT is(
  pg_temp.inv_text($q$
    SELECT public.receive_purchase_order('aaaaaaaa-0000-4000-8000-00000000130a',
             '[{"line_id":"aaaaaaaa-0000-4000-8000-00000000130b","quantity":600}]'::jsonb)->>'status'
  $q$),
  'received', 'receiving the rest moves the order to received');
SELECT is(
  pg_temp.inv_text($q$
    SELECT i.stock::text || '|' || l.received_quantity::text || '|' || (po.received_at IS NOT NULL)::text
      FROM public.ingredients i, public.purchase_order_lines l, public.purchase_orders po
     WHERE i.id = 'aaaaaaaa-0000-4000-8000-0000000013f2'
       AND l.id = 'aaaaaaaa-0000-4000-8000-00000000130b'
       AND po.id = 'aaaaaaaa-0000-4000-8000-00000000130a'
  $q$),
  '1290.000|1000.000|true', 'received quantities land in stock, on the line and stamp received_at');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.receive_purchase_order('aaaaaaaa-0000-4000-8000-00000000130a',
      '[{"line_id":"aaaaaaaa-0000-4000-8000-00000000130b","quantity":1}]'::jsonb)
  $q$),
  'P0001', 'a received order cannot be received again');

-- ============================================
-- 9. Admin A: transfer
-- ============================================
SELECT pg_temp.inv_do($q$
  INSERT INTO public.inventory_locations (id, name, code)
  VALUES ('aaaaaaaa-0000-4000-8000-000000001322', 'Cocina', 'COCINA')
$q$);
SELECT pg_temp.inv_do($q$
  SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-0000000013f2', NULL, 'opening', 50, 1,
                                 NULL, NULL, NULL, 'C1', current_date + 1)
$q$);
SELECT pg_temp.inv_do($q$
  SELECT public.inventory_transfer('aaaaaaaa-0000-4000-8000-0000000013f2',
    (SELECT id FROM public.inventory_locations WHERE is_default),
    'aaaaaaaa-0000-4000-8000-000000001322', 70)
$q$);
SELECT is(
  pg_temp.inv_text($q$
    SELECT string_agg(COALESCE(lot_code, 'general') || ':' || quantity::text, ',' ORDER BY expires_on NULLS LAST)
      FROM public.inventory_lots
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f2'
       AND location_id = 'aaaaaaaa-0000-4000-8000-000000001322'
  $q$),
  'C1:50.000,general:20.000', 'transfer moves FEFO lots, keeping lot code and expiry');
SELECT is(
  pg_temp.inv_text($q$
    SELECT quantity::text FROM public.inventory_lots
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f2' AND lot_code = 'C1'
       AND location_id <> 'aaaaaaaa-0000-4000-8000-000000001322'
  $q$),
  '0.000', 'the source lot is emptied');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.inventory_transfer('aaaaaaaa-0000-4000-8000-0000000013f2',
      (SELECT id FROM public.inventory_locations WHERE is_default),
      'aaaaaaaa-0000-4000-8000-000000001322', 999999)
  $q$),
  'P0001', 'transfer beyond the available stock is rejected');
SELECT is(
  pg_temp.inv_run($q$
    SELECT public.inventory_transfer('aaaaaaaa-0000-4000-8000-0000000013f2',
      'aaaaaaaa-0000-4000-8000-000000001322', 'aaaaaaaa-0000-4000-8000-000000001322', 1)
  $q$),
  '22023', 'transfer to the same location is rejected');

-- ============================================
-- 10. Admin A: physical count
-- ============================================
SELECT set_config('inv.count_id',
  pg_temp.inv_text($q$
    SELECT public.open_inventory_count('aaaaaaaa-0000-4000-8000-000000001322',
      ARRAY['aaaaaaaa-0000-4000-8000-0000000013f2']::uuid[])->>'count_id'
  $q$), true);
SELECT pg_temp.inv_do($q$
  UPDATE public.inventory_count_lines SET counted_quantity = 60
   WHERE count_id = current_setting('inv.count_id')::uuid
$q$);
SELECT pg_temp.inv_do($q$ SELECT public.apply_inventory_count(current_setting('inv.count_id')::uuid) $q$);
SELECT is(
  pg_temp.inv_text($q$
    SELECT sum(quantity)::text FROM public.inventory_lots
     WHERE ingredient_id = 'aaaaaaaa-0000-4000-8000-0000000013f2'
       AND location_id = 'aaaaaaaa-0000-4000-8000-000000001322'
  $q$),
  '60.000', 'after applying a count the location balance equals the counted quantity');
SELECT is(
  pg_temp.inv_text($q$
    SELECT sum(quantity)::text FROM public.inventory_movements
     WHERE movement_type = 'count_adjustment' AND reference_id = current_setting('inv.count_id')::uuid
  $q$),
  '-10.000', 'the count writes count_adjustment movements for the difference');
SELECT is(
  pg_temp.inv_text($q$ SELECT status FROM public.inventory_counts WHERE id = current_setting('inv.count_id')::uuid $q$),
  'applied', 'the count is applied');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.apply_inventory_count(current_setting('inv.count_id')::uuid) $q$),
  'P0001', 'an applied count cannot be applied again');

-- ============================================
-- 11. Admin A: overview
-- ============================================
SELECT is(
  pg_temp.inv_text($q$
    SELECT (r ?& ARRAY['days','kpis','series','value_by_category','top_consumed'])::text
      || '|' || jsonb_array_length(r->'series')::text
      || '|' || ((r->'kpis') ?& ARRAY['total_value','items_count','low_stock_count','out_of_stock_count',
                                      'expiring_soon_count','waste_value','purchases_value',
                                      'consumption_value','open_purchase_orders'])::text
      FROM (SELECT public.inventory_overview(30) AS r) s
  $q$),
  'true|30|true', 'inventory_overview returns the documented shape with one series point per day');
SELECT is(
  pg_temp.inv_text($q$
    SELECT (SELECT t->>'name' FROM jsonb_array_elements(public.inventory_overview(30)->'top_consumed') t LIMIT 1)
  $q$),
  'Salsa', 'top_consumed ranks the most consumed item by value first');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.inventory_overview(0) $q$),
  '22023', 'inventory_overview rejects days outside 1..365');

RESET ROLE;

SELECT is(
  pg_temp.inv_text($q$ SELECT count(*)::text FROM public.ingredients i
    WHERE i.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000013a1'
      AND i.stock <> COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l WHERE l.ingredient_id = i.id), 0) $q$),
  '0', 'ingredients.stock equals the sum of lots after every RPC');

-- ============================================
-- 12. Admin B: tenant isolation
-- ============================================
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000013e5","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.inv_run($q$ SELECT public.produce_preparation('aaaaaaaa-0000-4000-8000-0000000013f3', 1) $q$),
  'P0002', 'admin B cannot produce tenant A preparations');
SELECT is(
  pg_temp.inv_run($q$ SELECT public.apply_inventory_count(current_setting('inv.count_id')::uuid) $q$),
  'P0002', 'admin B cannot apply tenant A counts');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
