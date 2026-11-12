-- Transfer documents through an in-transit holding (odd/tasks/inventario-rediseno.md T2, S3).
--
-- public.inventory_transfers / inventory_transfer_lines are the document;
-- public.inventory_transit_lots holds the lot portions a send took from the
-- origin. Transit portions are not inventory_lots rows, so they are never
-- available, consumable, counted or part of ingredients.stock. Pins the
-- tables, RLS (admin of the tenant reads, nobody writes directly), the RPC
-- grants, the status machine draft -> in_transit -> received |
-- received_short, draft | in_transit -> cancelled, the stock effects of each
-- step and tenant isolation.
--
-- Every RPC call goes through the pg_temp sentinels so the file stays a
-- complete RED on a database without the migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(64);

CREATE FUNCTION pg_temp.q(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
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

CREATE FUNCTION pg_temp.state(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    RETURN SQLSTATE;
  END;
  RETURN 'ok';
END;
$$;

CREATE FUNCTION pg_temp.run(p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.state(p_sql);
END;
$$;

CREATE FUNCTION pg_temp.as_user(p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.user_id', p_user, true)
$$;

-- ============================================
-- 1. Tables, RLS, policies and grants
-- ============================================
SELECT has_table('public', 'inventory_transfers', 'inventory_transfers exists');
SELECT has_table('public', 'inventory_transfer_lines', 'inventory_transfer_lines exists');
SELECT has_table('public', 'inventory_transit_lots', 'inventory_transit_lots exists');
SELECT columns_are('public', 'inventory_transfers',
  ARRAY['id', 'restaurant_id', 'number', 'from_location_id', 'to_location_id', 'status', 'notes', 'created_by',
        'sent_by', 'sent_at', 'received_by', 'received_at', 'cancelled_by', 'cancelled_at', 'created_at', 'updated_at'],
  'inventory_transfers has the document columns');
SELECT columns_are('public', 'inventory_transfer_lines',
  ARRAY['id', 'restaurant_id', 'transfer_id', 'ingredient_id', 'requested_quantity', 'received_quantity',
        'shortfall_reason', 'created_at', 'updated_at'],
  'inventory_transfer_lines has the line columns');
SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class
            WHERE oid IN ('public.inventory_transfers'::regclass, 'public.inventory_transfer_lines'::regclass,
                          'public.inventory_transit_lots'::regclass)),
  'the three tables have row level security');
SELECT policies_are('public', 'inventory_transfers', ARRAY['inventory_transfers_select_policy'],
  'transfers: a SELECT policy only, writes go through the RPCs');
SELECT policies_are('public', 'inventory_transfer_lines', ARRAY['inventory_transfer_lines_select_policy'],
  'transfer lines: a SELECT policy only');
SELECT policies_are('public', 'inventory_transit_lots', ARRAY['inventory_transit_lots_select_policy'],
  'transit lots: a SELECT policy only');
SELECT ok(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_inventory_transfer', 'update_inventory_transfer', 'send_inventory_transfer',
                        'receive_inventory_transfer', 'cancel_inventory_transfer')
      AND p.prosecdef
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)) = 5,
  'the five transfer RPCs are SECURITY DEFINER, executable by vipe_api and not by PUBLIC');
