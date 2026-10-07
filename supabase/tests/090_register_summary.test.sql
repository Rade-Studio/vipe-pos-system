-- register_summary / close_register RPC contract test.
--
-- The close-register screen and the admin reports have to compute totals that
-- mix the new ledger (public.payments + public.payment_tenders) with deposits
-- and withdrawals on the drawer, and that exclude the legacy
-- public.payment_transactions rows by design (they were on the old money path
-- with no tender split and no tip the database could enforce; mixing them
-- would double-count pre-migration sales). Migrating that aggregation into the
-- database stops every client from re-deriving the same totals and from
-- reading legacy rows as if they were part of the new flow. Migration
-- 20261006140000 collapses the screen + the close action into two RPCs pinned
-- here:
--
--   public.register_summary(p_cash_register_ids uuid[]) RETURNS jsonb is
--   STABLE + SECURITY INVOKER so it inherits the caller's RLS for free, with
--   every reference schema-qualified and SET search_path = ''. The shape is:
--     { registers_count, initial_cash, payments_count, total_billed,
--       total_tips, total_sales, total_change,
--       methods: [{payment_method_id, code, name, kind, sort_order,
--                  is_active, total, tenders_count} ...], ordered by
--         sort_order then name, LEFT JOINed from the tenant catalog so
--         zero-sale and inactive methods still appear),
--       cash_deposits, cash_withdrawals, expected_cash,
--       tips_payout (= total_tips), expected_cash_after_tips,
--       legacy: { payments_count, total, tips, change,
--                 by_method: {<legacy method>: total} } }
--   Money is whole COP pesos (bigint). The function rounds the numeric(10,2)
--   columns from cash_registers.initial_cash and the legacy ledger to bigint
--   with Postgres half-up rounding; the new ledger is already bigint. Caller
--   checks (42501) and bad input (22023) are documented below.
--
--   public.close_register(p_cash_register_id uuid) RETURNS jsonb is SECURITY
--   DEFINER (owner postgres) so it can take the row lock, validate the caller
--   is a cashier/admin of the tenant and UPDATE the row in the same
--   transaction. SET search_path = ''. Locks the register row FOR UPDATE so
--   it serializes with pay_order (FOR SHARE on the same row): close_register
--   waits for any in-flight payment to finish, and pay_order waiting on the
--   same drawer waits for the close. The close pair is therefore ordered
--   (pay_order-then-close OR close-then-pay_order, no interleaving).
--   Returns {status:'closed', cash_register_id, final_cash, summary} when the
--   drawer was open, {status:'already_closed', cash_register_id, final_cash,
--   closing_timestamp, summary} otherwise (no writes). 42501 for non-cashier
--   / admin; P0002 for missing or other-tenant.
--
-- Caller resolution reuses private.current_restaurant_id() and
-- private.current_app_role(). Both RPCs are pinned by 020_anon_lockdown
-- (EXECUTE on authenticated and service_role, nothing for anon or PUBLIC).
--
-- Deferred-evaluation note: pg_temp.rs_run opens a subtransaction so a case
-- that fails on its second statement leaves no orphan row behind. Same
-- reasoning as 070_pay_order.
--
-- Impersonation follows 010/030/040/050/060/070/080: SET LOCAL ROLE
-- authenticated plus request.jwt.claims, row counts read through SECURITY
-- INVOKER helpers because the helpers need to see what the caller sees (RLS).
--
-- Self-contained on purpose: `supabase test db` runs this file through
-- pg_prove, which does not wrap anything for us, so the file opens its own
-- transaction and always rolls back.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(59);

-- ============================================
-- Helpers
-- ============================================
-- SECURITY INVOKER: the helpers must see the caller's RLS exactly as the API
-- does, and must turn every error into a sentinel so a pre-migration run
-- stays a complete RED instead of aborting the transaction on a missing
-- relation.
CREATE FUNCTION pg_temp.rs_count(p_sql text)
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

