-- Guest dine-in from the table QR (odd/tasks/carta-digital.md T4a, S2, S12,
-- S13, S14, migration 0036).
--
-- carta_table_proposals, carta_table_requests and carta_feedback: staff read
-- (feedback: admin only), nobody writes them directly. Guests (vipe_api with
-- no app.user_id) write only through the guest functions, which resolve the
-- restaurant from its published slug and the table from its token; a waiter
-- (or admin, cashier) confirms or rejects a proposal and resolves a request.
-- Rejected input leaves no row. Proposals and requests notify the staff room.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(177);

-- ============================================
-- 1. Schema, grants, policies, realtime
-- ============================================
SELECT has_table('public', 'carta_table_proposals', 'carta_table_proposals exists');
SELECT has_table('public', 'carta_table_requests', 'carta_table_requests exists');
SELECT has_table('public', 'carta_feedback', 'carta_feedback exists');
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid IN ('public.carta_table_proposals'::regclass, 'public.carta_table_requests'::regclass,
                            'public.carta_feedback'::regclass)),
  'RLS is enabled on the three tables');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('guest_submit_proposal', 'guest_table_status', 'guest_table_bill', 'guest_request', 'guest_feedback',
                        'confirm_table_proposal', 'reject_table_proposal', 'resolve_table_request', 'link_table_proposal_items')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  9::bigint,
  'the guest and staff functions are SECURITY DEFINER, pinned, vipe_api only (PUBLIC cannot execute)');
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('guest_table_status', 'guest_table_bill') AND p.provolatile = 's')::bigint,
  2::bigint,
  'guest_table_status and guest_table_bill are STABLE');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private'
       AND p.proname IN ('guest_submit_proposal', 'guest_table_status', 'guest_table_bill', 'guest_request', 'guest_feedback',
                         'carta_guest_table', 'carta_open_order')
       AND p.prosrc ~ '(current_restaurant_id|current_user_id|current_app_role|current_profile_id)'),
  'the guest functions never read the staff identity');
SELECT ok(NOT has_function_privilege('vipe_api', 'private.carta_guest_table(text, text)', 'EXECUTE')
      AND NOT has_function_privilege('vipe_api', 'private.carta_open_order(uuid, uuid)', 'EXECUTE'),
  'the internal resolvers are not granted to vipe_api');
SELECT is(
  (SELECT count(*) FROM unnest(ARRAY['public.carta_table_proposals', 'public.carta_table_requests', 'public.carta_feedback']) t,
                        unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
    WHERE has_table_privilege('vipe_api', t, p))::bigint,
  0::bigint,
  'vipe_api holds no INSERT/UPDATE/DELETE on the three tables');
SELECT trigger_is('public', 'carta_table_proposals', 'notify_change', 'private', 'notify_change', 'carta_table_proposals notifies changes');
SELECT trigger_is('public', 'carta_table_requests', 'notify_change', 'private', 'notify_change', 'carta_table_requests notifies changes');
SELECT is(
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname IN ('carta_table_proposals', 'carta_table_requests') AND t.tgname = 'notify_change'
      AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 0 AND (t.tgtype & 28) = 28)::bigint,
  2::bigint,
  'the notify triggers are AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.carta_feedback'::regclass AND t.tgname = 'notify_change'),
  'carta_feedback does not notify the staff room');

-- ============================================
-- Fixtures: A (published, table ordering on), B (published), C (unpublished).
-- ============================================
INSERT INTO public.restaurants (id, slug, name, timezone) VALUES
  ('42000000-0000-0000-0000-0000000000a1', 't420-a', 'T420 A', 'America/Bogota'),
  ('42000000-0000-0000-0000-0000000000b2', 't420-b', 'T420 B', 'America/Bogota'),
  ('42000000-0000-0000-0000-0000000000c3', 't420-c', 'T420 C', 'America/Bogota');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('42000000-0000-0000-0000-000000000001', 'admin@t420a.test', 'h'),
  ('42000000-0000-0000-0000-000000000002', 'waiter@t420a.test', 'h'),
  ('42000000-0000-0000-0000-000000000003', 'kitchen@t420a.test', 'h'),
  ('42000000-0000-0000-0000-000000000004', 'cashier@t420a.test', 'h'),
  ('42000000-0000-0000-0000-000000000005', 'waiter@t420b.test', 'h'),
  ('42000000-0000-0000-0000-000000000006', 'delivery@t420a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('42100000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t420a.test', 'admin', true, '42000000-0000-0000-0000-0000000000a1'),
  ('42100000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000002', '  Carolina Pérez Gómez', 'waiter@t420a.test', 'waiter', true, '42000000-0000-0000-0000-0000000000a1'),
  ('42100000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-000000000003', 'Cocina A', 'kitchen@t420a.test', 'kitchen', true, '42000000-0000-0000-0000-0000000000a1'),
  ('42100000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-000000000004', 'Caja A', 'cashier@t420a.test', 'cashier', true, '42000000-0000-0000-0000-0000000000a1'),
  ('42100000-0000-0000-0000-000000000005', '42000000-0000-0000-0000-000000000005', 'Mesero B', 'waiter@t420b.test', 'waiter', true, '42000000-0000-0000-0000-0000000000b2'),
  ('42100000-0000-0000-0000-000000000006', '42000000-0000-0000-0000-000000000006', 'Domicilios A', 'delivery@t420a.test', 'delivery_operator', true, '42000000-0000-0000-0000-0000000000a1');
INSERT INTO public.categories (id, restaurant_id, name, icon) VALUES
  ('42200000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', 'Platos', 'utensils'),
  ('42200000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000b2', 'Platos B', 'utensils');
INSERT INTO public.dishes (id, restaurant_id, name, price, active, category_id) VALUES
  ('42300000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', 'Bandeja', 20000, true, '42200000-0000-0000-0000-000000000001'),
  ('42300000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000a1', 'Pausado', 15000, false, '42200000-0000-0000-0000-000000000001'),
  ('42300000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', 'Limonada', 5000, true, '42200000-0000-0000-0000-000000000001'),
  ('42300000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-0000000000a1', 'Agotado', 9000, true, '42200000-0000-0000-0000-000000000001'),
  ('42300000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', 'Plato B', 9000, true, '42200000-0000-0000-0000-000000000002');
-- Inventory control on in A: Agotado needs flour that has no stock.
INSERT INTO public.business_config (restaurant_id, key, value) VALUES
  ('42000000-0000-0000-0000-0000000000a1', 'inventory_control_enabled', 'true'),
  ('42000000-0000-0000-0000-0000000000a1', 'tip_percentage', '12');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind, cost) VALUES
  ('42600000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', 'Harina', 'g', 'raw', 7);
