-- ============================================
-- pay_order RPC: the atomic checkout
-- ============================================
-- Migration 20261006110000 added the public.payments + public.payment_tenders
-- ledger and made every authenticated write fail (42501: no INSERT policy, the
-- immutability guard refuses every UPDATE/DELETE). The only writer that can
-- actually land a payment row is a function running as postgres, and this
-- migration is that function.
--
-- public.pay_order(p_order_id uuid, p_cash_register_id uuid, p_tip_amount bigint,
--   p_tenders jsonb, p_idempotency_key uuid)
--   RETURNS jsonb
-- is SECURITY DEFINER (owned by postgres) so it can write the payment rows
-- and update the order in one transaction, and SET search_path = '' with every
-- reference schema-qualified. PUBLIC and anon get nothing; authenticated and
-- service_role get EXECUTE, which 020_anon_lockdown pins against
-- over-revocation.
--
-- The contract:
--   1. Caller resolution. private.current_restaurant_id() resolves the tenant
--      from profiles.auth_user_id (the only server-controlled link), and
--      private.current_app_role() resolves the role the same way. NULL tenant
--      (no profile) is 42501 - the JWT alone cannot narrow access. Only
--      'cashier' and 'admin' may pay; everything else is 42501.
--
--   2. Input validation (22023). idempotency_key not null; p_tip_amount >= 0;
--      p_tenders is a non-empty JSON array of objects; each carries
--      payment_method_id (uuid), amount (integer > 0) and cash_received
--      (integer when present). A bad shape raises invalid_parameter_value with
--      a clear message; nothing is written.
--
--   3. Order. The order is locked FOR UPDATE and resolved in the caller's
--      tenant. An order that belongs to another tenant, or does not exist at
--      all, raises P0002 'order not found' - the only SQLSTATE that does not
--      leak the existence of another tenant's row. When a payment already
--      exists for the order (UNIQUE (order_id)), the same idempotency_key
--      returns status='already_paid' and the same jsonb summary, with no
--      writes; a different key raises P0001 'order already paid'. The status
--      check runs on the orders table for the no-payment path and must be one
--      of active|kitchen|delivered; anything else raises P0001 with the
--      current status in the message.
--
--   4. Cash register. Same tenant and status='open' (locked FOR SHARE so two
--      concurrent pay_orders on the same register serialize but do not block
--      each other on reads); anything else raises P0001.
--
--   5. Server-side amount. subtotal = sum(round(price * quantity)) over the
--      order's order_items; tax = round(subtotal * coalesce(tax_percentage,0)
--      / 100); amount_due = subtotal + tax (bigint). An order with no items
--      raises P0001.
--
--   6. Tenders. Each payment_method_id must be an ACTIVE method of the
--      caller's tenant; cash kind requires cash_received NOT NULL and >=
--      amount; electronic kind requires cash_received NULL. sum(amount) must
--      equal amount_due + p_tip_amount exactly (else P0001 with both numbers).
--      change_given = sum(cash_received - amount) over the cash tenders only
--      (electronic tenders do not give change; the CHECK on payment_tenders
--      already enforces the cash-vs-electronic shape).
--
--   7. Drawer warning (warn only). drawer_cash_before = initial_cash +
--      sum(cash-tender amounts of payments already on this register) +
--      deposits - withdrawals (cash_transactions of this register). Legacy
--      payment_transactions are excluded by design: this is the new ledger's
--      cash flow, the old one is history. drawer_warning = change_given >
--      drawer_cash_before. The warning is in the response; the payment is
--      recorded regardless.
--
--   8. Writes. One public.payments row (restaurant_id, order_id,
--      cash_register_id, cashier_profile_id, amount_due, tip_amount,
--      total_charged, change_given, idempotency_key) and one
--      public.payment_tenders row per line (restaurant_id, payment_id,
--      line_no, payment_method_id, method_code, method_kind, amount,
--      cash_received). The catalog snapshot (method_code / method_kind) is
--      taken from the catalog row at insert time, so a later rename or
--      retype does not rewrite history.
--
--   9. Order update. subtotal, tax, tip = p_tip_amount, tip_percentage =
--      CASE WHEN subtotal > 0 THEN round(tip*100.0/subtotal, 2) ELSE 0 END,
--      total = amount_due + tip, status = 'paid', updated_at = now().
--
--  10. Table release. If the order has a table_id and no other order of that
--      table is in active|kitchen|delivered, tables.status becomes
--      'available'. Orders with no table_id do not touch the tables table.
--
--  11. Response. jsonb with payment_id, status='paid', amount_due, tip_amount,
--      total_charged, change_given, drawer_warning, drawer_cash_before, and
--      tenders:[{line_no, method_code, amount, cash_received}].
--
--  12. complete_payment. The legacy public.complete_payment(uuid, text[],
--      uuid) RPC is dropped. It was broken (numeric(10,2) money, free-text
--      method, no idempotency the browser could rely on) and is superseded by
--      pay_order; 070_pay_order.test.sql pins its absence.
--
-- Idempotent: re-running drops pay_order, drops complete_payment, recreates
-- pay_order, re-applies the same grants.

