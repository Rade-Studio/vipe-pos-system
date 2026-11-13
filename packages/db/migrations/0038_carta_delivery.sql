-- Guest delivery from the public carta, DB layer (odd/tasks/carta-digital.md
-- T6, S2, S15). Draft number: renumber at merge (L14-L16).
--
-- 1. public.carta_delivery_requests: what a guest asks for at /c/<slug> with
--    online delivery on. Guests never write orders: a delivery operator (or
--    admin, cashier) confirms a pending request and the API creates the
--    delivery order with the console's own path in the same transaction,
--    then links it (delivery_order_id); or rejects it with a reason. Stock
--    and kitchen tickets happen only on confirm. Staff of the restaurant who
--    work deliveries read (admin, cashier, delivery_operator: the customer
--    registry roles); vipe_api writes nothing directly (SELECT only).
-- 2. Guest functions (vipe_api on the pool, no app.user_id, like 0035/0036):
--    guest_submit_delivery and guest_delivery_status. The restaurant comes
--    only from a published slug, the request only from its random tracking
--    token (24 base64url characters, private.new_table_qr_token); they never
--    read the staff identity and return no staff, customer-list or other
--    order data. Lines are validated by 0036's private.carta_proposal_items,
--    unchanged.
-- 3. Staff functions (app.user_id set): confirm_delivery_request,
--    link_delivery_request, reject_delivery_request for admin, cashier and
--    delivery_operator of the request's restaurant (42501 otherwise).
-- 4. The table carries the notify_change trigger and joins the realtime_row
--    whitelist, so the staff room is pushed.
--
-- Errors are '<function>: <code>': P0002 carta_not_found,
-- delivery_request_not_found, delivery_order_not_found; P0001
-- delivery_ordering_disabled, dish_unavailable, options_invalid,
-- too_many_pending (2 pending per phone), too_busy (30 pending within the
-- hour), delivery_request_not_pending, delivery_request_not_confirmed,
-- delivery_request_already_linked, delivery_order_already_linked; 22023
-- customer_invalid, name_invalid, phone_invalid, address_invalid,
-- neighborhood_invalid, payment_invalid, note_invalid, items_invalid,
-- reason_invalid; 42501 role_not_allowed.
CREATE TABLE public.carta_delivery_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    tracking_token text NOT NULL,
    customer_name text NOT NULL,
    phone text NOT NULL,
    address text NOT NULL,
    neighborhood text,
    notes text,
    payment_method text NOT NULL,
    cash_from integer,
    items jsonb NOT NULL,
    delivery_fee bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    reject_reason text,
    delivery_order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    CONSTRAINT carta_delivery_requests_pkey PRIMARY KEY (id),
    CONSTRAINT carta_delivery_requests_tracking_token_key UNIQUE (tracking_token),
    CONSTRAINT carta_delivery_requests_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_delivery_requests_delivery_order_id_fkey FOREIGN KEY (restaurant_id, delivery_order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE SET NULL (delivery_order_id),
    CONSTRAINT carta_delivery_requests_decided_by_fkey FOREIGN KEY (restaurant_id, decided_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (decided_by),
    CONSTRAINT carta_delivery_requests_tracking_token_check CHECK (tracking_token ~ '^[A-Za-z0-9_-]{24}$'),
    CONSTRAINT carta_delivery_requests_customer_name_check CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
    CONSTRAINT carta_delivery_requests_phone_check CHECK (phone ~ '^[0-9]{7,15}$'),
    CONSTRAINT carta_delivery_requests_address_check CHECK (length(btrim(address)) BETWEEN 6 AND 200),
    CONSTRAINT carta_delivery_requests_neighborhood_check CHECK (neighborhood IS NULL OR length(neighborhood) <= 80),
    CONSTRAINT carta_delivery_requests_notes_check CHECK (notes IS NULL OR length(notes) <= 200),
    CONSTRAINT carta_delivery_requests_payment_method_check CHECK (payment_method IN ('cash', 'card', 'transfer')),
    CONSTRAINT carta_delivery_requests_cash_from_check CHECK (cash_from IS NULL OR (payment_method = 'cash' AND cash_from >= 0)),
    CONSTRAINT carta_delivery_requests_items_check CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
    CONSTRAINT carta_delivery_requests_delivery_fee_check CHECK (delivery_fee >= 0),
    CONSTRAINT carta_delivery_requests_status_check CHECK (status IN ('pending', 'confirmed', 'rejected')),
    CONSTRAINT carta_delivery_requests_decided_check CHECK ((status = 'pending') = (decided_at IS NULL)),
    CONSTRAINT carta_delivery_requests_reject_reason_check CHECK (
      reject_reason IS NULL OR (status = 'rejected' AND length(reject_reason) <= 140)),
    CONSTRAINT carta_delivery_requests_delivery_order_check CHECK (delivery_order_id IS NULL OR status = 'confirmed')
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_delivery_requests IS 'A guest''s delivery order from the public carta (S15): pending until an admin, cashier or delivery operator confirms it (the API then creates the delivery order through the console path and links it) or rejects it. items = [{dishId, quantity 1..20, optionIds (sorted uuids), note <= 140 or null}] (1..20 lines, private.carta_proposal_items). Written only by the SECURITY DEFINER functions.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_delivery_requests.tracking_token IS 'Random 24-character base64url token (private.new_table_qr_token) the guest follows the order with (guest_delivery_status); never the id.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_delivery_requests.payment_method IS 'How the guest pays on delivery: cash (cash_from = the bill they pay with, for the change), card (datáfono) or transfer.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_delivery_requests.delivery_fee IS 'The delivery fee the guest was shown when sending (business_config delivery_default_fee, as private.guest_carta reads it); the API charges it on confirm.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_delivery_requests.delivery_order_id IS 'The delivery order created on confirm (private.link_delivery_request, same transaction), same restaurant; NULL while pending, rejected or when the order is deleted. guest_delivery_status follows its order_deliveries.delivery_status.';
--> statement-breakpoint
CREATE UNIQUE INDEX carta_delivery_requests_delivery_order_key ON public.carta_delivery_requests USING btree (delivery_order_id) WHERE (delivery_order_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_carta_delivery_requests_pending ON public.carta_delivery_requests USING btree (restaurant_id, phone) WHERE (status = 'pending');
--> statement-breakpoint
CREATE INDEX idx_carta_delivery_requests_restaurant_id ON public.carta_delivery_requests USING btree (restaurant_id, created_at);
--> statement-breakpoint
ALTER TABLE public.carta_delivery_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No write policy and no write grant: rows change only through the functions below.
CREATE POLICY carta_delivery_requests_select_policy ON public.carta_delivery_requests FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = ANY (ARRAY['admin'::text, 'cashier'::text, 'delivery_operator'::text])) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
REVOKE ALL ON TABLE public.carta_delivery_requests FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.carta_delivery_requests TO vipe_api;
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.carta_delivery_requests
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
COMMENT ON FUNCTION private.notify_change() IS 'AFTER row trigger on orders, order_items, tables, zones, order_deliveries, carta_table_proposals, carta_table_requests and carta_delivery_requests: pg_notify(pos_changes, private.change_payload(...)). Delivered to listeners at COMMIT; rolled-back changes notify nothing.';
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
    WHEN 'carta_delivery_requests' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.carta_delivery_requests r WHERE r.id = p_id);
    ELSE
      RAISE EXCEPTION 'realtime_row: table % is not a realtime table', p_table USING ERRCODE = '22023';
  END CASE;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_row(text, uuid) IS 'Deliberate cross-tenant read for the API realtime listener: loads one row by primary key (order_id for order_deliveries) from orders, order_items, tables, zones, order_deliveries, carta_table_proposals, carta_table_requests or carta_delivery_requests, bypassing RLS, so a change can be fanned out to the restaurant room named in the NOTIFY payload. Any other table raises 22023. NULL when the row no longer exists.';
--> statement-breakpoint
CREATE FUNCTION private.guest_submit_delivery(p_slug text, p_customer jsonb, p_items jsonb, p_payment jsonb, p_notes text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'guest_submit_delivery';
  v_rid uuid := private.guest_restaurant(p_slug);
  v_name text;
  v_phone text;
  v_address text;
  v_neigh text;
  v_notes text := NULLIF(pg_catalog.btrim(p_notes), '');
  v_method text;
  v_cash numeric;
  v_items jsonb;
  v_row public.carta_delivery_requests;
BEGIN
  IF v_rid IS NULL THEN
    RAISE EXCEPTION '%: carta_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF NOT (SELECT s.delivery_ordering_enabled FROM public.carta_settings s WHERE s.restaurant_id = v_rid) THEN
    RAISE EXCEPTION '%: delivery_ordering_disabled', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF p_customer IS NULL OR pg_catalog.jsonb_typeof(p_customer) <> 'object' THEN
    RAISE EXCEPTION '%: customer_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  v_name := pg_catalog.btrim(p_customer ->> 'name');
  IF pg_catalog.jsonb_typeof(p_customer -> 'name') IS DISTINCT FROM 'string' OR pg_catalog.length(v_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION '%: name_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  v_phone := p_customer ->> 'phone';
  IF pg_catalog.jsonb_typeof(p_customer -> 'phone') IS DISTINCT FROM 'string' OR v_phone !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION '%: phone_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  v_address := pg_catalog.btrim(p_customer ->> 'address');
  IF pg_catalog.jsonb_typeof(p_customer -> 'address') IS DISTINCT FROM 'string' OR pg_catalog.length(v_address) NOT BETWEEN 6 AND 200 THEN
    RAISE EXCEPTION '%: address_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  v_neigh := NULLIF(pg_catalog.btrim(p_customer ->> 'neighborhood'), '');
  IF coalesce(pg_catalog.jsonb_typeof(p_customer -> 'neighborhood'), 'null') NOT IN ('null', 'string') OR pg_catalog.length(v_neigh) > 80 THEN
    RAISE EXCEPTION '%: neighborhood_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_notes) > 200 THEN
    RAISE EXCEPTION '%: note_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  IF p_payment IS NULL OR pg_catalog.jsonb_typeof(p_payment) <> 'object' THEN
    RAISE EXCEPTION '%: payment_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  v_method := p_payment ->> 'method';
  IF pg_catalog.jsonb_typeof(p_payment -> 'method') IS DISTINCT FROM 'string' OR v_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION '%: payment_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  IF coalesce(pg_catalog.jsonb_typeof(p_payment -> 'cashFrom'), 'null') <> 'null' THEN
    IF v_method <> 'cash' OR pg_catalog.jsonb_typeof(p_payment -> 'cashFrom') <> 'number' THEN
      RAISE EXCEPTION '%: payment_invalid', c_fn USING ERRCODE = '22023';
    END IF;
    v_cash := (p_payment ->> 'cashFrom')::numeric;
    IF v_cash <> pg_catalog.trunc(v_cash) OR v_cash NOT BETWEEN 0 AND 2147483647 THEN
      RAISE EXCEPTION '%: payment_invalid', c_fn USING ERRCODE = '22023';
    END IF;
  END IF;
  v_items := private.carta_proposal_items(c_fn, v_rid, p_items);
  -- One request at a time per restaurant, so both limits hold under concurrency.
  PERFORM 1 FROM public.carta_settings s WHERE s.restaurant_id = v_rid FOR UPDATE;
  IF (SELECT count(*) FROM public.carta_delivery_requests d
       WHERE d.restaurant_id = v_rid AND d.phone = v_phone AND d.status = 'pending') >= 2 THEN
    RAISE EXCEPTION '%: too_many_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.carta_delivery_requests d
       WHERE d.restaurant_id = v_rid AND d.status = 'pending' AND d.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION '%: too_busy', c_fn USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.carta_delivery_requests
    (restaurant_id, tracking_token, customer_name, phone, address, neighborhood, notes, payment_method, cash_from, items, delivery_fee)
  VALUES (v_rid, private.new_table_qr_token(), v_name, v_phone, v_address, v_neigh, v_notes, v_method, v_cash::integer, v_items,
          coalesce((private.guest_carta(p_slug) ->> 'deliveryFee')::bigint, 0))
  RETURNING * INTO v_row;
  RETURN pg_catalog.jsonb_build_object('requestId', v_row.id, 'trackingToken', v_row.tracking_token,
                                       'status', v_row.status, 'createdAt', v_row.created_at);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_submit_delivery(text, jsonb, jsonb, jsonb, text) IS 'Guest-facing (public carta, no login, no app.user_id): stores a pending delivery request for the restaurant of a published slug with online delivery on (carta_settings.delivery_ordering_enabled); returns {requestId, trackingToken, status: pending, createdAt}. p_customer = {name 1..120 (trimmed), phone ^[0-9]{7,15}$ (already normalized), address 6..200 (trimmed), neighborhood? <= 80}; p_items = [{dishId, quantity 1..20, optionIds?, note? <= 140}] (1..20 lines, private.carta_proposal_items); p_payment = {method cash | card | transfer, cashFrom?: integer >= 0, cash only}; p_notes <= 200. The delivery fee is the one guest_carta shows. Limits: 2 pending per phone and restaurant, 30 pending per restaurant created within the hour. Errors guest_submit_delivery: P0002 carta_not_found; P0001 delivery_ordering_disabled | dish_unavailable | options_invalid | too_many_pending | too_busy; 22023 customer_invalid | name_invalid | phone_invalid | address_invalid | neighborhood_invalid | note_invalid | payment_invalid | items_invalid. A refused call writes nothing.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_submit_delivery(text, jsonb, jsonb, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_submit_delivery(text, jsonb, jsonb, jsonb, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_delivery_status(p_slug text, p_tracking_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT pg_catalog.jsonb_build_object(
           'status', d.status,
           'stage', CASE
             WHEN d.status <> 'confirmed' THEN d.status
             ELSE coalesce(od.delivery_status, 'received') END,
           'rejectReason', d.reject_reason,
           'createdAt', d.created_at,
           'lines', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', di.name, 'quantity', (l.v ->> 'quantity')::integer)
                            ORDER BY l.n)
                       FROM pg_catalog.jsonb_array_elements(d.items) WITH ORDINALITY l(v, n)
                       LEFT JOIN public.dishes di ON di.restaurant_id = d.restaurant_id AND di.id = (l.v ->> 'dishId')::uuid),
           'deliveryFee', d.delivery_fee,
           'total', CASE WHEN od.order_id IS NULL THEN NULL ELSE (o.total + od.delivery_fee)::bigint END,
           'orderNumber', o.order_number,
           'paymentMethod', d.payment_method)
    FROM public.carta_delivery_requests d
    LEFT JOIN public.orders o ON o.restaurant_id = d.restaurant_id AND o.id = d.delivery_order_id
    LEFT JOIN public.order_deliveries od ON od.restaurant_id = d.restaurant_id AND od.order_id = o.id
   WHERE d.restaurant_id = private.guest_restaurant(p_slug)
     AND d.tracking_token = p_tracking_token
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_delivery_status(text, text) IS 'Guest-facing (public carta, no login, no app.user_id), read only: NULL unless p_tracking_token is a request of the restaurant of a published slug; else {status, stage, rejectReason, createdAt, lines: [{name, quantity}], deliveryFee (shown when sent), total (null until a delivery order is linked: then its orders.total plus its delivery fee, the amount due), orderNumber (the linked order''s number or null), paymentMethod}. stage: pending | rejected (= status); once confirmed the linked order_deliveries.delivery_status (received | preparing | ready | out_for_delivery | delivered | failed | cancelled), received while none is linked. Never the customer''s data, failure reasons, courier, staff ids or other orders.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_delivery_status(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_delivery_status(text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.carta_delivery_staff_restaurant(p_fn text) RETURNS uuid
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_rid uuid := private.current_restaurant_id();
BEGIN
  IF v_rid IS NULL OR coalesce(private.current_app_role(), '') NOT IN ('admin', 'cashier', 'delivery_operator') THEN
    RAISE EXCEPTION '%: role_not_allowed', p_fn USING ERRCODE = '42501';
  END IF;
  RETURN v_rid;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_delivery_staff_restaurant(text) IS 'The caller''s restaurant when the caller is an admin, cashier or delivery operator (the roles that read the customer registry); else 42501 <p_fn>: role_not_allowed. Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_delivery_staff_restaurant(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.confirm_delivery_request(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'confirm_delivery_request';
  v_rid uuid := private.carta_delivery_staff_restaurant(c_fn);
  v_d public.carta_delivery_requests;
