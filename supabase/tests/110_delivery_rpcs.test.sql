-- Delivery RPCs contract test.
--
-- The POS-on-Supabase delivery module (odd/tasks/domicilios.md, task 3) exposes
-- two SECURITY DEFINER RPCs the operator, kitchen and cashier call to drive
-- the lifecycle, and reopens the existing pay_order / register_summary /
-- split_order to admit the delivery_operator role and the delivery fee. This
-- file pins the contract on top of the schema contract pinned in
-- 100_delivery_schema.test.sql.
--
--   - public.create_delivery_order(p_customer jsonb, p_address jsonb,
--     p_items jsonb, p_delivery_fee bigint, p_payment_mode text,
--     p_cash_change_for bigint DEFAULT NULL, p_notes text DEFAULT NULL)
--     RETURNS jsonb
--     SECURITY DEFINER (owner postgres). Caller must be admin or
--     delivery_operator of the tenant (else 42501). Resolves or creates the
--     customer by normalized phone (or by id when given), updates the name
--     only when provided and different from the current value, resolves the
--     address (either {id} that must belong to that customer, or a new
--     address saved to the registry only when save=true), inserts an
--     order_type='delivery' order (table_id NULL, status 'kitchen',
--     waiter_id = caller profile, tax_percentage from business_config),
--     inserts the order_items taking name/price from public.dishes by
--     dish_id (the client never sets the price), inserts the order_deliveries
--     row (status 'received', snapshot of customer/address), and returns
--     {order_id, customer_id, address_id|null, delivery:{...}}. Limits: 1..100
--     item lines, quantity 1..999, delivery_fee >= 0, payment_mode in
--     {prepaid, cash_on_delivery}, cash_change_for only allowed for COD and
--     >= 0. p_notes is accepted for the public API contract; it is not
--     persisted (no order-level notes column today).
--
--   - public.set_delivery_status(p_order_id uuid, p_action text,
--     p_courier_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
--     RETURNS jsonb
--     SECURITY DEFINER (owner postgres). Locks the order_deliveries row FOR
--     UPDATE, then dispatches by action:
--       start_preparing: received -> preparing (kitchen, delivery_operator,
--         admin).
--       mark_ready:      received|preparing -> ready (kitchen,
--         delivery_operator, admin).
--       dispatch:        ready|failed -> out_for_delivery; requires an
--         ACTIVE courier of the tenant (foreign / inactive -> 22023 / P0002);
--         sets courier_id, dispatched_at, clears failure_reason on
--         re-dispatch (delivery_operator, admin).
--       deliver:         out_for_delivery -> delivered, delivered_at
--         (delivery_operator, admin).
--       fail:            out_for_delivery -> failed; reason required
--         (1..200) and trimmed; failed_at (delivery_operator, admin).
--       cancel:          received|preparing|ready|failed -> cancelled,
--         cancelled_at; REJECT (P0001) when a public.payments row already
--         exists; sets orders.status = 'cancelled' (delivery_operator,
--         admin).
--     Same-state replays are P0001 with a clear message ("already in state
--     X"). Returns the updated delivery row as jsonb.
--
--   - public.pay_order: redefined to also admit delivery_operator and to
--     charge amount_due = subtotal + tax + delivery_fee when the order is
--     delivery (no tax / no tip on the fee).
--
--   - public.register_summary: redefined to also admit delivery_operator
--     (read-only access to the same summary; close_register stays
--     cashier/admin only).
--
--   - public.split_order: redefined to REJECT (P0001) delivery orders early
--     (a delivery order cannot be split).
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(72);

SET CONSTRAINTS ALL DEFERRED;

-- ============================================
-- Helpers
-- ============================================
-- SECURITY INVOKER helpers so the caller's RLS applies (the same way the Data
-- API does) and every error becomes a sentinel - the file stays a complete
-- RED on a pre-migration database.
CREATE FUNCTION pg_temp.dr_count(p_sql text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v bigint;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RETURN -1;
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.dr_text(p_sql text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN others THEN
    RETURN '<dr-error: ' || SQLSTATE || '>';
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.dr_run(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_state := 'ok';
  EXCEPTION WHEN others THEN
    v_state := SQLSTATE;
  END;
  RETURN v_state;
END;
$$;

-- debug variant that returns the error message
CREATE FUNCTION pg_temp.dr_run_msg(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
  v_msg   text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_state := 'ok';
  EXCEPTION WHEN others THEN
    v_state := SQLSTATE || ' ' || SQLERRM;
  END;
  RETURN v_state;
END;
$$;

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_function(
  'public', 'create_delivery_order',
  ARRAY['jsonb','jsonb','jsonb','bigint','text','bigint','text'],
  'create_delivery_order exists'
);
SELECT has_function(
  'public', 'set_delivery_status',
  ARRAY['uuid','text','uuid','text'],
  'set_delivery_status exists'
);

-- ============================================
-- 2. Privileges
-- ============================================
SELECT is(
  has_function_privilege('anon', 'public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE create_delivery_order'
);
SELECT is(
  has_function_privilege('authenticated', 'public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on create_delivery_order'
);
SELECT is(
  has_function_privilege('service_role', 'public.create_delivery_order(jsonb,jsonb,jsonb,bigint,text,bigint,text)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on create_delivery_order'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'create_delivery_order' AND a.grantee = 0
  ),
  0::bigint,
  'create_delivery_order does not grant EXECUTE to PUBLIC'
);

SELECT is(
  has_function_privilege('anon', 'public.set_delivery_status(uuid,text,uuid,text)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE set_delivery_status'
);
SELECT is(
  has_function_privilege('authenticated', 'public.set_delivery_status(uuid,text,uuid,text)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on set_delivery_status'
);
SELECT is(
  has_function_privilege('service_role', 'public.set_delivery_status(uuid,text,uuid,text)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on set_delivery_status'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'set_delivery_status' AND a.grantee = 0
  ),
  0::bigint,
  'set_delivery_status does not grant EXECUTE to PUBLIC'
);

-- ============================================
-- 3. Fixtures: two tenants, full role set, menu, customers, couriers
-- ============================================
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d3', 'delivery-rpc-a', 'Delivery RPC A'),
  ('bbbbbbbb-0000-4000-8000-0000000000d4', 'delivery-rpc-b', 'Delivery RPC B');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d3"}'::jsonb,
   '{"full_name":"RPC Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d3"}'::jsonb,
   '{"full_name":"RPC Cashier A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d3"}'::jsonb,
   '{"full_name":"RPC Waiter A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-kitchen-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"kitchen",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d3"}'::jsonb,
   '{"full_name":"RPC Kitchen A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-operator-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"delivery_operator",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d3"}'::jsonb,
   '{"full_name":"RPC Operator A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000e7', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rpc-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-0000000000d4"}'::jsonb,
   '{"full_name":"RPC Admin B"}'::jsonb, now(), now());

-- A small menu (3 dishes) in tenant A; the RPC reads name/price from this
-- table. tenant B has a different menu so the same dish_id resolves to a
-- different price (tenant isolation probe).
INSERT INTO public.categories
  (id, restaurant_id, name, icon, active, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-0000000000d3',
   'Delivery Cat', 'Utensils', true, now(), now());

INSERT INTO public.dishes
  (id, restaurant_id, name, price, category_id, active, allow_comments,
   created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000a001', 'aaaaaaaa-0000-4000-8000-0000000000d3',
   'Burger', 15000, 'aaaaaaaa-0000-4000-8000-0000000000c1', true, false, now(), now()),
  ('aaaaaaaa-0000-4000-8000-00000000a002', 'aaaaaaaa-0000-4000-8000-0000000000d3',
   'Salad',  10000, 'aaaaaaaa-0000-4000-8000-0000000000c1', true, false, now(), now()),
  ('aaaaaaaa-0000-4000-8000-00000000a003', 'aaaaaaaa-0000-4000-8000-0000000000d3',
   'Fries',   5000, 'aaaaaaaa-0000-4000-8000-0000000000c1', true, false, now(), now()),
  ('bbbbbbbb-0000-4000-8000-00000000a001', 'bbbbbbbb-0000-4000-8000-0000000000d4',
   'Tenant B Dish', 99999, 'aaaaaaaa-0000-4000-8000-0000000000c1', true, false, now(), now());

-- A second dish id that ONLY exists in tenant B, so the tenant-isolation test
-- below can pass a foreign dish_id and expect P0002.
INSERT INTO public.dishes
  (id, restaurant_id, name, price, category_id, active, allow_comments,
   created_at, updated_at)
VALUES
  ('bbbbbbbb-0000-4000-8000-00000000a999', 'bbbbbbbb-0000-4000-8000-0000000000d4',
   'Tenant B Only', 50000, 'aaaaaaaa-0000-4000-8000-0000000000c1', true, false, now(), now());

-- One open cash register in tenant A for the pay_order section.
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000c011', 'aaaaaaaa-0000-4000-8000-0000000000d3',
   now(), 100000, 'open');

-- Pre-existing customer in tenant A (used by "existing customer by phone" path).
INSERT INTO public.customers (restaurant_id, phone, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d3', '3001112233', 'Existing Customer');

-- Pre-existing address for that customer.
INSERT INTO public.customer_addresses
  (restaurant_id, customer_id, address_line, neighborhood, is_default)
SELECT 'aaaaaaaa-0000-4000-8000-0000000000d3', c.id,
       'Calle Existente 1', 'Centro', true
  FROM public.customers c
 WHERE c.phone = '3001112233'
   AND c.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3';

-- Active and inactive couriers in tenant A.
INSERT INTO public.couriers (restaurant_id, name, phone, is_active)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d3', 'Carlos Activo',  '3001234567', true),
  ('aaaaaaaa-0000-4000-8000-0000000000d3', 'Mario Inactivo', '3001234568', false);

-- A second customer in tenant A for the "new address saved vs not saved" path.
INSERT INTO public.customers (restaurant_id, phone, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d3', '3002223344', 'New Customer');

-- An address for that customer (used by the rename / "address id resolves"
-- cases below).
INSERT INTO public.customer_addresses
  (restaurant_id, customer_id, address_line, neighborhood, is_default)
SELECT 'aaaaaaaa-0000-4000-8000-0000000000d3', c.id,
       'Calle Cliente 2', 'Sur', true
  FROM public.customers c
 WHERE c.phone = '3002223344'
   AND c.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3';

-- A tenant B customer that the tenant A operator must NOT be able to attach.
INSERT INTO public.customers (restaurant_id, phone, name)
VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000d4', '3009990000', 'Tenant B Customer');

-- A tenant B courier that the tenant A operator must NOT be able to dispatch with.
INSERT INTO public.couriers (restaurant_id, name, phone, is_active)
VALUES
  ('bbbbbbbb-0000-4000-8000-0000000000d4', 'Tenant B Courier', '3009990001', true);

-- Tax rate (8%).
INSERT INTO public.business_config (restaurant_id, key, value)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d3', 'tax_percentage', '8');

-- ============================================
-- 4. create_delivery_order: happy paths
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 4a. New customer, new address NOT saved.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.create_delivery_order(
      jsonb_build_object('phone', '3005550001', 'name', 'Brand New Customer'),
      jsonb_build_object('address_line', 'Calle Nueva 1', 'neighborhood', 'Norte',
                          'save', false),
      jsonb_build_array(
        jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 2)
      ),
      3000::bigint, 'cash_on_delivery', 20000::bigint, 'Timbre dañado'
    ))->>'order_id'
  $q$),
  pg_temp.dr_text($q$ SELECT id::text FROM public.orders
                     WHERE order_type = 'delivery'
                       AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                       AND status = 'kitchen'
                       AND table_id IS NULL
                     ORDER BY created_at DESC LIMIT 1 $q$),
  'create_delivery_order: new customer + unsaved address returns a new order_id');

-- 4a'. The order notes are stored on the delivery row.
SELECT is(
  pg_temp.dr_text($q$ SELECT od.notes FROM public.order_deliveries od
                       JOIN public.orders o ON o.id = od.order_id
                     WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                     ORDER BY o.created_at DESC LIMIT 1 $q$),
  'Timbre dañado',
  'create_delivery_order: p_notes is stored on order_deliveries.notes');

-- 4b. The new order has the right order_type, status, table_id NULL, waiter_id = caller.
SELECT is(
  pg_temp.dr_text($q$
    SELECT order_type || '|' || status || '|' || coalesce(table_id::text, 'NULL') || '|' ||
           waiter_id::text
      FROM public.orders
     WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
       AND order_type = 'delivery'
     ORDER BY created_at DESC LIMIT 1
  $q$),
  pg_temp.dr_text($q$
    SELECT 'delivery|kitchen|NULL|' || (SELECT id::text FROM public.profiles
                                          WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000e5')
  $q$),
  'create_delivery_order: order_type=delivery, status=kitchen, table_id NULL, waiter_id = caller profile');

-- 4c. order_items: name/price come from the dishes table, not the client.
SELECT is(
  pg_temp.dr_text($q$
    SELECT oi.name || '|' || oi.price::text
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
       AND o.order_type = 'delivery'
       AND oi.dish_id = 'aaaaaaaa-0000-4000-8000-00000000a001'
  $q$),
  'Burger|15000.00'::text,
  'create_delivery_order: name and price are taken from public.dishes by dish_id');

-- 4d. order_items: total subtotal/tax/total reflect server-side math
--     (2 * 15000 = 30000, tax 8% = 2400, total = 32400, no fee yet because fee is in order_deliveries).
SELECT is(
  pg_temp.dr_text($q$
    SELECT subtotal::text || '|' || tax::text || '|' || tax_percentage::text || '|' ||
           tip::text || '|' || total::text
      FROM public.orders
     WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
       AND order_type = 'delivery'
     ORDER BY created_at DESC LIMIT 1
  $q$),
  '30000.00|2400.00|8.00|0.00|32400.00'::text,
  'create_delivery_order: subtotal/tax/tax_percentage/tip/total are server-computed from items');

-- 4e. order_deliveries: snapshot of customer/address, fee, payment_mode, status 'received'.
SELECT is(
  pg_temp.dr_text($q$
    SELECT od.customer_name || '|' || od.customer_phone || '|' || od.address_line || '|' ||
           od.delivery_fee::text || '|' || od.payment_mode || '|' ||
           coalesce(od.cash_change_for::text, 'NULL') || '|' || od.delivery_status
      FROM public.order_deliveries od
      JOIN public.orders o ON o.id = od.order_id
     WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
       AND o.order_type = 'delivery'
     ORDER BY od.created_at DESC LIMIT 1
  $q$),
  'Brand New Customer|3005550001|Calle Nueva 1|3000|cash_on_delivery|20000|received'::text,
  'create_delivery_order: order_deliveries carries the snapshot, fee, payment_mode and starts at received');

-- 4f. Address NOT saved: customer_addresses has no row for the new customer.
SELECT is(
  pg_temp.dr_count($q$
    SELECT count(*) FROM public.customer_addresses
     WHERE customer_id = (SELECT id FROM public.customers
                           WHERE phone = '3005550001'
                             AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3')
  $q$),
  0::bigint,
  'create_delivery_order: address NOT saved (save=false) leaves no customer_addresses row');

-- 4g. Existing customer by phone, no name change requested.
SELECT lives_ok($q$
  SELECT public.create_delivery_order(
    jsonb_build_object('phone', '3001112233'),
    jsonb_build_object('id', (SELECT id FROM public.customer_addresses
                               WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                                 AND address_line = 'Calle Existente 1')),
    jsonb_build_array(
      jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a002', 'quantity', 1)
    ),
    2000::bigint, 'prepaid', NULL, NULL
  )
$q$, 'create_delivery_order: existing customer by phone + existing address is accepted');

-- 4h. Existing customer name is NOT overwritten when name omitted.
SELECT is(
  pg_temp.dr_text($q$ SELECT name FROM public.customers
                      WHERE phone = '3001112233'
                        AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3' $q$),
  'Existing Customer'::text,
  'create_delivery_order: existing customer name preserved when request omits name');

-- 4i. New address saved for an existing customer.
SELECT lives_ok($q$
  SELECT public.create_delivery_order(
    jsonb_build_object('phone', '3001112233'),
    jsonb_build_object('address_line', 'Calle Guardada 9', 'neighborhood', 'Sur',
                        'label', 'Oficina', 'save', true),
    jsonb_build_array(
      jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a003', 'quantity', 3)
    ),
    1500::bigint, 'prepaid', NULL, 'por favor sin picante'
  )
$q$, 'create_delivery_order: new address with save=true is accepted');

SELECT is(
  pg_temp.dr_count($q$
    SELECT count(*) FROM public.customer_addresses
     WHERE customer_id = (SELECT id FROM public.customers
                           WHERE phone = '3001112233'
                             AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3')
       AND address_line = 'Calle Guardada 9'
  $q$),
  1::bigint,
  'create_delivery_order: new address with save=true is persisted to customer_addresses');

-- 4j. Existing customer name IS updated when different name provided.
SELECT lives_ok($q$
  SELECT public.create_delivery_order(
    jsonb_build_object('phone', '3002223344', 'name', 'Renamed Customer'),
    jsonb_build_object('id', (SELECT id FROM public.customer_addresses
                               WHERE customer_id = (SELECT id FROM public.customers
                                                     WHERE phone = '3002223344'
                                                       AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'))),
    jsonb_build_array(
      jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)
    ),
    1000::bigint, 'prepaid', NULL, NULL
  )
$q$, 'create_delivery_order: existing customer accepts a new name');

SELECT is(
  pg_temp.dr_text($q$ SELECT name FROM public.customers
                      WHERE phone = '3002223344'
                        AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3' $q$),
  'Renamed Customer'::text,
  'create_delivery_order: existing customer name updated to new value');

-- 4k. Existing customer name with SAME value does not raise (idempotent on no-op update).
SELECT lives_ok($q$
  SELECT public.create_delivery_order(
    jsonb_build_object('phone', '3002223344', 'name', 'Renamed Customer'),
    jsonb_build_object('id', (SELECT id FROM public.customer_addresses
                               WHERE customer_id = (SELECT id FROM public.customers
                                                     WHERE phone = '3002223344'
                                                       AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'))),
    jsonb_build_array(
      jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)
    ),
    1000::bigint, 'prepaid', NULL, NULL
  )
$q$, 'create_delivery_order: existing customer name same-as-stored is accepted (no-op)');

RESET ROLE;

-- ============================================
-- 5. create_delivery_order: input validation (22023)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 5a. p_items empty.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      '[]'::jsonb, 0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: empty p_items raises 22023');

-- 5b. p_items quantity out of range.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 0)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: quantity < 1 raises 22023');

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1000)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: quantity > 999 raises 22023');

-- 5c. p_items > 100 lines.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      (SELECT jsonb_agg(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1))
         FROM generate_series(1, 101)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: more than 100 lines raises 22023');

-- 5d. p_delivery_fee negative.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      -1::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: negative p_delivery_fee raises 22023');

-- 5e. p_payment_mode invalid.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'bitcoin', NULL, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: invalid p_payment_mode raises 22023');

-- 5f. p_cash_change_for on prepaid order.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'prepaid', 5000::bigint, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: cash_change_for on prepaid raises 22023');

-- 5g. p_cash_change_for negative on COD.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550002', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'cash_on_delivery', -1::bigint, NULL
    )
  $q$),
  '22023'::text,
  'create_delivery_order: negative cash_change_for on COD raises 22023');

RESET ROLE;

-- ============================================
-- 6. create_delivery_order: role denials (42501)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550003', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '42501'::text,
  'create_delivery_order: waiter is denied (42501)');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550003', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '42501'::text,
  'create_delivery_order: cashier is denied (42501)');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e4","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550003', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  '42501'::text,
  'create_delivery_order: kitchen is denied (42501)');

RESET ROLE;

-- ============================================
-- 7. create_delivery_order: tenant isolation
-- ============================================
-- A tenant A operator must not be able to:
--  - pick a customer from tenant B
--  - pick a dish from tenant B
--  - create a new customer with the same phone as one in tenant B
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 7a. Foreign customer id -> P0002.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('id', (SELECT id FROM public.customers
                                 WHERE phone = '3009990000'
                                   AND restaurant_id = 'bbbbbbbb-0000-4000-8000-0000000000d4')),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'aaaaaaaa-0000-4000-8000-00000000a001', 'quantity', 1)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  'P0002'::text,
  'create_delivery_order: foreign customer id raises P0002');

-- 7b. Foreign dish_id (dish that exists only in tenant B) -> P0002.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.create_delivery_order(
      jsonb_build_object('phone', '3005550004', 'name', 'X'),
      jsonb_build_object('address_line', 'C 1', 'save', false),
      jsonb_build_array(jsonb_build_object('dish_id', 'bbbbbbbb-0000-4000-8000-00000000a999', 'quantity', 1)),
      0::bigint, 'prepaid', NULL, NULL
    )
  $q$),
  'P0002'::text,
  'create_delivery_order: foreign dish_id raises P0002');

RESET ROLE;

-- ============================================
-- 8. set_delivery_status: helper for "fresh delivery"
-- ============================================
-- We create a fresh delivery order for each transition test, so the
-- delivery_status sequence is independent and easy to read in a failure.
-- SECURITY DEFINER on purpose: the helper has to run as postgres, because
-- the test impersonates different roles (operator, kitchen, waiter) to
-- exercise the role matrix and we cannot ask each role to be the operator
-- for the setup. The JWT is set explicitly to the operator before the
-- helper is called so create_delivery_order's role check sees the
-- delivery_operator role regardless of the caller's current session role.
CREATE FUNCTION pg_temp.dr_fresh_delivery(p_phone text, p_dish_id uuid, p_qty int,
                                            p_fee bigint, p_mode text, p_change bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id text;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
    true
  );
  SELECT (public.create_delivery_order(
    jsonb_build_object('phone', p_phone, 'name', 'Dr ' || p_phone),
    jsonb_build_object('address_line', 'C ' || p_phone, 'save', false),
    jsonb_build_array(jsonb_build_object('dish_id', p_dish_id, 'quantity', p_qty)),
    p_fee, p_mode, p_change, NULL
  ))->>'order_id' INTO v_order_id;
  RETURN v_order_id::uuid;
END;
$$;

-- ============================================
-- 9. set_delivery_status: transitions + role matrix
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 9a. start_preparing received -> preparing.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      pg_temp.dr_fresh_delivery('3010000001', 'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                 0, 'prepaid', NULL),
      'start_preparing', NULL, NULL
    ))->>'delivery_status'
  $q$),
  'preparing'::text,
  'set_delivery_status: start_preparing received -> preparing');

