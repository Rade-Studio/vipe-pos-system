-- Promotions and order discounts (odd/tasks/promociones.md T1, S1-S2, migration 0027).
--
-- The promotion kinds, modes and conditions with their per-kind checks, the
-- defaults an existing promotion gets, the targets and combo tables, the
-- order_discounts rows and their checks, tenant isolation of the new tables,
-- the bill (gross - discounts = subtotal, tax and total on the net,
-- discounts of cancelled lines ignored) in recompute_order_bill and
-- pay_order, and split_order / undo_split moving the item discounts.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(159);

-- ============================================
-- 1. Schema, grants, policies
-- ============================================
SELECT has_table('public', 'promotion_categories', 'promotion_categories exists');
SELECT has_table('public', 'promotion_subcategories', 'promotion_subcategories exists');
SELECT has_table('public', 'promotion_combo_groups', 'promotion_combo_groups exists');
SELECT has_table('public', 'promotion_combo_options', 'promotion_combo_options exists');
SELECT has_table('public', 'order_discounts', 'order_discounts exists');
SELECT columns_are('public', 'order_discounts',
  ARRAY['id', 'restaurant_id', 'order_id', 'order_item_id', 'promotion_id', 'kind', 'source', 'label', 'amount',
        'combo_id', 'reason', 'created_by', 'authorized_by', 'requires_authorization', 'line_quantity', 'created_at'],
  'order_discounts has the discount record columns');
SELECT col_not_null('public', 'order_discounts', 'requires_authorization', 'requires_authorization is NOT NULL');
SELECT col_default_is('public', 'order_discounts', 'requires_authorization', 'true', 'requires_authorization defaults to true');
SELECT col_type_is('public', 'order_discounts', 'line_quantity', 'integer', 'line_quantity is a nullable integer');
SELECT ok((SELECT bool_and(EXISTS (SELECT 1 FROM information_schema.columns c
                                     WHERE c.table_schema = 'public' AND c.table_name = 'promotions' AND c.column_name = x))
             FROM unnest(ARRAY['kind', 'mode', 'buy_quantity', 'pay_quantity', 'rest_discount_percent', 'combo_price',
                               'min_subtotal', 'max_discount', 'days_of_week', 'time_windows', 'channels',
                               'max_uses_per_order']) x),
  'promotions has the kind, mode and condition columns');
SELECT ok((SELECT bool_and(EXISTS (SELECT 1 FROM information_schema.columns c
                                     WHERE c.table_schema = 'public' AND c.table_name = 'order_items' AND c.column_name = x))
             FROM unnest(ARRAY['promotion_id', 'promotion_snapshot', 'combo_id']) x),
  'order_items has promotion_id, promotion_snapshot and combo_id');
SELECT col_is_null('public', 'promotions', 'discount_type', 'promotions.discount_type is nullable');
SELECT col_is_null('public', 'promotions', 'discount_value', 'promotions.discount_value is nullable');
SELECT col_is_null('public', 'promotions', 'end_date', 'promotions.end_date is nullable (no end)');
SELECT ok((SELECT bool_and(has_table_privilege('vipe_api', 'public.' || t, 'SELECT')
                       AND has_table_privilege('vipe_api', 'public.' || t, 'INSERT')
                       AND has_table_privilege('vipe_api', 'public.' || t, 'UPDATE')
                       AND has_table_privilege('vipe_api', 'public.' || t, 'DELETE'))
             FROM unnest(ARRAY['promotion_categories', 'promotion_subcategories', 'promotion_combo_groups',
                               'promotion_combo_options', 'order_discounts']) t),
  'vipe_api reads and writes the new tables (RLS decides the rows)');
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid IN ('public.promotion_categories'::regclass, 'public.promotion_subcategories'::regclass,
                            'public.promotion_combo_groups'::regclass, 'public.promotion_combo_options'::regclass,
                            'public.order_discounts'::regclass)),
  'RLS is enabled on the new tables');
SELECT ok((SELECT count(*) = 20 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename IN ('promotion_categories', 'promotion_subcategories', 'promotion_combo_groups',
                                'promotion_combo_options', 'order_discounts')
              AND roles = '{vipe_api}'
              AND coalesce(qual, with_check) LIKE '%current_restaurant_id()%'),
  'each new table has four tenant policies for vipe_api');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.order_bill_base(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('vipe_api', 'private.recompute_order_bill(uuid)', 'EXECUTE'),
  'vipe_api cannot call the bill helpers directly');

-- ============================================
-- Fixtures: restaurants A and B, staff, menu, register.
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('36000000-0000-0000-0000-0000000000a1', 't360-a', 'T360 A'),
  ('36000000-0000-0000-0000-0000000000b2', 't360-b', 'T360 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('36000000-0000-0000-0000-000000000001', 'admin@t360a.test', 'h'),
  ('36000000-0000-0000-0000-000000000002', 'cashier@t360a.test', 'h'),
  ('36000000-0000-0000-0000-000000000003', 'admin@t360b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('36100000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t360a.test', 'admin', true, '36000000-0000-0000-0000-0000000000a1'),
  ('36100000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-000000000002', 'Caja A', 'cashier@t360a.test', 'cashier', true, '36000000-0000-0000-0000-0000000000a1'),
  ('36100000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-000000000003', 'Admin B', 'admin@t360b.test', 'admin', true, '36000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, restaurant_id, name, icon) VALUES
  ('36200000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'Cócteles', 'cocktail'),
  ('36200000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000b2', 'Cócteles B', 'cocktail');
INSERT INTO public.subcategories (id, restaurant_id, category_id, name) VALUES
  ('36210000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', '36200000-0000-0000-0000-000000000001', 'Con ron'),
  ('36210000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000b2', '36200000-0000-0000-0000-000000000002', 'Con ron B');
INSERT INTO public.dishes (id, restaurant_id, name, price, active, category_id) VALUES
  ('36300000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'Mojito', 24000, true, '36200000-0000-0000-0000-000000000001'),
  ('36300000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'Margarita', 26000, true, '36200000-0000-0000-0000-000000000001'),
  ('36300000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', 'Sopa', 9000, true, NULL),
  ('36300000-0000-0000-0000-000000000004', '36000000-0000-0000-0000-0000000000b2', 'Mojito B', 24000, true, '36200000-0000-0000-0000-000000000002');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('36400000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', now(), 100000, 'open');

-- ============================================
-- 2. A promotion written with the old columns only gets the defaults
--    existing rows migrated to: product_discount, automatic, every day,
--    all day, all channels, no cap.
-- ============================================
INSERT INTO public.promotions (id, restaurant_id, name, discount_type, discount_value, start_date, end_date) VALUES
  ('36500000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'Legacy 20 %', 'percentage', 20,
   now() - interval '1 day', now() + interval '1 day');
SELECT is((SELECT row(kind, mode, days_of_week, time_windows, channels, max_uses_per_order, buy_quantity, combo_price)::text
             FROM public.promotions WHERE id = '36500000-0000-0000-0000-000000000001'),
          row('product_discount', 'automatic', '{}'::smallint[], '[]'::jsonb, '{}'::text[], NULL::integer, NULL::integer, NULL::numeric)::text,
  'an old-style row is product_discount, automatic, every day, all day, all channels');

-- ============================================
-- 3. Valid rows of each kind
-- ============================================
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, discount_type, discount_value, start_date, end_date, days_of_week, time_windows, channels, max_uses_per_order)
  VALUES ('36500000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'Fixed off', 'product_discount', 'fixed_amount', 2000,
          now() - interval '1 day', NULL, '{1,2,3,4,5}', '[{"from": "12:00", "to": "15:00"}, {"from": "17:00", "to": "19:00"}]', '{dine_in,takeaway}', 2)
$$, 'a product_discount with days, two windows, channels, a cap and no end date is valid');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, buy_quantity, pay_quantity, rest_discount_percent, start_date, days_of_week, time_windows, channels)
  VALUES ('36500000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', 'Happy hour 2x1', 'buy_x_pay_y', 2, 1, 100,
          now() - interval '1 day', '{1,2,3,4,5}', '[{"from": "17:00", "to": "19:00"}]', '{dine_in}')
$$, 'a buy_x_pay_y 2x1 is valid');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, buy_quantity, pay_quantity, rest_discount_percent, start_date)
  VALUES ('36500000-0000-0000-0000-000000000004', '36000000-0000-0000-0000-0000000000a1', 'Segunda al 50 %', 'buy_x_pay_y', 2, 1, 50, now())
$$, 'a buy_x_pay_y "second unit at 50 %" is valid');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, combo_price, start_date)
  VALUES ('36500000-0000-0000-0000-000000000005', '36000000-0000-0000-0000-0000000000a1', 'Menú ejecutivo', 'combo', 24000, now())
