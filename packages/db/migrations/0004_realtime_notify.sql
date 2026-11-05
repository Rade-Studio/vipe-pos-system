-- Realtime change notifications (odd/tasks/migracion-backend-nestjs.md, T6).
--
-- Replaces the supabase_realtime publication: AFTER triggers on orders, tables
-- and order_deliveries send pg_notify('pos_changes') with the row key, its
-- tenant and the previous row (REPLICA IDENTITY FULL parity), never the new
-- row. The API listens, loads the new row through private.realtime_row and
-- fans the event out to the restaurant's socket room.

CREATE FUNCTION private.change_payload(p_table text, p_op text, p_new jsonb, p_old jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_row jsonb := coalesce(p_new, p_old);
  v_key text := CASE WHEN p_table = 'order_deliveries' THEN 'order_id' ELSE 'id' END;
  v_payload jsonb;
  v_full jsonb;
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
  RETURN v_payload OPERATOR(pg_catalog.||) pg_catalog.jsonb_build_object(
    'old', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      v_key, p_old OPERATOR(pg_catalog.->) v_key,
      'restaurant_id', p_old OPERATOR(pg_catalog.->) 'restaurant_id',
      'order_type', p_old OPERATOR(pg_catalog.->) 'order_type'
    )),
    'old_truncated', true
  );
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.change_payload(text, text, jsonb, jsonb) IS 'pos_changes NOTIFY payload: {table, op, id, restaurant_id} plus the full old row for UPDATE/DELETE when the payload stays within 7000 bytes, else old reduced to its key columns (id or order_id, restaurant_id, order_type) and old_truncated: true. Never carries the new row.';
--> statement-breakpoint
-- notify_change runs as the writer (vipe_api for API requests); trigger
-- functions need no EXECUTE grant, the payload builder does.
GRANT EXECUTE ON FUNCTION private.change_payload(text, text, jsonb, jsonb) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.notify_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM pg_catalog.pg_notify(
    'pos_changes',
    private.change_payload(
      TG_TABLE_NAME,
      TG_OP,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END
    )::text
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.notify_change() IS 'AFTER row trigger on orders, tables and order_deliveries: pg_notify(pos_changes, private.change_payload(...)). Delivered to listeners at COMMIT; rolled-back changes notify nothing.';
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.tables
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.order_deliveries
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
CREATE FUNCTION private.realtime_row(p_table text, p_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  CASE p_table
    WHEN 'orders' THEN
      RETURN (SELECT pg_catalog.to_jsonb(r) FROM public.orders r WHERE r.id = p_id);
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
COMMENT ON FUNCTION private.realtime_row(text, uuid) IS 'Deliberate cross-tenant read for the API realtime listener: loads one row by primary key (order_id for order_deliveries) from orders, tables or order_deliveries, bypassing RLS, so a change can be fanned out to the restaurant room named in the NOTIFY payload. Any other table raises 22023. NULL when the row no longer exists.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.realtime_row(text, uuid) TO vipe_api;
