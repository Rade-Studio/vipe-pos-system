-- Guest dine-in from the table QR, DB layer (odd/tasks/carta-digital.md T4a,
-- S2, S12, S13, S14). Draft number: renumber at merge (L14-L16).
--
-- 1. public.carta_table_proposals: what a guest asks for from the table QR.
--    Guests never write orders or order_items: a waiter (or cashier, admin)
--    confirms a pending proposal and the API adds its items to the open
--    order in the same transaction; or rejects it with a reason.
--    public.carta_table_requests: "Pedir la cuenta" / call the waiter, at
--    most one unresolved row per order and kind. public.carta_feedback: the
--    stars and optional private comment at the end. Staff of the restaurant
--    read proposals and requests, only an admin reads feedback; vipe_api
--    writes none of them directly (SELECT only, no write policy).
-- 2. Guest functions (vipe_api on the pool, no app.user_id, like 0035):
--    guest_submit_proposal, guest_table_status, guest_table_bill,
--    guest_request, guest_feedback. They resolve the restaurant only from a
--    published slug (private.guest_restaurant) and the table only from its
--    current token for that restaurant, never read the staff identity and
--    return no staff ids, payment or customer data.
-- 3. Staff functions (app.user_id set): confirm_table_proposal,
--    reject_table_proposal, resolve_table_request and
--    link_table_proposal_items (the order_items the API added on confirm, so
--    the guest sees kitchen / served), for waiter, cashier and
--    admin of the proposal's restaurant (kitchen and delivery_operator do not
--    take table orders: 42501). A proposal is confirmable only while its
--    order is still open; nothing else needs a trigger.
-- 4. Proposals and requests carry the notify_change realtime trigger and
--    join the realtime_row whitelist, so the staff room is pushed. Feedback
--    does not notify.
--
-- Errors are '<function>: <code>': P0002 carta_not_found, table_not_found,
-- proposal_not_found, request_not_found; P0001 table_ordering_disabled,
-- table_not_open, dish_unavailable, options_invalid, too_many_pending,
-- too_many_feedback, proposal_not_pending, order_not_open,
-- proposal_not_confirmed, proposal_already_linked, item_not_in_order; 22023
-- guest_key_invalid, items_invalid, note_invalid, kind_invalid,
-- rating_invalid, comment_invalid, reason_invalid; 42501 role_not_allowed.
CREATE TABLE public.carta_table_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    table_id uuid NOT NULL,
    order_id uuid NOT NULL,
    guest_key text NOT NULL,
    items jsonb NOT NULL,
    note text,
    status text DEFAULT 'pending' NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    order_item_ids uuid[],
    CONSTRAINT carta_table_proposals_pkey PRIMARY KEY (id),
    CONSTRAINT carta_table_proposals_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_table_proposals_table_id_fkey FOREIGN KEY (restaurant_id, table_id) REFERENCES public.tables(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT carta_table_proposals_order_id_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT carta_table_proposals_decided_by_fkey FOREIGN KEY (restaurant_id, decided_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (decided_by),
    CONSTRAINT carta_table_proposals_guest_key_check CHECK (guest_key ~ '^[A-Za-z0-9_-]{16,64}$'),
    CONSTRAINT carta_table_proposals_items_check CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
    CONSTRAINT carta_table_proposals_note_check CHECK (note IS NULL OR length(note) <= 200),
    CONSTRAINT carta_table_proposals_status_check CHECK (status IN ('pending', 'confirmed', 'rejected')),
    CONSTRAINT carta_table_proposals_decided_check CHECK ((status = 'pending') = (decided_at IS NULL)),
    CONSTRAINT carta_table_proposals_reject_reason_check CHECK (
      reject_reason IS NULL OR (status = 'rejected' AND length(reject_reason) <= 140)),
    CONSTRAINT carta_table_proposals_order_item_ids_check CHECK (
      order_item_ids IS NULL OR (status = 'confirmed' AND cardinality(order_item_ids) BETWEEN 1 AND 60))
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_table_proposals IS 'A guest''s order from the table QR (S12) for the table''s open order when sent: pending until a waiter, cashier or admin confirms it (the API then adds the items to the order) or rejects it. items = [{dishId, quantity 1..20, optionIds (sorted uuids), note <= 140 or null}] (1..20 lines, validated by guest_submit_proposal). Written only by the SECURITY DEFINER functions.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_table_proposals.guest_key IS 'Opaque per-browser id sent by the guest (16-64 of [A-Za-z0-9_-]); guest_table_status shows a guest only their own proposals.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_table_proposals.order_item_ids IS 'The order_items the API added for a confirmed proposal (private.link_table_proposal_items, same transaction as the confirm); NULL until linked. guest_table_status derives the kitchen/served stage from them. order_items itself is not changed.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_table_proposals.decided_by IS 'Profile that confirmed or rejected the proposal (NULL while pending or when the profile is deleted).';
--> statement-breakpoint
CREATE INDEX idx_carta_table_proposals_pending ON public.carta_table_proposals USING btree (table_id, order_id) WHERE (status = 'pending');
--> statement-breakpoint
CREATE INDEX idx_carta_table_proposals_order_id ON public.carta_table_proposals USING btree (order_id);
--> statement-breakpoint
CREATE INDEX idx_carta_table_proposals_restaurant_id ON public.carta_table_proposals USING btree (restaurant_id, created_at);
--> statement-breakpoint
CREATE TABLE public.carta_table_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    table_id uuid NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT carta_table_requests_pkey PRIMARY KEY (id),
    CONSTRAINT carta_table_requests_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_table_requests_table_id_fkey FOREIGN KEY (restaurant_id, table_id) REFERENCES public.tables(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT carta_table_requests_order_id_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT carta_table_requests_resolved_by_fkey FOREIGN KEY (restaurant_id, resolved_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (resolved_by),
    CONSTRAINT carta_table_requests_kind_check CHECK (kind IN ('bill', 'waiter')),
    CONSTRAINT carta_table_requests_resolved_check CHECK (resolved_by IS NULL OR resolved_at IS NOT NULL)
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_table_requests IS 'A guest asks for the bill or calls the waiter from the table QR (S14); for the table''s open order (order_id) when asked, open until a waiter, cashier or admin resolves it. At most one unresolved row per order and kind; an unresolved request of an earlier order is ignored by the guest functions, so it never carries over to the next party. Written only by the SECURITY DEFINER functions.';
--> statement-breakpoint
CREATE UNIQUE INDEX carta_table_requests_open_key ON public.carta_table_requests USING btree (order_id, kind) WHERE (resolved_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_carta_table_requests_table_id ON public.carta_table_requests USING btree (table_id);
--> statement-breakpoint
CREATE INDEX idx_carta_table_requests_restaurant_id ON public.carta_table_requests USING btree (restaurant_id, created_at);
--> statement-breakpoint
CREATE TABLE public.carta_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    table_id uuid,
    rating smallint NOT NULL,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carta_feedback_pkey PRIMARY KEY (id),
    CONSTRAINT carta_feedback_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_feedback_table_id_fkey FOREIGN KEY (restaurant_id, table_id) REFERENCES public.tables(restaurant_id, id) ON DELETE SET NULL (table_id),
    CONSTRAINT carta_feedback_rating_check CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT carta_feedback_comment_check CHECK (comment IS NULL OR length(comment) <= 500)
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_feedback IS 'Stars (1-5) and an optional private comment a guest leaves at the end (S14), from a table QR (table_id) or the public carta (NULL). Admin reads; written only by private.guest_feedback (5 per table and 50 per restaurant within an hour).';
--> statement-breakpoint
CREATE INDEX idx_carta_feedback_restaurant_id ON public.carta_feedback USING btree (restaurant_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_carta_feedback_table_id ON public.carta_feedback USING btree (table_id, created_at) WHERE (table_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.carta_table_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.carta_table_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.carta_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No write policy and no write grant: rows change only through the functions below.
CREATE POLICY carta_table_proposals_select_policy ON public.carta_table_proposals FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY carta_table_requests_select_policy ON public.carta_table_requests FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY carta_feedback_select_policy ON public.carta_feedback FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
REVOKE ALL ON TABLE public.carta_table_proposals, public.carta_table_requests, public.carta_feedback FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.carta_table_proposals, public.carta_table_requests, public.carta_feedback TO vipe_api;
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.carta_table_proposals
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.carta_table_requests
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
COMMENT ON FUNCTION private.notify_change() IS 'AFTER row trigger on orders, order_items, tables, zones, order_deliveries, carta_table_proposals and carta_table_requests: pg_notify(pos_changes, private.change_payload(...)). Delivered to listeners at COMMIT; rolled-back changes notify nothing.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.realtime_row(p_table text, p_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.orders r WHERE r.id = p_id);
    WHEN 'order_items' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.order_items r WHERE r.id = p_id);
    WHEN 'tables' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.tables r WHERE r.id = p_id);
    WHEN 'zones' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.zones r WHERE r.id = p_id);
    WHEN 'order_deliveries' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.order_deliveries r WHERE r.order_id = p_id);
    WHEN 'carta_table_proposals' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.carta_table_proposals r WHERE r.id = p_id);
    WHEN 'carta_table_requests' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.carta_table_requests r WHERE r.id = p_id);
    ELSE
      RAISE EXCEPTION 'realtime_row: table % is not a realtime table', p_table USING ERRCODE = '22023';
  END CASE;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_row(text, uuid) IS 'Deliberate cross-tenant read for the API realtime listener: loads one row by primary key (order_id for order_deliveries) from orders, order_items, tables, zones, order_deliveries, carta_table_proposals or carta_table_requests, bypassing RLS, so a change can be fanned out to the restaurant room named in the NOTIFY payload. Any other table raises 22023. NULL when the row no longer exists.';
--> statement-breakpoint
CREATE FUNCTION private.carta_guest_table(p_slug text, p_token text, OUT restaurant_id uuid, OUT table_id uuid)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT g.id,
         (SELECT q.table_id FROM public.table_qr_tokens q WHERE q.token = p_token AND q.restaurant_id = g.id)
    FROM (SELECT private.guest_restaurant(p_slug) AS id) g
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_guest_table(text, text) IS 'Guest resolver: restaurant_id of a published slug (NULL = carta not found) and table_id of the table whose current token is p_token in that restaurant (NULL = table not found). Not granted to vipe_api; for the guest functions.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_guest_table(text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.carta_open_order(p_restaurant_id uuid, p_table_id uuid) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT o.id FROM public.orders o
   WHERE o.restaurant_id = p_restaurant_id AND o.table_id = p_table_id
     AND o.status IN ('active', 'kitchen', 'delivered')
   ORDER BY (o.parent_order_id IS NOT NULL), o.created_at DESC NULLS LAST, o.id DESC
   LIMIT 1
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_open_order(uuid, uuid) IS 'The open order of a table (status active, kitchen or delivered, the 0024 rule): the newest one, preferring an order that is not a split child. NULL when the table is closed. Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_open_order(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.carta_proposal_items(p_fn text, p_restaurant_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_item jsonb;
  v_dish uuid;
  v_qty numeric;
  v_opts uuid[];
  v_note text;
  v_bad boolean;
  v_out jsonb := '[]'::jsonb;
  v_dishes uuid[] := '{}';
BEGIN
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array' OR pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION '%: items_invalid', p_fn USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_items) e LOOP
    v_bad := false;
    BEGIN
      v_dish := (v_item ->> 'dishId')::uuid;
      v_qty := (v_item ->> 'quantity')::numeric;
      IF pg_catalog.jsonb_typeof(v_item -> 'optionIds') IN ('array') THEN
        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_item -> 'optionIds') x WHERE pg_catalog.jsonb_typeof(x) <> 'string') THEN
          v_bad := true;
        END IF;
        SELECT coalesce(array_agg(x::uuid ORDER BY x::uuid), '{}') INTO v_opts
          FROM pg_catalog.jsonb_array_elements_text(v_item -> 'optionIds') x;
      ELSIF coalesce(pg_catalog.jsonb_typeof(v_item -> 'optionIds'), 'null') = 'null' THEN
        v_opts := '{}';
      ELSE
        v_bad := true;
      END IF;
    EXCEPTION WHEN others THEN
      v_bad := true;
    END;
    IF NOT v_bad AND coalesce(pg_catalog.jsonb_typeof(v_item -> 'note'), 'null') NOT IN ('null', 'string') THEN
      v_bad := true;
    END IF;
    v_note := NULLIF(pg_catalog.btrim(v_item ->> 'note'), '');
    IF v_bad OR pg_catalog.jsonb_typeof(v_item -> 'quantity') IS DISTINCT FROM 'number'
       OR v_dish IS NULL OR v_qty IS NULL OR v_qty <> pg_catalog.trunc(v_qty) OR v_qty NOT BETWEEN 1 AND 20
       OR pg_catalog.cardinality(v_opts) > 50
       OR (SELECT count(DISTINCT o) FROM pg_catalog.unnest(v_opts) o) <> pg_catalog.cardinality(v_opts)
       OR pg_catalog.length(v_note) > 140 THEN
      RAISE EXCEPTION '%: items_invalid', p_fn USING ERRCODE = '22023';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'dishId', v_dish, 'quantity', v_qty::integer, 'optionIds', pg_catalog.to_jsonb(v_opts), 'note', v_note));
    v_dishes := v_dishes || v_dish;
  END LOOP;

  -- Dishes: of this restaurant, active and available (one portion, check_dishes_stock rule).
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_dishes) x(id)
              WHERE NOT EXISTS (SELECT 1 FROM public.dishes d
                                  JOIN private.dishes_available(p_restaurant_id, v_dishes) a ON a.dish_id = d.id
                                 WHERE d.restaurant_id = p_restaurant_id AND d.id = x.id AND d.active AND a.available)) THEN
    RAISE EXCEPTION '%: dish_unavailable', p_fn USING ERRCODE = 'P0001';
  END IF;

  -- Options: active options of active groups linked to the dish, within each group's min/max.
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(v_out) e LOOP
    v_dish := (v_item ->> 'dishId')::uuid;
    SELECT coalesce(array_agg(x::uuid), '{}') INTO v_opts FROM pg_catalog.jsonb_array_elements_text(v_item -> 'optionIds') x;
    IF (SELECT count(*) FROM pg_catalog.unnest(v_opts) x(id)
          JOIN public.modifier_options o ON o.restaurant_id = p_restaurant_id AND o.id = x.id AND o.is_active
          JOIN public.modifier_groups g ON g.restaurant_id = p_restaurant_id AND g.id = o.group_id AND g.is_active
          JOIN public.dish_modifier_groups dg ON dg.restaurant_id = p_restaurant_id AND dg.dish_id = v_dish AND dg.group_id = g.id)
         <> pg_catalog.cardinality(v_opts)
       OR EXISTS (
         SELECT 1 FROM public.dish_modifier_groups dg
           JOIN public.modifier_groups g ON g.restaurant_id = dg.restaurant_id AND g.id = dg.group_id AND g.is_active
          WHERE dg.restaurant_id = p_restaurant_id AND dg.dish_id = v_dish
            AND (SELECT count(*) FROM public.modifier_options o
                  WHERE o.restaurant_id = p_restaurant_id AND o.group_id = g.id AND o.id = ANY(v_opts))
                NOT BETWEEN g.min_select AND coalesce(g.max_select, 2147483647)) THEN
      RAISE EXCEPTION '%: options_invalid', p_fn USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_proposal_items(text, uuid, jsonb) IS 'Validates guest proposal lines for p_restaurant_id and returns them normalized [{dishId, quantity, optionIds (sorted), note (trimmed, empty = null)}]. 22023 <p_fn>: items_invalid (not an array of 1..20 objects; dishId uuid; integer quantity 1..20; optionIds absent, null or an array of distinct uuids; note <= 140); P0001 dish_unavailable (not of the restaurant, inactive or sold out); P0001 options_invalid (an option not active in an active group linked to the dish, or a linked active group outside min_select..max_select). Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_proposal_items(text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.guest_submit_proposal(p_slug text, p_token text, p_guest_key text, p_items jsonb, p_note text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'guest_submit_proposal';
  v_ref record;
  v_order uuid;
  v_items jsonb;
  v_note text := NULLIF(pg_catalog.btrim(p_note), '');
  v_row public.carta_table_proposals;