INSERT INTO public.recipes (id, restaurant_id, dish_id) VALUES
  ('42610000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', '42300000-0000-0000-0000-000000000004');
INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity) VALUES
  ('42000000-0000-0000-0000-0000000000a1', '42610000-0000-0000-0000-000000000001', '42600000-0000-0000-0000-000000000001', 100);
-- Bandeja: Término required (exactly 1), Adiciones optional (at most 1), an inactive group;
-- Salsas is active but not linked to Bandeja.
INSERT INTO public.modifier_groups (id, restaurant_id, name, required, min_select, max_select, is_active) VALUES
  ('42400000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', 'Término', true, 1, 1, true),
  ('42400000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000a1', 'Adiciones', false, 0, 1, true),
  ('42400000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', 'Inactivo', false, 0, NULL, false),
  ('42400000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-0000000000a1', 'Salsas', false, 0, NULL, true),
  ('42400000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', 'Grupo B', false, 0, NULL, true);
INSERT INTO public.modifier_options (id, restaurant_id, group_id, name, price, is_active) VALUES
  ('42410000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000001', 'Término medio', 0, true),
  ('42410000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000001', 'Bien asado', 0, true),
  ('42410000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000002', 'Queso', 2000, true),
  ('42410000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000002', 'Aguacate', 3000, true),
  ('42410000-0000-0000-0000-000000000005', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000003', 'Huevo', 1000, true),
  ('42410000-0000-0000-0000-000000000006', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000002', 'Chorizo', 2000, false),
  ('42410000-0000-0000-0000-000000000007', '42000000-0000-0000-0000-0000000000a1', '42400000-0000-0000-0000-000000000004', 'Ají', 0, true),
  ('42410000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', '42400000-0000-0000-0000-0000000000b1', 'Opción B', 0, true);
INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id, sort_order) VALUES
  ('42000000-0000-0000-0000-0000000000a1', '42300000-0000-0000-0000-000000000001', '42400000-0000-0000-0000-000000000001', 0),
  ('42000000-0000-0000-0000-0000000000a1', '42300000-0000-0000-0000-000000000001', '42400000-0000-0000-0000-000000000002', 1),
  ('42000000-0000-0000-0000-0000000000a1', '42300000-0000-0000-0000-000000000001', '42400000-0000-0000-0000-000000000003', 2);
INSERT INTO public.tables (id, restaurant_id, number) VALUES
  ('42800000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', 1),
  ('42800000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000a1', 2),
  ('42800000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', 3),
  ('42800000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', 1),
  ('42800000-0000-0000-0000-0000000000c1', '42000000-0000-0000-0000-0000000000c3', 1);
-- Open orders: table 1 (Carolina, a voided line and two discounts), table 3, B's table 1. Table 2 is closed.
INSERT INTO public.orders (id, restaurant_id, table_id, waiter_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('42900000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000001',
   '42100000-0000-0000-0000-000000000002', 'kitchen', 0, 0, 0, 0, 0, 0),
  ('42900000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000003',
   NULL, 'active', 0, 0, 0, 0, 0, 0),
  ('42900000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', '42800000-0000-0000-0000-0000000000b1',
   '42100000-0000-0000-0000-000000000005', 'active', 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity, status) VALUES
  ('42910000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001',
   '42300000-0000-0000-0000-000000000001', 'Bandeja', 20000, 2, 'kitchen'),
  ('42910000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001',
   '42300000-0000-0000-0000-000000000003', 'Limonada anulada', 5000, 0, 'cancelled'),
  ('42910000-0000-0000-0000-000000000003', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001',
   '42300000-0000-0000-0000-000000000003', 'Limonada', 5000, 1, 'kitchen');
INSERT INTO public.order_discounts (restaurant_id, order_id, order_item_id, kind, source, label, amount, reason, created_by, authorized_by) VALUES
  ('42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001', NULL, 'manual_bill', 'manual',
   'Cortesía cumpleaños', 3000, 'secreto del cajero', '42100000-0000-0000-0000-000000000004', '42100000-0000-0000-0000-000000000001'),
  ('42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001', '42910000-0000-0000-0000-000000000002', 'manual_item', 'manual',
   'Descuento de línea anulada', 1000, 'línea anulada', '42100000-0000-0000-0000-000000000004', NULL);
INSERT INTO public.carta_settings (restaurant_id, published, table_ordering_enabled, show_table_bill) VALUES
  ('42000000-0000-0000-0000-0000000000a1', true, true, true),
  ('42000000-0000-0000-0000-0000000000b2', true, true, true),
  ('42000000-0000-0000-0000-0000000000c3', false, true, true);
CREATE TEMP TABLE t420_tok ON COMMIT DROP AS
  SELECT CASE q.table_id WHEN '42800000-0000-0000-0000-000000000001' THEN 'a1' WHEN '42800000-0000-0000-0000-000000000002' THEN 'a2'
                         WHEN '42800000-0000-0000-0000-000000000003' THEN 'a3' WHEN '42800000-0000-0000-0000-0000000000b1' THEN 'b1'
                         ELSE 'c1' END AS name, q.token
    FROM public.table_qr_tokens q
   WHERE q.restaurant_id IN ('42000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000b2', '42000000-0000-0000-0000-0000000000c3');
GRANT SELECT ON t420_tok TO vipe_api;
CREATE FUNCTION pg_temp.tk(text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT token FROM t420_tok WHERE name = $1 $$;
GRANT EXECUTE ON FUNCTION pg_temp.tk(text) TO vipe_api;

-- ============================================
-- 2. guest_submit_proposal (S12): success
-- ============================================
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_p1 ON COMMIT DROP AS
  SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
    '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 2,
       "optionIds": ["42410000-0000-0000-0000-000000000003", "42410000-0000-0000-0000-000000000001"], "note": "sin cebolla"},
      {"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 20}]', 'Somos dos') AS r;
RESET ROLE;
SELECT is((SELECT r ->> 'status' FROM t420_p1), 'pending', 'a valid proposal is stored as pending');
SELECT ok((SELECT (r ->> 'proposalId')::uuid IS NOT NULL AND (r ->> 'createdAt')::timestamptz IS NOT NULL
                  AND (SELECT count(*) FROM jsonb_object_keys(r)) = 3 FROM t420_p1),
  'guest_submit_proposal returns exactly {proposalId, status, createdAt}');
SELECT is(
  (SELECT jsonb_build_object('r', p.restaurant_id, 't', p.table_id, 'o', p.order_id, 'k', p.guest_key, 'n', p.note, 'i', p.items)
     FROM public.carta_table_proposals p WHERE p.id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p1)),
  jsonb_build_object('r', '42000000-0000-0000-0000-0000000000a1', 't', '42800000-0000-0000-0000-000000000001',
    'o', '42900000-0000-0000-0000-000000000001', 'k', 'guest-key-one_0001', 'n', 'Somos dos',
    'i', '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 2,
            "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000003"], "note": "sin cebolla"},
           {"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 20, "optionIds": [], "note": null}]'::jsonb),
  'the row keeps the restaurant, table, open order, guest key, note and normalized lines (sorted option ids)');
SAVEPOINT t420_extra;
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_px ON COMMIT DROP AS
  SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-xtra_0009',
    '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 2.0, "price": 1, "restaurantId": "42000000-0000-0000-0000-0000000000b2"}]', NULL) AS r;
RESET ROLE;
SELECT is((SELECT items FROM public.carta_table_proposals WHERE id = (SELECT (r ->> 'proposalId')::uuid FROM t420_px)),
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 2, "optionIds": [], "note": null}]'::jsonb,
  'unknown keys are dropped and 2.0 is stored as 2');