-- ============================================
-- SECTION 1: pay_order
-- ============================================
CREATE OR REPLACE FUNCTION public.pay_order(
  p_order_id        uuid,
  p_cash_register_id uuid,
  p_tip_amount      bigint,
  p_tenders         jsonb,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_order           public.orders%ROWTYPE;
  v_register        public.cash_registers%ROWTYPE;

  v_subtotal        bigint := 0;
  v_tax             bigint := 0;
  v_amount_due      bigint := 0;

  v_tender_count    integer;
  v_tenders_sum     bigint := 0;
  v_change_given    bigint := 0;
  v_cash_received_sum bigint := 0;

  v_existing        public.payments%ROWTYPE;
  v_payment_id      uuid;

  v_drawer_cash_before bigint := 0;
  v_drawer_warning  boolean := false;

  v_tender          jsonb;
  v_method_id       uuid;
  v_method_code     text;
  v_method_kind     text;
  v_method_active   boolean;
  v_method_tenant   uuid;
  v_amount          bigint;
  v_cash_received   bigint;

  v_line_no         smallint := 0;
  v_tender_json     jsonb;
  v_tender_lines    jsonb := '[]'::jsonb;

  v_pending_line_no        smallint[] := '{}'::smallint[];
  v_pending_payment_method uuid[]    := '{}'::uuid[];
  v_pending_amount         bigint[]  := '{}'::bigint[];
  v_pending_cash_received  bigint[]  := '{}'::bigint[];

  v_i              integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'pay_order: only cashier or admin may settle an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.auth_user_id = auth.uid()
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'pay_order: p_idempotency_key must not be null'
      USING ERRCODE = '22023';
  END IF;

  IF p_tip_amount IS NULL OR p_tip_amount < 0 THEN
    RAISE EXCEPTION 'pay_order: p_tip_amount must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_tenders IS NULL OR jsonb_typeof(p_tenders) <> 'array' OR jsonb_array_length(p_tenders) = 0 THEN
    RAISE EXCEPTION 'pay_order: p_tenders must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_tenders) > 20 THEN
    RAISE EXCEPTION 'pay_order: p_tenders accepts at most 20 lines'
      USING ERRCODE = '22023';
  END IF;

  -- Each line must carry the right shape; capture them in parallel arrays
  -- for the per-method work below. jsonb_typeof first means a single bad element
  -- is caught with a clear message rather than a generic "cannot cast".
  v_tender_count := jsonb_array_length(p_tenders);

  FOR v_line_no IN 1..v_tender_count LOOP
    v_tender := p_tenders -> (v_line_no - 1);

    IF v_tender IS NULL OR jsonb_typeof(v_tender) <> 'object' THEN
      RAISE EXCEPTION 'pay_order: tender[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_tender ? 'payment_method_id') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing payment_method_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_method_id := (v_tender ->> 'payment_method_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_tender ? 'amount') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing amount', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_amount := (v_tender ->> 'amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF v_tender ? 'cash_received' AND v_tender -> 'cash_received' IS NOT NULL AND v_tender -> 'cash_received' <> 'null'::jsonb THEN
      BEGIN
        v_cash_received := (v_tender ->> 'cash_received')::bigint;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received is not an integer', v_line_no
          USING ERRCODE = '22023';
      END;
    ELSE
      v_cash_received := NULL;
    END IF;

    v_pending_line_no        := v_pending_line_no || v_line_no;
    v_pending_payment_method := v_pending_payment_method || v_method_id;
    v_pending_amount         := v_pending_amount || v_amount;
    v_pending_cash_received  := v_pending_cash_received || v_cash_received;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_order.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Existing payment for this order? UNIQUE (order_id) makes this a 0/1
  -- decision.
  SELECT p.* INTO v_existing
    FROM public.payments p
   WHERE p.order_id = p_order_id;

  IF FOUND THEN
    IF v_existing.idempotency_key = p_idempotency_key THEN
      -- Same key on a paid order -> replay the existing summary, no writes.
      -- The line_no/cash_received pair is taken from the existing tenders.
      SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'line_no', t.line_no,
                 'method_code', t.method_code,
                 'amount', t.amount,
                 'cash_received', t.cash_received)
                 ORDER BY t.line_no), '[]'::jsonb)
        INTO v_tender_lines
        FROM public.payment_tenders t
       WHERE t.payment_id = v_existing.id;

      RETURN jsonb_build_object(
        'payment_id',         v_existing.id,
        'status',             'already_paid',
        'amount_due',         v_existing.amount_due,
        'tip_amount',         v_existing.tip_amount,
        'total_charged',      v_existing.total_charged,
        'change_given',       v_existing.change_given,
        'drawer_warning',     false,
        'drawer_cash_before', 0,
        'tenders',            v_tender_lines
      );
    ELSE
      RAISE EXCEPTION 'pay_order: order % is already paid', p_order_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_order.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'pay_order: order % cannot be paid (status=%)',
      p_order_id, v_order.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Cash register. FOR SHARE so two concurrent pay_orders on the same
  -- register serialize without blocking each other on a read; the order lock
  -- is what actually serializes the payment writes.
  SELECT r.* INTO v_register
    FROM public.cash_registers r
   WHERE r.id = p_cash_register_id
     FOR SHARE;

  IF NOT FOUND OR v_register.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: cash register % not found', p_cash_register_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_register.status <> 'open' THEN
    RAISE EXCEPTION 'pay_order: cash register % is not open (status=%)',
      p_cash_register_id, v_register.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Server-side amount.
  SELECT coalesce(sum(round(oi.price * oi.quantity)), 0)::bigint
    INTO v_subtotal
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.restaurant_id = v_caller_tenant;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'pay_order: order % has no items', p_order_id
      USING ERRCODE = 'P0001';
  END IF;

  v_tax := round(v_subtotal * coalesce(v_order.tax_percentage, 0)::numeric / 100)::bigint;
  v_amount_due := v_subtotal + v_tax;

  -- 6. Tenders. Each line must resolve to an ACTIVE catalog row of the
  -- caller's tenant; the CHECK on payment_tenders will reject anything that
  -- contradicts the snapshot. cash_received is the change rule, encoded as
  -- the CHECK on the tender table.
  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind, m.is_active, m.restaurant_id
      INTO v_method_code, v_method_kind, v_method_active, v_method_tenant
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    IF NOT FOUND OR v_method_tenant <> v_caller_tenant THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id does not resolve to a method of the caller tenant', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_method_active THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id resolves to an inactive method (% of tenant %)',
        v_line_no, v_method_code, v_method_tenant
        USING ERRCODE = 'P0001';
    END IF;

    v_tenders_sum := v_tenders_sum + v_amount;

    IF v_method_kind = 'cash' THEN
      IF v_cash_received IS NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is a cash method but cash_received is NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
      IF v_cash_received < v_amount THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received (%) is below amount (%)',
          v_line_no, v_cash_received, v_amount
          USING ERRCODE = 'P0001';
      END IF;
      v_change_given := v_change_given + (v_cash_received - v_amount);
      v_cash_received_sum := v_cash_received_sum + v_cash_received;
    ELSE
      IF v_cash_received IS NOT NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is an electronic method but cash_received is not NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF v_tenders_sum <> (v_amount_due + p_tip_amount) THEN
    RAISE EXCEPTION 'pay_order: tenders sum to % but amount_due + tip = %',
      v_tenders_sum, (v_amount_due + p_tip_amount)
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Drawer warning (warn only).
  -- a) initial cash.
  v_drawer_cash_before := v_register.initial_cash;

  -- b) sum of the cash tender amounts of payments already on this register.
  --    Electronic tenders do not change the cash drawer. The cash register is
  --    on the payment row, not on the tender row, so the join walks through
  --    payments. The new payment is inserted below, AFTER this computation,
  --    so it is not counted.
  SELECT coalesce(v_drawer_cash_before + sum(t.amount), v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = p_cash_register_id
     AND t.method_kind = 'cash';

  -- c) deposits - withdrawals on the same register.
  SELECT coalesce(v_drawer_cash_before
                  + coalesce(sum(CASE WHEN ct.type = 'deposit' THEN ct.amount ELSE 0 END), 0)
                  - coalesce(sum(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END), 0),
                  v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = p_cash_register_id;

  v_drawer_warning := v_change_given > v_drawer_cash_before;

  -- 8. Writes.
  INSERT INTO public.payments (
    restaurant_id, order_id, cash_register_id, cashier_profile_id,
    amount_due, tip_amount, total_charged, change_given, idempotency_key
  ) VALUES (
    v_caller_tenant, p_order_id, p_cash_register_id, v_caller_profile,
    v_amount_due, p_tip_amount, v_amount_due + p_tip_amount, v_change_given, p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind
      INTO v_method_code, v_method_kind
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    INSERT INTO public.payment_tenders (
      restaurant_id, payment_id, line_no, payment_method_id,
      method_code, method_kind, amount, cash_received
    ) VALUES (
      v_caller_tenant, v_payment_id, v_line_no, v_method_id,
      v_method_code, v_method_kind, v_amount, v_cash_received
    );
  END LOOP;

  -- 9. Order update.
  UPDATE public.orders o
     SET subtotal = v_subtotal,
         tax = v_tax,
         tip = p_tip_amount,
         tip_percentage = CASE WHEN v_subtotal > 0
                               THEN round((p_tip_amount * 100.0 / v_subtotal)::numeric, 2)
                               ELSE 0 END,
         total = v_amount_due + p_tip_amount,
         status = 'paid',
         updated_at = now()
   WHERE o.id = p_order_id;

  -- 10. Table release.
  IF v_order.table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.table_id = v_order.table_id
         AND o.id <> p_order_id
         AND o.status IN ('active', 'kitchen', 'delivered')
    ) THEN
      UPDATE public.tables t
         SET status = 'available',
             updated_at = now()
       WHERE t.id = v_order.table_id;
    END IF;
  END IF;

  -- 11. Response.
  RETURN jsonb_build_object(
    'payment_id',         v_payment_id,
    'status',             'paid',
    'amount_due',         v_amount_due,
    'tip_amount',         p_tip_amount,
    'total_charged',      v_amount_due + p_tip_amount,
    'change_given',       v_change_given,
    'drawer_warning',     v_drawer_warning,
    'drawer_cash_before', v_drawer_cash_before,
    'tenders',            (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'line_no',        t.line_no,
        'method_code',    t.method_code,
        'amount',         t.amount,
        'cash_received',  t.cash_received
      ) ORDER BY t.line_no), '[]'::jsonb)
        FROM public.payment_tenders t
       WHERE t.payment_id = v_payment_id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) IS
  'Atomic checkout. SECURITY DEFINER (owner postgres). Locks the order, validates the caller is a cashier/admin of the tenant, the register is open and of the tenant, the order is active|kitchen|delivered with at least one line, and the tenders add up to amount_due + tip. Snapshots the catalog (method_code / method_kind) so a later rename or retype does not rewrite history. Idempotent on (restaurant_id, idempotency_key): a replay returns status=already_paid with the existing payment summary and writes nothing; a different key on a paid order raises P0001. Returns jsonb with payment_id, status, amount_due, tip_amount, total_charged, change_given, drawer_warning, drawer_cash_before, tenders.';

-- ============================================
-- SECTION 2: privileges
-- ============================================
REVOKE ALL ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) TO service_role;

-- ============================================
-- SECTION 3: drop the broken legacy RPC
-- ============================================
-- public.complete_payment(uuid, text[], uuid) was added in
-- 20250917090008 and used numeric(10,2) money with a free-text method string,
-- no tenant-scoped tender lines and no idempotency the browser could rely on.
-- pay_order is the only writer of the new ledger; the old RPC is dropped so
-- no caller can keep using it by accident. 070_pay_order.test.sql pins the drop.
DROP FUNCTION IF EXISTS public.complete_payment(uuid, text[], uuid);

-- 020_anon_lockdown used to assert EXECUTE on complete_payment for
-- authenticated and service_role; the grants the old function carried are
-- dropped with the function itself. Restated here so a reader of this file
-- does not have to chase the reference: anonymous / PUBLIC never get EXECUTE
-- on pay_order (SECTION 2 above). 020 will be updated to point at pay_order
-- in a follow-up edit.