SELECT ok(
  (SELECT bool_and(NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AND p.proacl IS NOT NULL)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'inventory_transfer_%'),
  'the private transfer helpers are not executable by PUBLIC');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('40000000-0000-0000-0000-0000000000a1', 't400-a', 'T400 A'),
  ('40000000-0000-0000-0000-0000000000b2', 't400-b', 'T400 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('40000000-0000-0000-0000-000000000001', 'admin@t400a.test', 'h'),
  ('40000000-0000-0000-0000-000000000002', 'admin@t400b.test', 'h'),
  ('40000000-0000-0000-0000-000000000003', 'waiter@t400a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('40100000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t400a.test', 'admin', true, '40000000-0000-0000-0000-0000000000a1'),
  ('40100000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t400b.test', 'admin', true, '40000000-0000-0000-0000-0000000000b2'),
  ('40100000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'Mesero A', 'waiter@t400a.test', 'waiter', true, '40000000-0000-0000-0000-0000000000a1');
INSERT INTO public.inventory_locations (id, restaurant_id, name, code) VALUES
  ('40200000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', 'Barra', 'BARRA');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind) VALUES
  ('40300000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000a1', 'Harina', 'kg', 'raw'),
  ('40300000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-0000000000a1', 'Queso', 'kg', 'raw'),
  ('40300000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-0000000000b2', 'Harina B', 'kg', 'raw');

CREATE TEMP TABLE ids (k text PRIMARY KEY, v text);
GRANT ALL ON ids TO vipe_api;
INSERT INTO ids
SELECT 'origin', id::text FROM public.inventory_locations
 WHERE restaurant_id = '40000000-0000-0000-0000-0000000000a1' AND is_default;
INSERT INTO ids
SELECT 'originB', id::text FROM public.inventory_locations
 WHERE restaurant_id = '40000000-0000-0000-0000-0000000000b2' AND is_default;

SET LOCAL ROLE vipe_api;
SELECT pg_temp.as_user('40000000-0000-0000-0000-000000000001');
-- Harina: L1 4 kg (expires first) and L2 6 kg at the origin; Queso: 5 kg in the general lot.
SELECT pg_temp.run(format($$SELECT public.inventory_adjust('40300000-0000-0000-0000-000000000001', %L, 'opening', 4, 1000, NULL, NULL, NULL, 'L1', '2030-01-10')$$, (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run(format($$SELECT public.inventory_adjust('40300000-0000-0000-0000-000000000001', %L, 'opening', 6, 1200, NULL, NULL, NULL, 'L2', '2030-02-10')$$, (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run(format($$SELECT public.inventory_adjust('40300000-0000-0000-0000-000000000002', %L, 'opening', 5, 500)$$, (SELECT v FROM ids WHERE k = 'origin')));

-- ============================================
-- 3. Create and update a draft
-- ============================================
SELECT throws_ok(
  $$ INSERT INTO public.inventory_transfers (number, from_location_id, to_location_id)
     VALUES (99, (SELECT v::uuid FROM ids WHERE k = 'origin'), '40200000-0000-0000-0000-0000000000a2') $$,
  '42501', NULL, 'an admin cannot insert a transfer directly');

INSERT INTO ids SELECT 't1', pg_temp.q(format($$
  SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2',
    '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 3}]', 'para la barra')->>'transfer_id'$$,
  (SELECT v FROM ids WHERE k = 'origin')));
SELECT is(
  pg_temp.q($$SELECT row(number, status, notes, created_by)::text FROM public.inventory_transfers
             WHERE id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  '(1,draft,"para la barra",40100000-0000-0000-0000-000000000001)',
  'create opens draft #1 with the notes and the creator');
SELECT is(
  pg_temp.q($$SELECT string_agg(ingredient_id || ':' || requested_quantity, ',') FROM public.inventory_transfer_lines
             WHERE transfer_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  '40300000-0000-0000-0000-000000000001:3.000',
  'create stores the requested lines');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%1$L, %1$L, '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  '22023', 'origin and destination must differ');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 0}]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  '22023', 'a quantity must be positive');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  '22023', 'a transfer needs at least one line');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2',
    '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}, {"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 2}]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  '22023', 'an item appears once per transfer');
SELECT is(
  pg_temp.q(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 11}]')::text$$,
            (SELECT v FROM ids WHERE k = 'origin'))),
  '<error: P0001 Stock insuficiente en la bodega de origen: Harina (disponible 10.000 kg, solicitado 11.000 kg)>',
  'a quantity above the origin stock is refused in Spanish');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}]')$$,
                (SELECT v FROM ids WHERE k = 'originB'))),
  'P0002', 'a location of another restaurant is not found');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000009", "quantity": 1}]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  'P0002', 'an item of another restaurant is not found');
SELECT is(
  (SELECT count(*)::int FROM public.inventory_transfers), 1, 'the refused creates left nothing behind');

SELECT is(
  pg_temp.state(format($$SELECT public.update_inventory_transfer(%L::uuid, %L, '40200000-0000-0000-0000-0000000000a2',
    '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 5}, {"item_id": "40300000-0000-0000-0000-000000000002", "quantity": 1}]', NULL)$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'origin'))),
  'ok', 'update replaces the lines of a draft');
