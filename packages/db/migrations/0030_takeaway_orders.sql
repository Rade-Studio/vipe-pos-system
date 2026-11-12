-- "Para llevar" orders (odd/tasks/promociones-mejoras.md M5, S8, L3, L5, L7).
--
-- 1. orders.order_type gains 'takeaway': an order paid at the counter like a
--    dine_in one, with no table (orders_order_type_table_id_check already
--    keeps table_id NULL for every type but dine_in) and no courier.
-- 2. The customer lives on orders (customer_name, customer_phone), not in a
--    side table: delivery needs order_deliveries for its address, fee,
--    courier and status, takeaway only needs who picks it up, and on orders
--    every reader (list, realtime row, split child) gets it for free.
--    customer_name is required on a takeaway order and refused on the other
--    types; it is stored trimmed, 2..60 characters. customer_phone is
--    optional, takeaway only, 7..15 digits like order_deliveries.
--    RLS and grants are those of orders (table-level, no column grants).
-- 3. pay_order, recompute_order_bill, void_order_items, cancel_order and
--    undo_split only branch on order_type = 'delivery', so a takeaway order
--    behaves as dine_in there without a change. split_order inserted its
--    child with the default order_type (dine_in): it is redefined (the 0028
--    body) so the child keeps the parent's order_type and customer.
ALTER TABLE public.orders
    ADD COLUMN customer_name text,
    ADD COLUMN customer_phone text;
--> statement-breakpoint
ALTER TABLE public.orders DROP CONSTRAINT orders_order_type_check;
--> statement-breakpoint
ALTER TABLE public.orders
    ADD CONSTRAINT orders_order_type_check CHECK (order_type = ANY (ARRAY['dine_in'::text, 'takeaway'::text, 'delivery'::text])),
    ADD CONSTRAINT orders_customer_name_check CHECK (
      customer_name IS NULL OR (customer_name = btrim(customer_name) AND char_length(customer_name) BETWEEN 2 AND 60)),
    ADD CONSTRAINT orders_customer_phone_check CHECK (customer_phone IS NULL OR customer_phone ~ '^[0-9]{7,15}$'),
    ADD CONSTRAINT orders_takeaway_customer_check CHECK (
      CASE WHEN order_type = 'takeaway' THEN customer_name IS NOT NULL
           ELSE customer_name IS NULL AND customer_phone IS NULL END);
