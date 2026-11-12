-- Counts with an assigned counter and an approving admin (odd/tasks/inventario-rediseno.md T5, S5).
--
-- Pins the new columns and statuses (open backfilled as counting), the grants
-- of the count functions, RLS staying admin only, the blind functions (no
-- expected stock, cost or difference, assigned counts only), the status
-- machine draft -> counting -> review -> applied, recount, the reason
-- threshold, the counter never applying, and stock in transit never counted.
--
-- Every function call goes through the pg_temp sentinels so the file stays a
-- complete RED on a database without the migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(39);

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

CREATE TEMP TABLE ids (k text PRIMARY KEY, v text);
GRANT ALL ON ids TO vipe_api;

-- ============================================
-- 1. Schema and grants
-- ============================================
SELECT has_column('public', 'inventory_counts', 'counter_id', 'counts have a counter');
SELECT has_column('public', 'inventory_counts', 'approver_id', 'counts have an approver');
SELECT has_column('public', 'inventory_counts', 'submitted_at', 'counts record when they were submitted');
SELECT has_column('public', 'inventory_counts', 'applied_by', 'counts record who applied them');
SELECT has_column('public', 'inventory_count_lines', 'recount', 'lines can be sent back for recount');
SELECT col_default_is('public', 'inventory_counts', 'status', 'counting'::text, 'a count starts as counting by default');
SELECT is((SELECT count(*)::int FROM public.inventory_counts WHERE status = 'open'), 0, 'no count is left as open');
SELECT is(
  pg_temp.q($$SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'inventory_counts_status_check'$$),
  'CHECK ((status = ANY (ARRAY[''draft''::text, ''counting''::text, ''review''::text, ''applied''::text, ''cancelled''::text])))',
  'the statuses are draft, counting, review, applied and cancelled');
SELECT policies_are('public', 'inventory_counts', ARRAY['inventory_counts_select_policy', 'inventory_counts_update_policy'],
  'counts keep their admin policies only');
SELECT ok(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('prepare_inventory_count', 'start_inventory_count', 'submit_inventory_count',
                        'request_inventory_count_recount', 'list_my_inventory_counts', 'get_my_inventory_count',
                        'count_my_inventory_line')
      AND p.prosecdef
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)) = 7,
  'the seven count functions are SECURITY DEFINER, executable by vipe_api and not by PUBLIC');
