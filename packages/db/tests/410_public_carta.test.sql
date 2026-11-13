-- Public digital menu (odd/tasks/carta-digital.md T1, S1, S2, S5, S6, S7,
-- S10, L12, migration 0036).
--
-- carta_settings, carta_dayparts, carta_daypart_categories,
-- dish_public_details and table_qr_tokens: shape, checks, tenant RLS (staff
-- read, admin write). The guest functions run as vipe_api with no
-- app.user_id, resolve the restaurant only from its slug (published carta,
-- exact case) and the table only from its token, never return another
-- restaurant's rows nor costs, and regenerating a token invalidates the old
-- one. check_dishes_stock keeps its role check and result.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(101);

-- ============================================
-- 1. Schema, grants, policies
-- ============================================
SELECT has_table('public', 'carta_settings', 'carta_settings exists');
SELECT has_table('public', 'carta_dayparts', 'carta_dayparts exists');
SELECT has_table('public', 'carta_daypart_categories', 'carta_daypart_categories exists');
SELECT has_table('public', 'dish_public_details', 'dish_public_details exists');
SELECT has_table('public', 'table_qr_tokens', 'table_qr_tokens exists');
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid IN ('public.carta_settings'::regclass, 'public.carta_dayparts'::regclass,
                            'public.carta_daypart_categories'::regclass, 'public.dish_public_details'::regclass,
                            'public.table_qr_tokens'::regclass)),
  'RLS is enabled on the carta tables');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('guest_restaurant', 'guest_carta', 'guest_menu_data', 'guest_table', 'regenerate_table_qr_token')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  5::bigint,
  'the guest functions and regenerate_table_qr_token are SECURITY DEFINER, pinned, vipe_api only');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('guest_restaurant', 'guest_carta', 'guest_menu_data', 'guest_table')
      AND p.provolatile = 's')::bigint,
  4::bigint,
  'the guest read functions are STABLE');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private'
       AND p.proname IN ('guest_restaurant', 'guest_carta', 'guest_menu_data', 'guest_table', 'dishes_available', 'dishes_stock_check')
       AND p.prosrc ~ '(current_restaurant_id|current_user_id|current_app_role|current_profile_id)'),
  'the guest functions never read the staff identity');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.dishes_available(uuid, uuid[])', 'EXECUTE')
      AND NOT has_function_privilege('public', 'private.dishes_available(uuid, uuid[])', 'EXECUTE'),
  'vipe_api cannot call dishes_available directly');

-- ============================================
-- Fixtures: A (published by its admin below), B (published), C (unpublished).
-- ============================================
INSERT INTO public.restaurants (id, slug, name, timezone) VALUES
  ('41000000-0000-0000-0000-0000000000a1', 't410-a', 'T410 A', 'America/Bogota'),
  ('41000000-0000-0000-0000-0000000000b2', 't410-b', 'T410 B', 'America/Bogota'),
  ('41000000-0000-0000-0000-0000000000c3', 't410-c', 'T410 C', 'America/Bogota');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('41000000-0000-0000-0000-000000000001', 'admin@t410a.test', 'h'),
  ('41000000-0000-0000-0000-000000000002', 'waiter@t410a.test', 'h'),
  ('41000000-0000-0000-0000-000000000003', 'admin@t410b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('41100000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t410a.test', 'admin', true, '41000000-0000-0000-0000-0000000000a1'),
  ('41100000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@t410a.test', 'waiter', true, '41000000-0000-0000-0000-0000000000a1'),
  ('41100000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-000000000003', 'Admin B', 'admin@t410b.test', 'admin', true, '41000000-0000-0000-0000-0000000000b2');
INSERT INTO public.categories (id, restaurant_id, name, icon) VALUES
  ('41200000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Desayunos', 'coffee'),
  ('41200000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-0000000000b2', 'Desayunos B', 'coffee');
INSERT INTO public.subcategories (id, restaurant_id, category_id, name) VALUES
  ('41210000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', '41200000-0000-0000-0000-000000000001', 'Huevos');
INSERT INTO public.dishes (id, restaurant_id, name, description, price, active, category_id, subcategory_id) VALUES
  ('41300000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Huevos pericos', 'Con arepa', 12000, true,
   '41200000-0000-0000-0000-000000000001', '41210000-0000-0000-0000-000000000001'),
  ('41300000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-0000000000a1', 'Calentado', 'Pausado', 15000, false,
   '41200000-0000-0000-0000-000000000001', NULL),
  ('41300000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-0000000000a1', 'Chocolate', 'Con queso', 6000, true,
   '41200000-0000-0000-0000-000000000001', NULL),
  ('41300000-0000-0000-0000-0000000000b1', '41000000-0000-0000-0000-0000000000b2', 'Plato B', 'De B', 9000, true,
   '41200000-0000-0000-0000-000000000002', NULL),
  ('41300000-0000-0000-0000-0000000000b2', '41000000-0000-0000-0000-0000000000b2', 'Otro B', 'De B', 8000, true,
   '41200000-0000-0000-0000-000000000002', NULL);
-- Inventory control on in A: Huevos pericos needs flour that has no stock.
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('41000000-0000-0000-0000-0000000000a1', 'inventory_control_enabled', 'true'),
  ('41000000-0000-0000-0000-0000000000a1', 'delivery_default_fee', '4000'),
  ('41000000-0000-0000-0000-0000000000a1', 'tip_percentage', '12'),
  ('41000000-0000-0000-0000-0000000000b2', 'delivery_default_fee', '12.5');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind, cost) VALUES
  ('41600000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Harina', 'g', 'raw', 7);
