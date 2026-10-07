-- Delivery schema contract test.
--
-- The POS-on-Supabase delivery module (odd/tasks/domicilios.md, task 2) adds
-- a small registry (couriers, customers, addresses) and an order_deliveries
-- row that mirrors a delivery order with a snapshot of the customer and the
-- address, the delivery fee, the payment mode and the courier/closure state.
-- This file pins the schema-only contract of that change; the RPCs that drive
-- the state machine are task 3.
--
--   - public.couriers: admin-managed list (name, phone, is_active). SELECT for
--     admin / cashier / delivery_operator of the tenant; INSERT / UPDATE admin;
--     no DELETE policy.
--   - public.customers: per-tenant registry keyed by phone, UNIQUE
--     (restaurant_id, phone) so the same phone may exist in two tenants but
--     not twice in one. SELECT/INSERT/UPDATE for admin / cashier /
--     delivery_operator of the tenant; no DELETE policy.
--   - public.customer_addresses: saved addresses per customer, at most one
--     default per customer (partial unique index WHERE is_default), ON DELETE
--     CASCADE with the customer, restaurant consistency enforced by the same
--     trigger style payments uses.
--   - orders.order_type text NOT NULL DEFAULT 'dine_in' CHECK IN ('dine_in',
--     'delivery') plus CHECK (order_type = 'dine_in' OR table_id IS NULL) so
--     a delivery order never points at a table.
--   - public.order_deliveries: 1:1 with orders, snapshot columns, delivery_fee
--     bigint >= 0, payment_mode ('prepaid' | 'cash_on_delivery') with
--     cash_change_for only allowed for COD, courier_id nullable, delivery_status
--     lifecycle ('received'|'preparing'|'ready'|'out_for_delivery'|'delivered'
--     |'failed'|'cancelled') default 'received', failure_reason required when
--     status='failed' (<= 200), consistency trigger so the order is delivery
--     and all three points share its restaurant. SELECT for admin / cashier /
--     delivery_operator / kitchen of the tenant (kitchen prints the customer
--     on the ticket); NO direct INSERT/UPDATE/DELETE for authenticated (writes
--     only through SECURITY DEFINER RPCs in task 3, like payments).
--   - supabase_realtime publication: order_deliveries with REPLICA IDENTITY FULL.
--
-- Waiters have no read on customers/customer_addresses/order_deliveries.
-- Kitchen reads order_deliveries only (the customer on the ticket), not
-- customers or addresses. delivery_operator can create customers and addresses
-- (the operator registers unknown customers at the counter); only admins write
-- couriers.
--
-- Deferred-evaluation note: the order_deliveries consistency trigger is
-- deferred, so a bad row is accepted by the INSERT and rejected at COMMIT.
-- pg_temp.dv_run_deferred wraps a setup block inside a subtransaction and
-- forces the deferred evaluation (SET CONSTRAINTS ALL IMMEDIATE) inside that
-- same subtransaction, which is what keeps a case that fails on its second
-- statement from leaving an orphan row queued. pg_temp.dv_run_deferred restores
-- DEFERRED mode afterwards, because SET CONSTRAINTS is transaction-scoped and
-- an aborted subtransaction does NOT roll the mode back.
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.
--
-- Impersonation follows 010/030/040/050/060: SET LOCAL ROLE authenticated plus
-- request.jwt.claims.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(151);

-- Explicit, because every INSERT below queues deferred events and a leftover
-- IMMEDIATE mode would fire them at the end of the next statement, before the
-- related rows exist.
SET CONSTRAINTS ALL DEFERRED;

-- ============================================
-- Helpers
-- ============================================
-- Every probe below is SECURITY INVOKER, so RLS applies exactly as it does for
-- the API, and every one turns an error into a sentinel: against the
-- pre-migration schema the relations do not exist, and a sentinel is what keeps
-- this file runnable (and RED) there instead of aborting the transaction.
CREATE FUNCTION pg_temp.dv_count(p_sql text)
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

CREATE FUNCTION pg_temp.dv_text(p_sql text)
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
    RETURN '<dv-error>';
  END;
  RETURN v;
END;
$$;

-- Runs a statement with the caller's privileges and returns the affected row
-- count, so "this write touches zero rows" can be measured. An errored
-- statement returns -1 instead of aborting the file.
CREATE FUNCTION pg_temp.probe_exec(p_sql text)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_rows integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN others THEN
    RETURN -1;
  END;
  RETURN v_rows;
END;
$$;

