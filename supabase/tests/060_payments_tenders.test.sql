-- Payments / payment-tenders contract test.
--
-- The checkout flow recorded money in public.payment_transactions through the
-- broken public.complete_payment() RPC: one row per method, numeric(10,2)
-- money, no tenant-scoped tender lines, no tip or change rule, and no way to
-- express a bill paid with two methods at once. This file pins the replacement
-- ledger on public.payments + public.payment_tenders:
--
--   - one payment per order (UNIQUE (order_id)), whole COP pesos (bigint),
--     amount_due/total_charged = the bill and total_charged = amount_due +
--     tip_amount as a CHECK, change_given as a stored value;
--   - public.payment_tenders carries the lines of one payment: line_no unique
--     per payment, an amount > 0, and cash_received present for a cash method
--     (>= amount) and NULL for an electronic one - the CHECK is what makes
--     "only cash gives change" a database rule;
--   - method_code / method_kind are snapshots of the catalog row, so history
--     survives a later rename, and a DEFERRABLE INITIALLY DEFERRED constraint
--     trigger re-computes the cross-row invariants at commit: tender sum =
--     total_charged, change_given = sum(cash_received - amount) over cash
--     tenders, at least one tender, and payment/order/register/tender/catalog
--     all inside one restaurant;
--   - idempotency is per tenant: UNIQUE (restaurant_id, idempotency_key);
--   - authenticated can read its own tenant and can write nothing: INSERT has no
--     policy (42501) and every UPDATE/DELETE hits the immutability guard
--     (42501). The rows are written only by the SECURITY DEFINER pay_order RPC
--     (migration 20261006110000 series / task 4), never by a user JWT;
--   - public.payment_transactions becomes legacy read-only history;
--   - anon holds nothing on any of the three tables.
--
-- Deferred-evaluation note: the constraint trigger is deferred, so a bad
-- payment is accepted by the INSERT and rejected at COMMIT. The cases below run
-- their setup inside a subtransaction (pg_temp.pt_run / pt_run_deferred) and
-- force the evaluation with SET CONSTRAINTS ALL IMMEDIATE inside that same
-- subtransaction, which is what makes an aborted subtransaction discard both the
-- bad rows and the queued trigger events. pg_temp.pt_run_deferred restores
-- DEFERRED mode afterwards, because SET CONSTRAINTS is transaction-scoped: an
-- aborted subtransaction does NOT roll the mode back.
--
-- Self-contained on purpose: `supabase test db` runs this file through pg_prove,
-- which does not wrap anything for us, so the file opens its own transaction
-- and always rolls back.
--
-- Impersonation follows 010/030/040/050: SET LOCAL ROLE authenticated plus
-- request.jwt.claims.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;

SELECT plan(106);

-- Explicit, because every INSERT below queues deferred events and a leftover
-- IMMEDIATE mode would fire them at the end of the next statement, before the
-- tenders exist.
SET CONSTRAINTS ALL DEFERRED;

-- ============================================
-- Helpers
-- ============================================
-- Every probe below is SECURITY INVOKER, so RLS applies exactly as it does for
-- the API, and every one turns an error into a sentinel: against the
-- pre-migration schema the relations do not exist, and a sentinel is what keeps
-- this file runnable (and RED) there instead of aborting the transaction.
CREATE FUNCTION pg_temp.pt_count(p_sql text)
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

CREATE FUNCTION pg_temp.pt_text(p_sql text)
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
    RETURN '<pt-error>';
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

CREATE FUNCTION pg_temp.pt_has_privilege(p_role text, p_table text, p_priv text)
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
-- SQLSTATE ('ok' when it survived). This is what keeps a case that fails on its
-- second statement - a payment row written and then a rejected tender - from
-- leaving an orphan row queued for the deferred trigger to reject later.
CREATE FUNCTION pg_temp.pt_run(p_sql text)
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
CREATE FUNCTION pg_temp.pt_run_deferred(p_sql text)
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

-- Flushes the trigger queue of an already-inserted, expected-good payment.
CREATE FUNCTION pg_temp.pt_flush()
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
SELECT has_table('public', 'payments', 'table public.payments exists');
SELECT has_table('public', 'payment_tenders', 'table public.payment_tenders exists');