INSERT INTO public.recipes (id, restaurant_id, dish_id) VALUES
  ('41610000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', '41300000-0000-0000-0000-000000000001');
INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity) VALUES
  ('41000000-0000-0000-0000-0000000000a1', '41610000-0000-0000-0000-000000000001', '41600000-0000-0000-0000-000000000001', 100);
INSERT INTO public.modifier_groups (id, restaurant_id, name, required, min_select, max_select, is_active) VALUES
  ('41400000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Adiciones', false, 0, 2, true);
INSERT INTO public.modifier_options (id, restaurant_id, group_id, name, price, ingredient_id, ingredient_qty, is_active) VALUES
  ('41410000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', '41400000-0000-0000-0000-000000000001', 'Queso', 2000,
   '41600000-0000-0000-0000-000000000001', 30, true);
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('41000000-0000-0000-0000-0000000000a1', '41300000-0000-0000-0000-000000000001', '41400000-0000-0000-0000-000000000001', 0);
INSERT INTO public.promotions (id, restaurant_id, name, discount_type, discount_value, start_date, end_date, mode) VALUES
  ('41500000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Desayuno 10 %', 'percentage', 10, now() - interval '1 day', NULL, 'automatic'),
  ('41500000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-0000000000a1', 'Cortesía', 'percentage', 100, now() - interval '1 day', NULL, 'manual_pin'),
  ('41500000-0000-0000-0000-0000000000b1', '41000000-0000-0000-0000-0000000000b2', 'Promo B', 'percentage', 10, now() - interval '1 day', NULL, 'automatic');
INSERT INTO public.promotion_dishes (restaurant_id, promotion_id, dish_id) VALUES
  ('41000000-0000-0000-0000-0000000000a1', '41500000-0000-0000-0000-000000000001', '41300000-0000-0000-0000-000000000001');
INSERT INTO public.zones (id, restaurant_id, name) VALUES
  ('41700000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Terraza');
