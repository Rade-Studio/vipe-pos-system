-- pay_order RPC contract test.
--
-- The checkout flow had three different ways to settle a bill: a per-tender
-- array passed to public.complete_payment() (numeric(10,2) money, free-text
-- method, no tip or change rule the database could enforce), no atomic way to
-- express a bill paid with two methods at once, and no per-tenant idempotency
-- the browser could rely on. This file pins the replacement contract on
-- public.pay_order (migration 20261006120000):
--
--   - SECURITY DEFINER (owner postgres) so the same row that pays can also
--     write the payment and update the order in one transaction;
--   - p_tenders is a JSON array of {payment_method_id, amount, cash_received}.
--     Cash tenders must carry cash_received >= amount; electronic tenders must
--     not. amount > 0. The CHECKs on public.payment_tenders already encode the
--     cash-vs-electronic rule, so pay_order builds each line to satisfy them;
--   - subtotal is recomputed server-side from order_items
--     (sum(round(price * quantity))), tax = round(subtotal * tax_percentage /
--     100), amount_due = subtotal + tax. An order with no items is rejected;
--   - sum(tender.amount) must equal amount_due + tip_amount exactly. The
--     mismatch raises P0001 and writes nothing;
--   - tenant is resolved from profiles.auth_user_id, the only server-controlled
--     link. A profileless caller and a non-cashier/non-admin caller raise 42501.
--     An order that belongs to another tenant raises P0002 'order not found' -
--     the only signal that does not leak the existence of another tenant's row;
--   - idempotency is per tenant: the same idempotency_key on a paid order
--     returns the existing payment summary with status 'already_paid' and no
--     writes; a different key raises P0001 'order already paid';
--   - the cash register must be open and of the same tenant, else P0001;
--   - the drawer warning is computed but never blocks: change_given over the
--     initial cash + cash-tender totals + deposits - withdrawals of the same
--     register. Legacy payment_transactions are deliberately excluded;
--   - the order goes to status 'paid' and the table is freed only when no
--     other order of the same table is in active|kitchen|delivered;
--   - the response is a jsonb with {payment_id, status, amount_due, tip_amount,
--     total_charged, change_given, drawer_warning, drawer_cash_before, tenders:
--     [{line_no, method_code, amount, cash_received}]};
--   - the broken public.complete_payment() RPC is dropped and no longer callable.
--
-- Deferred-evaluation note: pg_temp.po_run opens a subtransaction so a case that
-- fails on its second statement (a payment row written and then a rejected
-- tender) leaves no orphan row queued for the deferred constraint trigger to
-- reject later. Same reasoning as 060_payments_tenders.
--
-- Impersonation follows 010/030/040/050/060: SET LOCAL ROLE authenticated plus
-- request.jwt.claims, row counts read through SECURITY INVOKER helpers because
-- the helpers need to see what the caller sees (RLS).
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(62);

-- ============================================
-- Helpers
-- ============================================
-- SECURITY INVOKER: the helpers must see the caller's RLS exactly as the API
-- does, and must turn every error into a sentinel so a pre-migration run stays
-- a complete RED instead of aborting the transaction on a missing relation.
CREATE FUNCTION pg_temp.po_count(p_sql text)
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

CREATE FUNCTION pg_temp.po_text(p_sql text)
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
    RETURN '<po-error: ' || SQLSTATE || ': ' || SQLERRM || '>';
  END;
  RETURN v;
END;
$$;

-- Runs a multi-statement setup inside a subtransaction and returns its SQLSTATE
-- ('ok' when it survived). Used to verify "this RPC rejected with the expected
-- SQLSTATE and wrote nothing", because a single-statement RPC that aborts the
-- subtransaction keeps no orphan rows behind.
CREATE FUNCTION pg_temp.po_run(p_sql text)
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
  'public', 'pay_order',
  ARRAY['uuid','uuid','bigint','jsonb','uuid'],
  'pay_order exists'
);

SELECT is(
  to_regprocedure('public.complete_payment(uuid,text[],uuid)') IS NULL,
  true,
  'complete_payment no longer exists');