BEGIN
  SELECT * INTO v_ref FROM private.carta_guest_table(p_slug, p_token);
  IF v_ref.restaurant_id IS NULL THEN
    RAISE EXCEPTION '%: carta_not_found', c_fn USING ERRCODE = 'P0002';
  ELSIF v_ref.table_id IS NULL THEN
    RAISE EXCEPTION '%: table_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF NOT (SELECT s.table_ordering_enabled FROM public.carta_settings s WHERE s.restaurant_id = v_ref.restaurant_id) THEN
    RAISE EXCEPTION '%: table_ordering_disabled', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF p_guest_key IS NULL OR p_guest_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION '%: guest_key_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_note) > 200 THEN
    RAISE EXCEPTION '%: note_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  -- One proposal at a time per table, so the pending limit holds under concurrency.
  PERFORM 1 FROM public.table_qr_tokens q WHERE q.table_id = v_ref.table_id FOR UPDATE;
  v_order := private.carta_open_order(v_ref.restaurant_id, v_ref.table_id);
  IF v_order IS NULL THEN
    RAISE EXCEPTION '%: table_not_open', c_fn USING ERRCODE = 'P0001';
  END IF;
  v_items := private.carta_proposal_items(c_fn, v_ref.restaurant_id, p_items);
  IF (SELECT count(*) FROM public.carta_table_proposals p
       WHERE p.restaurant_id = v_ref.restaurant_id AND p.table_id = v_ref.table_id
         AND p.order_id = v_order AND p.status = 'pending') >= 3 THEN
    RAISE EXCEPTION '%: too_many_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.carta_table_proposals (restaurant_id, table_id, order_id, guest_key, items, note)
  VALUES (v_ref.restaurant_id, v_ref.table_id, v_order, p_guest_key, v_items, v_note)
  RETURNING * INTO v_row;
  RETURN pg_catalog.jsonb_build_object('proposalId', v_row.id, 'status', v_row.status, 'createdAt', v_row.created_at);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_submit_proposal(text, text, text, jsonb, text) IS 'Guest-facing (table QR, no login, no app.user_id): stores a pending proposal for the open order of the table whose current token is p_token in the restaurant of a published slug; returns {proposalId, status: pending, createdAt}. p_items = [{dishId, quantity 1..20, optionIds?: uuid[], note?: <= 140}] (1..20 lines), p_note <= 200, p_guest_key 16-64 of [A-Za-z0-9_-]. Errors guest_submit_proposal: P0002 carta_not_found | table_not_found; P0001 table_ordering_disabled | table_not_open | dish_unavailable | options_invalid | too_many_pending (3 pending for the open order); 22023 guest_key_invalid | note_invalid | items_invalid. A refused call writes nothing.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_submit_proposal(text, text, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_submit_proposal(text, text, text, jsonb, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_table_status(p_slug text, p_token text, p_guest_key text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ref record;
  v_order uuid;