SELECT has_column('public', 'payments', 'restaurant_id',
  'payments is tenant-scoped');
SELECT has_column('public', 'payments', 'order_id',
  'payments points at the order it settles');
SELECT has_column('public', 'payments', 'cash_register_id',
  'payments points at the cash register it was taken on');
SELECT has_column('public', 'payments', 'cashier_profile_id',
  'payments names the cashier who took it');
SELECT has_column('public', 'payments', 'amount_due',
  'payments carries the bill without tip');
SELECT has_column('public', 'payments', 'tip_amount',
  'payments carries an explicit tip');
SELECT has_column('public', 'payments', 'total_charged',
  'payments carries the charged total');
SELECT has_column('public', 'payments', 'change_given',
  'payments carries the change handed back');
SELECT has_column('public', 'payments', 'idempotency_key',
  'payments carries a per-tenant idempotency key');

SELECT has_column('public', 'payment_tenders', 'restaurant_id',
  'payment_tenders is tenant-scoped');
SELECT has_column('public', 'payment_tenders', 'payment_id',
  'payment_tenders points at its payment');
SELECT has_column('public', 'payment_tenders', 'line_no',
  'payment_tenders numbers its lines');
SELECT has_column('public', 'payment_tenders', 'payment_method_id',
  'payment_tenders points at the catalog method');
SELECT has_column('public', 'payment_tenders', 'method_code',
  'payment_tenders snapshots the method code');
SELECT has_column('public', 'payment_tenders', 'method_kind',
  'payment_tenders snapshots the method kind');
SELECT has_column('public', 'payment_tenders', 'amount',
  'payment_tenders carries the amount applied to the bill');
SELECT has_column('public', 'payment_tenders', 'cash_received',
  'payment_tenders carries what the customer handed over for cash');

-- Money is whole COP pesos, so the money columns are bigint and not the
-- numeric(10,2) the legacy table used.
SELECT is(
  (SELECT count(*)::bigint FROM pg_attribute
    WHERE attrelid = to_regclass('public.payments')
      AND attnum > 0 AND NOT attisdropped
      AND attname IN ('amount_due', 'tip_amount', 'total_charged', 'change_given')
      AND format_type(atttypid, atttypmod) = 'bigint'), 4::bigint,
  'the four payments money columns are bigint (whole COP pesos)');

SELECT is(
  (SELECT count(*)::bigint FROM pg_attribute
    WHERE attrelid = to_regclass('public.payment_tenders')
      AND attnum > 0 AND NOT attisdropped
      AND attname IN ('amount', 'cash_received')
      AND format_type(atttypid, atttypmod) = 'bigint'), 2::bigint,
  'the two payment_tenders money columns are bigint (whole COP pesos)');

SELECT is(
  pg_temp.pt_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.payments') $$),
  'true'::text,
  'RLS is enabled on payments');

SELECT is(
  pg_temp.pt_text($$ SELECT relrowsecurity::text FROM pg_class
                     WHERE oid = to_regclass('public.payment_tenders') $$),
  'true'::text,
  'RLS is enabled on payment_tenders');

-- One payment settles one order: the unique index is the idempotency the app
-- needs (a retry of the same checkout cannot double-pay an order).
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments')
      AND contype = 'u' AND pg_get_constraintdef(oid) LIKE '%(order_id)%'), 1::bigint,
  'payments is unique per order');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments')
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(restaurant_id, idempotency_key)%'), 1::bigint,
  'payments uniqueness spans (restaurant_id, idempotency_key)');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payment_tenders')
      AND contype = 'u' AND pg_get_constraintdef(oid) LIKE '%(payment_id, line_no)%'), 1::bigint,
  'payment_tenders uniqueness spans (payment_id, line_no)');

-- The column CHECKs. Named, so a later migration that drops one is visible.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments') AND contype = 'c'
      AND conname IN ('payments_amount_due_check', 'payments_tip_amount_check',
                      'payments_total_charged_check', 'payments_change_given_check')), 4::bigint,
  'payments carries the four money CHECK constraints');

SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payment_tenders') AND contype = 'c'
      AND conname IN ('payment_tenders_line_no_check', 'payment_tenders_amount_check',
                      'payment_tenders_cash_received_check')), 3::bigint,
  'payment_tenders carries the line_no, amount and cash_received CHECK constraints');

