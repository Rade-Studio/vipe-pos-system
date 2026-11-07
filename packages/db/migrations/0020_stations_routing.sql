-- Stations and routing (odd/tasks/fase3-operacion.md F6, L10, L11).
--
-- 1. public.stations: where a comanda line is prepared, per restaurant. kind
--    prep (Cocina, Barra, Postres...) or cashier (the one fixed "Caja" that
--    receives facturas and precuentas; never a route, never deleted). color is
--    a status token of design/system.md. The first prep station becomes the
--    default (is_default): a dish with no route goes there, flagged
--    'fallback'. At most 20 stations per restaurant. vipe_api reads them as
--    any staff member and writes them as an admin; no DELETE policy and a
--    trigger on kind and is_default: public.delete_station is the only way
--    out and moves every route in the same transaction.
-- 2. Routes: categories.station_id is the default station of a category and
--    dishes.station_id an exception. Both reference (restaurant_id,
--    station_id), so a route never crosses tenants, and a trigger refuses the
--    cashier station. ON DELETE RESTRICT: a station with routes is only
--    removed through delete_station.
-- 3. order_items.station_id / station_source ('dish' | 'category' |
--    'fallback') are computed once, by a BEFORE INSERT trigger, with the
--    same resolver the API uses for print jobs (private.route_dish_in):
--    dish exception -> category station -> default station. With no prep
--    station both stay NULL (today's behaviour). vipe_api cannot rewrite them.
-- 4. print_jobs.station_id tags a comanda (one job per station) or a factura
--    (Caja). ON DELETE SET NULL: the queue keeps the job of a deleted station.
-- 5. business_config printing_enabled ('true' | 'false'); a missing key reads
--    as true, so existing restaurants keep printing.
--
-- Error messages are `<function>: <code>`: 42501 delete_station:
-- admin_required, order_items: station_is_stored, stations: managed_column; P0002 delete_station:
-- station_not_found; P0001 delete_station: cashier_station, stations:
-- too_many; 22023 delete_station: move_required, target_invalid; 23514
-- route_station: cashier_station.
CREATE TABLE public.stations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'prep' NOT NULL,
    color text DEFAULT 'kitchen' NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stations_pkey PRIMARY KEY (id),
    CONSTRAINT stations_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT stations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT stations_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT stations_kind_check CHECK (kind IN ('prep', 'cashier')),
    CONSTRAINT stations_color_check CHECK (color IN ('kitchen', 'served', 'occupied', 'free', 'reserved')),
    CONSTRAINT stations_default_prep_check CHECK (NOT is_default OR kind = 'prep')
);
--> statement-breakpoint
COMMENT ON TABLE public.stations IS 'Preparation stations (kind prep) and the one cashier station (Caja: facturas and precuentas) of a restaurant. Categories route to a prep station by default, dishes may override it; is_default is where unrouted dishes go. Deleted only through public.delete_station.';
--> statement-breakpoint
CREATE UNIQUE INDEX stations_restaurant_id_name_key ON public.stations USING btree (restaurant_id, lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX stations_one_cashier_key ON public.stations USING btree (restaurant_id) WHERE kind = 'cashier';
--> statement-breakpoint
CREATE UNIQUE INDEX stations_one_default_key ON public.stations USING btree (restaurant_id) WHERE is_default;
--> statement-breakpoint
CREATE TRIGGER stations_set_updated_at BEFORE UPDATE ON public.stations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE FUNCTION private.station_before_insert()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  -- One writer per restaurant at a time, so the default and the cap hold.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stations:' || NEW.restaurant_id::text, 0));
  IF (SELECT pg_catalog.count(*) FROM public.stations s WHERE s.restaurant_id = NEW.restaurant_id) >= 20 THEN
    RAISE EXCEPTION 'stations: too_many' USING ERRCODE = 'P0001';
  END IF;
  NEW.is_default := NEW.kind = 'prep' AND NOT EXISTS (
    SELECT 1 FROM public.stations s WHERE s.restaurant_id = NEW.restaurant_id AND s.is_default);
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.station_before_insert() IS 'stations BEFORE INSERT: at most 20 stations per restaurant; the first prep station becomes the default one (is_default is never taken from the caller).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.station_before_insert() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER stations_before_insert BEFORE INSERT ON public.stations
    FOR EACH ROW EXECUTE FUNCTION private.station_before_insert();
--> statement-breakpoint
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY stations_select_policy ON public.stations FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY stations_insert_policy ON public.stations FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY stations_update_policy ON public.stations FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
-- vipe_api keeps its table privileges (the 020 invariant): there is no
-- DELETE policy, and the trigger below keeps kind, is_default and the tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stations TO vipe_api;
--> statement-breakpoint
-- SECURITY INVOKER on purpose: current_user is the caller, so vipe_api is
-- refused while public.delete_station (owned by vipe_migrator) moves the default.
CREATE FUNCTION private.guard_station_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.is_default IS DISTINCT FROM OLD.is_default
      OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.id IS DISTINCT FROM OLD.id)
     AND current_user NOT IN ('postgres', 'vipe_migrator') THEN
    RAISE EXCEPTION 'stations: managed_column' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_station_update() IS 'stations BEFORE UPDATE: the API renames, recolours and reorders; kind, is_default and the tenant change only through public.delete_station.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_station_update() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER stations_guard_update BEFORE UPDATE ON public.stations
    FOR EACH ROW EXECUTE FUNCTION private.guard_station_update();