BEGIN
  SELECT * INTO v_d FROM public.carta_delivery_requests d WHERE d.id = p_id AND d.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: delivery_request_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'pending' THEN
    RAISE EXCEPTION '%: delivery_request_not_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_delivery_requests
     SET status = 'confirmed', decided_at = now(), decided_by = private.current_profile_id()
   WHERE id = v_d.id;
  RETURN pg_catalog.jsonb_build_object(
    'requestId', v_d.id,
    'customer', pg_catalog.jsonb_build_object('name', v_d.customer_name, 'phone', v_d.phone),
    'address', v_d.address, 'neighborhood', v_d.neighborhood, 'notes', v_d.notes,
    'paymentMethod', v_d.payment_method, 'cashFrom', v_d.cash_from, 'deliveryFee', v_d.delivery_fee,
    'items', v_d.items);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.confirm_delivery_request(uuid) IS 'Staff (admin, cashier, delivery operator of the request''s restaurant): marks a pending delivery request confirmed (decided_at, decided_by = caller profile), with the row locked, and returns {requestId, customer: {name, phone}, address, neighborhood, notes, paymentMethod, cashFrom, deliveryFee, items: [{dishId, quantity, optionIds, note}]} so the API creates the delivery order and links it in the same transaction. Errors confirm_delivery_request: 42501 role_not_allowed; P0002 delivery_request_not_found (also another restaurant''s); P0001 delivery_request_not_pending.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.confirm_delivery_request(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.confirm_delivery_request(uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.link_delivery_request(p_id uuid, p_delivery_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'link_delivery_request';
  v_rid uuid := private.carta_delivery_staff_restaurant(c_fn);
  v_d public.carta_delivery_requests;