BEGIN
  SELECT * INTO v_ref FROM private.carta_guest_table(p_slug, p_token);
  IF v_ref.table_id IS NULL OR p_guest_key IS NULL OR p_guest_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN NULL;
  END IF;
  v_order := private.carta_open_order(v_ref.restaurant_id, v_ref.table_id);
  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'isOpen', v_order IS NOT NULL,
      'waiterFirstName', (
        SELECT NULLIF((pg_catalog.regexp_split_to_array(pg_catalog.btrim(p.full_name), '\s+'))[1], '')
          FROM public.orders o
          JOIN public.profiles p ON p.restaurant_id = o.restaurant_id AND p.id = o.waiter_id
         WHERE o.restaurant_id = v_ref.restaurant_id AND o.id = v_order),
      'tableOrderingEnabled', s.table_ordering_enabled,
      'showTableBill', s.show_table_bill,
      'proposals', coalesce((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'id', p.id, 'status', p.status, 'createdAt', p.created_at, 'decidedAt', p.decided_at,
                 'rejectReason', p.reject_reason,
                 'stage', CASE
                   WHEN p.status <> 'confirmed' THEN p.status
                   WHEN p.order_item_ids IS NULL THEN 'confirmed'
                   -- Linked items keep their id when a split moves them to a child order, so only the restaurant and id are matched.
                   WHEN EXISTS (SELECT 1 FROM public.order_items oi
                                 WHERE oi.restaurant_id = p.restaurant_id AND oi.id = ANY(p.order_item_ids)
                                   AND oi.status IS DISTINCT FROM 'cancelled' AND oi.status IS DISTINCT FROM 'served') THEN 'kitchen'
                   WHEN EXISTS (SELECT 1 FROM public.order_items oi
                                 WHERE oi.restaurant_id = p.restaurant_id AND oi.id = ANY(p.order_item_ids)
                                   AND oi.status = 'served') THEN 'served'
                   ELSE 'cancelled' END,
                 'lines', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', d.name, 'quantity', (l.v ->> 'quantity')::integer)
                                   ORDER BY l.n)
                             FROM pg_catalog.jsonb_array_elements(p.items) WITH ORDINALITY l(v, n)
                             LEFT JOIN public.dishes d ON d.restaurant_id = p.restaurant_id AND d.id = (l.v ->> 'dishId')::uuid))
               ORDER BY p.created_at, p.id)
          FROM public.carta_table_proposals p
         WHERE p.restaurant_id = v_ref.restaurant_id AND p.table_id = v_ref.table_id
           AND p.order_id = v_order AND p.guest_key = p_guest_key), '[]'::jsonb),
      'requests', coalesce((
        SELECT pg_catalog.jsonb_agg(r.kind ORDER BY r.kind)
          FROM public.carta_table_requests r
         WHERE r.restaurant_id = v_ref.restaurant_id AND r.order_id = v_order AND r.resolved_at IS NULL), '[]'::jsonb))
      FROM public.carta_settings s WHERE s.restaurant_id = v_ref.restaurant_id);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_table_status(text, text, text) IS 'Guest-facing (table QR, no login, no app.user_id): NULL unless the token resolves to a table of a published slug and p_guest_key is valid; else {isOpen, waiterFirstName (first word of the open order''s waiter name, or null), tableOrderingEnabled, showTableBill, proposals: [{id, status, stage, createdAt, decidedAt, rejectReason, lines: [{name, quantity}]}] (only p_guest_key''s, only for the current open order, oldest first), requests: ["bill" | "waiter"] (unresolved kinds of the current open order)}. stage: pending | rejected (= status); confirmed while no order_items are linked (link_table_proposal_items); kitchen while some linked item that is not voided (order_items.status cancelled) is not yet served; served when every non-voided linked item has order_items.status served and at least one is (the waiter''s POST /orders/:id/items/served moves kitchen -> served); cancelled when every linked item was voided. Linked items are matched by id within the restaurant, so items a split moved to a child order still count. No staff ids, payment or customer data.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_table_status(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_table_status(text, text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_table_bill(p_slug text, p_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ref record;
  v_order uuid;
  v_base record;