-- The cash_received CHECK is what encodes "only cash gives change", so pin its
-- five clauses rather than just its existence: a later edit that keeps the
-- constraint but drops the cash_received >= amount half (the half that lets a
-- tender over-apply itself) has to fail here. Matched as fragments, because the
-- parenthesisation of pg_get_constraintdef output is a deparse artefact.
SELECT ok(
  pg_temp.pt_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                     WHERE conrelid = to_regclass('public.payment_tenders')
                       AND conname = 'payment_tenders_cash_received_check' $$)
    LIKE '%(method_kind = ''cash''::text)%'
  AND pg_temp.pt_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.payment_tenders')
                          AND conname = 'payment_tenders_cash_received_check' $$)
    LIKE '%(cash_received IS NOT NULL)%'
  AND pg_temp.pt_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.payment_tenders')
                          AND conname = 'payment_tenders_cash_received_check' $$)
    LIKE '%(cash_received >= amount)%'
  AND pg_temp.pt_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.payment_tenders')
                          AND conname = 'payment_tenders_cash_received_check' $$)
    LIKE '%(method_kind = ''electronic''::text)%'
  AND pg_temp.pt_text($$ SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid = to_regclass('public.payment_tenders')
                          AND conname = 'payment_tenders_cash_received_check' $$)
    LIKE '%(cash_received IS NULL)%',
  'cash_received is required for cash (and >= the applied amount) and forbidden for electronic tenders');

-- Foreign keys: a payment history may not lose its order or its register, and a
-- tender dies with its payment.
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments') AND contype = 'f'
      AND confrelid = to_regclass('public.orders')
      AND confdeltype = 'r'), 1::bigint,
  'payments order_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments') AND contype = 'f'
      AND confrelid = to_regclass('public.cash_registers')
      AND confdeltype = 'r'), 1::bigint,
  'payments cash_register_id is ON DELETE RESTRICT');
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payments') AND contype = 'f'
      AND confrelid = to_regclass('public.profiles')
      AND confdeltype = 'n'), 1::bigint,
  'payments cashier_profile_id is ON DELETE SET NULL');
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payment_tenders') AND contype = 'f'
      AND confrelid = to_regclass('public.payments')
      AND confdeltype = 'c'), 1::bigint,
  'payment_tenders payment_id is ON DELETE CASCADE');
SELECT is(
  (SELECT count(*)::bigint FROM pg_constraint
    WHERE conrelid = to_regclass('public.payment_tenders') AND contype = 'f'
      AND confrelid = to_regclass('public.payment_methods')
      AND confdeltype = 'r'), 1::bigint,
  'payment_tenders payment_method_id is ON DELETE RESTRICT');

-- The register summary of task 8 reads one register of one tenant in date
-- order, and the reports read one tenant's tenders per method.
SELECT is(
  (SELECT count(*)::bigint FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'payments'
      AND indexdef LIKE '%(restaurant_id, cash_register_id, created_at)%'), 1::bigint,
  'payments is indexed on (restaurant_id, cash_register_id, created_at)');

SELECT is(
  (SELECT count(*)::bigint FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'payment_tenders'
      AND indexdef LIKE '%(restaurant_id, payment_method_id)%'), 1::bigint,
  'payment_tenders is indexed on (restaurant_id, payment_method_id)');

-- The cross-row invariants cannot be CHECKs (they read other rows), so they are
-- deferred CONSTRAINT triggers on both tables.
SELECT is(
  (SELECT count(*)::bigint FROM pg_trigger
    WHERE tgrelid = to_regclass('public.payments')
      AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred), 1::bigint,
  'payments carries a DEFERRABLE INITIALLY DEFERRED constraint trigger');

SELECT is(
  (SELECT count(*)::bigint FROM pg_trigger
    WHERE tgrelid = to_regclass('public.payment_tenders')
      AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred), 1::bigint,
  'payment_tenders carries a DEFERRABLE INITIALLY DEFERRED constraint trigger');

-- authenticated writes nothing: there is no INSERT policy on either table, so
-- an INSERT raises 42501 (new row violates row-level security policy).
SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments' AND cmd = 'INSERT'), 0::bigint,
  'payments carries no INSERT policy');

SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_tenders' AND cmd = 'INSERT'), 0::bigint,
  'payment_tenders carries no INSERT policy');

SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments' AND cmd = 'SELECT'), 1::bigint,
  'payments carries one same-tenant SELECT policy');

SELECT is(
  (SELECT count(*)::bigint FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_tenders' AND cmd = 'SELECT'), 1::bigint,
  'payment_tenders carries one same-tenant SELECT policy');

-- ============================================
-- 2. Fixtures: two tenants, two registers, three orders
-- ============================================
-- The catalog defaults arrive through the AFTER INSERT trigger on
-- public.restaurants (20261006100000), so the methods used below exist because
-- that trigger fired, not because this file inserted them.
INSERT INTO public.restaurants (id, slug, name)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000061', 'pay-ledger-a', 'Pay Ledger A'),
  ('bbbbbbbb-0000-4000-8000-000000000062', 'pay-ledger-b', 'Pay Ledger B');

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token,
  reauthentication_token, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ledger-cashier-a@example.com',
   crypt('a-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"cashier",'
   '"restaurant_id":"aaaaaaaa-0000-4000-8000-000000000061"}'::jsonb,
   '{"full_name":"Ledger Cashier A"}'::jsonb, now(), now()),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ledger-admin-b@example.com',
   crypt('b-password', gen_salt('bf')), now(), '', '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"],"role":"admin",'
   '"restaurant_id":"bbbbbbbb-0000-4000-8000-000000000062"}'::jsonb,
   '{"full_name":"Ledger Admin B"}'::jsonb, now(), now());

SELECT is(
  (SELECT restaurant_id FROM public.profiles
    WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000c1')::text,
  'aaaaaaaa-0000-4000-8000-000000000061'::text,
  'fixture: the tenant A cashier profile is placed in tenant A');

SELECT is(
  (SELECT count(*) FROM public.payment_methods
    WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061')::bigint,
  4::bigint,
  'fixture: tenant A got the four default methods from the seed trigger');

-- restaurant_id is passed everywhere: outside an authenticated session
-- private.default_restaurant_id() falls back to the oldest restaurant, so a
-- fixture that trusted the DEFAULT would silently land in another tenant.
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status)
VALUES
  ('cccccccc-0000-4000-8000-000000000071', 'aaaaaaaa-0000-4000-8000-000000000061',
   now(), 0, 'open'),
  ('cccccccc-0000-4000-8000-000000000072', 'bbbbbbbb-0000-4000-8000-000000000062',
   now(), 0, 'open');

INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total)
VALUES
  ('e4000000-0000-4000-8000-000000000081', 'aaaaaaaa-0000-4000-8000-000000000061',
   'active', 30000, 0, 0, 30000),
  ('e4000000-0000-4000-8000-000000000082', 'aaaaaaaa-0000-4000-8000-000000000061',
   'active', 30000, 0, 0, 30000),
  ('e4000000-0000-4000-8000-000000000083', 'bbbbbbbb-0000-4000-8000-000000000062',
   'active', 30000, 0, 0, 30000);

-- One legacy history row, so the read-only assertions below have something to
-- read.
INSERT INTO public.payment_transactions (id, restaurant_id, order_id, amount, method,
                                         cash_received, cash_change, timestamp, cash_register_id)
VALUES ('ab000000-0000-4000-8000-000000000091', 'aaaaaaaa-0000-4000-8000-000000000061',
        'e4000000-0000-4000-8000-000000000081', 30000, 'Efectivo', 30000, 0, now(),
        'cccccccc-0000-4000-8000-000000000071');

-- ============================================
-- 3. Column CHECKs: immediate rejections
-- ============================================
-- These are evaluated by the INSERT itself, so pg_temp.pt_run (which runs the
-- whole setup in a subtransaction) is the right shape: a case that rejects its
-- second statement leaves no orphan payment behind.
SELECT is(
  pg_temp.pt_run($$ INSERT INTO public.payments (restaurant_id, order_id, cash_register_id,
             amount_due, tip_amount, total_charged, change_given, idempotency_key)
       VALUES ('aaaaaaaa-0000-4000-8000-000000000061',
               'e4000000-0000-4000-8000-000000000081',
               'cccccccc-0000-4000-8000-000000000071',
               -100, 0, -100, 0, 'aaaaaaaa-0000-4000-8000-0000000000f1') $$),
  '23514'::text,
  'a negative amount_due is rejected');

