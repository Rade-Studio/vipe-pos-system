-- split_order / undo_split RPC contract test.
--
-- The legacy client implementation (lib/supabase/service.ts: createPartialOrder
-- ~688-812, deletePartialOrder ~813-912) assembled partial orders by hand
-- from the browser: an unprotected insert on public.orders, a follow-up
-- insert on public.order_items, a per-item UPDATE or DELETE to drain the
-- parent, and finally a recompute of the parent's subtotal/tax/tip/total
-- written from the browser. That client-side composition let two clicks land
-- two children at once, let a partial child be a child again, and trusted the
-- stored subtotal/tax/total to be in sync with the line items. Migration
-- 20261006130000 collapses the whole flow into two SECURITY DEFINER RPCs
-- (public.split_order and public.undo_split), pinned here:
--
--   - SECURITY DEFINER (owner postgres) so the same transaction that locks
--     the parent FOR UPDATE can also write a child order and the new line
--     items, without RLS gates on the partial flow;
--   - SET search_path = '' with every reference schema-qualified;
--   - caller resolution through private.current_restaurant_id() and
--     private.current_app_role(). A profileless caller and a non-cashier /
--     non-admin caller (waiter, kitchen, or no profile at all) raise 42501;
--   - PUBLIC and anon get no EXECUTE; authenticated and service_role keep
--     it (also pinned by 020_anon_lockdown);
--   - split_order takes p_parent_order_id and p_items jsonb of
--     [{order_item_id, quantity}]; quantity >= 1, no duplicate order_item_id,
--     p_items non-empty and <= 50 lines. Bad shapes raise 22023 with
--     indexed messages ('item[N]: ...'); empty array / > 50 lines /
--     non-array have their own messages;
--   - parent must be active|kitchen|delivered, must NOT be a partial child
--     itself, must have no payment row. An order from another tenant or
--     a missing order raises P0002 'order not found'. Everything else is
--     P0001 with the actual problem in the message;
--   - every order_item_id must belong to the parent; partial-quantity moves
--     cannot exceed the parent's current quantity. Foreign / over-quantity
--     raises P0001 'item[N] does not belong to the order' /
--     'item[N] quantity N exceeds the available quantity M';
--   - moving every line at full quantity is rejected: the parent would end
--     with zero items and the caller should just pay the order instead.
--     P0001 'cannot move every item; pay the order instead';
--   - child: same restaurant_id, table_id, waiter_id, status = parent.status,
--     tax_percentage/tip_percentage copied from the parent, is_partial_order
--     true, parent_order_id = parent. subtotal/tax/tip/total computed by the
--     private helper on the post-move line items;
--   - full move: the parent order_item row is UPDATEd to order_id = child
--     (same id, restaurant_id moved with the child); partial move: parent's
--     quantity is decremented, a new child row is INSERTed with the moved
--     quantity (same dish_id, name, price, comments, status, added_at);
--   - bill: subtotal = sum(round(price * quantity)) over the order's items;
--     tax = round(subtotal * coalesce(tax_percentage, 0) / 100); tip =
--     round(subtotal * coalesce(tip_percentage, 0) / 100) (suggested for
--     unpaid orders, same as pay_order); total = subtotal + tax + tip;
--   - response: {child_order_id, parent:{order_id, subtotal, tax, tip, total},
--     child:{order_id, subtotal, tax, tip, total}};
--   - undo_split(p_child_order_id) locks the child and its parent FOR UPDATE
--     (parent first, read child's parent id before locking) and merges every
--     child item back: if the parent already has a line with the same
--     dish_id, price, comments (NULL-safe) and status, the quantity is added
--     and the child row is deleted; otherwise the child row's order_id is
--     UPDATEd back to the parent. The child order is DELETEd and the parent
--     is recomputed. P0002 if the child is missing or another tenant; P0001
--     if the child is not a partial order, has no parent, has a payment row,
--     or has status paid/cancelled. The same rules apply to the parent
--     (cannot undo onto a paid or cancelled order);
--   - the child pays in pay_order afterwards (section 5) and the parent stays
--     unpaid, so the cashier can settle one customer without touching the
--     other.
--
-- Deferred-evaluation note: pg_temp.so_run opens a subtransaction so a case
-- that fails on its second statement (a child row inserted and then a
-- rejected constraint) leaves no orphan row queued behind the call.
--
-- Impersonation follows 010/030/040/050/060/070: SET LOCAL ROLE authenticated
-- plus request.jwt.claims, row counts read through SECURITY INVOKER helpers
-- because the helpers need to see what the caller sees (RLS).
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(70);

-- ============================================
-- Helpers
-- ============================================
CREATE FUNCTION pg_temp.so_count(p_sql text)
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

CREATE FUNCTION pg_temp.so_text(p_sql text)
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
    RETURN '<so-error: ' || SQLSTATE || ': ' || SQLERRM || '>';
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.so_run(p_sql text)
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

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_function(
  'public', 'split_order',
  ARRAY['uuid','jsonb'],
  'split_order exists'
);

SELECT has_function(
  'public', 'undo_split',
  ARRAY['uuid'],
  'undo_split exists'
);

-- ============================================
-- 2. Privileges (also pinned by 020_anon_lockdown)
-- ============================================
SELECT is(
  has_function_privilege('anon', 'public.split_order(uuid,jsonb)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE split_order'
);
SELECT is(
  has_function_privilege('authenticated', 'public.split_order(uuid,jsonb)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on split_order'
);
SELECT is(
  has_function_privilege('service_role', 'public.split_order(uuid,jsonb)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on split_order'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'split_order' AND a.grantee = 0
  ),
  0::bigint,
  'split_order does not grant EXECUTE to PUBLIC'
);

SELECT is(
  has_function_privilege('anon', 'public.undo_split(uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE undo_split'
);
SELECT is(
  has_function_privilege('authenticated', 'public.undo_split(uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on undo_split'
);
SELECT is(
  has_function_privilege('service_role', 'public.undo_split(uuid)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on undo_split'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'undo_split' AND a.grantee = 0
  ),
  0::bigint,
  'undo_split does not grant EXECUTE to PUBLIC'
);

-- ============================================
-- 3. Fixtures: two tenants, three users, several orders
-- ============================================
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000081', 'split-order-a', 'Split Order A'),
  ('bbbbbbbb-0000-4000-8000-000000000082', 'split-order-b', 'Split Order B');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'so-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000081"}'::jsonb,
   '{"full_name":"SO Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'so-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000081"}'::jsonb,
   '{"full_name":"SO Cashier A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'so-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000081"}'::jsonb,
   '{"full_name":"SO Waiter A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'so-cashier-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000082"}'::jsonb,
   '{"full_name":"SO Cashier B"}'::jsonb, now(), now());

-- One open cash register per tenant.
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000d401', 'aaaaaaaa-0000-4000-8000-000000000081',
   now(), 200000, 'open'),
  ('bbbbbbbb-0000-4000-8000-00000000d501', 'bbbbbbbb-0000-4000-8000-000000000082',
   now(), 100000, 'open');

-- Table used by the happy-path parent.
INSERT INTO public.tables (id, restaurant_id, number, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000d601', 'aaaaaaaa-0000-4000-8000-000000000081',
   8001, 'occupied');

-- Orders. The stored subtotal/tax/tip/total are deliberately wrong on every
-- fixture (e.g. 1 on s001) so a code path that trusted them would be caught.
--
-- s001: happy-path parent. 3 items, tax 8%, tip 10%. Item A qty 3, B qty 3,
--       C qty 1. subtotal 95000, tax 7600, tip 9500, total 112100.
-- s002: paid parent (rejection: split_order must refuse a paid parent).
-- s003: cancelled parent (rejection: split_order must refuse cancelled).
-- s004: partial child (rejection: split_order must refuse a partial child
--       itself being split again).
-- s007: parent on a kitchen status with no table (used by undo_split).
-- s101: order of tenant B (for the P0002 cross-tenant rejection).
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts, waiter_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e001', 'aaaaaaaa-0000-4000-8000-000000000081',
   'aaaaaaaa-0000-4000-8000-00000000d601', 'active', 1, 1, 8.00, 0, 10.00, 1, 0,
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000c3')),
  ('aaaaaaaa-0000-4000-8000-00000000e002', 'aaaaaaaa-0000-4000-8000-000000000081',
   NULL, 'paid', 0, 0, 8.00, 0, 0, 0, 0, NULL),
  ('aaaaaaaa-0000-4000-8000-00000000e003', 'aaaaaaaa-0000-4000-8000-000000000081',
   NULL, 'cancelled', 0, 0, 8.00, 0, 0, 0, 0, NULL),
  -- s004 will be turned into a partial child of s001 below.
  ('aaaaaaaa-0000-4000-8000-00000000e004', 'aaaaaaaa-0000-4000-8000-000000000081',
   NULL, 'active', 0, 0, 8.00, 0, 0, 0, 0, NULL),
  ('aaaaaaaa-0000-4000-8000-00000000e007', 'aaaaaaaa-0000-4000-8000-000000000081',
   NULL, 'kitchen', 0, 0, 8.00, 0, 10.00, 0, 0, NULL),
  ('bbbbbbbb-0000-4000-8000-00000000e101', 'bbbbbbbb-0000-4000-8000-000000000082',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0, NULL);

-- s001 items: A (price 10000, qty 3), B (price 20000, qty 3), C (price 5000, qty 1).
INSERT INTO public.order_items
  (id, order_id, dish_id, name, price, quantity, restaurant_id, status, comments)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000a001',
   'aaaaaaaa-0000-4000-8000-00000000e001', NULL, 'Item A', 10000, 3,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', 'no onions'),
  ('aaaaaaaa-0000-4000-8000-00000000a002',
   'aaaaaaaa-0000-4000-8000-00000000e001', NULL, 'Item B', 20000, 3,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', NULL),
  ('aaaaaaaa-0000-4000-8000-00000000a003',
   'aaaaaaaa-0000-4000-8000-00000000e001', NULL, 'Item C', 5000, 1,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', NULL),
  -- s002 (paid parent) carries an item so the rejection is not 'no items'.
  ('aaaaaaaa-0000-4000-8000-00000000a010',
   'aaaaaaaa-0000-4000-8000-00000000e002', NULL, 'Paid A', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', NULL),
  -- s003 (cancelled) carries one item so the rejection is not 'no items'.
  ('aaaaaaaa-0000-4000-8000-00000000a030',
   'aaaaaaaa-0000-4000-8000-00000000e003', NULL, 'CX Item', 5000, 1,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', NULL),
  -- s007 (kitchen status) carries one item with qty 2 (the undo_split target).
  ('aaaaaaaa-0000-4000-8000-00000000a020',
   'aaaaaaaa-0000-4000-8000-00000000e007', NULL, 'Kitchen Item', 15000, 2,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen', NULL),
  -- s101 (tenant B) carries one item for the cross-tenant rejection.
  ('bbbbbbbb-0000-4000-8000-00000000a101',
   'bbbbbbbb-0000-4000-8000-00000000e101', NULL, 'Tenant B Item', 10000, 1,
   'bbbbbbbb-0000-4000-8000-000000000082', 'kitchen', NULL);

-- s002 (paid parent) needs a payment row so the paid-parent rejection runs
-- through the payments check, not the status check.
INSERT INTO public.payments
  (id, restaurant_id, order_id, cash_register_id, cashier_profile_id,
   amount_due, tip_amount, total_charged, change_given, idempotency_key)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f002', 'aaaaaaaa-0000-4000-8000-000000000081',
   'aaaaaaaa-0000-4000-8000-00000000e002', 'aaaaaaaa-0000-4000-8000-00000000d401',
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000c2'),
   10800, 0, 10800, 0, 'aaaaaaaa-0000-4000-8000-000000000f02');
INSERT INTO public.payment_tenders
  (id, restaurant_id, payment_id, line_no, payment_method_id,
   method_code, method_kind, amount, cash_received)
SELECT 'aaaaaaaa-0000-4000-8000-00000000c002',
       'aaaaaaaa-0000-4000-8000-000000000081',
       'aaaaaaaa-0000-4000-8000-00000000f002', 1, m.id, 'cash', 'cash', 10800, 10800
  FROM public.payment_methods m
 WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000081' AND m.code = 'cash';

-- ============================================
-- 4. Happy path: split one full item + part of another
-- ============================================
-- Move A fully (qty 3, id preserved) + 1 from B (qty 3 -> qty 2 on parent,
-- new row on child with qty 1). C stays on parent.
-- Parent after split: B qty 2 + C qty 1 = 45000 subtotal.
-- Child after split:  A qty 3 + B qty 1 = 50000 subtotal.
-- 95000 = 45000 + 50000 (conserved).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- Capture the full response in a temp table so each assertion reads the same
-- return value and we only split s001 once.
CREATE TEMP TABLE so_happy ON COMMIT DROP AS
SELECT public.split_order(
  'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
      'quantity', 3
    ),
    jsonb_build_object(
      'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a002'::uuid,
      'quantity', 1
    )
  )
) AS resp;

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'subtotal') FROM so_happy $q$),
  '45000'::text,
  'happy path: parent subtotal = 2*20000 + 1*5000 = 45000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'tax') FROM so_happy $q$),
  '3600'::text,
  'happy path: parent tax = round(45000 * 8 / 100) = 3600'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'tip') FROM so_happy $q$),
  '4500'::text,
  'happy path: parent tip = round(45000 * 10 / 100) = 4500'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'total') FROM so_happy $q$),
  '53100'::text,
  'happy path: parent total = 45000 + 3600 + 4500 = 53100'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'child' ->> 'subtotal') FROM so_happy $q$),
  '50000'::text,
  'happy path: child subtotal = 3*10000 + 1*20000 = 50000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'child' ->> 'tax') FROM so_happy $q$),
  '4000'::text,
  'happy path: child tax = round(50000 * 8 / 100) = 4000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'child' ->> 'tip') FROM so_happy $q$),
  '5000'::text,
  'happy path: child tip = round(50000 * 10 / 100) = 5000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'child' ->> 'total') FROM so_happy $q$),
  '59000'::text,
  'happy path: child total = 50000 + 4000 + 5000 = 59000'
);