ROLLBACK TO SAVEPOINT t420_extra;

-- ============================================
-- 3. guest_submit_proposal: every rejection, no row written
-- ============================================
CREATE TEMP TABLE t420_count ON COMMIT DROP AS SELECT count(*) AS n FROM public.carta_table_proposals;
UPDATE public.carta_settings SET table_ordering_enabled = false WHERE restaurant_id = '42000000-0000-0000-0000-0000000000b2';
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-c', pg_temp.tk('c1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0002', 'guest_submit_proposal: carta_not_found', 'an unpublished carta is not found');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('nope', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0002', 'guest_submit_proposal: carta_not_found', 'an unknown slug is not found');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('b1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0002', 'guest_submit_proposal: table_not_found', 'another restaurant''s token is not found');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', 'AAAAAAAAAAAAAAAAAAAAAAAA', 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0002', 'guest_submit_proposal: table_not_found', 'an unknown token is not found');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-b', pg_temp.tk('b1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-0000000000b1", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: table_ordering_disabled', 'table ordering off refuses proposals');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a2'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: table_not_open', 'a table without an open order refuses proposals');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'short',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  '22023', 'guest_submit_proposal: guest_key_invalid', 'a guest key has at least 16 characters');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest key with spaces',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  '22023', 'guest_submit_proposal: guest_key_invalid', 'a guest key is [A-Za-z0-9_-]');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), repeat('k', 65),
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  '22023', 'guest_submit_proposal: guest_key_invalid', 'a guest key has at most 64 characters');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '{}', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'items must be an array');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'items need at least one line');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  (SELECT jsonb_agg('{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}'::jsonb) FROM generate_series(1, 21)), NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'items have at most 20 lines');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 0}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'quantity is at least 1');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 21}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'quantity is at most 20');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1.5}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'quantity is an integer');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "not-a-uuid", "quantity": 1}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'dishId is a uuid');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  jsonb_build_array(jsonb_build_object('dishId', '42300000-0000-0000-0000-000000000003', 'quantity', 1, 'note', repeat('n', 141))), NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'a line note has at most 140 characters');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000001"]}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'an option id appears once per line');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', repeat('n', 201)) $$,
  '22023', 'guest_submit_proposal: note_invalid', 'the proposal note has at most 200 characters');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-0000000000b1", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: dish_unavailable', 'a dish of another restaurant is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000002", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: dish_unavailable', 'an inactive dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000004", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: dish_unavailable', 'a sold-out dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-00000000ffff", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: dish_unavailable', 'an unknown dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000007"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'an option of a group not linked to the dish is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000005"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'an option of an inactive group is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000006"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'an inactive option is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-0000000000b1"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'an option of another restaurant is refused');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1, "optionIds": ["42410000-0000-0000-0000-000000000003"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'a required group needs its minimum');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1,
     "optionIds": ["42410000-0000-0000-0000-000000000001", "42410000-0000-0000-0000-000000000002"]}]', NULL) $$,
  'P0001', 'guest_submit_proposal: options_invalid', 'a group allows at most max_select options');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1, "optionIds": "x"}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'optionIds is an array');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a nested array line');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[null]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a null line');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '["x"]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a string line');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": "2"}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a string quantity');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": true}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a boolean quantity');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": -1}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a negative quantity');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": 123, "quantity": 1}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a numeric dishId');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1, "optionIds": [null]}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a null option id');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1, "optionIds": [["42410000-0000-0000-0000-000000000001"]]}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: a nested option array');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000001", "quantity": 1, "optionIds": ["42410000-0000-0000-0000-000000000001", "{42410000-0000-0000-0000-000000000001}"]}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: an option id duplicated in brace form');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1, "note": {"a": 1}}]', NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: an object note');
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001', NULL, NULL) $$,
  '22023', 'guest_submit_proposal: items_invalid', 'crafted items: null items');
