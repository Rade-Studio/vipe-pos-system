-- Audited delivery cancellations (odd/tasks/fase3-operacion.md, F3b, S1 a).
--
-- Until now a delivery was cancelled by set_delivery_status(..., 'cancel'):
-- it only set order_deliveries.delivery_status and orders.status, with an
-- optional reason and no order_cancellations or audit_log row, so the admin
-- Canceladas and Anulaciones never showed it. Now:
--
-- 1. public.cancel_order (0018, same signature) also cancels deliveries, for
--    admin and delivery_operator (a cashier or waiter gets delivery_order, a
--    delivery_operator calling it on a table order gets 42501): a reason is
--    always required (private.void_reason_text), order_cancellations and
--    audit_log (order_cancelled, details with order_type delivery, the fee,
--    the customer and the delivery status) are written, and orders.status and
--    order_deliveries.delivery_status (+ cancelled_at) become cancelled in the
--    same transaction. The delivery must be received, preparing, ready or
--    failed (as before; else P0001 delivery_not_cancellable).
-- 2. A supervisor authorization (cancel_order, bound to the order and its
--    requester, private.void_authorizer) is required only when the delivery
--    has a live payment (user decision, F3b). Every live payment is then
--    voided under that same authorization exactly like void_payment
--    (payment_voids, payments.voided_at, audit_log payment_voided with
--    details.cancellation_audit_id). A live payment of a closed drawer
--    refuses the whole cancellation (P0001 register_closed). A prepaid
--    delivery is 'paid' before it leaves, so previous_status may be 'paid'.
-- 3. audit_log_authorization_id_key (one event per authorization) becomes
--    audit_log_authorization_target_key: one event per authorization and
--    target (the order, or each payment it voided). void_authorizer still
--    refuses an authorization that already backs any event.
-- 4. set_delivery_status no longer cancels: 'cancel' answers P0001 "cancel
--    goes through cancel_order (a reason is required)" after the same input
--    checks as before; every other transition is unchanged.
--
-- Deliveries cancelled before 0019 keep their rows untouched: no actor or
-- reason is invented and no audit row is written. The API lists them in
-- Canceladas with "Sin motivo registrado (antes de la auditoría)".
-- Dine-in cancellations are unchanged.
ALTER TABLE public.order_cancellations DROP CONSTRAINT order_cancellations_previous_status_check;
--> statement-breakpoint
ALTER TABLE public.order_cancellations
  ADD CONSTRAINT order_cancellations_previous_status_check CHECK (previous_status IN ('active', 'kitchen', 'delivered', 'paid'));