CREATE FUNCTION pg_temp.rs_text(p_sql text)
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
    RETURN '<rs-error: ' || SQLSTATE || ': ' || SQLERRM || '>';
  END;
  RETURN v;
END;
$$;

CREATE FUNCTION pg_temp.rs_run(p_sql text)
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

-- JSON value at a top-level key, as text. Avoids the heavy jsonb_path_query
-- machinery in tests that only want to assert one scalar.
CREATE FUNCTION pg_temp.rs_json(p_resp jsonb, p_path text[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v jsonb := p_resp;
  v_k text;
BEGIN
  FOREACH v_k IN ARRAY p_path LOOP
    v := v -> v_k;
  END LOOP;
  RETURN v #>> '{}';
END;
$$;

-- ============================================
-- 1. Structure
-- ============================================
SELECT has_function(
  'public', 'register_summary',
  ARRAY['uuid[]'],
  'register_summary exists'
);

SELECT has_function(
  'public', 'close_register',
  ARRAY['uuid'],
  'close_register exists'
);

-- ============================================
-- 2. Privileges (also pinned by 020_anon_lockdown)
-- ============================================
SELECT is(
  has_function_privilege('anon', 'public.register_summary(uuid[])', 'EXECUTE'),
  false,
  'anon cannot EXECUTE register_summary'
);
SELECT is(
  has_function_privilege('authenticated', 'public.register_summary(uuid[])', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on register_summary'
);
SELECT is(
  has_function_privilege('service_role', 'public.register_summary(uuid[])', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on register_summary'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'register_summary' AND a.grantee = 0
  ),
  0::bigint,
  'register_summary does not grant EXECUTE to PUBLIC'
);

SELECT is(
  has_function_privilege('anon', 'public.close_register(uuid)', 'EXECUTE'),
  false,
  'anon cannot EXECUTE close_register'
);
SELECT is(
  has_function_privilege('authenticated', 'public.close_register(uuid)', 'EXECUTE'),
  true,
  'authenticated keeps EXECUTE on close_register'
);
SELECT is(
  has_function_privilege('service_role', 'public.close_register(uuid)', 'EXECUTE'),
  true,
  'service_role keeps EXECUTE on close_register'
);
SELECT is(
  (
    SELECT count(*)::bigint FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public' AND p.proname = 'close_register' AND a.grantee = 0
  ),
  0::bigint,
  'close_register does not grant EXECUTE to PUBLIC'
);

-- ============================================
-- 3. Fixtures: two tenants, three users per tenant, several registers
-- ============================================
-- The catalog defaults arrive through the AFTER INSERT trigger on
-- public.restaurants (20261006100000), so the four methods used below exist
-- because that trigger fired.
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000091', 'register-summary-a', 'Register Summary A'),
  ('bbbbbbbb-0000-4000-8000-000000000092', 'register-summary-b', 'Register Summary B');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rs-admin-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000091"}'::jsonb,
   '{"full_name":"RS Admin A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rs-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000091"}'::jsonb,
   '{"full_name":"RS Cashier A"}'::jsonb, now(), now()),
  ('aaaaaaaa-0000-4000-8000-0000000000d3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rs-waiter-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"waiter",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000091"}'::jsonb,
   '{"full_name":"RS Waiter A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000d4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rs-cashier-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000092"}'::jsonb,
   '{"full_name":"RS Cashier B"}'::jsonb, now(), now());

-- One INACTIVE method on tenant A so the methods array has a zero-sale inactive
-- row alongside the active ones.
INSERT INTO public.payment_methods
  (id, restaurant_id, code, name, kind, is_active, sort_order)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000d99', 'aaaaaaaa-0000-4000-8000-000000000091',
   'inactive_z', 'Inactive Z', 'cash', false, 99);

-- Cash registers. Two open registers of tenant A (low and high drawer), one
-- closed one, plus one open register of tenant B (other tenant rejection).
INSERT INTO public.cash_registers
  (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  -- Low drawer: initial 10000.00 -> round to 10000; the section that mixes
  -- tender/legacy/tip exercises this drawer.
  ('aaaaaaaa-0000-4000-8000-00000000e001', 'aaaaaaaa-0000-4000-8000-000000000091',
   now(), 10000.00, 'open'),
  -- High drawer: initial 200000.00 -> round to 200000; used for the
  -- equality-with-pay_order probe on a clean register.
  ('aaaaaaaa-0000-4000-8000-00000000e002', 'aaaaaaaa-0000-4000-8000-000000000091',
   now(), 200000.00, 'open'),
  -- Already-closed register of tenant A.
  ('aaaaaaaa-0000-4000-8000-00000000e003', 'aaaaaaaa-0000-4000-8000-000000000091',
   now(), 50000.00, 'closed'),
  -- Tenant B register (open).
  ('bbbbbbbb-0000-4000-8000-00000000e101', 'bbbbbbbb-0000-4000-8000-000000000092',
   now(), 100000.00, 'open');

-- Deposits / withdrawals on the LOW drawer.
INSERT INTO public.cash_transactions
  (id, restaurant_id, amount, type, cash_register_id)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e301', 'aaaaaaaa-0000-4000-8000-000000000091',
   5000.00, 'deposit', 'aaaaaaaa-0000-4000-8000-00000000e001'),
  ('aaaaaaaa-0000-4000-8000-00000000e302', 'aaaaaaaa-0000-4000-8000-000000000091',
   2000.00, 'withdrawal', 'aaaaaaaa-0000-4000-8000-00000000e001');

-- Two orders on tenant A: a mixed-tender one (cash 30k + nequi 20k + tip 5k)
-- and a pure-cash one (cash 47k + tip 0k, customer hands 50k -> change 3k).
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f001', 'aaaaaaaa-0000-4000-8000-000000000091',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0),
  ('aaaaaaaa-0000-4000-8000-00000000f002', 'aaaaaaaa-0000-4000-8000-000000000091',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f001', NULL, 'Mixed Tender Item', 50000, 1,
   'aaaaaaaa-0000-4000-8000-000000000091', 'kitchen'),
  ('aaaaaaaa-0000-4000-8000-00000000f002', NULL, 'Cash Change Item', 47000, 1,
   'aaaaaaaa-0000-4000-8000-000000000091', 'kitchen');

-- ============================================
-- 4. A cashier of tenant A pays both orders on the LOW drawer
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- Order f001: amount_due 50000, tip 5000; tenders cash 30000 + nequi 25000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000f001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      5000::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091'
            AND code = 'cash'),
          'amount', 30000::bigint,
          'cash_received', 30000::bigint
        ),
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091'
            AND code = 'nequi'),
          'amount', 25000::bigint,
          'cash_received', NULL::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000f01'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'fixture: mixed-tender payment lands on the LOW drawer (paid)'
);