--> statement-breakpoint
COMMENT ON COLUMN public.orders.order_type IS '''dine_in'' (default; the original model), ''takeaway'' (para llevar, 0030: no table, customer_name required) or ''delivery'' (order_deliveries). Only dine_in may have a table_id (CHECK).';
--> statement-breakpoint
COMMENT ON COLUMN public.orders.customer_name IS 'Takeaway only (required there): who picks the order up, trimmed, 2..60 characters.';
--> statement-breakpoint
COMMENT ON COLUMN public.orders.customer_phone IS 'Takeaway only, optional: 7..15 digits (same rule as order_deliveries.customer_phone).';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.split_order(p_parent_order_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
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
  v_new_item_id     uuid;

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
  v_combo_id uuid;
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

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_parent_order_id AND p.voided_at IS NULL) THEN
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

  -- 0028: a combo moves whole: every standing line of its combo, all units.
  FOR v_line_no IN 1..v_item_count LOOP
    SELECT oi.combo_id INTO v_combo_id
      FROM public.order_items oi
     WHERE oi.id = v_pending_item_id[v_line_no];

    IF v_combo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.order_items ci
       WHERE ci.order_id = p_parent_order_id
         AND ci.combo_id = v_combo_id
         AND ci.status IS DISTINCT FROM 'cancelled'
         AND coalesce(v_pending_quantity[array_position(v_pending_item_id, ci.id)], 0) <> ci.quantity) THEN
      RAISE EXCEPTION 'split_order: item[%] is part of a combo; move every line of the combo together', v_line_no
        USING ERRCODE = 'P0001';
    END IF;
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

  -- 7. Child (0030: it keeps the parent's order_type and takeaway customer).
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id,
    order_type, customer_name, customer_phone
  ) VALUES (
    v_caller_tenant, v_parent.table_id, v_parent.waiter_id, v_parent.status,
    0, 0, v_parent.tax_percentage, 0, v_parent.tip_percentage, 0,
    0, true, p_parent_order_id,
    v_parent.order_type, v_parent.customer_name, v_parent.customer_phone
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

      -- 0028: the line's discounts go with it.
      UPDATE public.order_discounts d
         SET order_id = v_child_id
       WHERE d.order_item_id = v_item_id;
    ELSE
      UPDATE public.order_items oi
         SET quantity = oi.quantity - v_item_qty
       WHERE oi.id = v_item_id;

      INSERT INTO public.order_items (
        order_id, dish_id, name, price, quantity, comments,
        status, added_at, restaurant_id, stock_consumed_at,
        promotion_id, promotion_snapshot, combo_id
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant, v_parent_item.stock_consumed_at,
        v_parent_item.promotion_id, v_parent_item.promotion_snapshot, v_parent_item.combo_id
      )
      RETURNING id INTO v_new_item_id;

      -- F7: the new line keeps the options of the line it came from.
      INSERT INTO public.order_item_modifiers (
        restaurant_id, order_item_id, group_id, group_name, option_id, option_name,
        price, ingredient_id, ingredient_qty, sort_order
      )
      SELECT m.restaurant_id, v_new_item_id, m.group_id, m.group_name, m.option_id, m.option_name,
             m.price, m.ingredient_id, m.ingredient_qty, m.sort_order
        FROM public.order_item_modifiers m
       WHERE m.order_item_id = v_item_id;

      -- 0028: the line's item discounts are shared by units, allocated per
      -- line: the new line's running share over the rows (by created_at, id)
      -- is round(running amount * moved / quantity), clamped so neither side
      -- ever holds more than its own value round(price * quantity); each row
      -- takes the step of that running share, the line keeps the rest, and
      -- a row left at 0 is dropped.
      WITH r AS (
        SELECT d.id,
               row_number() OVER w AS rn,
               sum(d.amount) OVER w AS run,
               round(sum(d.amount) OVER w * v_item_qty / v_parent_item.quantity) AS naive
          FROM public.order_discounts d
         WHERE d.order_item_id = v_item_id
        WINDOW w AS (ORDER BY d.created_at, d.id)
      ), c AS (
        SELECT r.id, r.rn,
               LEAST(GREATEST(r.naive, r.run - round(v_parent_item.price * (v_parent_item.quantity - v_item_qty))),
                     round(v_parent_item.price * v_item_qty), r.run) AS cum
          FROM r
      ), s AS (
        SELECT c.id, c.cum - coalesce(lag(c.cum) OVER (ORDER BY c.rn), 0) AS share
          FROM c
      ), moved AS (
        INSERT INTO public.order_discounts (
          restaurant_id, order_id, order_item_id, promotion_id, kind, source, label,
          amount, combo_id, reason, created_by, authorized_by, requires_authorization, line_quantity, created_at
        )
        SELECT d.restaurant_id, v_child_id, v_new_item_id, d.promotion_id, d.kind, d.source, d.label,
               s.share, d.combo_id, d.reason, d.created_by, d.authorized_by, d.requires_authorization,
               CASE WHEN d.line_quantity IS NOT NULL THEN v_item_qty END, d.created_at
          FROM public.order_discounts d
          JOIN s ON s.id = d.id
         WHERE s.share > 0
      )
      -- line_quantity follows the units each side keeps, so the shares are not rescaled again.
      UPDATE public.order_discounts d
         SET amount = d.amount - s.share,
             line_quantity = CASE WHEN d.line_quantity IS NOT NULL THEN v_parent_item.quantity - v_item_qty END
        FROM s
       WHERE d.id = s.id;

      DELETE FROM public.order_discounts d
       WHERE d.order_item_id = v_item_id
         AND d.amount <= 0;
    END IF;
  END LOOP;

  -- 0028: combo rows go with their lines (a combo moves whole, see 5).
  UPDATE public.order_discounts d
     SET order_id = v_child_id
   WHERE d.order_id = p_parent_order_id
     AND d.kind = 'combo'
     AND d.combo_id IN (SELECT oi.combo_id FROM public.order_items oi
                         WHERE oi.order_id = v_child_id AND oi.combo_id IS NOT NULL);

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
