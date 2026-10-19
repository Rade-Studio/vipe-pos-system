-- split_order / undo_split keep the sale-consumption stamp.
--
-- odd/tasks/admin-dashboard-inventario.md, T12 follow-up (S5: every sale is
-- deducted exactly once), migration 20261019120000_split_keeps_stock_stamp.sql.
-- consume_order_stock skips order_items rows whose stock_consumed_at is set.
-- A partial split must copy the stamp to the new child row, and undo_split
-- must not merge rows whose stamp state differs. Each scenario uses its own
-- ingredient (1 g per dish) so the sum of its 'sale' movements isolates it.
--   1 consume -> split 2 of 3 -> consume child
--   2 consume -> split a full line -> consume child
--   3 consume -> split 2 of 3 -> undo -> consume parent
--   4 split 2 of 3 (not consumed yet) -> consume parent -> consume child
--   5 split 2 of 3 -> consume child only -> undo -> consume parent
--   6 split 2 of 3 -> consume parent only -> undo -> consume parent

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(16);

CREATE FUNCTION pg_temp.ss_text(p_sql text)
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

-- Child order id of a split, kept across scenarios.
CREATE TEMP TABLE ss_child (scenario int PRIMARY KEY, child_id uuid) ON COMMIT DROP;
GRANT ALL ON ss_child TO authenticated;

-- Sum of the 'sale' movements of one ingredient, as text.
CREATE FUNCTION pg_temp.ss_sale(p_ingredient uuid)
RETURNS text
LANGUAGE sql
AS $$
  SELECT COALESCE(sum(m.quantity), 0)::numeric(14,3)::text
    FROM public.inventory_movements m
   WHERE m.ingredient_id = p_ingredient AND m.movement_type = 'sale';
$$;

-- ============================================
-- Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name)
VALUES ('aaaaaaaa-0000-4000-8000-0000000014a1', 'split-stamp', 'Split stamp');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) VALUES (
  'aaaaaaaa-0000-4000-8000-0000000014e1', '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', 'split-stamp-admin@example.com', crypt('pw', gen_salt('bf')), now(),
  '', '', '', '', '', '', '', '',
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                     'role', 'admin', 'restaurant_id', 'aaaaaaaa-0000-4000-8000-0000000014a1'),
  jsonb_build_object('full_name', 'split-stamp-admin'), now(), now()
);

UPDATE public.profiles p
   SET restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000014a1', role = 'admin'
 WHERE p.auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000014e1';

INSERT INTO public.business_config (restaurant_id, key, value)
VALUES ('aaaaaaaa-0000-4000-8000-0000000014a1', 'inventory_control_enabled', 'true');

INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001411', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 1', 'g', 'raw'),
  ('aaaaaaaa-0000-4000-8000-000000001412', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 2', 'g', 'raw'),
  ('aaaaaaaa-0000-4000-8000-000000001413', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 3', 'g', 'raw'),
  ('aaaaaaaa-0000-4000-8000-000000001414', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 4', 'g', 'raw'),
  ('aaaaaaaa-0000-4000-8000-000000001415', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 5', 'g', 'raw'),
  ('aaaaaaaa-0000-4000-8000-000000001416', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Ingredient 6', 'g', 'raw');

INSERT INTO public.categories (id, restaurant_id, name, icon, active)
VALUES ('aaaaaaaa-0000-4000-8000-0000000014c1', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Cat', 'Utensils', true);
INSERT INTO public.dishes (id, restaurant_id, name, price, category_id, active, allow_comments)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001421', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 1', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false),
  ('aaaaaaaa-0000-4000-8000-000000001422', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 2', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false),
  ('aaaaaaaa-0000-4000-8000-000000001423', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 3', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false),
  ('aaaaaaaa-0000-4000-8000-000000001424', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 4', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false),
  ('aaaaaaaa-0000-4000-8000-000000001425', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 5', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false),
  ('aaaaaaaa-0000-4000-8000-000000001426', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'Dish 6', 1000, 'aaaaaaaa-0000-4000-8000-0000000014c1', true, false);

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001431', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-000000001432', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-000000001433', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-000000001434', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-000000001435', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-000000001436', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'kitchen', 0, 0, 0, 0);

-- Each order: the scenario line (qty 3) plus a filler line so the parent never empties.
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000001441', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001431', 'aaaaaaaa-0000-4000-8000-000000001421', 'Dish 1', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001451', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001431', NULL, 'Filler', 500, 1),
  ('aaaaaaaa-0000-4000-8000-000000001442', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001432', 'aaaaaaaa-0000-4000-8000-000000001422', 'Dish 2', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001452', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001432', NULL, 'Filler', 500, 1),
  ('aaaaaaaa-0000-4000-8000-000000001443', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001433', 'aaaaaaaa-0000-4000-8000-000000001423', 'Dish 3', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001453', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001433', NULL, 'Filler', 500, 1),
  ('aaaaaaaa-0000-4000-8000-000000001444', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001434', 'aaaaaaaa-0000-4000-8000-000000001424', 'Dish 4', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001454', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001434', NULL, 'Filler', 500, 1),
  ('aaaaaaaa-0000-4000-8000-000000001445', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001435', 'aaaaaaaa-0000-4000-8000-000000001425', 'Dish 5', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001455', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001435', NULL, 'Filler', 500, 1),
  ('aaaaaaaa-0000-4000-8000-000000001446', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001436', 'aaaaaaaa-0000-4000-8000-000000001426', 'Dish 6', 1000, 3),
  ('aaaaaaaa-0000-4000-8000-000000001456', 'aaaaaaaa-0000-4000-8000-0000000014a1', 'aaaaaaaa-0000-4000-8000-000000001436', NULL, 'Filler', 500, 1);

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000014e1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001411', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001421', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001411","quantity":1}]'::jsonb);
SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001412', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001422', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001412","quantity":1}]'::jsonb);
SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001413', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001423', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001413","quantity":1}]'::jsonb);
SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001414', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001424', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001414","quantity":1}]'::jsonb);
SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001415', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001425', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001415","quantity":1}]'::jsonb);
SELECT public.inventory_adjust('aaaaaaaa-0000-4000-8000-000000001416', NULL, 'opening', 100, 1);
SELECT public.save_formula('dish', 'aaaaaaaa-0000-4000-8000-000000001426', 1,
  '[{"ingredient_id":"aaaaaaaa-0000-4000-8000-000000001416","quantity":1}]'::jsonb);

-- 1. consume -> split 2 of 3 -> consume child
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001431');
INSERT INTO ss_child
SELECT 1, (public.split_order('aaaaaaaa-0000-4000-8000-000000001431',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001441","quantity":2}]'::jsonb)->>'child_order_id')::uuid;
SELECT is(
  pg_temp.ss_text($q$
    SELECT (stock_consumed_at IS NOT NULL)::text FROM public.order_items
     WHERE order_id = (SELECT child_id FROM ss_child WHERE scenario = 1) AND dish_id = 'aaaaaaaa-0000-4000-8000-000000001421'
  $q$),
  'true', 'scenario 1: the partial-split child row inherits the parent stamp');
SELECT public.consume_order_stock((SELECT child_id FROM ss_child WHERE scenario = 1));
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001411'), '-3.000', 'scenario 1: a consumed line split 2 of 3 is deducted once (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001421'
  $q$),
  'true:3', 'scenario 1: parent and child rows are stamped, 3 units in total');

-- 2. consume -> split a full line -> consume child
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001432');
INSERT INTO ss_child
SELECT 2, (public.split_order('aaaaaaaa-0000-4000-8000-000000001432',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001442","quantity":3}]'::jsonb)->>'child_order_id')::uuid;
SELECT public.consume_order_stock((SELECT child_id FROM ss_child WHERE scenario = 2));
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001412'), '-3.000', 'scenario 2: a full-line move keeps the stamp, deducted once (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001422'
  $q$),
  'true:3', 'scenario 2: the moved row is still stamped');

-- 3. consume -> split 2 of 3 -> undo -> consume parent
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001433');
INSERT INTO ss_child
SELECT 3, (public.split_order('aaaaaaaa-0000-4000-8000-000000001433',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001443","quantity":2}]'::jsonb)->>'child_order_id')::uuid;
SELECT public.undo_split((SELECT child_id FROM ss_child WHERE scenario = 3));
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001433');
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001413'), '-3.000', 'scenario 3: undo of a consumed partial split does not deduct again (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001423'
  $q$),
  'true:3', 'scenario 3: the merged parent row is stamped with 3 units');
SELECT is(
  pg_temp.ss_text($q$ SELECT count(*)::text FROM public.order_items WHERE dish_id = 'aaaaaaaa-0000-4000-8000-000000001423' $q$),
  '1', 'scenario 3: rows with the same stamp state merge back into one row');

-- 4. split 2 of 3 before any consumption -> consume parent -> consume child
INSERT INTO ss_child
SELECT 4, (public.split_order('aaaaaaaa-0000-4000-8000-000000001434',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001444","quantity":2}]'::jsonb)->>'child_order_id')::uuid;
SELECT is(
  pg_temp.ss_text($q$
    SELECT (stock_consumed_at IS NULL)::text FROM public.order_items
     WHERE order_id = (SELECT child_id FROM ss_child WHERE scenario = 4) AND dish_id = 'aaaaaaaa-0000-4000-8000-000000001424'
  $q$),
  'true', 'scenario 4: the child of an unconsumed line inherits NULL');
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001434');
SELECT public.consume_order_stock((SELECT child_id FROM ss_child WHERE scenario = 4));
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001414'), '-3.000', 'scenario 4: each side of an unconsumed split is consumed once (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001424'
  $q$),
  'true:3', 'scenario 4: parent and child rows are stamped');

-- 5. split 2 of 3 -> consume child only -> undo -> consume parent
INSERT INTO ss_child
SELECT 5, (public.split_order('aaaaaaaa-0000-4000-8000-000000001435',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001445","quantity":2}]'::jsonb)->>'child_order_id')::uuid;
SELECT public.consume_order_stock((SELECT child_id FROM ss_child WHERE scenario = 5));
SELECT public.undo_split((SELECT child_id FROM ss_child WHERE scenario = 5));
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001435');
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001415'), '-3.000', 'scenario 5: undo of a consumed child into an unconsumed parent deducts once (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001425'
  $q$),
  'true:3', 'scenario 5: every row of the dish is stamped after the parent consumption');

-- 6. split 2 of 3 -> consume parent only -> undo -> consume parent
INSERT INTO ss_child
SELECT 6, (public.split_order('aaaaaaaa-0000-4000-8000-000000001436',
  '[{"order_item_id":"aaaaaaaa-0000-4000-8000-000000001446","quantity":2}]'::jsonb)->>'child_order_id')::uuid;
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001436');
SELECT public.undo_split((SELECT child_id FROM ss_child WHERE scenario = 6));
SELECT public.consume_order_stock('aaaaaaaa-0000-4000-8000-000000001436');
SELECT is(pg_temp.ss_sale('aaaaaaaa-0000-4000-8000-000000001416'), '-3.000', 'scenario 6: undo of an unconsumed child into a consumed parent still deducts it (-3 g)');
SELECT is(
  pg_temp.ss_text($q$
    SELECT bool_and(oi.stock_consumed_at IS NOT NULL)::text || ':' || sum(oi.quantity)::text
      FROM public.order_items oi WHERE oi.dish_id = 'aaaaaaaa-0000-4000-8000-000000001426'
  $q$),
  'true:3', 'scenario 6: every row of the dish is stamped after the parent consumption');
SELECT is(
  pg_temp.ss_text($q$ SELECT count(*)::text FROM public.order_items WHERE dish_id = 'aaaaaaaa-0000-4000-8000-000000001426' $q$),
  '2', 'scenario 6: rows with a different stamp state are not merged');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
