-- F7 verifier probes (odd/tasks/modificadores.md S1-S4, S6, L4, L5): rules,
-- tenancy, money through split/undo/void/pay, and option stock.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(39);

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('7f000000-0000-0000-0000-0000000000a1', 'v341-a', 'V341 A'),
  ('7f000000-0000-0000-0000-0000000000b2', 'v341-b', 'V341 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('7f000000-0000-0000-0000-000000000001', 'admin@v341a.test', 'h'),
  ('7f000000-0000-0000-0000-000000000002', 'waiter@v341a.test', 'h'),
  ('7f000000-0000-0000-0000-000000000003', 'operator@v341a.test', 'h'),
  ('7f000000-0000-0000-0000-000000000004', 'cashier@v341a.test', 'h'),
  ('7f000000-0000-0000-0000-000000000005', 'admin@v341b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('7f100000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-000000000001', 'Admin A', 'admin@v341a.test', 'admin', true, '7f000000-0000-0000-0000-0000000000a1'),
  ('7f100000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@v341a.test', 'waiter', true, '7f000000-0000-0000-0000-0000000000a1'),
  ('7f100000-0000-0000-0000-000000000003', '7f000000-0000-0000-0000-000000000003', 'Operador A', 'operator@v341a.test', 'delivery_operator', true, '7f000000-0000-0000-0000-0000000000a1'),
  ('7f100000-0000-0000-0000-000000000004', '7f000000-0000-0000-0000-000000000004', 'Cajera A', 'cashier@v341a.test', 'cashier', true, '7f000000-0000-0000-0000-0000000000a1'),
  ('7f100000-0000-0000-0000-000000000005', '7f000000-0000-0000-0000-000000000005', 'Admin B', 'admin@v341b.test', 'admin', true, '7f000000-0000-0000-0000-0000000000b2');
INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('7f000000-0000-0000-0000-0000000000a1', 'inventory_control_enabled', 'true');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('7f900000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind) VALUES
  ('7f200000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', 'Tocineta', 'g', 'raw'),
  ('7f200000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-0000000000a1', 'Carne', 'g', 'raw'),
  ('7f200000-0000-0000-0000-000000000009', '7f000000-0000-0000-0000-0000000000b2', 'Tocineta B', 'g', 'raw');
INSERT INTO public.dishes (id, restaurant_id, name, price, active) VALUES
  ('7f300000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', 'Hamburguesa', 20000, true),
  ('7f300000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-0000000000a1', 'Limonada', 5000, true),
  ('7f300000-0000-0000-0000-000000000003', '7f000000-0000-0000-0000-0000000000a1', 'Combo', 15000, true),
  ('7f300000-0000-0000-0000-000000000009', '7f000000-0000-0000-0000-0000000000b2', 'Hamburguesa B', 20000, true);
INSERT INTO public.recipes (id, restaurant_id, dish_id, yield_quantity) VALUES
  ('7f310000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000001', 1);
INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity) VALUES
  ('7f000000-0000-0000-0000-0000000000a1', '7f310000-0000-0000-0000-000000000001', '7f200000-0000-0000-0000-000000000002', 150);
INSERT INTO public.modifier_groups (id, restaurant_id, name, required, min_select, max_select, is_active) VALUES
  ('7f400000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', 'Término', true, 1, 1, true),
  ('7f400000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-0000000000a1', 'Adiciones', false, 0, NULL, true),
  ('7f400000-0000-0000-0000-000000000003', '7f000000-0000-0000-0000-0000000000a1', 'Salsas', false, 0, 2, true),
  ('7f400000-0000-0000-0000-000000000004', '7f000000-0000-0000-0000-0000000000a1', 'Inactivo', true, 1, NULL, false),
  ('7f400000-0000-0000-0000-000000000005', '7f000000-0000-0000-0000-0000000000a1', 'Acompañantes', true, 2, 3, true),
  ('7f400000-0000-0000-0000-000000000006', '7f000000-0000-0000-0000-0000000000a1', 'Suelto', false, 0, NULL, true),
  ('7f400000-0000-0000-0000-000000000009', '7f000000-0000-0000-0000-0000000000b2', 'Término B', true, 1, 1, true);
INSERT INTO public.modifier_options (id, restaurant_id, group_id, name, price, ingredient_id, ingredient_qty, is_active) VALUES
  ('7f500000-0000-0000-0000-000000000011', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000001', 'Medio', 0, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000012', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000001', 'Bien asado', 0, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000021', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000002', 'Tocineta', 3000, '7f200000-0000-0000-0000-000000000001', 2, true),
  ('7f500000-0000-0000-0000-000000000022', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000002', 'Medio peso', 0.50, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000023', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000002', 'Huevo', 1000.50, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000024', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000002', 'Doble carne', 4000, '7f200000-0000-0000-0000-000000000002', 150, true),
  ('7f500000-0000-0000-0000-000000000025', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000002', 'Piña', 1000, NULL, NULL, false),
  ('7f500000-0000-0000-0000-000000000031', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000003', 'BBQ', 0, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000041', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000004', 'X', 0, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000051', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000005', 'Papas', 500, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000052', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000005', 'Yuca', 500, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000053', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000005', 'Arroz', 500, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000054', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000005', 'Ensalada', 500, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000061', '7f000000-0000-0000-0000-0000000000a1', '7f400000-0000-0000-0000-000000000006', 'Suelta', 100, NULL, NULL, true),
  ('7f500000-0000-0000-0000-000000000091', '7f000000-0000-0000-0000-0000000000b2', '7f400000-0000-0000-0000-000000000009', 'Medio B', 0, NULL, NULL, true);
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000001', '7f400000-0000-0000-0000-000000000001', 0),
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000001', '7f400000-0000-0000-0000-000000000002', 1),
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000001', '7f400000-0000-0000-0000-000000000004', 2),
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000002', '7f400000-0000-0000-0000-000000000003', 0),
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000003', '7f400000-0000-0000-0000-000000000005', 0),
  ('7f000000-0000-0000-0000-0000000000b2', '7f300000-0000-0000-0000-000000000009', '7f400000-0000-0000-0000-000000000009', 0);

CREATE TEMP TABLE v341 (key text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON v341 TO vipe_api;
CREATE FUNCTION pg_temp.v341_rule(p_dish uuid, p_ids uuid[]) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN (SELECT coalesce(sum((m ->> 'price')::numeric), 0)::text || '/' || jsonb_array_length(private.resolve_line_modifiers(p_dish, p_ids))
            FROM jsonb_array_elements(private.resolve_line_modifiers(p_dish, p_ids)) m);
EXCEPTION WHEN sqlstate '22023' THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.v341_bill_ok(p_order uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT o.subtotal = coalesce((SELECT sum(round(oi.price * oi.quantity)) FROM public.order_items oi WHERE oi.order_id = o.id), 0)
    FROM public.orders o WHERE o.id = p_order
$$;
CREATE FUNCTION pg_temp.v341_sale(p_ingredient uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(sum(m.quantity), 0)::numeric(14,3)::text || ' in ' || count(*) FROM public.inventory_movements m
   WHERE m.ingredient_id = p_ingredient AND m.movement_type = 'sale'
$$;
CREATE FUNCTION pg_temp.v341_lines(p_order uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(oi.quantity || 'x' || oi.price || '[' || coalesce((SELECT string_agg(m.option_name, ',' ORDER BY m.sort_order)
           FROM public.order_item_modifiers m WHERE m.order_item_id = oi.id), '') || ']', ' ' ORDER BY oi.price, oi.quantity, oi.id)
    FROM public.order_items oi WHERE oi.order_id = p_order
$$;
GRANT EXECUTE ON FUNCTION pg_temp.v341_rule(uuid, uuid[]), pg_temp.v341_bill_ok(uuid), pg_temp.v341_lines(uuid) TO vipe_api;

-- ============================================
-- 1. Rules (S3), as a waiter of A
-- ============================================
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000021','7f500000-0000-0000-0000-000000000022','7f500000-0000-0000-0000-000000000023','7f500000-0000-0000-0000-000000000024']::uuid[]),
  '8001.00/5', 'max_select NULL takes any number of options; prices sum exactly (0.50 + 1000.50 + 3000 + 4000)');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000061']::uuid[]),
  'modifier_invalid', 'an option of a group the dish does not have is modifier_invalid');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000031']::uuid[]),
  'modifier_invalid', 'an option of another dish''s group is modifier_invalid');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000091']::uuid[]),
  'modifier_invalid', 'an option of another restaurant is modifier_invalid');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000025']::uuid[]),
  'modifier_inactive', 'an inactive option is modifier_inactive');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000041']::uuid[]),
  'modifier_inactive', 'an option of an inactive group is modifier_inactive');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011']::uuid[]),
  '0.00/1', 'an inactive required group is not enforced');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011', NULL]::uuid[]),
  'modifier_invalid', 'a NULL option id is modifier_invalid');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000003', ARRAY['7f500000-0000-0000-0000-000000000051']::uuid[]),
  'modifier_required', 'min_select 2 with one option is modifier_required');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000003', ARRAY['7f500000-0000-0000-0000-000000000051','7f500000-0000-0000-0000-000000000052','7f500000-0000-0000-0000-000000000053','7f500000-0000-0000-0000-000000000054']::uuid[]),
  'modifier_max', 'four options over max_select 3 is modifier_max');
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000003', ARRAY['7f500000-0000-0000-0000-000000000051','7f500000-0000-0000-0000-000000000053']::uuid[]),
  '1000.00/2', 'between min and max resolves');