CREATE FUNCTION pg_temp.dv_has_privilege(p_role text, p_table text, p_priv text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_table regclass;
  v boolean;
BEGIN
  BEGIN
    v_table := to_regclass(p_table);
    IF v_table IS NULL THEN
      RETURN NULL;
    END IF;
    v := has_table_privilege(p_role, v_table, p_priv);
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

-- Runs a multi-statement setup inside a subtransaction and returns its
-- SQLSTATE ('ok' when it survived). Keeps a case that fails on its second
-- statement from leaving an orphan row queued.
CREATE FUNCTION pg_temp.dv_run(p_sql text)
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

-- Same, plus the forced commit-time evaluation of the deferred constraint
-- trigger. SET CONSTRAINTS is transaction-scoped, so DEFERRED is restored
-- afterwards; an aborted subtransaction would not do it.
CREATE FUNCTION pg_temp.dv_run_deferred(p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    v_state := 'ok';
  EXCEPTION WHEN others THEN
    v_state := SQLSTATE;
  END;
  EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
  RETURN v_state;
END;
$$;

-- Flushes the trigger queue of an already-inserted, expected-good row.
CREATE FUNCTION pg_temp.dv_flush()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';
    v_state := 'ok';
  EXCEPTION WHEN others THEN
    v_state := SQLSTATE;
  END;
  EXECUTE 'SET CONSTRAINTS ALL DEFERRED';
  RETURN v_state;
END;
$$;

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_table('public', 'couriers', 'table public.couriers exists');
SELECT has_table('public', 'customers', 'table public.customers exists');
SELECT has_table('public', 'customer_addresses', 'table public.customer_addresses exists');
SELECT has_table('public', 'order_deliveries', 'table public.order_deliveries exists');

SELECT has_column('public', 'couriers', 'restaurant_id', 'couriers is tenant-scoped');
SELECT has_column('public', 'couriers', 'name', 'couriers carries a name');
SELECT has_column('public', 'couriers', 'phone', 'couriers carries a phone');
SELECT has_column('public', 'couriers', 'is_active', 'couriers carries an is_active flag');
SELECT has_column('public', 'couriers', 'created_at', 'couriers carries created_at');
SELECT has_column('public', 'couriers', 'updated_at', 'couriers carries updated_at');

SELECT has_column('public', 'customers', 'restaurant_id', 'customers is tenant-scoped');
SELECT has_column('public', 'customers', 'phone', 'customers carries a phone');
SELECT has_column('public', 'customers', 'name', 'customers carries a name');
SELECT has_column('public', 'customers', 'notes', 'customers carries notes');
SELECT has_column('public', 'customers', 'created_at', 'customers carries created_at');
SELECT has_column('public', 'customers', 'updated_at', 'customers carries updated_at');

SELECT has_column('public', 'customer_addresses', 'restaurant_id', 'customer_addresses is tenant-scoped');
SELECT has_column('public', 'customer_addresses', 'customer_id', 'customer_addresses points at the customer');
SELECT has_column('public', 'customer_addresses', 'label', 'customer_addresses carries a label');
SELECT has_column('public', 'customer_addresses', 'address_line', 'customer_addresses carries an address_line');
SELECT has_column('public', 'customer_addresses', 'neighborhood', 'customer_addresses carries a neighborhood');
SELECT has_column('public', 'customer_addresses', 'reference', 'customer_addresses carries a reference');
SELECT has_column('public', 'customer_addresses', 'is_default', 'customer_addresses carries an is_default flag');

SELECT has_column('public', 'order_deliveries', 'order_id', 'order_deliveries points at the order');
SELECT has_column('public', 'order_deliveries', 'restaurant_id', 'order_deliveries is tenant-scoped');
SELECT has_column('public', 'order_deliveries', 'customer_id', 'order_deliveries points at the customer');
SELECT has_column('public', 'order_deliveries', 'customer_name', 'order_deliveries snapshots the customer name');
SELECT has_column('public', 'order_deliveries', 'customer_phone', 'order_deliveries snapshots the customer phone');
SELECT has_column('public', 'order_deliveries', 'address_line', 'order_deliveries snapshots the address_line');
SELECT has_column('public', 'order_deliveries', 'neighborhood', 'order_deliveries snapshots the neighborhood');
SELECT has_column('public', 'order_deliveries', 'address_reference', 'order_deliveries snapshots the address reference');
SELECT has_column('public', 'order_deliveries', 'delivery_fee', 'order_deliveries carries the delivery fee');
SELECT has_column('public', 'order_deliveries', 'payment_mode', 'order_deliveries carries the payment mode');
SELECT has_column('public', 'order_deliveries', 'cash_change_for', 'order_deliveries carries the cash change target');
SELECT has_column('public', 'order_deliveries', 'courier_id', 'order_deliveries points at the courier');
SELECT has_column('public', 'order_deliveries', 'delivery_status', 'order_deliveries carries the lifecycle status');
SELECT has_column('public', 'order_deliveries', 'failure_reason', 'order_deliveries carries the failure reason');
SELECT has_column('public', 'order_deliveries', 'dispatched_at', 'order_deliveries carries dispatched_at');
SELECT has_column('public', 'order_deliveries', 'delivered_at', 'order_deliveries carries delivered_at');
SELECT has_column('public', 'order_deliveries', 'failed_at', 'order_deliveries carries failed_at');
SELECT has_column('public', 'order_deliveries', 'cancelled_at', 'order_deliveries carries cancelled_at');
SELECT has_column('public', 'order_deliveries', 'created_at', 'order_deliveries carries created_at');
SELECT has_column('public', 'order_deliveries', 'updated_at', 'order_deliveries carries updated_at');

-- orders gains order_type + table-id cross-check.
SELECT has_column('public', 'orders', 'order_type', 'orders carries order_type');

SELECT is(
  pg_temp.dv_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.couriers') $$),
  'true'::text, 'RLS is enabled on couriers');
SELECT is(
  pg_temp.dv_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.customers') $$),
  'true'::text, 'RLS is enabled on customers');
SELECT is(
  pg_temp.dv_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.customer_addresses') $$),
  'true'::text, 'RLS is enabled on customer_addresses');
SELECT is(
  pg_temp.dv_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.order_deliveries') $$),
  'true'::text, 'RLS is enabled on order_deliveries');

-- Per-tenant uniqueness: the same phone may exist in two tenants, never twice
-- in one. The same applies to the (restaurant_id, code)-style catalogue
-- pattern.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.customers') AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(restaurant_id, phone)%'), 1::bigint,
  'customers uniqueness spans (restaurant_id, phone)');