-- ============================================
-- 2. Privileges (also pinned by 020_anon_lockdown)
-- ============================================
SELECT is(
  has_function_privilege('anon', 'public.pay_order(uuid,uuid,bigint,jsonb,uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE pay_order'
);
SELECT is(
  has_function_privilege('authenticated', 'public.pay_order(uuid,uuid,bigint,jsonb,uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on pay_order'
);
SELECT is(
  has_function_privilege('service_role', 'public.pay_order(uuid,uuid,bigint,jsonb,uuid)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on pay_order'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'pay_order' AND a.grantee = 0
  ),
  0::bigint,
  'pay_order does not grant EXECUTE to PUBLIC'
);

-- ============================================
-- 3. Fixtures: two tenants, three users, three registers, several orders
-- ============================================
-- The catalog defaults arrive through the AFTER INSERT trigger on
-- public.restaurants (20261006100000), so the methods used below exist because
-- that trigger fired.
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000071', 'pay-order-a', 'Pay Order A'),
  ('bbbbbbbb-0000-4000-8000-000000000072', 'pay-order-b', 'Pay Order B');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'po-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000071"}'::jsonb,
   '{"full_name":"PO Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'po-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000071"}'::jsonb,
   '{"full_name":"PO Cashier A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'po-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000071"}'::jsonb,
   '{"full_name":"PO Waiter A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'po-cashier-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000072"}'::jsonb,
   '{"full_name":"PO Cashier B"}'::jsonb, now(), now()),
  -- Caller with no profile at all: the profileless-cashier case.
  ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'po-noprofile@example.com',
   crypt('c-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"PO No Profile"}'::jsonb, now(), now());

-- Sanity: the trigger installed the four defaults for both new tenants.
SELECT is(
  (SELECT count(*) FROM public.payment_methods
    WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071')::bigint,
  4::bigint,
  'fixture: tenant A got the four default methods');

-- Cash registers. Two open registers of tenant A (low and high drawer) plus a
-- closed one for the closed-register case, and one open register of tenant B.
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  -- Low drawer: 10.000 initial, used for the "drawer warning true" case.
  ('aaaaaaaa-0000-4000-8000-00000000c001', 'aaaaaaaa-0000-4000-8000-000000000071',
   now(), 10000, 'open'),
  -- High drawer: 200.000 initial, used for the "drawer warning false" case.
  ('aaaaaaaa-0000-4000-8000-00000000c002', 'aaaaaaaa-0000-4000-8000-000000000071',
   now(), 200000, 'open'),
  -- Closed register: must reject pay_order with P0001.
  ('aaaaaaaa-0000-4000-8000-00000000c003', 'aaaaaaaa-0000-4000-8000-000000000071',
   now(), 100000, 'closed'),
  -- Tenant B register (open).
  ('bbbbbbbb-0000-4000-8000-00000000c101', 'bbbbbbbb-0000-4000-8000-000000000072',
   now(), 100000, 'open');

-- Tables. c201 will be shared with two open orders; c202 with one.
INSERT INTO public.tables (id, restaurant_id, number, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000c201', 'aaaaaaaa-0000-4000-8000-000000000071',
   7001, 'occupied'),
  ('aaaaaaaa-0000-4000-8000-00000000c202', 'aaaaaaaa-0000-4000-8000-000000000071',
   7002, 'occupied');

-- Orders. The stored subtotal/tax/total are deliberately wrong (e.g. 1 on
-- order e001) so a code path that trusts them would be caught.
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts, waiter_id)
VALUES
  -- Happy-path order: items 25000 qty 1 + 24900 qty 1 = 49900 subtotal;
  -- tax 8% -> 3992; amount_due = 53892.
  ('aaaaaaaa-0000-4000-8000-00000000e001', 'aaaaaaaa-0000-4000-8000-000000000071',
   'aaaaaaaa-0000-4000-8000-00000000c201', 'active', 1, 1, 8.00, 0, 0, 1, 0,
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a3')),
  -- Second order on table c201: when order e001 is paid, this is still active.
  ('aaaaaaaa-0000-4000-8000-00000000e002', 'aaaaaaaa-0000-4000-8000-000000000071',
   'aaaaaaaa-0000-4000-8000-00000000c201', 'active', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Order on table c202 alone -> table freed on pay.
  ('aaaaaaaa-0000-4000-8000-00000000e003', 'aaaaaaaa-0000-4000-8000-000000000071',
   'aaaaaaaa-0000-4000-8000-00000000c202', 'active', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Kitchen order with no table_id (multi-tender happy path).
  ('aaaaaaaa-0000-4000-8000-00000000e004', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'kitchen', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Already-paid order (idempotency replay / already-paid tests).
  ('aaaaaaaa-0000-4000-8000-00000000e005', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'paid', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Cancelled order: must fail with the current status in the message.
  ('aaaaaaaa-0000-4000-8000-00000000e006', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'cancelled', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Empty order: no order_items -> P0001.
  ('aaaaaaaa-0000-4000-8000-00000000e007', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0, NULL),
  -- Other-tenant order (tenant B): must be returned as P0002 'order not found'.
  ('eeeeeeee-0000-4000-8000-00000000e101', 'bbbbbbbb-0000-4000-8000-000000000072',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0, NULL);

-- order_items. price is the ALREADY-DISCOUNTED unit price.
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e001', NULL, 'Item A1', 25000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  ('aaaaaaaa-0000-4000-8000-00000000e001', NULL, 'Item A2', 24900, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  -- Order e002: a single line so the table-release assertion is meaningful.
  ('aaaaaaaa-0000-4000-8000-00000000e002', NULL, 'Item B1', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  -- Order e003 (table 7002, single open order -> table released on pay).
  ('aaaaaaaa-0000-4000-8000-00000000e003', NULL, 'Item C1', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  -- Order e004 (no table). subtotal 20000.
  ('aaaaaaaa-0000-4000-8000-00000000e004', NULL, 'Item D1', 20000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  -- Order e005 (already paid).
  ('aaaaaaaa-0000-4000-8000-00000000e005', NULL, 'Item E1', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  -- Order e101 (tenant B).
  ('eeeeeeee-0000-4000-8000-00000000e101', NULL, 'Item F1', 10000, 1,
   'bbbbbbbb-0000-4000-8000-000000000072', 'kitchen');

-- Pre-existing payment on the LOW drawer so the drawer formula has to look
-- past the initial cash.
INSERT INTO public.payments
  (id, restaurant_id, order_id, cash_register_id, cashier_profile_id,
   amount_due, tip_amount, total_charged, change_given, idempotency_key)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f101', 'aaaaaaaa-0000-4000-8000-000000000071',
   'aaaaaaaa-0000-4000-8000-00000000e005', 'aaaaaaaa-0000-4000-8000-00000000c001',
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2'),
   10000, 0, 10000, 0, 'aaaaaaaa-0000-4000-8000-000000000f01');
INSERT INTO public.payment_tenders
  (id, restaurant_id, payment_id, line_no, payment_method_id,
   method_code, method_kind, amount, cash_received)
SELECT 'aaaaaaaa-0000-4000-8000-00000000f111', 'aaaaaaaa-0000-4000-8000-000000000071',
       'aaaaaaaa-0000-4000-8000-00000000f101', 1, m.id, 'cash', 'cash', 10000, 10000
  FROM public.payment_methods m
 WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND m.code = 'cash';

-- Deposit + withdrawal on the LOW drawer so both halves of the drawer formula
-- are exercised.
INSERT INTO public.cash_transactions
  (id, restaurant_id, amount, type, cash_register_id)
VALUES ('aaaaaaaa-0000-4000-8000-00000000d301', 'aaaaaaaa-0000-4000-8000-000000000071',
        5000, 'deposit', 'aaaaaaaa-0000-4000-8000-00000000c001');
INSERT INTO public.cash_transactions
  (id, restaurant_id, amount, type, cash_register_id)
VALUES ('aaaaaaaa-0000-4000-8000-00000000d302', 'aaaaaaaa-0000-4000-8000-000000000071',
        2000, 'withdrawal', 'aaaaaaaa-0000-4000-8000-00000000c001');

-- Bounded-review fixtures (75c007d): one prior paid order on c005 (3rd cash
-- tender line for the drawer-formula regression); a tenant-B paid order;
-- an INACTIVE payment method on tenant B; two active orders e030/e031 that
-- stay active through sections 22-25.
INSERT INTO public.orders (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip, tip_percentage, total, total_discounts) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e023', 'aaaaaaaa-0000-4000-8000-000000000071', NULL, 'paid',   0, 0, 0, 0, 0, 0, 0),
  ('bbbbbbbb-0000-4000-8000-00000000e102', 'bbbbbbbb-0000-4000-8000-000000000072', NULL, 'paid',   0, 0, 0, 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-00000000e030', 'aaaaaaaa-0000-4000-8000-000000000071', NULL, 'active', 0, 0, 0, 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-00000000e031', 'aaaaaaaa-0000-4000-8000-000000000071', NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items (order_id, dish_id, name, price, quantity, restaurant_id, status) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e023', NULL, 'Drawer Extra', 7000, 1, 'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  ('bbbbbbbb-0000-4000-8000-00000000e102', NULL, 'Tenant B Paid', 10000, 1, 'bbbbbbbb-0000-4000-8000-000000000072', 'kitchen'),
  ('aaaaaaaa-0000-4000-8000-00000000e030', NULL, 'Drawer Probe', 1000, 1, 'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen'),
  ('aaaaaaaa-0000-4000-8000-00000000e031', NULL, 'Regression Item', 1000, 1, 'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');
INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given, idempotency_key) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f603', 'aaaaaaaa-0000-4000-8000-000000000071', 'aaaaaaaa-0000-4000-8000-00000000e023', 'aaaaaaaa-0000-4000-8000-00000000c001', (SELECT id FROM public.profiles WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2'), 7000, 0, 7000, 0, 'aaaaaaaa-0000-4000-8000-000000000f08'),
  ('bbbbbbbb-0000-4000-8000-00000000f102', 'bbbbbbbb-0000-4000-8000-000000000072', 'bbbbbbbb-0000-4000-8000-00000000e102', 'bbbbbbbb-0000-4000-8000-00000000c101', (SELECT id FROM public.profiles WHERE auth_user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'), 10000, 0, 10000, 0, 'bbbbbbbb-0000-4000-8000-000000000f10');
INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received) SELECT
  'aaaaaaaa-0000-4000-8000-00000000f614', 'aaaaaaaa-0000-4000-8000-000000000071', 'aaaaaaaa-0000-4000-8000-00000000f603', 1, m.id, 'cash', 'cash', 7000, 7000
  FROM public.payment_methods m WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND m.code = 'cash';
INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no, payment_method_id, method_code, method_kind, amount, cash_received) SELECT
  'bbbbbbbb-0000-4000-8000-00000000f112', 'bbbbbbbb-0000-4000-8000-000000000072', 'bbbbbbbb-0000-4000-8000-00000000f102', 1, m.id, 'cash', 'cash', 10000, 10000
  FROM public.payment_methods m WHERE m.restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000072' AND m.code = 'cash';
INSERT INTO public.payment_methods (id, restaurant_id, code, name, kind, is_active, sort_order) VALUES
  ('bbbbbbbb-0000-4000-8000-0000000cccc1', 'bbbbbbbb-0000-4000-8000-000000000072', 'inactive_x', 'Inactive X', 'cash', false, 99);

-- ============================================
-- 4. A cashier of tenant A: the happy path (cash with change)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- amount_due = 49900 + 3992 = 53892. Cash 60000 -> change 6108, no tip.
SELECT is(
  pg_temp.po_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c001'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 53892::bigint,
          'cash_received', 60000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e01'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'happy path: tender.amount 53892 + cash_received 60000 -> status "paid"');

-- Order row updated.
SELECT is(
  (SELECT status::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  'paid'::text,
  'happy path: order e001 status is now paid');

SELECT is(
  (SELECT subtotal::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  '49900.00'::text,
  'happy path: subtotal is recomputed from order_items (25000 + 24900)');

SELECT is(
  (SELECT tax::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  '3992.00'::text,
  'happy path: tax is round(49900 * 8 / 100) = 3992');

SELECT is(
  (SELECT total::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  '53892.00'::text,
  'happy path: total = subtotal + tax + tip = 49900 + 3992 + 0');

SELECT is(
  (SELECT tip::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  '0.00'::text,
  'happy path: tip persisted on the order');

SELECT is(
  (SELECT tip_percentage::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  '0.00'::text,
  'happy path: tip_percentage is 0 when tip is 0');

-- Payment row.
SELECT is(
  pg_temp.po_count(
    'SELECT count(*) FROM public.payments '
    'WHERE order_id = ''aaaaaaaa-0000-4000-8000-00000000e001'''),
  1::bigint,
  'happy path: one payment row was inserted for order e001');

SELECT is(
  (SELECT amount_due FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  53892::bigint,
  'happy path: payment.amount_due = subtotal + tax = 53892');

SELECT is(
  (SELECT total_charged FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  53892::bigint,
  'happy path: payment.total_charged = amount_due + tip = 53892');

SELECT is(
  (SELECT change_given FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e001'),
  6108::bigint,
  'happy path: change_given = sum(cash_received - amount) = 60000 - 53892 = 6108');

-- Tender line snapshot.
SELECT is(
  pg_temp.po_text($q$
    SELECT string_agg(t.method_code || ':' || t.method_kind || ':' || t.amount::text
                      || ':' || coalesce(t.cash_received::text, '-'),
                      ',' ORDER BY t.line_no)
      FROM public.payment_tenders t
      JOIN public.payments p ON p.id = t.payment_id
     WHERE p.order_id = 'aaaaaaaa-0000-4000-8000-00000000e001'
  $q$),
  'cash:cash:53892:60000'::text,
  'happy path: the cash tender snapshot is method_code=cash, amount=53892, cash_received=60000');

-- Response JSONB carries the right amounts.
SELECT is(
  pg_temp.po_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c001'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 53892::bigint,
          'cash_received', 60000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e01'::uuid
    ))->> 'amount_due'
  $q$),
  '53892'::text,
  'happy path: response jsonb carries amount_due = 53892');

RESET ROLE;

-- ============================================
-- 5. Idempotency: same key returns 'already_paid', different key raises P0001
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c001'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 53892::bigint,
          'cash_received', 60000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e01'::uuid
    ) ->> 'status'
  $q$),
  'already_paid'::text,
  'idempotent replay: same key on a paid order returns status=already_paid');

SELECT is(
  pg_temp.po_count(
    'SELECT count(*) FROM public.payments '
    'WHERE order_id = ''aaaaaaaa-0000-4000-8000-00000000e001'''),
  1::bigint,
  'idempotent replay: no new payment row was written');

-- Different idempotency key on a paid order -> P0001.
SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c001'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 53892::bigint,
          'cash_received', 53892::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e02'::uuid
    )
  $q$),
  'P0001'::text,
  'different idempotency key on a paid order raises P0001');

SELECT is(
  pg_temp.po_count(
    'SELECT count(*) FROM public.payments '
    'WHERE order_id = ''aaaaaaaa-0000-4000-8000-00000000e001'''),
  1::bigint,
  'different-key rejection: still only one payment row for order e001');

RESET ROLE;

-- ============================================
-- 6. Multi-tender (cash 15000 + Nequi 5000) on order e004
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e004'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 15000::bigint,
          'cash_received', 15000::bigint
        ),
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'nequi'),
          'amount', 5000::bigint,
          'cash_received', NULL::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e04'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'multi-tender cash+nequi (exact) returns status=paid');

SELECT is(
  (SELECT change_given FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e004'),
  0::bigint,
  'multi-tender exact: change_given is 0 (cash_received equals the cash line amount)');

SELECT is(
  pg_temp.po_text($q$
    SELECT string_agg(t.method_code || ':' || t.method_kind || ':' || t.amount::text
                      || ':' || coalesce(t.cash_received::text, '-'),
                      ',' ORDER BY t.line_no)
      FROM public.payment_tenders t
      JOIN public.payments p ON p.id = t.payment_id
     WHERE p.order_id = 'aaaaaaaa-0000-4000-8000-00000000e004'
  $q$),
  'cash:cash:15000:15000,nequi:electronic:5000:-'::text,
  'multi-tender: tender lines preserve order, snapshots and cash_received');

RESET ROLE;

-- ============================================
-- 7. Electronic-only exact on order e003 (frees table c202)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e003'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'transfer'),
          'amount', 10000::bigint,
          'cash_received', NULL::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e03'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'electronic-only exact: status=paid');

SELECT is(
  (SELECT change_given FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e003'),
  0::bigint,
  'electronic-only exact: change_given is 0');

RESET ROLE;

-- ============================================
-- 8. Tip-as-surplus: cash 50000 for due 47000 + tip 2000 -> change 1000
-- ============================================
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e008', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e008', NULL, 'Tip Surplus Item', 47000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e008'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      2000::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 49000::bigint,
          'cash_received', 50000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e08'::uuid
    ))->> 'change_given'
  $q$),
  '1000'::text,
  'tip-as-surplus: change_given = 50000 - (47000 + 2000) = 1000');

SELECT is(
  (SELECT tip_amount FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e008'),
  2000::bigint,
  'tip-as-surplus: payment.tip_amount = 2000');

SELECT is(
  (SELECT total_charged FROM public.payments
    WHERE order_id = 'aaaaaaaa-0000-4000-8000-00000000e008'),
  49000::bigint,
  'tip-as-surplus: payment.total_charged = amount_due + tip = 47000 + 2000 = 49000');

SELECT is(
  (SELECT tip_percentage::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e008'),
  '4.26'::text,
  'tip-as-surplus: tip_percentage = round(2000 * 100 / 47000, 2) = 4.26');

RESET ROLE;

-- ============================================
-- 9. Sum mismatch fails and writes nothing
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- amount_due = 10000. Tenders add to 9000 -> P0001.
SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 9000::bigint,
          'cash_received', 9000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e09'::uuid
    )
  $q$),
  'P0001'::text,
  'sum mismatch: tenders below amount_due raise P0001');

SELECT is(
  (SELECT status::text FROM public.orders
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e002'),
  'active'::text,
  'sum mismatch: order e002 status remains active');

RESET ROLE;

-- ============================================
-- 10. Inactive method fails
-- ============================================
UPDATE public.payment_methods SET is_active = false
 WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0a'::uuid
    )
  $q$),
  'P0001'::text,
  'inactive payment method is rejected with P0001');

RESET ROLE;

-- Re-activate so subsequent cases work.
UPDATE public.payment_methods SET is_active = true
 WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash';

-- ============================================
-- 11. Electronic with cash_received is rejected (pay_order catches it; P0001)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'transfer'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0b'::uuid
    )
  $q$),
  'P0001'::text,
  'electronic tender carrying cash_received is rejected by pay_order (P0001)');

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 9999::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0c'::uuid
    )
  $q$),
  'P0001'::text,
  'cash_received < amount is rejected by pay_order (P0001)');

