-- Orders and tables API (odd/tasks/migracion-backend-nestjs.md, T8a steps 2 and 5).
--
-- 1. order_items notifies changes: the kitchen screen subscribes to it and
--    reads old.status. A truncated old keeps order_id and status as well.
-- 2. order_items joins the realtime_row whitelist.
-- 3. Two tenant-checked loaders let the listener enrich events without
--    app.user_id: orders events carry new.order_items, tables events
--    new.waiter_name.
-- 4. private.recompute_order_bill has no tenant check and is not executable
--    by vipe_api; the API recomputes a bill through a wrapper that refuses
--    orders outside the caller's restaurant.

CREATE OR REPLACE FUNCTION private.change_payload(p_table text, p_op text, p_new jsonb, p_old jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_row jsonb := coalesce(p_new, p_old);
  v_key text := CASE WHEN p_table = 'order_deliveries' THEN 'order_id' ELSE 'id' END;
  v_payload jsonb;
  v_full jsonb;
  v_keys jsonb;
BEGIN
  v_payload := pg_catalog.jsonb_build_object(
    'table', p_table,
    'op', p_op,
    'id', v_row OPERATOR(pg_catalog.->>) v_key,
    'restaurant_id', v_row OPERATOR(pg_catalog.->>) 'restaurant_id'
  );
  IF p_old IS NULL OR p_op = 'INSERT' THEN
    RETURN v_payload;
  END IF;
  -- pg_notify rejects payloads of 8000 bytes or more; keep a safe margin.
  v_full := v_payload OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object('old', p_old);
  IF pg_catalog.octet_length(v_full::text) <= 7000 THEN
    RETURN v_full;
  END IF;
  v_keys := pg_catalog.jsonb_build_object(
    v_key, p_old OPERATOR(pg_catalog.->) v_key,
    'restaurant_id', p_old OPERATOR(pg_catalog.->) 'restaurant_id',
    'order_type', p_old OPERATOR(pg_catalog.->) 'order_type'
  );
  IF p_table = 'order_items' THEN
    -- The kitchen merges item events by order and compares old.status.
    v_keys := v_keys OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
      'order_id', p_old OPERATOR(pg_catalog.->) 'order_id',
      'status', p_old OPERATOR(pg_catalog.->) 'status'
    );
  END IF;
  RETURN v_payload OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
    'old', pg_catalog.jsonb_strip_nulls(v_keys),
    'old_truncated', true
  );
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.change_payload(text, text, jsonb, jsonb) IS 'pos_changes NOTIFY payload: {table, op, id, restaurant_id} plus the full old row for UPDATE/DELETE when the payload stays within 7000 bytes, else old reduced to its key columns (id or order_id, restaurant_id, order_type; order_items also order_id and status) and old_truncated: true. Never carries the new row.';
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
COMMENT ON FUNCTION private.notify_change() IS 'AFTER row trigger on orders, order_items, tables and order_deliveries: pg_notify(pos_changes, private.change_payload(...)). Delivered to listeners at COMMIT; rolled-back changes notify nothing.';
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
    WHEN 'order_deliveries' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.order_deliveries r WHERE r.order_id = p_id);
    ELSE
      RAISE EXCEPTION 'realtime_row: table % is not a realtime table', p_table USING ERRCODE = '22023';
  END CASE;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_row(text, uuid) IS 'Deliberate cross-tenant read for the API realtime listener: loads one row by primary key (order_id for order_deliveries) from orders, order_items, tables or order_deliveries, bypassing RLS, so a change can be fanned out to the restaurant room named in the NOTIFY payload. Any other table raises 22023. NULL when the row no longer exists.';
--> statement-breakpoint
CREATE FUNCTION private.realtime_order_items(p_order_id uuid, p_restaurant_id uuid)
    RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(oi) ORDER BY oi.added_at, oi.created_at, oi.id),
    '[]'::jsonb)
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.restaurant_id = p_restaurant_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_order_items(uuid, uuid) IS 'Realtime listener enrichment: the items of one order (oldest first) when the order belongs to p_restaurant_id (the tenant already checked against the loaded order row), else []. Replaces the per-client order_items SELECT of realtime-service.ts.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.realtime_order_items(uuid, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.realtime_waiter_name(p_profile_id uuid, p_restaurant_id uuid)
    RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.full_name::text
    FROM public.profiles p
   WHERE p.id = p_profile_id
     AND p.restaurant_id = p_restaurant_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_waiter_name(uuid, uuid) IS 'Realtime listener enrichment: full_name of a table''s waiter when the profile belongs to p_restaurant_id, else NULL.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.realtime_waiter_name(uuid, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.recompute_caller_order_bill(p_order_id uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = p_order_id
       AND o.restaurant_id = private.current_restaurant_id()
  ) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM private.recompute_order_bill(p_order_id);
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.recompute_caller_order_bill(uuid) IS 'API entry to private.recompute_order_bill (the bill pay_order trusts): raises P0002 unless the order belongs to the caller restaurant (app.user_id), then recomputes subtotal, tax, tip and total from order_items.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.recompute_caller_order_bill(uuid) TO vipe_api;