BEGIN
  SELECT * INTO v_ref FROM private.carta_guest_table(p_slug, p_token);
  IF v_ref.table_id IS NULL
     OR NOT (SELECT s.show_table_bill FROM public.carta_settings s WHERE s.restaurant_id = v_ref.restaurant_id) THEN
    RETURN NULL;
  END IF;
  v_order := private.carta_open_order(v_ref.restaurant_id, v_ref.table_id);
  IF v_order IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_base FROM private.order_bill_base(v_order);
  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'lines', coalesce((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'name', oi.name, 'quantity', oi.quantity, 'unitPrice', pg_catalog.trim_scale(oi.price),
                 'lineTotal', pg_catalog.round(oi.price * oi.quantity)::bigint)
               ORDER BY oi.created_at, oi.id)
          FROM public.order_items oi
         WHERE oi.restaurant_id = v_ref.restaurant_id AND oi.order_id = v_order
           AND oi.status IS DISTINCT FROM 'cancelled' AND oi.quantity > 0), '[]'::jsonb),
      -- The rows private.order_bill_base counts; label snapshot only.
      'discounts', coalesce((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label', od.label, 'amount', pg_catalog.trim_scale(od.amount))
               ORDER BY od.created_at, od.id)
          FROM public.order_discounts od
          LEFT JOIN public.order_items oi ON oi.id = od.order_item_id
         WHERE od.restaurant_id = v_ref.restaurant_id AND od.order_id = v_order
           AND (od.order_item_id IS NULL OR oi.status IS DISTINCT FROM 'cancelled')
           AND NOT (od.kind = 'combo'
                    AND EXISTS (SELECT 1 FROM public.order_items ci
                                 WHERE ci.combo_id = od.combo_id AND ci.status = 'cancelled'))), '[]'::jsonb),
      'grossSubtotal', v_base.gross,
      'totalDiscounts', v_base.discounts,
      'subtotal', v_base.gross - v_base.discounts,
      -- Same reading as guest_carta (0035).
      'tipPercentage', coalesce((
        SELECT substring(pg_catalog.btrim(bc.value, E' \t\r\n') FROM '^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)')::numeric
          FROM public.business_config bc
         WHERE bc.restaurant_id = v_ref.restaurant_id AND bc.key = 'tip_percentage'
         LIMIT 1), 10),
      'updatedAt', o.updated_at)
      FROM public.orders o WHERE o.restaurant_id = v_ref.restaurant_id AND o.id = v_order);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_table_bill(text, text) IS 'Guest-facing (table QR, no login, no app.user_id), read only: NULL unless the token resolves to a table of a published slug with show_table_bill on and an open order; else {lines: [{name, quantity, unitPrice, lineTotal}] (non-voided lines), discounts: [{label, amount}] (the rows order_bill_base counts, label snapshot only), grossSubtotal, totalDiscounts, subtotal (private.order_bill_base), tipPercentage (business_config tip_percentage, default 10), updatedAt}. Never ids, reasons, authorizers, staff, payment or customer data.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_table_bill(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_table_bill(text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_request(p_slug text, p_token text, p_kind text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'guest_request';
  v_ref record;
  v_order uuid;
  v_created timestamptz;