-- Stash the child id for the rest of the suite.
DO $$
DECLARE
  v_child uuid;
BEGIN
  SELECT (resp ->> 'child_order_id')::uuid INTO v_child FROM so_happy;
  PERFORM set_config('so.child_id', v_child::text, false);
END
$$;

-- Conservation per dish: total quantities over parent + child match the
-- pre-split quantities exactly.
SELECT is(
  pg_temp.so_count($q$
    WITH totals AS (
      SELECT oi.name, sum(oi.quantity)::int AS total_qty
        FROM public.order_items oi
       WHERE oi.order_id IN (
         'aaaaaaaa-0000-4000-8000-00000000e001',
         current_setting('so.child_id')::uuid
       )
       GROUP BY oi.name
    )
    SELECT count(*) FROM totals
     WHERE (name = 'Item A' AND total_qty = 3)
        OR (name = 'Item B' AND total_qty = 3)
        OR (name = 'Item C' AND total_qty = 1)
  $q$),
  3::bigint,
  'conservation: every dish sums to the original quantity over parent+child'
);

-- Item ids preserved for full moves (A: the moved row kept its id).
SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a001'
       AND order_id = current_setting('so.child_id')::uuid
  $q$),
  1::bigint,
  'full move: row id i001 is now bound to the child order'
);