INSERT INTO public.tables (id, restaurant_id, number, zone_id) VALUES
  ('41800000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 12, '41700000-0000-0000-0000-000000000001'),
  ('41800000-0000-0000-0000-0000000000b1', '41000000-0000-0000-0000-0000000000b2', 12, NULL),
  ('41800000-0000-0000-0000-0000000000c1', '41000000-0000-0000-0000-0000000000c3', 1, NULL);
-- Sales: a paid A order (Chocolate x5, Huevos x2), a cancelled A order and a paid B order.
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('41900000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('41900000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('41900000-0000-0000-0000-0000000000b1', '41000000-0000-0000-0000-0000000000b2', 'kitchen', 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items (restaurant_id, order_id, dish_id, name, price, quantity) VALUES
  ('41000000-0000-0000-0000-0000000000a1', '41900000-0000-0000-0000-000000000001', '41300000-0000-0000-0000-000000000003', 'Chocolate', 6000, 5),
  ('41000000-0000-0000-0000-0000000000a1', '41900000-0000-0000-0000-000000000001', '41300000-0000-0000-0000-000000000001', 'Huevos', 12000, 2),
  ('41000000-0000-0000-0000-0000000000a1', '41900000-0000-0000-0000-000000000002', '41300000-0000-0000-0000-000000000002', 'Calentado', 15000, 10),
  ('41000000-0000-0000-0000-0000000000b2', '41900000-0000-0000-0000-0000000000b1', '41300000-0000-0000-0000-0000000000b1', 'Plato B', 9000, 9);
UPDATE public.orders SET status = 'paid' WHERE id IN ('41900000-0000-0000-0000-000000000001', '41900000-0000-0000-0000-0000000000b1');
UPDATE public.orders SET status = 'cancelled' WHERE id = '41900000-0000-0000-0000-000000000002';
INSERT INTO public.carta_settings (restaurant_id, published, description) VALUES
  ('41000000-0000-0000-0000-0000000000b2', true, 'Carta B'),
  ('41000000-0000-0000-0000-0000000000c3', false, 'Carta C');
INSERT INTO public.dish_public_details (restaurant_id, dish_id, tags, description_en) VALUES
  ('41000000-0000-0000-0000-0000000000b2', '41300000-0000-0000-0000-0000000000b1', '{spicy}', 'From B');

-- ============================================
-- 2. Table QR tokens
-- ============================================
SELECT is((SELECT count(*)::int FROM public.tables t
            WHERE NOT EXISTS (SELECT 1 FROM public.table_qr_tokens q WHERE q.table_id = t.id)), 0,
  'every table has a QR token (new tables and the backfill)');
SELECT ok((SELECT bool_and(q.token ~ '^[A-Za-z0-9_-]{24}$' AND q.restaurant_id = t.restaurant_id)
             FROM public.table_qr_tokens q JOIN public.tables t ON t.id = q.table_id),
  'tokens are 24 base64url characters and carry the restaurant of their table');
SELECT is((SELECT count(DISTINCT token)::int FROM public.table_qr_tokens), (SELECT count(*)::int FROM public.table_qr_tokens),
  'tokens are unique');
CREATE TEMP TABLE t410_tokens ON COMMIT DROP AS SELECT table_id, token FROM public.table_qr_tokens
  WHERE table_id IN ('41800000-0000-0000-0000-000000000001', '41800000-0000-0000-0000-0000000000b1', '41800000-0000-0000-0000-0000000000c1');
GRANT SELECT ON t410_tokens TO vipe_api;

-- ============================================
-- 3. RLS: the admin writes, the waiter reads, B sees nothing of A
-- ============================================
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$
  INSERT INTO public.carta_settings (published, description, brand_color, instagram, whatsapp, maps_url, opening_hours)
  VALUES (true, 'Desayunos y almuerzos', '#b4532a', 'brasaylena', '573001234567', 'https://maps.app.goo.gl/x',
          '{"1": {"opens": "07:00", "closes": "22:30"}, "2": {"opens": "07:00", "closes": "22:30"}, "3": null, "4": null,
            "5": null, "6": null, "7": {"opens": "08:00", "closes": "16:00"}}')
$$, 'the admin creates the carta settings of their restaurant');
SELECT lives_ok($$ UPDATE public.carta_settings SET english_enabled = false $$, 'the admin updates them');
SELECT lives_ok($$
  INSERT INTO public.carta_dayparts (id, name, name_en, starts_at, ends_at, sort_order, featured_dish_id)
  VALUES ('41a00000-0000-0000-0000-000000000001', 'Desayuno', 'Breakfast', '07:00', '11:00', 0, '41300000-0000-0000-0000-000000000003');
  INSERT INTO public.carta_daypart_categories (daypart_id, category_id)
  VALUES ('41a00000-0000-0000-0000-000000000001', '41200000-0000-0000-0000-000000000001');
$$, 'the admin creates a daypart with its category and featured dish');
SELECT lives_ok($$
  INSERT INTO public.dish_public_details (dish_id, tags, description_en)
  VALUES ('41300000-0000-0000-0000-000000000001', '{vegetarian,dairy}', 'Scrambled eggs with arepa')
$$, 'the admin sets tags and the English description of a dish');
SELECT throws_ok($$
  INSERT INTO public.carta_daypart_categories (daypart_id, category_id)
  VALUES ('41a00000-0000-0000-0000-000000000001', '41200000-0000-0000-0000-000000000002')
$$, '23503', NULL, 'a daypart cannot list a category of another restaurant');
SELECT throws_ok($$
  INSERT INTO public.dish_public_details (dish_id) VALUES ('41300000-0000-0000-0000-0000000000b2')
$$, '23503', NULL, 'the admin cannot describe a dish of another restaurant');
SELECT throws_ok($$
  INSERT INTO public.carta_settings (restaurant_id, published) VALUES ('41000000-0000-0000-0000-0000000000c3', true)
$$, '42501', NULL, 'the admin cannot write the carta settings of another restaurant');

-- Checks reject bad input (the row stays as it was).
SELECT throws_ok($$ UPDATE public.carta_settings SET brand_color = 'red' $$, '23514', NULL, 'brand_color must be #rrggbb');
SELECT throws_ok($$ UPDATE public.carta_settings SET brand_color = '#B4532A' $$, '23514', NULL, 'brand_color is lower case');
SELECT throws_ok($$ UPDATE public.carta_settings SET whatsapp = '+57 300' $$, '23514', NULL, 'whatsapp holds 7-15 digits only');
SELECT throws_ok($$ UPDATE public.carta_settings SET whatsapp = '123456' $$, '23514', NULL, 'whatsapp has at least 7 digits');
SELECT throws_ok($$ UPDATE public.carta_settings SET description = repeat('a', 161) $$, '23514', NULL, 'description has at most 160 characters');
SELECT throws_ok($$ UPDATE public.carta_settings SET maps_url = 'http://maps.example' $$, '23514', NULL, 'maps_url is https');
SELECT throws_ok($$ UPDATE public.carta_settings SET google_review_url = 'javascript:alert(1)' $$, '23514', NULL, 'google_review_url is https');
SELECT throws_ok($$ UPDATE public.carta_settings SET opening_hours = '{"1": null}' $$, '23514', NULL, 'opening_hours needs the seven days');
SELECT throws_ok($$ UPDATE public.carta_settings SET opening_hours =
  '{"1": {"opens": "7:00", "closes": "22:30"}, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null}' $$,
  '23514', NULL, 'opening_hours times are HH:MM');
SELECT throws_ok($$ UPDATE public.carta_settings SET opening_hours =
  '{"1": {"opens": "07:00"}, "2": null, "3": null, "4": null, "5": null, "6": null, "7": null}' $$,
  '23514', NULL, 'an open day has opens and closes');
SELECT throws_ok($$ UPDATE public.carta_settings SET opening_hours =
  '{"0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null}' $$,
  '23514', NULL, 'opening_hours days are ISO 1-7');
SELECT is((SELECT row(brand_color, whatsapp, description, maps_url, english_enabled)::text FROM public.carta_settings),
  '(#b4532a,573001234567,"Desayunos y almuerzos",https://maps.app.goo.gl/x,f)',
  'rejected updates leave the settings unchanged');
SELECT throws_ok($$ UPDATE public.dish_public_details SET tags = '{vegan}' $$, '23514', NULL, 'tags are a subset of the four known tags');
SELECT throws_ok($$ UPDATE public.dish_public_details SET description_en = repeat('a', 401) $$, '23514', NULL, 'description_en has at most 400 characters');
SELECT is((SELECT tags::text FROM public.dish_public_details), '{vegetarian,dairy}', 'rejected tags leave the details unchanged');
SELECT throws_ok($$ UPDATE public.carta_dayparts SET ends_at = '07:00' $$, '23514', NULL, 'a daypart starts before it ends');
SELECT throws_ok($$ UPDATE public.carta_dayparts SET name = repeat('a', 41) $$, '23514', NULL, 'a daypart name has at most 40 characters');
SELECT is((SELECT row(name, starts_at, ends_at)::text FROM public.carta_dayparts), '(Desayuno,07:00:00,11:00:00)',
  'rejected daypart updates leave it unchanged');
RESET ROLE;

-- The waiter reads but cannot write.
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*)::int FROM public.carta_settings), 1, 'the waiter reads the carta settings of their restaurant only');
SELECT is((SELECT count(*)::int FROM public.carta_dayparts) + (SELECT count(*)::int FROM public.carta_daypart_categories)
        + (SELECT count(*)::int FROM public.dish_public_details) + (SELECT count(*)::int FROM public.table_qr_tokens), 4,
  'the waiter reads the dayparts, their categories, the dish details and the table tokens of their restaurant');