$$, 'a combo with a price is valid');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, discount_type, discount_value, min_subtotal, max_discount, start_date, channels)
  VALUES ('36500000-0000-0000-0000-000000000006', '36000000-0000-0000-0000-0000000000a1', '10 % domicilio', 'bill_discount', 'percentage', 10, 80000, 15000, now(), '{delivery}')
$$, 'a bill_discount with a minimum and a cap is valid');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, mode, discount_type, discount_value, start_date, max_uses_per_order)
  VALUES ('36500000-0000-0000-0000-000000000007', '36000000-0000-0000-0000-0000000000a1', 'Cortesía de cumpleaños', 'product_discount', 'manual_pin', 'percentage', 100, now(), 1)
$$, 'a manual_pin promotion is valid');

-- ============================================
-- 4. Rejected rows (23514) leave the table unchanged
-- ============================================
CREATE TEMP TABLE t360_bad (label text, body text) ON COMMIT DROP;
INSERT INTO t360_bad VALUES
  ('an unknown kind', $$kind, discount_type, discount_value) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'bogus', 'percentage', 10$$),
  ('an unknown mode', $$mode, discount_type, discount_value) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'sometimes', 'percentage', 10$$),
  ('a product_discount without discount_value', $$kind, discount_type) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'product_discount', 'percentage'$$),
  ('a product_discount without discount_type', $$kind, discount_value) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'product_discount', 10$$),
  ('a bill_discount without discount_value', $$kind, discount_type) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'bill_discount', 'percentage'$$),
  ('a product_discount with buy quantities', $$kind, discount_type, discount_value, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'product_discount', 'percentage', 10, 2, 1, 100$$),
  ('a product_discount with a min_subtotal', $$kind, discount_type, discount_value, min_subtotal) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'product_discount', 'percentage', 10, 1000$$),
  ('a buy_x_pay_y with N = 1', $$kind, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 1, 0, 100$$),
  ('a buy_x_pay_y with M = N', $$kind, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 2, 2, 100$$),
  ('a buy_x_pay_y with M = 0', $$kind, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 3, 0, 100$$),
  ('a buy_x_pay_y with rest 0 %', $$kind, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 2, 1, 0$$),
  ('a buy_x_pay_y with rest 101 %', $$kind, buy_quantity, pay_quantity, rest_discount_percent) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 2, 1, 101$$),
  ('a buy_x_pay_y with a discount_value', $$kind, buy_quantity, pay_quantity, rest_discount_percent, discount_type, discount_value) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'buy_x_pay_y', 2, 1, 100, 'percentage', 10$$),
  ('a combo without a price', $$kind) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'combo'$$),
  ('a combo with price 0', $$kind, combo_price) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'combo', 0$$),
  ('a bill_discount with max_discount 0', $$kind, discount_type, discount_value, max_discount) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'bill_discount', 'percentage', 10, 0$$),
  ('day 0', $$discount_type, discount_value, days_of_week) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '{0,1}'$$),
  ('day 8', $$discount_type, discount_value, days_of_week) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '{8}'$$),
  ('a NULL day', $$discount_type, discount_value, days_of_week) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '{1,NULL}'$$),
  ('a window with from = to', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "17:00", "to": "17:00"}]'$$),
  ('a window with from > to', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "19:00", "to": "17:00"}]'$$),
  ('a window hour 24:00', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "17:00", "to": "24:00"}]'$$),
  ('a window not HH:MM', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "5pm", "to": "19:00"}]'$$),
  ('a window without to', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "17:00"}]'$$),
  ('a window with an extra key', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '[{"from": "17:00", "to": "19:00", "day": 1}]'$$),
  ('time_windows not an array', $$discount_type, discount_value, time_windows) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '{"from": "17:00", "to": "19:00"}'$$),
  ('an unknown channel', $$discount_type, discount_value, channels) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, '{dine_in,drive_thru}'$$),
  ('max_uses_per_order 0', $$discount_type, discount_value, max_uses_per_order) VALUES ('36000000-0000-0000-0000-0000000000a1', 'n', now(), 'percentage', 10, 0$$);
SELECT throws_ok('INSERT INTO public.promotions (restaurant_id, name, start_date, ' || b.body || ')',
                 '23514', NULL, 'rejects ' || b.label)
  FROM t360_bad b ORDER BY b.label;
SELECT is((SELECT count(*)::int FROM public.promotions WHERE restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 7,
  'the rejected rows left promotions unchanged');

-- ============================================
-- 5. Targets and combo tables: tenant isolation (010 pattern)
-- ============================================
INSERT INTO public.promotions (id, restaurant_id, name, discount_type, discount_value, start_date) VALUES
  ('36500000-0000-0000-0000-0000000000b1', '36000000-0000-0000-0000-0000000000b2', 'Promo B', 'percentage', 10, now());
INSERT INTO public.promotion_categories (restaurant_id, promotion_id, category_id) VALUES
  ('36000000-0000-0000-0000-0000000000b2', '36500000-0000-0000-0000-0000000000b1', '36200000-0000-0000-0000-000000000002');
INSERT INTO public.promotion_subcategories (restaurant_id, promotion_id, subcategory_id) VALUES
  ('36000000-0000-0000-0000-0000000000b2', '36500000-0000-0000-0000-0000000000b1', '36210000-0000-0000-0000-000000000002');
INSERT INTO public.promotion_combo_groups (id, restaurant_id, promotion_id, name) VALUES
  ('36600000-0000-0000-0000-0000000000b1', '36000000-0000-0000-0000-0000000000b2', '36500000-0000-0000-0000-0000000000b1', 'Bebida B');
INSERT INTO public.promotion_combo_options (restaurant_id, group_id, dish_id) VALUES
  ('36000000-0000-0000-0000-0000000000b2', '36600000-0000-0000-0000-0000000000b1', '36300000-0000-0000-0000-000000000004');

SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$
  INSERT INTO public.promotion_categories (promotion_id, category_id)
  VALUES ('36500000-0000-0000-0000-000000000003', '36200000-0000-0000-0000-000000000001');
  INSERT INTO public.promotion_subcategories (promotion_id, subcategory_id)
  VALUES ('36500000-0000-0000-0000-000000000004', '36210000-0000-0000-0000-000000000001');
  INSERT INTO public.promotion_dishes (promotion_id, dish_id)
  VALUES ('36500000-0000-0000-0000-000000000004', '36300000-0000-0000-0000-000000000002');
$$, 'the admin targets dishes, a category and a subcategory of the own restaurant');
SELECT lives_ok($$
  INSERT INTO public.promotion_combo_groups (id, promotion_id, name, position) VALUES
    ('36600000-0000-0000-0000-000000000001', '36500000-0000-0000-0000-000000000005', 'Sopa', 0),
    ('36600000-0000-0000-0000-000000000002', '36500000-0000-0000-0000-000000000005', 'Bebida', 1);
  INSERT INTO public.promotion_combo_options (group_id, dish_id) VALUES
    ('36600000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000003'),
    ('36600000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000001'),
    ('36600000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000002');
$$, 'the admin builds combo groups and options');
SELECT throws_ok($$ INSERT INTO public.promotion_categories (promotion_id, category_id)
                    VALUES ('36500000-0000-0000-0000-000000000003', '36200000-0000-0000-0000-000000000001') $$,
  '23505', NULL, 'a category is targeted once per promotion');
