-- Delivery details for the dispatch console (odd/tasks/rediseno-pos.md, T19,
-- S3, S8). The columns come from 0014; this migration lets the delivery RPCs
-- write them and opens the courier registry to the delivery operator.
--
-- 1. public.create_delivery_order gains p_prepaid_method_id (DEFAULT NULL,
--    last): only on a prepaid order (else 22023), an active payment method of
--    the caller's restaurant (unknown or foreign P0002, inactive 22023),
--    stored on order_deliveries.prepaid_method_id.
-- 2. public.set_delivery_status gains p_courier_eta and p_courier_location
--    (DEFAULT NULL, last), only with dispatch (else 22023): the ETA after now
--    and at most 6 hours ahead, the location trimmed to 1..60 characters.
--    Every dispatch writes both (NULL when not sent) and clears returned_at,
--    so a re-dispatch never keeps the previous trip's values.
-- 3. public.return_courier(p_order_id): admin / delivery_operator (42501),
--    the delivery of the caller's restaurant (P0002), delivered or failed
--    (P0001), once (P0001); stamps returned_at = now().
--    Old call shapes (positional or named) resolve to the new signatures
--    unchanged: the old functions are dropped, not overloaded, so no call is
--    ambiguous.
-- 4. public.couriers: the delivery operator may INSERT (insert policy) and
--    UPDATE (update policy) couriers of their restaurant, but a BEFORE UPDATE
--    trigger refuses (42501) any operator change other than is_active. No
--    DELETE policy exists for anyone (deactivating keeps history resolving).
DROP FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text);
--> statement-breakpoint
CREATE FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_prepaid_method_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_customer_id     uuid;
  v_customer_name   text;
  v_customer_phone  text;
  v_address_id      uuid := NULL;
  v_addr_customer_id uuid;
  v_address_line    text;
  v_address_neigh   text;
  v_address_ref     text;
  v_address_label   text;

  v_items_count     integer;
  v_item            jsonb;
  v_line_no         integer;
  v_dish_id         uuid;
  v_dish_qty        integer;
  v_dish_comments   text;

  v_distinct_dishes uuid[] := '{}'::uuid[];

  v_subtotal        bigint := 0;
  v_tax_pct         numeric := 0;
  v_tax             bigint := 0;
  v_total           bigint := 0;

  v_order_id        uuid;
  v_fee             bigint;
  v_change          bigint;

  v_method_active   boolean;

  v_now             timestamptz := now();
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'create_delivery_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'create_delivery_order: only admin or delivery_operator may take a delivery order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id()
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'create_delivery_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'create_delivery_order: p_address must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'create_delivery_order: p_items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  v_items_count := jsonb_array_length(p_items);
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'create_delivery_order: p_items must be a non-empty array'
      USING ERRCODE = '22023';
  END IF;

  IF v_items_count > 100 THEN
    RAISE EXCEPTION 'create_delivery_order: p_items accepts at most 100 lines'
      USING ERRCODE = '22023';
  END IF;

  IF p_delivery_fee IS NULL OR p_delivery_fee < 0 THEN
    RAISE EXCEPTION 'create_delivery_order: p_delivery_fee must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(btrim(coalesce(p_notes, ''))) > 300 THEN
    RAISE EXCEPTION 'create_delivery_order: p_notes accepts at most 300 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('prepaid', 'cash_on_delivery') THEN
    RAISE EXCEPTION 'create_delivery_order: p_payment_mode must be ''prepaid'' or ''cash_on_delivery'''
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_mode = 'cash_on_delivery' THEN
    IF p_cash_change_for IS NOT NULL AND p_cash_change_for < 0 THEN
      RAISE EXCEPTION 'create_delivery_order: p_cash_change_for must be a non-negative integer (or NULL)'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_cash_change_for IS NOT NULL THEN
      RAISE EXCEPTION 'create_delivery_order: p_cash_change_for must be NULL when p_payment_mode = ''prepaid'''
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Prepaid channel: an active payment method of the caller's restaurant,
  -- only on a prepaid order.
  IF p_prepaid_method_id IS NOT NULL THEN
    IF p_payment_mode <> 'prepaid' THEN
      RAISE EXCEPTION 'create_delivery_order: p_prepaid_method_id is only allowed when p_payment_mode = ''prepaid'''
        USING ERRCODE = '22023';
    END IF;

    SELECT pm.is_active INTO v_method_active
      FROM public.payment_methods pm
     WHERE pm.id = p_prepaid_method_id
       AND pm.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_delivery_order: payment method % not found', p_prepaid_method_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_method_active THEN
      RAISE EXCEPTION 'create_delivery_order: payment method % is not active', p_prepaid_method_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 3. Customer.
  IF (p_customer ? 'id') AND (p_customer ? 'phone') THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must carry either id or phone, not both'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_customer ? 'id') AND NOT (p_customer ? 'phone') THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must carry id or phone'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer ? 'id' THEN
    BEGIN
      v_customer_id := (p_customer ->> 'id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: p_customer.id is not a uuid'
        USING ERRCODE = '22023';
    END;

    SELECT c.id, c.name, c.phone
      INTO v_customer_id, v_customer_name, v_customer_phone
      FROM public.customers c
     WHERE c.id = v_customer_id
       AND c.restaurant_id = v_caller_tenant;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'create_delivery_order: customer % not found', (p_customer ->> 'id')
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- p_customer ? 'phone' (guaranteed by the xor above)
    v_customer_phone := btrim(coalesce(p_customer ->> 'phone', ''));
    IF v_customer_phone !~ '^[0-9]{7,15}$' THEN
      RAISE EXCEPTION 'create_delivery_order: p_customer.phone must match 7..15 digits'
        USING ERRCODE = '22023';
    END IF;

    SELECT c.id, c.name, c.phone
      INTO v_customer_id, v_customer_name, v_customer_phone
      FROM public.customers c
     WHERE c.phone = v_customer_phone
       AND c.restaurant_id = v_caller_tenant;

    IF v_customer_id IS NULL THEN
      -- New customer: name is required. Use the request's name, not its
      -- phone (the previous version of this block had a copy-paste that
      -- assigned the phone to the name variable).
      v_customer_name := btrim(coalesce(p_customer ->> 'name', ''));
      IF v_customer_name = '' OR length(v_customer_name) > 120 THEN
        RAISE EXCEPTION 'create_delivery_order: p_customer.name is required when creating a new customer (1..120 chars)'
          USING ERRCODE = '22023';
      END IF;

      -- v_customer_phone was overwritten by the zero-rows INTO above; re-set
      -- it from the request so the INSERT has the right value.
      v_customer_phone := btrim(p_customer ->> 'phone');

      INSERT INTO public.customers (restaurant_id, phone, name)
      VALUES (v_caller_tenant, v_customer_phone, v_customer_name)
      RETURNING id, name, phone
        INTO v_customer_id, v_customer_name, v_customer_phone;
    ELSE
      -- Existing customer: update name only when the request carries a
      -- different value (btrim-collapsed, length 1..120).
      DECLARE
        v_requested_name text := btrim(coalesce(p_customer ->> 'name', ''));
      BEGIN
        IF v_requested_name <> '' AND length(v_requested_name) <= 120
           AND v_requested_name IS DISTINCT FROM v_customer_name THEN
          UPDATE public.customers c
             SET name = v_requested_name
           WHERE c.id = v_customer_id;
          v_customer_name := v_requested_name;
        END IF;
      END;
    END IF;
  END IF;

  -- 4. Address.
  IF (p_address ? 'id') AND (p_address ? 'address_line') THEN
    RAISE EXCEPTION 'create_delivery_order: p_address must carry either id or address_line, not both'
      USING ERRCODE = '22023';
  END IF;

  IF p_address ? 'id' THEN
    BEGIN
      v_address_id := (p_address ->> 'id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.id is not a uuid'
        USING ERRCODE = '22023';
    END;

    SELECT a.id, a.customer_id, a.address_line, a.neighborhood, a.reference, a.label
      INTO v_address_id, v_addr_customer_id, v_address_line, v_address_neigh, v_address_ref, v_address_label
      FROM public.customer_addresses a
     WHERE a.id = v_address_id
       AND a.restaurant_id = v_caller_tenant;

    IF v_address_id IS NULL THEN
      RAISE EXCEPTION 'create_delivery_order: address % not found', (p_address ->> 'id')
        USING ERRCODE = 'P0002';
    END IF;

    -- The address must belong to the customer we resolved above. Without
    -- this check, the address's customer_id could silently overwrite
    -- v_customer_id and the order would be billed/snapshotted against the
    -- wrong customer.
    IF v_addr_customer_id IS DISTINCT FROM v_customer_id THEN
      RAISE EXCEPTION 'create_delivery_order: address % does not belong to the resolved customer',
        v_address_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_address_line := btrim(coalesce(p_address ->> 'address_line', ''));
    IF v_address_line = '' OR length(v_address_line) > 200 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.address_line is required (1..200 chars)'
        USING ERRCODE = '22023';
    END IF;
    v_address_neigh := NULLIF(btrim(coalesce(p_address ->> 'neighborhood', '')), '');
    v_address_ref   := NULLIF(btrim(coalesce(p_address ->> 'reference',    '')), '');
    v_address_label := NULLIF(btrim(coalesce(p_address ->> 'label',        '')), '');

    IF v_address_neigh IS NOT NULL AND length(v_address_neigh) > 80 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.neighborhood must be <= 80 chars'
        USING ERRCODE = '22023';
    END IF;
    IF v_address_ref IS NOT NULL AND length(v_address_ref) > 200 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.reference must be <= 200 chars'
        USING ERRCODE = '22023';
    END IF;
    IF v_address_label IS NOT NULL AND length(v_address_label) > 40 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.label must be <= 40 chars'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce((p_address ->> 'save')::boolean, false) THEN
      INSERT INTO public.customer_addresses (
        restaurant_id, customer_id, label, address_line, neighborhood, reference, is_default
      ) VALUES (
        v_caller_tenant, v_customer_id, v_address_label, v_address_line, v_address_neigh, v_address_ref, false
      )
      RETURNING id INTO v_address_id;
    END IF;
  END IF;

  -- 5. Items: collect distinct dish_ids, then resolve server-side.
  FOR v_line_no IN 1..v_items_count LOOP
    v_item := p_items -> (v_line_no - 1);

    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_item ? 'dish_id') THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] is missing dish_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_dish_id := (v_item ->> 'dish_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].dish_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_item ? 'quantity') THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] is missing quantity', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_dish_qty := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].quantity is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_dish_qty IS NULL OR v_dish_qty < 1 OR v_dish_qty > 999 THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].quantity must be between 1 and 999', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_dish_id = ANY (v_distinct_dishes)) THEN
      v_distinct_dishes := v_distinct_dishes || v_dish_id;
    END IF;
  END LOOP;

  -- Server-side price/name resolution: every distinct dish_id must resolve to
  -- a row of the caller's tenant. The SELECT goes against public.dishes (RLS
  -- is bypassed by SECURITY DEFINER + owner postgres, but the tenant filter
  -- is the same one the policies apply for an authenticated caller).
  IF EXISTS (
    SELECT 1
      FROM unnest(v_distinct_dishes) AS d(dish_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.dishes di
        WHERE di.id = d.dish_id
          AND di.restaurant_id = v_caller_tenant
     )
  ) THEN
    RAISE EXCEPTION 'create_delivery_order: one or more dish_id values do not resolve to a menu item of the caller tenant'
      USING ERRCODE = 'P0002';
  END IF;

  -- 6. Bill: subtotal / tax / total. tax_percentage comes from business_config.
  -- Server-side aggregation: per-dish quantity is the sum of all requested
  -- lines for that dish, then subtotal is sum(round(price * per_dish_qty)).
  -- Multiple lines for the same dish collapse into one row.
  SELECT coalesce(sum(round(di.price * coalesce(line_qty.q, 0))), 0)::bigint
    INTO v_subtotal
    FROM public.dishes di
    JOIN unnest(v_distinct_dishes) AS d(dish_id) ON d.dish_id = di.id
    JOIN LATERAL (
      SELECT sum((item ->> 'quantity')::integer) AS q
        FROM jsonb_array_elements(p_items) item
       WHERE (item ->> 'dish_id')::uuid = di.id
    ) AS line_qty ON true
   WHERE di.restaurant_id = v_caller_tenant;

  SELECT coalesce(nullif(bc.value, '')::numeric, 0)
    INTO v_tax_pct
    FROM public.business_config bc
   WHERE bc.restaurant_id = v_caller_tenant
     AND bc.key = 'tax_percentage'
   LIMIT 1;

  v_tax   := round((v_subtotal * coalesce(v_tax_pct, 0) / 100)::numeric)::bigint;
  v_total := v_subtotal + v_tax;

  -- 7. Order.
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id,
    order_type
  ) VALUES (
    v_caller_tenant, NULL, v_caller_profile, 'kitchen',
    v_subtotal, v_tax, coalesce(v_tax_pct, 0), 0, 0, v_total,
    0, false, NULL,
    'delivery'
  )
  RETURNING id INTO v_order_id;

  -- 8. order_items: one row per requested line, with name/price from the menu.
  FOR v_line_no IN 1..v_items_count LOOP
    v_item := p_items -> (v_line_no - 1);
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_dish_qty := (v_item ->> 'quantity')::integer;
    v_dish_comments := NULLIF(btrim(coalesce(v_item ->> 'comments', '')), '');

    INSERT INTO public.order_items (
      order_id, dish_id, name, price, quantity, comments,
      status, added_at, restaurant_id
    )
    SELECT v_order_id, di.id, di.name, di.price, v_dish_qty, v_dish_comments,
           'kitchen', v_now, v_caller_tenant
      FROM public.dishes di
     WHERE di.id = v_dish_id
       AND di.restaurant_id = v_caller_tenant;
  END LOOP;

  -- 9. order_deliveries (1:1 mirror).
  v_fee   := p_delivery_fee;
  v_change := CASE WHEN p_payment_mode = 'cash_on_delivery' THEN p_cash_change_for
                   ELSE NULL END;

  INSERT INTO public.order_deliveries (
    order_id, restaurant_id, customer_id,
    customer_name, customer_phone,
    address_line, neighborhood, address_reference,
    delivery_fee, payment_mode, cash_change_for,
    delivery_status, notes, prepaid_method_id
  ) VALUES (
    v_order_id, v_caller_tenant, v_customer_id,
    v_customer_name, v_customer_phone,
    v_address_line, v_address_neigh, v_address_ref,
    v_fee, p_payment_mode, v_change,
    'received', nullif(btrim(coalesce(p_notes, '')), ''), p_prepaid_method_id
  );

  RETURN jsonb_build_object(
    'order_id',    v_order_id,
    'customer_id', v_customer_id,
    'address_id',  v_address_id,
    'delivery', (
      SELECT to_jsonb(od)
        FROM public.order_deliveries od
       WHERE od.order_id = v_order_id
    )
  );