-- Part-moved item id is NOT reused; the partial sits in a new row on the child.
SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a002'
       AND order_id = current_setting('so.child_id')::uuid
  $q$),
  0::bigint,
  'partial move: row id i002 stays on the parent (decremented)'
);

SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a002'
       AND order_id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  1::bigint,
  'partial move: row id i002 still belongs to the parent'
);

SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE id <> 'aaaaaaaa-0000-4000-8000-00000000a002'
       AND order_id = current_setting('so.child_id')::uuid
       AND name = 'Item B'
       AND quantity = 1
  $q$),
  1::bigint,
  'partial move: a new child row carries the moved quantity (name=B, qty=1)'
);

-- Parent row i002 was decremented from qty 3 to qty 2.
SELECT is(
  pg_temp.so_text($q$
    SELECT quantity::text FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a002'
  $q$),
  '2'::text,
  'partial move: parent row i002 quantity drops from 3 to 2'
);

-- Child order row shape.
SELECT is(
  pg_temp.so_text($q$
    SELECT status::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'active'::text,
  'child: status copied from parent (active)'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT is_partial_order::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'true'::text,
  'child: is_partial_order = true'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT parent_order_id::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'aaaaaaaa-0000-4000-8000-00000000e001'::text,
  'child: parent_order_id points at s001'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT tax_percentage::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  '8.00'::text,
  'child: tax_percentage copied from parent (8.00)'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT tip_percentage::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  '10.00'::text,
  'child: tip_percentage copied from parent (10.00)'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT restaurant_id::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'aaaaaaaa-0000-4000-8000-000000000081'::text,
  'child: restaurant_id copied from parent'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT table_id::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'aaaaaaaa-0000-4000-8000-00000000d601'::text,
  'child: table_id copied from parent'
);

-- Parent columns: subtotal/tax/tip/total were recomputed and stored.
SELECT is(
  pg_temp.so_text($q$
    SELECT subtotal::text FROM public.orders
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  '45000.00'::text,
  'parent row: subtotal is recomputed to 45000.00'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT tax::text FROM public.orders
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  '3600.00'::text,
  'parent row: tax is recomputed to 3600.00'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT total::text FROM public.orders
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  '53100.00'::text,
  'parent row: total is recomputed to 53100.00'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT tip::text FROM public.orders
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  '4500.00'::text,
  'parent row: tip is recomputed to 4500.00'
);

RESET ROLE;

-- ============================================
-- 5. Integration: pay the child with pay_order; parent remains unpaid
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_text($q$
    SELECT public.pay_order(
      current_setting('so.child_id')::uuid,
      'aaaaaaaa-0000-4000-8000-00000000d401'::uuid,
      -- amount_due 54000 (50000 + 8% tax) plus the suggested 10% tip.
      5000::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000081'
            AND code = 'cash'),
          'amount', 59000::bigint,
          'cash_received', 60000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-00000000faa1'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'integration: pay_order on the child returns status=paid'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT status::text FROM public.orders
     WHERE id = current_setting('so.child_id')::uuid
  $q$),
  'paid'::text,
  'integration: child order is now paid'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT status::text FROM public.orders
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  'active'::text,
  'integration: parent order stays active after the child is paid'
);

RESET ROLE;

-- ============================================
-- 6. undo_split: restores the parent to the exact pre-split state
-- ============================================
-- Split s007 (kitchen status, single item with qty 2) so undo_split can be
-- exercised on a simple case without colliding with the integration-paid
-- child from section 4.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_child uuid;
BEGIN
  SELECT (public.split_order(
    'aaaaaaaa-0000-4000-8000-00000000e007'::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a020'::uuid,
        'quantity', 1
      )
    )
  ) ->> 'child_order_id')::uuid
  INTO v_child;
  PERFORM set_config('so.kid', v_child::text, false);
