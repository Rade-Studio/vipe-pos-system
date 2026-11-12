-- Counts with an assigned counter and an approving admin (odd/tasks/inventario-rediseno.md T5, S5).
--
-- 1. Statuses: draft -> counting -> review -> applied, draft | counting |
--    review -> cancelled. The old 'open' is backfilled as 'counting' (the API
--    keeps reporting it as status 'open' next to the new stage).
-- 2. inventory_counts.counter_id is who counts (any active profile of the
--    restaurant, admin or not) and approver_id the approving admin, never the
--    same person. A count without a counter is the admin flow from before:
--    open_inventory_count still opens it as counting and the admin applies it.
-- 3. Blind counting: RLS on both tables stays admin only, so a non-admin never
--    reads expected_quantity. The counter works through the SECURITY DEFINER
--    *_my_inventory_count* functions, which return no expected quantity, cost
--    nor difference, and only for counts assigned to the caller.
-- 4. submit_inventory_count (counter or admin, every line counted) moves
--    counting -> review; request_inventory_count_recount (admin) sends the
--    marked lines back (recount = true, only those are writable) -> counting.
-- 5. apply_inventory_count: from review (or counting when there is no
--    counter), only an admin who is not the counter, and from review every
--    line whose |counted - expected| * cost reaches
--    private.inventory_count_reason_threshold() needs a reason (line notes).
--
-- Errors: P0001 rule (Spanish message), P0002 unknown or not assigned count,
-- 22023 bad input, 42501 role.
ALTER TABLE public.inventory_counts DROP CONSTRAINT inventory_counts_status_check;
--> statement-breakpoint
UPDATE public.inventory_counts SET status = 'counting' WHERE status = 'open';
--> statement-breakpoint
ALTER TABLE public.inventory_counts
    ALTER COLUMN status SET DEFAULT 'counting',
    ADD COLUMN counter_id uuid,
    ADD COLUMN approver_id uuid,
    ADD COLUMN submitted_at timestamp with time zone,
    ADD COLUMN applied_by uuid,
    ADD CONSTRAINT inventory_counts_status_check CHECK (status = ANY (ARRAY['draft'::text, 'counting'::text, 'review'::text, 'applied'::text, 'cancelled'::text])),
    ADD CONSTRAINT inventory_counts_counter_id_fkey FOREIGN KEY (counter_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD CONSTRAINT inventory_counts_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD CONSTRAINT inventory_counts_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD CONSTRAINT inventory_counts_people_check CHECK (counter_id IS NULL OR approver_id IS NULL OR counter_id <> approver_id),
    ADD CONSTRAINT inventory_counts_submitted_check CHECK ((status = 'review'::text) <= (submitted_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE public.inventory_count_lines
    ADD COLUMN recount boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT inventory_count_lines_notes_check CHECK (notes IS NULL OR length(notes) <= 500);
--> statement-breakpoint
CREATE INDEX idx_inventory_counts_counter_id ON public.inventory_counts USING btree (counter_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_counts_approver_id ON public.inventory_counts USING btree (approver_id);
--> statement-breakpoint
COMMENT ON TABLE public.inventory_counts IS 'Physical counts per location, numbered per restaurant. draft -> counting -> review -> applied; draft | counting | review -> cancelled. counter_id counts (any active profile), approver_id is the approving admin (different person). Admin read only; the counter works through the *_my_inventory_count* functions. Admin may edit notes or cancel directly.';
--> statement-breakpoint
COMMENT ON TABLE public.inventory_count_lines IS 'Count lines: expected_quantity is the location balance snapshot when counting starts; counted_quantity (NULL = not counted); notes is the reason of a difference; recount marks the lines sent back for recount (only those are writable while any is marked).';
--> statement-breakpoint
-- The one place of the reason threshold: a line whose |counted - expected| * cost reaches it needs a reason to apply.
CREATE FUNCTION private.inventory_count_reason_threshold() RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ SELECT 50000::numeric $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.inventory_documents_before_write() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_rpc     boolean := current_user IN ('postgres', 'vipe_migrator');
  v_status  text;
  v_rid     uuid;
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT v_rpc AND NEW.status NOT IN ('draft', 'ordered') THEN
        RAISE EXCEPTION 'purchase orders start as draft or ordered' USING ERRCODE = 'P0001';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.number <> OLD.number THEN
        RAISE EXCEPTION 'purchase order numbers are immutable' USING ERRCODE = 'P0001';
      END IF;
      IF NOT v_rpc AND NEW.status IS DISTINCT FROM OLD.status
         AND NOT (OLD.status = 'draft' AND NEW.status IN ('ordered', 'cancelled'))
         AND NOT (OLD.status = 'ordered' AND NEW.status IN ('draft', 'cancelled')) THEN
        RAISE EXCEPTION 'purchase order cannot move from % to % (receipts go through receive_purchase_order)',
          OLD.status, NEW.status USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status = 'ordered' AND OLD.status <> 'ordered' AND NEW.ordered_at IS NULL THEN
        NEW.ordered_at := now();
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF NOT v_rpc AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft purchase orders can be deleted' USING ERRCODE = 'P0001';
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = NEW.supplier_id AND s.restaurant_id = NEW.restaurant_id)
         OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = NEW.location_id AND l.restaurant_id = NEW.restaurant_id) THEN
        RAISE EXCEPTION 'supplier and location must belong to the purchase order restaurant' USING ERRCODE = 'P0002';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'purchase_order_lines' THEN
    SELECT po.status, po.restaurant_id INTO v_status, v_rid
      FROM public.purchase_orders po
     WHERE po.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;

    IF NOT v_rpc AND v_status NOT IN ('draft', 'ordered') THEN
      RAISE EXCEPTION 'purchase order lines can only change while the order is draft or ordered'
        USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF NOT v_rpc AND NEW.received_quantity IS DISTINCT FROM
       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.received_quantity ELSE 0 END) THEN
      RAISE EXCEPTION 'received_quantity is written by receive_purchase_order only' USING ERRCODE = '42501';
    END IF;
    -- The line always follows its order's tenant; RLS WITH CHECK then refuses
    -- a line that points at another tenant's order.
    NEW.restaurant_id := COALESCE(v_rid, NEW.restaurant_id);
    IF NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = NEW.ingredient_id AND i.restaurant_id = NEW.restaurant_id) THEN
      RAISE EXCEPTION 'ingredient % not found', NEW.ingredient_id USING ERRCODE = 'P0002';
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'inventory_counts' THEN
    IF TG_OP = 'UPDATE' AND NOT v_rpc THEN
      IF OLD.status NOT IN ('draft', 'counting', 'review') THEN
        RAISE EXCEPTION 'count % is %', OLD.number, OLD.status USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'counts are applied through apply_inventory_count' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.number <> OLD.number
         OR NEW.location_id <> OLD.location_id OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
         OR NEW.counter_id IS DISTINCT FROM OLD.counter_id OR NEW.approver_id IS DISTINCT FROM OLD.approver_id
         OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.applied_by IS DISTINCT FROM OLD.applied_by THEN
        RAISE EXCEPTION 'counts are applied through apply_inventory_count' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'inventory_count_lines' THEN
    IF NOT v_rpc THEN
      SELECT c.status INTO v_status FROM public.inventory_counts c WHERE c.id = OLD.count_id;
      IF v_status NOT IN ('counting', 'review') THEN
        RAISE EXCEPTION 'count lines can only change while the count is open' USING ERRCODE = 'P0001';
      END IF;
      IF v_status = 'review' AND NEW.counted_quantity IS DISTINCT FROM OLD.counted_quantity THEN
        RAISE EXCEPTION 'En revisión lo contado no cambia: pide un recuento' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.count_id <> OLD.count_id OR NEW.ingredient_id <> OLD.ingredient_id
         OR NEW.expected_quantity <> OLD.expected_quantity OR NEW.restaurant_id <> OLD.restaurant_id
         OR NEW.recount IS DISTINCT FROM OLD.recount THEN
        RAISE EXCEPTION 'only counted_quantity and notes are editable' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.inventory_documents_before_write() IS 'SECURITY INVOKER BEFORE trigger for purchase_orders, purchase_order_lines, inventory_counts and inventory_count_lines. Direct (non-RPC, i.e. current_user not postgres/vipe_migrator) writes: purchase orders only draft <-> ordered -> cancelled, received/partially_received only via receive_purchase_order (P0001); received_quantity only via the RPC (42501); counts only draft | counting | review -> cancelled, every other move via the count RPCs (P0001), people and dates never (42501); count lines only counted_quantity (counting) and notes (counting, review) (42501 / P0001). Keeps lines in their parent tenant.';