-- 9b. mark_ready preparing -> ready.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'preparing'
        ORDER BY od.created_at DESC LIMIT 1),
      'mark_ready', NULL, NULL
    ))->>'delivery_status'
  $q$),
  'ready'::text,
  'set_delivery_status: mark_ready preparing -> ready');

-- 9c. dispatch ready -> out_for_delivery (with the active courier).
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'ready'
        ORDER BY od.created_at DESC LIMIT 1),
      'dispatch',
      (SELECT id FROM public.couriers
        WHERE name = 'Carlos Activo'
          AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    ))->>'delivery_status'
  $q$),
  'out_for_delivery'::text,
  'set_delivery_status: dispatch ready -> out_for_delivery');

-- 9d. deliver out_for_delivery -> delivered.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'out_for_delivery'
        ORDER BY od.created_at DESC LIMIT 1),
      'deliver', NULL, NULL
    ))->>'delivery_status'
  $q$),
  'delivered'::text,
  'set_delivery_status: deliver out_for_delivery -> delivered');

-- 9e. fail path: a fresh delivery, dispatch, then fail with reason.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      pg_temp.dr_fresh_delivery('3010000002', 'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                 0, 'prepaid', NULL),
      'mark_ready', NULL, NULL
    ))->>'delivery_status'
  $q$),
  'ready'::text,
  'set_delivery_status: prep, then mark_ready (received->ready) for the fail path');

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'ready'
          AND o.created_at > now() - interval '5 seconds'
        ORDER BY od.created_at DESC LIMIT 1),
      'dispatch',
      (SELECT id FROM public.couriers
        WHERE name = 'Carlos Activo'
          AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    ))->>'delivery_status'
  $q$),
  'out_for_delivery'::text,
  'set_delivery_status: dispatch ready -> out_for_delivery (fail-path delivery)');

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'out_for_delivery'
          AND o.created_at > now() - interval '5 seconds'
        ORDER BY od.created_at DESC LIMIT 1),
      'fail', NULL, 'customer not home'
    ))->>'delivery_status'
  $q$),
  'failed'::text,
  'set_delivery_status: fail out_for_delivery -> failed (with reason)');