SELECT throws_ok($$ INSERT INTO public.dish_public_details (dish_id) VALUES ('41300000-0000-0000-0000-000000000003') $$,
  '42501', NULL, 'the waiter cannot add dish details');
SELECT throws_ok($$ INSERT INTO public.carta_dayparts (name, starts_at, ends_at) VALUES ('X', '01:00', '02:00') $$,
  '42501', NULL, 'the waiter cannot add a daypart');
UPDATE public.carta_settings SET description = 'Hackeado';
UPDATE public.dish_public_details SET tags = '{}';
UPDATE public.table_qr_tokens SET token = 'AAAAAAAAAAAAAAAAAAAAAAAA';
DELETE FROM public.carta_dayparts;
RESET ROLE;
SELECT is((SELECT row(s.description, d.tags, (SELECT count(*) FROM public.carta_dayparts))::text
             FROM public.carta_settings s, public.dish_public_details d
            WHERE s.restaurant_id = '41000000-0000-0000-0000-0000000000a1' AND d.dish_id = '41300000-0000-0000-0000-000000000001'),
  '("Desayunos y almuerzos","{vegetarian,dairy}",1)',
  'the waiter''s updates and deletes change nothing');
SELECT is((SELECT count(*)::int FROM public.table_qr_tokens q JOIN t410_tokens t USING (table_id, token)), 3,
  'nobody writes table_qr_tokens through vipe_api');

