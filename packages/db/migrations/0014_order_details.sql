-- Order details the cashier, kitchen, waiter and delivery designs show
-- (odd/tasks/rediseno-pos.md, T15, S8). Additive: no existing value changes.
--
-- 1. public.orders.order_number: a per-restaurant number from 1, kept in
--    private.inventory_counters (counter 'order_number') and bumped by
--    private.next_inventory_counter, whose upsert row-locks the counter, so
--    two concurrent inserts wait on each other and never share a number (a
--    rolled-back insert gives its number back). A BEFORE INSERT trigger always
--    assigns it: a value the client sends is ignored, not refused, so no
--    caller has to know the column. Changing a number is refused (42501) for
--    every role. Existing orders are backfilled per restaurant in
--    (created_at, id) order (NULL created_at last) and the counter is set to
--    the highest number; then NOT NULL and UNIQUE (restaurant_id,
--    order_number).
-- 2. public.orders.guests (1..99) and notes (1..300 characters after trim),
--    NULL until captured (S8: nothing invented).
-- 3. public.payment_tenders.reference (1..60 characters): card last digits or
--    approval code, Nequi reference, captured by hand. pay_order reads an
--    optional "reference" per tender (absent or JSON null = NULL; a string is
--    trimmed; anything else is 22023) and stores it; amounts, idempotency and
--    the response are unchanged, so an old payload behaves identically.
-- 4. public.cash_registers.opened_by: the profile that opened the register,
--    defaulting to private.current_profile_id(), so the API's INSERT records
--    the caller without a code change. Existing registers stay NULL. The key
--    is (restaurant_id, opened_by) -> profiles(restaurant_id, id), so only a
--    profile of the same restaurant fits; deleting the profile clears
--    opened_by only.
-- 5. public.order_deliveries: prepaid_method_id ((restaurant_id,
--    prepaid_method_id) -> payment_methods(restaurant_id, id), only on a
--    prepaid delivery), courier_eta, courier_location (1..60 characters,
--    typed by the operator: no courier GPS exists) and returned_at (courier
--    back at the restaurant, not before dispatched_at). The rows stay
--    writable only by the SECURITY DEFINER delivery RPCs (immutability guard
--    unchanged).
-- No grant or policy changes: vipe_api holds table-level grants on the four
-- tables, and orders/order_deliveries realtime payloads are whole rows
-- (private.realtime_row), so the new columns reach listeners as they are.
CREATE FUNCTION private.current_profile_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.user_id = private.current_user_id()
  LIMIT 1
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.current_profile_id() IS 'Profile of the caller, resolved from profiles.user_id = private.current_user_id(). NULL when the caller has no profile or outside an API session.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.current_profile_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.current_profile_id() TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.orders
    ADD COLUMN order_number integer,
    ADD COLUMN guests smallint,
    ADD COLUMN notes text,
    ADD CONSTRAINT orders_order_number_check CHECK (order_number >= 1),
    ADD CONSTRAINT orders_guests_check CHECK (guests BETWEEN 1 AND 99),
    ADD CONSTRAINT orders_notes_check CHECK (length(btrim(notes)) BETWEEN 1 AND 300);