-- 9f. Re-dispatch from failed -> out_for_delivery (clears failure_reason).
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'failed'
        ORDER BY od.created_at DESC LIMIT 1),
      'dispatch',
      (SELECT id FROM public.couriers
        WHERE name = 'Carlos Activo'
          AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    ))->>'delivery_status'
  $q$),
  'out_for_delivery'::text,
  'set_delivery_status: re-dispatch failed -> out_for_delivery');

SELECT is(
  pg_temp.dr_text($q$ SELECT failure_reason FROM public.order_deliveries
                      WHERE order_id = (
                        SELECT o.id FROM public.orders o
                          JOIN public.order_deliveries od ON od.order_id = o.id
                         WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                           AND od.delivery_status = 'out_for_delivery'
                           AND o.created_at > now() - interval '10 seconds'
                         ORDER BY od.created_at DESC LIMIT 1
                      ) $q$),
  NULL::text,
  'set_delivery_status: re-dispatch clears failure_reason');

-- 9g. cancel: a fresh delivery, then cancel received -> cancelled + orders.status='cancelled'.
SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.set_delivery_status(
      pg_temp.dr_fresh_delivery('3010000003', 'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                 0, 'prepaid', NULL),
      'cancel', NULL, NULL
    ))->>'delivery_status'
  $q$),
  'cancelled'::text,
  'set_delivery_status: cancel received -> cancelled');