-- The "one default address per customer" rule is a partial unique index
-- (WHERE is_default), not a CHECK, so a customer may hold several non-default
-- rows but at most one default.
SELECT is(
  (SELECT count(*)::bigint FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'customer_addresses'
      AND indexdef LIKE '%WHERE%is_default%'), 1::bigint,
  'customer_addresses carries a partial unique index on the default flag');

-- order_deliveries is 1:1 with orders: PK on order_id IS the constraint.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.order_deliveries') AND contype = 'p'
      AND conname = 'order_deliveries_pkey'), 1::bigint,
  'order_deliveries PK is on order_id');

-- Cross-table invariants cannot be CHECKs (they read other rows), so they are
-- deferred CONSTRAINT triggers on order_deliveries. Mirrors the payments
-- shape; pin it here so a future migration that lifts it cannot drift.
SELECT is(
  (SELECT count(*)::bigint FROM pg_trigger
    WHERE tgrelid = to_regclass('public.order_deliveries')
      AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred), 1::bigint,
  'order_deliveries carries a DEFERRABLE INITIALLY DEFERRED constraint trigger');

SELECT is(
  (SELECT count(*)::bigint FROM pg_trigger
    WHERE tgrelid = to_regclass('public.customer_addresses')
      AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred), 1::bigint,
  'customer_addresses carries a DEFERRABLE INITIALLY DEFERRED constraint trigger');

-- Money columns are bigint, the same convention payments established.
SELECT is(
  (SELECT count(*)::bigint FROM pg_attribute
    WHERE attrelid = to_regclass('public.order_deliveries')
      AND attnum > 0 AND NOT attisdropped
      AND attname IN ('delivery_fee', 'cash_change_for')
      AND format_type(atttypid, atttypmod) = 'bigint'), 2::bigint,
  'order_deliveries money columns are bigint (whole COP pesos)');

-- CHECK contracts
SELECT is(
  pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = to_regclass('public.orders')
                      AND conname = 'orders_order_type_check' $$),
  $$CHECK ((order_type = ANY (ARRAY['dine_in'::text, 'delivery'::text])))$$::text,
  'orders order_type is enum (dine_in, delivery)');

-- The CHECK is a separate constraint; pin its name so a later rename shows up.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.orders')
      AND contype = 'c' AND conname = 'orders_order_type_table_id_check'), 1::bigint,
  'orders carries the (order_type, table_id) cross-check constraint');

SELECT ok(
  pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = to_regclass('public.order_deliveries')
                      AND conname = 'order_deliveries_delivery_status_check' $$)
    LIKE '%received%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_delivery_status_check' $$)
    LIKE '%out_for_delivery%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_delivery_status_check' $$)
    LIKE '%failed%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_delivery_status_check' $$)
    LIKE '%cancelled%',
  'order_deliveries delivery_status CHECK covers the seven lifecycle values');

-- The default value for delivery_status lives in pg_attrdef (the column
-- default), not in the CHECK. Pin it here as a separate assertion.
SELECT is(
  (SELECT (SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef
             WHERE adrelid = to_regclass('public.order_deliveries')
               AND adnum = (SELECT attnum FROM pg_attribute
                             WHERE attrelid = to_regclass('public.order_deliveries')
                               AND attname = 'delivery_status'))::text),
  '''received''::text'::text,
  'order_deliveries.delivery_status defaults to ''received''');

-- The payment_mode CHECK
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.order_deliveries') AND contype = 'c'
      AND conname = 'order_deliveries_payment_mode_check'), 1::bigint,
  'order_deliveries carries a payment_mode CHECK constraint');

-- delivery_fee >= 0
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.order_deliveries') AND contype = 'c'
      AND conname = 'order_deliveries_delivery_fee_check'), 1::bigint,
  'order_deliveries carries a delivery_fee >= 0 CHECK constraint');

-- The "cash_change_for is null UNLESS cash_on_delivery" CHECK is the whole
-- "prepaid does not get change" rule.
SELECT ok(
  pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = to_regclass('public.order_deliveries')
                      AND conname = 'order_deliveries_cash_change_for_check' $$)
    LIKE '%payment_mode = ''cash_on_delivery''%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_cash_change_for_check' $$)
    LIKE '%cash_change_for IS NULL%',
  'cash_change_for is only allowed when payment_mode = cash_on_delivery');

-- failure_reason required when delivery_status = failed
SELECT ok(
  pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = to_regclass('public.order_deliveries')
                      AND conname = 'order_deliveries_failure_reason_check' $$)
    LIKE '%delivery_status = ''failed''%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_failure_reason_check' $$)
    LIKE '%failure_reason IS NOT NULL%'
  AND pg_temp.dv_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.order_deliveries')
                          AND conname = 'order_deliveries_failure_reason_check' $$)
    LIKE '%length(btrim(failure_reason))%',
  'failure_reason is required when delivery_status = failed and bounded in length');