RESET ROLE;
UPDATE public.carta_settings SET table_ordering_enabled = true WHERE restaurant_id = '42000000-0000-0000-0000-0000000000b2';
SELECT is((SELECT count(*) FROM public.carta_table_proposals), (SELECT n FROM t420_count),
  'rejected proposals leave no row');

-- At most 3 pending proposals for the table's open order.
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_p2 ON COMMIT DROP AS
  SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001',
    '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) AS r;
CREATE TEMP TABLE t420_p3 ON COMMIT DROP AS
  SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002',
    '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 3}]', NULL) AS r;
SELECT throws_ok($$ SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002',
  '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) $$,
  'P0001', 'guest_submit_proposal: too_many_pending', 'a fourth pending proposal for the table is refused');
SELECT lives_ok($$ SELECT private.guest_submit_proposal('t420-b', pg_temp.tk('b1'), 'guest-key-one_0001',
  '[{"dishId": "42300000-0000-0000-0000-0000000000b1", "quantity": 1}]', NULL) $$,
  'another restaurant''s table has its own pending limit');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_table_proposals WHERE table_id = '42800000-0000-0000-0000-000000000001'), 3::bigint,
  'the refused fourth proposal left no row');

-- ============================================
-- 4. guest_table_status (S12): guest key isolation
-- ============================================
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_s1 ON COMMIT DROP AS
  SELECT private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') AS s;
CREATE TEMP TABLE t420_s2 ON COMMIT DROP AS
  SELECT private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') AS s;
SELECT is((SELECT jsonb_build_object('o', s -> 'isOpen', 'w', s -> 'waiterFirstName', 'e', s -> 'tableOrderingEnabled',
                                     'b', s -> 'showTableBill', 'r', s -> 'requests') FROM t420_s1),
  '{"o": true, "w": "Carolina", "e": true, "b": true, "r": []}'::jsonb,
  'status: open, the waiter''s first name only, the switches and no requests');
SELECT is((SELECT jsonb_array_length(s -> 'proposals') FROM t420_s1), 2, 'a guest sees only their two proposals');
SELECT is((SELECT p ->> 'stage' FROM t420_s2, jsonb_array_elements(s -> 'proposals') p), 'pending', 'stage: pending before a decision');
SELECT is((SELECT jsonb_agg(p ->> 'id' ORDER BY p ->> 'id') FROM t420_s2, jsonb_array_elements(s -> 'proposals') p),
  (SELECT jsonb_agg(r ->> 'proposalId') FROM t420_p3), 'another guest key sees only its own proposal');
SELECT is((SELECT p -> 'lines' FROM t420_s1, jsonb_array_elements(s -> 'proposals') p
            WHERE p ->> 'id' = (SELECT r ->> 'proposalId' FROM t420_p1)),
  '[{"name": "Bandeja", "quantity": 2}, {"name": "Limonada", "quantity": 20}]'::jsonb,
  'proposal lines carry the dish name and quantity');
SELECT is((SELECT array_agg(k ORDER BY k) FROM t420_s1, jsonb_array_elements(s -> 'proposals') p, jsonb_object_keys(p) k
            WHERE p ->> 'id' = (SELECT r ->> 'proposalId' FROM t420_p1)),
  ARRAY['createdAt', 'decidedAt', 'id', 'lines', 'rejectReason', 'stage', 'status'], 'a proposal has exactly the documented keys');
SELECT ok((SELECT s::text !~ '(42100000|42000000-0000-0000-0000-00000000000|Pérez|guest-key)' FROM t420_s1),
  'status carries no staff ids, surname or guest key');
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a2'), 'guest-key-one_0001'),
  '{"isOpen": false, "waiterFirstName": null, "tableOrderingEnabled": true, "showTableBill": true, "proposals": [], "requests": []}'::jsonb,
  'a closed table: not open, no waiter, no proposals');
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('b1'), 'guest-key-one_0001'), NULL, 'another restaurant''s token gives NULL');
SELECT is(private.guest_table_status('t420-c', pg_temp.tk('c1'), 'guest-key-one_0001'), NULL, 'an unpublished carta gives NULL');
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'bad'), NULL, 'an invalid guest key gives NULL');
RESET ROLE;

-- ============================================
-- 5. guest_request (S14): bill / waiter, idempotent
-- ============================================
SET LOCAL ROLE vipe_api;
SELECT is((SELECT r - 'createdAt' FROM private.guest_request('t420-a', pg_temp.tk('a1'), 'bill') r),
  '{"kind": "bill", "alreadyPending": false}'::jsonb, 'the first bill request is new');
SELECT is((SELECT r - 'createdAt' FROM private.guest_request('t420-a', pg_temp.tk('a1'), 'bill') r),
  '{"kind": "bill", "alreadyPending": true}'::jsonb, 'a repeated bill request is already pending');
SELECT is((SELECT r - 'createdAt' FROM private.guest_request('t420-a', pg_temp.tk('a1'), 'waiter') r),
  '{"kind": "waiter", "alreadyPending": false}'::jsonb, 'calling the waiter is a separate request');
