-- H-017 (odd/tasks/qa-noviembre-2026.md T7): a restaurant keeps at least one
-- active payment method and at least one active cash method. The admin screen
-- already locks the switch; this trigger makes it a database rule for every
-- writer (PATCH /payments/methods/:id, raw SQL, a future endpoint).
--
-- Only a change that REMOVES the last one is refused: deactivating it, turning
-- the last active cash method into electronic, or deleting it. A restaurant
-- that already has none (legacy data) is not blocked from anything else, and
-- the rows deleted by ON DELETE CASCADE of their restaurant pass.
--
-- Two concurrent deactivations of the last two methods serialize on a
-- per-restaurant advisory lock, so the second one sees the first one's commit.
-- P0001: the API answers 422 with the message verbatim (Spanish, the same text
-- the admin screen shows).
CREATE FUNCTION private.guard_last_payment_method() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_keeps_active boolean := TG_OP = 'UPDATE' AND NEW.is_active AND NEW.restaurant_id = OLD.restaurant_id;
  v_keeps_cash boolean := v_keeps_active AND NEW.kind = 'cash';
  v_was_cash boolean := OLD.is_active AND OLD.kind = 'cash';
BEGIN
  IF NOT OLD.is_active OR (v_keeps_active AND (v_keeps_cash OR NOT v_was_cash)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = OLD.restaurant_id) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('payment_methods_keep_one_active:' || OLD.restaurant_id::text, 0));
  IF NOT v_keeps_active AND NOT EXISTS (
    SELECT 1 FROM public.payment_methods m
     WHERE m.restaurant_id = OLD.restaurant_id AND m.id <> OLD.id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'Debe quedar al menos un método de pago activo para poder cobrar.';
  END IF;
  IF v_was_cash AND NOT v_keeps_cash AND NOT EXISTS (
    SELECT 1 FROM public.payment_methods m
     WHERE m.restaurant_id = OLD.restaurant_id AND m.id <> OLD.id AND m.is_active AND m.kind = 'cash'
  ) THEN
    RAISE EXCEPTION 'Debe quedar al menos un método de pago en efectivo activo para dar cambio.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_last_payment_method() IS 'BEFORE UPDATE OR DELETE trigger on public.payment_methods (H-017): refuses (P0001, Spanish) the change that leaves the restaurant without an active method or without an active cash method. Serialized per restaurant with an advisory lock.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_last_payment_method() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER payment_methods_keep_one_active
  BEFORE UPDATE OF is_active, kind, restaurant_id OR DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION private.guard_last_payment_method();