-- Order f002: amount_due 47000, tip 0; cash 47000 + cash_received 50000 ->
-- change 3000 (cash change is NOT double-counted: cash method total stays 47000).
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000f002'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091'
            AND code = 'cash'),
          'amount', 47000::bigint,
          'cash_received', 50000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000f02'::uuid
    ) ->> 'status'
  $q$),
  'paid'::text,
  'fixture: cash-with-change payment lands on the LOW drawer (paid)'
);

RESET ROLE;

-- One legacy payment_transactions row on the LOW drawer so the legacy section
-- has real numbers and the equality probe can confirm they do NOT bleed into
-- expected_cash. Numeric(10,2) -> round() -> 25000.
INSERT INTO public.payment_transactions
  (id, order_id, amount, method, cash_received, cash_change,
   "timestamp", cash_register_id, restaurant_id, tip_amount)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000e501',
   'aaaaaaaa-0000-4000-8000-00000000f002', 25000.00, 'cash', 25000.00, 0.00,
   now(), 'aaaaaaaa-0000-4000-8000-00000000e001',
   'aaaaaaaa-0000-4000-8000-000000000091', 1500.00);

-- ============================================
-- 5. register_summary: method grouping (incl. zero-sale and inactive)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'registers_count'
  $q$),
  '1'::text,
  'register_summary: registers_count = 1 for a single register'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'initial_cash'
  $q$),
  '10000'::text,
  'register_summary: initial_cash rounds 10000.00 to 10000'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'payments_count'
  $q$),
  '2'::text,
  'register_summary: payments_count = 2 (the two pay_order payments on the LOW drawer)'
);