-- B sees nothing of A.
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT array_agg(restaurant_id)::text FROM public.carta_settings), '{41000000-0000-0000-0000-0000000000b2}',
  'the admin of B reads only the settings of B');
SELECT is((SELECT count(*)::int FROM public.carta_dayparts) + (SELECT count(*)::int FROM public.carta_daypart_categories)
        + (SELECT count(*)::int FROM public.dish_public_details WHERE restaurant_id <> '41000000-0000-0000-0000-0000000000b2'), 0,
  'the admin of B reads no daypart nor dish detail of A');
RESET ROLE;

-- ============================================
-- 4. Guest functions: vipe_api, no app.user_id
-- ============================================
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_restaurant('t410-a'), '41000000-0000-0000-0000-0000000000a1'::uuid, 'guest_restaurant resolves a published slug');
SELECT is(private.guest_restaurant('t410-zz'), NULL, 'guest_restaurant: unknown slug -> NULL');
SELECT is(private.guest_restaurant('T410-A'), NULL, 'guest_restaurant: the slug is case-sensitive');
SELECT is(private.guest_restaurant('t410-c'), NULL, 'guest_restaurant: an unpublished carta -> NULL');
SELECT is(private.guest_carta('t410-zz'), NULL, 'guest_carta: unknown slug -> NULL');
SELECT is(private.guest_carta('T410-A'), NULL, 'guest_carta: the slug is case-sensitive');
SELECT is(private.guest_carta('t410-c'), NULL, 'guest_carta: an unpublished carta -> NULL');
SELECT is(private.guest_menu_data('t410-zz'), NULL, 'guest_menu_data: unknown slug -> NULL');
SELECT is(private.guest_menu_data('T410-A'), NULL, 'guest_menu_data: the slug is case-sensitive');
SELECT is(private.guest_menu_data('t410-c'), NULL, 'guest_menu_data: an unpublished carta -> NULL');