--> statement-breakpoint
-- Caller of a count function: any active profile (admin or not).
CREATE FUNCTION private.inventory_count_caller(p_fn text, OUT profile_id uuid, OUT restaurant_id uuid, OUT app_role text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  SELECT p.id, p.restaurant_id, p.role INTO profile_id, restaurant_id, app_role
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id() AND p.active
   LIMIT 1;
  IF profile_id IS NULL THEN
    RAISE EXCEPTION '%: the caller has no active profile', p_fn USING ERRCODE = '42501';
  END IF;
END;
$$;
--> statement-breakpoint
-- The count row, locked; P0002 when missing, of another tenant or (p_counter_id set) not assigned to that profile.
CREATE FUNCTION private.inventory_count_lock(p_fn text, p_restaurant_id uuid, p_count_id uuid, p_counter_id uuid DEFAULT NULL) RETURNS public.inventory_counts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count public.inventory_counts%ROWTYPE;
BEGIN
  SELECT * INTO v_count FROM public.inventory_counts c
   WHERE c.id = p_count_id AND c.restaurant_id = p_restaurant_id
     AND (p_counter_id IS NULL OR (c.counter_id = p_counter_id AND c.status IN ('counting', 'review', 'applied')))
   FOR UPDATE;
  IF v_count.id IS NULL THEN
    RAISE EXCEPTION '%: count % not found', p_fn, p_count_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
-- What the counter may see of a count: no expected quantity, cost nor difference.
CREATE FUNCTION private.inventory_count_blind(p_count public.inventory_counts) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'id', p_count.id, 'number', p_count.number, 'location_id', p_count.location_id,
    'location_name', (SELECT l.name FROM public.inventory_locations l WHERE l.id = p_count.location_id),
    'status', p_count.status, 'notes', p_count.notes, 'created_at', p_count.created_at, 'submitted_at', p_count.submitted_at,
    'lines_count', (SELECT count(*) FROM public.inventory_count_lines cl WHERE cl.count_id = p_count.id),
    'counted_lines', (SELECT count(*) FROM public.inventory_count_lines cl WHERE cl.count_id = p_count.id AND cl.counted_quantity IS NOT NULL),
    'recount_lines', (SELECT count(*) FROM public.inventory_count_lines cl WHERE cl.count_id = p_count.id AND cl.recount))
