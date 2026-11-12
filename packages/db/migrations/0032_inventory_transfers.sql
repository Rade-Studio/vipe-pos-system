-- Transfer documents through an in-transit holding (odd/tasks/inventario-rediseno.md T2, S3).
--
-- 1. public.inventory_transfers is the document (numbered per restaurant,
--    origin and destination bodega, who created, sent, received or cancelled
--    it and when) and public.inventory_transfer_lines its items (requested,
--    received, shortfall reason). Statuses: draft -> in_transit -> received
--    | received_short; draft | in_transit -> cancelled.
-- 2. public.inventory_transit_lots is the frozen in-transit place: send takes
--    each line FEFO from the origin (transfer_out movements) and keeps every
--    lot portion (lot code, expiry, received_at, unit cost, quantity) here.
--    These rows are not inventory_lots, so stock in transit is never
--    available, consumed, counted at either bodega, nor part of
--    ingredients.stock. They stay as history after receipt or cancel; the
--    stock is in transit only while the transfer is in_transit.
-- 3. Receive puts each portion into the destination (transfer_in), received
--    quantity FEFO first; the rest of a short line is written off at once from
--    the same destination lot as waste with the shortfall reason and the notes
--    'Merma en tránsito'. The destination ends with exactly the received
--    quantity and the ledger matches the lots. Receiving again returns the
--    stored result and moves nothing. Cancel of an in-transit transfer returns
--    every portion to the origin (transfer_in).
-- 4. Every movement references reference_type 'inventory_transfer' and the
--    transfer id. The single-item public.inventory_transfer is unchanged.
--
-- RLS: the tenant's admin reads the three tables; there are no write policies,
-- every write goes through the SECURITY DEFINER RPCs (as inventory_lots).
-- Errors: 22023 bad input, P0002 unknown transfer, item or location, P0001
-- rule (Spanish message; insufficient stock carries DETAIL {shortages}),
-- 42501 not admin.
CREATE TABLE public.inventory_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    number integer NOT NULL,
    from_location_id uuid NOT NULL,
    to_location_id uuid NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    notes text,
    created_by uuid,
    sent_by uuid,
    sent_at timestamp with time zone,
    received_by uuid,
    received_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_transfers_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_transfers_restaurant_id_number_key UNIQUE (restaurant_id, number),
    CONSTRAINT inventory_transfers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT inventory_transfers_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
    CONSTRAINT inventory_transfers_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
    CONSTRAINT inventory_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT inventory_transfers_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT inventory_transfers_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT inventory_transfers_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT inventory_transfers_status_check CHECK (status = ANY (ARRAY['draft'::text, 'in_transit'::text, 'received'::text, 'received_short'::text, 'cancelled'::text])),
    CONSTRAINT inventory_transfers_locations_check CHECK (from_location_id <> to_location_id),
    CONSTRAINT inventory_transfers_number_check CHECK (number >= 1),
    CONSTRAINT inventory_transfers_notes_check CHECK (notes IS NULL OR length(notes) <= 2000),
    CONSTRAINT inventory_transfers_sent_check CHECK ((status = ANY (ARRAY['in_transit'::text, 'received'::text, 'received_short'::text])) <= (sent_at IS NOT NULL)),
    CONSTRAINT inventory_transfers_received_check CHECK ((status = ANY (ARRAY['received'::text, 'received_short'::text])) = (received_at IS NOT NULL)),
    CONSTRAINT inventory_transfers_cancelled_check CHECK ((status = 'cancelled'::text) = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE public.inventory_transfer_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    transfer_id uuid NOT NULL,
    ingredient_id uuid NOT NULL,
    requested_quantity numeric(14,3) NOT NULL,
    received_quantity numeric(14,3),
    shortfall_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_transfer_lines_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_transfer_lines_transfer_ingredient_key UNIQUE (transfer_id, ingredient_id),
    CONSTRAINT inventory_transfer_lines_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT inventory_transfer_lines_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.inventory_transfers(id) ON DELETE CASCADE,
    CONSTRAINT inventory_transfer_lines_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT,
    CONSTRAINT inventory_transfer_lines_requested_quantity_check CHECK (requested_quantity > (0)::numeric),
    CONSTRAINT inventory_transfer_lines_received_quantity_check CHECK (received_quantity IS NULL OR (received_quantity >= (0)::numeric AND received_quantity <= requested_quantity)),
    CONSTRAINT inventory_transfer_lines_shortfall_reason_check CHECK (shortfall_reason IS NULL OR (length(btrim(shortfall_reason)) >= 1 AND length(shortfall_reason) <= 200)),
    CONSTRAINT inventory_transfer_lines_shortfall_check CHECK (received_quantity IS NULL OR received_quantity = requested_quantity OR shortfall_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE public.inventory_transit_lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    transfer_id uuid NOT NULL,
    line_id uuid NOT NULL,
    ingredient_id uuid NOT NULL,
    source_lot_id uuid,
    lot_code text,
    expires_on date,
    received_at timestamp with time zone NOT NULL,
    unit_cost numeric(14,4) NOT NULL,
    quantity numeric(14,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_transit_lots_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_transit_lots_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT inventory_transit_lots_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.inventory_transfers(id) ON DELETE CASCADE,
    CONSTRAINT inventory_transit_lots_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.inventory_transfer_lines(id) ON DELETE CASCADE,
    CONSTRAINT inventory_transit_lots_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT,
    CONSTRAINT inventory_transit_lots_source_lot_id_fkey FOREIGN KEY (source_lot_id) REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    CONSTRAINT inventory_transit_lots_quantity_check CHECK (quantity > (0)::numeric),
    CONSTRAINT inventory_transit_lots_unit_cost_check CHECK (unit_cost >= (0)::numeric)
);
--> statement-breakpoint
COMMENT ON TABLE public.inventory_transfers IS 'Transfer documents between two bodegas of a restaurant, numbered per restaurant. draft -> in_transit (send) -> received | received_short (receive); draft | in_transit -> cancelled. Admin read only; written only by the transfer RPCs.';
--> statement-breakpoint
COMMENT ON TABLE public.inventory_transfer_lines IS 'Transfer items: requested_quantity (> 0, sent as is), received_quantity (NULL until received, <= requested) and the shortfall_reason a short line requires.';
--> statement-breakpoint
COMMENT ON TABLE public.inventory_transit_lots IS 'Frozen in-transit place: the lot portions a send took from the origin. Not inventory_lots, so never available, consumed, counted or in ingredients.stock. In transit while the transfer is in_transit; kept as history after receipt or cancel.';
--> statement-breakpoint
COMMENT ON TABLE public.inventory_movements IS 'Signed stock ledger (positive in, negative out); total_cost = quantity * unit_cost. reference_type is one of purchase_order, production_batch, order_item, transfer, inventory_transfer, inventory_count or NULL. Admin read only; written only by the inventory RPCs.';
--> statement-breakpoint
CREATE INDEX idx_inventory_transfers_restaurant_status ON public.inventory_transfers USING btree (restaurant_id, status, number DESC);
--> statement-breakpoint
CREATE INDEX idx_inventory_transfers_from_location_id ON public.inventory_transfers USING btree (from_location_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_transfers_to_location_id ON public.inventory_transfers USING btree (to_location_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_transfer_lines_ingredient_id ON public.inventory_transfer_lines USING btree (ingredient_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_transit_lots_line_id ON public.inventory_transit_lots USING btree (line_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_transit_lots_transfer_id ON public.inventory_transit_lots USING btree (transfer_id);
--> statement-breakpoint
CREATE TRIGGER inventory_transfers_set_updated_at BEFORE UPDATE ON public.inventory_transfers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER inventory_transfer_lines_set_updated_at BEFORE UPDATE ON public.inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.inventory_transfer_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.inventory_transit_lots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_transfers_select_policy ON public.inventory_transfers FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY inventory_transfer_lines_select_policy ON public.inventory_transfer_lines FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY inventory_transit_lots_select_policy ON public.inventory_transit_lots FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
-- The caller-facing transfer row, locked; P0002 when missing or of another tenant.
CREATE FUNCTION private.inventory_transfer_lock(p_fn text, p_restaurant_id uuid, p_transfer_id uuid) RETURNS public.inventory_transfers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_transfer public.inventory_transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_transfer FROM public.inventory_transfers t
   WHERE t.id = p_transfer_id AND t.restaurant_id = p_restaurant_id
   FOR UPDATE;
  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION '%: transfer % not found', p_fn, p_transfer_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_transfer;
END;
$$;
--> statement-breakpoint
-- Locks the transfer's items in id order (the other stock RPCs lock the item row too).
CREATE FUNCTION private.inventory_transfer_lock_items(p_transfer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM 1 FROM public.ingredients i
   WHERE i.id IN (SELECT l.ingredient_id FROM public.inventory_transfer_lines l WHERE l.transfer_id = p_transfer_id)
   ORDER BY i.id
   FOR UPDATE;
END;
$$;
--> statement-breakpoint
-- Replaces the lines of a draft from p_lines [{item_id, quantity}] and checks them against the origin stock.
CREATE FUNCTION private.inventory_transfer_write_lines(p_fn text, p_transfer public.inventory_transfers, p_lines jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_line jsonb;
  v_item uuid;
  v_qty  numeric;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '%: p_lines must be a non-empty array', p_fn USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION '%: at most 200 lines', p_fn USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.inventory_transfer_lines l WHERE l.transfer_id = p_transfer.id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_item := (v_line->>'item_id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR data_exception THEN
      RAISE EXCEPTION '%: every line needs an item_id and a numeric quantity', p_fn USING ERRCODE = '22023';
    END;
    IF v_item IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '%: every line needs an item_id and a positive quantity', p_fn USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = v_item AND i.restaurant_id = p_transfer.restaurant_id) THEN
      RAISE EXCEPTION '%: ingredient % not found', p_fn, v_item USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM public.inventory_transfer_lines l WHERE l.transfer_id = p_transfer.id AND l.ingredient_id = v_item) THEN
      RAISE EXCEPTION '%: ingredient % appears twice', p_fn, v_item USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.inventory_transfer_lines (restaurant_id, transfer_id, ingredient_id, requested_quantity)
    VALUES (p_transfer.restaurant_id, p_transfer.id, v_item, v_qty);
  END LOOP;

  PERFORM private.inventory_transfer_check_stock(p_transfer.id);
END;
$$;
--> statement-breakpoint
-- P0001 in Spanish listing every line above the positive stock of the origin; DETAIL {shortages:[...]}.
CREATE FUNCTION private.inventory_transfer_check_stock(p_transfer_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_message   text;
  v_shortages jsonb;
BEGIN
  SELECT string_agg(format('%s (disponible %s %s, solicitado %s %s)', s.name, s.available::numeric(14,3), s.unit,
                           s.requested::numeric(14,3), s.unit), '; ' ORDER BY s.name),
         jsonb_agg(jsonb_build_object('ingredient_id', s.ingredient_id, 'name', s.name, 'unit', s.unit,
                                      'available', s.available::numeric(14,3), 'requested', s.requested) ORDER BY s.name)
    INTO v_message, v_shortages
    FROM (
      SELECT l.ingredient_id, i.name, i.unit, l.requested_quantity AS requested,
             COALESCE((SELECT sum(lot.quantity) FROM public.inventory_lots lot
                        WHERE lot.ingredient_id = l.ingredient_id AND lot.location_id = t.from_location_id
                          AND lot.quantity > 0), 0) AS available
        FROM public.inventory_transfer_lines l
        JOIN public.inventory_transfers t ON t.id = l.transfer_id
        JOIN public.ingredients i ON i.id = l.ingredient_id
       WHERE l.transfer_id = p_transfer_id
    ) s
   WHERE s.requested > s.available;

  IF v_message IS NOT NULL THEN
    RAISE EXCEPTION 'Stock insuficiente en la bodega de origen: %', v_message
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('shortages', v_shortages)::text;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.create_inventory_transfer(p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'create_inventory_transfer';
  v_caller   record;
  v_transfer public.inventory_transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  IF p_from_location_id IS NULL OR p_to_location_id IS NULL OR p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION '%: origin and destination must be two different locations', c_fn USING ERRCODE = '22023';
  END IF;
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, p_from_location_id);
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, p_to_location_id);

  INSERT INTO public.inventory_transfers (restaurant_id, number, from_location_id, to_location_id, notes, created_by)
  VALUES (v_caller.restaurant_id, private.next_inventory_counter(v_caller.restaurant_id, 'inventory_transfer'),
          p_from_location_id, p_to_location_id, NULLIF(btrim(p_notes), ''), v_caller.profile_id)
  RETURNING * INTO v_transfer;

  PERFORM private.inventory_transfer_write_lines(c_fn, v_transfer, p_lines);

  RETURN jsonb_build_object('transfer_id', v_transfer.id, 'number', v_transfer.number, 'status', v_transfer.status);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.update_inventory_transfer(p_transfer_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'update_inventory_transfer';
  v_caller   record;
  v_transfer public.inventory_transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_transfer := private.inventory_transfer_lock(c_fn, v_caller.restaurant_id, p_transfer_id);
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se puede editar una transferencia en borrador' USING ERRCODE = 'P0001';
  END IF;
  IF p_from_location_id IS NULL OR p_to_location_id IS NULL OR p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION '%: origin and destination must be two different locations', c_fn USING ERRCODE = '22023';
  END IF;
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, p_from_location_id);
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, p_to_location_id);

  UPDATE public.inventory_transfers
     SET from_location_id = p_from_location_id, to_location_id = p_to_location_id, notes = NULLIF(btrim(p_notes), '')
   WHERE id = v_transfer.id
  RETURNING * INTO v_transfer;

  PERFORM private.inventory_transfer_write_lines(c_fn, v_transfer, p_lines);

  RETURN jsonb_build_object('transfer_id', v_transfer.id, 'number', v_transfer.number, 'status', v_transfer.status);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.send_inventory_transfer(p_transfer_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'send_inventory_transfer';
  v_caller   record;
  v_transfer public.inventory_transfers%ROWTYPE;
  v_line     public.inventory_transfer_lines%ROWTYPE;
  v_taken    jsonb;
  v_total    numeric := 0;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_transfer := private.inventory_transfer_lock(c_fn, v_caller.restaurant_id, p_transfer_id);
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se puede enviar una transferencia en borrador' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, v_transfer.from_location_id);
  PERFORM private.inventory_location(c_fn, v_caller.restaurant_id, v_transfer.to_location_id);

  PERFORM private.inventory_transfer_lock_items(v_transfer.id);
  PERFORM private.inventory_transfer_check_stock(v_transfer.id);

  FOR v_line IN SELECT * FROM public.inventory_transfer_lines l WHERE l.transfer_id = v_transfer.id ORDER BY l.ingredient_id LOOP
    v_taken := private.inventory_take(v_transfer.restaurant_id, v_line.ingredient_id, v_transfer.from_location_id,
                                      v_line.requested_quantity, 'transfer_out', 'inventory_transfer', v_transfer.id,
                                      v_caller.profile_id, false, NULL, v_transfer.notes);
    INSERT INTO public.inventory_transit_lots
      (restaurant_id, transfer_id, line_id, ingredient_id, source_lot_id, lot_code, expires_on, received_at, unit_cost, quantity)
    SELECT v_transfer.restaurant_id, v_transfer.id, v_line.id, v_line.ingredient_id, (p->>'lot_id')::uuid, p->>'lot_code',
           (p->>'expires_on')::date, (p->>'received_at')::timestamptz, (p->>'unit_cost')::numeric, (p->>'quantity')::numeric
      FROM jsonb_array_elements(v_taken->'portions') p;
    v_total := v_total + (v_taken->>'total_cost')::numeric;
    PERFORM private.inventory_sync_stock(v_line.ingredient_id);
  END LOOP;

  UPDATE public.inventory_transfers
     SET status = 'in_transit', sent_by = v_caller.profile_id, sent_at = now()
   WHERE id = v_transfer.id;

  RETURN jsonb_build_object('transfer_id', v_transfer.id, 'status', 'in_transit', 'total_cost', round(v_total, 4));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.receive_inventory_transfer(p_transfer_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'receive_inventory_transfer';
  v_caller   record;
  v_transfer public.inventory_transfers%ROWTYPE;
  v_line     record;
  v_portion  public.inventory_transit_lots%ROWTYPE;
  v_input    jsonb;
  v_received numeric;
  v_reason   text;
  v_left     numeric;
  v_waste    numeric;
  v_lot_id   uuid;
  v_lot      public.inventory_lots%ROWTYPE;
  v_short    numeric := 0;
  v_status   text;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_transfer := private.inventory_transfer_lock(c_fn, v_caller.restaurant_id, p_transfer_id);
  IF v_transfer.status IN ('received', 'received_short') THEN
    RETURN jsonb_build_object('transfer_id', v_transfer.id, 'status', v_transfer.status, 'already_received', true);
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Solo se puede recibir una transferencia en tránsito' USING ERRCODE = 'P0001';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) <> (SELECT count(*) FROM public.inventory_transfer_lines l WHERE l.transfer_id = v_transfer.id)
     OR (SELECT count(DISTINCT x->>'line_id') FROM jsonb_array_elements(p_lines) x) <> jsonb_array_length(p_lines)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) x
                 WHERE NOT EXISTS (SELECT 1 FROM public.inventory_transfer_lines l
                                    WHERE l.transfer_id = v_transfer.id AND l.id::text = x->>'line_id')) THEN
    RAISE EXCEPTION '%: every line of the transfer must be received exactly once', c_fn USING ERRCODE = '22023';
  END IF;
  v_transfer.to_location_id := private.inventory_location(c_fn, v_caller.restaurant_id, v_transfer.to_location_id);

  PERFORM private.inventory_transfer_lock_items(v_transfer.id);

  FOR v_line IN
    SELECT l.*, i.name, i.unit FROM public.inventory_transfer_lines l JOIN public.ingredients i ON i.id = l.ingredient_id
     WHERE l.transfer_id = v_transfer.id ORDER BY l.ingredient_id
  LOOP
    SELECT x INTO v_input FROM jsonb_array_elements(p_lines) x WHERE x->>'line_id' = v_line.id::text;
    BEGIN
      v_received := (v_input->>'received_quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR data_exception THEN
      RAISE EXCEPTION '%: received_quantity must be a number', c_fn USING ERRCODE = '22023';
    END;
    IF v_received IS NULL OR v_received < 0 THEN
      RAISE EXCEPTION '%: received_quantity must be zero or positive', c_fn USING ERRCODE = '22023';
    END IF;
    IF v_received > v_line.requested_quantity THEN
      RAISE EXCEPTION 'No se puede recibir más de lo enviado de % (enviado % %)', v_line.name, v_line.requested_quantity, v_line.unit
        USING ERRCODE = 'P0001';
    END IF;
    v_reason := NULLIF(btrim(v_input->>'shortfall_reason'), '');
    IF v_received < v_line.requested_quantity AND v_reason IS NULL THEN
      RAISE EXCEPTION 'Indica el motivo del faltante de %', v_line.name USING ERRCODE = 'P0001';
    END IF;
    IF v_received = v_line.requested_quantity THEN
      v_reason := NULL;
    END IF;

    -- The received quantity comes from the first portions (FEFO); the rest is written off where it was detected.
    v_left := v_received;
    FOR v_portion IN
      SELECT * FROM public.inventory_transit_lots p WHERE p.line_id = v_line.id
       ORDER BY p.expires_on ASC NULLS LAST, p.received_at, p.id
    LOOP
      v_waste := v_portion.quantity - least(v_portion.quantity, v_left);
      v_left := v_left - least(v_portion.quantity, v_left);
      v_lot_id := private.inventory_put(v_transfer.restaurant_id, v_line.ingredient_id, v_transfer.to_location_id,
                                        v_portion.quantity, v_portion.unit_cost, v_portion.lot_code, v_portion.expires_on,
                                        v_portion.received_at, 'transfer_in', 'inventory_transfer', v_transfer.id,
                                        v_caller.profile_id, NULL, v_transfer.notes);
      SELECT * INTO v_lot FROM public.inventory_lots WHERE id = v_lot_id FOR UPDATE;
      IF v_waste > 0 THEN
        UPDATE public.inventory_lots SET quantity = quantity - v_waste WHERE id = v_lot.id;
        INSERT INTO public.inventory_movements
          (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost,
           total_cost, reason, notes, reference_type, reference_id, created_by)
        VALUES (v_transfer.restaurant_id, v_line.ingredient_id, v_transfer.to_location_id, v_lot.id, 'waste', -v_waste,
                v_lot.unit_cost, -v_waste * v_lot.unit_cost, v_reason, 'Merma en tránsito', 'inventory_transfer',
                v_transfer.id, v_caller.profile_id);
      END IF;
    END LOOP;

    UPDATE public.inventory_transfer_lines
       SET received_quantity = v_received, shortfall_reason = v_reason
     WHERE id = v_line.id;
    v_short := v_short + (v_line.requested_quantity - v_received);
    PERFORM private.inventory_sync_stock(v_line.ingredient_id);
  END LOOP;

  v_status := CASE WHEN v_short > 0 THEN 'received_short' ELSE 'received' END;
  UPDATE public.inventory_transfers
     SET status = v_status, received_by = v_caller.profile_id, received_at = now()
   WHERE id = v_transfer.id;

  RETURN jsonb_build_object('transfer_id', v_transfer.id, 'status', v_status, 'already_received', false,
                            'shortfall_quantity', v_short::numeric(14,3));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.cancel_inventory_transfer(p_transfer_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'cancel_inventory_transfer';
  v_caller   record;
  v_transfer public.inventory_transfers%ROWTYPE;
  v_portion  public.inventory_transit_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_transfer := private.inventory_transfer_lock(c_fn, v_caller.restaurant_id, p_transfer_id);
  IF v_transfer.status NOT IN ('draft', 'in_transit') THEN
    RAISE EXCEPTION 'Solo se puede anular una transferencia en borrador o en tránsito' USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer.status = 'in_transit' THEN
    PERFORM private.inventory_transfer_lock_items(v_transfer.id);
    FOR v_portion IN
      SELECT * FROM public.inventory_transit_lots p WHERE p.transfer_id = v_transfer.id
       ORDER BY p.ingredient_id, p.expires_on ASC NULLS LAST, p.received_at, p.id
    LOOP
      PERFORM private.inventory_put(v_transfer.restaurant_id, v_portion.ingredient_id, v_transfer.from_location_id,
                                    v_portion.quantity, v_portion.unit_cost, v_portion.lot_code, v_portion.expires_on,
                                    v_portion.received_at, 'transfer_in', 'inventory_transfer', v_transfer.id,
                                    v_caller.profile_id, NULL, 'Transferencia anulada');
    END LOOP;
    PERFORM private.inventory_sync_stock(l.ingredient_id)
       FROM public.inventory_transfer_lines l WHERE l.transfer_id = v_transfer.id;
  END IF;

  UPDATE public.inventory_transfers
     SET status = 'cancelled', cancelled_by = v_caller.profile_id, cancelled_at = now()
   WHERE id = v_transfer.id;

  RETURN jsonb_build_object('transfer_id', v_transfer.id, 'status', 'cancelled');
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.create_inventory_transfer(p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) IS 'Draft transfer between two active locations of the tenant (admin). p_lines [{item_id, quantity > 0}], 1..200, one per item, each within the positive stock of the origin (P0001 in Spanish, DETAIL {shortages}). Returns {transfer_id, number, status}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.update_inventory_transfer(p_transfer_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) IS 'Replaces the locations, notes and lines of a draft (P0001 otherwise), with the create_inventory_transfer checks. Returns {transfer_id, number, status}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.send_inventory_transfer(p_transfer_id uuid) IS 'draft -> in_transit: takes every line FEFO from the origin (transfer_out) into public.inventory_transit_lots, all or nothing (P0001 in Spanish with DETAIL {shortages}). Returns {transfer_id, status, total_cost}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.receive_inventory_transfer(p_transfer_id uuid, p_lines jsonb) IS 'in_transit -> received | received_short. p_lines [{line_id, received_quantity 0..requested, shortfall_reason}] once per line; a short line needs a reason (P0001). Puts the transit portions at the destination (transfer_in) and writes the shortfall off as waste with the reason (notes Merma en tránsito). Idempotent: an already received transfer returns {already_received: true}. Returns {transfer_id, status, already_received, shortfall_quantity}.';
--> statement-breakpoint
COMMENT ON FUNCTION public.cancel_inventory_transfer(p_transfer_id uuid) IS 'draft | in_transit -> cancelled (P0001 otherwise); an in-transit transfer returns every portion to the origin (transfer_in). Returns {transfer_id, status}.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_transfer_lock(p_fn text, p_restaurant_id uuid, p_transfer_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_transfer_lock_items(p_transfer_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_transfer_write_lines(p_fn text, p_transfer public.inventory_transfers, p_lines jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.inventory_transfer_check_stock(p_transfer_id uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_inventory_transfer(p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_inventory_transfer(p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_inventory_transfer(p_transfer_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.update_inventory_transfer(p_transfer_id uuid, p_from_location_id uuid, p_to_location_id uuid, p_lines jsonb, p_notes text) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.send_inventory_transfer(p_transfer_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.send_inventory_transfer(p_transfer_id uuid) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.receive_inventory_transfer(p_transfer_id uuid, p_lines jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.receive_inventory_transfer(p_transfer_id uuid, p_lines jsonb) TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cancel_inventory_transfer(p_transfer_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cancel_inventory_transfer(p_transfer_id uuid) TO vipe_api;
