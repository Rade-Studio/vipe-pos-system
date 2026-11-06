-- Catalog and floor details (odd/tasks/rediseno-pos.md, T16, S8).
--
-- 1. public.dishes.sort_order: the order of a dish inside its group (category
--    and subcategory; dishes without category are their own group).
--    Backfill: a group whose dishes are all at 0 is numbered from 0 in
--    case-insensitive name order (id breaks ties), the order waiters see
--    today. Idempotent: a group with an order set is kept.
-- 2. public.dishes.quick_notes: modifier chips ("Término medio", "Sin
--    cebolla") that only append text to the item comment, no price. At most
--    12, each 1-30 characters after trim, no NULL, no duplicates (trimmed,
--    case-insensitive); private.quick_notes_valid() is the CHECK.
-- 3. public.tables.is_active: an inactive table takes no new order. Enforced
--    in the database for every writer: an order cannot be inserted on, or
--    moved to, an inactive table (23514 'table <id> is inactive'). Orders
--    already open stay as they are, and a split of such an order
--    (parent_order_id set) is still accepted. Deactivating a table never
--    fails. tables is already realtime (to_jsonb of the row), so the flag
--    reaches the map without a trigger change.
-- 4. public.zones.width_m / depth_m: real dimensions in metres, both or
--    neither, each > 0 and <= 200 (NaN refused).
-- 5. public.menu_publications: the menu structure waiters and delivery see
--    until the admin publishes again. Insert-only history; the latest row
--    (published_at DESC, id DESC) wins. Admin-only insert, readable by the
--    staff of the restaurant (tenant RLS); no UPDATE or DELETE
--    policy, so a row never changes. The publisher is a profile of the
--    same restaurant (composite key; NULL for the deploy backfill or when the
--    profile is deleted). Backfill: one publication per restaurant from the
--    current structure, so nothing changes for waiters on deploy.
--    The snapshot holds STRUCTURE only, as built by private.menu_structure():
--      {"categories":    {"<id>": {name, icon, color, sort_order, active}},
--       "subcategories": {"<id>": {category_id, name, sort_order, active}},
--       "dishes":        {"<id>": {name, category_id, subcategory_id, sort_order}}}
--    Prices, stock, dish availability (dishes.active) and quick notes stay
--    live and are never read from the snapshot.
--
-- Contract for the API (T20):
-- - Published tree: take the latest publication of the restaurant; order,
--   names, colours, icons, category/subcategory active flags and subcategory
--   membership come from the snapshot; every dish is joined by id to the live
--   row for price, active, stock and quick notes. An id of the snapshot that
--   no longer exists live is dropped; a live dish or category absent from the
--   snapshot is not shown until the next publication. A restaurant with no
--   publication (created after this migration and never published) serves
--   the live structure, as before.
-- - Pending changes: private.menu_pending_changes(<latest snapshot>,
--   private.menu_structure(<restaurant>)) = number of categories,
--   subcategories and dishes added, removed or changed in structure (0 when
--   there is no publication: show "sin publicar").
-- - Publish: SELECT * FROM public.publish_menu() as the admin (42501 for any
--   other role, through RLS); published_at is clock_timestamp().
-- - No realtime: the menu is read when an order starts (as in 0013);
--   menu_publications keeps no notify trigger.
ALTER TABLE public.dishes
    ADD COLUMN sort_order integer DEFAULT 0 NOT NULL,
    ADD COLUMN quick_notes text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_dishes_menu_order ON public.dishes USING btree (restaurant_id, category_id, subcategory_id, sort_order);
--> statement-breakpoint
CREATE FUNCTION private.backfill_dish_sort_order()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  WITH unordered AS (
    SELECT d.restaurant_id, d.category_id, d.subcategory_id FROM public.dishes d
     GROUP BY d.restaurant_id, d.category_id, d.subcategory_id
    HAVING pg_catalog.bool_and(d.sort_order = 0) AND pg_catalog.count(*) > 1
  ), numbered AS (
    SELECT d.id,
           pg_catalog.row_number() OVER (PARTITION BY d.restaurant_id, d.category_id, d.subcategory_id
                                         ORDER BY pg_catalog.lower(d.name), d.id) - 1 AS ord
      FROM public.dishes d
      JOIN unordered u ON u.restaurant_id = d.restaurant_id
                      AND u.category_id IS NOT DISTINCT FROM d.category_id
                      AND u.subcategory_id IS NOT DISTINCT FROM d.subcategory_id
  )
  UPDATE public.dishes d SET sort_order = n.ord
    FROM numbered n
   WHERE d.id = n.id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.backfill_dish_sort_order() IS 'Numbers from 0 the dishes of every (restaurant, category, subcategory) group whose dishes all have sort_order 0, in case-insensitive name order (id breaks ties). Idempotent: a group with an order set is untouched. Run by migration 0015; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.backfill_dish_sort_order() FROM PUBLIC;
--> statement-breakpoint
SELECT private.backfill_dish_sort_order();
--> statement-breakpoint
CREATE FUNCTION private.quick_notes_valid(p_notes text[])
    RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_notes IS NULL OR (
    pg_catalog.cardinality(p_notes) <= 12
    AND coalesce(pg_catalog.array_ndims(p_notes), 1) = 1
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(p_notes) n
       WHERE n IS NULL OR pg_catalog.length(pg_catalog.btrim(n)) NOT BETWEEN 1 AND 30)
    AND (SELECT pg_catalog.count(DISTINCT pg_catalog.lower(pg_catalog.btrim(n))) FROM pg_catalog.unnest(p_notes) n)
        = pg_catalog.cardinality(p_notes)
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.quick_notes_valid(text[]) IS 'CHECK of dishes.quick_notes: at most 12 entries, one dimension, each 1-30 characters after trim, no NULL entry, no duplicates (trimmed, case-insensitive). NULL passes (the column is NOT NULL).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.quick_notes_valid(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.quick_notes_valid(text[]) TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.dishes
    ADD CONSTRAINT dishes_quick_notes_check CHECK (private.quick_notes_valid(quick_notes));
--> statement-breakpoint
COMMENT ON COLUMN public.dishes.sort_order IS 'Order of the dish inside its (category, subcategory) group, from 0.';
--> statement-breakpoint
COMMENT ON COLUMN public.dishes.quick_notes IS 'Modifier chips offered when the dish is added; picking one appends its text to the item comment, no price. CHECK private.quick_notes_valid().';
--> statement-breakpoint
ALTER TABLE public.tables
    ADD COLUMN is_active boolean DEFAULT true NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN public.tables.is_active IS 'An inactive table takes no new order (orders_table_active trigger, 23514); its open orders are unaffected.';
--> statement-breakpoint
CREATE FUNCTION private.assert_order_table_active()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.table_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.parent_order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.id = NEW.table_id AND NOT t.is_active) THEN
    RAISE EXCEPTION 'table % is inactive', NEW.table_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.assert_order_table_active() IS 'BEFORE INSERT OR UPDATE OF table_id on orders: refuses (23514) a new order, or an order moved, onto an inactive table. A split (parent_order_id set) and orders that keep their table pass.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.assert_order_table_active() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER orders_table_active BEFORE INSERT OR UPDATE OF table_id ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.assert_order_table_active();