RESET ROLE;

-- ============================================
-- 12. Closed register fails
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c003'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0d'::uuid
    )
  $q$),
  'P0001'::text,
  'a closed register rejects pay_order with P0001');

RESET ROLE;

-- ============================================
-- 13. Other-tenant order -> P0002 'order not found' (no leak)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'eeeeeeee-0000-4000-8000-00000000e101'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0e'::uuid
    )
  $q$),
  'P0002'::text,
  'paying another tenant order raises P0002');

RESET ROLE;

-- ============================================
-- 14. Waiter role -> 42501 (only cashier/admin may pay)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e0f'::uuid
    )
  $q$),
  '42501'::text,
  'a waiter (not cashier/admin) raises 42501');

RESET ROLE;

-- ============================================
-- 15. Profileless caller -> 42501
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-0000000000c1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e10'::uuid
    )
  $q$),
  '42501'::text,
  'a caller with no profile raises 42501');

RESET ROLE;

-- ============================================
-- 16. Cancelled/paid order status fails
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e006'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 1::bigint,
          'cash_received', 1::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e11'::uuid
    )
  $q$),
  'P0001'::text,
  'cancelled order raises P0001');

-- e005 was paid via direct INSERT (no idempotency_key was used by pay_order), so
-- the "already paid" branch does not match and the status check fires.
SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e005'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 1::bigint,
          'cash_received', 1::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e12'::uuid
    )
  $q$),
  'P0001'::text,
  'already-paid order (no matching key) raises P0001');

