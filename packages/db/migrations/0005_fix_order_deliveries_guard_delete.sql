-- order_deliveries guard on DELETE (odd/tasks/migracion-backend-nestjs.md, T6
-- verification advisory 1).
--
-- The trusted branch returned NEW, which is NULL in a BEFORE DELETE trigger, so
-- every delete of an order_deliveries row was silently skipped, the ON DELETE
-- CASCADE from orders included. Return the row the operation needs instead.
-- Everything else is unchanged: SECURITY INVOKER, empty search_path, 42501 for
-- every other caller.

CREATE OR REPLACE FUNCTION public.guard_order_deliveries_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('postgres', 'vipe_migrator') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'order_deliveries rows are immutable: writes are done by the task 3 SECURITY DEFINER RPCs'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