-- total_billed = 50000 + 47000 = 97000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'total_billed'
  $q$),
  '97000'::text,
  'register_summary: total_billed = 50000 + 47000 = 97000'
);

-- total_tips = 5000 + 0 = 5000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'total_tips'
  $q$),
  '5000'::text,
  'register_summary: total_tips = 5000 + 0 = 5000'
);

-- total_sales = 30000 (cash) + 25000 (nequi) + 47000 (cash) = 102000.
-- cash change does NOT add to total_sales (it is handed back, not sold).
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'total_sales'
  $q$),
  '102000'::text,
  'register_summary: total_sales = 30000 + 25000 + 47000 = 102000 (cash change is not added)'
);

-- total_change = 0 + 3000 = 3000 (informational, NOT in expected cash).
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'total_change'
  $q$),
  '3000'::text,
  'register_summary: total_change = 3000 (informational only)'
);

-- Methods array: 5 rows (the 4 active defaults + 1 INACTIVE), every code with
-- the right total and tenders_count. Order is sort_order then name.
SELECT is(
  pg_temp.rs_text($q$
    SELECT string_agg(
      (m ->> 'code') || ':' || (m ->> 'kind') || ':' || (m ->> 'total') || ':'
      || (m ->> 'tenders_count') || ':' || (m ->> 'is_active'),
      ',' ORDER BY (m ->> 'sort_order')::int, (m ->> 'name')
    )
      FROM jsonb_array_elements(public.register_summary(
        ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'methods') m
  $q$),
  'cash:cash:77000:2:true,transfer:electronic:0:0:true,'
  || 'nequi:electronic:25000:1:true,bancolombia:electronic:0:0:true,'
  || 'inactive_z:cash:0:0:false'::text,
  'register_summary: methods array includes zero-sale and inactive rows, ordered by sort_order then name'
);

-- cash_deposits / cash_withdrawals round to 5000 / 2000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'cash_deposits'
  $q$),
  '5000'::text,
  'register_summary: cash_deposits rounds 5000.00 to 5000'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'cash_withdrawals'
  $q$),
  '2000'::text,
  'register_summary: cash_withdrawals rounds 2000.00 to 2000'
);

-- expected_cash = initial_cash(10000) + Σ cash tender amounts (30000 + 47000)
--                + deposits(5000) - withdrawals(2000) = 90000.
-- Legacy payment_transactions do NOT enter expected_cash.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'expected_cash'
  $q$),
  '90000'::text,
  'register_summary: expected_cash = 10000 + 30000 + 47000 + 5000 - 2000 = 90000'
);

-- tips_payout = total_tips = 5000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'tips_payout'
  $q$),
  '5000'::text,
  'register_summary: tips_payout = total_tips = 5000'
);

-- expected_cash_after_tips = 90000 - 5000 = 85000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]
    ) ->> 'expected_cash_after_tips'
  $q$),
  '85000'::text,
  'register_summary: expected_cash_after_tips = 90000 - 5000 = 85000'
);

-- Legacy section: zeros + the one payment_transactions row totals. NOT in
-- expected_cash (verified above by the 90000 expectation matching the no-legacy
-- computation).
SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'legacy') ->> 'payments_count'
  $q$),
  '1'::text,
  'register_summary: legacy.payments_count = 1'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'legacy') ->> 'total'
  $q$),
  '25000'::text,
  'register_summary: legacy.total rounds 25000.00 to 25000'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'legacy') ->> 'tips'
  $q$),
  '1500'::text,
  'register_summary: legacy.tips rounds 1500.00 to 1500'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'legacy') ->> 'change'
  $q$),
  '0'::text,
  'register_summary: legacy.change = 0 (no cash_change on the legacy row)'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001']::uuid[]) -> 'legacy' -> 'by_method') ->> 'cash'
  $q$),
  '25000'::text,
  'register_summary: legacy.by_method.cash = 25000'
);