RESET ROLE;

-- ============================================
-- 17. Empty order (no items) fails
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e007'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 1::bigint,
          'cash_received', 1::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e13'::uuid
    )
  $q$),
  'P0001'::text,
  'empty order (no order_items) raises P0001');

RESET ROLE;

-- ============================================
-- 18. Drawer warning: TRUE when initial cash too low, payment still recorded
-- ============================================
-- Low drawer (c005): initial 10000, plus a 10000 cash tender (f511) on the
-- same register, plus deposit 5000 minus withdrawal 2000 -> drawer_cash_before
-- = 10000 + 10000 + 5000 - 2000 = 23000. We pay 30000 in cash (cash_received
-- 60000) -> change 30000 -> 30000 > 23000 -> drawer_warning TRUE. c005 is
-- dedicated to this assertion so its drawer state is exactly the value the
-- test computes; c001 inherits section 4's 53892 cash payment and would make
-- the drawer too full for a 30000 change to trip the warning.
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000c005', 'aaaaaaaa-0000-4000-8000-000000000071',
   now(), 10000, 'open');
-- A second 'paid' order to host a payment on c002, so the drawer warning test
-- can have a fresh register (c005) with its own payment (f501 -> e017) and
-- cash_transactions, without colliding with the c001 fixture on e005.
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e017', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'paid', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e017', NULL, 'Drawer Warning Fixture', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');