SELECT is(
  pg_temp.dr_text($q$
    SELECT o.status
      FROM public.orders o
      JOIN public.order_deliveries od ON od.order_id = o.id
     WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
       AND od.delivery_status = 'cancelled'
     ORDER BY od.created_at DESC LIMIT 1
  $q$),
  'cancelled'::text,
  'set_delivery_status: cancel also sets orders.status to cancelled');

RESET ROLE;

-- ============================================
-- 10. set_delivery_status: forbidden transitions / role denials
-- ============================================
-- Build a couple of "ready" deliveries in advance (as the operator) so the
-- negative cases below can address a known target.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 10a. deliver on received is rejected.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_fresh_delivery('3010000004', 'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                 0, 'prepaid', NULL),
      'deliver', NULL, NULL
    )
  $q$),
  'P0001'::text,
  'set_delivery_status: deliver on received raises P0001');

-- 10b. fail without reason is rejected (22023). Build a delivery up to
-- out_for_delivery with three separate steps so the final "fail without
-- reason" is the only thing under test.
SELECT lives_ok($q$
  SELECT public.set_delivery_status(
    pg_temp.dr_fresh_delivery('3010000005', 'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                0, 'prepaid', NULL),
    'mark_ready', NULL, NULL
  )
$q$, 'set_delivery_status: setup, mark_ready for the fail-without-reason case');

SELECT lives_ok($q$
  SELECT public.set_delivery_status(
    (SELECT o.id FROM public.orders o
       JOIN public.order_deliveries od ON od.order_id = o.id
      WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
        AND od.delivery_status = 'ready'
        AND o.created_at > now() - interval '5 seconds'
      ORDER BY od.created_at DESC LIMIT 1),
    'dispatch',
    (SELECT id FROM public.couriers
      WHERE name = 'Carlos Activo'
        AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
    NULL
  )
$q$, 'set_delivery_status: setup, dispatch for the fail-without-reason case');

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'out_for_delivery'
          AND o.created_at > now() - interval '10 seconds'
        ORDER BY od.created_at DESC LIMIT 1),
      'fail', NULL, NULL
    )
  $q$),
  '22023'::text,
  'set_delivery_status: fail without reason raises 22023');

