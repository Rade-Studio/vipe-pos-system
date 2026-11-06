-- Menu tree: category order and colour, subcategories, dishes in a
-- subcategory (odd/tasks/rediseno-pos.md, T7, S5). Waiter and delivery read
-- the same tree (S3).
--
-- 1. public.categories gains sort_order and color, a token of the closed set
--    of the menu tree design (yellow, orange, sky, violet, emerald, rose) plus
--    neutral, the default: existing categories get no invented colour (S8).
--    Backfill: a restaurant whose categories are all at sort_order 0 gets them
--    numbered from 0 in case-insensitive name order (id breaks ties), the
--    order the menu shows today. Idempotent: an order already set is kept.
-- 2. public.subcategories: the second order step of a category (name unique
--    per category, case-insensitive, sort order, active), tenant RLS like
--    zones. The category is referenced through (restaurant_id, category_id).
-- 3. public.dishes.subcategory_id references (restaurant_id, category_id,
--    subcategory_id), so a dish only sits in a subcategory of its own
--    restaurant and category; moving a dish to another category without
--    changing its subcategory fails, and a subcategory in use cannot move to
--    another category or be deleted. A composite key instead of a trigger,
--    as in 0012. The key is MATCH SIMPLE and dishes.category_id is nullable,
--    so a CHECK refuses a subcategory on a dish without a category.
-- 4. "Sin subcategorías" is derived, not stored: a category none of whose
--    dishes has a subcategory skips the subcategory step. The design's toggle
--    is a data change (merge the dishes into the category, or put them in a
--    first subcategory), so there is no flag that could disagree with the rows.
-- 5. No realtime: the menu is read when an order starts; categories,
--    subcategories and dishes keep no notify trigger and realtime_row is
--    unchanged.
ALTER TABLE public.categories
    ADD COLUMN sort_order integer DEFAULT 0 NOT NULL,
    ADD COLUMN color text DEFAULT 'neutral' NOT NULL,
    ADD CONSTRAINT categories_color_check CHECK (color IN ('neutral', 'yellow', 'orange', 'sky', 'violet', 'emerald', 'rose')),
    ADD CONSTRAINT categories_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
CREATE FUNCTION private.backfill_category_sort_order()
    RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  WITH unordered AS (
    SELECT c.restaurant_id FROM public.categories c
     GROUP BY c.restaurant_id
    HAVING pg_catalog.bool_and(c.sort_order = 0) AND pg_catalog.count(*) > 1
  ), numbered AS (
    SELECT c.id,
           pg_catalog.row_number() OVER (PARTITION BY c.restaurant_id ORDER BY pg_catalog.lower(c.name), c.id) - 1 AS ord
      FROM public.categories c
      JOIN unordered u ON u.restaurant_id = c.restaurant_id
  )
  UPDATE public.categories c SET sort_order = n.ord
    FROM numbered n
   WHERE c.id = n.id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.backfill_category_sort_order() IS 'Numbers from 0 the categories of every restaurant whose categories all have sort_order 0, in case-insensitive name order (id breaks ties). Idempotent: a restaurant with an order set is untouched. Run by migration 0013; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.backfill_category_sort_order() FROM PUBLIC;
--> statement-breakpoint
SELECT private.backfill_category_sort_order();
--> statement-breakpoint
CREATE TABLE public.subcategories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subcategories_pkey PRIMARY KEY (id),
    CONSTRAINT subcategories_restaurant_id_category_id_id_key UNIQUE (restaurant_id, category_id, id),
    CONSTRAINT subcategories_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT subcategories_category_id_fkey FOREIGN KEY (restaurant_id, category_id) REFERENCES public.categories(restaurant_id, id) ON DELETE RESTRICT,
    CONSTRAINT subcategories_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40)
);
--> statement-breakpoint
COMMENT ON TABLE public.subcategories IS 'Second order step of a category for the waiter and delivery pickers: name (unique per category, case-insensitive), sort_order, active. Dishes reference a subcategory through (restaurant_id, category_id, subcategory_id); a category none of whose dishes has a subcategory skips the step.';
--> statement-breakpoint
CREATE UNIQUE INDEX subcategories_category_id_name_key ON public.subcategories USING btree (category_id, lower(name));
--> statement-breakpoint
CREATE INDEX idx_subcategories_restaurant_id ON public.subcategories USING btree (restaurant_id);
--> statement-breakpoint
CREATE TRIGGER subcategories_set_updated_at BEFORE UPDATE ON public.subcategories
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subcategories_delete_policy ON public.subcategories FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY subcategories_insert_policy ON public.subcategories FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY subcategories_select_policy ON public.subcategories FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY subcategories_update_policy ON public.subcategories FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subcategories TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.dishes
    ADD COLUMN subcategory_id uuid,
    ADD CONSTRAINT dishes_subcategory_id_fkey FOREIGN KEY (restaurant_id, category_id, subcategory_id) REFERENCES public.subcategories(restaurant_id, category_id, id) ON DELETE RESTRICT,
    -- MATCH SIMPLE skips the key when category_id is NULL.
    ADD CONSTRAINT dishes_subcategory_category_check CHECK (subcategory_id IS NULL OR category_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_dishes_subcategory_id ON public.dishes USING btree (subcategory_id);