SELECT is(
  pg_temp.q($$SELECT string_agg(i.name || ':' || l.requested_quantity, ',' ORDER BY i.name) || '|' || coalesce(t.notes, '-')
               FROM public.inventory_transfer_lines l JOIN public.ingredients i ON i.id = l.ingredient_id
               JOIN public.inventory_transfers t ON t.id = l.transfer_id
              WHERE t.id::text = (SELECT v FROM ids WHERE k = 't1') GROUP BY t.notes$$),
  'Harina:5.000,Queso:1.000|-',
  'the draft has the new lines and notes');

-- ============================================
-- 4. Send: out of the origin into transit
-- ============================================
SELECT is(
  pg_temp.q(format($$SELECT public.send_inventory_transfer(%L)->>'status'$$, (SELECT v FROM ids WHERE k = 't1'))),
  'in_transit', 'send moves the draft to in_transit');
SELECT is(
  pg_temp.q($$SELECT row(sent_by, sent_at IS NOT NULL)::text FROM public.inventory_transfers WHERE id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  '(40100000-0000-0000-0000-000000000001,t)', 'send records who and when');
SELECT is(
  pg_temp.q($$SELECT string_agg(coalesce(lot_code, 'general') || ':' || quantity, ',' ORDER BY lot_code NULLS LAST)
               FROM public.inventory_lots WHERE location_id::text = (SELECT v FROM ids WHERE k = 'origin')$$),
  'L1:0.000,L2:5.000,general:4.000',
  'the origin lost 5 Harina FEFO (L1 4 + L2 1) and 1 Queso at once');
SELECT is(
  pg_temp.q($$SELECT string_agg(coalesce(lot_code, 'general') || ':' || quantity || '@' || unit_cost, ',' ORDER BY lot_code NULLS LAST)
               FROM public.inventory_transit_lots WHERE transfer_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  'L1:4.000@1000.0000,L2:1.000@1200.0000,general:1.000@500.0000',
  'the taken portions sit in transit with their lot, expiry and cost');
SELECT is(
  pg_temp.q($$SELECT string_agg(movement_type || ':' || quantity, ',' ORDER BY quantity)
               FROM public.inventory_movements
              WHERE reference_type = 'inventory_transfer' AND reference_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  'transfer_out:-4.000,transfer_out:-1.000,transfer_out:-1.000',
  'send writes one transfer_out per lot portion, referencing the transfer');
SELECT is(
  pg_temp.q($$SELECT count(*)::text FROM public.inventory_lots WHERE location_id = '40200000-0000-0000-0000-0000000000a2'$$),
  '0', 'nothing is at the destination yet');
SELECT is(
  pg_temp.q($$SELECT string_agg(name || ':' || stock, ',' ORDER BY name) FROM public.ingredients
              WHERE restaurant_id = '40000000-0000-0000-0000-0000000000a1'$$),
  'Harina:5.000,Queso:4.000', 'ingredients.stock excludes the stock in transit');
SELECT is(
  pg_temp.state(format($$SELECT public.inventory_adjust('40300000-0000-0000-0000-000000000001', %L, 'waste', 6)$$, (SELECT v FROM ids WHERE k = 'origin'))),
  'P0001', 'stock in transit cannot be consumed at the origin');
SELECT is(
  pg_temp.state($$SELECT public.inventory_adjust('40300000-0000-0000-0000-000000000001', '40200000-0000-0000-0000-0000000000a2', 'waste', 1)$$),
  'P0001', 'stock in transit cannot be consumed at the destination');
INSERT INTO ids SELECT 'countOrigin', pg_temp.q(format($$SELECT public.open_inventory_count(%L, ARRAY['40300000-0000-0000-0000-000000000001'::uuid])->>'count_id'$$,
  (SELECT v FROM ids WHERE k = 'origin')));
INSERT INTO ids SELECT 'countDest', pg_temp.q($$SELECT public.open_inventory_count('40200000-0000-0000-0000-0000000000a2', ARRAY['40300000-0000-0000-0000-000000000001'::uuid])->>'count_id'$$);
SELECT is(
  pg_temp.q($$SELECT expected_quantity::text FROM public.inventory_count_lines WHERE count_id::text = (SELECT v FROM ids WHERE k = 'countOrigin')$$),
  '5.000', 'a count at the origin expects the stock left, not the stock in transit');
SELECT is(
  pg_temp.q($$SELECT expected_quantity::text FROM public.inventory_count_lines WHERE count_id::text = (SELECT v FROM ids WHERE k = 'countDest')$$),
  '0.000', 'a count at the destination does not expect the stock in transit');
SELECT is(
  pg_temp.q(format($$SELECT public.send_inventory_transfer(%L)::text$$, (SELECT v FROM ids WHERE k = 't1'))),
  '<error: P0001 Solo se puede enviar una transferencia en borrador>', 'a transfer is sent once');
SELECT is(
  pg_temp.state(format($$SELECT public.update_inventory_transfer(%L::uuid, %L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}]', NULL)$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'origin'))),
  'P0001', 'a sent transfer cannot be edited');

-- ============================================
-- 5. Receive: full, short with a reason, idempotent
-- ============================================
INSERT INTO ids SELECT 'lineHarina', id::text FROM public.inventory_transfer_lines
 WHERE transfer_id::text = (SELECT v FROM ids WHERE k = 't1') AND ingredient_id = '40300000-0000-0000-0000-000000000001';
INSERT INTO ids SELECT 'lineQueso', id::text FROM public.inventory_transfer_lines
 WHERE transfer_id::text = (SELECT v FROM ids WHERE k = 't1') AND ingredient_id = '40300000-0000-0000-0000-000000000002';
SELECT is(
  pg_temp.q(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(
      jsonb_build_object('line_id', %L, 'received_quantity', 4), jsonb_build_object('line_id', %L, 'received_quantity', 1)))::text$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'lineHarina'), (SELECT v FROM ids WHERE k = 'lineQueso'))),
  '<error: P0001 Indica el motivo del faltante de Harina>', 'a shortfall needs a reason');
SELECT is(
  pg_temp.q(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(
      jsonb_build_object('line_id', %L, 'received_quantity', 6), jsonb_build_object('line_id', %L, 'received_quantity', 1)))::text$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'lineHarina'), (SELECT v FROM ids WHERE k = 'lineQueso'))),
  '<error: P0001 No se puede recibir más de lo enviado de Harina (enviado 5.000 kg)>', 'more than was sent is refused');