END
$$;

CREATE TEMP TABLE so_undo ON COMMIT DROP AS
SELECT public.undo_split(current_setting('so.kid')::uuid) AS resp;

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'subtotal') FROM so_undo $q$),
  '30000'::text,
  'undo: parent subtotal restored to 2*15000 = 30000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'tax') FROM so_undo $q$),
  '2400'::text,
  'undo: parent tax = round(30000 * 8 / 100) = 2400'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'tip') FROM so_undo $q$),
  '3000'::text,
  'undo: parent tip = round(30000 * 10 / 100) = 3000'
);

SELECT is(
  pg_temp.so_text($q$ SELECT (resp -> 'parent' ->> 'total') FROM so_undo $q$),
  '35400'::text,
  'undo: parent total = 30000 + 2400 + 3000 = 35400'
);

SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a020'
       AND order_id = 'aaaaaaaa-0000-4000-8000-00000000e007'
       AND quantity = 2
  $q$),
  1::bigint,
  'undo: original row i020 is back on s007 with quantity 2'
);

SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.orders
     WHERE id = current_setting('so.kid')::uuid
  $q$),
  0::bigint,
  'undo: the child order row was deleted'
);

RESET ROLE;

-- ============================================
-- 7. undo_split merges into the matching parent line (no duplicate row)
-- ============================================
-- Split s007 again: move qty 1 of i020 to a new child. Then undo that child
-- and confirm the parent's line was bumped from 1 back to 2 instead of
-- duplicating.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_child uuid;
BEGIN
  SELECT (public.split_order(
    'aaaaaaaa-0000-4000-8000-00000000e007'::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a020'::uuid,
        'quantity', 1
      )
    )
  ) ->> 'child_order_id')::uuid
  INTO v_child;
  PERFORM set_config('so.kid2', v_child::text, false);