SELECT throws_ok($$ SELECT private.guest_request('t420-a', pg_temp.tk('a1'), 'dessert') $$,
  '22023', 'guest_request: kind_invalid', 'kind is bill or waiter');
SELECT throws_ok($$ SELECT private.guest_request('t420-a', pg_temp.tk('a2'), 'bill') $$,
  'P0001', 'guest_request: table_not_open', 'a closed table cannot ask for the bill');
SELECT throws_ok($$ SELECT private.guest_request('t420-a', pg_temp.tk('b1'), 'bill') $$,
  'P0002', 'guest_request: table_not_found', 'another restaurant''s token is not found');
SELECT throws_ok($$ SELECT private.guest_request('t420-c', pg_temp.tk('c1'), 'bill') $$,
  'P0002', 'guest_request: carta_not_found', 'an unpublished carta is not found');
RESET ROLE;
UPDATE public.carta_settings SET table_ordering_enabled = false WHERE restaurant_id = '42000000-0000-0000-0000-0000000000b2';
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.guest_request('t420-b', pg_temp.tk('b1'), 'bill') $$,
  'P0001', 'guest_request: table_ordering_disabled', 'table ordering off refuses requests');
RESET ROLE;
UPDATE public.carta_settings SET table_ordering_enabled = true WHERE restaurant_id = '42000000-0000-0000-0000-0000000000b2';
SELECT is((SELECT count(*) FROM public.carta_table_requests), 2::bigint, 'two unresolved requests, refused ones left no row');
CREATE TEMP TABLE t420_req ON COMMIT DROP AS SELECT id, kind FROM public.carta_table_requests;
GRANT SELECT ON t420_req TO vipe_api;
SELECT is((SELECT jsonb_build_object('r', restaurant_id, 't', table_id, 'resolved', resolved_at) FROM public.carta_table_requests WHERE kind = 'bill'),
  '{"r": "42000000-0000-0000-0000-0000000000a1", "t": "42800000-0000-0000-0000-000000000001", "resolved": null}'::jsonb,
  'the request row belongs to the resolved restaurant and table');
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') -> 'requests', '["bill", "waiter"]'::jsonb,
  'status lists the unresolved request kinds');
RESET ROLE;

-- ============================================
-- 6. guest_table_bill (S13)
-- ============================================
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_b ON COMMIT DROP AS SELECT private.guest_table_bill('t420-a', pg_temp.tk('a1')) AS b;
SELECT is((SELECT b - 'updatedAt' FROM t420_b),
  '{"lines": [{"name": "Bandeja", "quantity": 2, "unitPrice": 20000, "lineTotal": 40000},
              {"name": "Limonada", "quantity": 1, "unitPrice": 5000, "lineTotal": 5000}],
    "discounts": [{"label": "Cortesía cumpleaños", "amount": 3000}],
    "grossSubtotal": 45000, "totalDiscounts": 3000, "subtotal": 42000, "tipPercentage": 12}'::jsonb,
  'the bill lists non-voided lines, live discount labels and totals');
SELECT ok((SELECT (b ->> 'updatedAt')::timestamptz IS NOT NULL FROM t420_b), 'the bill carries updatedAt');
SELECT ok((SELECT b::text !~ '(secreto|anulada|4210000|4290000|4291000|42000000)' FROM t420_b),
  'the bill carries no reason, voided line, ids of staff, order or items');
SELECT is(private.guest_table_bill('t420-a', pg_temp.tk('a2')), NULL, 'a closed table has no bill');
SELECT is(private.guest_table_bill('t420-a', pg_temp.tk('b1')), NULL, 'another restaurant''s token has no bill');
SELECT is(private.guest_table_bill('t420-c', pg_temp.tk('c1')), NULL, 'an unpublished carta has no bill');
RESET ROLE;
UPDATE public.carta_settings SET show_table_bill = false WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1';
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table_bill('t420-a', pg_temp.tk('a1')), NULL, 'show_table_bill off hides the bill');
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') -> 'showTableBill', 'false'::jsonb,
  'status reports showTableBill');
RESET ROLE;
UPDATE public.carta_settings SET show_table_bill = true WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1';

-- ============================================
-- 7. Staff read, no direct writes, realtime row
-- ============================================
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_table_proposals), 3::bigint, 'a waiter reads the proposals of their restaurant only');
SELECT is((SELECT count(*) FROM public.carta_table_requests), 2::bigint, 'a waiter reads the requests of their restaurant');
SELECT throws_ok($$ INSERT INTO public.carta_table_proposals (restaurant_id, table_id, order_id, guest_key, items)
  VALUES ('42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000001', '42900000-0000-0000-0000-000000000001',
          'guest-key-one_0001', '[]') $$, '42501', NULL, 'vipe_api cannot insert proposals');
SELECT throws_ok($$ UPDATE public.carta_table_proposals SET status = 'confirmed' $$, '42501', NULL, 'vipe_api cannot update proposals');
SELECT throws_ok($$ INSERT INTO public.carta_table_requests (restaurant_id, table_id, kind)
  VALUES ('42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000002', 'bill') $$, '42501', NULL, 'vipe_api cannot insert requests');
SELECT throws_ok($$ UPDATE public.carta_table_requests SET resolved_at = now() $$, '42501', NULL, 'vipe_api cannot update requests');
SELECT throws_ok($$ INSERT INTO public.carta_feedback (restaurant_id, rating) VALUES ('42000000-0000-0000-0000-0000000000a1', 5) $$,
  '42501', NULL, 'vipe_api cannot insert feedback');
SELECT is((private.realtime_row('carta_table_proposals', (SELECT (r ->> 'proposalId')::uuid FROM t420_p1))) ->> 'restaurant_id',
  '42000000-0000-0000-0000-0000000000a1', 'realtime_row loads a proposal for the staff room');