--> statement-breakpoint
COMMENT ON COLUMN public.orders.order_number IS 'Per-restaurant order number from 1, assigned on INSERT by orders_assign_order_number (a client value is ignored) and never changed. Counter: private.inventory_counters (counter order_number).';
--> statement-breakpoint
COMMENT ON COLUMN public.orders.guests IS 'Number of guests at the table (1..99), captured by the waiter; NULL when not captured.';
--> statement-breakpoint
COMMENT ON COLUMN public.orders.notes IS 'Order-level note for the kitchen (1..300 characters after trim); NULL when none. Item notes stay in order_items.';
--> statement-breakpoint
COMMENT ON TABLE private.inventory_counters IS 'Per-restaurant sequences for SKUs (sku_raw, sku_prep), purchase order numbers (purchase_order), count numbers (inventory_count) and order numbers (order_number). Bumped by private.next_inventory_counter only.';
--> statement-breakpoint
CREATE FUNCTION private.backfill_order_numbers()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  WITH base AS (
    SELECT o.restaurant_id,
           GREATEST(pg_catalog.max(o.order_number), pg_catalog.max(c.value)::integer, 0) AS last
      FROM public.orders o
      LEFT JOIN private.inventory_counters c
        ON c.restaurant_id = o.restaurant_id AND c.counter = 'order_number'
     GROUP BY o.restaurant_id
    HAVING pg_catalog.bool_or(o.order_number IS NULL)
  ), numbered AS (
    SELECT o.id,
           b.last + pg_catalog.row_number() OVER (PARTITION BY o.restaurant_id ORDER BY o.created_at, o.id) AS n
      FROM public.orders o
      JOIN base b ON b.restaurant_id = o.restaurant_id
     WHERE o.order_number IS NULL
  ), numbered_orders AS (
    UPDATE public.orders o SET order_number = n.n
      FROM numbered n
     WHERE o.id = n.id
    RETURNING o.restaurant_id, o.order_number
  )
  INSERT INTO private.inventory_counters AS c (restaurant_id, counter, value)
  SELECT u.restaurant_id, 'order_number', pg_catalog.max(u.order_number)
    FROM numbered_orders u
   GROUP BY u.restaurant_id
  ON CONFLICT (restaurant_id, counter) DO UPDATE SET value = GREATEST(c.value, excluded.value);
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.backfill_order_numbers() IS 'Numbers the orders without order_number per restaurant in (created_at, id) order after the highest number or counter value of the restaurant, and moves the counter to the last number. Idempotent: numbered orders are untouched. Run by migration 0014; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.backfill_order_numbers() FROM PUBLIC;
--> statement-breakpoint
-- The backfill writes one new column per order: listeners need no event.
ALTER TABLE public.orders DISABLE TRIGGER notify_change;
--> statement-breakpoint
SELECT private.backfill_order_numbers();
--> statement-breakpoint
ALTER TABLE public.orders ENABLE TRIGGER notify_change;
--> statement-breakpoint
ALTER TABLE public.orders
    ALTER COLUMN order_number SET NOT NULL,
    ADD CONSTRAINT orders_restaurant_id_order_number_key UNIQUE (restaurant_id, order_number);
--> statement-breakpoint
CREATE FUNCTION private.assign_order_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  -- Without a restaurant the orders NOT NULL constraint reports the error.
  IF NEW.restaurant_id IS NOT NULL THEN
    NEW.order_number := private.next_inventory_counter(NEW.restaurant_id, 'order_number')::integer;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.assign_order_number() IS 'BEFORE INSERT on public.orders: sets order_number to the next value of the restaurant counter (row-locked upsert), replacing any value the client sent.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.assign_order_number() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.guard_order_number() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'orders.order_number is assigned by the database and cannot change'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_order_number() IS 'BEFORE UPDATE on public.orders when a set order_number changes: raises 42501 for every role. A NULL number may be set (the 0014 backfill).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_order_number() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER orders_assign_order_number BEFORE INSERT ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.assign_order_number();
--> statement-breakpoint
CREATE TRIGGER orders_order_number_immutable BEFORE UPDATE ON public.orders
    FOR EACH ROW WHEN (OLD.order_number IS NOT NULL AND NEW.order_number IS DISTINCT FROM OLD.order_number)
    EXECUTE FUNCTION private.guard_order_number();
--> statement-breakpoint
ALTER TABLE public.payment_tenders
    ADD COLUMN reference text,
    ADD CONSTRAINT payment_tenders_reference_check CHECK (length(btrim(reference)) BETWEEN 1 AND 60);