SELECT ok(
  (SELECT bool_and(p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'inventory_count_%'),
  'the private count helpers are not executable by PUBLIC');
SELECT is(pg_temp.q('SELECT private.inventory_count_reason_threshold()::text'), '50000', 'the reason threshold is 50.000 COP');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('41000000-0000-0000-0000-0000000000a1', 't410-a', 'T410 A'),
  ('41000000-0000-0000-0000-0000000000b2', 't410-b', 'T410 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('41000000-0000-0000-0000-000000000001', 'admin@t410a.test', 'h'),
  ('41000000-0000-0000-0000-000000000002', 'admin@t410b.test', 'h'),
  ('41000000-0000-0000-0000-000000000003', 'waiter@t410a.test', 'h'),
  ('41000000-0000-0000-0000-000000000004', 'waiter2@t410a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('41100000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t410a.test', 'admin', true, '41000000-0000-0000-0000-0000000000a1'),
  ('41100000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t410b.test', 'admin', true, '41000000-0000-0000-0000-0000000000b2'),
  ('41100000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-000000000003', 'Mesero A', 'waiter@t410a.test', 'waiter', true, '41000000-0000-0000-0000-0000000000a1'),
  ('41100000-0000-0000-0000-000000000004', '41000000-0000-0000-0000-000000000004', 'Mesero Dos', 'waiter2@t410a.test', 'waiter', true, '41000000-0000-0000-0000-0000000000a1');
INSERT INTO public.inventory_locations (id, restaurant_id, name, code) VALUES
  ('41200000-0000-0000-0000-0000000000a2', '41000000-0000-0000-0000-0000000000a1', 'Barra', 'BARRA');
INSERT INTO public.ingredients (id, restaurant_id, name, unit, kind, cost) VALUES
  ('41300000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-0000000000a1', 'Harina', 'kg', 'raw', 2000),
  ('41300000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-0000000000a1', 'Queso', 'kg', 'raw', 30000);

INSERT INTO ids SELECT 'origin', id::text FROM public.inventory_locations
 WHERE restaurant_id = '41000000-0000-0000-0000-0000000000a1' AND is_default;

SET LOCAL ROLE vipe_api;
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000001');
SELECT pg_temp.run(format($$SELECT public.inventory_adjust('41300000-0000-0000-0000-000000000001', %L, 'opening', 10, 2000)$$, (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run(format($$SELECT public.inventory_adjust('41300000-0000-0000-0000-000000000002', %L, 'opening', 5, 30000)$$, (SELECT v FROM ids WHERE k = 'origin')));
-- 3 kg of Harina in transit to the Barra.
INSERT INTO ids SELECT 'transfer', pg_temp.q(format($$SELECT public.create_inventory_transfer(%L, '41200000-0000-0000-0000-0000000000a2',
  '[{"item_id": "41300000-0000-0000-0000-000000000001", "quantity": 3}]')->>'transfer_id'$$, (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run(format($$SELECT public.send_inventory_transfer(%L)$$, (SELECT v FROM ids WHERE k = 'transfer')));

-- ============================================
-- 3. Preparing
-- ============================================
SELECT is(
  pg_temp.q(format($$SELECT public.prepare_inventory_count(%L, NULL, '41100000-0000-0000-0000-000000000001', '41100000-0000-0000-0000-000000000001')::text$$,
                   (SELECT v FROM ids WHERE k = 'origin'))),
  '<error: P0001 Quien aprueba debe ser una persona distinta de quien cuenta>', 'the approver must differ from the counter');
SELECT is(
  pg_temp.state(format($$SELECT public.prepare_inventory_count(%L, NULL, '41100000-0000-0000-0000-000000000004', '41100000-0000-0000-0000-000000000003')$$,
                       (SELECT v FROM ids WHERE k = 'origin'))),
  'P0001', 'the approver must be an admin');
SELECT is(
  pg_temp.state(format($$SELECT public.prepare_inventory_count(%L, NULL, '41100000-0000-0000-0000-000000000002', '41100000-0000-0000-0000-000000000001')$$,
                       (SELECT v FROM ids WHERE k = 'origin'))),
  'P0001', 'the counter must belong to the restaurant');
INSERT INTO ids SELECT 'c1', pg_temp.q(format($$SELECT public.prepare_inventory_count(%L, NULL, '41100000-0000-0000-0000-000000000003', '41100000-0000-0000-0000-000000000001')->>'count_id'$$,
                                              (SELECT v FROM ids WHERE k = 'origin')));
SELECT is(pg_temp.q($$SELECT status FROM public.inventory_counts WHERE id::text = (SELECT v FROM ids WHERE k = 'c1')$$), 'draft', 'a prepared count is a draft');

-- ============================================
-- 4. Counting blind
-- ============================================
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000003');
SELECT is(pg_temp.q('SELECT public.list_my_inventory_counts()::text'), '[]', 'the counter does not see drafts');
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000001');
SELECT is(pg_temp.q($$SELECT public.start_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)->>'status'$$), 'counting', 'start moves draft -> counting');
SELECT is(
  pg_temp.q($$SELECT string_agg(expected_quantity::text, ',' ORDER BY ingredient_id) FROM public.inventory_count_lines WHERE count_id::text = (SELECT v FROM ids WHERE k = 'c1')$$),
  '7.000,5.000', 'the expected stock leaves out the stock in transit');

SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000003');
SELECT is((SELECT count(*)::int FROM public.inventory_count_lines), 0, 'RLS: the counter reads no count line (no expected stock)');
SELECT is(
  pg_temp.q($$SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(public.get_my_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)->'lines'->0) k$$),
  'counted_quantity,id,ingredient_id,item_name,recount,sku,unit', 'a blind line has no expected stock, cost or difference');
SELECT is(
  pg_temp.q($$SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys((public.list_my_inventory_counts())->0) k$$),
  'counted_lines,created_at,id,lines_count,location_id,location_name,notes,number,recount_lines,status,submitted_at',
  'a blind count has no expected stock, cost or difference');
SELECT is(pg_temp.state($$SELECT public.submit_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)$$), 'P0001', 'every line must be counted to submit');

SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000004');
SELECT is(pg_temp.state($$SELECT public.get_my_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)$$), 'P0002', 'a non-assigned employee cannot read the count');
SELECT is(pg_temp.state($$SELECT public.submit_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)$$), 'P0002', 'a non-assigned employee cannot submit it');

RESET ROLE;
INSERT INTO ids SELECT 'l_harina', id::text FROM public.inventory_count_lines WHERE count_id::text = (SELECT v FROM ids WHERE k = 'c1') AND ingredient_id = '41300000-0000-0000-0000-000000000001';
INSERT INTO ids SELECT 'l_queso', id::text FROM public.inventory_count_lines WHERE count_id::text = (SELECT v FROM ids WHERE k = 'c1') AND ingredient_id = '41300000-0000-0000-0000-000000000002';
SET LOCAL ROLE vipe_api;
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000003');
SELECT is(pg_temp.q($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c1')::uuid, (SELECT v FROM ids WHERE k = 'l_harina')::uuid, 6)->>'counted_quantity'$$),
  '6.000', 'the counter writes the counted quantity');
SELECT pg_temp.run($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c1')::uuid, (SELECT v FROM ids WHERE k = 'l_queso')::uuid, 3)$$);
SELECT is(pg_temp.q($$SELECT public.submit_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)->>'status'$$), 'review', 'submit moves counting -> review');
SELECT is(pg_temp.state($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c1')::uuid, (SELECT v FROM ids WHERE k = 'l_harina')::uuid, 7)$$),
  'P0001', 'the counter cannot write in review');

-- ============================================
-- 5. Review, recount, reason and apply
-- ============================================
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000001');
SELECT is(pg_temp.q($$SELECT public.request_inventory_count_recount((SELECT v FROM ids WHERE k = 'c1')::uuid, ARRAY[(SELECT v FROM ids WHERE k = 'l_harina')::uuid])->>'status'$$),
  'counting', 'a recount moves review -> counting');
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000003');
SELECT is(pg_temp.state($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c1')::uuid, (SELECT v FROM ids WHERE k = 'l_queso')::uuid, 5)$$),
  'P0001', 'during a recount only the marked lines are writable');
SELECT pg_temp.run($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c1')::uuid, (SELECT v FROM ids WHERE k = 'l_harina')::uuid, 7)$$);
SELECT pg_temp.run($$SELECT public.submit_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)$$);

SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000001');
SELECT is(pg_temp.q($$SELECT public.apply_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)::text$$),
  '<error: P0001 Indica el motivo de las diferencias de $ 50.000 o más: Queso>', 'a difference of 50.000 COP or more needs a reason');
SELECT is(pg_temp.state($$UPDATE public.inventory_count_lines SET counted_quantity = 4 WHERE id = (SELECT v FROM ids WHERE k = 'l_queso')::uuid$$),
  'P0001', 'in review the admin cannot change what was counted');
SELECT is(pg_temp.state($$UPDATE public.inventory_count_lines SET recount = true WHERE id = (SELECT v FROM ids WHERE k = 'l_queso')::uuid$$),
  '42501', 'recount marks are written by the function only');
SELECT pg_temp.run($$UPDATE public.inventory_count_lines SET notes = 'Vencido' WHERE id = (SELECT v FROM ids WHERE k = 'l_queso')::uuid$$);
SELECT is(pg_temp.q($$SELECT public.apply_inventory_count((SELECT v FROM ids WHERE k = 'c1')::uuid)->>'adjusted_lines'$$), '1', 'the admin applies the reviewed count');
SELECT is(
  pg_temp.q($$SELECT string_agg(movement_type || ':' || quantity::text, ',') FROM public.inventory_movements WHERE reference_type = 'inventory_count' AND reference_id::text = (SELECT v FROM ids WHERE k = 'c1')$$),
  'count_adjustment:-2.000', 'applying writes count_adjustment movements');
SELECT is(pg_temp.q($$SELECT sum(quantity)::text FROM public.inventory_transit_lots WHERE transfer_id::text = (SELECT v FROM ids WHERE k = 'transfer')$$),
  '3.000', 'the stock in transit is untouched');

-- An admin counter cannot apply their own count.
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000001');
RESET ROLE;
UPDATE public.profiles SET role = 'admin' WHERE id = '41100000-0000-0000-0000-000000000004';
SET LOCAL ROLE vipe_api;
INSERT INTO ids SELECT 'c2', pg_temp.q(format($$SELECT public.prepare_inventory_count(%L, ARRAY['41300000-0000-0000-0000-000000000001'::uuid], '41100000-0000-0000-0000-000000000001', '41100000-0000-0000-0000-000000000004')->>'count_id'$$,
                                              (SELECT v FROM ids WHERE k = 'origin')));
SELECT pg_temp.run($$SELECT public.start_inventory_count((SELECT v FROM ids WHERE k = 'c2')::uuid)$$);
SELECT pg_temp.run($$SELECT public.count_my_inventory_line((SELECT v FROM ids WHERE k = 'c2')::uuid, cl.id, 7) FROM public.inventory_count_lines cl WHERE cl.count_id = (SELECT v FROM ids WHERE k = 'c2')::uuid$$);
SELECT pg_temp.run($$SELECT public.submit_inventory_count((SELECT v FROM ids WHERE k = 'c2')::uuid)$$);
SELECT is(pg_temp.q($$SELECT public.apply_inventory_count((SELECT v FROM ids WHERE k = 'c2')::uuid)::text$$),
  '<error: P0001 Quien contó no puede aprobar su propio conteo>', 'the counter cannot apply their own count');

-- ============================================
-- 6. Tenant isolation
-- ============================================
SELECT pg_temp.as_user('41000000-0000-0000-0000-000000000002');
SELECT is((SELECT count(*)::int FROM public.inventory_counts), 0, 'an admin of another restaurant reads no count');
SELECT is(pg_temp.state($$SELECT public.request_inventory_count_recount((SELECT v FROM ids WHERE k = 'c2')::uuid, ARRAY[gen_random_uuid()])$$),
  'P0002', 'an admin of another restaurant cannot act on the count');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