SELECT is((private.realtime_row('carta_table_requests', (SELECT id FROM t420_req WHERE kind = 'bill'))) ->> 'kind',
  'bill', 'realtime_row loads a request for the staff room');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_table_proposals WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another restaurant''s waiter reads none of A''s proposals');
SELECT is((SELECT count(*) FROM public.carta_table_requests WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1'), 0::bigint,
  'another restaurant''s waiter reads none of A''s requests');
RESET ROLE;
SELECT ok((SELECT private.change_payload('carta_table_proposals', 'INSERT', to_jsonb(p), NULL)
                  = jsonb_build_object('table', 'carta_table_proposals', 'op', 'INSERT', 'id', p.id::text, 'restaurant_id', p.restaurant_id::text)
             FROM public.carta_table_proposals p WHERE p.id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p1)),
  'the notify payload names the table, id and restaurant room');

-- ============================================
-- 8. confirm / reject / resolve (S12, S14)
-- ============================================
-- Kitchen and delivery operators do not take table orders: only waiter, cashier and admin.
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) $$,
  '42501', 'confirm_table_proposal: role_not_allowed', 'kitchen cannot confirm');
SELECT throws_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), NULL) $$,
  '42501', 'reject_table_proposal: role_not_allowed', 'kitchen cannot reject');
SELECT throws_ok($$ SELECT private.resolve_table_request((SELECT id FROM t420_req WHERE kind = 'bill')) $$,
  '42501', 'resolve_table_request: role_not_allowed', 'kitchen cannot resolve a request');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000006', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) $$,
  '42501', 'confirm_table_proposal: role_not_allowed', 'a delivery operator cannot confirm');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) $$,
  '42501', 'confirm_table_proposal: role_not_allowed', 'a guest (no app.user_id) cannot confirm');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) $$,
  'P0002', 'confirm_table_proposal: proposal_not_found', 'another restaurant''s waiter gets not found');
SELECT throws_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), NULL) $$,
  'P0002', 'reject_table_proposal: proposal_not_found', 'another restaurant''s waiter cannot reject');
SELECT throws_ok($$ SELECT private.resolve_table_request((SELECT id FROM t420_req WHERE kind = 'bill')) $$,
  'P0002', 'resolve_table_request: request_not_found', 'another restaurant''s waiter cannot resolve');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_table_proposals WHERE status = 'pending' AND table_id = '42800000-0000-0000-0000-000000000001'), 3::bigint,
  'refused decisions change nothing');

SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
CREATE TEMP TABLE t420_c ON COMMIT DROP AS
  SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) AS c;
SELECT is((SELECT c FROM t420_c),
  jsonb_build_object('proposalId', (SELECT r ->> 'proposalId' FROM t420_p3), 'orderId', '42900000-0000-0000-0000-000000000001',
    'tableId', '42800000-0000-0000-0000-000000000001', 'note', NULL,
    'items', '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 3, "optionIds": [], "note": null}]'::jsonb),
  'a waiter confirms: {proposalId, orderId, tableId, note, items} for the API');
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p3)) $$,
  'P0001', 'confirm_table_proposal: proposal_not_pending', 'a double confirm is refused');
SELECT throws_ok($$ SELECT private.confirm_table_proposal('42000000-0000-0000-0000-00000000ffff') $$,
  'P0002', 'confirm_table_proposal: proposal_not_found', 'an unknown proposal is not found');
RESET ROLE;
SELECT is((SELECT jsonb_build_object('s', status, 'by', decided_by, 'at', decided_at IS NOT NULL) FROM public.carta_table_proposals
            WHERE id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p3)),
  '{"s": "confirmed", "by": "42100000-0000-0000-0000-000000000002", "at": true}'::jsonb, 'confirmed with decided_at and the deciding profile');

-- F1: link the order items the API added on confirm; the guest then sees kitchen and served.
INSERT INTO public.order_items (id, restaurant_id, order_id, dish_id, name, price, quantity) VALUES
  ('42910000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001',
   '42300000-0000-0000-0000-000000000003', 'Limonada', 5000, 2),
  ('42910000-0000-0000-0000-000000000005', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000001',
   '42300000-0000-0000-0000-000000000003', 'Limonada', 5000, 1),
  ('42910000-0000-0000-0000-000000000031', '42000000-0000-0000-0000-0000000000a1', '42900000-0000-0000-0000-000000000003',
   '42300000-0000-0000-0000-000000000003', 'Limonada', 5000, 1),
  ('42910000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b2', '42900000-0000-0000-0000-0000000000b1',
   '42300000-0000-0000-0000-0000000000b1', 'Plato B', 9000, 1);
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'confirmed', 'stage: confirmed while no items are linked');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000003', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), ARRAY['42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  '42501', 'link_table_proposal_items: role_not_allowed', 'kitchen cannot link items');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000005', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), ARRAY['42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  'P0002', 'link_table_proposal_items: proposal_not_found', 'another restaurant''s waiter gets not found');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p1), ARRAY['42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  'P0001', 'link_table_proposal_items: proposal_not_confirmed', 'a pending proposal cannot be linked');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), '{}'::uuid[]) $$,
  '22023', 'link_table_proposal_items: items_invalid', 'at least one item id');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), NULL) $$,
  '22023', 'link_table_proposal_items: items_invalid', 'item ids are required');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3),
  (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 61))) $$,
  '22023', 'link_table_proposal_items: items_invalid', 'at most 60 item ids');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3),
  ARRAY['42910000-0000-0000-0000-000000000004', '42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  '22023', 'link_table_proposal_items: items_invalid', 'no duplicated item ids');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3),
  ARRAY['42910000-0000-0000-0000-000000000004', '42910000-0000-0000-0000-000000000031']::uuid[]) $$,
  'P0001', 'link_table_proposal_items: item_not_in_order', 'an item of another order is refused');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3),
  ARRAY['42910000-0000-0000-0000-0000000000b1']::uuid[]) $$,
  'P0001', 'link_table_proposal_items: item_not_in_order', 'an item of another restaurant is refused');