BEGIN
  SELECT * INTO v_d FROM public.carta_delivery_requests d WHERE d.id = p_id AND d.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: delivery_request_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_d.status <> 'confirmed' THEN
    RAISE EXCEPTION '%: delivery_request_not_confirmed', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_d.delivery_order_id IS NOT NULL THEN
    RAISE EXCEPTION '%: delivery_request_already_linked', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o
                   JOIN public.order_deliveries od ON od.restaurant_id = o.restaurant_id AND od.order_id = o.id
                  WHERE o.restaurant_id = v_rid AND o.id = p_delivery_order_id AND o.order_type = 'delivery') THEN
    RAISE EXCEPTION '%: delivery_order_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.carta_delivery_requests d WHERE d.delivery_order_id = p_delivery_order_id) THEN
    RAISE EXCEPTION '%: delivery_order_already_linked', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_delivery_requests SET delivery_order_id = p_delivery_order_id WHERE id = v_d.id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.link_delivery_request(uuid, uuid) IS 'Staff (admin, cashier, delivery operator of the request''s restaurant), called by the API in the confirm transaction right after it creates the delivery order: stores p_delivery_order_id on a confirmed, not yet linked request; the order must be a delivery order (order_type delivery with its order_deliveries row) of the same restaurant, linked to no other request. Errors link_delivery_request: 42501 role_not_allowed; P0002 delivery_request_not_found | delivery_order_not_found; P0001 delivery_request_not_confirmed | delivery_request_already_linked | delivery_order_already_linked.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.link_delivery_request(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.link_delivery_request(uuid, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.reject_delivery_request(p_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'reject_delivery_request';
  v_rid uuid := private.carta_delivery_staff_restaurant(c_fn);
  v_reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  v_status text;
BEGIN
  IF pg_catalog.length(v_reason) > 140 THEN
    RAISE EXCEPTION '%: reason_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  SELECT d.status INTO v_status FROM public.carta_delivery_requests d WHERE d.id = p_id AND d.restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: delivery_request_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '%: delivery_request_not_pending', c_fn USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.carta_delivery_requests
     SET status = 'rejected', reject_reason = v_reason, decided_at = now(), decided_by = private.current_profile_id()
   WHERE id = p_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.reject_delivery_request(uuid, text) IS 'Staff (admin, cashier, delivery operator of the request''s restaurant): marks a pending delivery request rejected with an optional reason (trimmed, empty = none, <= 140) the guest sees. Errors reject_delivery_request: 42501 role_not_allowed; 22023 reason_invalid; P0002 delivery_request_not_found; P0001 delivery_request_not_pending.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.reject_delivery_request(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.reject_delivery_request(uuid, text) TO vipe_api;