-- Phone regex on customers (digits only, 7..15). The same constraint name is
-- used by every column that checks it; pin by name to keep callers stable.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.customers') AND contype = 'c'
      AND conname = 'customers_phone_check'
      AND pg_get_constraintdef(oid) LIKE '%phone ~%'), 1::bigint,
  'customers.phone is validated by a regex CHECK');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.couriers') AND contype = 'c'
      AND conname = 'couriers_phone_check'
      AND pg_get_constraintdef(oid) LIKE '%phone ~%'), 1::bigint,
  'couriers.phone is validated by a regex CHECK (nullable)');

-- Foreign keys
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.customer_addresses') AND contype = 'f'
      AND confrelid = to_regclass('public.customers')
      AND confdeltype = 'c'), 1::bigint,
  'customer_addresses customer_id is ON DELETE CASCADE');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.order_deliveries') AND contype = 'f'
      AND confrelid = to_regclass('public.orders')
      AND confdeltype = 'c'), 1::bigint,
  'order_deliveries order_id is ON DELETE CASCADE (the PK doubles as the FK)');

-- Realtime publication
SELECT is(
  (SELECT count(*)::bigint FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'order_deliveries'), 1::bigint,
  'order_deliveries is in the supabase_realtime publication');

SELECT is(
  pg_temp.dv_text($$ SELECT relreplident::text FROM pg_class
                     WHERE oid = to_regclass('public.order_deliveries') $$),
  'f'::text,
  'order_deliveries uses REPLICA IDENTITY FULL');

-- updated_at maintenance trigger on every new table.
SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.couriers')
      AND p.proname = 'set_updated_at'
      AND (tg.tgtype::int & 2) = 2      -- BEFORE
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'couriers carries a BEFORE UPDATE trigger maintaining updated_at');
SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.customers')
      AND p.proname = 'set_updated_at'
      AND (tg.tgtype::int & 2) = 2
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'customers carries a BEFORE UPDATE trigger maintaining updated_at');
SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.customer_addresses')
      AND p.proname = 'set_updated_at'
      AND (tg.tgtype::int & 2) = 2
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'customer_addresses carries a BEFORE UPDATE trigger maintaining updated_at');
SELECT is(
  (SELECT count(*)::bigint
     FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
    WHERE tg.tgrelid = to_regclass('public.order_deliveries')
      AND p.proname = 'set_updated_at'
      AND (tg.tgtype::int & 2) = 2
      AND (tg.tgtype::int & 16) = 16),  1::bigint,
  'order_deliveries carries a BEFORE UPDATE trigger maintaining updated_at');

-- order_deliveries carries no INSERT policy: writes are RPC-only.
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_deliveries'
      AND cmd = 'INSERT'), 0::bigint,
  'order_deliveries carries no INSERT policy');

-- couriers and customers have no DELETE policy.
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'couriers'
      AND cmd = 'DELETE'), 0::bigint,
  'couriers carries no DELETE policy');
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customers'
      AND cmd = 'DELETE'), 0::bigint,
  'customers carries no DELETE policy');
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customer_addresses'
      AND cmd = 'DELETE'), 0::bigint,
  'customer_addresses carries no DELETE policy');

-- ============================================
-- 2. Fixtures: two tenants, full role set
-- ============================================
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'delivery-tenant-a', 'Delivery Tenant A'),
  ('bbbbbbbb-0000-4000-8000-0000000000d2', 'delivery-tenant-b', 'Delivery Tenant B');

-- One profile per role in tenant A; only an admin in tenant B so the cross-tenant
-- cases can prove isolation.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d1"}'::jsonb,
   '{"full_name":"Delivery Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d1"}'::jsonb,
   '{"full_name":"Delivery Cashier A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d1"}'::jsonb,
   '{"full_name":"Delivery Waiter A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-kitchen-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"kitchen",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d1"}'::jsonb,
   '{"full_name":"Delivery Kitchen A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000e5', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-operator-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"delivery_operator",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-0000000000d1"}'::jsonb,
   '{"full_name":"Delivery Operator A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000e7', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'deliv-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-0000000000d2"}'::jsonb,
   '{"full_name":"Delivery Admin B"}'::jsonb, now(), now());

SELECT is(
  (SELECT role FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000e5')::text,
  'delivery_operator'::text,
  'fixture: tenant A carries a delivery_operator profile');

-- ============================================
-- 3. Couriers: admin-only writes
-- ============================================
SELECT is(
  pg_temp.dv_count($$ SELECT count(*) FROM public.couriers
                      WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  0::bigint,
  'fixture: tenant A has no couriers yet');

-- The admin creates a courier without naming restaurant_id; the DEFAULT places
-- it in the caller's own tenant.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.couriers (name, phone)
                       VALUES ('Carlos Repartidor', '3001234567') $$),
  1,
  'an admin can create a courier without naming restaurant_id');

SELECT is(
  pg_temp.dv_text($$ SELECT restaurant_id::text FROM public.couriers
                       WHERE name = 'Carlos Repartidor' $$),
  'aaaaaaaa-0000-4000-8000-0000000000d1'::text,
  'the courier landed in the caller''s own tenant');

SELECT is(
  pg_temp.probe_exec($$ UPDATE public.couriers SET is_active = false
                       WHERE name = 'Carlos Repartidor' $$),
  1,
  'an admin can deactivate a courier');

RESET ROLE;

-- Cashiers and delivery operators can SELECT the courier (they print and
-- assign it), but cannot INSERT/UPDATE/DELETE.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dv_count('SELECT count(*) FROM public.couriers'),
  1::bigint,
  'a cashier of tenant A sees the tenant A courier');