--> statement-breakpoint
DROP INDEX public.audit_log_authorization_id_key;
--> statement-breakpoint
CREATE UNIQUE INDEX audit_log_authorization_target_key ON public.audit_log USING btree (authorization_id, (COALESCE(payment_id, order_id)))
  WHERE (authorization_id IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason_code text, p_reason_text text DEFAULT NULL, p_authorization_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'cancel_order';
  v_caller   record;
  v_name     text;
  v_order    public.orders%ROWTYPE;
  v_delivery public.order_deliveries%ROWTYPE;
  v_is_delivery boolean;
  v_text     text;
  v_items    jsonb;
  v_sent     integer;
  v_live     integer;
  v_paid     boolean;
  v_required boolean;
  v_auth     record;
  v_auth_id  uuid;
  v_audit    uuid;
  v_amount   numeric;
  v_payment  public.payments%ROWTYPE;
  v_pay_list jsonb := '[]'::jsonb;
  v_tenders  jsonb;
  v_methods  text;
  v_pay_audit uuid;
  v_voided   integer := 0;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier', 'waiter', 'delivery_operator']);
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_caller.profile_id;

  -- Order first, then its delivery, then its payments and drawers (pay_order's order).
  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.restaurant_id = v_caller.restaurant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: order_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  v_is_delivery := v_order.order_type = 'delivery';
  IF NOT v_is_delivery AND v_caller.app_role = 'delivery_operator' THEN
    RAISE EXCEPTION '%: role % may not call this function', c_fn, v_caller.app_role USING ERRCODE = '42501';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION '%: order_cancelled', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_is_delivery AND v_caller.app_role NOT IN ('admin', 'delivery_operator') THEN
    RAISE EXCEPTION '%: delivery_order', c_fn USING ERRCODE = 'P0001';
  END IF;
  -- A table order is paid only at the end: void its payment first (Caja). A
  -- prepaid delivery is paid before it leaves: its payment is voided here.
  IF v_order.status = 'paid' AND NOT v_is_delivery THEN
    RAISE EXCEPTION '%: order_paid', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_is_delivery THEN
    SELECT od.* INTO v_delivery FROM public.order_deliveries od WHERE od.order_id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_delivery.delivery_status NOT IN ('received', 'preparing', 'ready', 'failed') THEN
      RAISE EXCEPTION '%: delivery_not_cancellable', c_fn USING ERRCODE = 'P0001';
    END IF;
  END IF;
  v_text := private.void_reason_text(c_fn, p_reason_code, p_reason_text);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', oi.id, 'dish_id', oi.dish_id, 'name', oi.name, 'price', oi.price, 'quantity', oi.quantity,
           'status', oi.status, 'sent_to_kitchen', true, 'stock_consumed', oi.stock_consumed_at IS NOT NULL)
           ORDER BY oi.added_at, oi.created_at, oi.id), '[]'::jsonb),
         count(*)
    INTO v_items, v_live
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.quantity > 0
     AND coalesce(oi.status, '') <> 'cancelled';
  -- Every server-side line was sent to the kitchen (the cart lives in the client).
  v_sent := v_live;

  IF v_is_delivery THEN
    -- Its live payments, locked; a payment of a closed drawer stops everything (its Z stands).
    PERFORM 1 FROM public.payments p WHERE p.order_id = p_order_id AND p.voided_at IS NULL FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.payments p
                 JOIN public.cash_registers r ON r.id = p.cash_register_id
                WHERE p.order_id = p_order_id AND p.voided_at IS NULL AND r.status IS DISTINCT FROM 'open') THEN
      RAISE EXCEPTION '%: register_closed', c_fn USING ERRCODE = 'P0001';
    END IF;
    PERFORM 1 FROM public.cash_registers r
      WHERE r.id IN (SELECT p.cash_register_id FROM public.payments p WHERE p.order_id = p_order_id AND p.voided_at IS NULL)
        FOR SHARE;
    v_paid := EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id AND p.voided_at IS NULL);
    -- User decision (F3b): a supervisor only when the delivery is already paid.
    v_required := v_paid;
    -- The customer's bill: pay_order folds the fee into orders.total, an unpaid order does not carry it yet.
    v_amount := v_order.subtotal + v_order.tax + v_order.tip + v_delivery.delivery_fee;
    -- order_cancellations.total, the audit amount and the answer all carry the customer's bill.
  ELSE
    v_paid := EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id);
    v_required := v_live > 0 OR v_paid;
    v_amount := v_order.total;
  END IF;

  SELECT * INTO v_auth FROM private.void_authorizer(c_fn, v_caller.restaurant_id, v_caller.profile_id, 'cancel_order',
                                                    'order', p_order_id, p_authorization_id, v_required);
  v_auth_id := CASE WHEN v_auth.authorized_by IS NULL THEN NULL ELSE p_authorization_id END;

  IF v_is_delivery THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('payment_id', p.id, 'cash_register_id', p.cash_register_id,
                                                 'amount_due', p.amount_due, 'tip_amount', p.tip_amount,
                                                 'total_charged', p.total_charged) ORDER BY p.created_at, p.id), '[]'::jsonb)
      INTO v_pay_list
      FROM public.payments p WHERE p.order_id = p_order_id AND p.voided_at IS NULL;
  END IF;

  INSERT INTO public.audit_log
    (restaurant_id, event_type, order_id, actor_profile_id, actor_name, authorized_by_profile_id, authorized_by_name,
     authorization_id, self_authorized, reason_code, reason_text, amount, details)
  VALUES
    (v_caller.restaurant_id, 'order_cancelled', p_order_id, v_caller.profile_id, v_name, v_auth.authorized_by,
     v_auth.authorized_by_name, v_auth_id, v_auth.self_authorized, p_reason_code, v_text, v_amount,
     jsonb_build_object('order_number', v_order.order_number, 'previous_status', v_order.status,
                        'subtotal', v_order.subtotal, 'tax', v_order.tax, 'tip', v_order.tip, 'total', v_amount,
                        'items', v_items, 'sent_items', v_sent)
     || CASE WHEN v_is_delivery THEN
          jsonb_build_object('order_type', 'delivery', 'delivery_fee', v_delivery.delivery_fee,
                             'customer_name', v_delivery.customer_name, 'delivery_status', v_delivery.delivery_status,
                             'payment_mode', v_delivery.payment_mode, 'payments_voided', v_pay_list)
        ELSE '{}'::jsonb END)
  RETURNING id INTO v_audit;

  INSERT INTO public.order_cancellations
    (restaurant_id, order_id, audit_id, previous_status, reason_code, reason_text, cancelled_by, cancelled_by_name,
     authorized_by, authorized_by_name, authorization_id, self_authorized, subtotal, tax, tip, total, items, sent_items)
  VALUES
    (v_caller.restaurant_id, p_order_id, v_audit, v_order.status, p_reason_code, v_text, v_caller.profile_id, v_name,
     v_auth.authorized_by, v_auth.authorized_by_name, v_auth_id, v_auth.self_authorized,
     v_order.subtotal, v_order.tax, v_order.tip, v_amount, v_items, v_sent);

  -- A paid delivery: each live payment is voided as void_payment does, under the same authorization.
  IF v_is_delivery THEN
    FOR v_payment IN SELECT p.* FROM public.payments p
                      WHERE p.order_id = p_order_id AND p.voided_at IS NULL ORDER BY p.created_at, p.id LOOP
      SELECT jsonb_agg(jsonb_build_object('line_no', t.line_no, 'payment_method_id', t.payment_method_id,
                                          'method_code', t.method_code, 'method_kind', t.method_kind, 'amount', t.amount,
                                          'cash_received', t.cash_received, 'reference', t.reference) ORDER BY t.line_no),
             string_agg(DISTINCT t.method_code, ', ')
        INTO v_tenders, v_methods
        FROM public.payment_tenders t
       WHERE t.payment_id = v_payment.id;

      INSERT INTO public.audit_log
        (restaurant_id, event_type, order_id, payment_id, actor_profile_id, actor_name, authorized_by_profile_id,
         authorized_by_name, authorization_id, self_authorized, reason_code, reason_text, amount, details)
      VALUES
        (v_caller.restaurant_id, 'payment_voided', p_order_id, v_payment.id, v_caller.profile_id, v_name,
         v_auth.authorized_by, v_auth.authorized_by_name, p_authorization_id, v_auth.self_authorized, p_reason_code, v_text,
         v_payment.total_charged,
         jsonb_build_object('order_number', v_order.order_number, 'cash_register_id', v_payment.cash_register_id,
                            'amount_due', v_payment.amount_due, 'tip_amount', v_payment.tip_amount,
                            'total_charged', v_payment.total_charged, 'change_given', v_payment.change_given,
                            'methods', v_methods, 'tenders', v_tenders, 'order_type', 'delivery',
                            'cancellation_audit_id', v_audit))
      RETURNING id INTO v_pay_audit;

      INSERT INTO public.payment_voids
        (restaurant_id, payment_id, order_id, cash_register_id, audit_id, amount_due, tip_amount, total_charged, change_given,
         methods, tenders, paid_at, reason_code, reason_text, voided_by, voided_by_name, authorized_by, authorized_by_name,
         authorization_id, self_authorized)
      VALUES
        (v_caller.restaurant_id, v_payment.id, p_order_id, v_payment.cash_register_id, v_pay_audit, v_payment.amount_due,
         v_payment.tip_amount, v_payment.total_charged, v_payment.change_given, v_methods, v_tenders, v_payment.created_at,
         p_reason_code, v_text, v_caller.profile_id, v_name, v_auth.authorized_by, v_auth.authorized_by_name,
         p_authorization_id, v_auth.self_authorized);

      UPDATE public.payments SET voided_at = now() WHERE id = v_payment.id;
      v_voided := v_voided + 1;
    END LOOP;

    UPDATE public.order_deliveries
       SET delivery_status = 'cancelled', cancelled_at = now()
     WHERE order_id = p_order_id;
  END IF;

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;

  -- The table is free when no other open order remains on it (the old DELETE did the same).
  IF v_order.table_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.table_id = v_order.table_id AND o.status IN ('active', 'kitchen', 'delivered')) THEN
    UPDATE public.tables SET status = 'available', waiter_id = NULL, updated_at = now() WHERE id = v_order.table_id;
  END IF;

  RETURN jsonb_build_object('audit_id', v_audit, 'order_id', p_order_id, 'authorized_by', v_auth.authorized_by,
                            'self_authorized', v_auth.self_authorized, 'total', v_amount)
         || CASE WHEN v_is_delivery THEN jsonb_build_object('payments_voided', v_voided) ELSE '{}'::jsonb END;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.cancel_order(uuid, text, text, uuid) IS 'Cancels an open order of the caller''s restaurant, never deleting it (0018, deliveries since 0019). Table orders: admin, cashier, waiter (a delivery_operator gets 42501); P0001 order_paid (void the payment first); a supervisor authorization (cancel_order, private.void_authorizer) when the order has a live line or any payment. Deliveries: admin, delivery_operator (cashier and waiter get P0001 delivery_order); received, preparing, ready or failed (else P0001 delivery_not_cancellable); a supervisor authorization only when it has a live payment, and every live payment is then voided under it as void_payment does (payment_voids, voided_at, audit_log payment_voided with details.cancellation_audit_id); a live payment of a closed drawer refuses everything (P0001 register_closed); order_deliveries becomes cancelled with cancelled_at. Always: a reason (22023 reason_invalid / reason_text_required), P0002 order_not_found, P0001 order_cancelled; writes audit_log (order_cancelled; for a delivery order_cancellations.total, the amount and the answer''s total are the customer''s bill (subtotal + tax + tip + fee) and details carry order_type, delivery_fee, customer_name, delivery_status, payment_mode, payments_voided) and order_cancellations, sets status cancelled and frees the table when no other open order remains. Stock already consumed stays consumed. Returns {audit_id, order_id, authorized_by, self_authorized, total} plus payments_voided for a delivery.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_courier_eta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_courier_location text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_delivery        public.order_deliveries%ROWTYPE;
  v_order           public.orders%ROWTYPE;
  v_current_state   text;
  v_target_state    text;
  v_courier         public.couriers%ROWTYPE;
  v_reason_text     text;
  v_location        text;

  v_allowed_states  text[];
  v_kitchen_allowed boolean := false;
  v_caller_allowed  boolean := false;

  v_now             timestamptz := now();
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'set_delivery_status: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Lock the delivery row in the caller's tenant.
  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id
     AND od.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_delivery_status: delivery for order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  v_current_state := v_delivery.delivery_status;

  -- 3. Action dispatch.
  IF p_action NOT IN ('start_preparing', 'mark_ready', 'dispatch', 'deliver', 'fail', 'cancel') THEN
    RAISE EXCEPTION 'set_delivery_status: unknown action ''%''', p_action
      USING ERRCODE = '22023';
  END IF;

  -- role/action matrix.
  IF p_action IN ('start_preparing', 'mark_ready') THEN
    v_kitchen_allowed := v_caller_role IN ('kitchen', 'delivery_operator', 'admin');
    v_caller_allowed  := v_kitchen_allowed;
  ELSE
    v_caller_allowed := v_caller_role IN ('delivery_operator', 'admin');
  END IF;

  IF NOT v_caller_allowed THEN
    RAISE EXCEPTION 'set_delivery_status: role ''%'' may not perform ''%''',
      v_caller_role, p_action
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4. State machine.
  IF p_action = 'start_preparing' THEN
    v_allowed_states := ARRAY['received'];
    v_target_state   := 'preparing';
  ELSIF p_action = 'mark_ready' THEN
    v_allowed_states := ARRAY['received', 'preparing'];
    v_target_state   := 'ready';
  ELSIF p_action = 'dispatch' THEN
    v_allowed_states := ARRAY['ready', 'failed'];
    v_target_state   := 'out_for_delivery';
  ELSIF p_action = 'deliver' THEN
    v_allowed_states := ARRAY['out_for_delivery'];
    v_target_state   := 'delivered';
  ELSIF p_action = 'fail' THEN
    v_allowed_states := ARRAY['out_for_delivery'];
    v_target_state   := 'failed';
  ELSIF p_action = 'cancel' THEN
    v_allowed_states := ARRAY['received', 'preparing', 'ready', 'failed'];
    v_target_state   := 'cancelled';
  END IF;

  -- Same-state replays: P0001 with a clear message naming the current state.
  -- Easier to reason about in the UI than a silent no-op.
  IF v_current_state = v_target_state THEN
    RAISE EXCEPTION 'set_delivery_status: delivery for order % is already in state ''%''',
      p_order_id, v_current_state
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (v_current_state = ANY (v_allowed_states)) THEN
    RAISE EXCEPTION 'set_delivery_status: action ''%'' is not allowed from state ''%'' (allowed: %)',
      p_action, v_current_state, array_to_string(v_allowed_states, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Per-action validation.
  IF p_action = 'fail' THEN
    v_reason_text := btrim(coalesce(p_reason, ''));
    IF v_reason_text = '' THEN
      RAISE EXCEPTION 'set_delivery_status: fail requires a non-empty reason'
        USING ERRCODE = '22023';
    END IF;
    IF length(v_reason_text) > 200 THEN
      RAISE EXCEPTION 'set_delivery_status: fail reason must be <= 200 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_action <> 'dispatch' AND (p_courier_eta IS NOT NULL OR p_courier_location IS NOT NULL) THEN
    RAISE EXCEPTION 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'dispatch' THEN
    -- Typed by the operator (no courier GPS): when the courier is expected
    -- back, and where they are.
    IF p_courier_eta IS NOT NULL
       AND (p_courier_eta <= v_now OR p_courier_eta > v_now + interval '6 hours') THEN
      RAISE EXCEPTION 'set_delivery_status: p_courier_eta must be after now and within 6 hours'
        USING ERRCODE = '22023';
    END IF;

    v_location := btrim(p_courier_location);
    IF p_courier_location IS NOT NULL AND (v_location = '' OR length(v_location) > 60) THEN
      RAISE EXCEPTION 'set_delivery_status: p_courier_location must be 1..60 characters'
        USING ERRCODE = '22023';
    END IF;

    IF p_courier_id IS NULL THEN
      RAISE EXCEPTION 'set_delivery_status: dispatch requires p_courier_id'
        USING ERRCODE = '22023';
    END IF;

    SELECT co.* INTO v_courier
      FROM public.couriers co
     WHERE co.id = p_courier_id
       AND co.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_delivery_status: courier % not found', p_courier_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_courier.is_active THEN
      RAISE EXCEPTION 'set_delivery_status: courier % is not active', p_courier_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 0019: a cancellation is an audited event with a reason (public.cancel_order).
  IF p_action = 'cancel' THEN
    RAISE EXCEPTION 'set_delivery_status: cancel goes through cancel_order (a reason is required)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. Writes.
  IF p_action = 'start_preparing' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'preparing'
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'mark_ready' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'ready'
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'dispatch' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'out_for_delivery',
           courier_id     = v_courier.id,
           dispatched_at  = v_now,
           failure_reason = NULL,
           courier_eta    = p_courier_eta,
           courier_location = v_location,
           returned_at    = NULL
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'deliver' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'delivered',
           delivered_at    = v_now
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'fail' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'failed',
           failure_reason  = v_reason_text,
           failed_at       = v_now
     WHERE od.order_id = p_order_id;
  END IF;

  -- 7. Response.
  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id;

  RETURN to_jsonb(v_delivery);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.set_delivery_status(uuid, text, uuid, text, timestamptz, text) IS 'Delivery lifecycle machine. SECURITY DEFINER. Locks the order_deliveries row FOR UPDATE; missing or foreign -> P0002. Action role matrix: start_preparing and mark_ready are open to kitchen / delivery_operator / admin; dispatch / deliver / fail / cancel are delivery_operator / admin only (else 42501). Transitions: start_preparing (received -> preparing), mark_ready (received|preparing -> ready), dispatch (ready|failed -> out_for_delivery; requires an ACTIVE courier of the tenant; clears failure_reason and returned_at on re-dispatch; stores p_courier_eta (after now, within 6 hours) and p_courier_location (trimmed, 1..60), NULL when not sent), deliver (out_for_delivery -> delivered), fail (out_for_delivery -> failed; reason 1..200). cancel (0019): after the same role, state and input checks it raises P0001 "cancel goes through cancel_order (a reason is required)"; deliveries are cancelled only by public.cancel_order, the audited path. p_courier_eta / p_courier_location on any other action -> 22023. Same-state replays raise P0001 (no silent no-op). Returns the updated order_deliveries row as jsonb.';