SELECT throws_ok($$ INSERT INTO public.promotion_combo_options (group_id, dish_id)
                    VALUES ('36600000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000003') $$,
  '23505', NULL, 'a dish is an option once per group');
SELECT throws_ok($$ INSERT INTO public.promotion_combo_groups (promotion_id, name)
                    VALUES ('36500000-0000-0000-0000-000000000005', '  ') $$,
  '23514', NULL, 'a combo group needs a name');
SELECT throws_ok($$ INSERT INTO public.promotion_categories (restaurant_id, promotion_id, category_id)
                    VALUES ('36000000-0000-0000-0000-0000000000b2', '36500000-0000-0000-0000-0000000000b1', '36200000-0000-0000-0000-000000000002') $$,
  '42501', NULL, 'a target row of another restaurant is refused by RLS');
SELECT throws_ok($$ INSERT INTO public.promotion_combo_options (restaurant_id, group_id, dish_id)
                    VALUES ('36000000-0000-0000-0000-0000000000b2', '36600000-0000-0000-0000-0000000000b1', '36300000-0000-0000-0000-000000000004') $$,
  '42501', NULL, 'a combo option of another restaurant is refused by RLS');
SELECT throws_ok($$ INSERT INTO public.promotion_categories (promotion_id, category_id)
                    VALUES ('36500000-0000-0000-0000-000000000004', '36200000-0000-0000-0000-000000000002') $$,
  '23503', NULL, 'the own promotion cannot target a category of another restaurant');
SELECT throws_ok($$ INSERT INTO public.promotion_subcategories (promotion_id, subcategory_id)
                    VALUES ('36500000-0000-0000-0000-000000000003', '36210000-0000-0000-0000-000000000002') $$,
  '23503', NULL, 'the own promotion cannot target a subcategory of another restaurant');
SELECT throws_ok($$ INSERT INTO public.promotion_combo_options (group_id, dish_id)
                    VALUES ('36600000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000004') $$,
  '23503', NULL, 'a combo option cannot be a dish of another restaurant');
SELECT is((SELECT array[(SELECT count(*) FROM public.promotion_categories), (SELECT count(*) FROM public.promotion_subcategories),
                        (SELECT count(*) FROM public.promotion_combo_groups), (SELECT count(*) FROM public.promotion_combo_options)]::int[]),
          ARRAY[1, 1, 2, 3], 'the admin sees only the own targets, groups and options');