SELECT throws_ok(
  $$ INSERT INTO public.couriers (name, phone) VALUES ('Hijack', '003000000001') $$,
  '42501', NULL,
  'a cashier cannot create a courier');
SELECT is(
  pg_temp.probe_exec($$ UPDATE public.couriers SET name = 'X' $$),
  0,
  'a cashier updating couriers affects zero rows');
SELECT is(
  pg_temp.probe_exec($$ DELETE FROM public.couriers $$),
  0,
  'a cashier deleting couriers affects zero rows');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dv_count('SELECT count(*) FROM public.couriers'),
  1::bigint,
  'a delivery_operator of tenant A sees the tenant A courier');

SELECT throws_ok(
  $$ INSERT INTO public.couriers (name, phone) VALUES ('Operator', '003000000002') $$,
  '42501', NULL,
  'a delivery_operator cannot create a courier');
SELECT is(
  pg_temp.probe_exec($$ UPDATE public.couriers SET name = 'X' $$),
  0,
  'a delivery_operator updating couriers affects zero rows');

RESET ROLE;

-- ============================================
-- 4. Customers: per-tenant registry, waiter cannot read
-- ============================================
-- Insert a customer as the admin. We seed the rows below; the positive
-- per-role read paths come from the "delivery_operator can create" section.
SELECT is(
  pg_temp.dv_count($$ SELECT count(*) FROM public.customers
                      WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  0::bigint,
  'fixture: tenant A has no customers yet');

-- Phone format is enforced (digits only, 7..15).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('abc123', 'Bad phone') $$,
  '23514', NULL,
  'a non-digit phone is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('12345', 'Too short') $$,
  '23514', NULL,
  'a phone shorter than 7 digits is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name)
      VALUES ('123456789012345678', 'Too long') $$,
  '23514', NULL,
  'a phone longer than 15 digits is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('300 123 4567', 'Spaces') $$,
  '23514', NULL,
  'a phone with spaces is rejected');

-- name is trimmed, so blank or >120 are rejected too.
SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('3001112233', '') $$,
  '23514', NULL,
  'a blank name is rejected');
SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name)
      VALUES ('3001112233', repeat('x', 121)) $$,
  '23514', NULL,
  'a name longer than 120 characters is rejected');

-- INSERT two valid customers in tenant A and one in tenant B.
SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.customers (phone, name)
                       VALUES ('3001112233', 'Maria Lopez'),
                              ('3002223344', 'Juan Perez') $$),
  2,
  'an admin of tenant A inserts two customers in one statement');

SELECT is(
  pg_temp.dv_text($$ SELECT restaurant_id::text FROM public.customers
                       WHERE phone = '3001112233' $$),
  'aaaaaaaa-0000-4000-8000-0000000000d1'::text,
  'the customer inserted without restaurant_id landed in the caller''s own tenant');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000e7","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.customers (phone, name)
                       VALUES ('3001112233', 'Maria Tenant B') $$),
  1,
  'tenant B can hold the same phone as tenant A (UNIQUE is per-tenant)');

RESET ROLE;

SELECT is(
  pg_temp.dv_count($$ SELECT count(*) FROM public.customers
                      WHERE phone = '3001112233' $$),
  2::bigint,
  'the shared phone exists once per tenant');

-- Within a tenant the phone is unique.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('3001112233', 'Duplicate') $$,
  '23505', NULL,
  'the same tenant cannot create the same phone twice');

RESET ROLE;

-- A delivery_operator can create a customer (the counter registers unknown
-- customers on the fly).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.customers (phone, name)
                       VALUES ('3003334455', 'Operator Created') $$),
  1,
  'a delivery_operator can create a customer in their own tenant');

RESET ROLE;

-- A waiter of tenant A cannot read customers.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.customers'), 0::bigint,
  'a waiter of tenant A sees no customer (no courier/customer read)');

SELECT throws_ok(
  $$ INSERT INTO public.customers (phone, name) VALUES ('3004445566', 'Waiter Created') $$,
  '42501', NULL,
  'a waiter cannot create a customer');

RESET ROLE;

-- ============================================
-- 5. Customer addresses: one default per customer, cascade on delete
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.customer_addresses
                       (customer_id, address_line, is_default)
     SELECT id, 'Calle 1 #2-3', true FROM public.customers
      WHERE phone = '3001112233' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  1,
  'a delivery_operator can create the first (default) address for a customer');