END;
$_$;
--> statement-breakpoint
COMMENT ON FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint, p_notes text, p_prepaid_method_id uuid) IS 'Atomic delivery-order intake. SECURITY DEFINER. Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-admin/delivery_operator). Resolves or creates the customer by normalized phone (or by id when given) within the tenant; updates the existing customer''s name only when the request carries a different value. Resolves the address (an existing id must belong to that customer, or a new address is saved to the registry only when save=true). Validates p_items (1..100 lines, quantity 1..999), p_delivery_fee (>= 0, set per order by the operator), p_payment_mode (prepaid | cash_on_delivery), p_cash_change_for (only for COD, >= 0), p_prepaid_method_id (optional, only for prepaid: an active payment method of the tenant; P0002 when unknown or foreign, 22023 when inactive). Resolves each dish_id server-side from public.dishes and takes name/price from the menu (the client never sets the price). Inserts the order (order_type=delivery, table_id NULL, status=kitchen, waiter_id = caller profile, tax_percentage from business_config, tax/tip/total computed server-side), the order_items, and the order_deliveries row (snapshot of customer/address, fee, payment_mode, prepaid_method_id, delivery_status=received). p_notes (trimmed, empty -> NULL, max 300) is stored on order_deliveries.notes. Returns jsonb with order_id, customer_id, address_id (NULL when save=false), and a delivery object with the order_deliveries row. P0002 for any cross-tenant customer/address/dish/method id; 22023 for bad input; 42501 for the wrong role.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint, p_notes text, p_prepaid_method_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint, p_notes text, p_prepaid_method_id uuid) TO vipe_api;
--> statement-breakpoint
DROP FUNCTION public.set_delivery_status(uuid, text, uuid, text);
--> statement-breakpoint
CREATE FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_courier_eta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_courier_location text DEFAULT NULL::text) RETURNS jsonb
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

  IF p_action = 'cancel' THEN
    -- Lock the order before looking for payments: pay_order holds this lock
    -- while it writes, so the check cannot pass and then lose to a payment
    -- committed in between (which would cancel a paid order).
    PERFORM 1 FROM public.orders o
      WHERE o.id = p_order_id
        AND o.restaurant_id = v_caller_tenant
        FOR UPDATE;

    -- Refuse to cancel an order that has a payment: refunds are out of scope.
    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id)
       OR EXISTS (SELECT 1 FROM public.orders o
                   WHERE o.id = p_order_id AND o.status = 'paid') THEN
      RAISE EXCEPTION 'set_delivery_status: order % already has a payment (refunds are out of scope)',
        p_order_id
        USING ERRCODE = 'P0001';
    END IF;
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
  ELSIF p_action = 'cancel' THEN
    -- The order row is already locked by the payment check above. pay_order
    -- locks the order FOR UPDATE and never the delivery row, so a concurrent
    -- cancel + pay_order pair cannot form a cycle.
    UPDATE public.order_deliveries od
       SET delivery_status = 'cancelled',
           cancelled_at    = v_now
     WHERE od.order_id = p_order_id;

    UPDATE public.orders o
       SET status      = 'cancelled',
           updated_at  = v_now
     WHERE o.id = p_order_id
       AND o.restaurant_id = v_caller_tenant;
  END IF;

  -- 7. Response.
  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id;

  RETURN to_jsonb(v_delivery);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid, p_reason text, p_courier_eta timestamp with time zone, p_courier_location text) IS 'Delivery lifecycle machine. SECURITY DEFINER. Locks the order_deliveries row FOR UPDATE; missing or foreign -> P0002. Action role matrix: start_preparing and mark_ready are open to kitchen / delivery_operator / admin; dispatch / deliver / fail / cancel are delivery_operator / admin only (else 42501). Transitions: start_preparing (received -> preparing), mark_ready (received|preparing -> ready), dispatch (ready|failed -> out_for_delivery; requires an ACTIVE courier of the tenant; clears failure_reason and returned_at on re-dispatch; stores p_courier_eta (after now, within 6 hours) and p_courier_location (trimmed, 1..60), NULL when not sent), deliver (out_for_delivery -> delivered), fail (out_for_delivery -> failed; reason 1..200), cancel (received|preparing|ready|failed -> cancelled; REJECT P0001 if a public.payments row already exists; also sets orders.status = cancelled). p_courier_eta / p_courier_location on any other action -> 22023. Same-state replays raise P0001 (no silent no-op). Returns the updated order_deliveries row as jsonb.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid, p_reason text, p_courier_eta timestamp with time zone, p_courier_location text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid, p_reason text, p_courier_eta timestamp with time zone, p_courier_location text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION public.return_courier(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant uuid := private.current_restaurant_id();
  v_caller_role   text := private.current_app_role();
  v_delivery      public.order_deliveries%ROWTYPE;