INSERT INTO public.payments
  (id, restaurant_id, order_id, cash_register_id, cashier_profile_id,
   amount_due, tip_amount, total_charged, change_given, idempotency_key)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f501', 'aaaaaaaa-0000-4000-8000-000000000071',
   'aaaaaaaa-0000-4000-8000-00000000e017', 'aaaaaaaa-0000-4000-8000-00000000c005',
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000a2'),
   10000, 0, 10000, 0, 'aaaaaaaa-0000-4000-8000-000000000f05');
INSERT INTO public.payment_tenders
  (id, restaurant_id, payment_id, line_no, payment_method_id,
   method_code, method_kind, amount, cash_received)
SELECT 'aaaaaaaa-0000-4000-8000-00000000f511', 'aaaaaaaa-0000-4000-8000-000000000071',
       'aaaaaaaa-0000-4000-8000-00000000f501', 1, m.id, 'cash', 'cash', 10000, 10000
  FROM public.payment_methods m
 WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND m.code = 'cash';
INSERT INTO public.cash_transactions
  (id, restaurant_id, amount, type, cash_register_id)
VALUES ('aaaaaaaa-0000-4000-8000-00000000d501', 'aaaaaaaa-0000-4000-8000-000000000071',
        5000, 'deposit', 'aaaaaaaa-0000-4000-8000-00000000c005'),
       ('aaaaaaaa-0000-4000-8000-00000000d502', 'aaaaaaaa-0000-4000-8000-000000000071',
        2000, 'withdrawal', 'aaaaaaaa-0000-4000-8000-00000000c005');

INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e014', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e014', NULL, 'Drawer Warning Item', 30000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e014'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c005'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 30000::bigint,
          'cash_received', 60000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e14'::uuid
    ))->> 'drawer_warning'
  $q$),
  'true'::text,
  'drawer warning true: change 30000 exceeds drawer_cash_before 23000');

SELECT is(
  pg_temp.po_count(
    'SELECT count(*) FROM public.payments '
    'WHERE order_id = ''aaaaaaaa-0000-4000-8000-00000000e014'''),
  1::bigint,
  'drawer warning true: the payment is still recorded (warn-only)');

-- Drawer warning false: high drawer (c002, initial 200000). Pay 10000 in cash
-- with 10000 received -> change 0, drawer_warning false, drawer_cash_before
-- reads the initial cash on a never-touched register.
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e015', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e015', NULL, 'High Drawer Item', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');

SELECT is(
  pg_temp.po_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e015'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e15'::uuid
    ))->> 'drawer_warning'
  $q$),
  'false'::text,
  'drawer warning false: change 0 on a 200000 drawer');

-- Separate order so this is a fresh pay_order call (not an idempotent replay
-- whose response carries drawer_cash_before=0). Uses a fresh register that has
-- no payments of its own, so drawer_cash_before is exactly its initial cash.
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000c004', 'aaaaaaaa-0000-4000-8000-000000000071',
   now(), 200000, 'open');

INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e016', 'aaaaaaaa-0000-4000-8000-000000000071',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e016', NULL, 'High Drawer Probe', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000071', 'kitchen');

SELECT is(
  pg_temp.po_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e016'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c004'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e16'::uuid
    ))->> 'drawer_cash_before'
  $q$),
  '200000'::text,
  'drawer_cash_before: initial cash on a never-touched register');

RESET ROLE;

-- ============================================
-- 19. Table release semantics
-- ============================================
-- After section 4 paid order e001, table c201 is still occupied because
-- order e002 is still active on it.
SELECT is(
  (SELECT status::text FROM public.tables
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000c201'),
  'occupied'::text,
  'table release: table c201 stays occupied while another open order (e002) remains');

-- Pay order e002 to free the table.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.po_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'
            AND code = 'cash'),
          'amount', 10000::bigint,
          'cash_received', 10000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000e1a'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'table release: paying the remaining open order on c201 returns paid');

SELECT is(
  (SELECT status::text FROM public.tables
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000c201'),
  'available'::text,
  'table release: c201 becomes available once no open order remains');

-- After section 7, table c202 was paid (order e003 was on it). Confirm.
SELECT is(
  (SELECT status::text FROM public.tables
    WHERE id = 'aaaaaaaa-0000-4000-8000-00000000c202'),
  'available'::text,
  'table release: c202 was freed by the electronic-only payment of e003');

RESET ROLE;

-- ============================================
-- 20. Anon lockdown: anon cannot call pay_order
-- ============================================
SET LOCAL ROLE anon;
SELECT is(
  pg_temp.po_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000e015'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000c002'::uuid,
      0::bigint,
      '[{"payment_method_id":"00000000-0000-4000-8000-000000000000",'
      '"amount":1,"cash_received":1}]'::jsonb,
      'aaaaaaaa-0000-4000-8000-000000000e17'::uuid
    )
  $q$),
  '42501'::text,
  'anon cannot call pay_order (42501)');
RESET ROLE;

-- 21. R3-already-paid-no-key: tenant-A cashier on a tenant-B paid order -> P0002 (tenant check fires before already-paid).
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.po_run($q$ SELECT public.pay_order('bbbbbbbb-0000-4000-8000-00000000e102'::uuid, 'aaaaaaaa-0000-4000-8000-00000000c002'::uuid, 0::bigint, '[{"payment_method_id":"00000000-0000-4000-8000-000000000000","amount":1,"cash_received":1}]'::jsonb, 'aaaaaaaa-0000-4000-8000-000000000e2a'::uuid) $q$), 'P0002'::text, 'R3-already-paid-no-key: tenant-A cashier on tenant-B paid order sees P0002');
RESET ROLE;