$$;
--> statement-breakpoint
CREATE FUNCTION private.inventory_count_blind_line(p_line_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object('id', cl.id, 'ingredient_id', cl.ingredient_id, 'item_name', i.name, 'sku', i.sku, 'unit', i.unit,
                            'counted_quantity', cl.counted_quantity, 'recount', cl.recount)
    FROM public.inventory_count_lines cl JOIN public.ingredients i ON i.id = cl.ingredient_id
   WHERE cl.id = p_line_id
$$;
--> statement-breakpoint
-- Opens a count with a counter and an approver as a draft (the expected stock is taken again on start).
CREATE FUNCTION public.prepare_inventory_count(p_location_id uuid, p_ingredient_ids uuid[], p_counter_id uuid, p_approver_id uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'prepare_inventory_count';
  v_caller record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  IF p_counter_id IS NULL OR p_approver_id IS NULL THEN
    RAISE EXCEPTION '%: a counter and an approver are required', c_fn USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_counter_id AND p.restaurant_id = v_caller.restaurant_id AND p.active) THEN
    RAISE EXCEPTION 'Quien cuenta debe ser una persona activa del restaurante' USING ERRCODE = 'P0001';
  END IF;
  IF p_counter_id = p_approver_id THEN
    RAISE EXCEPTION 'Quien aprueba debe ser una persona distinta de quien cuenta' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_approver_id AND p.restaurant_id = v_caller.restaurant_id
                    AND p.active AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Quien aprueba debe ser un administrador activo del restaurante' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.open_inventory_count(p_location_id, p_ingredient_ids, p_notes);
  UPDATE public.inventory_counts
     SET status = 'draft', counter_id = p_counter_id, approver_id = p_approver_id
   WHERE id = (v_result->>'count_id')::uuid;
  RETURN v_result || jsonb_build_object('status', 'draft');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.start_inventory_count(p_count_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'start_inventory_count';
  v_caller record;
  v_count  public.inventory_counts%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_count := private.inventory_count_lock(c_fn, v_caller.restaurant_id, p_count_id);
  IF v_count.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se puede iniciar un conteo en borrador' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.inventory_count_lines cl
     SET expected_quantity = COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l
                                        WHERE l.ingredient_id = cl.ingredient_id AND l.location_id = v_count.location_id), 0)
   WHERE cl.count_id = v_count.id;
  UPDATE public.inventory_counts SET status = 'counting' WHERE id = v_count.id;
  RETURN jsonb_build_object('count_id', v_count.id, 'status', 'counting');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.submit_inventory_count(p_count_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'submit_inventory_count';
  v_caller  record;
  v_count   public.inventory_counts%ROWTYPE;
  v_missing integer;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_count_caller(c_fn);
  v_count := private.inventory_count_lock(c_fn, v_caller.restaurant_id, p_count_id,
                                          CASE WHEN v_caller.app_role = 'admin' THEN NULL ELSE v_caller.profile_id END);
  IF v_count.status <> 'counting' THEN
    RAISE EXCEPTION 'Solo se envía a revisión un conteo en conteo' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_missing FROM public.inventory_count_lines cl WHERE cl.count_id = v_count.id AND cl.counted_quantity IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Falta contar % artículo(s)', v_missing USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.inventory_count_lines SET recount = false WHERE count_id = v_count.id AND recount;
  UPDATE public.inventory_counts SET status = 'review', submitted_at = now() WHERE id = v_count.id
  RETURNING * INTO v_count;
  RETURN jsonb_build_object('count_id', v_count.id, 'status', 'review', 'count', private.inventory_count_blind(v_count));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.request_inventory_count_recount(p_count_id uuid, p_line_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'request_inventory_count_recount';
  v_caller record;
  v_count  public.inventory_counts%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_count := private.inventory_count_lock(c_fn, v_caller.restaurant_id, p_count_id);
  IF v_count.status <> 'review' THEN
    RAISE EXCEPTION 'Solo se pide un recuento de un conteo en revisión' USING ERRCODE = 'P0001';
  END IF;
  IF p_line_ids IS NULL OR cardinality(p_line_ids) = 0
     OR EXISTS (SELECT 1 FROM unnest(p_line_ids) x(id)
                 WHERE NOT EXISTS (SELECT 1 FROM public.inventory_count_lines cl WHERE cl.id = x.id AND cl.count_id = v_count.id)) THEN
    RAISE EXCEPTION '%: p_line_ids must be lines of the count', c_fn USING ERRCODE = '22023';
  END IF;
  UPDATE public.inventory_count_lines SET recount = (id = ANY (p_line_ids)) WHERE count_id = v_count.id;
  UPDATE public.inventory_counts SET status = 'counting', submitted_at = NULL WHERE id = v_count.id;
  RETURN jsonb_build_object('count_id', v_count.id, 'status', 'counting',
                            'recount_lines', (SELECT count(DISTINCT x.id) FROM unnest(p_line_ids) x(id)));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.list_my_inventory_counts() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_count_caller('list_my_inventory_counts');
  RETURN COALESCE((
    SELECT jsonb_agg(private.inventory_count_blind(c) ORDER BY c.number DESC)
      FROM public.inventory_counts c
     WHERE c.restaurant_id = v_caller.restaurant_id AND c.counter_id = v_caller.profile_id
       AND c.status IN ('counting', 'review', 'applied')), '[]'::jsonb);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.get_my_inventory_count(p_count_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'get_my_inventory_count';
  v_caller record;
  v_count  public.inventory_counts%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_count_caller(c_fn);
  SELECT * INTO v_count FROM public.inventory_counts c
   WHERE c.id = p_count_id AND c.restaurant_id = v_caller.restaurant_id AND c.counter_id = v_caller.profile_id
     AND c.status IN ('counting', 'review', 'applied');
  IF v_count.id IS NULL THEN
    RAISE EXCEPTION '%: count % not found', c_fn, p_count_id USING ERRCODE = 'P0002';
  END IF;
  RETURN private.inventory_count_blind(v_count) || jsonb_build_object('lines', COALESCE((
    SELECT jsonb_agg(private.inventory_count_blind_line(cl.id)) FROM public.inventory_count_lines cl WHERE cl.count_id = v_count.id), '[]'::jsonb));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.count_my_inventory_line(p_count_id uuid, p_line_id uuid, p_counted_quantity numeric) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'count_my_inventory_line';
  v_caller record;
  v_count  public.inventory_counts%ROWTYPE;
  v_line   public.inventory_count_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_count_caller(c_fn);
  v_count := private.inventory_count_lock(c_fn, v_caller.restaurant_id, p_count_id, v_caller.profile_id);
  SELECT * INTO v_line FROM public.inventory_count_lines cl WHERE cl.id = p_line_id AND cl.count_id = v_count.id FOR UPDATE;
  IF v_line.id IS NULL THEN
    RAISE EXCEPTION '%: line % not found', c_fn, p_line_id USING ERRCODE = 'P0002';
  END IF;
  IF p_counted_quantity < 0 THEN
    RAISE EXCEPTION '%: p_counted_quantity must be zero or positive', c_fn USING ERRCODE = '22023';
  END IF;
  IF v_count.status <> 'counting' THEN
    RAISE EXCEPTION 'El conteo ya no está en conteo' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_line.recount AND EXISTS (SELECT 1 FROM public.inventory_count_lines cl WHERE cl.count_id = v_count.id AND cl.recount) THEN
    RAISE EXCEPTION 'Solo se recuentan los artículos marcados' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.inventory_count_lines SET counted_quantity = p_counted_quantity WHERE id = v_line.id;
  RETURN private.inventory_count_blind_line(v_line.id);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'apply_inventory_count';
  v_caller   record;
  v_count    public.inventory_counts%ROWTYPE;
  v_line     record;
  v_current  numeric;
  v_diff     numeric;
  v_cost     numeric;
  v_missing  text;
  v_adjusted integer := 0;
  v_delta    numeric := 0;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  SELECT * INTO v_count FROM public.inventory_counts c
   WHERE c.id = p_count_id AND c.restaurant_id = v_caller.restaurant_id
   FOR UPDATE;
  IF v_count.id IS NULL THEN
    RAISE EXCEPTION '%: count % not found', c_fn, p_count_id USING ERRCODE = 'P0002';
  END IF;
  IF v_count.status = 'counting' AND v_count.counter_id IS NOT NULL THEN
    RAISE EXCEPTION 'Envía el conteo a revisión antes de aplicarlo' USING ERRCODE = 'P0001';
  END IF;
  IF v_count.status NOT IN ('counting', 'review') THEN
    RAISE EXCEPTION '%: count % is %', c_fn, v_count.number, v_count.status USING ERRCODE = 'P0001';
  END IF;
  IF v_count.counter_id = v_caller.profile_id THEN
    RAISE EXCEPTION 'Quien contó no puede aprobar su propio conteo' USING ERRCODE = 'P0001';
  END IF;
  IF v_count.status = 'review' THEN
    SELECT string_agg(i.name, ', ' ORDER BY i.name) INTO v_missing
      FROM public.inventory_count_lines cl JOIN public.ingredients i ON i.id = cl.ingredient_id
     WHERE cl.count_id = v_count.id AND cl.counted_quantity IS NOT NULL
       AND abs((cl.counted_quantity - cl.expected_quantity) * COALESCE(i.cost, 0)) >= private.inventory_count_reason_threshold()
       AND NULLIF(btrim(cl.notes), '') IS NULL;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'Indica el motivo de las diferencias de $ % o más: %',
        replace(to_char(private.inventory_count_reason_threshold(), 'FM999,999,999,990'), ',', '.'), v_missing
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOR v_line IN
    SELECT cl.ingredient_id, cl.counted_quantity, i.cost
      FROM public.inventory_count_lines cl
      JOIN public.ingredients i ON i.id = cl.ingredient_id
     WHERE cl.count_id = v_count.id AND cl.counted_quantity IS NOT NULL
     ORDER BY cl.ingredient_id
     FOR UPDATE OF i
  LOOP
    SELECT COALESCE(sum(l.quantity), 0) INTO v_current
      FROM public.inventory_lots l
     WHERE l.ingredient_id = v_line.ingredient_id AND l.location_id = v_count.location_id;
    v_diff := v_line.counted_quantity - v_current;
    CONTINUE WHEN v_diff = 0;

    IF v_diff > 0 THEN
      v_cost := COALESCE(v_line.cost, 0);
      PERFORM private.inventory_put(v_caller.restaurant_id, v_line.ingredient_id, v_count.location_id, v_diff,
                                    v_cost, NULL, NULL, now(), 'count_adjustment',
                                    'inventory_count', v_count.id, v_caller.profile_id, NULL, NULL);
      v_delta := v_delta + v_diff * v_cost;
    ELSE
      v_delta := v_delta - (private.inventory_take(v_caller.restaurant_id, v_line.ingredient_id, v_count.location_id,
                                                   -v_diff, 'count_adjustment', 'inventory_count', v_count.id,
                                                   v_caller.profile_id, false, NULL, NULL)->>'total_cost')::numeric;
    END IF;
    PERFORM private.inventory_sync_stock(v_line.ingredient_id);
    v_adjusted := v_adjusted + 1;
  END LOOP;

  UPDATE public.inventory_counts SET status = 'applied', applied_at = now(), applied_by = v_caller.profile_id WHERE id = v_count.id;

  RETURN jsonb_build_object(
    'count_id', v_count.id,
    'status', 'applied',
    'adjusted_lines', v_adjusted,
    'value_delta', round(v_delta, 4)
  );
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.inventory_count_reason_threshold() IS 'COP threshold of a valued count difference (|counted - expected| * ingredients.cost) that needs a reason before apply_inventory_count applies a reviewed count.';
--> statement-breakpoint
COMMENT ON FUNCTION public.prepare_inventory_count(p_location_id uuid, p_ingredient_ids uuid[], p_counter_id uuid, p_approver_id uuid, p_notes text) IS 'open_inventory_count as a draft with a counter (active profile of the tenant) and an approver (active admin, a different person; P0001 in Spanish). Returns {count_id, number, location_id, status, lines_count}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.start_inventory_count(p_count_id uuid) IS 'draft -> counting (admin): takes the expected quantities again from the location balance. Returns {count_id, status}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.submit_inventory_count(p_count_id uuid) IS 'counting -> review by the assigned counter or an admin, every line counted (P0001 otherwise); clears the recount marks. Returns {count_id, status, count} (count without expected stock).';
--> statement-breakpoint
COMMENT ON FUNCTION public.request_inventory_count_recount(p_count_id uuid, p_line_ids uuid[]) IS 'review -> counting (admin): marks exactly p_line_ids for recount; only those lines are writable by the counter until the next submit. Returns {count_id, status, recount_lines}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.list_my_inventory_counts() IS 'Counts assigned to the caller (counting, review, applied), newest first, without expected stock, cost or difference.';
--> statement-breakpoint
COMMENT ON FUNCTION public.get_my_inventory_count(p_count_id uuid) IS 'One count assigned to the caller with its lines {id, ingredient_id, item_name, sku, unit, counted_quantity, recount}; never expected stock, cost or difference. P0002 when not assigned.';
--> statement-breakpoint
COMMENT ON FUNCTION public.count_my_inventory_line(p_count_id uuid, p_line_id uuid, p_counted_quantity numeric) IS 'The assigned counter sets counted_quantity (NULL clears) while counting; during a recount only the marked lines. Returns the blind line.';
--> statement-breakpoint
COMMENT ON FUNCTION public.apply_inventory_count(p_count_id uuid) IS 'Applies a reviewed count, or a counting one without counter (admin who is not the counter, P0001 in Spanish otherwise): reviewed lines valued at private.inventory_count_reason_threshold() or more need a reason. For every line with counted_quantity, writes count_adjustment movements so the location balance equals counted_quantity (surplus to the general lot at ingredients.cost, deficit FEFO). Lines left NULL are skipped. Returns {count_id, status, adjusted_lines, value_delta}.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_count_reason_threshold() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.inventory_count_reason_threshold() TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_count_caller(p_fn text, OUT profile_id uuid, OUT restaurant_id uuid, OUT app_role text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_count_lock(p_fn text, p_restaurant_id uuid, p_count_id uuid, p_counter_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_count_blind(p_count public.inventory_counts) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_count_blind_line(p_line_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prepare_inventory_count(p_location_id uuid, p_ingredient_ids uuid[], p_counter_id uuid, p_approver_id uuid, p_notes text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.prepare_inventory_count(p_location_id uuid, p_ingredient_ids uuid[], p_counter_id uuid, p_approver_id uuid, p_notes text) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.start_inventory_count(p_count_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.start_inventory_count(p_count_id uuid) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_inventory_count(p_count_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_inventory_count(p_count_id uuid) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.request_inventory_count_recount(p_count_id uuid, p_line_ids uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.request_inventory_count_recount(p_count_id uuid, p_line_ids uuid[]) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_my_inventory_counts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_my_inventory_counts() TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_my_inventory_count(p_count_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_my_inventory_count(p_count_id uuid) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.count_my_inventory_line(p_count_id uuid, p_line_id uuid, p_counted_quantity numeric) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.count_my_inventory_line(p_count_id uuid, p_line_id uuid, p_counted_quantity numeric) TO vipe_api;
