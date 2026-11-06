-- Floor plan: zones and table layout (odd/tasks/rediseno-pos.md, T3, S4).
--
-- 1. public.zones: the floors of a restaurant (name, aspect ratio width /
--    height, sort order, wall labels [{text, side}]), tenant RLS like tables.
-- 2. public.tables gains its place on a zone: x, y (centre) and w, h
--    normalized 0-1, shape, rotation in degrees and optional seats (NULL or 0
--    draws no chairs). number stays the identity the printer bridge prints.
--    The zone is referenced through (restaurant_id, zone_id), so a table can
--    only sit on a zone of its own restaurant, and a zone cannot change
--    restaurant while tables use it. A composite key instead of a consistency
--    trigger: both rows exist before the assignment, so no deferral is
--    needed, and the rule holds for every writer without code.
-- 3. Backfill: each restaurant with unplaced tables gets "Salón principal"
--    and its tables a grid in number order (seats left NULL: the admin sets
--    chairs, nothing is invented). Idempotent: only
--    tables without a zone are placed.
-- 4. zones joins realtime (the waiter map refreshes when the admin saves the
--    plan). The API ignores the new table name until
--    apps/api/src/realtime/change-event.ts lists it (T4).
CREATE TABLE public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    name text NOT NULL,
    aspect numeric DEFAULT 1.6 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    labels jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT zones_pkey PRIMARY KEY (id),
    CONSTRAINT zones_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT zones_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT zones_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT zones_aspect_check CHECK (aspect > 0.25 AND aspect < 4),
    -- An array of at most 12 {text: 1-40 characters, side: top|right|bottom|left}.
    CONSTRAINT zones_labels_check CHECK (
      CASE WHEN jsonb_typeof(labels) = 'array' THEN
        jsonb_array_length(labels) <= 12
        AND NOT jsonb_path_exists(labels, '$[*] ? (@.type() != "object"
          || !exists(@.text) || @.text.type() != "string" || !(@.text like_regex "^.{1,40}$") || !(@.text like_regex "[^ ]")
          || !exists(@.side) || @.side.type() != "string"
          || !(@.side == "top" || @.side == "right" || @.side == "bottom" || @.side == "left"))')
      ELSE false END
    )
);
--> statement-breakpoint
COMMENT ON TABLE public.zones IS 'Floors of a restaurant for the floor plan: name (unique per restaurant, case-insensitive), aspect = width / height, sort_order, wall labels [{text, side: top|right|bottom|left}]. Tables reference a zone through (restaurant_id, zone_id).';
--> statement-breakpoint
CREATE UNIQUE INDEX zones_restaurant_id_name_key ON public.zones USING btree (restaurant_id, lower(name));
--> statement-breakpoint
CREATE TRIGGER zones_set_updated_at BEFORE UPDATE ON public.zones
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY zones_delete_policy ON public.zones FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY zones_insert_policy ON public.zones FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY zones_select_policy ON public.zones FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY zones_update_policy ON public.zones FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.zones TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.tables
    ADD COLUMN zone_id uuid,
    ADD COLUMN x numeric,
    ADD COLUMN y numeric,
    ADD COLUMN w numeric,
    ADD COLUMN h numeric,
    ADD COLUMN shape text DEFAULT 'square' NOT NULL,
    ADD COLUMN rotation numeric DEFAULT 0 NOT NULL,
    ADD COLUMN seats integer,
    ADD CONSTRAINT tables_zone_id_fkey FOREIGN KEY (restaurant_id, zone_id) REFERENCES public.zones(restaurant_id, id) ON DELETE RESTRICT,
    -- A table is placed with all four coordinates or not at all.
    ADD CONSTRAINT tables_layout_check CHECK (num_nulls(x, y, w, h) IN (0, 4)),
    ADD CONSTRAINT tables_x_check CHECK (x >= 0 AND x <= 1),
    ADD CONSTRAINT tables_y_check CHECK (y >= 0 AND y <= 1),
    ADD CONSTRAINT tables_w_check CHECK (w > 0 AND w <= 1),
    ADD CONSTRAINT tables_h_check CHECK (h > 0 AND h <= 1),
    ADD CONSTRAINT tables_shape_check CHECK (shape IN ('round', 'square', 'rect', 'bar')),
    ADD CONSTRAINT tables_rotation_check CHECK (rotation >= 0 AND rotation < 360),
    ADD CONSTRAINT tables_seats_check CHECK (seats >= 0 AND seats <= 20);