BEGIN
  SELECT * INTO v_ref FROM private.carta_guest_table(p_slug, p_token);
  IF v_ref.restaurant_id IS NULL THEN
    RAISE EXCEPTION '%: carta_not_found', c_fn USING ERRCODE = 'P0002';
  ELSIF v_ref.table_id IS NULL THEN
    RAISE EXCEPTION '%: table_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF NOT (SELECT s.table_ordering_enabled FROM public.carta_settings s WHERE s.restaurant_id = v_ref.restaurant_id) THEN
    RAISE EXCEPTION '%: table_ordering_disabled', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('bill', 'waiter') THEN
    RAISE EXCEPTION '%: kind_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.table_qr_tokens q WHERE q.table_id = v_ref.table_id FOR UPDATE;
  v_order := private.carta_open_order(v_ref.restaurant_id, v_ref.table_id);
  IF v_order IS NULL THEN
    RAISE EXCEPTION '%: table_not_open', c_fn USING ERRCODE = 'P0001';
  END IF;
  SELECT r.created_at INTO v_created FROM public.carta_table_requests r
   WHERE r.restaurant_id = v_ref.restaurant_id AND r.order_id = v_order AND r.kind = p_kind AND r.resolved_at IS NULL;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('kind', p_kind, 'createdAt', v_created, 'alreadyPending', true);
  END IF;
  INSERT INTO public.carta_table_requests (restaurant_id, table_id, order_id, kind)
  VALUES (v_ref.restaurant_id, v_ref.table_id, v_order, p_kind)
  RETURNING created_at INTO v_created;
  RETURN pg_catalog.jsonb_build_object('kind', p_kind, 'createdAt', v_created, 'alreadyPending', false);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_request(text, text, text) IS 'Guest-facing (table QR, no login, no app.user_id): asks for the bill (p_kind bill) or calls the waiter (waiter) at the table whose current token is p_token in the restaurant of a published slug with table ordering on and an open order; the request belongs to that open order. Idempotent while an unresolved request of that kind exists for the open order: {kind, createdAt, alreadyPending}. Errors guest_request: P0002 carta_not_found | table_not_found; P0001 table_ordering_disabled | table_not_open; 22023 kind_invalid.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_request(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_request(text, text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_feedback(p_slug text, p_token text, p_rating integer, p_comment text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'guest_feedback';
  v_rid uuid := private.guest_restaurant(p_slug);
  v_tid uuid;
  v_comment text := NULLIF(pg_catalog.btrim(p_comment), '');