-- 10c. Same-state replays are P0001.
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'out_for_delivery'
        ORDER BY od.created_at DESC LIMIT 1),
      'mark_ready', NULL, NULL
    )
  $q$),
  'P0001'::text,
  'set_delivery_status: mark_ready while out_for_delivery is rejected (P0001)');

RESET ROLE;

-- 10d. kitchen can call start_preparing and mark_ready, NOT dispatch.
-- Pre-create a fresh delivery as the operator first, then switch to the
-- kitchen user. The order id is parked in a temp table so the test can
-- reference it across the role switch. The INSERT runs as postgres so the
-- table is owned by postgres; the read goes through a SECURITY DEFINER
-- helper so every role can pull the id.
CREATE TEMP TABLE dr_kitchen_fresh (order_id uuid);
CREATE FUNCTION pg_temp.dr_kitchen_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = 'pg_temp'
AS $$ SELECT order_id FROM dr_kitchen_fresh $$;
GRANT EXECUTE ON FUNCTION pg_temp.dr_kitchen_id() TO authenticated;
INSERT INTO dr_kitchen_fresh (order_id)
VALUES (pg_temp.dr_fresh_delivery('3010000006',
                                    'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                    0, 'prepaid', NULL));

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e4","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run_msg($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_kitchen_id(),
      'start_preparing', NULL, NULL
    )
  $q$),
  'ok'::text,
  'set_delivery_status: kitchen can start_preparing');