RESET ROLE;
SELECT is((SELECT order_item_ids FROM public.carta_table_proposals WHERE id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p3)), NULL,
  'refused links store nothing');
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3),
  ARRAY['42910000-0000-0000-0000-000000000005', '42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  'a waiter links the confirmed proposal to its order items');
SELECT throws_ok($$ SELECT private.link_table_proposal_items((SELECT (r ->> 'proposalId')::uuid FROM t420_p3), ARRAY['42910000-0000-0000-0000-000000000004']::uuid[]) $$,
  'P0001', 'link_table_proposal_items: proposal_already_linked', 'a proposal is linked once');
RESET ROLE;
SELECT is((SELECT order_item_ids FROM public.carta_table_proposals WHERE id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p3)),
  ARRAY['42910000-0000-0000-0000-000000000004', '42910000-0000-0000-0000-000000000005']::uuid[], 'the linked item ids are stored (sorted)');
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'kitchen', 'stage: kitchen while a linked item is in the kitchen');
RESET ROLE;
UPDATE public.order_items SET status = 'served' WHERE id = '42910000-0000-0000-0000-000000000004';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'kitchen', 'stage: still kitchen while one linked item is unserved');
RESET ROLE;
UPDATE public.order_items SET status = 'cancelled', quantity = 0 WHERE id = '42910000-0000-0000-0000-000000000005';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'served', 'stage: served once every non-voided linked item is served');
RESET ROLE;
-- N1: when every linked item is voided the guest is not told "Servido".
UPDATE public.order_items SET status = 'cancelled', quantity = 0 WHERE id = '42910000-0000-0000-0000-000000000004';
SET LOCAL ROLE vipe_api;
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'cancelled', 'stage: cancelled when every linked item was voided');
RESET ROLE;
UPDATE public.order_items SET status = 'served', quantity = 1 WHERE id = '42910000-0000-0000-0000-000000000004';

SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000004', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p2), repeat('r', 141)) $$,
  '22023', 'reject_table_proposal: reason_invalid', 'a reject reason has at most 140 characters');
SELECT lives_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p2), '  Ya no hay limonada  ') $$,
  'a cashier rejects with a reason');
SELECT throws_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p2), NULL) $$,
  'P0001', 'reject_table_proposal: proposal_not_pending', 'a rejected proposal cannot be rejected again');
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p2)) $$,
  'P0001', 'confirm_table_proposal: proposal_not_pending', 'a rejected proposal cannot be confirmed');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT jsonb_build_object('s', p ->> 'status', 'r', p ->> 'rejectReason', 'd', (p ->> 'decidedAt') IS NOT NULL)
             FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') -> 'proposals') p
            WHERE p ->> 'id' = (SELECT r ->> 'proposalId' FROM t420_p2)),
  '{"s": "rejected", "r": "Ya no hay limonada", "d": true}'::jsonb, 'the guest sees the rejection, its reason and time');
SELECT is((SELECT p ->> 'stage' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') -> 'proposals') p
            WHERE p ->> 'id' = (SELECT r ->> 'proposalId' FROM t420_p2)), 'rejected', 'stage: rejected');
SELECT is((SELECT p ->> 'status' FROM jsonb_array_elements(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-two_0002') -> 'proposals') p),
  'confirmed', 'the other guest sees their confirmation');
-- Table 3: a pending proposal whose order is closed before the waiter confirms.
CREATE TEMP TABLE t420_p4 ON COMMIT DROP AS
  SELECT private.guest_submit_proposal('t420-a', pg_temp.tk('a3'), 'guest-key-three_003',
    '[{"dishId": "42300000-0000-0000-0000-000000000003", "quantity": 1}]', NULL) AS r;
RESET ROLE;
UPDATE public.orders SET status = 'cancelled' WHERE id = '42900000-0000-0000-0000-000000000003';
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.confirm_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p4)) $$,
  'P0001', 'confirm_table_proposal: order_not_open', 'a proposal of a closed order cannot be confirmed');
SELECT lives_ok($$ SELECT private.reject_table_proposal((SELECT (r ->> 'proposalId')::uuid FROM t420_p4), NULL) $$,
  'an admin can still reject it (reason optional)');
RESET ROLE;
SELECT is((SELECT jsonb_build_object('s', status, 'r', reject_reason) FROM public.carta_table_proposals WHERE id = (SELECT (r ->> 'proposalId')::uuid FROM t420_p4)),
  '{"s": "rejected", "r": null}'::jsonb, 'the refused confirm left it pending until rejected');
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a3'), 'guest-key-three_003') -> 'proposals', '[]'::jsonb,
  'after the order closes the guest sees no proposals of it');
RESET ROLE;

-- Resolve a request: a new one can then be asked.
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.resolve_table_request((SELECT id FROM t420_req WHERE kind = 'bill')) $$,
  'a waiter resolves the bill request');
SELECT lives_ok($$ SELECT private.resolve_table_request((SELECT id FROM t420_req WHERE kind = 'bill')) $$,
  'resolving twice is a no-op');
SELECT throws_ok($$ SELECT private.resolve_table_request('42000000-0000-0000-0000-00000000ffff') $$,
  'P0002', 'resolve_table_request: request_not_found', 'an unknown request is not found');