--> statement-breakpoint
COMMENT ON COLUMN public.payment_tenders.reference IS 'Manual reference of the tender (card last digits or approval code, Nequi reference), 1..60 characters, trimmed by pay_order; NULL when none. Frozen with the tender.';
--> statement-breakpoint
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.cash_registers
    ADD COLUMN opened_by uuid,
    ADD CONSTRAINT cash_registers_opened_by_fkey FOREIGN KEY (restaurant_id, opened_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (opened_by);
--> statement-breakpoint
-- Set after ADD COLUMN so existing registers stay NULL instead of evaluating
-- the default during the migration.
ALTER TABLE public.cash_registers
    ALTER COLUMN opened_by SET DEFAULT private.current_profile_id();
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.opened_by IS 'Profile that opened the register (default: the caller of the API session), of the same restaurant; NULL for registers opened before migration 0014 or when the profile is deleted.';
--> statement-breakpoint
CREATE INDEX idx_cash_registers_opened_by ON public.cash_registers USING btree (opened_by);
--> statement-breakpoint
-- A unique index, not a constraint: the composite key only needs the index,
-- and (restaurant_id, code) stays the catalog's one uniqueness rule
-- (050_payment_methods).
CREATE UNIQUE INDEX payment_methods_restaurant_id_id_key ON public.payment_methods USING btree (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.order_deliveries
    ADD COLUMN prepaid_method_id uuid,
    ADD COLUMN courier_eta timestamp with time zone,
    ADD COLUMN courier_location text,
    ADD COLUMN returned_at timestamp with time zone,
    ADD CONSTRAINT order_deliveries_prepaid_method_id_fkey FOREIGN KEY (restaurant_id, prepaid_method_id) REFERENCES public.payment_methods(restaurant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT order_deliveries_prepaid_method_check CHECK (prepaid_method_id IS NULL OR payment_mode = 'prepaid'),
    ADD CONSTRAINT order_deliveries_courier_location_check CHECK (length(btrim(courier_location)) BETWEEN 1 AND 60),
    ADD CONSTRAINT order_deliveries_returned_at_check CHECK (returned_at IS NULL OR (dispatched_at IS NOT NULL AND returned_at >= dispatched_at));
--> statement-breakpoint
COMMENT ON COLUMN public.order_deliveries.prepaid_method_id IS 'Payment channel of a prepaid delivery (a payment method of the same restaurant); NULL on cash on delivery or when not captured.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_deliveries.courier_eta IS 'Expected time the courier is back, typed by the operator at dispatch (no courier GPS); NULL when not captured.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_deliveries.courier_location IS 'Where the courier is, typed by the operator (1..60 characters); NULL when not captured.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_deliveries.returned_at IS 'Courier back at the restaurant; never before dispatched_at.';
--> statement-breakpoint
CREATE INDEX idx_order_deliveries_prepaid_method_id ON public.order_deliveries USING btree (prepaid_method_id);
--> statement-breakpoint
-- pay_order as in the baseline, plus the optional tender reference (marked
-- 0014): parsed with the other tender fields, stored on the tender line.
-- CREATE OR REPLACE keeps the owner and the grants.
CREATE OR REPLACE FUNCTION public.pay_order(p_order_id uuid, p_cash_register_id uuid, p_tip_amount bigint, p_tenders jsonb, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_order           public.orders%ROWTYPE;
  v_register        public.cash_registers%ROWTYPE;
  v_delivery_fee    bigint := 0;

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
  v_reference       text;

  v_line_no         smallint := 0;
  v_tender_json     jsonb;
  v_tender_lines    jsonb := '[]'::jsonb;

  v_pending_line_no        smallint[] := '{}'::smallint[];
  v_pending_payment_method uuid[]    := '{}'::uuid[];
  v_pending_amount         bigint[]  := '{}'::bigint[];
  v_pending_cash_received  bigint[]  := '{}'::bigint[];
  v_pending_reference      text[]    := '{}'::text[];

  v_i              integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- CHANGE 1: delivery_operator is admitted so the operator can record a
  -- prepaid payment or a cash-on-delivery collection without handing the
  -- drawer to a cashier.
  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'pay_order: only cashier, admin or delivery_operator may settle an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id()
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

    -- 0014: optional manual reference (absent or JSON null = none).
    IF v_tender ? 'reference' AND v_tender -> 'reference' <> 'null'::jsonb THEN
      IF jsonb_typeof(v_tender -> 'reference') <> 'string' THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be a string', v_line_no
          USING ERRCODE = '22023';
      END IF;
      v_reference := btrim(v_tender ->> 'reference');
      IF length(v_reference) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be 1 to 60 characters', v_line_no
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_reference := NULL;
    END IF;

    v_pending_line_no        := v_pending_line_no || v_line_no;
    v_pending_payment_method := v_pending_payment_method || v_method_id;
    v_pending_amount         := v_pending_amount || v_amount;
    v_pending_cash_received  := v_pending_cash_received || v_cash_received;
    v_pending_reference      := v_pending_reference || v_reference;
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

  -- 4. Cash register.
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

  -- CHANGE 2: add the delivery fee when the order is a delivery. The
  -- order_deliveries row is guaranteed to exist by the consistency trigger
  -- (1:1 with the order, same restaurant). No tax on the fee, no tip on the
  -- fee: the tax is computed on the food subtotal only, and the tip is the
  -- caller's p_tip_amount as today.
  v_delivery_fee := 0;
  IF v_order.order_type = 'delivery' THEN
    SELECT coalesce(od.delivery_fee, 0)
      INTO v_delivery_fee
      FROM public.order_deliveries od
     WHERE od.order_id = p_order_id;

    IF v_delivery_fee IS NULL THEN
      -- A delivery order with no order_deliveries row is a schema invariant
      -- break. The 23514 from the consistency trigger would already have
      -- fired; this is a defense in depth.
      v_delivery_fee := 0;
    END IF;
  END IF;

  v_amount_due := v_subtotal + v_tax + v_delivery_fee;

  -- 6. Tenders.
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
  v_drawer_cash_before := v_register.initial_cash;

  SELECT coalesce(v_drawer_cash_before + sum(t.amount), v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = p_cash_register_id
     AND t.method_kind = 'cash';

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
      method_code, method_kind, amount, cash_received, reference
    ) VALUES (
      v_caller_tenant, v_payment_id, v_line_no, v_method_id,
      v_method_code, v_method_kind, v_amount, v_cash_received, v_pending_reference[v_i]
    );
  END LOOP;

  -- 9. Order update. tip_percentage is the tip / subtotal ratio (the food
  -- subtotal, NOT amount_due), the same as the original pay_order.
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

  -- 10. Table release (delivery orders have table_id NULL; the IF guard
  -- already short-circuits).
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
--> statement-breakpoint
COMMENT ON FUNCTION public.pay_order(p_order_id uuid, p_cash_register_id uuid, p_tip_amount bigint, p_tenders jsonb, p_idempotency_key uuid) IS 'Atomic checkout. SECURITY DEFINER (owner postgres). Locks the order, validates the caller is a cashier/admin/delivery_operator of the tenant, the register is open and of the tenant, the order is active|kitchen|delivered with at least one line, and the tenders add up to amount_due + tip. For a delivery order, amount_due = subtotal + tax + delivery_fee (no tax / no tip on the fee). Snapshots the catalog (method_code / method_kind) so a later rename or retype does not rewrite history. Each tender may carry an optional reference (string, trimmed, 1..60 characters; absent or null = none, otherwise 22023), stored on payment_tenders.reference. Idempotent on (restaurant_id, idempotency_key): a replay returns status=already_paid with the existing payment summary and writes nothing; a different key on a paid order raises P0001. Returns jsonb with payment_id, status, amount_due, tip_amount, total_charged, change_given, drawer_warning, drawer_cash_before, tenders.';