SELECT is(
  pg_temp.dr_run_msg($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_kitchen_id(),
      'mark_ready', NULL, NULL
    )
  $q$),
  'ok'::text,
  'set_delivery_status: kitchen can mark_ready');

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_kitchen_id(),
      'dispatch',
      (SELECT id FROM public.couriers
        WHERE name = 'Carlos Activo'
          AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    )
  $q$),
  '42501'::text,
  'set_delivery_status: kitchen cannot dispatch (42501)');

RESET ROLE;

-- 10e. Waiter is denied any action (pre-create the delivery as the operator).
CREATE TEMP TABLE dr_waiter_fresh (order_id uuid);
CREATE FUNCTION pg_temp.dr_waiter_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = 'pg_temp'
AS $$ SELECT order_id FROM dr_waiter_fresh $$;
GRANT EXECUTE ON FUNCTION pg_temp.dr_waiter_id() TO authenticated;
INSERT INTO dr_waiter_fresh (order_id)
VALUES (pg_temp.dr_fresh_delivery('3010000007',
                                    'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                    0, 'prepaid', NULL));

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_waiter_id(),
      'mark_ready', NULL, NULL
    )
  $q$),
  '42501'::text,
  'set_delivery_status: waiter is denied any action (42501)');

RESET ROLE;