SELECT is(
  pg_temp.pt_run($$ INSERT INTO public.payments (restaurant_id, order_id, cash_register_id,
             amount_due, tip_amount, total_charged, change_given, idempotency_key)
       VALUES ('aaaaaaaa-0000-4000-8000-000000000061',
               'e4000000-0000-4000-8000-000000000081',
               'cccccccc-0000-4000-8000-000000000071',
               30000, -500, 29500, 0, 'aaaaaaaa-0000-4000-8000-0000000000f2') $$),
  '23514'::text,
  'a negative tip_amount is rejected');

-- total_charged must be the bill plus the tip: the UI computes it from the
-- tenders, and a mismatch would make the tender sum check meaningless. (That a
-- non-zero tip is accepted at all is asserted by the two payments of section 5,
-- which carry 3.000 of tip.)
SELECT is(
  pg_temp.pt_run($$ INSERT INTO public.payments (restaurant_id, order_id, cash_register_id,
             amount_due, tip_amount, total_charged, change_given, idempotency_key)
       VALUES ('aaaaaaaa-0000-4000-8000-000000000061',
               'e4000000-0000-4000-8000-000000000081',
               'cccccccc-0000-4000-8000-000000000071',
               30000, 3000, 32000, 0, 'aaaaaaaa-0000-4000-8000-0000000000f4') $$),
  '23514'::text,
  'total_charged that is not amount_due + tip_amount is rejected');

SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-0000000000f5');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000a1', 1,
           m.id, 'nequi', 'electronic', 30000, 30000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'an electronic tender carrying cash_received is rejected');

SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-0000000000f6');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000a2', 1,
           m.id, 'cash', 'cash', 30000, 29999
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a cash tender whose cash_received is below the applied amount is rejected');

SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000a3', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-0000000000f7');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000a3', 0,
           m.id, 'cash', 'cash', 30000, 30000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a tender line numbered 0 is rejected');

SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000a4', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-0000000000f8');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000a4', 1,
           m.id, 'cash', 'cash', -30000, 30000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a tender with a non-positive amount is rejected');

-- ============================================
-- 4. The deferred cross-row invariants
-- ============================================
-- Everything here is accepted by the INSERTs and rejected when the deferred
-- constraint trigger fires, which is what makes the payment/tender pair safe to
-- build up over several statements.
SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000101');
  $$),
  '23514'::text,
  'a payment with no tender line is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b2', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000102');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b2', 1,
           m.id, 'nequi', 'electronic', 10000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'tender lines that do not add up to total_charged are rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b3', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000103');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b3', 1,
           m.id, 'cash', 'cash', 30000, 40000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a change_given that does not match the cash tenders is rejected at commit time');

-- The same rule seen from the other end: change can only come out of a cash
-- tender, so an electronic-only payment that claims change is rejected.
SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000ba', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 5000, 'aaaaaaaa-0000-4000-8000-00000000010a');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000ba', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'change claimed by an electronic-only payment is rejected at commit time');

-- The trigger is on the tender table too: appending a line to an already
-- balanced payment is caught, not only writing the payment from scratch.
SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000bb', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-00000000010b');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000bb', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000bb', 2,
           m.id, 'cash', 'cash', 5000, 5000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a line appended to a balanced payment is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b4', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000104');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b4', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000062' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'a tender paid with another tenant catalog method is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b5', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000105');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'bbbbbbbb-0000-4000-8000-000000000062', 'ab000000-0000-4000-8000-0000000000b5', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'a tender whose own restaurant differs from the payment is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b6', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000072',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000106');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b6', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'a payment taken on another tenant cash register is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b7', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000083',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000107');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b7', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  '23514'::text,
  'a payment against another tenant order is rejected at commit time');

-- The snapshots exist so a later rename or retype of the catalog row does not
-- rewrite history; they are checked against the catalog row on every commit.
SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b8', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000108');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b8', 1,
           m.id, 'nequi', 'electronic', 30000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a tender whose method_kind contradicts the catalog row is rejected at commit time');