BEGIN
  IF v_rid IS NULL THEN
    RAISE EXCEPTION '%: carta_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF p_token IS NOT NULL THEN
    SELECT q.table_id INTO v_tid FROM public.table_qr_tokens q WHERE q.token = p_token AND q.restaurant_id = v_rid;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION '%: table_not_found', c_fn USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION '%: rating_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_comment) > 500 THEN
    RAISE EXCEPTION '%: comment_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  -- One feedback at a time per restaurant, so both hourly limits hold under concurrency.
  PERFORM 1 FROM public.carta_settings s WHERE s.restaurant_id = v_rid FOR UPDATE;
  IF (v_tid IS NOT NULL AND (SELECT count(*) FROM public.carta_feedback f
                              WHERE f.restaurant_id = v_rid AND f.table_id = v_tid AND f.created_at > now() - interval '1 hour') >= 5)
     OR (SELECT count(*) FROM public.carta_feedback f
          WHERE f.restaurant_id = v_rid AND f.created_at > now() - interval '1 hour') >= 50 THEN
    RAISE EXCEPTION '%: too_many_feedback', c_fn USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.carta_feedback (restaurant_id, table_id, rating, comment) VALUES (v_rid, v_tid, p_rating, v_comment);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_feedback(text, text, integer, text) IS 'Guest-facing (no login, no app.user_id): stores stars 1-5 and an optional private comment (trimmed, empty = none, <= 500) for the restaurant of a published slug; p_token is optional and, when given, must be a current token of that restaurant. At most 5 per table and 50 per restaurant within the last hour. Errors guest_feedback: P0002 carta_not_found | table_not_found; P0001 too_many_feedback; 22023 rating_invalid | comment_invalid.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_feedback(text, text, integer, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_feedback(text, text, integer, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.carta_staff_restaurant(p_fn text) RETURNS uuid
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_rid uuid := private.current_restaurant_id();
BEGIN
  IF v_rid IS NULL OR coalesce(private.current_app_role(), '') NOT IN ('admin', 'cashier', 'waiter') THEN
    RAISE EXCEPTION '%: role_not_allowed', p_fn USING ERRCODE = '42501';
  END IF;
  RETURN v_rid;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_staff_restaurant(text) IS 'The caller''s restaurant when the caller is an admin, cashier or waiter (the roles that take table orders); else 42501 <p_fn>: role_not_allowed. Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_staff_restaurant(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.confirm_table_proposal(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'confirm_table_proposal';
  v_rid uuid := private.carta_staff_restaurant(c_fn);
  v_p public.carta_table_proposals;