-- ============================================
-- 11. set_delivery_status: tenant isolation + courier validation
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- 11a. Foreign courier -> P0002 (the courier is in tenant B). The
-- operator cannot read tenant B's courier list (RLS), so the test
-- pre-creates a fresh ready delivery as the operator and dispatches
-- with a hardcoded non-existent courier id: the RPC must reject it
-- with P0002. The cross-tenant case is covered by RLS (pinned in
-- 100_delivery_schema), so the deliver status fetch from inside the
-- RPC is what raises P0002 there.
SELECT lives_ok($q$
  SELECT public.set_delivery_status(
    pg_temp.dr_fresh_delivery('3010000100',
                                'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                0, 'prepaid', NULL),
    'mark_ready', NULL, NULL
  )
$q$, 'set_delivery_status: setup mark_ready for the courier-validation case');

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'ready'
          AND o.created_at > now() - interval '5 seconds'
        ORDER BY od.created_at DESC LIMIT 1),
      'dispatch',
      '00000000-0000-0000-0000-000000000999'::uuid,
      NULL
    )
  $q$),
  'P0002'::text,
  'set_delivery_status: dispatch with a non-existent courier raises P0002');

-- 11b. Inactive courier -> 22023 (the RPC must refuse is_active=false).
-- The operator can see Mario Inactivo (same tenant), so we can read
-- the id through the normal RLS-visible SELECT.
SELECT lives_ok($q$
  SELECT public.set_delivery_status(
    pg_temp.dr_fresh_delivery('3010000099',
                                'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                0, 'prepaid', NULL),
    'mark_ready', NULL, NULL
  )
$q$, 'set_delivery_status: prep (mark_ready) for the inactive-courier case');

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'ready'
          AND o.created_at > now() - interval '5 seconds'
        ORDER BY od.created_at DESC LIMIT 1),
      'dispatch',
      (SELECT id FROM public.couriers
        WHERE name = 'Mario Inactivo'
          AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    )
  $q$),
  '22023'::text,
  'set_delivery_status: dispatch with inactive courier raises 22023');

RESET ROLE;

-- 11c. Cross-tenant delivery: tenant B operator tries to set status of a
-- tenant A delivery (P0002). The tenant B operator cannot see tenant A's
-- delivery (RLS), so the row lock returns zero rows and the RPC raises
-- P0002. The fresh delivery is pre-created as the operator and reused
-- (the operator's tenant owns it; tenant B cannot see it).
CREATE TEMP TABLE dr_tenant_b_test_fresh (order_id uuid);
CREATE FUNCTION pg_temp.dr_tenant_b_test_fresh_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = 'pg_temp'
AS $$ SELECT order_id FROM dr_tenant_b_test_fresh $$;
GRANT EXECUTE ON FUNCTION pg_temp.dr_tenant_b_test_fresh_id() TO authenticated;

INSERT INTO dr_tenant_b_test_fresh (order_id)
VALUES (pg_temp.dr_fresh_delivery('3010000200',
                                    'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                    0, 'prepaid', NULL));

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000e7","role":"authenticated"}',
  true
);
SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      pg_temp.dr_tenant_b_test_fresh_id(),
      'dispatch',
      (SELECT id FROM public.couriers WHERE name = 'Carlos Activo'
        AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'),
      NULL
    )
  $q$),
  'P0002'::text,
  'set_delivery_status: cross-tenant access raises P0002');

RESET ROLE;

-- ============================================
-- 12. set_delivery_status: cancel rejected when a payment row exists
-- ============================================
-- Take a delivery already delivered (from 9d above) and pay it via pay_order.
-- Then try to cancel it.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok($q$
  SELECT public.pay_order(
    (SELECT o.id FROM public.orders o
       JOIN public.order_deliveries od ON od.order_id = o.id
      WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
        AND od.delivery_status = 'delivered'
      ORDER BY od.created_at DESC LIMIT 1)::uuid,
    'aaaaaaaa-0000-4000-8000-00000000c011'::uuid,
    0::bigint,
    jsonb_build_array(
      jsonb_build_object(
        'payment_method_id',
        (SELECT id FROM public.payment_methods
          WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND code = 'cash'),
        'amount', (15000 + 1200)::bigint,
        'cash_received', (15000 + 1200)::bigint
      )
    ),
    'aaaaaaaa-0000-4000-8000-000000000d1a'::uuid
  )
$q$, 'pay_order on a delivery order is accepted by a cashier');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.set_delivery_status(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'delivered'
        ORDER BY od.created_at DESC LIMIT 1),
      'cancel', NULL, NULL
    )
  $q$),
  'P0001'::text,
  'set_delivery_status: cancel after pay_order is rejected (P0001)');

RESET ROLE;