SELECT is(
  pg_temp.dv_run($$ INSERT INTO public.customer_addresses
                       (customer_id, address_line, is_default)
     SELECT id, 'Calle 4 #5-6', true FROM public.customers
      WHERE phone = '3001112233' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  '23505'::text,
  'a second default address for the same customer is rejected by the partial unique index');

SELECT is(
  pg_temp.probe_exec($$ INSERT INTO public.customer_addresses
                       (customer_id, address_line, is_default)
     SELECT id, 'Calle 4 #5-6', false FROM public.customers
      WHERE phone = '3001112233' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  1,
  'a non-default second address for the same customer is accepted');

RESET ROLE;

-- ON DELETE CASCADE: removing the customer wipes its addresses.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.probe_exec($$ DELETE FROM public.customers
                       WHERE phone = '3001112233'
                         AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  0,
  'an admin cannot DELETE a customer (no DELETE policy on customers)');

-- The same RLS-bypassing deletion is done by postgres below to exercise the FK
-- cascade.
RESET ROLE;

DELETE FROM public.customers
 WHERE phone = '3001112233'
   AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1';

SELECT is(
  pg_temp.dv_count($$ SELECT count(*) FROM public.customer_addresses
                      WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1' $$),
  0::bigint,
  'deleting the customer cascaded its two addresses (both belonged to 3001112233)');

-- The delivery_operator still sees only the two tenant A customers that
-- survived the cascade.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e5","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.dv_count('SELECT count(*) FROM public.customers'),
  2::bigint,
  'a delivery_operator of tenant A sees the two tenant A customers that survived the cascade');

RESET ROLE;

-- Cross-tenant consistency: customer_addresses.restaurant_id must match the
-- customer's restaurant_id (the trigger re-checks at COMMIT, like payments).
-- The customer is in tenant B (3001112233 in tenant B is still there because
-- we only deleted tenant A's copy); the address claims tenant A.
SELECT is(
  pg_temp.dv_run_deferred($$
    INSERT INTO public.customer_addresses (restaurant_id, customer_id, address_line, is_default)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000000d1',
            (SELECT id FROM public.customers
              WHERE phone = '3001112233'
                AND restaurant_id = 'bbbbbbbb-0000-4000-8000-0000000000d2'),
            'Wrong tenant address', false);
  $$),
  '23514'::text,
  'an address whose restaurant_id differs from the customer''s is rejected at commit time');

-- ============================================
-- 6. orders.order_type + table_id cross-check
-- ============================================
-- Existing rows stay dine_in.
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total)
VALUES
  ('cc000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1',
   'active', 20000, 0, 0, 20000),
  ('cc000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000d1',
   'active', 20000, 0, 0, 20000);

-- Default is dine_in (the existing two orders above carried no order_type).
SELECT is(
  pg_temp.dv_text($$ SELECT order_type FROM public.orders
                     WHERE id = 'cc000000-0000-4000-8000-0000000000d1' $$),
  'dine_in'::text,
  'orders default order_type is dine_in');

-- An order_type = 'delivery' with a table_id is rejected by the cross-check.
SELECT throws_ok(
  $$ INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total,
                                order_type, table_id)
     VALUES ('aaaaaaaa-0000-4000-8000-0000000000d1', 'active', 1, 0, 0, 1,
             'delivery', gen_random_uuid()) $$,
  '23514', NULL,
  'a delivery order with a table_id is rejected');

-- An order_type = 'something_else' is rejected by the enum CHECK.
SELECT throws_ok(
  $$ INSERT INTO public.orders (restaurant_id, status, subtotal, tax, tax_percentage, total,
                                order_type)
     VALUES ('aaaaaaaa-0000-4000-8000-0000000000d1', 'active', 1, 0, 0, 1,
             'pickup') $$,
  '23514', NULL,
  'an order_type outside (dine_in, delivery) is rejected');

-- An order_type = 'delivery' without a table_id is accepted.
SELECT lives_ok(
  $$ INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total,
                                order_type)
     VALUES ('cc000000-0000-4000-8000-0000000000d3',
             'aaaaaaaa-0000-4000-8000-0000000000d1',
             'active', 1, 0, 0, 1, 'delivery') $$,
  'a delivery order without a table_id is accepted');

