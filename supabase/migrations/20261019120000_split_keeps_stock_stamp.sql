-- split_order and undo_split keep the sale-consumption stamp.
--
-- odd/tasks/admin-dashboard-inventario.md, T12 follow-up (S5: every sale is
-- deducted exactly once). consume_order_stock (20261019110000) skips
-- order_items rows whose stock_consumed_at is set
-- (20261019100000_inventory_logistics.sql).
--
-- split_order: body copied verbatim from 20261007110000_delivery_rpcs.sql.
-- CHANGE: the partial-move INSERT copies v_parent_item.stock_consumed_at
-- (v_parent_item is already selected with oi.*). Without it the new child
-- row was unstamped and a consumed line was deducted twice.
--
-- undo_split: body copied verbatim from 20261006130000_split_order_rpcs.sql.
-- CHANGE: a child row only merges into a parent row with the same stamp
-- state (both NULL or both NOT NULL); otherwise it is moved back as its own
-- row. Merging a stamped child into an unstamped parent deducted it twice,
-- and merging an unstamped child into a stamped parent never deducted it.
-- Pinned by supabase/tests/140_split_stock_stamp.test.sql.

-- ============================================
-- SECTION 1: public.split_order (CREATE OR REPLACE)
-- ============================================
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
        status, added_at, restaurant_id, stock_consumed_at
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant, v_parent_item.stock_consumed_at
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
  'Atomic split. SECURITY DEFINER (owner postgres). Locks the parent FOR UPDATE, validates the caller is a cashier/admin of the tenant, the parent is active|kitchen|delivered, NOT itself a partial child, NOT a delivery order, and has no payment row. Validates each line of p_items (non-empty array, <= 50 lines, uuid order_item_id, positive integer quantity, no duplicate id, item belongs to parent, quantity <= parent quantity). Rejects moving every line at full quantity (P0001 ''cannot move every item; pay the order instead''). Creates a child order (same tenant/table/waiter, status copied, is_partial_order=true, parent_order_id=parent). Full moves UPDATE the parent row order_id; partial moves shrink the parent quantity and INSERT a sibling row on the child. Both bills are recomputed by private.recompute_order_bill(). Returns jsonb with child_order_id and the parent/child bill summaries. A partial move copies the parent row stock_consumed_at to the child row, so consume_order_stock deducts every sold unit exactly once.';

-- ============================================
-- SECTION 2: public.undo_split (CREATE OR REPLACE)
-- ============================================
CREATE OR REPLACE FUNCTION public.undo_split(p_child_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_child           public.orders%ROWTYPE;
  v_parent          public.orders%ROWTYPE;
  v_child_item      public.order_items%ROWTYPE;
  v_match           public.order_items%ROWTYPE;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'undo_split: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'undo_split: only cashier or admin may undo a split'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Read the child first (without lock) to learn its parent id; the
  -- tenant boundary and the partial-flag check both fire on this read. The
  -- lock is acquired later (parent first, then child) to avoid deadlocks with
  -- split_order running concurrently on the same parent.
  SELECT o.* INTO v_child
    FROM public.orders o
   WHERE o.id = p_child_order_id
     AND o.restaurant_id = v_caller_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'undo_split: order % not found', p_child_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Child rules.
  IF NOT v_child.is_partial_order OR v_child.parent_order_id IS NULL THEN
    RAISE EXCEPTION 'undo_split: order % is not a partial order', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_child.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: child order % has status=% (cannot undo)',
      p_child_order_id, v_child.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_child_order_id) THEN
    RAISE EXCEPTION 'undo_split: child order % already has a payment', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock the parent now that we know it is non-NULL.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = v_child.parent_order_id
     AND o.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'undo_split: parent order % not found', v_child.parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the child now (parent already locked).
  PERFORM 1 FROM public.orders o
    WHERE o.id = p_child_order_id
      AND o.restaurant_id = v_caller_tenant
      FOR UPDATE;

  -- Parent rules.
  IF v_parent.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: parent order % has status=% (cannot undo)',
      v_parent.id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = v_parent.id) THEN
    RAISE EXCEPTION 'undo_split: parent order % already has a payment', v_parent.id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Merge each child item back to the parent.
  FOR v_child_item IN
    SELECT oi.*
      FROM public.order_items oi
     WHERE oi.order_id = p_child_order_id
     ORDER BY oi.id
     FOR UPDATE
  LOOP
    -- Match against a parent row with the same dish_id, price, comments
    -- (NULL-safe) and status. The cheapest way to express the NULL-safety is
    -- IS NOT DISTINCT FROM.
    SELECT oi.* INTO v_match
      FROM public.order_items oi
     WHERE oi.order_id = v_parent.id
       AND oi.dish_id IS NOT DISTINCT FROM v_child_item.dish_id
       AND oi.price   IS NOT DISTINCT FROM v_child_item.price
       AND oi.comments IS NOT DISTINCT FROM v_child_item.comments
       AND oi.status  IS NOT DISTINCT FROM v_child_item.status
       AND (oi.stock_consumed_at IS NULL) = (v_child_item.stock_consumed_at IS NULL)
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.order_items oi
         SET quantity = oi.quantity + v_child_item.quantity
       WHERE oi.id = v_match.id;

      DELETE FROM public.order_items WHERE id = v_child_item.id;
    ELSE
      UPDATE public.order_items oi
         SET order_id = v_parent.id
       WHERE oi.id = v_child_item.id;
    END IF;
  END LOOP;

  -- 5. Cleanup.
  DELETE FROM public.orders WHERE id = p_child_order_id;

  -- 6. Recompute parent.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(v_parent.id);

  RETURN jsonb_build_object(
    'parent', jsonb_build_object(
      'order_id', v_parent.id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    )
  );
END;
$$;

COMMENT ON FUNCTION public.undo_split(uuid) IS
  'Atomic undo of a split. SECURITY DEFINER (owner postgres). Locks the parent FOR UPDATE first (parent-before-child to avoid deadlocks), then the child FOR UPDATE, validates the caller is a cashier/admin of the tenant, the child is a partial order with no payment and not paid/cancelled, and the parent has no payment and not paid/cancelled. P0002 if either order is missing or another tenant. Merges each child item back: when the parent already has a line with the same dish_id, price, comments (NULL-safe) and status, the quantities are summed and the child row deleted; otherwise the child row order_id is UPDATEd back to the parent. The child order is DELETEd and the parent bill is recomputed by private.recompute_order_bill(). Returns jsonb with the parent bill summary. Rows merge only when both have the same stock_consumed_at state (both NULL or both stamped); otherwise the child row is moved back as its own line so consume_order_stock deducts every sold unit exactly once.';

-- ============================================
-- SECTION 3: privileges (same as 20261006130000_split_order_rpcs.sql)
-- ============================================
REVOKE ALL ON FUNCTION public.split_order(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.split_order(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.split_order(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_order(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.undo_split(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_split(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_split(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_split(uuid) TO service_role;