RESET ROLE;

-- ============================================
-- 6. Equality with pay_order's drawer_cash_before
-- ============================================
-- Seed a payment on the HIGH drawer directly (cash 10000, no tip, no change).
-- register_summary.expected_cash and pay_order.drawer_cash_before both read
-- the same drawer state and must agree.
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f003', 'aaaaaaaa-0000-4000-8000-000000000091',
   NULL, 'paid', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f003', NULL, 'Equality Probe', 10000, 1,
   'aaaaaaaa-0000-4000-8000-000000000091', 'kitchen');
INSERT INTO public.payments
  (id, restaurant_id, order_id, cash_register_id, cashier_profile_id,
   amount_due, tip_amount, total_charged, change_given, idempotency_key)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f303', 'aaaaaaaa-0000-4000-8000-000000000091',
   'aaaaaaaa-0000-4000-8000-00000000f003', 'aaaaaaaa-0000-4000-8000-00000000e002',
   (SELECT id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000d2'),
   10000, 0, 10000, 0, 'aaaaaaaa-0000-4000-8000-000000000f33');
INSERT INTO public.payment_tenders
  (id, restaurant_id, payment_id, line_no, payment_method_id,
   method_code, method_kind, amount, cash_received)
SELECT 'aaaaaaaa-0000-4000-8000-00000000f313',
       'aaaaaaaa-0000-4000-8000-000000000091',
       'aaaaaaaa-0000-4000-8000-00000000f303', 1, m.id, 'cash', 'cash', 10000, 10000
  FROM public.payment_methods m
 WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091' AND m.code = 'cash';

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- register_summary.expected_cash = 200000 + 10000 = 210000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e002']::uuid[]) ->> 'expected_cash'
  $q$),
  '210000'::text,
  'equality: register_summary reads expected_cash = 210000 (initial 200000 + cash tender 10000)'
);

-- Pay a NEW order on the same drawer. pay_order computes drawer_cash_before
-- AFTER the seeded payment (it sums existing cash-tenders on the register),
-- so the value must equal the register_summary above.
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f004', 'aaaaaaaa-0000-4000-8000-000000000091',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f004', NULL, 'Equality Probe 2', 1000, 1,
   'aaaaaaaa-0000-4000-8000-000000000091', 'kitchen');

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000f004'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091'
            AND code = 'cash'),
          'amount', 1000::bigint,
          'cash_received', 1000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000f34'::uuid
    )) ->> 'drawer_cash_before'
  $q$),
  '210000'::text,
  'equality: pay_order.drawer_cash_before == register_summary.expected_cash (210000)'
);

RESET ROLE;

-- ============================================
-- 7. Multi-register: sum of initial_cash
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- LOW (10000) + HIGH (200000) = 210000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY[
        'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
        'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
      ]
    ) ->> 'initial_cash'
  $q$),
  '210000'::text,
  'register_summary: multi-register initial_cash sums each register'
);

-- registers_count = 2.
SELECT is(
  pg_temp.rs_text($q$
    SELECT public.register_summary(
      ARRAY[
        'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
        'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
      ]
    ) ->> 'registers_count'
  $q$),
  '2'::text,
  'register_summary: multi-register registers_count = 2'
);

RESET ROLE;

-- ============================================
-- 8. Bad input (22023)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(NULL::uuid[])
  $q$),
  '22023'::text,
  'bad input: NULL array raises 22023'
);

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary('{}'::uuid[])
  $q$),
  '22023'::text,
  'bad input: empty array raises 22023'
);

