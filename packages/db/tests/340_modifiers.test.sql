-- Priced modifiers (odd/tasks/modificadores.md T1, S1-S5, L4, migration 0023).
--
-- Reusable modifier groups and options (price, optional ingredient), their
-- dish links, the per-line snapshot, the rules of private.resolve_line_modifiers,
-- delivery orders with options, the option ingredients in consume_order_stock,
-- split_order / undo_split keeping the snapshot, and dishes.quick_notes gone.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(58);

-- ============================================
-- 1. Schema, grants, policies
-- ============================================
SELECT has_table('public', 'modifier_groups', 'modifier_groups exists');
SELECT has_table('public', 'modifier_options', 'modifier_options exists');
SELECT has_table('public', 'dish_modifier_groups', 'dish_modifier_groups exists');
SELECT has_table('public', 'order_item_modifiers', 'order_item_modifiers exists');
SELECT hasnt_column('public', 'dishes', 'quick_notes', 'dishes.quick_notes is dropped');
SELECT hasnt_function('private', 'quick_notes_valid', ARRAY['text[]'], 'private.quick_notes_valid is dropped');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'dishes_normalize_quick_notes'), 'the quick notes trigger is dropped');
SELECT policies_are('public', 'order_item_modifiers', ARRAY['order_item_modifiers_select_policy'],
  'order_item_modifiers has only a SELECT policy');
SELECT ok(has_table_privilege('vipe_api', 'public.order_item_modifiers', 'SELECT')
      AND NOT has_table_privilege('vipe_api', 'public.order_item_modifiers', 'INSERT')
      AND NOT has_table_privilege('vipe_api', 'public.order_item_modifiers', 'UPDATE')
      AND NOT has_table_privilege('vipe_api', 'public.order_item_modifiers', 'DELETE'),
  'vipe_api only reads order_item_modifiers');
SELECT ok(has_function_privilege('vipe_api', 'private.resolve_line_modifiers(uuid,uuid[])', 'EXECUTE')
      AND has_function_privilege('vipe_api', 'private.add_order_item_modifiers(uuid,uuid[])', 'EXECUTE')
      AND NOT has_function_privilege('vipe_api', 'private.write_order_item_modifiers(uuid,uuid,jsonb)', 'EXECUTE'),
  'vipe_api resolves and adds options but cannot write a snapshot directly');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'private.add_order_item_modifiers(uuid,uuid[])'::regprocedure)
      AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'private.resolve_line_modifiers(uuid,uuid[])'::regprocedure),
  'add_order_item_modifiers is SECURITY DEFINER, resolve_line_modifiers SECURITY INVOKER');

