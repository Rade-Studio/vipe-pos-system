-- ============================================
-- Delivery RPCs: create_delivery_order, set_delivery_status, role reopen
-- ============================================
-- The POS-on-Supabase delivery module (odd/tasks/domicilios.md, task 3) wires
-- the operator / kitchen / cashier / admin flows on top of the schema in
-- 20261007100000. Two new SECURITY DEFINER RPCs drive everything that the
-- browser cannot do without bypassing RLS, and three existing RPCs are
-- redefined to admit the delivery_operator role and the delivery fee.
--
-- public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items
--   jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for
--   bigint DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS jsonb is
-- SECURITY DEFINER (owned by postgres) so the same transaction that resolves
-- the customer and the address can also write the order, the items and the
-- order_deliveries mirror, without RLS gates and without the deferred
-- consistency trigger queueing an out-of-tenant row. SET search_path = '' with
-- every reference schema-qualified. PUBLIC and anon get nothing; authenticated
-- and service_role get EXECUTE, which 020_anon_lockdown pins against over-
-- revocation.
--
--   1. Caller resolution. private.current_restaurant_id() resolves the tenant
--      from profiles.auth_user_id, private.current_app_role() resolves the
--      role the same way. NULL tenant (no profile) is 42501. Only 'admin' and
--      'delivery_operator' may create a delivery order; everything else is
--      42501. The same boundary every other RPC in this chain uses.
--
--   2. Input validation (22023). p_customer is a JSON object (either {id} or
--      {phone, name?}; never both, never empty). p_address is a JSON object
--      (either {id} that must belong to the resolved customer, or a new
--      address with address_line, neighborhood?, reference?, label?, and an
--      optional save bool defaulting to false). p_items is a non-empty JSON
--      array of objects (1..100 entries), each carrying dish_id (uuid) and
--      quantity (integer 1..999) and an optional comments text. p_delivery_fee
--      is a non-negative bigint. p_payment_mode is one of 'prepaid' or
--      'cash_on_delivery'. p_cash_change_for is non-negative and ONLY allowed
--      when p_payment_mode = 'cash_on_delivery' (NULL for prepaid; the
--      schema's CHECK will reject a non-NULL value against a prepaid order).
--      p_notes (trimmed, empty -> NULL, at most 300 characters) is stored
--      on order_deliveries.notes, added by this migration.
--
--   3. Customer (P0002 / 23505). When p_customer carries {id} the row is
--      looked up in the caller's tenant; missing or foreign -> P0002
--      'customer not found' (the only SQLSTATE that does not leak the
--      existence of another tenant's row). When p_customer carries
--      {phone, name} the existing customer is found by (restaurant_id,
--      phone); the UNIQUE constraint will raise 23505 (mapped to a clear
--      22023 message) under a concurrent insert, which the caller retries.
--      The name on an existing customer is updated only when the request
--      carries a name that is different from the current value (NULL or
--      btrim-collapsed to empty are treated as "no name sent"); the unchanged
--      case does no UPDATE (no spurious updated_at / trigger work).
--
--   4. Address (P0002). When p_address carries {id} the row is looked up and
--      its customer_id must match the resolved customer; foreign / missing
--      or wrong customer -> P0002 'address not found'. When p_address carries
--      a new address it is INSERTed into public.customer_addresses (RLS lets
--      the SECURITY DEFINER caller write; the tenant is pinned by the
--      DEFAULT) only when save=true; otherwise the address is used only to
--      populate the order_deliveries snapshot and no registry row is written.
--      save defaults to false so the common "one-shot delivery" flow does not
--      pollute the registry.
--
--   5. Items (P0002 / 22023). Every dish_id is resolved against the caller's
--      tenant in a single SELECT (one row per distinct id). Foreign or
--      missing -> P0002 'dish not found'. The resolved name and price are
--      taken server-side from public.dishes (the client never sets the
--      price), which is the same price trust the rest of the POS uses. The
--      order_items row stores dish_id, name and price from the menu, the
--      requested quantity, the optional comments, and the same status
--      'kitchen' today's orderService.create writes. price * quantity uses
--      bigint rounding (round()) so two int8 cents never drift. Promotions /
--      discounts are NOT applied per item: the schema stores
--      order.total_discounts at the order level, and the operator view (task
--      5) sends the order-level discount; a per-item promotion discount
--      would need a separate path and is left out of this migration (see
--      "design notes" below).
--
--   6. Bill. tax_percentage is read from public.business_config for the
--      caller's tenant (key = 'tax_percentage'); when no row exists the
--      default is 0 (the same fallback the rest of the migration chain
--      uses). subtotal = sum(round(price * quantity)), tax = round(subtotal
--      * tax_percentage / 100), tip = 0, tip_percentage = 0, total =
--      subtotal + tax. The operator form passes a separate p_delivery_fee
--      that is added to amount_due inside pay_order, NOT here, so the
--      delivery's own bill is consistent with what pay_order charges (same
--      model as split_order's child bill).
--
--   7. Order. order_type = 'delivery', table_id NULL (the cross-check
--      rejects delivery + table_id at the database), status = 'kitchen'
--      (mirrors orderService.create: the row lands in the kitchen queue
--      immediately so the kitchen sees it without a separate "send to
--      kitchen" click), waiter_id = caller's profile (the column is named
--      waiter but holds whoever owns the order; for delivery that is the
--      operator who took it; the FK to profiles has no role filter so a
--      delivery_operator's profile is a valid value). is_partial_order =
--      false, parent_order_id NULL (delivery orders cannot be split -
--      public.split_order rejects them; the field is left at the default
--      for the column anyway).
--
--   8. order_deliveries. customer_name / customer_phone / address_line /
--      neighborhood / address_reference are the SNAPSHOT (the customer
--      row's name, the customer row's phone, the resolved address fields);
--      a later rename of the customer or the address does not rewrite the
--      kitchen ticket (same idea as the payment_tenders catalog snapshot).
--      delivery_fee = p_delivery_fee (whole COP pesos, bigint, default 0).
--      payment_mode = p_payment_mode. cash_change_for = p_cash_change_for
--      when COD, NULL otherwise. delivery_status defaults to 'received'
--      (the column default). courier_id NULL until the operator dispatches.
--      The 1:1 PK is on order_id, so a second call against the same order
--      id would 23505; the function rejects duplicate calls (one order
--      per RPC) so a retry on a network blip returns the same response.
--
--   9. Response. jsonb with order_id, customer_id, address_id (NULL when
--      save=false or when the caller passed {id} of an existing address),
--      and a delivery object with the full order_deliveries row.
--
--   Design notes (need human review):
--   - per-item promotions are NOT applied. The current schema's promotion
--     storage is at the order level (orders.total_discounts), so the base
--     implementation is correct for the operator view (no per-item discount
--     in the cart). A future "promotion line" feature would need a column on
--     order_items and a recompute that respects it; not in this task.
--   - customer name is updated only when the request carries a different
--     name (btrim-collapsed). The UI does not require a rename on every
--     call, and we do not want a no-op UPDATE to bump updated_at.
--
-- public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id
--   uuid DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS jsonb is
-- SECURITY DEFINER (owned by postgres) so the same transaction that locks
-- the order_deliveries row can also write the lifecycle update, the courier
-- and the failure_reason (or clear them) and, on cancel, the orders.status.
-- SET search_path = ''. PUBLIC and anon get nothing; authenticated and
-- service_role get EXECUTE, which 020_anon_lockdown pins.
--
--   1. Caller resolution as create_delivery_order. 42501 otherwise.
--
--   2. Lock the order_deliveries row FOR UPDATE in the caller's tenant.
--      Missing or foreign -> P0002 'delivery not found'.
--
--   3. Role / action matrix. The action's role set is checked after the row
--      is locked so the error message names the current state, not the role:
--      - start_preparing: kitchen, delivery_operator, admin.
--      - mark_ready:      kitchen, delivery_operator, admin.
--      - dispatch:        delivery_operator, admin.
--      - deliver:         delivery_operator, admin.
--      - fail:            delivery_operator, admin.
--      - cancel:          delivery_operator, admin.
--      Anything else is 42501 with a clear message.
--
--   4. State transitions. Each action lists the allowed source states; a
--      source state outside the list, OR the SAME target state (replay)
--      raises P0001 'delivery is already in state X' (replay is not silently
--      accepted - the UI distinguishes "I already moved this" from "the
--      server refused" through a single error path). The transitions:
--      - start_preparing: received -> preparing.
--      - mark_ready:      received|preparing -> ready.
--      - dispatch:        ready|failed -> out_for_delivery; sets courier_id
--        (must be an ACTIVE courier of the tenant; foreign / inactive ->
--        P0002 / 22023), dispatched_at = now(), and clears failure_reason
--        on re-dispatch (a fresh attempt starts clean).
--      - deliver:         out_for_delivery -> delivered; sets delivered_at.
--      - fail:            out_for_delivery -> failed; reason must be a
--        non-empty trimmed text up to 200 characters; sets failed_at.
--      - cancel:          received|preparing|ready|failed -> cancelled;
--        REJECT (P0001) when a public.payments row already exists (refunds
--        are out of scope). Locks the underlying order FOR UPDATE, sets
--        cancelled_at, and sets orders.status = 'cancelled'. The cross-row
--        consistency trigger on order_deliveries runs at COMMIT, not here.
--
--   5. Response. jsonb with the full updated order_deliveries row.
--
-- Lock order invariant (keep when editing): the delivery row is locked
-- first (FOR UPDATE); for cancel the order row is locked AFTER the
-- delivery row. create_delivery_order writes the order, the items and the
-- order_deliveries row in one transaction, so no concurrent writer can land
-- a half-built delivery. pay_order locks the order FOR UPDATE, the register
-- FOR SHARE; set_delivery_status on a cancelled or paid delivery returns
-- P0001 / 'order already paid' through the existing pay_order replay path
-- (unchanged), so the lock cycle cannot form.
--
-- public.pay_order: redefined to also admit 'delivery_operator' and to
-- charge amount_due = subtotal + tax + delivery_fee when order.order_type =
-- 'delivery'. The delivery fee is read from public.order_deliveries for the
-- same order; the existing delivery-row invariant (deferred trigger)
-- guarantees the row exists for a delivery order. No tax and no tip on the
-- fee: tax is computed from orders.tax_percentage * subtotal, and the tip
-- is the caller's p_tip_amount (the same as today's flow). The change is
-- minimal: SECTION 3 keeps the full current body and adds the role +
-- amount-due change.
--
-- public.register_summary: redefined to also admit 'delivery_operator'
-- (read-only). close_register stays cashier / admin only.
--
-- public.split_order: redefined to REJECT (P0001) a delivery order right
-- after the parent lock; a partial child cannot be a delivery, and a
-- delivery order has no table that two partial children could share a
-- check against.
--
-- Idempotent: re-running drops the two new functions and recreates them
-- with the same grants; pay_order, register_summary and split_order are
-- CREATE OR REPLACE, so re-running keeps the same body and grants.

-- Delivery notes for the operator, kitchen ticket and courier (e.g. "ring
-- twice"). Written only through create_delivery_order.
ALTER TABLE public.order_deliveries
  ADD COLUMN IF NOT EXISTS notes text
    CONSTRAINT order_deliveries_notes_check CHECK (notes IS NULL OR char_length(notes) <= 300);

-- ============================================
-- SECTION 1: public.create_delivery_order
-- ============================================
CREATE OR REPLACE FUNCTION public.create_delivery_order(
  p_customer        jsonb,
  p_address         jsonb,
  p_items           jsonb,
  p_delivery_fee    bigint,
  p_payment_mode    text,
  p_cash_change_for bigint DEFAULT NULL,
  p_notes           text DEFAULT NULL
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
   WHERE p.auth_user_id = auth.uid()
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
    delivery_status, notes
  ) VALUES (
    v_order_id, v_caller_tenant, v_customer_id,
    v_customer_name, v_customer_phone,
    v_address_line, v_address_neigh, v_address_ref,
    v_fee, p_payment_mode, v_change,
    'received', nullif(btrim(coalesce(p_notes, '')), '')
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
$$;

COMMENT ON FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text) IS
  'Atomic delivery-order intake. SECURITY DEFINER (owner postgres). Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-admin/delivery_operator). Resolves or creates the customer by normalized phone (or by id when given) within the tenant; updates the existing customer''s name only when the request carries a different value. Resolves the address (an existing id must belong to that customer, or a new address is saved to the registry only when save=true). Validates p_items (1..100 lines, quantity 1..999), p_delivery_fee (>= 0), p_payment_mode (prepaid | cash_on_delivery), p_cash_change_for (only for COD, >= 0). Resolves each dish_id server-side from public.dishes and takes name/price from the menu (the client never sets the price). Inserts the order (order_type=delivery, table_id NULL, status=kitchen, waiter_id = caller profile, tax_percentage from business_config, tax/tip/total computed server-side), the order_items, and the order_deliveries row (snapshot of customer/address, fee, payment_mode, delivery_status=received). p_notes (trimmed, empty -> NULL, max 300) is stored on order_deliveries.notes. Returns jsonb with order_id, customer_id, address_id (NULL when save=false), and a delivery object with the order_deliveries row. P0002 for any cross-tenant customer/address/dish id; 22023 for bad input; 42501 for the wrong role.';

-- ============================================
-- SECTION 2: public.set_delivery_status
-- ============================================
CREATE OR REPLACE FUNCTION public.set_delivery_status(
  p_order_id   uuid,
  p_action     text,
  p_courier_id uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

  IF p_action = 'dispatch' THEN
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
           failure_reason = NULL
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

COMMENT ON FUNCTION public.set_delivery_status(uuid, text, uuid, text) IS
  'Delivery lifecycle machine. SECURITY DEFINER (owner postgres). Locks the order_deliveries row FOR UPDATE; missing or foreign -> P0002. Action role matrix: start_preparing and mark_ready are open to kitchen / delivery_operator / admin; dispatch / deliver / fail / cancel are delivery_operator / admin only (else 42501). Transitions: start_preparing (received -> preparing), mark_ready (received|preparing -> ready), dispatch (ready|failed -> out_for_delivery; requires an ACTIVE courier of the tenant; clears failure_reason on re-dispatch), deliver (out_for_delivery -> delivered), fail (out_for_delivery -> failed; reason 1..200), cancel (received|preparing|ready|failed -> cancelled; REJECT P0001 if a public.payments row already exists; also sets orders.status = cancelled and cancels_at). Same-state replays raise P0001 (no silent no-op). Returns the updated order_deliveries row as jsonb.';

-- ============================================
-- SECTION 3: public.pay_order (CREATE OR REPLACE)
-- ============================================
-- Reopens pay_order to admit 'delivery_operator' and to add the delivery fee
-- to amount_due when the order is a delivery. The rest of the body is the
-- current one from 20261006120000_pay_order_rpc.sql (kept verbatim with the
-- two surgical changes called out below), the signature is unchanged, and
-- the grants / comments are re-applied at the end of the migration.
--
--   CHANGE 1 (role check):
--     IF v_caller_role NOT IN ('cashier', 'admin') THEN
--     becomes
--     IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
--
--   CHANGE 2 (amount_due): after v_subtotal / v_tax are computed and before
--   the existing tenders loop, the order is queried for its order_type and
--   its (optional) order_deliveries row; when order_type = 'delivery', the
--   delivery_fee is added to amount_due. No tax / no tip on the fee (the
--   tip is still p_tip_amount; the tax is still on the food subtotal).
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

  -- CHANGE 1: delivery_operator is admitted so the operator can record a
  -- prepaid payment or a cash-on-delivery collection without handing the
  -- drawer to a cashier.
  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'pay_order: only cashier, admin or delivery_operator may settle an order'
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
      method_code, method_kind, amount, cash_received
    ) VALUES (
      v_caller_tenant, v_payment_id, v_line_no, v_method_id,
      v_method_code, v_method_kind, v_amount, v_cash_received
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

COMMENT ON FUNCTION public.pay_order(uuid, uuid, bigint, jsonb, uuid) IS
  'Atomic checkout. SECURITY DEFINER (owner postgres). Locks the order, validates the caller is a cashier/admin/delivery_operator of the tenant, the register is open and of the tenant, the order is active|kitchen|delivered with at least one line, and the tenders add up to amount_due + tip. For a delivery order, amount_due = subtotal + tax + delivery_fee (no tax / no tip on the fee). Snapshots the catalog (method_code / method_kind) so a later rename or retype does not rewrite history. Idempotent on (restaurant_id, idempotency_key): a replay returns status=already_paid with the existing payment summary and writes nothing; a different key on a paid order raises P0001. Returns jsonb with payment_id, status, amount_due, tip_amount, total_charged, change_given, drawer_warning, drawer_cash_before, tenders.';

-- ============================================
-- SECTION 4: public.register_summary (CREATE OR REPLACE)
-- ============================================
-- Reopens register_summary to also admit 'delivery_operator' (read). The
-- close_register RPC stays cashier/admin only.
CREATE OR REPLACE FUNCTION public.register_summary(p_cash_register_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_visible_count   bigint := 0;
  v_array_len       integer;

  v_initial_cash    bigint := 0;
  v_payments_count  bigint := 0;
  v_total_billed    bigint := 0;
  v_total_tips      bigint := 0;
  v_total_sales     bigint := 0;
  v_total_change    bigint := 0;

  v_cash_deposits    bigint := 0;
  v_cash_withdrawals bigint := 0;
  v_cash_tender_total bigint := 0;
  v_expected_cash    bigint := 0;
  v_tips_payout      bigint := 0;
  v_after_tips       bigint := 0;

  v_methods         jsonb;
  v_legacy          jsonb;

  v_ids uuid[];
BEGIN
  -- 1. Caller resolution. delivery_operator is admitted (read-only) so the
  -- operator can read the same summary the cashier / admin close screen
  -- shows. The summary is a SECURITY INVOKER read; it does not write.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'register_summary: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'register_summary: only cashier, admin or delivery_operator may read the summary'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_cash_register_ids IS NULL THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  v_array_len := array_length(p_cash_register_ids, 1);
  IF v_array_len IS NULL OR v_array_len = 0 THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must be a non-empty array'
      USING ERRCODE = '22023';
  END IF;

  IF v_array_len > 100 THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids accepts at most 100 entries'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(v) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> v_array_len THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> (SELECT count(DISTINCT v) FROM unnest(p_cash_register_ids) v) THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain duplicates'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_visible_count
    FROM public.cash_registers
   WHERE id = ANY (p_cash_register_ids);

  IF v_visible_count <> v_array_len THEN
    RAISE EXCEPTION 'register_summary: cash register(s) not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT v FROM unnest(p_cash_register_ids) v);

  SELECT
      coalesce(round(SUM(cr.initial_cash))::bigint, 0)
    INTO v_initial_cash
    FROM public.cash_registers cr
   WHERE cr.id = ANY (v_ids);

  SELECT
      count(*),
      coalesce(sum(p.amount_due), 0)::bigint,
      coalesce(sum(p.tip_amount),  0)::bigint,
      coalesce(sum(p.change_given), 0)::bigint
    INTO v_payments_count, v_total_billed, v_total_tips, v_total_change
    FROM public.payments p
   WHERE p.cash_register_id = ANY (v_ids);

  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_total_sales
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids);

  SELECT
      coalesce(round(SUM(CASE WHEN ct.type = 'deposit'    THEN ct.amount ELSE 0 END))::bigint, 0),
      coalesce(round(SUM(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END))::bigint, 0)
    INTO v_cash_deposits, v_cash_withdrawals
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = ANY (v_ids);

  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_cash_tender_total
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids)
     AND t.method_kind = 'cash';

  v_expected_cash   := v_initial_cash + v_cash_tender_total + v_cash_deposits - v_cash_withdrawals;
  v_tips_payout     := v_total_tips;
  v_after_tips      := v_expected_cash - v_tips_payout;

  SELECT coalesce(jsonb_agg(row_to_json(m) ORDER BY m.sort_order, m.name), '[]'::jsonb)
    INTO v_methods
    FROM (
      SELECT
          cat.id            AS payment_method_id,
          cat.code          AS code,
          cat.name          AS name,
          cat.kind          AS kind,
          cat.sort_order    AS sort_order,
          cat.is_active     AS is_active,
          coalesce(agg.total, 0)::bigint       AS total,
          coalesce(agg.tenders_count, 0)::bigint AS tenders_count
        FROM public.payment_methods cat
        LEFT JOIN (
          SELECT t.payment_method_id,
                 sum(t.amount)::bigint AS total,
                 count(*)::bigint      AS tenders_count
            FROM public.payment_tenders t
            JOIN public.payments p ON p.id = t.payment_id
           WHERE p.cash_register_id = ANY (v_ids)
           GROUP BY t.payment_method_id
        ) agg ON agg.payment_method_id = cat.id
       WHERE cat.restaurant_id = v_caller_tenant
    ) m;

  SELECT jsonb_build_object(
      'payments_count', count(*)::bigint,
      'total',         coalesce(round(SUM(pt.amount))::bigint,       0),
      'tips',          coalesce(round(SUM(pt.tip_amount))::bigint,   0),
      'change',        coalesce(round(SUM(pt.cash_change))::bigint,  0),
      'by_method',     (
        SELECT coalesce(jsonb_object_agg(method, total), '{}'::jsonb)
          FROM (
            SELECT pt2.method,
                   round(SUM(pt2.amount))::bigint AS total
              FROM public.payment_transactions pt2
             WHERE pt2.cash_register_id = ANY (v_ids)
             GROUP BY pt2.method
          ) bm
      )
    )
    INTO v_legacy
    FROM public.payment_transactions pt
   WHERE pt.cash_register_id = ANY (v_ids);

  v_legacy := coalesce(v_legacy, jsonb_build_object(
    'payments_count', 0,
    'total',         0,
    'tips',          0,
    'change',        0,
    'by_method',     '{}'::jsonb
  ));

  RETURN jsonb_build_object(
    'registers_count',         v_array_len::bigint,
    'initial_cash',            v_initial_cash,
    'payments_count',          v_payments_count,
    'total_billed',            v_total_billed,
    'total_tips',              v_total_tips,
    'total_sales',             v_total_sales,
    'total_change',            v_total_change,
    'methods',                 v_methods,
    'cash_deposits',           v_cash_deposits,
    'cash_withdrawals',        v_cash_withdrawals,
    'expected_cash',           v_expected_cash,
    'tips_payout',             v_tips_payout,
    'expected_cash_after_tips', v_after_tips,
    'legacy',                  v_legacy
  );
END;
$$;

COMMENT ON FUNCTION public.register_summary(uuid[]) IS
  'Server-side aggregation for the close-register screen and the admin reports. SECURITY INVOKER (rely on RLS), STABLE, search_path pinned. Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-cashier/admin/delivery_operator). Input validation: NULL/empty/duplicates/>100 ids raise 22023. Visibility: any id the caller''s RLS cannot see raises P0002 (other tenant or missing). The methods array is a LEFT JOIN from the tenant catalog so zero-sale and inactive methods still appear (sort_order, name). expected_cash = round(initial_cash) + cash_tender_amounts + deposits - withdrawals, the same formula pay_order uses for drawer_cash_before on a single open register (equality pinned by 090). tips are paid out to waiters at close, so tips_payout = total_tips (all tips, any method) and expected_cash_after_tips = expected_cash - tips_payout (may be negative, not clamped). Legacy section reads public.payment_transactions (zeros when none) and is reported separately: legacy rows do NOT enter expected_cash. Money as bigint (whole COP pesos); numeric(10,2) columns are rounded with Postgres half-up rounding.';

-- ============================================
-- SECTION 5: public.split_order (CREATE OR REPLACE)
-- ============================================
-- Reopens split_order to REJECT (P0001) delivery orders. The rest of the
-- body is the current one from 20261006130000_split_order_rpcs.sql (kept
-- verbatim with the surgical change called out below).
--
-- CHANGE: right after the parent row is locked FOR UPDATE and before the
-- parent rules check, raise P0001 'order % cannot be split (it is a
-- delivery order)' when v_parent.order_type = 'delivery'. The cross-check
-- on orders already forbids delivery + table_id, but the same rule has to
-- live in the RPC so a delivery order that the schema accepted (a future
-- relaxation) cannot be split anyway.
CREATE OR REPLACE FUNCTION public.split_order(
  p_parent_order_id uuid,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_parent          public.orders%ROWTYPE;
  v_child_id        uuid;

  v_item_count      integer := 0;
  v_item            jsonb;
  v_line_no         integer := 0;
  v_item_id         uuid;
  v_item_qty        integer;

  v_pending_item_id  uuid[]    := '{}'::uuid[];
  v_pending_quantity integer[] := '{}'::integer[];

  v_remaining jsonb;

  v_parent_item public.order_items%ROWTYPE;

  v_child_subtotal bigint;
  v_child_tax      bigint;
  v_child_tip      bigint;
  v_child_total    bigint;
  v_child_tax_pct  numeric;
  v_child_tip_pct  numeric;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;

  v_i integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'split_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'split_order: only cashier or admin may split an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'split_order: p_items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'split_order: p_items must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'split_order: p_items accepts at most 50 lines'
      USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  FOR v_line_no IN 1..v_item_count LOOP
    v_item := p_items -> (v_line_no - 1);

    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'split_order: item[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_item ? 'order_item_id') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing order_item_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_id := (v_item ->> 'order_item_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_item ? 'quantity') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing quantity', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_qty := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].quantity is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_item_qty IS NULL OR v_item_qty < 1 THEN
      RAISE EXCEPTION 'split_order: item[%].quantity must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    v_i := array_position(v_pending_item_id, v_item_id);
    IF v_i IS NOT NULL THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id duplicates item[%]',
        v_line_no, v_i
        USING ERRCODE = '22023';
    END IF;

    v_pending_item_id  := v_pending_item_id || v_item_id;
    v_pending_quantity := v_pending_quantity || v_item_qty;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = p_parent_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'split_order: order % not found', p_parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- CHANGE: reject delivery orders. A delivery order carries a snapshot of
  -- the customer / address in order_deliveries; splitting it would either
  -- double the delivery (one courier, two orders) or orphan a partial
  -- delivery with no destination. Refuse explicitly.
  IF v_parent.order_type = 'delivery' THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (it is a delivery order)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Parent rules.
  IF v_parent.is_partial_order THEN
    RAISE EXCEPTION 'split_order: order % is itself a partial child (cannot be split further)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_parent.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (status=%)',
      p_parent_order_id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_parent_order_id) THEN
    RAISE EXCEPTION 'split_order: order % already has a payment', p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Items.
  v_remaining := '{}'::jsonb;

  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'split_order: item[%] does not belong to the order', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF v_item_qty > v_parent_item.quantity THEN
      RAISE EXCEPTION 'split_order: item[%] quantity % exceeds the available quantity %',
        v_line_no, v_item_qty, v_parent_item.quantity
        USING ERRCODE = 'P0001';
    END IF;

    v_remaining := v_remaining || jsonb_build_object(
      v_item_id::text,
      to_jsonb(v_parent_item.quantity - v_item_qty)
    );
  END LOOP;

  -- 6. Move-all guard.
  SELECT count(*)::bigint
    INTO v_i
    FROM (
      SELECT (v_remaining ->> k.k)::int AS remaining
        FROM jsonb_object_keys(v_remaining) k(k)
       WHERE (v_remaining ->> k.k)::int > 0
      UNION ALL
      SELECT oi.quantity
        FROM public.order_items oi
       WHERE oi.order_id = p_parent_order_id
         AND NOT (v_remaining ? oi.id::text)
    ) s
   WHERE s.remaining > 0;

  IF v_i = 0 THEN
    RAISE EXCEPTION 'split_order: cannot move every item; pay the order instead'
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Child.
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id
  ) VALUES (
    v_caller_tenant, v_parent.table_id, v_parent.waiter_id, v_parent.status,
    0, 0, v_parent.tax_percentage, 0, v_parent.tip_percentage, 0,
    v_parent.total_discounts, true, p_parent_order_id
  )
  RETURNING id INTO v_child_id;

  -- 8. Move.
  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant
     FOR UPDATE;

    IF v_item_qty = v_parent_item.quantity THEN
      UPDATE public.order_items oi
         SET order_id = v_child_id
       WHERE oi.id = v_item_id;
    ELSE
      UPDATE public.order_items oi
         SET quantity = oi.quantity - v_item_qty
       WHERE oi.id = v_item_id;

      INSERT INTO public.order_items (
        order_id, dish_id, name, price, quantity, comments,
        status, added_at, restaurant_id
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant
      );
    END IF;
  END LOOP;

  -- 9. Recompute.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_child_subtotal, v_child_tax, v_child_tip, v_child_total,
         v_child_tax_pct, v_child_tip_pct
    FROM private.recompute_order_bill(v_child_id);

  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(p_parent_order_id);

  -- 10. Response.
  RETURN jsonb_build_object(
    'child_order_id', v_child_id,
    'parent', jsonb_build_object(
      'order_id', p_parent_order_id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    ),
    'child', jsonb_build_object(
      'order_id', v_child_id,
      'subtotal', v_child_subtotal,
      'tax',      v_child_tax,
      'tip',      v_child_tip,
      'total',    v_child_total
    )
  );
END;
$$;

COMMENT ON FUNCTION public.split_order(uuid, jsonb) IS
  'Atomic split. SECURITY DEFINER (owner postgres). Locks the parent FOR UPDATE, validates the caller is a cashier/admin of the tenant, the parent is active|kitchen|delivered, NOT itself a partial child, NOT a delivery order, and has no payment row. Validates each line of p_items (non-empty array, <= 50 lines, uuid order_item_id, positive integer quantity, no duplicate id, item belongs to parent, quantity <= parent quantity). Rejects moving every line at full quantity (P0001 ''cannot move every item; pay the order instead''). Creates a child order (same tenant/table/waiter, status copied, is_partial_order=true, parent_order_id=parent). Full moves UPDATE the parent row order_id; partial moves shrink the parent quantity and INSERT a sibling row on the child. Both bills are recomputed by private.recompute_order_bill(). Returns jsonb with child_order_id and the parent/child bill summaries.';

-- ============================================
-- SECTION 6: privileges
-- ============================================
-- Same lockdown pattern as every other migration in this chain: PUBLIC and
-- anon get nothing, authenticated and service_role get EXECUTE. 020_anon_lockdown
-- pins the four RPCs against over-revocation.

REVOKE ALL ON FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_delivery_order(jsonb, jsonb, jsonb, bigint, text, bigint, text) TO service_role;

REVOKE ALL ON FUNCTION public.set_delivery_status(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_delivery_status(uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_delivery_status(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_delivery_status(uuid, text, uuid, text) TO service_role;