--> statement-breakpoint
CREATE INDEX idx_tables_zone_id ON public.tables USING btree (zone_id);
--> statement-breakpoint
CREATE FUNCTION private.backfill_default_zones()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.zones (restaurant_id, name)
  SELECT DISTINCT t.restaurant_id, 'Salón principal' FROM public.tables t WHERE t.zone_id IS NULL
  ON CONFLICT (restaurant_id, pg_catalog.lower(name)) DO NOTHING;

  -- A square-ish grid per restaurant: cols = ceil(sqrt(n)), cell centres.
  WITH unplaced AS (
    SELECT t.id, t.restaurant_id,
           pg_catalog.row_number() OVER (PARTITION BY t.restaurant_id ORDER BY t.number, t.id) - 1 AS ord,
           pg_catalog.count(*) OVER (PARTITION BY t.restaurant_id) AS n
      FROM public.tables t
     WHERE t.zone_id IS NULL
  ), grid AS (
    SELECT u.id, u.restaurant_id, u.ord, g.cols, pg_catalog.ceil(u.n::numeric / g.cols) AS nrows
      FROM unplaced u
     CROSS JOIN LATERAL (SELECT pg_catalog.ceil(pg_catalog.sqrt(u.n::numeric)) AS cols) g
  )
  UPDATE public.tables t
     SET zone_id = z.id,
         x = pg_catalog.round(((g.ord % g.cols) + 0.5) / g.cols, 4),
         y = pg_catalog.round((pg_catalog.floor(g.ord / g.cols) + 0.5) / g.nrows, 4),
         w = pg_catalog.round(LEAST(0.12, 0.5 / g.cols, 0.5 / g.nrows), 4),
         h = pg_catalog.round(LEAST(0.12, 0.5 / g.cols, 0.5 / g.nrows), 4),
         seats = NULL
    FROM grid g
    JOIN public.zones z ON z.restaurant_id = g.restaurant_id AND pg_catalog.lower(z.name) = pg_catalog.lower('Salón principal')
   WHERE t.id = g.id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.backfill_default_zones() IS 'Places every table without a zone: creates "Salón principal" for its restaurant when missing and lays the unplaced tables on a grid in number order, seats left NULL (set by the admin). Idempotent. Run by migration 0012; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.backfill_default_zones() FROM PUBLIC;
--> statement-breakpoint
SELECT private.backfill_default_zones();
--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.zones
    FOR EACH ROW EXECUTE FUNCTION private.notify_change();
--> statement-breakpoint
COMMENT ON FUNCTION private.notify_change() IS 'AFTER row trigger on orders, order_items, tables, zones and order_deliveries: pg_notify(pos_changes, private.change_payload(...)). Delivered to listeners at COMMIT; rolled-back changes notify nothing.';
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
    ELSE
      RAISE EXCEPTION 'realtime_row: table % is not a realtime table', p_table USING ERRCODE = '22023';
  END CASE;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.realtime_row(text, uuid) IS 'Deliberate cross-tenant read for the API realtime listener: loads one row by primary key (order_id for order_deliveries) from orders, order_items, tables, zones or order_deliveries, bypassing RLS, so a change can be fanned out to the restaurant room named in the NOTIFY payload. Any other table raises 22023. NULL when the row no longer exists.';