SELECT is(
  pg_temp.state(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(jsonb_build_object('line_id', %L, 'received_quantity', 5)))$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'lineHarina'))),
  '22023', 'every line must be received');
SELECT is(
  pg_temp.q(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(
      jsonb_build_object('line_id', %L, 'received_quantity', 4, 'shortfall_reason', ' Bolsa rota '),
      jsonb_build_object('line_id', %L, 'received_quantity', 1)))->>'status'$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'lineHarina'), (SELECT v FROM ids WHERE k = 'lineQueso'))),
  'received_short', 'a short receipt ends as received_short');
SELECT is(
  pg_temp.q($$SELECT string_agg(coalesce(lot_code, 'general') || ':' || quantity, ',' ORDER BY lot_code NULLS LAST)
               FROM public.inventory_lots WHERE location_id = '40200000-0000-0000-0000-0000000000a2'$$),
  'L1:4.000,L2:0.000,general:1.000',
  'the destination got the received quantity, FEFO portions first, with their lot codes');
SELECT is(
  pg_temp.q($$SELECT string_agg(movement_type || ':' || quantity || ':' || coalesce(reason, '-') || ':' || coalesce(notes, '-'), ',' ORDER BY movement_type, quantity)
               FROM public.inventory_movements
              WHERE location_id = '40200000-0000-0000-0000-0000000000a2'
                AND reference_type = 'inventory_transfer' AND reference_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  'transfer_in:1.000:-:-,transfer_in:1.000:-:-,transfer_in:4.000:-:-,waste:-1.000:Bolsa rota:Merma en tránsito',
  'receive writes transfer_in at the destination and the shortfall as merma en tránsito with the reason');
SELECT is(
  pg_temp.q($$SELECT string_agg(i.name || ':' || l.received_quantity || ':' || coalesce(l.shortfall_reason, '-'), ',' ORDER BY i.name)
               FROM public.inventory_transfer_lines l JOIN public.ingredients i ON i.id = l.ingredient_id
              WHERE l.transfer_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  'Harina:4.000:Bolsa rota,Queso:1.000:-', 'the lines keep the received quantity and the reason');
SELECT is(
  pg_temp.q($$SELECT row(received_by, received_at IS NOT NULL)::text FROM public.inventory_transfers WHERE id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  '(40100000-0000-0000-0000-000000000001,t)', 'receive records who and when');
SELECT is(
  pg_temp.q($$SELECT string_agg(name || ':' || stock, ',' ORDER BY name) FROM public.ingredients
              WHERE restaurant_id = '40000000-0000-0000-0000-0000000000a1'$$),
  'Harina:9.000,Queso:5.000', 'the stock is origin + received: never counted twice, the shortfall gone');
SELECT is(
  pg_temp.q(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(
      jsonb_build_object('line_id', %L, 'received_quantity', 5), jsonb_build_object('line_id', %L, 'received_quantity', 1)))->>'status'$$,
    (SELECT v FROM ids WHERE k = 't1'), (SELECT v FROM ids WHERE k = 'lineHarina'), (SELECT v FROM ids WHERE k = 'lineQueso'))),
  'received_short', 'receiving again returns the stored result');
SELECT is(
  pg_temp.q($$SELECT count(*)::text || '|' || (SELECT stock FROM public.ingredients WHERE id = '40300000-0000-0000-0000-000000000001')
               FROM public.inventory_movements WHERE reference_id::text = (SELECT v FROM ids WHERE k = 't1')$$),
  '7|9.000', 'and moves nothing');
SELECT is(
  pg_temp.q(format($$SELECT public.cancel_inventory_transfer(%L)::text$$, (SELECT v FROM ids WHERE k = 't1'))),
  '<error: P0001 Solo se puede anular una transferencia en borrador o en tránsito>', 'a received transfer cannot be cancelled');

-- ============================================
-- 6. Full receipt and cancel
-- ============================================
INSERT INTO ids SELECT 't2', pg_temp.q(format($$
  SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000002", "quantity": 2}]')->>'transfer_id'$$,
  (SELECT v FROM ids WHERE k = 'origin')));
SELECT is(pg_temp.q(format($$SELECT public.send_inventory_transfer(%L)->>'status'$$, (SELECT v FROM ids WHERE k = 't2'))),
  'in_transit', 'a second transfer is sent');
SELECT is(
  pg_temp.q(format($$SELECT public.receive_inventory_transfer(%L, jsonb_build_array(jsonb_build_object('line_id',
      (SELECT id FROM public.inventory_transfer_lines WHERE transfer_id = %1$L::uuid), 'received_quantity', 2)))->>'status'$$,
    (SELECT v FROM ids WHERE k = 't2'))),
  'received', 'a full receipt ends as received');
SELECT is(
  pg_temp.q($$SELECT string_agg(coalesce(l.lot_code, 'general') || ':' || l.quantity, ',') FROM public.inventory_lots l
              WHERE l.ingredient_id = '40300000-0000-0000-0000-000000000002' AND l.location_id = '40200000-0000-0000-0000-0000000000a2'$$),
  'general:3.000', 'the full receipt adds to the destination');

INSERT INTO ids SELECT 't3', pg_temp.q(format($$
  SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 2}]')->>'transfer_id'$$,
  (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run(format($$SELECT public.send_inventory_transfer(%L)$$, (SELECT v FROM ids WHERE k = 't3')));
SELECT is(
  pg_temp.q($$SELECT stock::text FROM public.ingredients WHERE id = '40300000-0000-0000-0000-000000000001'$$),
  '7.000', 'the third transfer left the origin');
SELECT is(
  pg_temp.q(format($$SELECT public.cancel_inventory_transfer(%L)->>'status'$$, (SELECT v FROM ids WHERE k = 't3'))),
  'cancelled', 'an in-transit transfer can be cancelled');
SELECT is(
  pg_temp.q($$SELECT string_agg(coalesce(lot_code, 'general') || ':' || quantity, ',' ORDER BY lot_code NULLS LAST)
               FROM public.inventory_lots WHERE ingredient_id = '40300000-0000-0000-0000-000000000001'
                AND location_id::text = (SELECT v FROM ids WHERE k = 'origin')$$),
  'L1:0.000,L2:5.000', 'cancelling returns every portion to its lot at the origin');
SELECT is(
  pg_temp.q($$SELECT row(stock, (SELECT string_agg(movement_type || ':' || quantity, ',' ORDER BY quantity) FROM public.inventory_movements
                                   WHERE reference_id::text = (SELECT v FROM ids WHERE k = 't3')))::text
               FROM public.ingredients WHERE id = '40300000-0000-0000-0000-000000000001'$$),
  '(9.000,"transfer_out:-2.000,transfer_in:2.000")', 'the stock is back and the ledger shows the return');
SELECT is(
  pg_temp.q($$SELECT row(cancelled_by, cancelled_at IS NOT NULL)::text FROM public.inventory_transfers WHERE id::text = (SELECT v FROM ids WHERE k = 't3')$$),
  '(40100000-0000-0000-0000-000000000001,t)', 'cancel records who and when');
SELECT is(
  pg_temp.state(format($$SELECT public.cancel_inventory_transfer(%L)$$, (SELECT v FROM ids WHERE k = 't3'))),
  'P0001', 'a cancelled transfer cannot be cancelled again');
INSERT INTO ids SELECT 't4', pg_temp.q(format($$
  SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}]')->>'transfer_id'$$,
  (SELECT v FROM ids WHERE k = 'origin')));
