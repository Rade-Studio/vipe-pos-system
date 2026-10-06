-- ============================================
-- split_order / undo_split RPCs
-- ============================================
-- The legacy client implementation (lib/supabase/service.ts: createPartialOrder
-- ~688-812, deletePartialOrder ~813-912) assembled partial orders by hand
-- from the browser: an unprotected insert on public.orders, a follow-up
-- insert on public.order_items, a per-item UPDATE or DELETE to drain the
-- parent, and finally a recompute of the parent's subtotal/tax/tip/total
-- written from the browser. That client-side composition let two clicks land
-- two children at once, let a partial child be a child again, and trusted the
-- stored subtotal/tax/total to be in sync with the line items. 080_split_order
-- pins the replacement contract on this migration's two RPCs.
--
-- public.split_order(p_parent_order_id uuid, p_items jsonb) RETURNS jsonb is
-- SECURITY DEFINER (owned by postgres) so the same transaction that locks the
-- parent FOR UPDATE can also write the child order, move the line items and
-- recompute both bills. SET search_path = '' with every reference schema-
-- qualified. PUBLIC and anon get nothing; authenticated and service_role get
-- EXECUTE, which 020_anon_lockdown pins against over-revocation.
--
-- The contract:
--
--   1. Caller resolution. private.current_restaurant_id() resolves the tenant
--     from profiles.auth_user_id, and private.current_app_role() resolves the
--     role the same way. NULL tenant (no profile) is 42501 - the JWT alone
--     cannot narrow access. Only 'cashier' and 'admin' may split; everything
--     else is 42501.
--
--   2. Input validation (22023). p_items is a non-empty JSON array of objects,
--     at most 50 lines, each carrying order_item_id (uuid) and quantity
--     (integer >= 1). Duplicate order_item_id raises 22023 too. A bad shape
--     raises invalid_parameter_value with a clear message; nothing is
--     written. Empty / non-array / NULL have their own messages.
--
--   3. Order. The parent is locked FOR UPDATE and resolved in the caller's
--     tenant. An order that belongs to another tenant, or does not exist at
--     all, raises P0002 'order not found' - the only SQLSTATE that does not
--     leak the existence of another tenant's row.
--
--   4. Parent rules (P0001). status must be one of active|kitchen|delivered;
--     is_partial_order must be false (a partial child cannot be split further
--     - the cashier should undo or pay it); a payment row may not already
--     exist (UNIQUE (order_id) on public.payments covers this check).
--
--   5. Items (P0001). Every order_item_id must belong to the parent;
--     quantity must be <= parent item.quantity. A foreign item raises
--     'item[N] does not belong to the order'; over-quantity raises
--     'item[N] quantity N exceeds the available quantity M'.
--
--   6. Move-all guard (P0001). If every line is being moved at its full
--     quantity (i.e. the parent would end with zero items), raise
--     'cannot move every item; pay the order instead'. The cashier should
--     settle the order directly.
--
--   7. Child. New row in public.orders: same restaurant_id, table_id,
--     waiter_id, status = parent.status (pinned, not advanced),
--     tax_percentage/tip_percentage copied from the parent, subtotal/tax/tip/
--     total computed by private.recompute_order_bill() on the post-move
--     items, is_partial_order = true, parent_order_id = parent.
--
--   8. Move. For each item: full move -> UPDATE order_items SET order_id =
--     child (the row keeps its id; status / added_at / comments unchanged);
--     partial move -> UPDATE parent row quantity -= moved_quantity, then INSERT
--     a new row on the child with the moved quantity and the same dish_id,
--     name, price, comments, status, added_at.
--
--   9. Recompute. private.recompute_order_bill() runs over the post-move
--     items of both orders and writes subtotal/tax/tip/total/updated_at. It
--     matches pay_order's amount_due formula (subtotal + tax).
--
--  10. Response. jsonb {child_order_id, parent:{order_id, subtotal, tax, tip,
--     total}, child:{order_id, subtotal, tax, tip, total}}.
--
-- public.undo_split(p_child_order_id uuid) RETURNS jsonb is the inverse.
--
--   1. Caller resolution as split_order. 42501 otherwise.
--
--   2. Resolve the child in the caller's tenant, read its parent_order_id,
--     then lock the parent FOR UPDATE first (parent before child to avoid
--     deadlocks with split_order running concurrently), then the child FOR
--     UPDATE. P0002 if either order is missing or another tenant.
--
--   3. Child rules (P0001). is_partial_order must be true; parent_order_id
--     must not be NULL; no payment row on the child; status not in
--     paid/cancelled. The same rules apply to the parent: no payment row,
--     status not in paid/cancelled. The P0002 boundary fires for cross-tenant
--     rejections.
--
--   4. Merge. For each child item, if the parent already has a line with the
--     same dish_id, price, comments (NULL-safe via IS NOT DISTINCT FROM) and
--     status, UPDATE parent quantity += child quantity and DELETE the child
--     row; else UPDATE child row order_id back to the parent.
--
--   5. Cleanup. DELETE the child order row. Recompute the parent's bill.
--
--   6. Response. jsonb {parent:{order_id, subtotal, tax, tip, total}}.
--
-- private.recompute_order_bill(p_order_id uuid) RETURNS TABLE(...) is the
-- private bill recompute helper. SECURITY DEFINER (owner postgres) so it
-- reads order_items regardless of RLS; SET search_path = ''; nothing
-- granted to PUBLIC/anon/authenticated/service_role. It is not exposed to
-- PostgREST.