-- 22. R3-drawer-formula: c001 drawer_cash_before = 10000 + (10000+53892+7000) + 5000 - 2000 = 73892. Two prior paid orders (e005, e001) + this fixture (e023) = 3 cash tender lines.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.po_text($q$ SELECT (public.pay_order('aaaaaaaa-0000-4000-8000-00000000e030'::uuid, 'aaaaaaaa-0000-4000-8000-00000000c001'::uuid, 0::bigint, jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash'), 'amount', 1000::bigint, 'cash_received', 1000::bigint)), 'aaaaaaaa-0000-4000-8000-000000000e30'::uuid))->>'drawer_cash_before' $q$), '83892'::text, 'R3-drawer-formula: initial 10000 + 3 cash tenders (10000+53892+7000) + deposit 5000 - withdrawal 2000 = 83892');
RESET ROLE;

-- 23. R3-amount-type-cast: negative amount on 2nd tender -> 22023 with 'tender[2]'.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT public.pay_order('aaaaaaaa-0000-4000-8000-00000000e031'::uuid, 'aaaaaaaa-0000-4000-8000-00000000c002'::uuid, 0::bigint, jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash'), 'amount', 1000::bigint, 'cash_received', 1000::bigint), jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash'), 'amount', -500::bigint, 'cash_received', -500::bigint)), 'aaaaaaaa-0000-4000-8000-000000000e2c'::uuid) $q$, '22023', 'pay_order: tender[2].amount must be a positive integer', 'R3-amount-type-cast: negative amount on 2nd tender raises 22023 with tender[2] in the message');
RESET ROLE;

-- 24. R3-tenant-cash-tender: INACTIVE method of another tenant -> not-caller-tenant message.
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT public.pay_order('aaaaaaaa-0000-4000-8000-00000000e031'::uuid, 'aaaaaaaa-0000-4000-8000-00000000c002'::uuid, 0::bigint, jsonb_build_array(jsonb_build_object('payment_method_id', 'bbbbbbbb-0000-4000-8000-0000000cccc1'::uuid, 'amount', 1000::bigint, 'cash_received', 1000::bigint)), 'aaaaaaaa-0000-4000-8000-000000000e2d'::uuid) $q$, 'P0001', 'pay_order: tender[1].payment_method_id does not resolve to a method of the caller tenant', 'R3-tenant-cash-tender: INACTIVE method of another tenant yields the not-caller-tenant message');
RESET ROLE;

-- 25. R3-tender-count-non-positive: 21 tender lines -> 22023 (DoS guard).
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT public.pay_order('aaaaaaaa-0000-4000-8000-00000000e031'::uuid, 'aaaaaaaa-0000-4000-8000-00000000c002'::uuid, 0::bigint, (SELECT jsonb_agg(jsonb_build_object('payment_method_id', (SELECT id FROM public.payment_methods WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND code = 'cash'), 'amount', 1::bigint, 'cash_received', 1::bigint)) FROM generate_series(1, 21) g), 'aaaaaaaa-0000-4000-8000-000000000e2e'::uuid) $q$, '22023', 'pay_order: p_tenders accepts at most 20 lines', 'R3-tender-count-non-positive: 21 tender lines raise 22023 with the at-most-20 message');
RESET ROLE;

-- ============================================
-- 21. Final invariants on the resulting ledger
-- ============================================
SELECT is(
  (SELECT count(*)::bigint FROM public.payments
    WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'),
  12::bigint,
  'final: tenant A holds twelve payment rows (3 fixture payments for e005, e017, e023 + 9 from pay_order: e001, e004, e003, e008, e014, e015, e016, e002, e030)');

SELECT is(
  (SELECT count(*)::bigint FROM public.orders
    WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071' AND status = 'paid'),
  12::bigint,
  'final: 12 orders of tenant A are paid');

SELECT is(
  (SELECT count(*)::bigint FROM public.payment_tenders t
     JOIN public.payments p ON p.id = t.payment_id
    WHERE p.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000071'),
  13::bigint,
  'final: tenant A holds thirteen tender lines (3 fixture + 1+2+1+1+1+1+1+1+1 from pay_order, no extra line on e001 because of the idempotent replay)');

SELECT * FROM finish();
ROLLBACK;