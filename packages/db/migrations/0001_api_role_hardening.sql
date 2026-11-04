-- API role hardening (odd/tasks/migracion-backend-nestjs.md, T4 verification).
--
-- vipe_api is a SQL login now, not a PostgREST pseudo-role, so raw SQL as that
-- role is a realistic threat model. Three defence-in-depth fixes:
--   1. delete_order_with_items was the only SECURITY DEFINER function running
--      with search_path = public; a caller owning pg_temp.orders could shadow
--      the table and delete another tenant's rows. Pin search_path to '' and
--      qualify every relation.
--   2. Functions created later by vipe_migrator were executable by PUBLIC by
--      default; revoke that default so every new function needs an explicit
--      GRANT EXECUTE TO vipe_api.
--   3. Two COMMENT texts still described Supabase roles.

CREATE OR REPLACE FUNCTION public.delete_order_with_items(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_order_id      uuid;
  v_restaurant_id uuid;
BEGIN
  -- Resolve the caller's restaurant from the app.user_id setting.
  SELECT restaurant_id INTO v_restaurant_id
    FROM public.profiles
   WHERE user_id = private.current_user_id();

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no profile found for user';
  END IF;

  -- Lock the order row and verify tenant ownership.
  SELECT id INTO v_order_id
    FROM public.orders
   WHERE id = p_order_id AND restaurant_id = v_restaurant_id
     FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or access denied: %', p_order_id;
  END IF;

  -- Junction links first (FK RESTRICT on ingredient_transactions would
  -- otherwise block the cascade).
  DELETE FROM public.ingredient_transactions_orders WHERE order_id = p_order_id;

  -- Order items, then the order itself.
  DELETE FROM public.order_items WHERE order_id = p_order_id;
  DELETE FROM public.orders WHERE id = p_order_id;
END;
$$;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE vipe_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION private.default_restaurant_id() IS 'Column default for the tenant-scoped tables. For vipe_api it is the caller''s own tenant (resolved through app.user_id) and NULL when the account has no profile (fail closed); for postgres (seed and migrations) it is the oldest restaurant, ORDER BY created_at, id; for every other role, including vipe_migrator, it is NULL, so a write that omits restaurant_id fails NOT NULL instead of landing in an arbitrary tenant.';
--> statement-breakpoint
COMMENT ON FUNCTION public.guard_order_deliveries_immutable() IS 'BEFORE UPDATE OR DELETE guard on public.order_deliveries: a delivery row is written only by the SECURITY DEFINER delivery RPCs. Raises insufficient_privilege (42501) for every caller except postgres and vipe_migrator.';