-- ============================================
-- 13. pay_order on a delivery order (fee, role)
-- ============================================
-- 13a. delivery_operator can pay_order (cash) on a fresh delivery order.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- Create the delivery once and capture the order id so the replay uses
-- the same order (the existing-payment check is on order_id).
CREATE TEMP TABLE dr_pay_order_fresh (order_id uuid);
CREATE FUNCTION pg_temp.dr_pay_order_fresh_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = 'pg_temp'
AS $$ SELECT order_id FROM dr_pay_order_fresh $$;
GRANT EXECUTE ON FUNCTION pg_temp.dr_pay_order_fresh_id() TO authenticated;
INSERT INTO dr_pay_order_fresh (order_id)
VALUES (pg_temp.dr_fresh_delivery('3010000008',
                                    'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                    5000, 'cash_on_delivery', 50000::bigint));

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.pay_order(
      pg_temp.dr_pay_order_fresh_id(),
      'aaaaaaaa-0000-4000-8000-00000000c011'::uuid,
      1000::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
            AND code = 'cash'),
          'amount', (16200 + 5000 + 1000)::bigint,
          'cash_received', 50000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000d1b'::uuid
    ))->>'amount_due'
  $q$),
  '21200'::text,
  'pay_order on a delivery order: amount_due = subtotal + tax + delivery_fee (15000 + 1200 + 5000)');

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.pay_order(
      pg_temp.dr_pay_order_fresh_id(),
      'aaaaaaaa-0000-4000-8000-00000000c011'::uuid,
      1000::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
            AND code = 'cash'),
          'amount', (16200 + 5000 + 1000)::bigint,
          'cash_received', 50000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000d1b'::uuid
    ))->>'status'
  $q$),
  'already_paid'::text,
  'pay_order on a delivery order: replay with the same idempotency_key returns already_paid');

RESET ROLE;

-- 13b. A fresh delivery order is paid with the same fee rule (sanity check
-- on a non-COD prepaid order; cash_change_for is NULL by p_payment_mode rule).
-- Create a fresh delivery for this test and use its id directly so the
-- test does not depend on the order of other deliveries.
CREATE TEMP TABLE dr_pay_prepaid_fresh (order_id uuid);
CREATE FUNCTION pg_temp.dr_pay_prepaid_fresh_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = 'pg_temp'
AS $$ SELECT order_id FROM dr_pay_prepaid_fresh $$;
GRANT EXECUTE ON FUNCTION pg_temp.dr_pay_prepaid_fresh_id() TO authenticated;
INSERT INTO dr_pay_prepaid_fresh (order_id)
VALUES (pg_temp.dr_fresh_delivery('3010000098',
                                    'aaaaaaaa-0000-4000-8000-00000000a001', 1,
                                    5000, 'prepaid', NULL));

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.pay_order(
      pg_temp.dr_pay_prepaid_fresh_id(),
      'aaaaaaaa-0000-4000-8000-00000000c011'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
            AND code = 'cash'),
          'amount', (15000 + 1200 + 5000)::bigint,
          'cash_received', (15000 + 1200 + 5000)::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000d1c'::uuid
    ))->>'amount_due'
  $q$),
  '21200'::text,
  'pay_order: amount_due on a delivery order is subtotal + tax + delivery_fee');

RESET ROLE;

-- 13c. Waiter cannot pay_order (unchanged behaviour).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.pay_order(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'received'
        ORDER BY od.created_at DESC LIMIT 1)::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c011'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
            AND code = 'cash'),
          'amount', 1::bigint,
          'cash_received', 1::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000d1d'::uuid
    )
  $q$),
  '42501'::text,
  'pay_order: waiter is still denied (42501)');

RESET ROLE;

-- ============================================
-- 14. register_summary: readable by delivery_operator
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000c011']::uuid[]
    ))->>'registers_count'
  $q$),
  '1'::text,
  'register_summary: delivery_operator can read the summary');

RESET ROLE;

-- close_register: still cashier/admin only.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.close_register('aaaaaaaa-0000-4000-8000-00000000c011'::uuid)
  $q$),
  '42501'::text,
  'close_register: delivery_operator is still denied (42501)');

RESET ROLE;

-- ============================================
-- 15. split_order: rejects delivery orders (P0001)
-- ============================================
-- 15a. As a cashier, attempt to split a delivered delivery order.
-- split_order is cashier/admin only (42501 for the operator), then
-- rejects a delivery order with P0001. We assert the operator-side
-- denial, then the cashier-side delivery-order denial, in that order.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.split_order(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'delivered'
        ORDER BY od.created_at DESC LIMIT 1),
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', (SELECT id FROM public.order_items
                             WHERE order_id = (
                               SELECT o.id FROM public.orders o
                                 JOIN public.order_deliveries od ON od.order_id = o.id
                                WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                                  AND od.delivery_status = 'delivered'
                                ORDER BY od.created_at DESC LIMIT 1)
                             LIMIT 1),
          'quantity', 1
        )
      )
    )
  $q$),
  '42501'::text,
  'split_order: a delivery_operator is still denied (42501)');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dr_run($q$
    SELECT public.split_order(
      (SELECT o.id FROM public.orders o
         JOIN public.order_deliveries od ON od.order_id = o.id
        WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
          AND od.delivery_status = 'delivered'
        ORDER BY od.created_at DESC LIMIT 1),
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', (SELECT id FROM public.order_items
                             WHERE order_id = (
                               SELECT o.id FROM public.orders o
                                 JOIN public.order_deliveries od ON od.order_id = o.id
                                WHERE o.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d3'
                                  AND od.delivery_status = 'delivered'
                                ORDER BY od.created_at DESC LIMIT 1)
                             LIMIT 1),
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'split_order: a delivery order is rejected (P0001)');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