SELECT is(private.guest_carta('t410-a') -> 'restaurant',
  '{"name": "T410 A", "slug": "t410-a", "timezone": "America/Bogota", "currency": "COP"}'::jsonb,
  'guest_carta returns the restaurant name, slug, timezone and currency');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(private.guest_carta('t410-a') -> 'settings') k),
  ARRAY['brandColor', 'coverUrl', 'deliveryOrderingEnabled', 'description', 'englishEnabled', 'googleReviewUrl', 'instagram',
        'logoUrl', 'mapsUrl', 'openingHours', 'showTableBill', 'tableOrderingEnabled', 'tiktok', 'whatsapp'],
  'guest_carta settings are the guest-safe columns only');
SELECT is(private.guest_carta('t410-a') #>> '{settings,openingHours,7,closes}', '16:00', 'guest_carta returns the opening hours');
SELECT is(private.guest_carta('t410-a') -> 'dayparts',
  '[{"id": "41a00000-0000-0000-0000-000000000001", "name": "Desayuno", "nameEn": "Breakfast", "startsAt": "07:00", "endsAt": "11:00",
     "sortOrder": 0, "featuredDishId": "41300000-0000-0000-0000-000000000003", "categoryIds": ["41200000-0000-0000-0000-000000000001"]}]'::jsonb,
  'guest_carta returns the dayparts with their categories');
SELECT is((private.guest_carta('t410-a') -> 'deliveryFee', private.guest_carta('t410-a') -> 'tipPercentage')::text, '(4000,12)',
  'guest_carta returns the delivery fee and the tip percentage');
SELECT is((private.guest_carta('t410-b') -> 'deliveryFee', private.guest_carta('t410-b') -> 'tipPercentage')::text, '(0,10)',
  'a non-whole delivery fee reads 0 and a missing tip reads 10, as the API does');

CREATE TEMP TABLE t410_menu ON COMMIT DROP AS SELECT private.guest_menu_data('t410-a') AS m;
SELECT is((SELECT array_agg(k ORDER BY k) FROM t410_menu, jsonb_object_keys(m) k),
  ARRAY['availability', 'categories', 'details', 'dishes', 'liveDishIds', 'modifierLinks', 'mostOrdered', 'promotions', 'snapshot',
        'subcategories'],
  'guest_menu_data returns the menu sections');
SELECT is((SELECT array_agg(d ->> 'id' ORDER BY d ->> 'name') FROM t410_menu, jsonb_array_elements(m -> 'dishes') d),
  ARRAY['41300000-0000-0000-0000-000000000003', '41300000-0000-0000-0000-000000000001'],
  'guest_menu_data dishes are the active dishes of A only');
SELECT is((SELECT array_agg(DISTINCT k ORDER BY k) FROM t410_menu, jsonb_array_elements(m -> 'dishes') d, jsonb_object_keys(d) k),
  ARRAY['active', 'allowComments', 'categoryId', 'createdAt', 'description', 'id', 'imageUrl', 'name', 'price', 'sortOrder',
        'subcategoryId', 'updatedAt'],
  'a guest dish carries exactly the dish row keys (no cost, station or restaurant)');
SELECT is((SELECT m -> 'liveDishIds' FROM t410_menu),
  '["41300000-0000-0000-0000-000000000001", "41300000-0000-0000-0000-000000000002", "41300000-0000-0000-0000-000000000003"]'::jsonb,
  'liveDishIds lists every dish of A, active or not');
SELECT is((SELECT m -> 'categories' -> 0 ->> 'id' || ',' || (m -> 'categories' -> 0 ->> 'hasSubcategories') || ',' || jsonb_array_length(m -> 'categories')
             FROM t410_menu),
  '41200000-0000-0000-0000-000000000001,true,1', 'categories are those of A, with hasSubcategories');
SELECT is((SELECT (m -> 'subcategories' -> 0) - 'created_at' - 'updated_at' FROM t410_menu),
  '{"id": "41210000-0000-0000-0000-000000000001", "category_id": "41200000-0000-0000-0000-000000000001", "name": "Huevos", "sort_order": 0, "active": true}'::jsonb,
  'subcategories carry the subcategory row of the staff path');
SELECT is((SELECT m -> 'availability' FROM t410_menu),
  '{"41300000-0000-0000-0000-000000000001": false, "41300000-0000-0000-0000-000000000003": true}'::jsonb,
  'availability: one boolean per listed dish, from the stock rule');