END
$$;

SELECT is(
  pg_temp.so_run($q$ SELECT public.undo_split(current_setting('so.kid2')::uuid) $q$),
  'ok'::text,
  'undo merges: undo on the second kitchen child succeeds'
);

SELECT is(
  pg_temp.so_count($q$
    SELECT count(*) FROM public.order_items
     WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e007'
       AND name = 'Kitchen Item'
  $q$),
  1::bigint,
  'undo merges: parent ends with one row (no append) when dish+price+status match'
);

SELECT is(
  pg_temp.so_text($q$
    SELECT quantity::text FROM public.order_items
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000a020'
  $q$),
  '2'::text,
  'undo merges: parent row i020 quantity is restored to 2'
);

RESET ROLE;

-- ============================================
-- 8. Validation: p_items shape and indexed messages
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- empty array
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      '[]'::jsonb
    )
  $q$),
  '22023'::text,
  'validation: empty p_items array raises 22023'
);

-- non-array
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      '{"order_item_id":"aaaaaaaa-0000-4000-8000-00000000a001","quantity":1}'::jsonb
    )
  $q$),
  '22023'::text,
  'validation: non-array p_items raises 22023'
);

-- NULL
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      NULL::jsonb
    )
  $q$),
  '22023'::text,
  'validation: NULL p_items raises 22023'
);