--> statement-breakpoint
ALTER TABLE public.zones
    ADD COLUMN width_m numeric,
    ADD COLUMN depth_m numeric,
    ADD CONSTRAINT zones_dimensions_check CHECK ((width_m IS NULL) = (depth_m IS NULL)),
    ADD CONSTRAINT zones_width_m_check CHECK (width_m > 0 AND width_m <= 200),
    ADD CONSTRAINT zones_depth_m_check CHECK (depth_m > 0 AND depth_m <= 200);
--> statement-breakpoint
COMMENT ON COLUMN public.zones.width_m IS 'Real width of the zone in metres (> 0, <= 200); set together with depth_m or not at all.';
--> statement-breakpoint
COMMENT ON COLUMN public.zones.depth_m IS 'Real depth of the zone in metres (> 0, <= 200); set together with width_m or not at all.';
--> statement-breakpoint
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
CREATE TABLE public.menu_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    published_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    published_by uuid,
    snapshot jsonb NOT NULL,
    CONSTRAINT menu_publications_pkey PRIMARY KEY (id),
    CONSTRAINT menu_publications_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT menu_publications_published_by_fkey FOREIGN KEY (restaurant_id, published_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (published_by),
    CONSTRAINT menu_publications_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);
--> statement-breakpoint
COMMENT ON TABLE public.menu_publications IS 'Published menu structure per restaurant (insert-only history; latest published_at, then id, wins). snapshot = private.menu_structure(): order, names, colours, icons, category/subcategory active flags, subcategory membership. Prices, stock, dish availability and quick notes stay live. No publication = the live structure is served.';
--> statement-breakpoint
CREATE INDEX idx_menu_publications_latest ON public.menu_publications USING btree (restaurant_id, published_at DESC, id DESC);
--> statement-breakpoint
ALTER TABLE public.menu_publications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY menu_publications_select_policy ON public.menu_publications FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY menu_publications_insert_policy ON public.menu_publications FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
-- The standard grants of a public table; no UPDATE or DELETE policy, so RLS
-- keeps the history insert-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.menu_publications TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.menu_structure(p_restaurant_id uuid)
    RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT pg_catalog.jsonb_build_object(
    'categories', coalesce((
      SELECT pg_catalog.jsonb_object_agg(c.id, pg_catalog.jsonb_build_object(
               'name', c.name, 'icon', c.icon, 'color', c.color, 'sort_order', c.sort_order, 'active', c.active))
        FROM public.categories c WHERE c.restaurant_id = p_restaurant_id), '{}'::jsonb),
    'subcategories', coalesce((
      SELECT pg_catalog.jsonb_object_agg(s.id, pg_catalog.jsonb_build_object(
               'category_id', s.category_id, 'name', s.name, 'sort_order', s.sort_order, 'active', s.active))
        FROM public.subcategories s WHERE s.restaurant_id = p_restaurant_id), '{}'::jsonb),
    'dishes', coalesce((
      SELECT pg_catalog.jsonb_object_agg(d.id, pg_catalog.jsonb_build_object(
               'name', d.name, 'category_id', d.category_id, 'subcategory_id', d.subcategory_id, 'sort_order', d.sort_order))
        FROM public.dishes d WHERE d.restaurant_id = p_restaurant_id), '{}'::jsonb)
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.menu_structure(uuid) IS 'Current menu structure of a restaurant, the shape of menu_publications.snapshot: {categories: {id: {name, icon, color, sort_order, active}}, subcategories: {id: {category_id, name, sort_order, active}}, dishes: {id: {name, category_id, subcategory_id, sort_order}}}. SECURITY INVOKER: under RLS another restaurant reads empty.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.menu_structure(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.menu_structure(uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.menu_pending_changes(p_published jsonb, p_live jsonb)
    RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT pg_catalog.count(*)::integer
    FROM pg_catalog.unnest(ARRAY['categories', 'subcategories', 'dishes']) k
   CROSS JOIN LATERAL (
     SELECT 1
       FROM pg_catalog.jsonb_each(coalesce(p_published OPERATOR(pg_catalog.->) k, '{}'::jsonb)) a
       FULL JOIN pg_catalog.jsonb_each(coalesce(p_live OPERATOR(pg_catalog.->) k, '{}'::jsonb)) b ON a.key = b.key
      WHERE a.value IS DISTINCT FROM b.value
   ) d
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.menu_pending_changes(jsonb, jsonb) IS 'Number of categories, subcategories and dishes added, removed or changed between two menu structures (a publication snapshot and private.menu_structure()). The "n cambios sin publicar" count.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.menu_pending_changes(jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.menu_pending_changes(jsonb, jsonb) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION public.publish_menu()
    RETURNS public.menu_publications
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  INSERT INTO public.menu_publications (restaurant_id, published_by, snapshot)
  SELECT private.current_restaurant_id(),
         (SELECT p.id FROM public.profiles p WHERE p.user_id = private.current_user_id()),
         private.menu_structure(private.current_restaurant_id())
  RETURNING *
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.publish_menu() IS 'Publishes the current menu structure of the caller restaurant as the caller profile. SECURITY INVOKER: the insert policy lets only an admin publish (42501 otherwise).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.publish_menu() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.publish_menu() TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.backfill_menu_publications()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.menu_publications (restaurant_id, published_at, published_by, snapshot)
  SELECT r.id, pg_catalog.now(), NULL, private.menu_structure(r.id)
    FROM public.restaurants r
   WHERE NOT EXISTS (SELECT 1 FROM public.menu_publications p WHERE p.restaurant_id = r.id);
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.backfill_menu_publications() IS 'Publishes the current structure of every restaurant without a publication (publisher NULL). Idempotent. Run by migration 0015; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.backfill_menu_publications() FROM PUBLIC;
--> statement-breakpoint
SELECT private.backfill_menu_publications();