-- Extra delivery orders for the negative-path tests below. Each negative
-- test below targets one of these so the PK on order_deliveries (one row
-- per order) does not collide with the valid d3 insert above.
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total, order_type)
VALUES
  ('cc000000-0000-4000-8000-0000000000e1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'active', 1, 0, 0, 1, 'delivery'),
  ('cc000000-0000-4000-8000-0000000000e2', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'active', 1, 0, 0, 1, 'delivery'),
  ('cc000000-0000-4000-8000-0000000000e3', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'active', 1, 0, 0, 1, 'delivery');

-- ============================================
-- 7. order_deliveries: snapshots, lifecycle, no direct writes
-- ============================================
-- Re-read the customer we have left (the one in tenant A whose phone is
-- 3002223344, since we deleted the 3001112233 one above).
INSERT INTO public.order_deliveries (
  order_id, restaurant_id, customer_id,
  customer_name, customer_phone,
  address_line, neighborhood, address_reference,
  delivery_fee, payment_mode, courier_id
)
SELECT 'cc000000-0000-4000-8000-0000000000d3'::uuid,
       'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
       c.id, c.name, c.phone,
       'Calle 7 #8-9', 'Centro', 'Porton negro',
       3000, 'prepaid',
       (SELECT id FROM public.couriers
         WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'
           AND name = 'Carlos Repartidor')
  FROM public.customers c
 WHERE c.phone = '3002223344'
   AND c.restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1';

SELECT is(pg_temp.dv_flush(), 'ok'::text,
  'a valid order_deliveries row (prepaid, courier assigned) survives the deferred consistency check');

-- Snapshot columns are identity-preserving: changing the customer afterwards
-- does not rewrite the snapshot on the order. The same idea as the payments
-- tender snapshot.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.customers SET name = 'Juan Perez RENAMED'
 WHERE phone = '3002223344'
   AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1';

RESET ROLE;

SELECT is(
  pg_temp.dv_text($$ SELECT customer_name FROM public.order_deliveries
                     WHERE order_id = 'cc000000-0000-4000-8000-0000000000d3' $$),
  'Juan Perez'::text,
  'order_deliveries customer_name snapshot is preserved when the customer is renamed');

-- The CHECKs and the deferred consistency trigger fire BEFORE RLS would deny
-- the write, so they run as postgres here (bypassing RLS). The RLS denial of
-- authenticated writes is exercised separately in section 9.
SELECT throws_ok(
  $$ INSERT INTO public.order_deliveries
     (order_id, restaurant_id, customer_id, customer_name, customer_phone,
      address_line, delivery_fee, payment_mode)
     VALUES ('cc000000-0000-4000-8000-0000000000d3'::uuid,
             'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
             (SELECT id FROM public.customers
               WHERE phone = '3002223344'
                 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
             'Juan', '3002223344', 'Calle 7', -100, 'cash_on_delivery') $$,
  '23514', NULL,
  'a negative delivery_fee is rejected');

-- cash_change_for is only allowed when payment_mode = cash_on_delivery. The
-- prepaid order above carried no cash_change_for; a second INSERT with
-- payment_mode = 'prepaid' and cash_change_for > 0 must be rejected.
SELECT throws_ok(
  $$ INSERT INTO public.order_deliveries
     (order_id, restaurant_id, customer_id, customer_name, customer_phone,
      address_line, delivery_fee, payment_mode, cash_change_for)
     VALUES ('cc000000-0000-4000-8000-0000000000d3'::uuid,
             'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
             (SELECT id FROM public.customers
               WHERE phone = '3002223344'
                 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
             'Juan', '3002223344', 'Calle 7', 0, 'prepaid', 5000) $$,
  '23514', NULL,
  'cash_change_for on a prepaid order is rejected');

-- failure_reason required when delivery_status = failed.
SELECT throws_ok(
  $$ INSERT INTO public.order_deliveries
     (order_id, restaurant_id, customer_id, customer_name, customer_phone,
      address_line, delivery_fee, payment_mode, delivery_status, failure_reason)
     VALUES ('cc000000-0000-4000-8000-0000000000d3'::uuid,
             'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
             (SELECT id FROM public.customers
               WHERE phone = '3002223344'
                 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
             'Juan', '3002223344', 'Calle 7', 0, 'cash_on_delivery', 'failed', NULL) $$,
  '23514', NULL,
  'a failed delivery without failure_reason is rejected');

-- Consistency trigger: order_deliveries.restaurant_id must match its order.
SELECT is(
  pg_temp.dv_run_deferred($$
    INSERT INTO public.order_deliveries
      (order_id, restaurant_id, customer_id, customer_name, customer_phone,
       address_line, delivery_fee, payment_mode)
    VALUES ('cc000000-0000-4000-8000-0000000000e1'::uuid,
            'bbbbbbbb-0000-4000-8000-0000000000d2'::uuid,
            (SELECT id FROM public.customers
              WHERE phone = '3001112233'
                AND restaurant_id = 'bbbbbbbb-0000-4000-8000-0000000000d2'),
            'Wrong tenant', '3001112233', 'Other street', 0, 'cash_on_delivery');
  $$),
  '23514'::text,
  'an order_deliveries row whose restaurant_id differs from its order is rejected at commit time');

-- Consistency trigger: the underlying order must be order_type = delivery.
SELECT is(
  pg_temp.dv_run_deferred($$
    INSERT INTO public.order_deliveries
      (order_id, restaurant_id, customer_id, customer_name, customer_phone,
       address_line, delivery_fee, payment_mode)
    VALUES ('cc000000-0000-4000-8000-0000000000d1'::uuid,
            'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
            (SELECT id FROM public.customers
              WHERE phone = '3002223344'
                AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
            'Juan', '3002223344', 'Calle 7', 0, 'cash_on_delivery');
  $$),
  '23514'::text,
  'an order_deliveries row pointing at a dine_in order is rejected at commit time');

-- Consistency trigger: the customer must belong to the same tenant as the order.
SELECT is(
  pg_temp.dv_run_deferred($$
    INSERT INTO public.order_deliveries
      (order_id, restaurant_id, customer_id, customer_name, customer_phone,
       address_line, delivery_fee, payment_mode)
    VALUES ('cc000000-0000-4000-8000-0000000000e2'::uuid,
            'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
            (SELECT id FROM public.customers
              WHERE phone = '3001112233'
                AND restaurant_id = 'bbbbbbbb-0000-4000-8000-0000000000d2'),
            'Wrong tenant', '3001112233', 'Other street', 0, 'cash_on_delivery');
  $$),
  '23514'::text,
  'an order_deliveries row whose customer belongs to another tenant is rejected at commit time');

-- Consistency trigger: the courier must belong to the same tenant as the
-- order.
SELECT is(
  pg_temp.dv_run_deferred($$
    -- Seed a courier in tenant B so we can target it.
    INSERT INTO public.couriers (restaurant_id, name, phone)
    VALUES ('bbbbbbbb-0000-4000-8000-0000000000d2', 'Tenant B courier', '003000000099');
    INSERT INTO public.order_deliveries
      (order_id, restaurant_id, customer_id, customer_name, customer_phone,
       address_line, delivery_fee, payment_mode, courier_id)
    VALUES ('cc000000-0000-4000-8000-0000000000e3'::uuid,
            'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
            (SELECT id FROM public.customers
              WHERE phone = '3002223344'
                AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
            'Juan', '3002223344', 'Calle 7', 0, 'cash_on_delivery',
            (SELECT id FROM public.couriers
              WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-0000000000d2'));
  $$),
  '23514'::text,
  'an order_deliveries row whose courier belongs to another tenant is rejected at commit time');

RESET ROLE;

-- ============================================
-- 8. RLS per role: kitchen reads deliveries, not customers
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e4","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.order_deliveries'), 1::bigint,
  'a kitchen of tenant A sees the tenant A order_deliveries row');

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.customers'), 0::bigint,
  'a kitchen of tenant A sees no customer');

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.customer_addresses'), 0::bigint,
  'a kitchen of tenant A sees no customer_addresses');

SELECT throws_ok(
  $$ INSERT INTO public.order_deliveries
     (order_id, restaurant_id, customer_id, customer_name, customer_phone,
      address_line, delivery_fee, payment_mode)
     VALUES ('cc000000-0000-4000-8000-0000000000d3'::uuid,
             'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
             (SELECT id FROM public.customers
               WHERE phone = '3002223344'
                 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
             'Juan', '3002223344', 'Calle 7', 0, 'cash_on_delivery') $$,
  '42501', NULL,
  'a kitchen cannot insert an order_deliveries row (no INSERT policy)');

SELECT throws_ok(
  $$ UPDATE public.order_deliveries SET delivery_status = 'delivered' $$,
  '42501', NULL,
  'a kitchen cannot update an order_deliveries row (writes are RPC-only)');

RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.order_deliveries'), 0::bigint,
  'a waiter of tenant A sees no order_deliveries row');

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.customers'), 0::bigint,
  'a waiter of tenant A sees no customer (asserted again here for clarity)');

SELECT is(pg_temp.dv_count('SELECT count(*) FROM public.couriers'), 0::bigint,
  'a waiter of tenant A sees no courier');

RESET ROLE;

-- ============================================
-- 9. Authenticated cannot write order_deliveries
-- ============================================
-- The write GRANT is inert by design (mirror payments): RLS has no INSERT
-- policy and the immutability guard refuses UPDATE/DELETE.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000e1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ INSERT INTO public.order_deliveries
     (order_id, restaurant_id, customer_id, customer_name, customer_phone,
      address_line, delivery_fee, payment_mode)
     VALUES ('cc000000-0000-4000-8000-0000000000d3'::uuid,
             'aaaaaaaa-0000-4000-8000-0000000000d1'::uuid,
             (SELECT id FROM public.customers
               WHERE phone = '3002223344'
                 AND restaurant_id = 'aaaaaaaa-0000-4000-8000-0000000000d1'),
             'Juan', '3002223344', 'Calle 7', 0, 'cash_on_delivery') $$,
  '42501', NULL,
  'an admin cannot insert an order_deliveries row (no INSERT policy, writes are RPC-only)');

SELECT throws_ok(
  $$ UPDATE public.order_deliveries SET delivery_status = 'delivered' $$,
  '42501', NULL,
  'an admin cannot update an order_deliveries row');

SELECT throws_ok(
  $$ DELETE FROM public.order_deliveries $$,
  '42501', NULL,
  'an admin cannot delete an order_deliveries row');

RESET ROLE;

-- ============================================
-- 10. Privileges (anon lockdown + over-revoke guard)
-- ============================================
SELECT is(pg_temp.dv_has_privilege('anon', 'public.couriers', 'SELECT'), false,
  'anon cannot SELECT couriers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.couriers', 'INSERT'), false,
  'anon cannot INSERT couriers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.couriers', 'UPDATE'), false,
  'anon cannot UPDATE couriers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.couriers', 'DELETE'), false,
  'anon cannot DELETE couriers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.customers', 'SELECT'), false,
  'anon cannot SELECT customers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.customers', 'INSERT'), false,
  'anon cannot INSERT customers');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.customer_addresses', 'SELECT'), false,
  'anon cannot SELECT customer_addresses');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.order_deliveries', 'SELECT'), false,
  'anon cannot SELECT order_deliveries');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.order_deliveries', 'INSERT'), false,
  'anon cannot INSERT order_deliveries');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.order_deliveries', 'UPDATE'), false,
  'anon cannot UPDATE order_deliveries');
SELECT is(pg_temp.dv_has_privilege('anon', 'public.order_deliveries', 'DELETE'), false,
  'anon cannot DELETE order_deliveries');

-- authenticated keeps the full set on every public table (020 pins them).
SELECT is(pg_temp.dv_has_privilege('authenticated', 'public.couriers',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on couriers (020 pins them)');
SELECT is(pg_temp.dv_has_privilege('authenticated', 'public.customers',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on customers (020 pins them)');
SELECT is(pg_temp.dv_has_privilege('authenticated', 'public.customer_addresses',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on customer_addresses (020 pins them)');
SELECT is(pg_temp.dv_has_privilege('authenticated', 'public.order_deliveries',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on order_deliveries (020 pins them)');

SELECT is(pg_temp.dv_has_privilege('service_role', 'public.couriers',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'service_role keeps the full set on couriers');
SELECT is(pg_temp.dv_has_privilege('service_role', 'public.order_deliveries',
                                  'SELECT,INSERT,UPDATE,DELETE'), true,
  'service_role keeps the full set on order_deliveries');

SELECT * FROM finish();
ROLLBACK;