-- > 50 lines
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      (SELECT jsonb_agg(jsonb_build_object(
                'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
                'quantity', 1)
              ORDER BY g)
         FROM generate_series(1, 51) g)
    )
  $q$),
  '22023'::text,
  'validation: p_items with 51 lines raises 22023'
);

-- quantity 0
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 0
        )
      )
    )
  $q$),
  '22023'::text,
  'validation: quantity 0 raises 22023'
);

-- bad uuid
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'not-a-uuid',
          'quantity', 1
        )
      )
    )
  $q$),
  '22023'::text,
  'validation: bad order_item_id uuid raises 22023'
);

-- duplicate order_item_id
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 1
        ),
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  '22023'::text,
  'validation: duplicate order_item_id raises 22023'
);

RESET ROLE;

-- ============================================
-- 9. Validation: foreign / over-quantity / move-all (P0001)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- foreign item id (does not belong to the parent)
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'bbbbbbbb-0000-4000-8000-00000000a101'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'foreign item: order_item_id that does not belong to the parent raises P0001'
);

-- quantity > available
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a003'::uuid,
          'quantity', 5
        )
      )
    )
  $q$),
  'P0001'::text,
  'over-quantity: quantity > parent quantity raises P0001'
);

-- move all three items at full quantity -> P0001 'cannot move every item'
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 3
        ),
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a002'::uuid,
          'quantity', 3
        ),
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a003'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'move-all: moving every line at full quantity raises P0001'
);

RESET ROLE;

-- ============================================
-- 10. Order guards (P0001)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- paid parent
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a010'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'paid parent: a parent with a payment row raises P0001'
);

-- cancelled parent
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e003'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a030'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'cancelled parent: a parent with status=cancelled raises P0001'
);

-- partial child as parent: turn s004 into a child of s001 (status=active is
-- OK for the parent-side check; the rejection is for a partial child being
-- split further).
-- Fixture setup runs as postgres, then the cashier session is restored.
RESET ROLE;
UPDATE public.orders
   SET is_partial_order = true,
       parent_order_id  = 'aaaaaaaa-0000-4000-8000-00000000e001'
 WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e004';
INSERT INTO public.order_items
  (id, order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000a040',
   'aaaaaaaa-0000-4000-8000-00000000e004', NULL, 'Pre Item', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000081', 'kitchen');
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e004'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a040'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0001'::text,
  'partial parent: a parent with is_partial_order=true raises P0001'
);

RESET ROLE;