BEGIN
  SELECT * INTO v_p FROM public.carta_table_proposals p WHERE p.id = p_id AND p.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: proposal_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status <> 'pending' THEN
    RAISE EXCEPTION '%: proposal_not_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  -- Lock the order so it cannot be paid or cancelled before the API adds the items.
  PERFORM 1 FROM public.orders o
   WHERE o.restaurant_id = v_rid AND o.id = v_p.order_id AND o.table_id = v_p.table_id
     AND o.status IN ('active', 'kitchen', 'delivered')
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: order_not_open', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_table_proposals
     SET status = 'confirmed', decided_at = now(), decided_by = private.current_profile_id()
   WHERE id = v_p.id;
  RETURN pg_catalog.jsonb_build_object('proposalId', v_p.id, 'orderId', v_p.order_id, 'tableId', v_p.table_id,
                                       'note', v_p.note, 'items', v_p.items);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.confirm_table_proposal(uuid) IS 'Staff (admin, cashier, waiter of the proposal''s restaurant): marks a pending proposal confirmed (decided_at, decided_by = caller profile) while its order is still open, locks the order and returns {proposalId, orderId, tableId, note, items: [{dishId, quantity, optionIds, note}]} so the API adds the items in the same transaction. Errors confirm_table_proposal: 42501 role_not_allowed; P0002 proposal_not_found (also another restaurant''s); P0001 proposal_not_pending | order_not_open.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.confirm_table_proposal(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.confirm_table_proposal(uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.reject_table_proposal(p_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'reject_table_proposal';
  v_rid uuid := private.carta_staff_restaurant(c_fn);
  v_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  v_status text;