RESET ROLE;
DELETE FROM public.dish_modifier_groups WHERE dish_id = '7f300000-0000-0000-0000-000000000001' AND group_id = '7f400000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT is(pg_temp.v341_rule('7f300000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000021']::uuid[]),
  'modifier_invalid', 'a group detached from the dish after the cart was built is modifier_invalid');
RESET ROLE;
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('7f000000-0000-0000-0000-0000000000a1', '7f300000-0000-0000-0000-000000000001', '7f400000-0000-0000-0000-000000000002', 1);
SELECT throws_ok($$ UPDATE public.modifier_groups SET min_select = 0 WHERE id = '7f400000-0000-0000-0000-000000000001' $$, '23514', NULL,
  'a required group cannot drop min_select to 0 (CHECK)');
SELECT throws_ok($$ UPDATE public.modifier_groups SET max_select = 1 WHERE id = '7f400000-0000-0000-0000-000000000005' $$, '23514', NULL,
  'max_select under min_select is refused on update (CHECK)');

-- ============================================
-- 2. Tenancy (S2, S4): admin-only writes, snapshot never writable by vipe_api
-- ============================================
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
UPDATE public.modifier_options SET price = 0 WHERE id = '7f500000-0000-0000-0000-000000000021';
SELECT is((SELECT price::text FROM public.modifier_options WHERE id = '7f500000-0000-0000-0000-000000000021'), '3000.00',
  'a waiter cannot reprice an option (RLS hides the row from UPDATE)');