BEGIN
  IF v_caller_tenant IS NULL OR v_caller_role IS NULL
     OR v_caller_role NOT IN ('admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'return_courier: only admin or delivery_operator may record a courier return'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id
     AND od.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'return_courier: delivery for order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_delivery.delivery_status NOT IN ('delivered', 'failed') THEN
    RAISE EXCEPTION 'return_courier: delivery for order % is in state ''%'' (allowed: delivered, failed)',
      p_order_id, v_delivery.delivery_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_delivery.returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'return_courier: the courier of order % already returned', p_order_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.order_deliveries od
     SET returned_at = now()
   WHERE od.order_id = p_order_id
  RETURNING od.* INTO v_delivery;

  RETURN to_jsonb(v_delivery);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.return_courier(p_order_id uuid) IS 'Records the courier back at the restaurant (typed by the operator; no courier GPS). SECURITY DEFINER. admin / delivery_operator only (42501); the delivery of the caller''s tenant (P0002); delivered or failed only, and once (P0001). Sets order_deliveries.returned_at = now() (never before dispatched_at: CHECK) and returns the row as jsonb. A re-dispatch (set_delivery_status) clears it.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.return_courier(p_order_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.return_courier(p_order_id uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guard_courier_operator_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF private.current_app_role() = 'delivery_operator'
     AND (NEW.name IS DISTINCT FROM OLD.name
          OR NEW.phone IS DISTINCT FROM OLD.phone
          OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
          OR NEW.id IS DISTINCT FROM OLD.id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'couriers: a delivery operator may only change is_active'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_courier_operator_update() IS 'BEFORE UPDATE on public.couriers: a delivery_operator may only switch is_active (42501 for name, phone or any other column). Admins and sessions without an app role are not limited here (RLS still applies to vipe_api).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_courier_operator_update() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER couriers_operator_guard BEFORE UPDATE ON public.couriers FOR EACH ROW EXECUTE FUNCTION private.guard_courier_operator_update();
--> statement-breakpoint
ALTER POLICY couriers_insert_policy ON public.couriers WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
ALTER POLICY couriers_update_policy ON public.couriers USING (((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
COMMENT ON TABLE public.couriers IS 'Per-tenant courier registry. Read by admin / cashier / delivery_operator of the tenant; created by admin / delivery_operator; updated by admins, while a delivery_operator may only switch is_active (couriers_operator_guard). No DELETE policy: deactivate instead. Couriers do not use the app.';