SELECT is(
  pg_temp.pt_run_deferred($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000b9', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000109');
    INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'aaaaaaaa-0000-4000-8000-000000000061', 'ab000000-0000-4000-8000-0000000000b9', 1,
           m.id, 'transfer', 'cash', 30000, 30000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  '23514'::text,
  'a tender whose method_code contradicts the catalog row is rejected at commit time');

-- ============================================
-- 5. A valid two-tender payment
-- ============================================
-- 30.000 bill + 3.000 tip, paid 20.000 in cash (25.000 handed over) and 13.000
-- on Nequi: the cash line is what produces the 5.000 of change.
SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               cashier_profile_id, amount_due, tip_amount, total_charged,
               change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071',
            (SELECT id FROM public.profiles WHERE auth_user_id = 'aaaaaaaa-0000-4000-8000-0000000000c1'),
            30000, 3000, 33000, 5000, 'aaaaaaaa-0000-4000-8000-000000000201');
    INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'ab000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-000000000061',
           'ab000000-0000-4000-8000-0000000000c1', 1, m.id, 'cash', 'cash', 20000, 25000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
    INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'ab000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-000000000061',
           'ab000000-0000-4000-8000-0000000000c1', 2, m.id, 'nequi', 'electronic', 13000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'nequi';
  $$),
  'ok'::text,
  'the payment row and its two tender lines are accepted by the INSERTs themselves');

SELECT is(pg_temp.pt_flush(), 'ok'::text,
  'a cash + Nequi payment with change survives the deferred check');

-- Triangulation of the cash rule: cash_received exactly equal to the applied
-- amount is the "no change" case and must be accepted too.
SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id,
               amount_due, tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000061',
            'e4000000-0000-4000-8000-000000000082',
            'cccccccc-0000-4000-8000-000000000071',
            30000, 0, 30000, 0, 'aaaaaaaa-0000-4000-8000-000000000202');
    INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'ab000000-0000-4000-8000-0000000000d3', 'aaaaaaaa-0000-4000-8000-000000000061',
           'ab000000-0000-4000-8000-0000000000c2', 1, m.id, 'cash', 'cash', 30000, 30000
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' AND m.code = 'cash';
  $$),
  'ok'::text,
  'the cash payment with cash_received equal to the amount is accepted by the INSERTs themselves');

SELECT is(pg_temp.pt_flush(), 'ok'::text,
  'a cash payment with cash_received equal to the amount (no change) is accepted');

SELECT is(
  pg_temp.pt_count($$ SELECT count(*) FROM public.payments
                      WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' $$),
  2::bigint,
  'tenant A holds the two payments written above');

SELECT is(
  pg_temp.pt_count($$ SELECT count(*) FROM public.payment_tenders t
                      JOIN public.payments p ON p.id = t.payment_id
                     WHERE p.restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061' $$),
  3::bigint,
  'the accepted payments hold three tender lines in total');

SELECT is(
  pg_temp.pt_text($$ SELECT string_agg(t.method_code || ':' || t.method_kind || ':'
                       || t.amount::text || ':' || coalesce(t.cash_received::text, '-'),
                       ' ' ORDER BY t.line_no)
                     FROM public.payment_tenders t
                    WHERE t.payment_id = 'ab000000-0000-4000-8000-0000000000c1' $$),
  'cash:cash:20000:25000 nequi:electronic:13000:-'::text,
  'the two tender lines kept their order, snapshots, amounts and cash received');

SELECT is(
  pg_temp.pt_text($$ SELECT change_given::text FROM public.payments
                     WHERE id = 'ab000000-0000-4000-8000-0000000000c1' $$),
  '5000'::text,
  'the change handed back is the cash overshoot of the cash line only');

-- ============================================
-- 6. Idempotency
-- ============================================
-- The checkout can be retried (double tap, network retry), so the key is the
-- second line of defence behind UNIQUE (order_id).
SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (restaurant_id, order_id, cash_register_id, amount_due,
               tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000061', 'e4000000-0000-4000-8000-000000000082',
            'cccccccc-0000-4000-8000-000000000071', 30000, 0, 30000, 0,
            'aaaaaaaa-0000-4000-8000-000000000201');
  $$),
  '23505'::text,
  'a second payment with the same idempotency key in the same tenant is rejected');

SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (restaurant_id, order_id, cash_register_id, amount_due,
               tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000061', 'e4000000-0000-4000-8000-000000000081',
            'cccccccc-0000-4000-8000-000000000071', 30000, 0, 30000, 0,
            'aaaaaaaa-0000-4000-8000-000000000203');
  $$),
  '23505'::text,
  'a second payment for the same order is rejected');

-- The key is per tenant: tenant B may use the very same uuid, because a client
-- that generates it cannot be assumed to coordinate across tenants.
SELECT is(
  pg_temp.pt_run($$
    INSERT INTO public.payments (id, restaurant_id, order_id, cash_register_id, amount_due,
               tip_amount, total_charged, change_given, idempotency_key)
    VALUES ('ab000000-0000-4000-8000-0000000000c3', 'bbbbbbbb-0000-4000-8000-000000000062',
            'e4000000-0000-4000-8000-000000000083',
            'cccccccc-0000-4000-8000-000000000072',
            30000, 3000, 33000, 0, 'aaaaaaaa-0000-4000-8000-000000000201');
    INSERT INTO public.payment_tenders (id, restaurant_id, payment_id, line_no,
               payment_method_id, method_code, method_kind, amount, cash_received)
    SELECT 'ab000000-0000-4000-8000-0000000000d4', 'bbbbbbbb-0000-4000-8000-000000000062',
           'ab000000-0000-4000-8000-0000000000c3', 1, m.id, 'nequi', 'electronic', 33000, NULL
      FROM public.payment_methods m
     WHERE m.restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000062' AND m.code = 'nequi';
  $$),
  'ok'::text,
  'the same idempotency key is accepted in another tenant');

SELECT is(pg_temp.pt_flush(), 'ok'::text,
  'the cross-tenant payment passes the deferred check with its own order, register and method');

SELECT is(
  pg_temp.pt_count($$ SELECT count(*) FROM public.payments
                      WHERE idempotency_key = 'aaaaaaaa-0000-4000-8000-000000000201' $$),
  2::bigint,
  'the shared idempotency key exists once per tenant');

-- ============================================
-- 7. A cashier of tenant A: reads its own ledger, writes nothing
-- ============================================
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.pt_count('SELECT count(*) FROM public.payments'), 2::bigint,
  'a cashier of tenant A sees the two tenant A payments');

SELECT is(pg_temp.pt_count('SELECT count(*) FROM public.payment_tenders'), 3::bigint,
  'a cashier of tenant A sees the three tenant A tender lines');

SELECT is(
  pg_temp.pt_count($$ SELECT count(*) FROM public.payments
                      WHERE restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000062' $$),
  0::bigint,
  'a cashier of tenant A sees none of tenant B payments');

-- The rows are the money history: they are written by pay_order (a SECURITY
-- DEFINER function) and never by a session that carries a user JWT.
SELECT throws_ok(
  $$ INSERT INTO public.payments (restaurant_id, order_id, cash_register_id, amount_due,
           tip_amount, total_charged, change_given, idempotency_key)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000061', 'e4000000-0000-4000-8000-000000000082',
             'cccccccc-0000-4000-8000-000000000071', 1, 0, 1, 0,
             gen_random_uuid()) $$,
  '42501', NULL,
  'a cashier cannot insert a payment');
SELECT throws_ok(
  $$ INSERT INTO public.payment_tenders (restaurant_id, payment_id, line_no,
           payment_method_id, method_code, method_kind, amount, cash_received)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000061',
             'ab000000-0000-4000-8000-0000000000c1', 9,
             (SELECT id FROM public.payment_methods WHERE code = 'cash'
               AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000061'),
             'cash', 'cash', 1, 1) $$,
  '42501', NULL,
  'a cashier cannot insert a tender');
SELECT throws_ok(
  $$ UPDATE public.payments SET change_given = 0 $$,
  '42501', NULL,
  'a cashier cannot update a payment');
SELECT throws_ok(
  $$ UPDATE public.payment_tenders SET amount = amount + 1 $$,
  '42501', NULL,
  'a cashier cannot update a tender');
SELECT throws_ok(
  $$ DELETE FROM public.payments $$,
  '42501', NULL,
  'a cashier cannot delete a payment');
SELECT throws_ok(
  $$ DELETE FROM public.payment_tenders $$,
  '42501', NULL,
  'a cashier cannot delete a tender');

RESET ROLE;