SELECT throws_ok($$ INSERT INTO public.dish_modifier_groups (dish_id, group_id) VALUES ('7f300000-0000-0000-0000-000000000002', '7f400000-0000-0000-0000-000000000002') $$,
  '42501', NULL, 'a waiter cannot attach a group to a dish');
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ INSERT INTO public.order_item_modifiers (restaurant_id, order_item_id, group_id, group_name, option_id, option_name, price, sort_order)
  SELECT '7f000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '7f400000-0000-0000-0000-000000000001', 'T', '7f500000-0000-0000-0000-000000000011', 'M', 0, 0 $$,
  '42501', NULL, 'even an admin (vipe_api) cannot INSERT a snapshot row directly');
SELECT throws_ok($$ SELECT private.write_order_item_modifiers('7f000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '[]') $$,
  '42501', NULL, 'vipe_api cannot call the snapshot writer');
SELECT throws_ok($$ INSERT INTO public.modifier_options (group_id, name, price, ingredient_id, ingredient_qty) VALUES ('7f400000-0000-0000-0000-000000000002', 'Robada', 1, '7f200000-0000-0000-0000-000000000009', 1) $$,
  '23503', NULL, 'an option cannot deduct an ingredient of another restaurant');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name, price) VALUES ('7f000000-0000-0000-0000-0000000000b2', '7f400000-0000-0000-0000-000000000009', 'Intrusa', 1) $$,
  '42501', NULL, 'an admin cannot write an option into another restaurant');
SELECT throws_ok($$ INSERT INTO public.dish_modifier_groups (dish_id, group_id) VALUES ('7f300000-0000-0000-0000-000000000001', '7f400000-0000-0000-0000-000000000009') $$,
  '23503', NULL, 'a dish cannot take a group of another restaurant');
SELECT public.inventory_adjust('7f200000-0000-0000-0000-000000000001', NULL, 'opening', 1000, 1);
SELECT public.inventory_adjust('7f200000-0000-0000-0000-000000000002', NULL, 'opening', 10000, 1);
RESET ROLE;