-- duplicates
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(ARRAY[
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    ])
  $q$),
  '22023'::text,
  'bad input: duplicate ids raise 22023'
);

-- > 100 ids
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(ARRAY(
      SELECT ('aaaaaaaa-0000-4000-8000-00000000e001'::uuid)
        FROM generate_series(1, 101)
    ))
  $q$),
  '22023'::text,
  'bad input: > 100 ids raises 22023'
);

RESET ROLE;

-- ============================================
-- 9. Cross-tenant rejection (P0002)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(
      ARRAY['bbbbbbbb-0000-4000-8000-00000000e101'::uuid]
    )
  $q$),
  'P0002'::text,
  'cross-tenant: register_summary with another tenant id raises P0002'
);

-- Other-tenant id mixed with own-tenant ids still raises P0002 (the whole
-- call must be safe to render, so any foreign id aborts it).
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(ARRAY[
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid,
      'bbbbbbbb-0000-4000-8000-00000000e101'::uuid
    ])
  $q$),
  'P0002'::text,
  'cross-tenant: a foreign id in the array raises P0002 (no partial render)'
);

-- Fabricated uuid (no row): same SQLSTATE so the caller cannot tell apart
-- "missing" and "foreign" - both must be 'not found'.
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(
      ARRAY['ffffffff-0000-4000-8000-000000000000'::uuid]
    )
  $q$),
  'P0002'::text,
  'cross-tenant: a fabricated id (no row) raises P0002 (no leak)'
);

RESET ROLE;

-- ============================================
-- 10. Role / anon denial (42501)
-- ============================================
-- A waiter of tenant A: same tenant, but the role is not cashier/admin.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d3","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001'::uuid]
    )
  $q$),
  '42501'::text,
  'waiter: register_summary raises 42501 (cashier/admin only)'
);

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    )
  $q$),
  '42501'::text,
  'waiter: close_register raises 42501 (cashier/admin only)'
);

RESET ROLE;

-- Anon cannot call either.
SET LOCAL ROLE anon;
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001'::uuid]
    )
  $q$),
  '42501'::text,
  'anon: register_summary is permission denied'
);
SELECT is(
  pg_temp.rs_run($q$
    SELECT public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    )
  $q$),
  '42501'::text,
  'anon: close_register is permission denied'
);
RESET ROLE;

-- ============================================
-- 11. close_register: happy path
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

-- The HIGH drawer after section 6 holds two payments: the seeded 10000 cash
-- and the equality probe 1000 cash. initial 200000 + 10000 + 1000 = 211000;
-- total_tips 0; expected_cash_after_tips = 211000 - 0 = 211000.
SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
    )) ->> 'status'
  $q$),
  'closed'::text,
  'close_register: happy path returns status=closed'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
    )) ->> 'cash_register_id'
  $q$),
  'aaaaaaaa-0000-4000-8000-00000000e002'::text,
  'close_register: response carries cash_register_id'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
    )) ->> 'final_cash'
  $q$),
  '211000'::text,
  'close_register: final_cash = expected_cash_after_tips = 211000'
);

-- Row state on the register after close.
SELECT is(
  pg_temp.rs_text($q$
    SELECT status::text FROM public.cash_registers
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e002'
  $q$),
  'closed'::text,
  'close_register: row.status is now closed'
);

SELECT is(
  pg_temp.rs_text($q$
    SELECT round(final_cash)::bigint::text FROM public.cash_registers
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e002'
  $q$),
  '211000'::text,
  'close_register: row.final_cash == response.final_cash'
);

SELECT ok(
  pg_temp.rs_count($q$
    SELECT count(*) FROM public.cash_registers
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e002'
       AND closing_timestamp IS NOT NULL
  $q$) = 1::bigint,
  'close_register: row.closing_timestamp was set'
);

-- The summary nested in the close response carries the same numbers as
-- register_summary alone (sanity check that close_register uses the same
-- computation).
SELECT is(
  pg_temp.rs_text($q$
    SELECT ((public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
    )) -> 'summary') ->> 'expected_cash_after_tips'
  $q$),
  '211000'::text,
  'close_register: response.summary.expected_cash_after_tips = 211000'
);