UPDATE public.promotion_combo_groups SET name = 'hacked' WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
DELETE FROM public.promotion_categories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
DELETE FROM public.promotion_subcategories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
DELETE FROM public.promotion_combo_options WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
RESET ROLE;
SELECT is((SELECT array[(SELECT count(*) FROM public.promotion_categories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2'),
                        (SELECT count(*) FROM public.promotion_subcategories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2'),
                        (SELECT count(*) FROM public.promotion_combo_groups WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2' AND name = 'Bebida B'),
                        (SELECT count(*) FROM public.promotion_combo_options WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2')]::int[]),
          ARRAY[1, 1, 1, 1], 'filtered UPDATE/DELETE did not touch the other restaurant');

-- ============================================
-- 6. order_discounts: checks and isolation
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('36700000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0, 10, 0),
  ('36700000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0, 10, 0),
  ('36700000-0000-0000-0000-0000000000b1', '36000000-0000-0000-0000-0000000000b2', 'kitchen', 0, 0, 8, 0, 10, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, promotion_id, promotion_snapshot) VALUES
  ('36800000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 2,
   '36500000-0000-0000-0000-000000000003', '{"kind": "buy_x_pay_y", "buyQuantity": 2, "payQuantity": 1}'),
  ('36800000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000002', 'Margarita', 26000, 1, NULL, NULL),
  ('36800000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 1, NULL, NULL),
  ('36800000-0000-0000-0000-000000000004', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000002', 'Margarita', 26000, 2,
   '36500000-0000-0000-0000-000000000004', '{"kind": "buy_x_pay_y"}'),
  ('36800000-0000-0000-0000-0000000000b1', '36000000-0000-0000-0000-0000000000b2', '36700000-0000-0000-0000-0000000000b1', '36300000-0000-0000-0000-000000000004', 'Mojito B', 24000, 1, NULL, NULL);
INSERT INTO public.order_discounts (restaurant_id, order_id, order_item_id, kind, source, label, amount) VALUES
  ('36000000-0000-0000-0000-0000000000b2', '36700000-0000-0000-0000-0000000000b1', '36800000-0000-0000-0000-0000000000b1', 'promotion_item', 'automatic', 'Promo B', 2400);

SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$
  INSERT INTO public.order_discounts (id, order_id, order_item_id, promotion_id, kind, source, label, amount)
  VALUES ('36900000-0000-0000-0000-000000000001', '36700000-0000-0000-0000-000000000001', '36800000-0000-0000-0000-000000000001',
          '36500000-0000-0000-0000-000000000003', 'promotion_item', 'automatic', 'Happy hour 2x1', 24000)
$$, 'the cashier records a promotion discount on a line');
SELECT is((SELECT array[requires_authorization::text, coalesce(line_quantity::text, 'null')] FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000001'),
          ARRAY['true', 'null'], 'a row written without them needs an authorization to be removed and has no line quantity');
CREATE TEMP TABLE t360_bad_discounts (label text, cols text, vals text) ON COMMIT DROP;
INSERT INTO t360_bad_discounts VALUES
  ('an amount of 0', 'kind, source, label, amount', $$'manual_bill', 'manual', 'x', 0$$),
  ('a negative amount', 'kind, source, label, amount, reason', $$'manual_bill', 'manual', 'x', -100, 'Cliente frecuente'$$),
  ('an amount with cents', 'kind, source, label, amount, reason', $$'manual_bill', 'manual', 'x', 100.50, 'Cliente frecuente'$$),
  ('a manual discount without a reason', 'kind, source, label, amount', $$'manual_bill', 'manual', 'Cortesía', 1000$$),
  ('a manual reason under 3 characters', 'kind, source, label, amount, reason', $$'manual_bill', 'manual', 'Cortesía', 1000, ' ok '$$),
  ('a manual reason over 200 characters', 'kind, source, label, amount, reason', $$'manual_bill', 'manual', 'Cortesía', 1000, repeat('a', 201)$$),
  ('an automatic discount with a reason', 'kind, source, label, amount, reason', $$'promotion_bill', 'automatic', 'x', 1000, 'porque sí'$$),
  ('a manual kind marked automatic', 'kind, source, label, amount', $$'manual_bill', 'automatic', 'x', 1000$$),
  ('a combo marked manual', 'kind, source, label, amount, combo_id, reason', $$'combo', 'manual', 'x', 1000, gen_random_uuid(), 'porque sí'$$),
  ('an item discount without a line', 'kind, source, label, amount', $$'promotion_item', 'automatic', 'x', 1000$$),
  ('a bill discount on a line', 'kind, source, label, amount, order_item_id', $$'promotion_bill', 'automatic', 'x', 1000, '36800000-0000-0000-0000-000000000002'$$),
  ('a combo without combo_id', 'kind, source, label, amount', $$'combo', 'automatic', 'x', 1000$$),
  ('an unknown kind', 'kind, source, label, amount', $$'coupon', 'automatic', 'x', 1000$$),
  ('an empty label', 'kind, source, label, amount', $$'promotion_bill', 'automatic', '  ', 1000$$),
  ('a line quantity of 0', 'kind, source, label, amount, order_item_id, reason, line_quantity', $$'manual_item', 'manual', 'x', 1000, '36800000-0000-0000-0000-000000000002', 'Cliente frecuente', 0$$);
SELECT throws_ok(format('INSERT INTO public.order_discounts (order_id, %s) VALUES (%L, %s)',
                        b.cols, '36700000-0000-0000-0000-000000000001', b.vals),
                 '23514', NULL, 'order_discounts rejects ' || b.label)
  FROM t360_bad_discounts b ORDER BY b.label;
SELECT is((SELECT count(*)::int FROM public.order_discounts), 1, 'the rejected discounts left order_discounts unchanged');
SELECT throws_ok($$ INSERT INTO public.order_discounts (restaurant_id, order_id, kind, source, label, amount)
                    VALUES ('36000000-0000-0000-0000-0000000000b2', '36700000-0000-0000-0000-0000000000b1', 'promotion_bill', 'automatic', 'x', 1000) $$,
  '42501', NULL, 'a discount of another restaurant is refused by RLS');
SELECT throws_ok($$ INSERT INTO public.order_discounts (order_id, order_item_id, kind, source, label, amount)
                    VALUES ('36700000-0000-0000-0000-000000000001', '36800000-0000-0000-0000-0000000000b1', 'promotion_item', 'automatic', 'x', 1000) $$,
  '23503', NULL, 'a discount cannot point at a line of another restaurant');
SELECT throws_ok($$ INSERT INTO public.order_discounts (order_id, kind, source, label, amount, reason, authorized_by)
                    VALUES ('36700000-0000-0000-0000-000000000001', 'manual_bill', 'manual', 'x', 1000, 'Cliente frecuente', '36100000-0000-0000-0000-000000000003') $$,
  '23503', NULL, 'the authorizer is a profile of the same restaurant');
UPDATE public.order_discounts SET amount = 1 WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
DELETE FROM public.order_discounts WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2';
RESET ROLE;
SELECT is((SELECT amount FROM public.order_discounts WHERE restaurant_id = '36000000-0000-0000-0000-0000000000b2'), 2400.00,
  'the cashier neither sees, updates nor deletes the other restaurant''s discounts');

-- ============================================
-- 7. The bill: subtotal = gross - discounts, tax and tip on the net
-- ============================================
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
DO $$ BEGIN PERFORM private.recompute_caller_order_bill('36700000-0000-0000-0000-000000000001'); END $$;
RESET ROLE;
SELECT is((SELECT array[subtotal, total_discounts, tax, tip, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[50000, 24000, 4000, 5000, 59000]::numeric[],
  'gross 74000 - 24000 = subtotal 50000; tax 8 % and tip 10 % of the net; total 59000');
SELECT is((SELECT subtotal + total_discounts FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'), 74000.00,
  'subtotal + total_discounts is the gross at list prices');

SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$
  INSERT INTO public.order_discounts (id, order_id, kind, source, label, amount, reason, created_by, authorized_by)
  VALUES ('36900000-0000-0000-0000-000000000002', '36700000-0000-0000-0000-000000000001', 'manual_bill', 'manual', 'Descuento libre', 5000,
          '  Cliente frecuente  ', '36100000-0000-0000-0000-000000000002', '36100000-0000-0000-0000-000000000001')
$$, 'a manual bill discount with a reason, author and authorizer is valid');
DO $$ BEGIN PERFORM private.recompute_caller_order_bill('36700000-0000-0000-0000-000000000001'); END $$;
RESET ROLE;
SELECT is((SELECT array[subtotal, total_discounts, tax, tip, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[45000, 29000, 3600, 4500, 53100]::numeric[], 'item and bill discounts both lower the subtotal');

-- A voided line (quantity 0, cancelled, as void_order_items leaves it) drops its discounts.
UPDATE public.order_items SET quantity = 0, status = 'cancelled' WHERE id = '36800000-0000-0000-0000-000000000001';
DO $$ BEGIN PERFORM private.recompute_order_bill('36700000-0000-0000-0000-000000000001'); END $$;
SELECT is((SELECT array[subtotal, total_discounts, tax, tip, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[21000, 5000, 1680, 2100, 24780]::numeric[], 'the discounts of a cancelled line are ignored');

-- The discounts never take the subtotal below 0.
INSERT INTO public.order_discounts (id, restaurant_id, order_id, kind, source, label, amount, reason) VALUES
  ('36900000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000001', 'manual_bill', 'manual', 'Todo', 99999, 'Prueba de tope');
DO $$ BEGIN PERFORM private.recompute_order_bill('36700000-0000-0000-0000-000000000001'); END $$;
SELECT is((SELECT array[subtotal, total_discounts, tax, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[0, 26000, 0, 0]::numeric[], 'the discounts are capped at the gross: subtotal 0');
DELETE FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000003';

-- pay_order charges the net base.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((public.pay_order('36700000-0000-0000-0000-000000000001', '36400000-0000-0000-0000-000000000001', 0,
            jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash'),
                                                 'amount', 22680, 'cash_received', 22680)),
            '36a00000-0000-0000-0000-000000000001')->>'amount_due')::bigint,
          22680::bigint, 'pay_order charges (gross - discounts) + tax: 21000 + 1680');
RESET ROLE;
SELECT is((SELECT array[subtotal, total_discounts, tax, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[21000, 5000, 1680, 22680]::numeric[], 'the paid order keeps the net subtotal and its total_discounts');

-- ============================================
-- 8. split_order / undo_split move the item discounts
-- ============================================
INSERT INTO public.order_discounts (id, restaurant_id, order_id, order_item_id, promotion_id, kind, source, label, amount, reason) VALUES
  ('36900000-0000-0000-0000-000000000011', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000002', '36800000-0000-0000-0000-000000000003', NULL, 'manual_item', 'manual', 'Cortesía', 12000, 'Cumpleaños'),
  ('36900000-0000-0000-0000-000000000012', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000002', '36800000-0000-0000-0000-000000000004', '36500000-0000-0000-0000-000000000004', 'promotion_item', 'automatic', 'Segunda al 50 %', 5000, NULL),
  ('36900000-0000-0000-0000-000000000013', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000002', NULL, NULL, 'manual_bill', 'manual', 'Descuento libre', 2000, 'Cliente frecuente');
UPDATE public.order_discounts SET line_quantity = 2, requires_authorization = false WHERE id = '36900000-0000-0000-0000-000000000012';
CREATE TEMP TABLE t360 (key text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t360 TO vipe_api;
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
INSERT INTO t360
SELECT 'child', (public.split_order('36700000-0000-0000-0000-000000000002',
  '[{"order_item_id": "36800000-0000-0000-0000-000000000003", "quantity": 1},
    {"order_item_id": "36800000-0000-0000-0000-000000000004", "quantity": 1}]'::jsonb)->>'child_order_id')::uuid;
RESET ROLE;
SELECT is((SELECT order_id FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000011'), (SELECT id FROM t360 WHERE key = 'child'),
  'a line moved whole takes its discount to the child order');
SELECT is((SELECT array[order_id::text, order_item_id::text, amount::text] FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000012'),
          ARRAY['36700000-0000-0000-0000-000000000002', '36800000-0000-0000-0000-000000000004', '2500.00'],
  'a line split in part keeps the remainder of its discount on the parent line');
SELECT is((SELECT array_agg(row(d.promotion_id, d.kind, d.label, d.amount)::text) FROM public.order_discounts d
             JOIN public.order_items oi ON oi.id = d.order_item_id
            WHERE d.order_id = (SELECT id FROM t360 WHERE key = 'child') AND oi.dish_id = '36300000-0000-0000-0000-000000000002'),
          ARRAY[row('36500000-0000-0000-0000-000000000004'::uuid, 'promotion_item', 'Segunda al 50 %', 2500.00)::text],
  'the split part of a line takes its share of the discount');
SELECT is((SELECT array[line_quantity::text, requires_authorization::text] FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000012'),
          ARRAY['1', 'false'], 'the parent share keeps the line quantity of the units left');
SELECT is((SELECT array_agg(array[d.line_quantity::text, d.requires_authorization::text]) FROM public.order_discounts d
             JOIN public.order_items oi ON oi.id = d.order_item_id
            WHERE d.order_id = (SELECT id FROM t360 WHERE key = 'child') AND oi.dish_id = '36300000-0000-0000-0000-000000000002'),
          ARRAY[ARRAY['1', 'false']], 'the child share has the moved quantity and keeps requires_authorization');
SELECT is((SELECT order_id FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000013'), '36700000-0000-0000-0000-000000000002'::uuid,
  'a bill discount stays on the original order');
SELECT is((SELECT row(promotion_id, promotion_snapshot, combo_id)::text FROM public.order_items
            WHERE order_id = (SELECT id FROM t360 WHERE key = 'child') AND dish_id = '36300000-0000-0000-0000-000000000002'),
          row('36500000-0000-0000-0000-000000000004'::uuid, '{"kind": "buy_x_pay_y"}'::jsonb, NULL::uuid)::text,
  'the split part of a line keeps its promotion and snapshot');
SELECT is((SELECT array[subtotal, total_discounts] FROM public.orders WHERE id = (SELECT id FROM t360 WHERE key = 'child')),
          ARRAY[35500, 14500]::numeric[], 'the child bill: 24000 + 26000 - 12000 - 2500');
SELECT is((SELECT array[subtotal, total_discounts] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000002'),
          ARRAY[21500, 4500]::numeric[], 'the parent bill: 26000 - 2500 - 2000');

-- A discount on the child's split line follows it when undo_split merges it back.
INSERT INTO public.order_discounts (id, restaurant_id, order_id, order_item_id, kind, source, label, amount, reason)
SELECT '36900000-0000-0000-0000-000000000014', '36000000-0000-0000-0000-0000000000a1', oi.order_id, oi.id, 'manual_item', 'manual', 'Cortesía', 1000, 'Demora'
  FROM public.order_items oi
 WHERE oi.order_id = (SELECT id FROM t360 WHERE key = 'child') AND oi.dish_id = '36300000-0000-0000-0000-000000000002';
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT public.undo_split((SELECT id FROM t360 WHERE key = 'child')) $$, 'undo_split runs');
RESET ROLE;
SELECT is((SELECT array_agg(row(id, order_id, order_item_id)::text ORDER BY id) FROM public.order_discounts
            WHERE id IN ('36900000-0000-0000-0000-000000000011', '36900000-0000-0000-0000-000000000014')),
          ARRAY[row('36900000-0000-0000-0000-000000000011'::uuid, '36700000-0000-0000-0000-000000000002'::uuid, '36800000-0000-0000-0000-000000000003'::uuid)::text,
                row('36900000-0000-0000-0000-000000000014'::uuid, '36700000-0000-0000-0000-000000000002'::uuid, '36800000-0000-0000-0000-000000000004'::uuid)::text],
  'undo_split brings the moved discount back and moves the merged line''s discount to the line it joins');
SELECT is((SELECT array[subtotal, total_discounts] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000002'),
          ARRAY[56000, 20000]::numeric[], 'the merged bill: 24000 + 52000 - 20000');

-- ============================================
-- 9. Deleting a promotion keeps the history
-- ============================================
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
DELETE FROM public.promotions WHERE id IN ('36500000-0000-0000-0000-000000000003', '36500000-0000-0000-0000-000000000004');
RESET ROLE;
SELECT is((SELECT array[promotion_id::text, label] FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000012'),
          ARRAY[NULL, 'Segunda al 50 %'], 'a deleted promotion leaves its discounts with their label');
SELECT is((SELECT count(*)::int FROM public.order_items WHERE promotion_id IS NOT NULL AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 0,
  'a deleted promotion is cleared from the lines (their snapshot stays)');
SELECT is((SELECT count(*)::int FROM public.promotion_categories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000a1')
        + (SELECT count(*)::int FROM public.promotion_subcategories WHERE restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 0,
  'its targets are deleted with it');

-- ============================================
-- 10. Corrections D1-D6
-- ============================================
-- D1: CHECK helpers run as the inserting role, so vipe_api must execute them.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, discount_type, discount_value, start_date)
  VALUES ('36b00000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'API legacy', 'percentage', 10, now())
$$, 'vipe_api inserts an old-style promotion');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, buy_quantity, pay_quantity, rest_discount_percent, start_date,
                                 days_of_week, time_windows, channels)
  VALUES ('36b00000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'API 2x1', 'buy_x_pay_y', 2, 1, 100, now(),
          '{1,2,3,4,5}', '[{"from": "17:00", "to": "19:00"}]', '{dine_in,delivery}')
$$, 'vipe_api inserts a promotion with days, time windows and channels');
SELECT lives_ok($$
  INSERT INTO public.promotions (id, restaurant_id, name, kind, combo_price, start_date)
  VALUES ('36b00000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', 'API combo', 'combo', 20000, now());
  INSERT INTO public.promotion_categories (promotion_id, category_id)
  VALUES ('36b00000-0000-0000-0000-000000000002', '36200000-0000-0000-0000-000000000001');
  INSERT INTO public.promotion_subcategories (promotion_id, subcategory_id)
  VALUES ('36b00000-0000-0000-0000-000000000002', '36210000-0000-0000-0000-000000000001');
  INSERT INTO public.promotion_combo_groups (id, promotion_id, name)
  VALUES ('36b10000-0000-0000-0000-000000000001', '36b00000-0000-0000-0000-000000000003', 'Sopa');
  INSERT INTO public.promotion_combo_options (group_id, dish_id)
  VALUES ('36b10000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000003');
  INSERT INTO public.order_discounts (order_id, kind, source, label, amount, reason)
  VALUES ('36700000-0000-0000-0000-000000000002', 'manual_bill', 'manual', 'API', 100, 'Prueba API');
$$, 'vipe_api inserts into every new table');
RESET ROLE;
DELETE FROM public.order_discounts WHERE order_id = '36700000-0000-0000-0000-000000000002' AND label = 'API';

-- Fixtures of D2-D6.
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('36c00000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000004', '36000000-0000-0000-0000-0000000000a1', 'cancelled', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000005', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000006', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, combo_id) VALUES
  -- D2: 3 x 6000 with a 15000 discount.
  ('36c10000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000001', '36300000-0000-0000-0000-000000000003', 'Sopa', 6000, 3, NULL),
  -- D4 voids: combo K1 (9000 + 24000, discount 9000) and a 30000 line.
  ('36c10000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000003', 'Sopa', 9000, 1, '36c20000-0000-0000-0000-000000000001'),
  ('36c10000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 1, '36c20000-0000-0000-0000-000000000001'),
  ('36c10000-0000-0000-0000-000000000004', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000002', '36300000-0000-0000-0000-000000000002', 'Margarita', 30000, 1, NULL),
  -- D4 splits and D5: combo K2 (9000 + 24000, discount 9000) and a 26000 line.
  ('36c10000-0000-0000-0000-000000000005', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000003', '36300000-0000-0000-0000-000000000003', 'Sopa', 9000, 1, '36c20000-0000-0000-0000-000000000002'),
  ('36c10000-0000-0000-0000-000000000006', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000003', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 1, '36c20000-0000-0000-0000-000000000002'),
  ('36c10000-0000-0000-0000-000000000007', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000003', '36300000-0000-0000-0000-000000000002', 'Margarita', 26000, 1, NULL),
  -- D6: a 9000 line fully discounted, and a 9000 line with 8 % tax.
  ('36c10000-0000-0000-0000-000000000008', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000005', '36300000-0000-0000-0000-000000000003', 'Sopa', 9000, 1, NULL),
  ('36c10000-0000-0000-0000-000000000009', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000006', '36300000-0000-0000-0000-000000000003', 'Sopa', 9000, 1, NULL);
INSERT INTO public.order_discounts (id, restaurant_id, order_id, order_item_id, kind, source, label, amount, combo_id, reason) VALUES
  ('36c30000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000001', '36c10000-0000-0000-0000-000000000001', 'promotion_item', 'automatic', 'Sopa 2x1', 15000, NULL, NULL),
  ('36c30000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000002', NULL, 'combo', 'automatic', 'Menú', 9000, '36c20000-0000-0000-0000-000000000001', NULL),
  ('36c30000-0000-0000-0000-000000000003', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000003', NULL, 'combo', 'automatic', 'Menú', 9000, '36c20000-0000-0000-0000-000000000002', NULL),
  ('36c30000-0000-0000-0000-000000000005', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000005', NULL, 'manual_bill', 'manual', 'Cortesía de cumpleaños', 9000, NULL, 'Cumpleaños');

-- D2: a partial split shares the line's item discount by the units moved.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
INSERT INTO t360
SELECT 'd2', (public.split_order('36c00000-0000-0000-0000-000000000001',
  '[{"order_item_id": "36c10000-0000-0000-0000-000000000001", "quantity": 2}]'::jsonb)->>'child_order_id')::uuid;
RESET ROLE;
SELECT is((SELECT array_agg(s.amount::text ORDER BY s.side) FROM (
             SELECT CASE WHEN d.order_id = '36c00000-0000-0000-0000-000000000001' THEN 'parent' ELSE 'child' END AS side,
                    sum(d.amount) AS amount, max(round(oi.price * oi.quantity)) AS line_value
               FROM public.order_discounts d JOIN public.order_items oi ON oi.id = d.order_item_id
              WHERE d.order_id IN ('36c00000-0000-0000-0000-000000000001', (SELECT id FROM t360 WHERE key = 'd2'))
              GROUP BY 1 HAVING sum(d.amount) <= max(round(oi.price * oi.quantity))) s),
          ARRAY['10000.00', '5000.00'],
  'D2: moving 2 of 3 units moves 10000 of the 15000 discount; each side within its line value');
SELECT is((SELECT array[(SELECT subtotal FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000001'),
                        (SELECT subtotal FROM public.orders WHERE id = (SELECT id FROM t360 WHERE key = 'd2'))]),
          ARRAY[1000, 2000]::numeric[], 'D2: the parent bill is 6000 - 5000 and the child 12000 - 10000');

-- D3: no discount change on a paid or cancelled order; recompute leaves them alone.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$
  INSERT INTO public.order_discounts (order_id, kind, source, label, amount, reason)
  VALUES ('36700000-0000-0000-0000-000000000001', 'manual_bill', 'manual', 'Tarde', 1000, 'Después de pagar')
$$, '42501', NULL, 'D3: a discount cannot be added to a paid order');
SELECT throws_ok($$ UPDATE public.order_discounts SET amount = 1 WHERE id = '36900000-0000-0000-0000-000000000002' $$,
  '42501', NULL, 'D3: a discount of a paid order cannot be changed');
SELECT throws_ok($$ DELETE FROM public.order_discounts WHERE id = '36900000-0000-0000-0000-000000000002' $$,
  '42501', NULL, 'D3: a discount of a paid order cannot be deleted');
SELECT throws_ok($$
  INSERT INTO public.order_discounts (order_id, kind, source, label, amount, reason)
  VALUES ('36c00000-0000-0000-0000-000000000004', 'manual_bill', 'manual', 'Tarde', 1000, 'Después de anular')
$$, '42501', NULL, 'D3: a discount cannot be added to a cancelled order');
RESET ROLE;
INSERT INTO public.order_discounts (id, restaurant_id, order_id, kind, source, label, amount, reason) VALUES
  ('36c30000-0000-0000-0000-000000000009', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000001', 'manual_bill', 'manual', 'Migración', 1000, 'Fila directa');
SET LOCAL ROLE vipe_api;
DO $$ BEGIN PERFORM private.recompute_caller_order_bill('36700000-0000-0000-0000-000000000001'); END $$;
RESET ROLE;
DELETE FROM public.order_discounts WHERE id = '36c30000-0000-0000-0000-000000000009';
SELECT is((SELECT array[subtotal, total_discounts, tax, total] FROM public.orders WHERE id = '36700000-0000-0000-0000-000000000001'),
          ARRAY[21000, 5000, 1680, 22680]::numeric[], 'D3: the paid order row is unchanged (recompute does not rewrite it)');

-- D4: a combo row stops counting once its lines are voided.
DO $$ BEGIN PERFORM private.recompute_order_bill('36c00000-0000-0000-0000-000000000002'); END $$;
SELECT is((SELECT subtotal FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000002'), 54000.00,
  'D4: the combo discount counts while its lines stand: 9000 + 24000 + 30000 - 9000');
UPDATE public.order_items SET quantity = 0, status = 'cancelled'
 WHERE id IN ('36c10000-0000-0000-0000-000000000002', '36c10000-0000-0000-0000-000000000003');
DO $$ BEGIN PERFORM private.recompute_order_bill('36c00000-0000-0000-0000-000000000002'); END $$;
SELECT is((SELECT array[subtotal, total_discounts] FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000002'),
          ARRAY[30000, 0]::numeric[], 'D4: after voiding the combo lines the subtotal is the remaining line');

-- D4: split keeps a combo whole; D5: undo_split keeps the child's manual bill discount.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT public.split_order('36c00000-0000-0000-0000-000000000003',
  '[{"order_item_id": "36c10000-0000-0000-0000-000000000005", "quantity": 1}]'::jsonb) $$,
  'P0001', 'split_order: item[1] is part of a combo; move every line of the combo together',
  'D4: a split cannot separate the components of a combo');
INSERT INTO t360
SELECT 'd4', (public.split_order('36c00000-0000-0000-0000-000000000003',
  '[{"order_item_id": "36c10000-0000-0000-0000-000000000005", "quantity": 1},
    {"order_item_id": "36c10000-0000-0000-0000-000000000006", "quantity": 1}]'::jsonb)->>'child_order_id')::uuid;
RESET ROLE;
SELECT is((SELECT order_id FROM public.order_discounts WHERE id = '36c30000-0000-0000-0000-000000000003'), (SELECT id FROM t360 WHERE key = 'd4'),
  'D4: the combo row moves with its lines');
SELECT is((SELECT array[(SELECT subtotal FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000003'),
                        (SELECT subtotal FROM public.orders WHERE id = (SELECT id FROM t360 WHERE key = 'd4'))]),
          ARRAY[26000, 24000]::numeric[], 'D4: parent 26000, child 9000 + 24000 - 9000');
INSERT INTO public.order_discounts (id, restaurant_id, order_id, kind, source, label, amount, reason)
SELECT '36c30000-0000-0000-0000-000000000006', '36000000-0000-0000-0000-0000000000a1', id, 'manual_bill', 'manual', 'Descuento libre', 1000, 'Demora'
  FROM t360 WHERE key = 'd4';
INSERT INTO public.order_discounts (id, restaurant_id, order_id, kind, source, label, amount)
SELECT '36c30000-0000-0000-0000-000000000007', '36000000-0000-0000-0000-0000000000a1', id, 'promotion_bill', 'automatic', '10 %', 2000
  FROM t360 WHERE key = 'd4';
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT public.undo_split((SELECT id FROM t360 WHERE key = 'd4')) $$, 'D4/D5: undo_split of the combo split runs');
RESET ROLE;
SELECT is((SELECT array_agg(row(id, order_id)::text ORDER BY id) FROM public.order_discounts
            WHERE id IN ('36c30000-0000-0000-0000-000000000003', '36c30000-0000-0000-0000-000000000006', '36c30000-0000-0000-0000-000000000007')),
          ARRAY[row('36c30000-0000-0000-0000-000000000003'::uuid, '36c00000-0000-0000-0000-000000000003'::uuid)::text,
                row('36c30000-0000-0000-0000-000000000006'::uuid, '36c00000-0000-0000-0000-000000000003'::uuid)::text],
  'D4/D5: undo_split brings the combo row and the child''s manual bill discount back; the automatic bill row is dropped');
SELECT is((SELECT subtotal FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000003'), 49000.00,
  'D4/D5: the merged bill: 9000 + 24000 + 26000 - 9000 - 1000');

-- D6: a fully discounted order closes with a single 0 cash tender.
DO $$ BEGIN PERFORM private.recompute_order_bill('36c00000-0000-0000-0000-000000000005'); END $$;
DO $$ BEGIN PERFORM private.recompute_order_bill('36c00000-0000-0000-0000-000000000006'); END $$;
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000005', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'),
                                       'amount', 1, 'cash_received', 1)), '36a00000-0000-0000-0000-000000000005') $$,
  'P0001', 'pay_order: tenders sum to 1 but amount_due + tip = 0', 'D6: a zero order still rejects a non-zero tender');
SELECT is((public.pay_order('36c00000-0000-0000-0000-000000000005', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'),
                                       'amount', 0, 'cash_received', 0)), '36a00000-0000-0000-0000-000000000006')->>'status'),
  'paid', 'D6: a fully discounted order closes with a single 0 cash tender');
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000006', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'),
                                       'amount', 0, 'cash_received', 0)), '36a00000-0000-0000-0000-000000000007') $$,
  '22023', 'pay_order: tender[1].amount must be a positive integer', 'D6: a 0 tender on an order with amount due fails as before');
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000006', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'),
                                       'amount', 1000, 'cash_received', 1000)), '36a00000-0000-0000-0000-000000000008') $$,
  'P0001', 'pay_order: tenders sum to 1000 but amount_due + tip = 9720', 'D6: mismatching tenders on a non-zero order fail as before');
RESET ROLE;
SELECT lives_ok('SET CONSTRAINTS ALL IMMEDIATE', 'D6: the zero payment passes the deferred payment consistency check');
SELECT is((SELECT array[p.amount_due, p.total_charged, (SELECT count(*) FROM public.payment_tenders t WHERE t.payment_id = p.id)]::numeric[]
             FROM public.payments p WHERE p.order_id = '36c00000-0000-0000-0000-000000000005'),
          ARRAY[0, 0, 1]::numeric[], 'D6: the zero payment has one 0 tender');
SELECT is((SELECT status FROM public.orders WHERE id = '36c00000-0000-0000-0000-000000000005'), 'paid', 'D6: the zero order is paid');

-- ============================================
-- 11. Re-verification advisories and regressions
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('36c00000-0000-0000-0000-000000000007', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000008', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('36c00000-0000-0000-0000-000000000009', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity) VALUES
  ('36c10000-0000-0000-0000-00000000000a', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000008', '36300000-0000-0000-0000-000000000003', 'Sopa', 4500, 2),
  ('36c10000-0000-0000-0000-00000000000b', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000009', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 3),
  ('36c10000-0000-0000-0000-00000000000c', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000007', '36300000-0000-0000-0000-000000000003', 'Sopa', 9000, 1);
INSERT INTO public.order_discounts (id, restaurant_id, order_id, order_item_id, kind, source, label, amount, reason) VALUES
  ('36c30000-0000-0000-0000-000000000010', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000008', '36c10000-0000-0000-0000-00000000000a', 'promotion_item', 'automatic', 'Sopa 2x1', 4501, NULL),
  ('36c30000-0000-0000-0000-000000000011', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000008', '36c10000-0000-0000-0000-00000000000a', 'manual_item', 'manual', 'Cortesía', 4499, 'Demora'),
  ('36c30000-0000-0000-0000-000000000012', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000009', '36c10000-0000-0000-0000-00000000000b', 'promotion_item', 'automatic', '3x2', 24000, NULL),
  ('36c30000-0000-0000-0000-000000000013', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000007', NULL, 'manual_bill', 'manual', 'Cortesía', 9000, 'Cumpleaños'),
  ('36c30000-0000-0000-0000-000000000014', '36000000-0000-0000-0000-0000000000a1', '36c00000-0000-0000-0000-000000000004', NULL, 'manual_bill', 'manual', 'Antigua', 1000, 'Antes de anular');
DO $$ BEGIN PERFORM private.recompute_order_bill('36c00000-0000-0000-0000-000000000007'); END $$;

-- Advisory A: several rows on one line never push either side over its line value.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
INSERT INTO t360
SELECT 'a1', (public.split_order('36c00000-0000-0000-0000-000000000008',
  '[{"order_item_id": "36c10000-0000-0000-0000-00000000000a", "quantity": 1}]'::jsonb)->>'child_order_id')::uuid;
INSERT INTO t360
SELECT 'a2', (public.split_order('36c00000-0000-0000-0000-000000000009',
  '[{"order_item_id": "36c10000-0000-0000-0000-00000000000b", "quantity": 1}]'::jsonb)->>'child_order_id')::uuid;
RESET ROLE;
SELECT is((SELECT array[(SELECT sum(amount) FROM public.order_discounts WHERE order_id = (SELECT id FROM t360 WHERE key = 'a1')),
                        (SELECT sum(amount) FROM public.order_discounts WHERE order_id = '36c00000-0000-0000-0000-000000000008')]),
          ARRAY[4500, 4500]::numeric[],
  'A: rows 4501 + 4499 on 2 x 4500, move 1: each side gets exactly its 4500 line value');
SELECT is((SELECT array[(SELECT sum(amount) FROM public.order_discounts WHERE order_id = (SELECT id FROM t360 WHERE key = 'a2')),
                        (SELECT sum(amount) FROM public.order_discounts WHERE order_id = '36c00000-0000-0000-0000-000000000009')]),
          ARRAY[8000, 16000]::numeric[],
  'A: 3 x 24000 with 24000 off, move 1: child 8000, parent 16000');

-- D1: vipe_api updates time windows; a bad window is still rejected.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ UPDATE public.promotions SET time_windows = '[{"from": "12:00", "to": "14:00"}]'
                    WHERE id = '36b00000-0000-0000-0000-000000000002' $$,
  'D1: vipe_api updates time_windows');
SELECT throws_ok($$ UPDATE public.promotions SET time_windows = '[{"from": "14:00", "to": "12:00"}]'
                     WHERE id = '36b00000-0000-0000-0000-000000000002' $$,
  '23514', NULL, 'D1: an update to a bad window raises 23514');

-- D3: a cancelled order's discounts are frozen in every direction.
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ UPDATE public.order_discounts SET amount = 1 WHERE id = '36c30000-0000-0000-0000-000000000014' $$,
  '42501', NULL, 'D3: a discount of a cancelled order cannot be changed');
SELECT throws_ok($$ DELETE FROM public.order_discounts WHERE id = '36c30000-0000-0000-0000-000000000014' $$,
  '42501', NULL, 'D3: a discount of a cancelled order cannot be deleted');
SELECT throws_ok($$ UPDATE public.order_discounts SET order_id = '36c00000-0000-0000-0000-000000000004'
                     WHERE id = '36c30000-0000-0000-0000-000000000013' $$,
  '42501', NULL, 'D3: a discount cannot be moved into a cancelled order');
SELECT throws_ok($$ UPDATE public.order_discounts SET order_id = '36c00000-0000-0000-0000-000000000007'
                     WHERE id = '36c30000-0000-0000-0000-000000000014' $$,
  '42501', NULL, 'D3: a discount cannot be moved out of a cancelled order');
RESET ROLE;

-- D4: a rejected partial combo split changes nothing.
CREATE TEMP TABLE t360_md5 ON COMMIT DROP AS
SELECT md5(coalesce((SELECT string_agg(oi::text, ',' ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = '36c00000-0000-0000-0000-000000000003'), '')
        || '|' || coalesce((SELECT string_agg(d::text, ',' ORDER BY d.id) FROM public.order_discounts d WHERE d.order_id = '36c00000-0000-0000-0000-000000000003'), '')) AS h;
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT public.split_order('36c00000-0000-0000-0000-000000000003',
  '[{"order_item_id": "36c10000-0000-0000-0000-000000000006", "quantity": 1}]'::jsonb) $$,
  'P0001', NULL, 'D4: a partial combo split is rejected');
RESET ROLE;
SELECT is(md5(coalesce((SELECT string_agg(oi::text, ',' ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = '36c00000-0000-0000-0000-000000000003'), '')
        || '|' || coalesce((SELECT string_agg(d::text, ',' ORDER BY d.id) FROM public.order_discounts d WHERE d.order_id = '36c00000-0000-0000-0000-000000000003'), '')),
          (SELECT h FROM t360_md5), 'D4: the rejected split left the lines and discounts unchanged');

-- D6 / advisory B: only one 0 cash tender with no tip and no cash taken closes a free order.
-- The D6 check above made the deferred payment checks immediate; defer them again.
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000007', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0, 'cash_received', 0),
                    jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0, 'cash_received', 0)),
  '36a00000-0000-0000-0000-000000000011') $$,
  '22023', NULL, 'D6: two 0 tenders are rejected');
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000007', '36400000-0000-0000-0000-000000000001', 1000,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0, 'cash_received', 0)),
  '36a00000-0000-0000-0000-000000000012') $$,
  '22023', NULL, 'D6: a 0 tender with a 1000 tip is rejected');
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000007', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'nequi' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0)),
  '36a00000-0000-0000-0000-000000000013') $$,
  '22023', NULL, 'D6: a 0 electronic tender is rejected');
SELECT throws_ok($$ SELECT public.pay_order('36c00000-0000-0000-0000-000000000007', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0, 'cash_received', 5000)),
  '36a00000-0000-0000-0000-000000000014') $$,
  '22023', NULL, 'B: a 0 tender with cash_received 5000 is rejected');
SELECT throws_ok($$ INSERT INTO public.payment_tenders (payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received)
  SELECT p.id, 2, (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'cash', 'cash', 0, 0
    FROM public.payments p WHERE p.order_id = '36c00000-0000-0000-0000-000000000005' $$,
  '42501', NULL, 'D6: vipe_api cannot insert payment_tenders directly');
SELECT is((public.pay_order('36c00000-0000-0000-0000-000000000007', '36400000-0000-0000-0000-000000000001', 0,
  jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE code = 'cash' AND restaurant_id = '36000000-0000-0000-0000-0000000000a1'), 'amount', 0, 'cash_received', 0)),
  '36a00000-0000-0000-0000-000000000015')->>'change_given'), '0', 'B: a 0 tender with cash_received 0 closes the order with no change');
RESET ROLE;

-- ============================================
-- T4b. apply_discount: its own supervisor action, checked by private.discount_authorizer
-- ============================================
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('36700000-0000-0000-0000-000000000041', '36000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 8, 0, 10, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity) VALUES
  ('36800000-0000-0000-0000-000000000041', '36000000-0000-0000-0000-0000000000a1', '36700000-0000-0000-0000-000000000041', '36300000-0000-0000-0000-000000000001', 'Mojito', 24000, 2);
SELECT lives_ok($$
  INSERT INTO public.supervisor_authorizations
    (id, restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at, consumed_at)
  VALUES
    ('36f00000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-0000000000a1', 'apply_discount', '36100000-0000-0000-0000-000000000001',
     '36100000-0000-0000-0000-000000000002', 'order', '36700000-0000-0000-0000-000000000041', now() - interval '10 seconds', now() + interval '110 seconds', now()),
    ('36f00000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-0000000000a1', 'void_item', '36100000-0000-0000-0000-000000000001',
     '36100000-0000-0000-0000-000000000002', 'order', '36700000-0000-0000-0000-000000000041', now() - interval '10 seconds', now() + interval '110 seconds', now())
$$, 'an apply_discount authorization bound to an order is accepted');
SELECT throws_ok($$
  INSERT INTO public.supervisor_authorizations
    (restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at)
  VALUES ('36000000-0000-0000-0000-0000000000a1', 'give_away', '36100000-0000-0000-0000-000000000001',
          '36100000-0000-0000-0000-000000000002', 'order', '36700000-0000-0000-0000-000000000041', now(), now() + interval '2 minutes')
$$, '23514', NULL, 'a targeted authorization for an unknown action is refused');
SELECT throws_ok($$
  INSERT INTO public.supervisor_authorizations
    (restaurant_id, action, supervisor_profile_id, requested_by_profile_id, target_type, target_id, created_at, expires_at)
  VALUES ('36000000-0000-0000-0000-0000000000a1', 'apply_discount', '36100000-0000-0000-0000-000000000001',
          '36100000-0000-0000-0000-000000000002', 'payment', '36700000-0000-0000-0000-000000000041', now(), now() + interval '2 minutes')
$$, '23514', NULL, 'apply_discount is bound to an order, never to a payment');
SELECT ok(has_function_privilege('vipe_api', 'private.discount_authorizer(uuid, uuid)', 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                           WHERE p.oid = 'private.discount_authorizer(uuid, uuid)'::regprocedure AND a.grantee = 0),
  'vipe_api can execute private.discount_authorizer, PUBLIC cannot');
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT public.void_order_items('36700000-0000-0000-0000-000000000041', '[{"order_item_id":"36800000-0000-0000-0000-000000000041","quantity":1}]',
                                                   'dish_returned', NULL, '36f00000-0000-0000-0000-000000000001') $$,
  '42501', 'void_order_items: authorization_invalid', 'an apply_discount authorization does not back a void');
SELECT throws_ok($$ SELECT private.discount_authorizer('36700000-0000-0000-0000-000000000041', '36f00000-0000-0000-0000-000000000002') $$,
  '42501', 'apply_discount: authorization_invalid', 'a void_item authorization does not back a discount');
SELECT is(private.discount_authorizer('36700000-0000-0000-0000-000000000041', '36f00000-0000-0000-0000-000000000001'),
  '36100000-0000-0000-0000-000000000001'::uuid, 'an apply_discount authorization of this order names its supervisor');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
