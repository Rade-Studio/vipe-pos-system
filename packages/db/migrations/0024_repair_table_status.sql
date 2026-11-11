-- Repair table status that contradicts the orders (odd/tasks/qa-mesas-ordenes.md T8, S12, L8).
--
-- An open order is public.orders.status IN ('active', 'kitchen', 'delivered')
-- with table_id = tables.id (the API hasOpenOrder rule).
-- 1. kitchen, served or delivered without an open order -> available, no
--    waiter, no reservation fields.
-- 2. available or reserved with an open order -> the status of the newest
--    open order (created_at, then id): active -> occupied, kitchen -> kitchen,
--    delivered -> served. The reservation fields are cleared
--    (tables_reservation_check) and waiter_id is taken from that order only
--    when the table has none.
-- 3. occupied tables and tables that agree are untouched; updated_at is set
--    only on repaired rows.
--
-- public.repair_table_status() is idempotent and returns the number of rows
-- repaired; the migration calls it once for every restaurant (it runs as the
-- owner and tables has no FORCE ROW LEVEL SECURITY). Each repaired row fires
-- the notify_change realtime trigger. EXECUTE is not granted to vipe_api.
CREATE FUNCTION public.repair_table_status() RETURNS integer
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
DECLARE
  v_freed integer;
  v_taken integer;
BEGIN
  UPDATE public.tables t
     SET status = 'available', waiter_id = NULL,
         reservation_name = NULL, reservation_arrival_at = NULL, reserved_by = NULL, reserved_at = NULL,
         updated_at = now()
   WHERE t.status IN ('kitchen', 'served', 'delivered')
     AND NOT EXISTS (SELECT 1 FROM public.orders o
                      WHERE o.table_id = t.id AND o.status IN ('active', 'kitchen', 'delivered'));
  GET DIAGNOSTICS v_freed = ROW_COUNT;

  UPDATE public.tables t
     SET status = CASE o.status WHEN 'active' THEN 'occupied' WHEN 'kitchen' THEN 'kitchen' ELSE 'served' END,
         waiter_id = coalesce(t.waiter_id, o.waiter_id),
         reservation_name = NULL, reservation_arrival_at = NULL, reserved_by = NULL, reserved_at = NULL,
         updated_at = now()
    FROM (SELECT DISTINCT ON (table_id) table_id, status, waiter_id
            FROM public.orders
           WHERE table_id IS NOT NULL AND status IN ('active', 'kitchen', 'delivered')
           ORDER BY table_id, created_at DESC NULLS LAST, id DESC) o
   WHERE o.table_id = t.id
     AND t.status IN ('available', 'reserved');
  GET DIAGNOSTICS v_taken = ROW_COUNT;

  RETURN v_freed + v_taken;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.repair_table_status() FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION public.repair_table_status() IS 'Data repair (0024, S12): tables in kitchen/served/delivered without an open order become available with no waiter; available/reserved tables with an open order (active|kitchen|delivered) take the newest order status (active->occupied, kitchen->kitchen, delivered->served), clear the reservation fields and keep or take the waiter. Occupied and agreeing tables are untouched. Idempotent; returns the number of rows repaired. Not granted to vipe_api.';
--> statement-breakpoint
SELECT public.repair_table_status();