-- ============================================
-- SECTION 1: private recompute helper
-- ============================================
CREATE OR REPLACE FUNCTION private.recompute_order_bill(p_order_id uuid)
RETURNS TABLE (
  subtotal      numeric,
  tax           numeric,
  tip           numeric,
  total         numeric,
  tax_percentage numeric,
  tip_percentage numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subtotal  bigint := 0;
  v_tax_pct   numeric := 0;
  v_tip_pct   numeric := 0;
  v_tax       bigint := 0;
  v_tip       bigint := 0;
  v_total     bigint := 0;
BEGIN
  SELECT coalesce(sum(round(oi.price * oi.quantity)), 0)::bigint
    INTO v_subtotal
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id;

  SELECT coalesce(o.tax_percentage, 0), coalesce(o.tip_percentage, 0)
    INTO v_tax_pct, v_tip_pct
    FROM public.orders o
   WHERE o.id = p_order_id;

  v_tax   := round((v_subtotal * v_tax_pct / 100)::numeric)::bigint;
  v_tip   := round((v_subtotal * v_tip_pct / 100)::numeric)::bigint;
  v_total := v_subtotal + v_tax + v_tip;

  UPDATE public.orders o
     SET subtotal = v_subtotal,
         tax      = v_tax,
         tip      = v_tip,
         total    = v_total,
         updated_at = now()
   WHERE o.id = p_order_id;

  RETURN QUERY SELECT v_subtotal::numeric, v_tax::numeric, v_tip::numeric,
                      v_total::numeric, v_tax_pct, v_tip_pct;
END;
$$;

COMMENT ON FUNCTION private.recompute_order_bill(uuid) IS
  'Private bill recompute helper used by split_order and undo_split. SECURITY DEFINER (owner postgres). Reads order_items regardless of RLS, writes the new subtotal/tax/tip/total/updated_at on the order. Tip is suggested from tip_percentage (same as pay_order). Not exposed to PostgREST.';

REVOKE ALL ON FUNCTION private.recompute_order_bill(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.recompute_order_bill(uuid) FROM anon;
REVOKE ALL ON FUNCTION private.recompute_order_bill(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION private.recompute_order_bill(uuid) FROM service_role;

-- ============================================
-- SECTION 2: split_order
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

  -- parallel arrays for the validated moves: parent row id, target quantity
  -- (positive). One entry per requested move.
  v_pending_item_id  uuid[]    := '{}'::uuid[];
  v_pending_quantity integer[] := '{}'::integer[];

  -- per-parent-row remaining quantity after the move. Keyed by parent row id
  -- so the move-all guard can decide whether anything stays behind.
  v_remaining jsonb;

  -- working copies of parent item fields, fetched lazily per id.
  v_parent_item public.order_items%ROWTYPE;

  -- child bill recompute values.
  v_child_subtotal bigint;
  v_child_tax      bigint;
  v_child_tip      bigint;
  v_child_total    bigint;
  v_child_tax_pct  numeric;
  v_child_tip_pct  numeric;

  -- parent bill recompute values.
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

    -- Duplicate detection against the validated prefix. array_position (not a
    -- FOR over array_length) because array_length of an empty array is NULL.
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

  -- 5. Items: existence and over-quantity check; populate v_remaining for the
  -- move-all guard.
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

    -- Track remaining on the parent per row id.
    v_remaining := v_remaining || jsonb_build_object(
      v_item_id::text,
      to_jsonb(v_parent_item.quantity - v_item_qty)
    );
  END LOOP;

  -- 6. Move-all guard: sum of remaining quantities over the parent's items.
  -- We do NOT add untouched items here because they are also moved off the
  -- parent only if every touched row goes to 0 and there is no untouched
  -- row left; we instead compute the absolute count of items the parent
  -- would still hold (positive quantity) after the move.
  SELECT count(*)::bigint
    INTO v_i
    FROM (
      -- items touched in this call: remaining quantity is in v_remaining.
      SELECT (v_remaining ->> k.k)::int AS remaining
        FROM jsonb_object_keys(v_remaining) k(k)
       WHERE (v_remaining ->> k.k)::int > 0
      UNION ALL
      -- items NOT touched in this call: their full quantity stays on the parent.
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
      -- Full move: transfer the row by changing order_id and restaurant_id
      -- (the child lives in the same tenant, so restaurant_id does not move;
      -- this is the parity move used by the legacy client).
      UPDATE public.order_items oi
         SET order_id = v_child_id
       WHERE oi.id = v_item_id;
    ELSE
      -- Partial move: shrink the parent and insert a sibling row on the child.
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

  -- 9. Recompute both bills.
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
  'Atomic split. SECURITY DEFINER (owner postgres). Locks the parent FOR UPDATE, validates the caller is a cashier/admin of the tenant, the parent is active|kitchen|delivered, NOT itself a partial child, and has no payment row. Validates each line of p_items (non-empty array, <= 50 lines, uuid order_item_id, positive integer quantity, no duplicate id, item belongs to parent, quantity <= parent quantity). Rejects moving every line at full quantity (P0001 ''cannot move every item; pay the order instead''). Creates a child order (same tenant/table/waiter, status copied, is_partial_order=true, parent_order_id=parent). Full moves UPDATE the parent row order_id; partial moves shrink the parent quantity and INSERT a sibling row on the child. Both bills are recomputed by private.recompute_order_bill(). Returns jsonb with child_order_id and the parent/child bill summaries.';

-- ============================================
-- SECTION 3: undo_split
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
  'Atomic undo of a split. SECURITY DEFINER (owner postgres). Locks the parent FOR UPDATE first (parent-before-child to avoid deadlocks), then the child FOR UPDATE, validates the caller is a cashier/admin of the tenant, the child is a partial order with no payment and not paid/cancelled, and the parent has no payment and not paid/cancelled. P0002 if either order is missing or another tenant. Merges each child item back: when the parent already has a line with the same dish_id, price, comments (NULL-safe) and status, the quantities are summed and the child row deleted; otherwise the child row order_id is UPDATEd back to the parent. The child order is DELETEd and the parent bill is recomputed by private.recompute_order_bill(). Returns jsonb with the parent bill summary.';

-- ============================================
-- SECTION 4: privileges
-- ============================================
REVOKE ALL ON FUNCTION public.split_order(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.split_order(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.split_order(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_order(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.undo_split(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_split(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_split(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_split(uuid) TO service_role;