SELECT is(
  pg_temp.q(format($$SELECT public.cancel_inventory_transfer(%L)->>'status'$$, (SELECT v FROM ids WHERE k = 't4'))),
  'cancelled', 'a draft can be cancelled');
SELECT is(
  pg_temp.state(format($$SELECT public.receive_inventory_transfer(%L, '[]')$$, (SELECT v FROM ids WHERE k = 't4'))),
  'P0001', 'a cancelled transfer cannot be received');

-- ============================================
-- 7. Roles and tenant isolation
-- ============================================
SELECT pg_temp.as_user('40000000-0000-0000-0000-000000000003');
SELECT is(
  pg_temp.state(format($$SELECT public.create_inventory_transfer(%L, '40200000-0000-0000-0000-0000000000a2', '[{"item_id": "40300000-0000-0000-0000-000000000001", "quantity": 1}]')$$,
                (SELECT v FROM ids WHERE k = 'origin'))),
  '42501', 'a waiter cannot create a transfer');
SELECT is((SELECT count(*)::int FROM public.inventory_transfers), 0, 'a waiter reads no transfers');

SELECT pg_temp.as_user('40000000-0000-0000-0000-000000000002');
SELECT is(
  (SELECT count(*)::int FROM public.inventory_transfers) + (SELECT count(*)::int FROM public.inventory_transfer_lines)
    + (SELECT count(*)::int FROM public.inventory_transit_lots),
  0, 'an admin of another restaurant reads no transfer, line or transit lot');
SELECT is(
  pg_temp.state(format($$SELECT public.cancel_inventory_transfer(%L)$$, (SELECT v FROM ids WHERE k = 't2'))),
  'P0002', 'an admin of another restaurant cannot act on the transfer');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