-- ============================================
-- 3. Money on a table order (L4): split, undo, void, pay
-- ============================================
-- Lines as POST /orders writes them: price = dish + options, snapshot by add_order_item_modifiers.
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('7f600000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, status) VALUES
  ('7f700000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000001', '7f300000-0000-0000-0000-000000000001', 'Hamburguesa', 23000, 3, 'kitchen'),
  ('7f700000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000001', '7f300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000, 1, 'kitchen'),
  ('7f700000-0000-0000-0000-000000000003', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000001', '7f300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000, 2, 'kitchen'),
  ('7f700000-0000-0000-0000-000000000004', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000001', '7f300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000.50, 1, 'kitchen');
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT private.add_order_item_modifiers('7f700000-0000-0000-0000-000000000001', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000021']::uuid[]);
SELECT private.add_order_item_modifiers('7f700000-0000-0000-0000-000000000002', ARRAY['7f500000-0000-0000-0000-000000000012']::uuid[]);
SELECT private.add_order_item_modifiers('7f700000-0000-0000-0000-000000000003', ARRAY['7f500000-0000-0000-0000-000000000011']::uuid[]);
SELECT private.add_order_item_modifiers('7f700000-0000-0000-0000-000000000004', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000022']::uuid[]);
SELECT private.recompute_caller_order_bill('7f600000-0000-0000-0000-000000000001');
SELECT is((SELECT subtotal::text FROM public.orders WHERE id = '7f600000-0000-0000-0000-000000000001'), '149001.00',
  'the bill sums round(price x qty): 69000 + 20000 + 40000 + 20001');
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000004', true);
INSERT INTO v341 SELECT 'child', (public.split_order('7f600000-0000-0000-0000-000000000001',
  '[{"order_item_id":"7f700000-0000-0000-0000-000000000001","quantity":2},{"order_item_id":"7f700000-0000-0000-0000-000000000003","quantity":1},{"order_item_id":"7f700000-0000-0000-0000-000000000004","quantity":1}]') ->> 'child_order_id')::uuid;
SELECT is(pg_temp.v341_lines((SELECT id FROM v341 WHERE key = 'child')), '1x20000.00[Medio] 1x20000.50[Medio,Medio peso] 2x23000.00[Medio,Tocineta]',
  'the child gets the copied snapshot with the moved quantities (full move keeps the line)');
SELECT is(pg_temp.v341_lines('7f600000-0000-0000-0000-000000000001'), '1x20000.00[Bien asado] 1x20000.00[Medio] 1x23000.00[Medio,Tocineta]',
  'the parent keeps the rest with its options');
SELECT ok(pg_temp.v341_bill_ok('7f600000-0000-0000-0000-000000000001') AND pg_temp.v341_bill_ok((SELECT id FROM v341 WHERE key = 'child')),
  'parent and child bills equal their lines after the split');
SELECT is((SELECT sum(subtotal)::text FROM public.orders WHERE id IN ('7f600000-0000-0000-0000-000000000001', (SELECT id FROM v341 WHERE key = 'child'))), '149001.00',
  'the split keeps the total');
SELECT public.undo_split((SELECT id FROM v341 WHERE key = 'child'));
SELECT is(pg_temp.v341_lines('7f600000-0000-0000-0000-000000000001'), '1x20000.00[Bien asado] 2x20000.00[Medio] 1x20000.50[Medio,Medio peso] 3x23000.00[Medio,Tocineta]',
  'undo merges each line only into the line with the same options (Medio never into Bien asado)');
SELECT is((SELECT subtotal::text FROM public.orders WHERE id = '7f600000-0000-0000-0000-000000000001'), '149001.00', 'undo restores the bill');
SELECT is((SELECT count(*)::int FROM public.order_item_modifiers m JOIN public.order_items oi ON oi.id = m.order_item_id WHERE oi.order_id = '7f600000-0000-0000-0000-000000000001'), 6,
  'no orphan or duplicated snapshot rows after split + undo');
RESET ROLE;
INSERT INTO public.supervisor_authorizations
  (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
VALUES ('7f800000-0000-0000-0000-000000000001', '7f000000-0000-0000-0000-0000000000a1', 'void_item', '7f100000-0000-0000-0000-000000000001',
        '7f100000-0000-0000-0000-000000000004', 'order', '7f600000-0000-0000-0000-000000000001', now() - interval '10 seconds', now() + interval '110 seconds', now());
SET LOCAL ROLE vipe_api;
SELECT public.void_order_items('7f600000-0000-0000-0000-000000000001', '[{"order_item_id":"7f700000-0000-0000-0000-000000000001","quantity":1}]', 'dish_returned', NULL, '7f800000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT is((SELECT unit_price::text || ' ' || amount::text FROM public.order_item_voids WHERE order_item_id = '7f700000-0000-0000-0000-000000000001'), '23000.00 23000.00',
  'a void copies the unit price with its options');
SELECT is((SELECT subtotal::text FROM public.orders WHERE id = '7f600000-0000-0000-0000-000000000001'), '126001.00', 'the bill drops by the voided line price');
SET LOCAL ROLE vipe_api;
SELECT is((public.pay_order('7f600000-0000-0000-0000-000000000001', '7f900000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '7f000000-0000-0000-0000-0000000000a1'),
    'amount', 126001, 'cash_received', 126001)), '7f800000-0000-0000-0000-0000000000ff') ->> 'payment_id') IS NOT NULL, true,
  'pay_order takes exactly the bill with options');
RESET ROLE;
SELECT is((SELECT amount_due::text FROM public.payments WHERE order_id = '7f600000-0000-0000-0000-000000000001'), '126001', 'the payment total is the bill');

-- ============================================
-- 4. Deliveries (S1, L4): server price, no client price, stock once
-- ============================================
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
INSERT INTO v341 SELECT 'delivery', (public.create_delivery_order('{"phone":"3005556677","name":"Luz"}', '{"address_line":"Calle 3"}',
  '[{"dish_id":"7f300000-0000-0000-0000-000000000001","quantity":2,"price":1,"unit_price":1,"option_ids":["7f500000-0000-0000-0000-000000000011","7f500000-0000-0000-0000-000000000021","7f500000-0000-0000-0000-000000000024"]},
    {"dish_id":"7f300000-0000-0000-0000-000000000001","quantity":1,"option_ids":["7f500000-0000-0000-0000-000000000012"]},
    {"dish_id":"7f300000-0000-0000-0000-000000000002","quantity":1}]', 0, 'prepaid') ->> 'order_id')::uuid;
SELECT is(pg_temp.v341_lines((SELECT id FROM v341 WHERE key = 'delivery')), '1x5000.00[] 1x20000.00[Bien asado] 2x27000.00[Medio,Doble carne,Tocineta]',
  'delivery lines are priced by the server; client price keys are ignored');
SELECT ok(pg_temp.v341_bill_ok((SELECT id FROM v341 WHERE key = 'delivery')), 'the delivery bill equals its lines');
SELECT throws_like($$ SELECT public.create_delivery_order('{"phone":"3005556677"}', '{"address_line":"Calle 3"}',
  '[{"dish_id":"7f300000-0000-0000-0000-000000000001","quantity":1,"option_ids":["7f500000-0000-0000-0000-000000000011","7f500000-0000-0000-0000-000000000011"]}]', 0, 'prepaid') $$,
  'modifier_duplicate:%', 'a duplicated option on a delivery is modifier_duplicate');
SELECT public.consume_order_stock((SELECT id FROM v341 WHERE key = 'delivery'));
SELECT public.consume_order_stock((SELECT id FROM v341 WHERE key = 'delivery'));
RESET ROLE;
SELECT is(pg_temp.v341_sale('7f200000-0000-0000-0000-000000000001'), '-4.000 in 1', 'Tocineta: 2 g x 2 units, once, after two consumes');
SELECT is(pg_temp.v341_sale('7f200000-0000-0000-0000-000000000002'), '-750.000 in 2',
  'Carne: recipe 150 + Doble carne 150 per unit x 2 in one take, plus 150 x 1 for the plain line');

-- ============================================
-- 5. Table order lines: option stock deducted once on parent and child after a split
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('7f600000-0000-0000-0000-000000000002', '7f000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, status) VALUES
  ('7f700000-0000-0000-0000-000000000021', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000002', '7f300000-0000-0000-0000-000000000001', 'Hamburguesa', 23000, 3, 'kitchen'),
  ('7f700000-0000-0000-0000-000000000022', '7f000000-0000-0000-0000-0000000000a1', '7f600000-0000-0000-0000-000000000002', '7f300000-0000-0000-0000-000000000002', 'Limonada', 5000, 1, 'kitchen');
SELECT set_config('app.user_id', '7f000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT private.add_order_item_modifiers('7f700000-0000-0000-0000-000000000021', ARRAY['7f500000-0000-0000-0000-000000000011','7f500000-0000-0000-0000-000000000021']::uuid[]);
INSERT INTO v341 SELECT 'child2', (public.split_order('7f600000-0000-0000-0000-000000000002',
  '[{"order_item_id":"7f700000-0000-0000-0000-000000000021","quantity":2}]') ->> 'child_order_id')::uuid;
SELECT public.consume_order_stock('7f600000-0000-0000-0000-000000000002');
SELECT public.consume_order_stock((SELECT id FROM v341 WHERE key = 'child2'));
SELECT public.consume_order_stock((SELECT id FROM v341 WHERE key = 'child2'));
RESET ROLE;
SELECT is(pg_temp.v341_sale('7f200000-0000-0000-0000-000000000001'), '-10.000 in 3',
  'a split line deducts its option ingredient once on each side: 2 g x (1 parent + 2 child) after the 4 g delivery');
SELECT * FROM finish();
ROLLBACK;