RESET ROLE;
SELECT is((SELECT jsonb_build_object('by', resolved_by, 'at', resolved_at IS NOT NULL) FROM public.carta_table_requests WHERE kind = 'bill'),
  '{"by": "42100000-0000-0000-0000-000000000002", "at": true}'::jsonb, 'resolved with resolved_at and the profile');
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a1'), 'guest-key-one_0001') -> 'requests', '["waiter"]'::jsonb,
  'a resolved request leaves the status');
SELECT is((SELECT r ->> 'alreadyPending' FROM private.guest_request('t420-a', pg_temp.tk('a1'), 'bill') r), 'false',
  'after resolving, the bill can be asked again');
RESET ROLE;

-- ============================================
-- 9. guest_feedback (S14): limits
-- ============================================
CREATE TEMP TABLE t420_fc ON COMMIT DROP AS SELECT count(*) AS n FROM public.carta_feedback;
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', NULL, 0, NULL) $$, '22023', 'guest_feedback: rating_invalid', 'rating is at least 1');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', NULL, 6, NULL) $$, '22023', 'guest_feedback: rating_invalid', 'rating is at most 5');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', NULL, 5, repeat('c', 501)) $$, '22023', 'guest_feedback: comment_invalid',
  'a comment has at most 500 characters');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-c', NULL, 5, NULL) $$, 'P0002', 'guest_feedback: carta_not_found', 'an unpublished carta takes no feedback');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('b1'), 5, NULL) $$, 'P0002', 'guest_feedback: table_not_found',
  'a token of another restaurant is refused');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_feedback), (SELECT n FROM t420_fc), 'refused feedback left no row');
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 5, '  ¡Muy rico!  ') $$, 'feedback with a table and comment');
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 1, '') $$, 'low ratings are taken too (no gating)');
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 4, NULL) $$, 'third');
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 4, NULL) $$, 'fourth');
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 4, NULL) $$, 'fifth');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a1'), 4, NULL) $$, 'P0001', 'guest_feedback: too_many_feedback',
  'a sixth feedback for the table within the hour is refused');
RESET ROLE;
SELECT is((SELECT jsonb_agg(jsonb_build_object('t', table_id, 'r', rating, 'c', comment) ORDER BY rating DESC) FROM public.carta_feedback
            WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1' AND rating IN (1, 5)),
  '[{"t": "42800000-0000-0000-0000-000000000001", "r": 5, "c": "¡Muy rico!"}, {"t": "42800000-0000-0000-0000-000000000001", "r": 1, "c": null}]'::jsonb,
  'feedback rows keep table, rating and trimmed comment (empty = null)');
-- Older feedback does not count; the restaurant takes at most 50 within the hour.
INSERT INTO public.carta_feedback (restaurant_id, table_id, rating, created_at)
  SELECT '42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000002', 3, now() - interval '61 minutes' FROM generate_series(1, 10);
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', pg_temp.tk('a2'), 3, NULL) $$, 'feedback older than an hour does not count');
RESET ROLE;
INSERT INTO public.carta_feedback (restaurant_id, rating)
  SELECT '42000000-0000-0000-0000-0000000000a1', 3 FROM generate_series(1, 49 - (
    SELECT count(*)::int FROM public.carta_feedback
     WHERE restaurant_id = '42000000-0000-0000-0000-0000000000a1' AND created_at > now() - interval '1 hour'));
SET LOCAL ROLE vipe_api;
SELECT lives_ok($$ SELECT private.guest_feedback('t420-a', NULL, 3, NULL) $$, 'the 50th feedback of the hour is taken');
SELECT throws_ok($$ SELECT private.guest_feedback('t420-a', NULL, 3, NULL) $$, 'P0001', 'guest_feedback: too_many_feedback',
  'the 51st feedback of the restaurant within the hour is refused');
SELECT lives_ok($$ SELECT private.guest_feedback('t420-b', NULL, 3, NULL) $$, 'another restaurant has its own limit');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_feedback), 60::bigint, 'an admin reads the feedback of their restaurant only');
RESET ROLE;
SELECT set_config('app.user_id', '42000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT count(*) FROM public.carta_feedback), 0::bigint, 'a waiter reads no feedback');
RESET ROLE;

-- ============================================
-- 10. F2: requests belong to the open order, not the table
-- ============================================
INSERT INTO public.orders (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('42900000-0000-0000-0000-000000000005', '42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000002', 'active', 0, 0, 0, 0, 0, 0);
SELECT set_config('app.user_id', '', true);
SET LOCAL ROLE vipe_api;
SELECT is((SELECT r ->> 'alreadyPending' FROM private.guest_request('t420-a', pg_temp.tk('a2'), 'bill') r), 'false', 'the first party asks for the bill');
RESET ROLE;
SELECT is((SELECT order_id FROM public.carta_table_requests WHERE table_id = '42800000-0000-0000-0000-000000000002'),
  '42900000-0000-0000-0000-000000000005'::uuid, 'the request belongs to the open order');
UPDATE public.orders SET status = 'paid' WHERE id = '42900000-0000-0000-0000-000000000005';
INSERT INTO public.orders (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total) VALUES
  ('42900000-0000-0000-0000-000000000006', '42000000-0000-0000-0000-0000000000a1', '42800000-0000-0000-0000-000000000002', 'active', 0, 0, 0, 0, 0, 0);
SET LOCAL ROLE vipe_api;
SELECT is(private.guest_table_status('t420-a', pg_temp.tk('a2'), 'guest-key-one_0001') -> 'requests', '[]'::jsonb,
  'the next party does not inherit the unresolved request');
SELECT is((SELECT r ->> 'alreadyPending' FROM private.guest_request('t420-a', pg_temp.tk('a2'), 'bill') r), 'false',
  'the next party''s bill request is new');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.carta_table_requests WHERE table_id = '42800000-0000-0000-0000-000000000002' AND resolved_at IS NULL), 2::bigint,
  'a new row for the new order');

SELECT * FROM finish();
ROLLBACK;