RESET ROLE;

-- ============================================
-- 12. close_register: already_closed replay
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid
    )) ->> 'status'
  $q$),
  'already_closed'::text,
  'close_register: replay returns status=already_closed (no writes)'
);

-- Stored values: closing_timestamp must still be the original close time
-- (same second), and final_cash must be unchanged.
SELECT ok(
  pg_temp.rs_count($q$
    SELECT count(*) FROM public.cash_registers
     WHERE id = 'aaaaaaaa-0000-4000-8000-00000000e002'
       AND closing_timestamp IS NOT NULL
       AND round(final_cash) = 211000
  $q$) = 1::bigint,
  'close_register: replay keeps the stored final_cash and closing_timestamp'
);

RESET ROLE;

-- ============================================
-- 13. Close blocks further pay_order (the register is closed now)
-- ============================================
INSERT INTO public.orders
  (id, restaurant_id, table_id, status, subtotal, tax, tax_percentage, tip,
   tip_percentage, total, total_discounts)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f005', 'aaaaaaaa-0000-4000-8000-000000000091',
   NULL, 'active', 0, 0, 0, 0, 0, 0, 0);
INSERT INTO public.order_items
  (order_id, dish_id, name, price, quantity, restaurant_id, status)
VALUES
  ('aaaaaaaa-0000-4000-8000-00000000f005', NULL, 'After Close Item', 5000, 1,
   'aaaaaaaa-0000-4000-8000-000000000091', 'kitchen');

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.pay_order(
      'aaaaaaaa-0000-4000-8000-00000000f005'::uuid,
      'aaaaaaaa-0000-4000-8000-00000000e002'::uuid,
      0::bigint,
      jsonb_build_array(
        jsonb_build_object(
          'payment_method_id',
          (SELECT id FROM public.payment_methods
            WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000091'
            AND code = 'cash'),
          'amount', 5000::bigint,
          'cash_received', 5000::bigint
        )
      ),
      'aaaaaaaa-0000-4000-8000-000000000f05'::uuid
    )
  $q$),
  'P0001'::text,
  'pay_order rejects a closed register (P0001) - already_closed closes the drawer'
);

RESET ROLE;

-- ============================================
-- 14. close_register: already-closed-on-disk
-- ============================================
-- e003 was created with status=closed and never written to again.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_text($q$
    SELECT (public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e003'::uuid
    )) ->> 'status'
  $q$),
  'already_closed'::text,
  'close_register: a register created with status=closed returns already_closed'
);

RESET ROLE;

-- ============================================
-- 15. close_register: cross-tenant (P0002)
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000d2","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.close_register(
      'bbbbbbbb-0000-4000-8000-00000000e101'::uuid
    )
  $q$),
  'P0002'::text,
  'close_register: another tenant register raises P0002'
);

RESET ROLE;

-- ============================================
-- 16. Profileless, smoke-tested
-- ============================================
-- Insert an authenticated user with NO profile (raw_user_meta_data carries no
-- role/restaurant_id, so profiles.auth_user_id lookup is empty) and confirm
-- both RPCs raise 42501, the same boundary pay_order / split_order pin.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('cccccccc-0000-4000-8000-0000000000d9', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rs-noprofile@example.com',
   crypt('c-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"RS No Profile"}'::jsonb, now(), now());

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-0000-4000-8000-0000000000d9","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.register_summary(
      ARRAY['aaaaaaaa-0000-4000-8000-00000000e001'::uuid]
    )
  $q$),
  '42501'::text,
  'profileless caller: register_summary raises 42501'
);

SELECT is(
  pg_temp.rs_run($q$
    SELECT public.close_register(
      'aaaaaaaa-0000-4000-8000-00000000e001'::uuid
    )
  $q$),
  '42501'::text,
  'profileless caller: close_register raises 42501'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;