-- ============================================
-- Fixtures: restaurants A and B, staff, ingredients, dishes, groups, options.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('34000000-0000-0000-0000-0000000000a1', 't340-a', 'T340 A'),
  ('34000000-0000-0000-0000-0000000000b2', 't340-b', 'T340 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('34000000-0000-0000-0000-000000000001', 'admin@t340a.test', 'h'),
  ('34000000-0000-0000-0000-000000000002', 'waiter@t340a.test', 'h'),
  ('34000000-0000-0000-0000-000000000003', 'operator@t340a.test', 'h'),
  ('34000000-0000-0000-0000-000000000004', 'admin@t340b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('34100000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t340a.test', 'admin', true, '34000000-0000-0000-0000-0000000000a1'),
  ('34100000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@t340a.test', 'waiter', true, '34000000-0000-0000-0000-0000000000a1'),
  ('34100000-0000-0000-0000-000000000003', '34000000-0000-0000-0000-000000000003', 'Operador A', 'operator@t340a.test', 'delivery_operator', true, '34000000-0000-0000-0000-0000000000a1'),
  ('34100000-0000-0000-0000-000000000004', '34000000-0000-0000-0000-000000000004', 'Admin B', 'admin@t340b.test', 'admin', true, '34000000-0000-0000-0000-0000000000b2');
INSERT INTO public.business_config (restaurant_id, key, value)
VALUES ('34000000-0000-0000-0000-0000000000a1', 'inventory_control_enabled', 'true');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind) VALUES
  ('34200000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-0000000000a1', 'Tocineta', 'g', 'raw'),
  ('34200000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-0000000000b2', 'Tocineta B', 'g', 'raw');
INSERT INTO public.dishes (id, restaurant_id, name, price, active) VALUES
  ('34300000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-0000000000a1', 'Hamburguesa', 20000, true),
  ('34300000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-0000000000a1', 'Limonada', 5000, true),
  ('34300000-0000-0000-0000-000000000003', '34000000-0000-0000-0000-0000000000b2', 'Hamburguesa B', 20000, true);
INSERT INTO public.modifier_groups (id, restaurant_id, name, required, min_select, max_select, is_active) VALUES
  ('34400000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-0000000000a1', 'Término', true, 1, 1, true),
  ('34400000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-0000000000a1', 'Adiciones', false, 0, 2, true),
  ('34400000-0000-0000-0000-000000000003', '34000000-0000-0000-0000-0000000000a1', 'Salsas', true, 1, NULL, false),
  ('34400000-0000-0000-0000-000000000004', '34000000-0000-0000-0000-0000000000b2', 'Término', true, 1, 1, true);
INSERT INTO public.modifier_options (id, restaurant_id, group_id, name, price, ingredient_id, ingredient_qty, is_active) VALUES
  ('34500000-0000-0000-0000-000000000011', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000001', 'Medio', 0, NULL, NULL, true),
  ('34500000-0000-0000-0000-000000000012', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000001', 'Bien asado', 0, NULL, NULL, true),
  ('34500000-0000-0000-0000-000000000021', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Tocineta', 3000, '34200000-0000-0000-0000-000000000001', 2, true),
  ('34500000-0000-0000-0000-000000000022', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Queso', 2500, NULL, NULL, true),
  ('34500000-0000-0000-0000-000000000023', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Huevo', 2000, NULL, NULL, true),
  ('34500000-0000-0000-0000-000000000024', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Piña', 1000, NULL, NULL, false),
  ('34500000-0000-0000-0000-000000000031', '34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000003', 'BBQ', 0, NULL, NULL, true),
  ('34500000-0000-0000-0000-000000000041', '34000000-0000-0000-0000-0000000000b2', '34400000-0000-0000-0000-000000000004', 'Medio B', 0, NULL, NULL, true);
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('34000000-0000-0000-0000-0000000000a1', '34300000-0000-0000-0000-000000000001', '34400000-0000-0000-0000-000000000001', 0),
  ('34000000-0000-0000-0000-0000000000a1', '34300000-0000-0000-0000-000000000001', '34400000-0000-0000-0000-000000000002', 1),
  ('34000000-0000-0000-0000-0000000000a1', '34300000-0000-0000-0000-000000000001', '34400000-0000-0000-0000-000000000003', 2),
  ('34000000-0000-0000-0000-0000000000b2', '34300000-0000-0000-0000-000000000003', '34400000-0000-0000-0000-000000000004', 0);

-- ============================================
-- 2. CHECKs and keys
-- ============================================
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name) VALUES ('34000000-0000-0000-0000-0000000000a1', '  ') $$,
  '23514', NULL, 'a blank group name is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name) VALUES ('34000000-0000-0000-0000-0000000000a1', repeat('a', 61)) $$,
  '23514', NULL, 'a group name longer than 60 is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name, required, min_select) VALUES ('34000000-0000-0000-0000-0000000000a1', 'X', true, 0) $$,
  '23514', NULL, 'a required group with min_select 0 is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name, required, min_select) VALUES ('34000000-0000-0000-0000-0000000000a1', 'X', false, 1) $$,
  '23514', NULL, 'an optional group with min_select 1 is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name, required, min_select, max_select) VALUES ('34000000-0000-0000-0000-0000000000a1', 'X', true, 3, 2) $$,
  '23514', NULL, 'min_select above max_select is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name, max_select) VALUES ('34000000-0000-0000-0000-0000000000a1', 'X', 0) $$,
  '23514', NULL, 'max_select 0 is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name) VALUES ('34000000-0000-0000-0000-0000000000a1', 'TÉRMINO') $$,
  '23505', NULL, 'group names are unique per restaurant ignoring case');
SELECT lives_ok($$ INSERT INTO public.modifier_groups (restaurant_id, name) VALUES ('34000000-0000-0000-0000-0000000000b2', 'Adiciones') $$,
  'another restaurant may reuse a group name');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name, price) VALUES ('34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Y', -1) $$,
  '23514', NULL, 'a negative option price is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name, ingredient_id) VALUES ('34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Y', '34200000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'an ingredient without quantity is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name, ingredient_id, ingredient_qty) VALUES ('34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Y', '34200000-0000-0000-0000-000000000001', 0) $$,
  '23514', NULL, 'an ingredient quantity of 0 is refused');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name) VALUES ('34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'queso') $$,
  '23505', NULL, 'option names are unique per group ignoring case');
SELECT throws_ok($$ INSERT INTO public.modifier_options (restaurant_id, group_id, name, ingredient_id, ingredient_qty) VALUES ('34000000-0000-0000-0000-0000000000a1', '34400000-0000-0000-0000-000000000002', 'Y', '34200000-0000-0000-0000-000000000002', 1) $$,
  '23503', NULL, 'an ingredient of another restaurant is refused');
SELECT throws_ok($$ INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id) VALUES ('34000000-0000-0000-0000-0000000000b2', '34300000-0000-0000-0000-000000000003', '34400000-0000-0000-0000-000000000001') $$,
  '23503', NULL, 'a dish cannot take a group of another restaurant');

-- Order fixtures for add_order_item_modifiers and the split (written before the role switch).
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('34600000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0),
  ('34600000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, created_at) VALUES
  ('34700000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-0000000000a1', '34600000-0000-0000-0000-000000000001', '34300000-0000-0000-0000-000000000001', 'Hamburguesa', 23000, 1, now()),
  ('34700000-0000-0000-0000-000000000002', '34000000-0000-0000-0000-0000000000a1', '34600000-0000-0000-0000-000000000001', '34300000-0000-0000-0000-000000000001', 'Hamburguesa', 20000, 1, now() - interval '1 hour'),
  ('34700000-0000-0000-0000-000000000011', '34000000-0000-0000-0000-0000000000a1', '34600000-0000-0000-0000-000000000002', '34300000-0000-0000-0000-000000000001', 'Hamburguesa', 23000, 3, now()),
  ('34700000-0000-0000-0000-000000000012', '34000000-0000-0000-0000-0000000000a1', '34600000-0000-0000-0000-000000000002', '34300000-0000-0000-0000-000000000001', 'Hamburguesa', 23000, 1, now());
INSERT INTO public.order_item_modifiers (restaurant_id, order_item_id, group_id, group_name, option_id, option_name, price, ingredient_id, ingredient_qty, sort_order) VALUES
  ('34000000-0000-0000-0000-0000000000a1', '34700000-0000-0000-0000-000000000011', '34400000-0000-0000-0000-000000000001', 'Término', '34500000-0000-0000-0000-000000000011', 'Medio', 0, NULL, NULL, 0),
  ('34000000-0000-0000-0000-0000000000a1', '34700000-0000-0000-0000-000000000011', '34400000-0000-0000-0000-000000000002', 'Adiciones', '34500000-0000-0000-0000-000000000021', 'Tocineta', 3000, '34200000-0000-0000-0000-000000000001', 2, 1);

CREATE TEMP TABLE t340 (key text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t340 TO vipe_api;
CREATE FUNCTION pg_temp.t340_mods(p_item uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(m.option_name, ',' ORDER BY m.sort_order), '') FROM public.order_item_modifiers m WHERE m.order_item_id = p_item
$$;
CREATE FUNCTION pg_temp.t340_sale(p_ingredient uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(sum(m.quantity), 0)::numeric(14,3)::text FROM public.inventory_movements m
   WHERE m.ingredient_id = p_ingredient AND m.movement_type = 'sale'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t340_mods(uuid), pg_temp.t340_sale(uuid) TO vipe_api;

-- ============================================
-- 3. RLS: staff read, only an admin writes the catalog
-- ============================================
SELECT set_config('app.user_id', '34000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*)::int FROM public.modifier_groups), 3, 'a waiter reads the groups of the restaurant');
SELECT throws_ok($$ INSERT INTO public.modifier_groups (name) VALUES ('Waiter group') $$, '42501', NULL, 'a waiter cannot create a group');
SELECT throws_ok($$ INSERT INTO public.order_item_modifiers (restaurant_id, order_item_id, group_id, group_name, option_id, option_name, price, sort_order)
  VALUES ('34000000-0000-0000-0000-0000000000a1', '34700000-0000-0000-0000-000000000002', '34400000-0000-0000-0000-000000000001', 'T', '34500000-0000-0000-0000-000000000011', 'M', 0, 0) $$,
  '42501', NULL, 'vipe_api cannot write a snapshot row');

-- ============================================
-- 4. private.resolve_line_modifiers
-- ============================================
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001', '{}') $$,
  'modifier_required:%', 'a required group without an option is modifier_required');
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001', ARRAY['34500000-0000-0000-0000-000000000011', '34500000-0000-0000-0000-000000000021', '34500000-0000-0000-0000-000000000022', '34500000-0000-0000-0000-000000000023']::uuid[]) $$,
  'modifier_max:%', 'more than max_select options is modifier_max');
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000002', ARRAY['34500000-0000-0000-0000-000000000011']::uuid[]) $$,
  'modifier_invalid:%', 'an option the dish does not offer is modifier_invalid');
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001', ARRAY['34500000-0000-0000-0000-000000000011', '34500000-0000-0000-0000-000000000041']::uuid[]) $$,
  'modifier_invalid:%', 'an option of another restaurant is modifier_invalid');
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001', ARRAY['34500000-0000-0000-0000-000000000011', '34500000-0000-0000-0000-000000000024']::uuid[]) $$,
  'modifier_inactive:%', 'an inactive option is modifier_inactive');
SELECT throws_like($$ SELECT private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001', ARRAY['34500000-0000-0000-0000-000000000011', '34500000-0000-0000-0000-000000000011']::uuid[]) $$,
  'modifier_duplicate:%', 'an option twice is modifier_duplicate');
SELECT is((SELECT string_agg((m ->> 'option_name') || '=' || (m ->> 'price'), ',' ORDER BY (m ->> 'sort_order')::int)
             FROM jsonb_array_elements(private.resolve_line_modifiers('34300000-0000-0000-0000-000000000001',
                    ARRAY['34500000-0000-0000-0000-000000000021', '34500000-0000-0000-0000-000000000011']::uuid[])) m),
  'Medio=0.00,Tocineta=3000.00', 'valid options resolve in group order with their prices; the inactive required group is skipped');
SELECT is(private.resolve_line_modifiers('34300000-0000-0000-0000-000000000002', NULL), '[]'::jsonb,
  'a dish without groups takes no options');

-- ============================================
-- 5. private.add_order_item_modifiers
-- ============================================
SELECT is(jsonb_array_length(private.add_order_item_modifiers('34700000-0000-0000-0000-000000000001',
            ARRAY['34500000-0000-0000-0000-000000000011', '34500000-0000-0000-0000-000000000021']::uuid[])), 2,
  'a line of this transaction takes its options');
SELECT is(pg_temp.t340_mods('34700000-0000-0000-0000-000000000001'), 'Medio,Tocineta', 'the snapshot rows are written');
SELECT throws_ok($$ SELECT private.add_order_item_modifiers('34700000-0000-0000-0000-000000000001', ARRAY['34500000-0000-0000-0000-000000000012']::uuid[]) $$,
  '22023', 'add_order_item_modifiers: options are written only with a new line', 'a line with options takes no more');
SELECT throws_ok($$ SELECT private.add_order_item_modifiers('34700000-0000-0000-0000-000000000002', ARRAY['34500000-0000-0000-0000-000000000011']::uuid[]) $$,
  '22023', 'add_order_item_modifiers: options are written only with a new line', 'a line of an earlier transaction takes no options');
SELECT throws_ok($$ SELECT private.add_order_item_modifiers('34700000-0000-0000-0000-0000000000ff', ARRAY['34500000-0000-0000-0000-000000000011']::uuid[]) $$,
  'P0002', NULL, 'an unknown line is P0002');
RESET ROLE;

-- ============================================
-- 6. Another restaurant
-- ============================================
SELECT set_config('app.user_id', '34000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*)::int FROM public.modifier_groups), 2, 'admin B reads only the groups of B');
SELECT is((SELECT count(*)::int FROM public.modifier_options), 1, 'admin B reads only the options of B');
SELECT is((SELECT count(*)::int FROM public.order_item_modifiers), 0, 'admin B reads no snapshot of A');
RESET ROLE;

-- ============================================
-- 7. Admin writes; opening stock
-- ============================================
SELECT set_config('app.user_id', '34000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ INSERT INTO public.modifier_groups (name, min_select, required) VALUES ('Bebida', 1, true) $$, 'an admin creates a group');
SELECT public.inventory_adjust('34200000-0000-0000-0000-000000000001', NULL, 'opening', 100, 1);
RESET ROLE;

-- ============================================
-- 8. create_delivery_order with options
-- ============================================
SELECT set_config('app.user_id', '34000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
INSERT INTO t340 (key, id)
SELECT 'delivery', (public.create_delivery_order(
  '{"phone":"3001234567","name":"Ana"}', '{"address_line":"Calle 1"}',
  '[{"dish_id":"34300000-0000-0000-0000-000000000001","quantity":2,"option_ids":["34500000-0000-0000-0000-000000000021","34500000-0000-0000-0000-000000000011"]},
    {"dish_id":"34300000-0000-0000-0000-000000000002","quantity":1}]',
  0, 'prepaid') ->> 'order_id')::uuid;
SELECT is((SELECT subtotal::bigint FROM public.orders WHERE id = (SELECT id FROM t340 WHERE key = 'delivery')), 51000::bigint,
  'the delivery subtotal adds the options: (20000 + 3000) x 2 + 5000');
SELECT is((SELECT oi.price::text || ' ' || pg_temp.t340_mods(oi.id) FROM public.order_items oi
            WHERE oi.order_id = (SELECT id FROM t340 WHERE key = 'delivery') AND oi.dish_id = '34300000-0000-0000-0000-000000000001'),
  '23000.00 Medio,Tocineta', 'the line price is the dish plus its options and keeps the snapshot');
SELECT is((SELECT oi.price::text || ' ' || pg_temp.t340_mods(oi.id) FROM public.order_items oi
            WHERE oi.order_id = (SELECT id FROM t340 WHERE key = 'delivery') AND oi.dish_id = '34300000-0000-0000-0000-000000000002'),
  '5000.00 ', 'a line without options keeps the dish price and no snapshot');
SELECT throws_like($$ SELECT public.create_delivery_order('{"phone":"3001234567"}', '{"address_line":"Calle 1"}',
  '[{"dish_id":"34300000-0000-0000-0000-000000000001","quantity":1}]', 0, 'prepaid') $$,
  'modifier_required:%', 'a delivery line without its required option is refused');
SELECT throws_ok($$ SELECT public.create_delivery_order('{"phone":"3001234567"}', '{"address_line":"Calle 1"}',
  '[{"dish_id":"34300000-0000-0000-0000-000000000002","quantity":1,"option_ids":"x"}]', 0, 'prepaid') $$,
  '22023', 'create_delivery_order: item[1].option_ids must be an array of uuids', 'option_ids must be an array');

-- ============================================
-- 9. consume_order_stock deducts option ingredients once
-- ============================================
-- The movements are read as the superuser (the operator does not see them).
SELECT public.consume_order_stock((SELECT id FROM t340 WHERE key = 'delivery'));
RESET ROLE;
SELECT is(pg_temp.t340_sale('34200000-0000-0000-0000-000000000001'), '-4.000',
  'Tocineta: 2 g per unit x 2 units are deducted');
SET LOCAL ROLE vipe_api;
SELECT public.consume_order_stock((SELECT id FROM t340 WHERE key = 'delivery'));
RESET ROLE;
SELECT is(pg_temp.t340_sale('34200000-0000-0000-0000-000000000001'), '-4.000', 'a second consume deducts nothing');

-- ============================================
-- 10. split_order / undo_split keep the snapshot
-- ============================================
SELECT set_config('app.user_id', '34000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
INSERT INTO t340 (key, id)
SELECT 'child1', (public.split_order('34600000-0000-0000-0000-000000000002',
  '[{"order_item_id":"34700000-0000-0000-0000-000000000011","quantity":1}]') ->> 'child_order_id')::uuid;
SELECT is((SELECT oi.quantity || ' ' || oi.price::text || ' ' || pg_temp.t340_mods(oi.id) FROM public.order_items oi
            WHERE oi.order_id = (SELECT id FROM t340 WHERE key = 'child1')),
  '1 23000.00 Medio,Tocineta', 'a partial split copies the options to the new line');
SELECT is(pg_temp.t340_mods('34700000-0000-0000-0000-000000000011'), 'Medio,Tocineta', 'the parent line keeps its options');
SELECT public.undo_split((SELECT id FROM t340 WHERE key = 'child1'));
SELECT is((SELECT string_agg(oi.quantity::text || ':' || pg_temp.t340_mods(oi.id), ' ' ORDER BY oi.id) FROM public.order_items oi
            WHERE oi.order_id = '34600000-0000-0000-0000-000000000002'),
  '3:Medio,Tocineta 1:', 'undo merges the line back into the line with the same options only');
SELECT is((SELECT count(*)::int FROM public.order_item_modifiers m JOIN public.order_items oi ON oi.id = m.order_item_id
            WHERE oi.order_id = '34600000-0000-0000-0000-000000000002'), 2, 'the merged child line took its snapshot rows with it');
INSERT INTO t340 (key, id)
SELECT 'child2', (public.split_order('34600000-0000-0000-0000-000000000002',
  '[{"order_item_id":"34700000-0000-0000-0000-000000000011","quantity":3}]') ->> 'child_order_id')::uuid;
SELECT is((SELECT oi.id::text || ' ' || pg_temp.t340_mods(oi.id) FROM public.order_items oi
            WHERE oi.order_id = (SELECT id FROM t340 WHERE key = 'child2')),
  '34700000-0000-0000-0000-000000000011 Medio,Tocineta', 'a full move keeps the line and its options');
SELECT public.undo_split((SELECT id FROM t340 WHERE key = 'child2'));
SELECT is((SELECT string_agg(oi.quantity::text || ':' || pg_temp.t340_mods(oi.id), ' ' ORDER BY oi.id) FROM public.order_items oi
            WHERE oi.order_id = '34600000-0000-0000-0000-000000000002'),
  '3:Medio,Tocineta 1:', 'undo does not merge a line into one of the same dish and price with other options');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