SELECT is((SELECT jsonb_agg(p ->> 'id') FROM t410_menu, jsonb_array_elements(m -> 'promotions') p),
  '["41500000-0000-0000-0000-000000000001"]'::jsonb, 'promotions: the active automatic promotions of A only');
SELECT is((SELECT m -> 'promotions' -> 0 -> 'dish_ids' FROM t410_menu), '["41300000-0000-0000-0000-000000000001"]'::jsonb,
  'promotions carry their targets in the PromotionCatalog row shape');
SELECT is((SELECT m -> 'details' FROM t410_menu),
  '[{"dishId": "41300000-0000-0000-0000-000000000001", "tags": ["vegetarian", "dairy"], "descriptionEn": "Scrambled eggs with arepa", "descriptionEnReviewed": false}]'::jsonb,
  'details: the public details of A only');
SELECT is((SELECT m -> 'mostOrdered' FROM t410_menu),
  '["41300000-0000-0000-0000-000000000003", "41300000-0000-0000-0000-000000000001"]'::jsonb,
  'mostOrdered: dishes of paid A orders by quantity (cancelled orders and B ignored)');
SELECT is((SELECT jsonb_array_length(m -> 'modifierLinks') || ',' || (m -> 'modifierLinks' -> 0 ->> 'dish_id') || ',' || (m #>> '{modifierLinks,0,row,name}')
             FROM t410_menu),
  '1,41300000-0000-0000-0000-000000000001,Adiciones', 'modifierLinks: the active groups each listed dish offers');
SELECT is((SELECT (m #> '{modifierLinks,0,row,options,0}') ->> 'ingredient_id' IS NULL
               AND (m #> '{modifierLinks,0,row,options,0}') ->> 'ingredient_qty' IS NULL
               AND (m #>> '{modifierLinks,0,row,options,0,price}')::numeric = 2000 FROM t410_menu), true,
  'modifier options keep their price but never their ingredient');
SELECT is((SELECT m -> 'snapshot' FROM t410_menu), 'null'::jsonb, 'no publication -> snapshot null');
SELECT ok((SELECT m::text !~ '(41000000-0000-0000-0000-0000000000b2|41300000-0000-0000-0000-0000000000b1|41200000-0000-0000-0000-000000000002|41500000-0000-0000-0000-0000000000b1|Harina|"cost")'
             FROM t410_menu),
  'nothing of B and no cost or ingredient appears in the menu of A');
SELECT is((SELECT jsonb_agg(d ->> 'dishId') FROM jsonb_array_elements(private.guest_menu_data('t410-b') -> 'details') d),
  '["41300000-0000-0000-0000-0000000000b1"]'::jsonb, 'B gets its own details');

-- guest_table
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-000000000001')),
  '{"tableId": "41800000-0000-0000-0000-000000000001", "number": 12, "zoneName": "Terraza", "isOpen": false}'::jsonb,
  'guest_table: a valid token returns its table, closed');
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-0000000000b1')), NULL,
  'guest_table: a token of B under the slug of A -> NULL');
SELECT is(private.guest_table('t410-c', (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-0000000000c1')), NULL,
  'guest_table: an unpublished carta -> NULL');
SELECT is(private.guest_table('t410-a', 'AAAAAAAAAAAAAAAAAAAAAAAA'), NULL, 'guest_table: an unknown token -> NULL');
SELECT is(private.guest_table('t410-a', NULL), NULL, 'guest_table: no token -> NULL');
RESET ROLE;
INSERT INTO public.orders (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('41900000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-0000000000a1', '41800000-0000-0000-0000-000000000001', 'active', 0, 0, 0, 0, 0, 0);
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-000000000001')) -> 'isOpen',
  'true'::jsonb, 'guest_table: a table with an active order is open');
RESET ROLE;

-- ============================================
-- 5. regenerate_table_qr_token
-- ============================================
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.regenerate_table_qr_token('41800000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'a waiter cannot regenerate a table token');
RESET ROLE;
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.regenerate_table_qr_token('41800000-0000-0000-0000-000000000001') $$,
  'P0002', NULL, 'the admin of B cannot regenerate a table token of A (not found)');
RESET ROLE;
SELECT is((SELECT q.token FROM public.table_qr_tokens q WHERE q.table_id = '41800000-0000-0000-0000-000000000001'),
  (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-000000000001'), 'refused regenerations change nothing');
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t410_new ON COMMIT DROP AS
  SELECT private.regenerate_table_qr_token('41800000-0000-0000-0000-000000000001') AS token;
SELECT ok((SELECT n.token ~ '^[A-Za-z0-9_-]{24}$' AND n.token <> o.token FROM t410_new n, t410_tokens o
            WHERE o.table_id = '41800000-0000-0000-0000-000000000001'),
  'the admin regenerates a token of their restaurant and gets a new one');
SELECT set_config('app.user_id', '', true);
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_tokens WHERE table_id = '41800000-0000-0000-0000-000000000001')), NULL,
  'the old token no longer resolves');
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_new)) ->> 'tableId', '41800000-0000-0000-0000-000000000001',
  'the new token resolves the table');
SELECT throws_ok($$ SELECT private.regenerate_table_qr_token('41800000-0000-0000-0000-000000000001') $$,
  '42501', NULL, 'without a staff identity nobody regenerates a token');
RESET ROLE;

-- ============================================
-- 6. check_dishes_stock keeps its behaviour
-- ============================================
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is(public.check_dishes_stock('[{"dish_id": "41300000-0000-0000-0000-000000000001", "quantity": 2}]'),
  '{"ok": false, "enabled": true, "shortages": [{"ingredient_id": "41600000-0000-0000-0000-000000000001", "name": "Harina", "unit": "g",
     "required": 200.000, "available": 0.000, "missing": 200.000}]}'::jsonb,
  'check_dishes_stock still reports the shortage of a cart');