--> statement-breakpoint
ALTER TABLE public.categories
    ADD COLUMN station_id uuid,
    ADD CONSTRAINT categories_station_id_fkey FOREIGN KEY (restaurant_id, station_id) REFERENCES public.stations(restaurant_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
COMMENT ON COLUMN public.categories.station_id IS 'Default station of the category''s dishes (a prep station of the same restaurant); NULL = no route, the dishes go to the default station.';
--> statement-breakpoint
ALTER TABLE public.dishes
    ADD COLUMN station_id uuid,
    ADD CONSTRAINT dishes_station_id_fkey FOREIGN KEY (restaurant_id, station_id) REFERENCES public.stations(restaurant_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
COMMENT ON COLUMN public.dishes.station_id IS 'Exception: the dish is prepared at this station instead of its category''s. NULL = same as the category.';
--> statement-breakpoint
CREATE INDEX idx_categories_station_id ON public.categories USING btree (station_id);
--> statement-breakpoint
CREATE INDEX idx_dishes_station_id ON public.dishes USING btree (station_id);
--> statement-breakpoint
ALTER TABLE public.order_items
    ADD COLUMN station_id uuid,
    ADD COLUMN station_source text,
    ADD CONSTRAINT order_items_station_id_fkey FOREIGN KEY (restaurant_id, station_id) REFERENCES public.stations(restaurant_id, id) ON DELETE RESTRICT,
    ADD CONSTRAINT order_items_station_source_check CHECK (station_source IN ('dish', 'category', 'fallback')),
    ADD CONSTRAINT order_items_station_pair_check CHECK ((station_id IS NULL) = (station_source IS NULL));
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.station_id IS 'Station the line was routed to when it was sent (private.route_dish_in); NULL when the restaurant had no prep station.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.station_source IS 'Why: dish (exception), category (its default) or fallback (no route: the default station, shown as a warning to the admin).';
--> statement-breakpoint
CREATE INDEX idx_order_items_station_id ON public.order_items USING btree (station_id);
--> statement-breakpoint
ALTER TABLE public.print_jobs
    ADD COLUMN station_id uuid,
    ADD CONSTRAINT print_jobs_station_id_fkey FOREIGN KEY (restaurant_id, station_id) REFERENCES public.stations(restaurant_id, id) ON DELETE SET NULL (station_id);
--> statement-breakpoint
COMMENT ON COLUMN public.print_jobs.station_id IS 'Station of the job: the comanda''s station, or Caja for a factura; NULL when the restaurant had no stations (the single legacy job).';
--> statement-breakpoint
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_printing_enabled CHECK (key <> 'printing_enabled' OR value IN ('true', 'false'));
--> statement-breakpoint
CREATE FUNCTION private.guard_route_station()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.station_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.stations s
        WHERE s.id = NEW.station_id AND s.restaurant_id = NEW.restaurant_id AND s.kind = 'cashier') THEN
    RAISE EXCEPTION 'route_station: cashier_station' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_route_station() IS 'categories and dishes: a route never points at the cashier station (Caja receives facturas and precuentas, not dishes).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_route_station() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER categories_guard_route_station BEFORE INSERT OR UPDATE OF station_id ON public.categories
    FOR EACH ROW EXECUTE FUNCTION private.guard_route_station();
--> statement-breakpoint
CREATE TRIGGER dishes_guard_route_station BEFORE INSERT OR UPDATE OF station_id ON public.dishes
    FOR EACH ROW EXECUTE FUNCTION private.guard_route_station();
--> statement-breakpoint
CREATE FUNCTION private.route_dish_in(p_restaurant_id uuid, p_dish_id uuid)
    RETURNS TABLE(station_id uuid, source text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(ds.id, cs.id, fb.id),
         CASE WHEN ds.id IS NOT NULL THEN 'dish' WHEN cs.id IS NOT NULL THEN 'category' WHEN fb.id IS NOT NULL THEN 'fallback' END
    FROM (SELECT 1) one
    LEFT JOIN public.dishes d ON d.id = p_dish_id AND d.restaurant_id = p_restaurant_id
    LEFT JOIN public.stations ds ON ds.id = d.station_id AND ds.restaurant_id = p_restaurant_id AND ds.kind = 'prep'
    LEFT JOIN public.categories c ON c.id = d.category_id AND c.restaurant_id = p_restaurant_id
    LEFT JOIN public.stations cs ON cs.id = c.station_id AND cs.restaurant_id = p_restaurant_id AND cs.kind = 'prep'
    LEFT JOIN public.stations fb ON fb.restaurant_id = p_restaurant_id AND fb.is_default
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.route_dish_in(uuid, uuid) IS 'The routing rule: the dish exception, else its category station, else the default station (source fallback); (NULL, NULL) when the restaurant has no prep station. An unknown dish is a fallback. Not executable by vipe_api (the restaurant is a parameter).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.route_dish_in(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.route_dishes(p_dish_ids uuid[])
    RETURNS TABLE(dish_id uuid, station_id uuid, source text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT x.id, r.station_id, r.source
    FROM (SELECT DISTINCT pg_catalog.unnest(p_dish_ids) AS id) x
    CROSS JOIN LATERAL private.route_dish_in(private.current_restaurant_id(), x.id) r
   WHERE private.current_restaurant_id() IS NOT NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.route_dishes(uuid[]) IS 'private.route_dish_in for the caller''s restaurant: the station each dish goes to (the API splits comandas with it). Nothing without a caller.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.route_dishes(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.route_dishes(uuid[]) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.route_order_item()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  SELECT r.station_id, r.source INTO NEW.station_id, NEW.station_source
    FROM private.route_dish_in(NEW.restaurant_id, NEW.dish_id) r;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.route_order_item() IS 'order_items BEFORE INSERT: a new line takes its station from private.route_dish_in; the caller''s value is ignored.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.route_order_item() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER order_items_route_station BEFORE INSERT ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION private.route_order_item();
--> statement-breakpoint
-- SECURITY INVOKER on purpose: current_user is the caller, so vipe_api is
-- refused while public.delete_station (owned by vipe_migrator) moves lines.
CREATE FUNCTION private.guard_order_item_station()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF (NEW.station_id IS DISTINCT FROM OLD.station_id OR NEW.station_source IS DISTINCT FROM OLD.station_source)
     AND current_user NOT IN ('postgres', 'vipe_migrator') THEN
    RAISE EXCEPTION 'order_items: station_is_stored' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_order_item_station() IS 'order_items BEFORE UPDATE: the stored station of a line changes only through public.delete_station.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_order_item_station() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER order_items_guard_station BEFORE UPDATE OF station_id, station_source ON public.order_items
    FOR EACH ROW EXECUTE FUNCTION private.guard_order_item_station();
--> statement-breakpoint
CREATE FUNCTION public.delete_station(p_station_id uuid, p_move_to uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.current_restaurant_id();
  v_station public.stations;
  v_target public.stations;
BEGIN
  IF v_restaurant IS NULL OR private.current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'delete_station: admin_required' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('stations:' || v_restaurant::text, 0));
  SELECT * INTO v_station FROM public.stations s
   WHERE s.id = p_station_id AND s.restaurant_id = v_restaurant FOR UPDATE;
  IF v_station.id IS NULL THEN
    RAISE EXCEPTION 'delete_station: station_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_station.kind = 'cashier' THEN
    RAISE EXCEPTION 'delete_station: cashier_station' USING ERRCODE = 'P0001';
  END IF;
  IF p_move_to IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.stations s
                WHERE s.restaurant_id = v_restaurant AND s.kind = 'prep' AND s.id <> p_station_id) THEN
      RAISE EXCEPTION 'delete_station: move_required' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_target FROM public.stations s
     WHERE s.id = p_move_to AND s.restaurant_id = v_restaurant AND s.kind = 'prep' AND s.id <> p_station_id FOR UPDATE;
    IF v_target.id IS NULL THEN
      RAISE EXCEPTION 'delete_station: target_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.categories SET station_id = v_target.id, updated_at = now()
   WHERE restaurant_id = v_restaurant AND station_id = p_station_id;
  UPDATE public.dishes SET station_id = v_target.id, updated_at = now()
   WHERE restaurant_id = v_restaurant AND station_id = p_station_id;
  -- Sent lines follow their station, so the kitchen screen of the target shows them.
  UPDATE public.order_items
     SET station_id = v_target.id,
         station_source = CASE WHEN v_target.id IS NULL THEN NULL ELSE station_source END
   WHERE restaurant_id = v_restaurant AND station_id = p_station_id;
  IF v_station.is_default THEN
    UPDATE public.stations SET is_default = false WHERE id = p_station_id;
    IF v_target.id IS NOT NULL THEN
      UPDATE public.stations SET is_default = true WHERE id = v_target.id;
    END IF;
  END IF;
  DELETE FROM public.stations WHERE id = p_station_id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.delete_station(uuid, uuid) IS 'Admin only: deletes a prep station of the caller''s restaurant after moving its category routes, dish exceptions and sent lines to p_move_to (a prep station of the same restaurant) in the same transaction; p_move_to may be NULL only when no other prep station exists (the routes are cleared). The default station passes to the target. Caja cannot be deleted.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.delete_station(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.delete_station(uuid, uuid) TO vipe_api;