-- ============================================
-- 11. Cross-tenant rejection (P0002)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'bbbbbbbb-0000-4000-8000-00000000e101'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'bbbbbbbb-0000-4000-8000-00000000a101'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  'P0002'::text,
  'other tenant: split_order on another tenant order raises P0002'
);

RESET ROLE;

-- ============================================
-- 12. Waiter rejection (42501)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  '42501'::text,
  'waiter: only cashier/admin may split orders'
);

SELECT is(
  pg_temp.so_run($q$
    SELECT public.undo_split(
      'aaaaaaaa-0000-4000-8000-00000000e004'::uuid
    )
  $q$),
  '42501'::text,
  'waiter: only cashier/admin may undo splits'
);

RESET ROLE;

-- ============================================
-- 13. undo_split guards
-- ============================================
-- 13a. Paid child -> P0001.
INSERT INTO public.payments
  (id, restaurant_id, order_id, cash_register_id, cashier_profile_id,
   amount_due, tip_amount, total_charged, change_given, idempotency_key)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f010', 'aaaaaaaa-0000-4000-8000-000000000081',
   'aaaaaaaa-0000-4000-8000-00000000e004', 'aaaaaaaa-0000-4000-8000-00000000d401',
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000c2'),
   10000, 0, 10000, 0, 'aaaaaaaa-0000-4000-8000-000000000f01');
INSERT INTO public.payment_tenders
  (id, restaurant_id, payment_id, line_no, payment_method_id,
   method_code, method_kind, amount, cash_received)
SELECT 'aaaaaaaa-0000-4000-8000-00000000c010',
       'aaaaaaaa-0000-4000-8000-000000000081',
       'aaaaaaaa-0000-4000-8000-00000000f010', 1, m.id, 'cash', 'cash', 10000, 10000
  FROM public.payment_methods m
 WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000081' AND m.code = 'cash';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.undo_split(
      'aaaaaaaa-0000-4000-8000-00000000e004'::uuid
    )
  $q$),
  'P0001'::text,
  'paid child: undo_split on a child with a payment row raises P0001'
);

RESET ROLE;

-- 13b. Non-partial order on undo -> P0001.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.undo_split(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    )
  $q$),
  'P0001'::text,
  'non-partial order: undo_split on a non-partial order raises P0001'
);

RESET ROLE;

-- 13c. Cross-tenant on undo -> P0002 (using a fabricated child id of tenant B).
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.so_run($q$
    SELECT public.undo_split(
      'bbbbbbbb-0000-4000-8000-00000000e101'::uuid
    )
  $q$),
  'P0002'::text,
  'other tenant: undo_split on another tenant order raises P0002'
);

RESET ROLE;

-- ============================================
-- 14. Anon lockdown
-- ============================================
SET LOCAL ROLE anon;
SELECT is(
  pg_temp.so_run($q$
    SELECT public.split_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'order_item_id', 'aaaaaaaa-0000-4000-8000-00000000a001'::uuid,
          'quantity', 1
        )
      )
    )
  $q$),
  '42501'::text,
  'anon cannot call split_order'
);

SELECT is(
  pg_temp.so_run($q$
    SELECT public.undo_split(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    )
  $q$),
  '42501'::text,
  'anon cannot call undo_split'
);
RESET ROLE;

-- ============================================
-- 15. Final invariants
-- ============================================
-- Only one real partial order remains (s004, set up in section 10). The s001
-- child from section 4 was paid in section 5, so is_partial_order=true but
-- status=paid; counting by is_partial_order alone gives 2.
SELECT is(
  pg_temp.so_count(
    'SELECT count(*) FROM public.orders '
    'WHERE restaurant_id = ''aaaaaaaa-0000-4000-8000-000000000081'' '
    'AND is_partial_order = true'),
  2::bigint,
  'final: tenant A has two partial-order rows (s004 and the paid s001 child)'
);

SELECT is(
  pg_temp.so_count(
    'SELECT count(*) FROM public.payments '
    'WHERE order_id IN ('
    '''aaaaaaaa-0000-4000-8000-00000000e002'','
    '''aaaaaaaa-0000-4000-8000-00000000e004'''
    ')'),
  2::bigint,
  'final: paid fixtures still hold one payment each'
);

SELECT * FROM finish();
ROLLBACK;