SELECT is(public.check_dishes_stock('[{"dish_id": "41300000-0000-0000-0000-000000000003", "quantity": 1}]') -> 'ok', 'true'::jsonb,
  'check_dishes_stock: a dish without formula is available');
SELECT throws_ok($$ SELECT public.check_dishes_stock('[{"dish_id": "41300000-0000-0000-0000-0000000000b1", "quantity": 1}]') $$,
  'P0002', NULL, 'check_dishes_stock: a dish of another restaurant is not found');
SELECT throws_ok($$ SELECT public.check_dishes_stock('{}') $$, '22023', NULL, 'check_dishes_stock: p_items must be an array');
SELECT set_config('app.user_id', '', true);
SELECT throws_ok($$ SELECT public.check_dishes_stock('[]') $$, '42501', NULL, 'check_dishes_stock: no staff identity -> 42501');
RESET ROLE;

-- ============================================
-- 7. Regressions from the independent verification
-- ============================================
-- S2: the slug alone decides the restaurant, whatever staff identity is set.
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_carta('t410-a') -> 'restaurant' ->> 'slug', 't410-a', 'guest_carta ignores the staff identity');
RESET ROLE;

-- S2: manual (non-PIN) promotions are not guest-visible either.
INSERT INTO public.promotions (id, restaurant_id, name, discount_type, discount_value, start_date, mode) VALUES
  ('41500000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-0000000000a1', 'Manual', 'percentage', 5, now() - interval '1 day', 'manual');
SELECT ok(private.guest_menu_data('t410-a')::text !~ '41500000-0000-0000-0000-000000000003', 'manual promotions are not guest-visible');

-- S1: a table an admin creates under RLS gets a token, which goes away with the table.
SELECT set_config('app.user_id', '41000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
INSERT INTO public.tables (id, number) VALUES ('41800000-0000-0000-0000-000000000099', 99);
SELECT is((SELECT count(*)::int FROM public.table_qr_tokens WHERE table_id = '41800000-0000-0000-0000-000000000099'), 1,
  'an admin-created table gets a token');
DELETE FROM public.tables WHERE id = '41800000-0000-0000-0000-000000000099';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.table_qr_tokens WHERE table_id = '41800000-0000-0000-0000-000000000099'), 0,
  'the token is deleted with its table');

-- S1: unpublishing the carta hides its tables too (last: it changes restaurant A).
UPDATE public.carta_settings SET published = false WHERE restaurant_id = '41000000-0000-0000-0000-0000000000a1';
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table('t410-a', (SELECT token FROM t410_new)), NULL, 'an unpublished carta hides its tables');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