-- The legacy table is history: readable, never written by a session.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-8000-0000000000c1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.pt_count('SELECT count(*) FROM public.payment_transactions'), 1::bigint,
  'a cashier of tenant A still reads its own legacy payment history');

SELECT throws_ok(
  $$ INSERT INTO public.payment_transactions (restaurant_id, order_id, amount, method,
           cash_received, timestamp, cash_register_id)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000061', 'e4000000-0000-4000-8000-000000000082',
             1, 'Efectivo', 1, now(), 'cccccccc-0000-4000-8000-000000000071') $$,
  '42501', NULL,
  'a cashier cannot append to the legacy payment history');

SELECT throws_ok(
  $$ UPDATE public.payment_transactions SET amount = 1 $$,
  '42501', NULL,
  'a cashier cannot rewrite the legacy payment history');

SELECT throws_ok(
  $$ DELETE FROM public.payment_transactions $$,
  '42501', NULL,
  'a cashier cannot delete the legacy payment history');

RESET ROLE;

-- The other direction: tenant B sees only its own payment.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-8000-0000000000d1","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(pg_temp.pt_count('SELECT count(*) FROM public.payments'), 1::bigint,
  'an admin of tenant B sees only its own payment');
SELECT is(pg_temp.pt_count('SELECT count(*) FROM public.payment_tenders'), 1::bigint,
  'an admin of tenant B sees only its own tender line');

RESET ROLE;

-- ============================================
-- 8. Privileges
-- ============================================
-- The anon key ships in the browser bundle, so every privilege here is a
-- privilege every visitor of the login screen holds (see 020_anon_lockdown).
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payments', 'SELECT'), false,
  'anon cannot SELECT payments');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payments', 'INSERT'), false,
  'anon cannot INSERT payments');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payments', 'UPDATE'), false,
  'anon cannot UPDATE payments');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payments', 'DELETE'), false,
  'anon cannot DELETE payments');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payment_tenders', 'SELECT'), false,
  'anon cannot SELECT payment_tenders');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payment_tenders', 'INSERT'), false,
  'anon cannot INSERT payment_tenders');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payment_tenders', 'UPDATE'), false,
  'anon cannot UPDATE payment_tenders');
SELECT is(pg_temp.pt_has_privilege('anon', 'public.payment_tenders', 'DELETE'), false,
  'anon cannot DELETE payment_tenders');

-- Guard against over-revoking: every role reads the ledger it is paid to show.
SELECT is(pg_temp.pt_has_privilege('authenticated', 'public.payments', 'SELECT'), true,
  'authenticated keeps SELECT on payments');
SELECT is(pg_temp.pt_has_privilege('authenticated', 'public.payment_tenders', 'SELECT'), true,
  'authenticated keeps SELECT on payment_tenders');
SELECT is(
  pg_temp.pt_has_privilege('service_role', 'public.payments',
                           'SELECT,INSERT,UPDATE,DELETE'), true,
  'service_role keeps the full set on payments');
SELECT is(
  pg_temp.pt_has_privilege('service_role', 'public.payment_tenders',
                           'SELECT,INSERT,UPDATE,DELETE'), true,
  'service_role keeps the full set on payment_tenders');

-- The write grants are inert, not missing: 020_anon_lockdown pins
-- SELECT/INSERT/UPDATE/DELETE for authenticated on EVERY public table, so the
-- grant has to stay and RLS plus the immutability guard are what refuse the
-- write (42501, asserted in section 7). Pinned here so a future migration that
-- "fixes" the grant without also fixing 020 shows up as a failing assertion.
SELECT is(
  pg_temp.pt_has_privilege('authenticated', 'public.payments', 'INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on payments (020 pins them)');
SELECT is(
  pg_temp.pt_has_privilege('authenticated', 'public.payment_tenders', 'INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on payment_tenders (020 pins them)');
SELECT is(
  pg_temp.pt_has_privilege('authenticated', 'public.payment_transactions', 'INSERT,UPDATE,DELETE'), true,
  'authenticated keeps the inert write grants on the legacy table (020 pins them)');
SELECT is(pg_temp.pt_has_privilege('authenticated', 'public.payment_transactions', 'SELECT'), true,
  'authenticated keeps SELECT on the legacy payment history');

SELECT * FROM finish();
ROLLBACK;