BEGIN
  IF pg_catalog.length(v_reason) > 140 THEN
    RAISE EXCEPTION '%: reason_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  SELECT p.status INTO v_status FROM public.carta_table_proposals p WHERE p.id = p_id AND p.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: proposal_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '%: proposal_not_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_table_proposals
     SET status = 'rejected', reject_reason = v_reason, decided_at = now(), decided_by = private.current_profile_id()
   WHERE id = p_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.reject_table_proposal(uuid, text) IS 'Staff (admin, cashier, waiter of the proposal''s restaurant): marks a pending proposal rejected with an optional reason (trimmed, empty = none, <= 140) the guest sees. Works whether or not the order is still open. Errors reject_table_proposal: 42501 role_not_allowed; 22023 reason_invalid; P0002 proposal_not_found; P0001 proposal_not_pending.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.reject_table_proposal(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.reject_table_proposal(uuid, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.resolve_table_request(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'resolve_table_request';
  v_rid uuid := private.carta_staff_restaurant(c_fn);
  v_resolved timestamptz;
BEGIN
  SELECT r.resolved_at INTO v_resolved FROM public.carta_table_requests r WHERE r.id = p_id AND r.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: request_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_resolved IS NULL THEN
    UPDATE public.carta_table_requests SET resolved_at = now(), resolved_by = private.current_profile_id() WHERE id = p_id;
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.resolve_table_request(uuid) IS 'Staff (admin, cashier, waiter of the request''s restaurant): marks a guest request resolved (resolved_at, resolved_by = caller profile); an already resolved request is left as it is. Errors resolve_table_request: 42501 role_not_allowed; P0002 request_not_found (also another restaurant''s).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.resolve_table_request(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.resolve_table_request(uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.link_table_proposal_items(p_id uuid, p_item_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'link_table_proposal_items';
  v_rid uuid := private.carta_staff_restaurant(c_fn);
  v_p public.carta_table_proposals;
BEGIN
  IF p_item_ids IS NULL OR pg_catalog.cardinality(p_item_ids) NOT BETWEEN 1 AND 60
     OR pg_catalog.array_position(p_item_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_item_ids) x) <> pg_catalog.cardinality(p_item_ids) THEN
    RAISE EXCEPTION '%: items_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.carta_table_proposals p WHERE p.id = p_id AND p.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: proposal_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status <> 'confirmed' THEN
    RAISE EXCEPTION '%: proposal_not_confirmed', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_p.order_item_ids IS NOT NULL THEN
    RAISE EXCEPTION '%: proposal_already_linked', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.order_items oi
       WHERE oi.restaurant_id = v_rid AND oi.order_id = v_p.order_id AND oi.id = ANY(p_item_ids)) <> pg_catalog.cardinality(p_item_ids) THEN
    RAISE EXCEPTION '%: item_not_in_order', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_table_proposals
     SET order_item_ids = (SELECT array_agg(x ORDER BY x) FROM pg_catalog.unnest(p_item_ids) x)
   WHERE id = v_p.id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.link_table_proposal_items(uuid, uuid[]) IS 'Staff (admin, cashier, waiter of the proposal''s restaurant), called by the API in the confirm transaction right after it inserts the items: stores the order_items ids (1..60, distinct, sorted) of a confirmed, not yet linked proposal; every id must be an order_item of the proposal''s order. Errors link_table_proposal_items: 42501 role_not_allowed; 22023 items_invalid; P0002 proposal_not_found (also another restaurant''s); P0001 proposal_not_confirmed | proposal_already_linked | item_not_in_order.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.link_table_proposal_items(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.link_table_proposal_items(uuid, uuid[]) TO vipe_api;
