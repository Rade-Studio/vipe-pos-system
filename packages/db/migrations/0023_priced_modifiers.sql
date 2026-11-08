-- Priced modifiers (odd/tasks/modificadores.md T1, S1-S5, L4).
--
-- 1. public.modifier_groups: reusable groups per restaurant ("Término",
--    "Adiciones de hamburguesa"). name trimmed 1..60, unique per restaurant
--    ignoring case; min_select 0..50; max_select NULL (no limit) or 1..50 and
--    >= min_select; required exactly when min_select >= 1 (a required group
--    takes at least one option, an optional group none). is_active, sort_order.
-- 2. public.modifier_options: the options of a group. name trimmed 1..60,
--    unique per group ignoring case; price numeric(10,2) >= 0 (0 is "Sin
--    cebolla"); ingredient_id (an ingredient of the same restaurant, RESTRICT)
--    and ingredient_qty > 0 set together or not at all; is_active, sort_order.
--    Deleting a group deletes its options and its dish links.
-- 3. public.dish_modifier_groups: which groups a dish offers, in sort_order;
--    PK (dish_id, group_id); dish and group of the same restaurant (composite
--    keys); deleting the dish or the group deletes the link.
-- 4. Catalog RLS: staff of the restaurant read; only an admin inserts,
--    updates or deletes (the ingredients pattern). Groups, options and links
--    are live, like prices and stock: menu publications do not snapshot them.
-- 5. public.order_item_modifiers: the snapshot of the options chosen on an
--    order line (group and option ids and names, price, ingredient and
--    quantity per unit, sort_order). No foreign key to the catalog, so a
--    renamed, repriced or deleted option never changes a sent line; deleting
--    the line (undo_split) deletes its rows. vipe_api only reads it (staff of
--    the restaurant); rows are written only by the SECURITY DEFINER functions
--    below, create_delivery_order and split_order.
-- 6. order_items.price stays the unit price the bill sums (L4): the dish price
--    (after promotion for table orders) plus the prices of the chosen options,
--    so recompute_order_bill, pay_order, voids and splits are unchanged.
-- 7. private.resolve_line_modifiers(dish, option ids): the one rule for a
--    line's options, used by the API (table orders) and create_delivery_order.
--    Every option must belong to an active group attached to the dish, be
--    active, appear once; every active group of the dish must get between
--    min_select and max_select options. Returns the snapshot rows (jsonb
--    array) in dish group order, then option order. SECURITY INVOKER with an
--    explicit tenant filter (another restaurant's ids are modifier_invalid).
-- 8. private.add_order_item_modifiers(line, option ids): the API's writer of
--    the snapshot. The line must be of the caller's restaurant, created in
--    the current transaction (created_at = now()) and without modifiers yet, so an existing line
--    never gains options after it was priced.
-- 9. public.create_delivery_order: each item may carry option_ids (array of
--    uuids); the line price is the dish price plus the options, the snapshot
--    is written with the line, the subtotal groups lines by (dish, unit price).
-- 10. public.consume_order_stock: also deducts each option ingredient,
--    ingredient_qty x line quantity, summed with the recipe per ingredient,
--    once per line (stock_consumed_at, unchanged).
-- 11. public.split_order copies the snapshot to the new line of a partial
--    split (a full move keeps the line and its rows); public.undo_split merges
--    a child line only into a parent line with the same options.
-- 12. dishes.quick_notes is dropped with its CHECK, trigger and functions
--    (S5: every environment is a test environment, L3).
--
-- Errors: 22023 with the message prefix modifier_invalid (unknown option,
-- another restaurant's, or not offered by the dish), modifier_inactive
-- (inactive option or group), modifier_duplicate (an option twice),
-- modifier_required (fewer than min_select in a group), modifier_max (more
-- than max_select); 22023 add_order_item_modifiers (line not new or already
-- has options), P0002 add_order_item_modifiers (unknown line); 23514
-- modifier_groups_name_check, modifier_groups_select_check,
-- modifier_options_name_check, modifier_options_price_check,
-- modifier_options_ingredient_check; 23505 modifier_groups_restaurant_id_name_key,
-- modifier_options_group_id_name_key; 23503 for a dish, group or ingredient
-- of another restaurant; 42501 a catalog write by a non-admin (RLS).
ALTER TABLE public.dishes ADD CONSTRAINT dishes_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
CREATE TABLE public.modifier_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    name text NOT NULL,
    required boolean DEFAULT false NOT NULL,
    min_select integer DEFAULT 0 NOT NULL,
    max_select integer,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT modifier_groups_pkey PRIMARY KEY (id),
    CONSTRAINT modifier_groups_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT modifier_groups_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id),
    CONSTRAINT modifier_groups_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60 AND name = btrim(name)),
    CONSTRAINT modifier_groups_select_check CHECK (
      min_select BETWEEN 0 AND 50
      AND (max_select IS NULL OR (max_select BETWEEN 1 AND 50 AND max_select >= min_select))
      AND required = (min_select >= 1))
);
--> statement-breakpoint
COMMENT ON TABLE public.modifier_groups IS 'Reusable modifier group of a restaurant (Término, Adiciones): required exactly when min_select >= 1; max_select NULL = no limit. Assigned to dishes through dish_modifier_groups; live (not in menu publications).';
--> statement-breakpoint
CREATE UNIQUE INDEX modifier_groups_restaurant_id_name_key ON public.modifier_groups USING btree (restaurant_id, lower(name));
--> statement-breakpoint
CREATE TRIGGER modifier_groups_set_updated_at BEFORE UPDATE ON public.modifier_groups
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TABLE public.modifier_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    group_id uuid NOT NULL,
    name text NOT NULL,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    ingredient_id uuid,
    ingredient_qty numeric(14,3),
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT modifier_options_pkey PRIMARY KEY (id),
    CONSTRAINT modifier_options_group_id_fkey FOREIGN KEY (restaurant_id, group_id) REFERENCES public.modifier_groups(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT modifier_options_ingredient_id_fkey FOREIGN KEY (restaurant_id, ingredient_id) REFERENCES public.ingredients(restaurant_id, id) ON DELETE RESTRICT,
    CONSTRAINT modifier_options_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60 AND name = btrim(name)),
    CONSTRAINT modifier_options_price_check CHECK (price >= 0),
    CONSTRAINT modifier_options_ingredient_check CHECK ((ingredient_id IS NULL) = (ingredient_qty IS NULL) AND (ingredient_qty IS NULL OR ingredient_qty > 0))
);
--> statement-breakpoint
COMMENT ON TABLE public.modifier_options IS 'Option of a modifier group: price added to the line (>= 0) and, optionally, ingredient_qty of ingredient_id deducted per unit by consume_order_stock.';
--> statement-breakpoint
CREATE UNIQUE INDEX modifier_options_group_id_name_key ON public.modifier_options USING btree (group_id, lower(name));
--> statement-breakpoint
CREATE INDEX idx_modifier_options_ingredient_id ON public.modifier_options USING btree (ingredient_id) WHERE (ingredient_id IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER modifier_options_set_updated_at BEFORE UPDATE ON public.modifier_options
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TABLE public.dish_modifier_groups (
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    dish_id uuid NOT NULL,
    group_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT dish_modifier_groups_pkey PRIMARY KEY (dish_id, group_id),
    CONSTRAINT dish_modifier_groups_dish_id_fkey FOREIGN KEY (restaurant_id, dish_id) REFERENCES public.dishes(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT dish_modifier_groups_group_id_fkey FOREIGN KEY (restaurant_id, group_id) REFERENCES public.modifier_groups(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.dish_modifier_groups IS 'Groups a dish offers, in sort_order. Same restaurant through the composite keys.';
--> statement-breakpoint
CREATE INDEX idx_dish_modifier_groups_group_id ON public.dish_modifier_groups USING btree (group_id);
--> statement-breakpoint
CREATE TABLE public.order_item_modifiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    group_id uuid NOT NULL,
    group_name text NOT NULL,
    option_id uuid NOT NULL,
    option_name text NOT NULL,
    price numeric(10,2) NOT NULL,
    ingredient_id uuid,
    ingredient_qty numeric(14,3),
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_item_modifiers_pkey PRIMARY KEY (id),
    CONSTRAINT order_item_modifiers_order_item_id_option_id_key UNIQUE (order_item_id, option_id),
    CONSTRAINT order_item_modifiers_item_fkey FOREIGN KEY (restaurant_id, order_item_id) REFERENCES public.order_items(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT order_item_modifiers_price_check CHECK (price >= 0),
    CONSTRAINT order_item_modifiers_ingredient_check CHECK ((ingredient_id IS NULL) = (ingredient_qty IS NULL) AND (ingredient_qty IS NULL OR ingredient_qty > 0))
);
--> statement-breakpoint
COMMENT ON TABLE public.order_item_modifiers IS 'Snapshot of the options chosen on an order line: names, price (already inside order_items.price) and ingredient per unit. No catalog foreign key: a sent line never changes. Written only by private.add_order_item_modifiers, create_delivery_order and split_order; vipe_api reads.';
--> statement-breakpoint
CREATE INDEX idx_order_item_modifiers_order_item_id ON public.order_item_modifiers USING btree (order_item_id, sort_order);
--> statement-breakpoint
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.modifier_options ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.dish_modifier_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY modifier_groups_select_policy ON public.modifier_groups FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY modifier_groups_insert_policy ON public.modifier_groups FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY modifier_groups_update_policy ON public.modifier_groups FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY modifier_groups_delete_policy ON public.modifier_groups FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY modifier_options_select_policy ON public.modifier_options FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY modifier_options_insert_policy ON public.modifier_options FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY modifier_options_update_policy ON public.modifier_options FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY modifier_options_delete_policy ON public.modifier_options FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_modifier_groups_select_policy ON public.dish_modifier_groups FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY dish_modifier_groups_insert_policy ON public.dish_modifier_groups FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_modifier_groups_update_policy ON public.dish_modifier_groups FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_modifier_groups_delete_policy ON public.dish_modifier_groups FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY order_item_modifiers_select_policy ON public.order_item_modifiers FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.modifier_groups TO vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.modifier_options TO vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dish_modifier_groups TO vipe_api;
--> statement-breakpoint
-- Read only (the default privileges grant every DML): the snapshot is
-- written by the SECURITY DEFINER functions.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.order_item_modifiers FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.order_item_modifiers TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.resolve_line_modifiers(p_dish_id uuid, p_option_ids uuid[])
    RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant uuid := private.current_restaurant_id();
  v_ids    uuid[] := coalesce(p_option_ids, '{}'::uuid[]);
  v_bad    uuid;
  v_group  record;
  v_result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_ids) i WHERE i IS NULL) THEN
    RAISE EXCEPTION 'modifier_invalid: Opción desconocida' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.cardinality(v_ids) <> (SELECT pg_catalog.count(DISTINCT i) FROM pg_catalog.unnest(v_ids) i) THEN
    RAISE EXCEPTION 'modifier_duplicate: Una opción no se puede elegir dos veces' USING ERRCODE = '22023';
  END IF;

  SELECT i INTO v_bad
    FROM pg_catalog.unnest(v_ids) i
   WHERE NOT EXISTS (
     SELECT 1 FROM public.modifier_options o
       JOIN public.dish_modifier_groups dg ON dg.group_id = o.group_id AND dg.restaurant_id = o.restaurant_id
      WHERE o.id = i AND o.restaurant_id = v_tenant AND dg.dish_id = p_dish_id)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'modifier_invalid: La opción % no está disponible para este plato', v_bad USING ERRCODE = '22023';
  END IF;

  SELECT o.id INTO v_bad
    FROM public.modifier_options o
    JOIN public.modifier_groups g ON g.id = o.group_id
   WHERE o.id = ANY (v_ids) AND (NOT o.is_active OR NOT g.is_active)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'modifier_inactive: Una opción elegida ya no está disponible' USING ERRCODE = '22023';
  END IF;

  FOR v_group IN
    SELECT g.name, g.min_select, g.max_select, pg_catalog.count(o.id) AS chosen
      FROM public.dish_modifier_groups dg
      JOIN public.modifier_groups g ON g.id = dg.group_id AND g.restaurant_id = dg.restaurant_id
      LEFT JOIN public.modifier_options o ON o.group_id = g.id AND o.id = ANY (v_ids)
     WHERE dg.dish_id = p_dish_id AND dg.restaurant_id = v_tenant AND g.is_active
     GROUP BY g.id, g.name, g.min_select, g.max_select, dg.sort_order
     ORDER BY dg.sort_order, pg_catalog.lower(g.name), g.id
  LOOP
    IF v_group.chosen < v_group.min_select THEN
      RAISE EXCEPTION 'modifier_required: Elige al menos % en "%"', v_group.min_select, v_group.name USING ERRCODE = '22023';
    END IF;
    IF v_group.max_select IS NOT NULL AND v_group.chosen > v_group.max_select THEN
      RAISE EXCEPTION 'modifier_max: Elige máximo % en "%"', v_group.max_select, v_group.name USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'group_id', x.group_id, 'group_name', x.group_name, 'option_id', x.option_id, 'option_name', x.option_name,
           'price', x.price, 'ingredient_id', x.ingredient_id, 'ingredient_qty', x.ingredient_qty, 'sort_order', x.ord) ORDER BY x.ord),
         '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT g.id AS group_id, g.name AS group_name, o.id AS option_id, o.name AS option_name, o.price,
             o.ingredient_id, o.ingredient_qty,
             pg_catalog.row_number() OVER (ORDER BY dg.sort_order, pg_catalog.lower(g.name), g.id,
                                                    o.sort_order, pg_catalog.lower(o.name), o.id) - 1 AS ord
        FROM public.modifier_options o
        JOIN public.modifier_groups g ON g.id = o.group_id
        JOIN public.dish_modifier_groups dg ON dg.group_id = g.id AND dg.dish_id = p_dish_id
       WHERE o.id = ANY (v_ids) AND o.restaurant_id = v_tenant) x;
  RETURN v_result;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.resolve_line_modifiers(uuid, uuid[]) IS 'The options of one order line, validated for the dish of the caller restaurant: each option once (modifier_duplicate), offered by the dish (modifier_invalid, also for another restaurant), active with an active group (modifier_inactive), and every active group of the dish between min_select (modifier_required) and max_select (modifier_max); 22023 with that prefix and a Spanish message. Returns the snapshot rows [{group_id, group_name, option_id, option_name, price, ingredient_id, ingredient_qty, sort_order}] in dish group order, then option order. NULL or empty: the rules alone. SECURITY INVOKER.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.resolve_line_modifiers(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.resolve_line_modifiers(uuid, uuid[]) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.write_order_item_modifiers(p_restaurant_id uuid, p_order_item_id uuid, p_snapshot jsonb)
    RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  INSERT INTO public.order_item_modifiers
    (restaurant_id, order_item_id, group_id, group_name, option_id, option_name, price, ingredient_id, ingredient_qty, sort_order)
  SELECT p_restaurant_id, p_order_item_id, x.group_id, x.group_name, x.option_id, x.option_name, x.price,
         x.ingredient_id, x.ingredient_qty, x.sort_order
    FROM pg_catalog.jsonb_to_recordset(coalesce(p_snapshot, '[]'::jsonb))
           AS x(group_id uuid, group_name text, option_id uuid, option_name text, price numeric,
                ingredient_id uuid, ingredient_qty numeric, sort_order integer)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.write_order_item_modifiers(uuid, uuid, jsonb) IS 'Inserts the snapshot rows of private.resolve_line_modifiers() for one order line. Called by SECURITY DEFINER writers only; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.write_order_item_modifiers(uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.add_order_item_modifiers(p_order_item_id uuid, p_option_ids uuid[])
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_tenant   uuid := private.current_restaurant_id();
  v_dish_id  uuid;
  v_fresh    boolean;
  v_snapshot jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'add_order_item_modifiers: the caller has no profile' USING ERRCODE = '42501';
  END IF;
  -- created_at defaults to now(), the transaction start: a line of this transaction.
  SELECT oi.dish_id, oi.created_at IS NOT DISTINCT FROM now() INTO v_dish_id, v_fresh
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id AND oi.restaurant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add_order_item_modifiers: order item % not found', p_order_item_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_fresh OR EXISTS (SELECT 1 FROM public.order_item_modifiers m WHERE m.order_item_id = p_order_item_id) THEN
    RAISE EXCEPTION 'add_order_item_modifiers: options are written only with a new line' USING ERRCODE = '22023';
  END IF;
  v_snapshot := private.resolve_line_modifiers(v_dish_id, p_option_ids);
  PERFORM private.write_order_item_modifiers(v_tenant, p_order_item_id, v_snapshot);
  RETURN v_snapshot;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.add_order_item_modifiers(uuid, uuid[]) IS 'Writes the option snapshot of an order line the caller inserted in the current transaction (POST /orders, POST /orders/:id/items), validated by private.resolve_line_modifiers(). P0002 unknown line (or another restaurant); 22023 a line from an earlier transaction or with options already; 42501 no profile. The caller prices the line with the same options first. Returns the snapshot.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.add_order_item_modifiers(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.add_order_item_modifiers(uuid, uuid[]) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.order_item_modifier_key(p_order_item_id uuid)
    RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(pg_catalog.string_agg(m.option_id::text || ':' || m.price::text, ',' ORDER BY m.option_id), '')
    FROM public.order_item_modifiers m
   WHERE m.order_item_id = p_order_item_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.order_item_modifier_key(uuid) IS 'The options of a line (option id and price, in id order) as one text; '''' without options. undo_split merges only lines with the same key.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.order_item_modifier_key(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_prepaid_method_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_customer_id     uuid;
  v_customer_name   text;
  v_customer_phone  text;
  v_address_id      uuid := NULL;
  v_addr_customer_id uuid;
  v_address_line    text;
  v_address_neigh   text;
  v_address_ref     text;
  v_address_label   text;

  v_items_count     integer;
  v_item            jsonb;
  v_line_no         integer;
  v_dish_id         uuid;
  v_dish_qty        integer;
  v_dish_comments   text;

  v_distinct_dishes uuid[] := '{}'::uuid[];
  v_option_ids      uuid[];
  v_lines           jsonb := '[]'::jsonb;
  v_line            jsonb;
  v_snapshot        jsonb;
  v_item_id         uuid;

  v_subtotal        bigint := 0;
  v_tax_pct         numeric := 0;
  v_tax             bigint := 0;
  v_total           bigint := 0;

  v_order_id        uuid;
  v_fee             bigint;
  v_change          bigint;

  v_method_active   boolean;

  v_now             timestamptz := now();
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'create_delivery_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'create_delivery_order: only admin or delivery_operator may take a delivery order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id()
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'create_delivery_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_customer IS NULL OR jsonb_typeof(p_customer) <> 'object' THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN
    RAISE EXCEPTION 'create_delivery_order: p_address must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'create_delivery_order: p_items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  v_items_count := jsonb_array_length(p_items);
  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'create_delivery_order: p_items must be a non-empty array'
      USING ERRCODE = '22023';
  END IF;

  IF v_items_count > 100 THEN
    RAISE EXCEPTION 'create_delivery_order: p_items accepts at most 100 lines'
      USING ERRCODE = '22023';
  END IF;

  IF p_delivery_fee IS NULL OR p_delivery_fee < 0 THEN
    RAISE EXCEPTION 'create_delivery_order: p_delivery_fee must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(btrim(coalesce(p_notes, ''))) > 300 THEN
    RAISE EXCEPTION 'create_delivery_order: p_notes accepts at most 300 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_mode IS NULL OR p_payment_mode NOT IN ('prepaid', 'cash_on_delivery') THEN
    RAISE EXCEPTION 'create_delivery_order: p_payment_mode must be ''prepaid'' or ''cash_on_delivery'''
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_mode = 'cash_on_delivery' THEN
    IF p_cash_change_for IS NOT NULL AND p_cash_change_for < 0 THEN
      RAISE EXCEPTION 'create_delivery_order: p_cash_change_for must be a non-negative integer (or NULL)'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_cash_change_for IS NOT NULL THEN
      RAISE EXCEPTION 'create_delivery_order: p_cash_change_for must be NULL when p_payment_mode = ''prepaid'''
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Prepaid channel: an active payment method of the caller's restaurant,
  -- only on a prepaid order.
  IF p_prepaid_method_id IS NOT NULL THEN
    IF p_payment_mode <> 'prepaid' THEN
      RAISE EXCEPTION 'create_delivery_order: p_prepaid_method_id is only allowed when p_payment_mode = ''prepaid'''
        USING ERRCODE = '22023';
    END IF;

    SELECT pm.is_active INTO v_method_active
      FROM public.payment_methods pm
     WHERE pm.id = p_prepaid_method_id
       AND pm.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'create_delivery_order: payment method % not found', p_prepaid_method_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_method_active THEN
      RAISE EXCEPTION 'create_delivery_order: payment method % is not active', p_prepaid_method_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 3. Customer.
  IF (p_customer ? 'id') AND (p_customer ? 'phone') THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must carry either id or phone, not both'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_customer ? 'id') AND NOT (p_customer ? 'phone') THEN
    RAISE EXCEPTION 'create_delivery_order: p_customer must carry id or phone'
      USING ERRCODE = '22023';
  END IF;

  IF p_customer ? 'id' THEN
    BEGIN
      v_customer_id := (p_customer ->> 'id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: p_customer.id is not a uuid'
        USING ERRCODE = '22023';
    END;

    SELECT c.id, c.name, c.phone
      INTO v_customer_id, v_customer_name, v_customer_phone
      FROM public.customers c
     WHERE c.id = v_customer_id
       AND c.restaurant_id = v_caller_tenant;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'create_delivery_order: customer % not found', (p_customer ->> 'id')
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- p_customer ? 'phone' (guaranteed by the xor above)
    v_customer_phone := btrim(coalesce(p_customer ->> 'phone', ''));
    IF v_customer_phone !~ '^[0-9]{7,15}$' THEN
      RAISE EXCEPTION 'create_delivery_order: p_customer.phone must match 7..15 digits'
        USING ERRCODE = '22023';
    END IF;

    SELECT c.id, c.name, c.phone
      INTO v_customer_id, v_customer_name, v_customer_phone
      FROM public.customers c
     WHERE c.phone = v_customer_phone
       AND c.restaurant_id = v_caller_tenant;

    IF v_customer_id IS NULL THEN
      -- New customer: name is required. Use the request's name, not its
      -- phone (the previous version of this block had a copy-paste that
      -- assigned the phone to the name variable).
      v_customer_name := btrim(coalesce(p_customer ->> 'name', ''));
      IF v_customer_name = '' OR length(v_customer_name) > 120 THEN
        RAISE EXCEPTION 'create_delivery_order: p_customer.name is required when creating a new customer (1..120 chars)'
          USING ERRCODE = '22023';
      END IF;

      -- v_customer_phone was overwritten by the zero-rows INTO above; re-set
      -- it from the request so the INSERT has the right value.
      v_customer_phone := btrim(p_customer ->> 'phone');

      INSERT INTO public.customers (restaurant_id, phone, name)
      VALUES (v_caller_tenant, v_customer_phone, v_customer_name)
      RETURNING id, name, phone
        INTO v_customer_id, v_customer_name, v_customer_phone;
    ELSE
      -- Existing customer: update name only when the request carries a
      -- different value (btrim-collapsed, length 1..120).
      DECLARE
        v_requested_name text := btrim(coalesce(p_customer ->> 'name', ''));
      BEGIN
        IF v_requested_name <> '' AND length(v_requested_name) <= 120
           AND v_requested_name IS DISTINCT FROM v_customer_name THEN
          UPDATE public.customers c
             SET name = v_requested_name
           WHERE c.id = v_customer_id;
          v_customer_name := v_requested_name;
        END IF;
      END;
    END IF;
  END IF;

  -- 4. Address.
  IF (p_address ? 'id') AND (p_address ? 'address_line') THEN
    RAISE EXCEPTION 'create_delivery_order: p_address must carry either id or address_line, not both'
      USING ERRCODE = '22023';
  END IF;

  IF p_address ? 'id' THEN
    BEGIN
      v_address_id := (p_address ->> 'id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.id is not a uuid'
        USING ERRCODE = '22023';
    END;

    SELECT a.id, a.customer_id, a.address_line, a.neighborhood, a.reference, a.label
      INTO v_address_id, v_addr_customer_id, v_address_line, v_address_neigh, v_address_ref, v_address_label
      FROM public.customer_addresses a
     WHERE a.id = v_address_id
       AND a.restaurant_id = v_caller_tenant;

    IF v_address_id IS NULL THEN
      RAISE EXCEPTION 'create_delivery_order: address % not found', (p_address ->> 'id')
        USING ERRCODE = 'P0002';
    END IF;

    -- The address must belong to the customer we resolved above. Without
    -- this check, the address's customer_id could silently overwrite
    -- v_customer_id and the order would be billed/snapshotted against the
    -- wrong customer.
    IF v_addr_customer_id IS DISTINCT FROM v_customer_id THEN
      RAISE EXCEPTION 'create_delivery_order: address % does not belong to the resolved customer',
        v_address_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_address_line := btrim(coalesce(p_address ->> 'address_line', ''));
    IF v_address_line = '' OR length(v_address_line) > 200 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.address_line is required (1..200 chars)'
        USING ERRCODE = '22023';
    END IF;
    v_address_neigh := NULLIF(btrim(coalesce(p_address ->> 'neighborhood', '')), '');
    v_address_ref   := NULLIF(btrim(coalesce(p_address ->> 'reference',    '')), '');
    v_address_label := NULLIF(btrim(coalesce(p_address ->> 'label',        '')), '');

    IF v_address_neigh IS NOT NULL AND length(v_address_neigh) > 80 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.neighborhood must be <= 80 chars'
        USING ERRCODE = '22023';
    END IF;
    IF v_address_ref IS NOT NULL AND length(v_address_ref) > 200 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.reference must be <= 200 chars'
        USING ERRCODE = '22023';
    END IF;
    IF v_address_label IS NOT NULL AND length(v_address_label) > 40 THEN
      RAISE EXCEPTION 'create_delivery_order: p_address.label must be <= 40 chars'
        USING ERRCODE = '22023';
    END IF;

    IF coalesce((p_address ->> 'save')::boolean, false) THEN
      INSERT INTO public.customer_addresses (
        restaurant_id, customer_id, label, address_line, neighborhood, reference, is_default
      ) VALUES (
        v_caller_tenant, v_customer_id, v_address_label, v_address_line, v_address_neigh, v_address_ref, false
      )
      RETURNING id INTO v_address_id;
    END IF;
  END IF;

  -- 5. Items: collect distinct dish_ids, then resolve server-side.
  FOR v_line_no IN 1..v_items_count LOOP
    v_item := p_items -> (v_line_no - 1);

    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_item ? 'dish_id') THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] is missing dish_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_dish_id := (v_item ->> 'dish_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].dish_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_item ? 'quantity') THEN
      RAISE EXCEPTION 'create_delivery_order: item[%] is missing quantity', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_dish_qty := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].quantity is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_dish_qty IS NULL OR v_dish_qty < 1 OR v_dish_qty > 999 THEN
      RAISE EXCEPTION 'create_delivery_order: item[%].quantity must be between 1 and 999', v_line_no
        USING ERRCODE = '22023';
    END IF;

    v_option_ids := NULL;
    IF v_item ? 'option_ids' AND jsonb_typeof(v_item -> 'option_ids') <> 'null' THEN
      IF jsonb_typeof(v_item -> 'option_ids') <> 'array' THEN
        RAISE EXCEPTION 'create_delivery_order: item[%].option_ids must be an array of uuids', v_line_no
          USING ERRCODE = '22023';
      END IF;
      BEGIN
        SELECT array_agg(x::uuid ORDER BY o) INTO v_option_ids
          FROM jsonb_array_elements_text(v_item -> 'option_ids') WITH ORDINALITY AS e(x, o);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'create_delivery_order: item[%].option_ids must be an array of uuids', v_line_no
          USING ERRCODE = '22023';
      END;
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'dish_id', v_dish_id, 'quantity', v_dish_qty, 'option_ids', to_jsonb(coalesce(v_option_ids, '{}'::uuid[]))));

    IF NOT (v_dish_id = ANY (v_distinct_dishes)) THEN
      v_distinct_dishes := v_distinct_dishes || v_dish_id;
    END IF;
  END LOOP;

  -- Server-side price/name resolution: every distinct dish_id must resolve to
  -- a row of the caller's tenant. The SELECT goes against public.dishes (RLS
  -- is bypassed by SECURITY DEFINER + owner postgres, but the tenant filter
  -- is the same one the policies apply for an authenticated caller).
  IF EXISTS (
    SELECT 1
      FROM unnest(v_distinct_dishes) AS d(dish_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.dishes di
        WHERE di.id = d.dish_id
          AND di.restaurant_id = v_caller_tenant
     )
  ) THEN
    RAISE EXCEPTION 'create_delivery_order: one or more dish_id values do not resolve to a menu item of the caller tenant'
      USING ERRCODE = 'P0002';
  END IF;

  -- Options (F7): validated per line for its dish, the unit price is the
  -- dish price plus the options. Lines without options price as before.
  FOR v_line_no IN 1..v_items_count LOOP
    v_line := v_lines -> (v_line_no - 1);
    v_snapshot := private.resolve_line_modifiers(
      (v_line ->> 'dish_id')::uuid,
      ARRAY(SELECT jsonb_array_elements_text(v_line -> 'option_ids')::uuid));
    v_lines := jsonb_set(v_lines, ARRAY[(v_line_no - 1)::text], v_line || jsonb_build_object(
      'snapshot', v_snapshot,
      'unit_price', (SELECT di.price FROM public.dishes di
                      WHERE di.id = (v_line ->> 'dish_id')::uuid AND di.restaurant_id = v_caller_tenant)
                    + (SELECT coalesce(sum((s ->> 'price')::numeric), 0) FROM jsonb_array_elements(v_snapshot) s)));
  END LOOP;

  -- 6. Bill: subtotal / tax / total. tax_percentage comes from business_config.
  -- Server-side aggregation: lines of the same dish and unit price collapse
  -- into one row, then subtotal is sum(round(unit_price * qty)).
  SELECT coalesce(sum(round(g.unit_price * g.q)), 0)::bigint
    INTO v_subtotal
    FROM (
      SELECT (l ->> 'dish_id') AS dish_id, (l ->> 'unit_price')::numeric AS unit_price, sum((l ->> 'quantity')::integer) AS q
        FROM jsonb_array_elements(v_lines) l
       GROUP BY 1, 2
    ) g;

  SELECT coalesce(nullif(bc.value, '')::numeric, 0)
    INTO v_tax_pct
    FROM public.business_config bc
   WHERE bc.restaurant_id = v_caller_tenant
     AND bc.key = 'tax_percentage'
   LIMIT 1;

  v_tax   := round((v_subtotal * coalesce(v_tax_pct, 0) / 100)::numeric)::bigint;
  v_total := v_subtotal + v_tax;

  -- 7. Order.
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id,
    order_type
  ) VALUES (
    v_caller_tenant, NULL, v_caller_profile, 'kitchen',
    v_subtotal, v_tax, coalesce(v_tax_pct, 0), 0, 0, v_total,
    0, false, NULL,
    'delivery'
  )
  RETURNING id INTO v_order_id;

  -- 8. order_items: one row per requested line, with name/price from the menu.
  FOR v_line_no IN 1..v_items_count LOOP
    v_item := p_items -> (v_line_no - 1);
    v_dish_id := (v_item ->> 'dish_id')::uuid;
    v_dish_qty := (v_item ->> 'quantity')::integer;
    v_dish_comments := NULLIF(btrim(coalesce(v_item ->> 'comments', '')), '');

    v_line := v_lines -> (v_line_no - 1);

    INSERT INTO public.order_items (
      order_id, dish_id, name, price, quantity, comments,
      status, added_at, restaurant_id
    )
    SELECT v_order_id, di.id, di.name, (v_line ->> 'unit_price')::numeric, v_dish_qty, v_dish_comments,
           'kitchen', v_now, v_caller_tenant
      FROM public.dishes di
     WHERE di.id = v_dish_id
       AND di.restaurant_id = v_caller_tenant
    RETURNING id INTO v_item_id;

    PERFORM private.write_order_item_modifiers(v_caller_tenant, v_item_id, v_line -> 'snapshot');
  END LOOP;

  -- 9. order_deliveries (1:1 mirror).
  v_fee   := p_delivery_fee;
  v_change := CASE WHEN p_payment_mode = 'cash_on_delivery' THEN p_cash_change_for
                   ELSE NULL END;

  INSERT INTO public.order_deliveries (
    order_id, restaurant_id, customer_id,
    customer_name, customer_phone,
    address_line, neighborhood, address_reference,
    delivery_fee, payment_mode, cash_change_for,
    delivery_status, notes, prepaid_method_id
  ) VALUES (
    v_order_id, v_caller_tenant, v_customer_id,
    v_customer_name, v_customer_phone,
    v_address_line, v_address_neigh, v_address_ref,
    v_fee, p_payment_mode, v_change,
    'received', nullif(btrim(coalesce(p_notes, '')), ''), p_prepaid_method_id
  );

  RETURN jsonb_build_object(
    'order_id',    v_order_id,
    'customer_id', v_customer_id,
    'address_id',  v_address_id,
    'delivery', (
      SELECT to_jsonb(od)
        FROM public.order_deliveries od
       WHERE od.order_id = v_order_id
    )
  );
END;
$_$;
--> statement-breakpoint
COMMENT ON FUNCTION public.create_delivery_order(p_customer jsonb, p_address jsonb, p_items jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for bigint, p_notes text, p_prepaid_method_id uuid) IS 'Atomic delivery-order intake. SECURITY DEFINER. Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-admin/delivery_operator). Resolves or creates the customer by normalized phone (or by id when given) within the tenant; updates the existing customer''s name only when the request carries a different value. Resolves the address (an existing id must belong to that customer, or a new address is saved to the registry only when save=true). Validates p_items (1..100 lines, quantity 1..999), p_delivery_fee (>= 0, set per order by the operator), p_payment_mode (prepaid | cash_on_delivery), p_cash_change_for (only for COD, >= 0), p_prepaid_method_id (optional, only for prepaid: an active payment method of the tenant; P0002 when unknown or foreign, 22023 when inactive). Resolves each dish_id server-side from public.dishes and takes name/price from the menu (the client never sets the price). Each item may carry option_ids (F7, 0023): validated by private.resolve_line_modifiers() (22023 modifier_*), the line price is the dish price plus the options and the option snapshot is written to order_item_modifiers; lines of the same dish and unit price collapse in the subtotal. Inserts the order (order_type=delivery, table_id NULL, status=kitchen, waiter_id = caller profile, tax_percentage from business_config, tax/tip/total computed server-side), the order_items, and the order_deliveries row (snapshot of customer/address, fee, payment_mode, prepaid_method_id, delivery_status=received). p_notes (trimmed, empty -> NULL, max 300) is stored on order_deliveries.notes. Returns jsonb with order_id, customer_id, address_id (NULL when save=false), and a delivery object with the order_deliveries row. P0002 for any cross-tenant customer/address/dish/method id; 22023 for bad input; 42501 for the wrong role.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consume_order_stock(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'consume_order_stock';
  v_caller    record;
  v_loc       uuid;
  v_item      record;
  v_line      record;
  v_taken     jsonb;
  v_items     integer := 0;
  v_total     numeric := 0;
  v_shortages jsonb := '[]'::jsonb;
  v_touched   uuid[] := '{}';
  v_id        uuid;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier', 'waiter', 'delivery_operator']);

  IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.restaurant_id = v_caller.restaurant_id) THEN
    RAISE EXCEPTION '%: order % not found', c_fn, p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.inventory_control_enabled(v_caller.restaurant_id) THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'enabled', false, 'consumed_items', 0,
                              'total_cost', 0, 'shortages', '[]'::jsonb);
  END IF;

  v_loc := private.ensure_default_inventory_location(v_caller.restaurant_id);

  -- Lock every ingredient this order can touch up front, in id order, so two
  -- orders sharing ingredients always queue instead of deadlocking.
  PERFORM 1 FROM public.ingredients i
   WHERE i.id IN (
     SELECT ri.ingredient_id
       FROM public.order_items oi
       JOIN public.recipes r ON r.dish_id = oi.dish_id
       JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
      WHERE oi.order_id = p_order_id
        AND oi.restaurant_id = v_caller.restaurant_id
        AND oi.stock_consumed_at IS NULL
     UNION
     SELECT m.ingredient_id
       FROM public.order_items oi
       JOIN public.order_item_modifiers m ON m.order_item_id = oi.id
      WHERE oi.order_id = p_order_id
        AND oi.restaurant_id = v_caller.restaurant_id
        AND oi.stock_consumed_at IS NULL
        AND m.ingredient_id IS NOT NULL)
   ORDER BY i.id
   FOR UPDATE;

  FOR v_item IN
    SELECT oi.id, oi.dish_id, oi.quantity
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.restaurant_id = v_caller.restaurant_id
       AND oi.stock_consumed_at IS NULL
       AND COALESCE(oi.status, '') <> 'cancelled'
     ORDER BY oi.id
     FOR UPDATE
  LOOP
    FOR v_line IN
      -- The recipe and, F7, the option ingredients (per unit x line quantity), one take per ingredient.
      SELECT x.ingredient_id, sum(x.required)::numeric(14,3) AS required
        FROM (
          SELECT ri.ingredient_id, (ri.quantity * v_item.quantity / r.yield_quantity)::numeric(14,3) AS required
            FROM public.recipes r
            JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
           WHERE r.dish_id = v_item.dish_id
          UNION ALL
          SELECT m.ingredient_id, (m.ingredient_qty * v_item.quantity)::numeric(14,3)
            FROM public.order_item_modifiers m
           WHERE m.order_item_id = v_item.id
             AND m.ingredient_id IS NOT NULL
        ) x
       GROUP BY x.ingredient_id
       ORDER BY x.ingredient_id
    LOOP
      CONTINUE WHEN v_line.required <= 0;
      PERFORM 1 FROM public.ingredients i WHERE i.id = v_line.ingredient_id FOR UPDATE;
      v_taken := private.inventory_take(v_caller.restaurant_id, v_line.ingredient_id, v_loc, v_line.required,
                                        'sale', 'order_item', v_item.id, v_caller.profile_id, true, NULL, NULL);
      v_total := v_total + (v_taken->>'total_cost')::numeric;
      IF (v_taken->>'missing')::numeric > 0 THEN
        v_shortages := v_shortages || jsonb_build_object(
          'ingredient_id', v_line.ingredient_id,
          'name', (SELECT i.name FROM public.ingredients i WHERE i.id = v_line.ingredient_id),
          'unit', (SELECT i.unit FROM public.ingredients i WHERE i.id = v_line.ingredient_id),
          'missing', ((v_taken->>'missing')::numeric)::numeric(14,3));
      END IF;
      IF NOT v_line.ingredient_id = ANY (v_touched) THEN
        v_touched := v_touched || v_line.ingredient_id;
      END IF;
    END LOOP;

    UPDATE public.order_items SET stock_consumed_at = now() WHERE id = v_item.id;
    v_items := v_items + 1;
  END LOOP;

  FOREACH v_id IN ARRAY v_touched LOOP
    PERFORM private.inventory_sync_stock(v_id);
  END LOOP;

  RETURN jsonb_build_object('order_id', p_order_id, 'enabled', true, 'consumed_items', v_items,
                            'total_cost', round(v_total, 4), 'shortages', v_shortages);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.consume_order_stock(p_order_id uuid) IS 'Deducts the dish formulas, plus the option ingredients of order_item_modifiers (ingredient_qty x quantity, F7 0023), of an order''s not-yet-consumed, non-cancelled items from the default location (admin, cashier, waiter, delivery_operator). Reads order_items server-side; each item is stamped stock_consumed_at so repeated calls are idempotent. FEFO by expires_on then received_at; a shortage drives the general lot negative and is reported. No-op when business_config inventory_control_enabled is not ''true''. Returns {order_id, enabled, consumed_items, total_cost, shortages:[{ingredient_id, name, unit, missing}]}.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.split_order(p_parent_order_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_parent          public.orders%ROWTYPE;
  v_child_id        uuid;

  v_item_count      integer := 0;
  v_item            jsonb;
  v_line_no         integer := 0;
  v_item_id         uuid;
  v_item_qty        integer;
  v_new_item_id     uuid;

  v_pending_item_id  uuid[]    := '{}'::uuid[];
  v_pending_quantity integer[] := '{}'::integer[];

  v_remaining jsonb;

  v_parent_item public.order_items%ROWTYPE;

  v_child_subtotal bigint;
  v_child_tax      bigint;
  v_child_tip      bigint;
  v_child_total    bigint;
  v_child_tax_pct  numeric;
  v_child_tip_pct  numeric;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;

  v_i integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'split_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'split_order: only cashier or admin may split an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'split_order: p_items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'split_order: p_items must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'split_order: p_items accepts at most 50 lines'
      USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  FOR v_line_no IN 1..v_item_count LOOP
    v_item := p_items -> (v_line_no - 1);

    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'split_order: item[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_item ? 'order_item_id') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing order_item_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_id := (v_item ->> 'order_item_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_item ? 'quantity') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing quantity', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_qty := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].quantity is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_item_qty IS NULL OR v_item_qty < 1 THEN
      RAISE EXCEPTION 'split_order: item[%].quantity must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    v_i := array_position(v_pending_item_id, v_item_id);
    IF v_i IS NOT NULL THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id duplicates item[%]',
        v_line_no, v_i
        USING ERRCODE = '22023';
    END IF;

    v_pending_item_id  := v_pending_item_id || v_item_id;
    v_pending_quantity := v_pending_quantity || v_item_qty;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = p_parent_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'split_order: order % not found', p_parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- CHANGE: reject delivery orders. A delivery order carries a snapshot of
  -- the customer / address in order_deliveries; splitting it would either
  -- double the delivery (one courier, two orders) or orphan a partial
  -- delivery with no destination. Refuse explicitly.
  IF v_parent.order_type = 'delivery' THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (it is a delivery order)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Parent rules.
  IF v_parent.is_partial_order THEN
    RAISE EXCEPTION 'split_order: order % is itself a partial child (cannot be split further)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_parent.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (status=%)',
      p_parent_order_id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_parent_order_id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'split_order: order % already has a payment', p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Items.
  v_remaining := '{}'::jsonb;

  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'split_order: item[%] does not belong to the order', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF v_item_qty > v_parent_item.quantity THEN
      RAISE EXCEPTION 'split_order: item[%] quantity % exceeds the available quantity %',
        v_line_no, v_item_qty, v_parent_item.quantity
        USING ERRCODE = 'P0001';
    END IF;

    v_remaining := v_remaining || jsonb_build_object(
      v_item_id::text,
      to_jsonb(v_parent_item.quantity - v_item_qty)
    );
  END LOOP;

  -- 6. Move-all guard.
  SELECT count(*)::bigint
    INTO v_i
    FROM (
      SELECT (v_remaining ->> k.k)::int AS remaining
        FROM jsonb_object_keys(v_remaining) k(k)
       WHERE (v_remaining ->> k.k)::int > 0
      UNION ALL
      SELECT oi.quantity
        FROM public.order_items oi
       WHERE oi.order_id = p_parent_order_id
         AND NOT (v_remaining ? oi.id::text)
    ) s
   WHERE s.remaining > 0;

  IF v_i = 0 THEN
    RAISE EXCEPTION 'split_order: cannot move every item; pay the order instead'
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Child.
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id
  ) VALUES (
    v_caller_tenant, v_parent.table_id, v_parent.waiter_id, v_parent.status,
    0, 0, v_parent.tax_percentage, 0, v_parent.tip_percentage, 0,
    v_parent.total_discounts, true, p_parent_order_id
  )
  RETURNING id INTO v_child_id;

  -- 8. Move.
  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant
     FOR UPDATE;

    IF v_item_qty = v_parent_item.quantity THEN
      UPDATE public.order_items oi
         SET order_id = v_child_id
       WHERE oi.id = v_item_id;
    ELSE
      UPDATE public.order_items oi
         SET quantity = oi.quantity - v_item_qty
       WHERE oi.id = v_item_id;

      INSERT INTO public.order_items (
        order_id, dish_id, name, price, quantity, comments,
        status, added_at, restaurant_id, stock_consumed_at
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant, v_parent_item.stock_consumed_at
      )
      RETURNING id INTO v_new_item_id;

      -- F7: the new line keeps the options of the line it came from.
      INSERT INTO public.order_item_modifiers (
        restaurant_id, order_item_id, group_id, group_name, option_id, option_name,
        price, ingredient_id, ingredient_qty, sort_order
      )
      SELECT m.restaurant_id, v_new_item_id, m.group_id, m.group_name, m.option_id, m.option_name,
             m.price, m.ingredient_id, m.ingredient_qty, m.sort_order
        FROM public.order_item_modifiers m
       WHERE m.order_item_id = v_item_id;
    END IF;
  END LOOP;

  -- 9. Recompute.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_child_subtotal, v_child_tax, v_child_tip, v_child_total,
         v_child_tax_pct, v_child_tip_pct
    FROM private.recompute_order_bill(v_child_id);

  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(p_parent_order_id);

  -- 10. Response.
  RETURN jsonb_build_object(
    'child_order_id', v_child_id,
    'parent', jsonb_build_object(
      'order_id', p_parent_order_id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    ),
    'child', jsonb_build_object(
      'order_id', v_child_id,
      'subtotal', v_child_subtotal,
      'tax',      v_child_tax,
      'tip',      v_child_tip,
      'total',    v_child_total
    )
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.undo_split(p_child_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_child           public.orders%ROWTYPE;
  v_parent          public.orders%ROWTYPE;
  v_child_item      public.order_items%ROWTYPE;
  v_match           public.order_items%ROWTYPE;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'undo_split: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'undo_split: only cashier or admin may undo a split'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Read the child first (without lock) to learn its parent id; the
  -- tenant boundary and the partial-flag check both fire on this read. The
  -- lock is acquired later (parent first, then child) to avoid deadlocks with
  -- split_order running concurrently on the same parent.
  SELECT o.* INTO v_child
    FROM public.orders o
   WHERE o.id = p_child_order_id
     AND o.restaurant_id = v_caller_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'undo_split: order % not found', p_child_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Child rules.
  IF NOT v_child.is_partial_order OR v_child.parent_order_id IS NULL THEN
    RAISE EXCEPTION 'undo_split: order % is not a partial order', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_child.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: child order % has status=% (cannot undo)',
      p_child_order_id, v_child.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_child_order_id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'undo_split: child order % already has a payment', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 0018: voids are history, so a child order with events, or a line with
  -- void history (voided on the parent, then moved here), is never merged back
  -- and deleted (order_item_voids references it).
  IF EXISTS (SELECT 1 FROM public.audit_log a WHERE a.order_id = p_child_order_id)
     OR EXISTS (SELECT 1 FROM public.order_item_voids v
                  JOIN public.order_items ci ON ci.id = v.order_item_id
                 WHERE ci.order_id = p_child_order_id) THEN
    RAISE EXCEPTION 'undo_split: split_has_voids' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the parent now that we know it is non-NULL.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = v_child.parent_order_id
     AND o.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'undo_split: parent order % not found', v_child.parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the child now (parent already locked).
  PERFORM 1 FROM public.orders o
    WHERE o.id = p_child_order_id
      AND o.restaurant_id = v_caller_tenant
      FOR UPDATE;

  -- Parent rules.
  IF v_parent.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: parent order % has status=% (cannot undo)',
      v_parent.id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = v_parent.id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'undo_split: parent order % already has a payment', v_parent.id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Merge each child item back to the parent.
  FOR v_child_item IN
    SELECT oi.*
      FROM public.order_items oi
     WHERE oi.order_id = p_child_order_id
     ORDER BY oi.id
     FOR UPDATE
  LOOP
    -- Match against a parent row with the same dish_id, price, comments
    -- (NULL-safe) and status. The cheapest way to express the NULL-safety is
    -- IS NOT DISTINCT FROM.
    SELECT oi.* INTO v_match
      FROM public.order_items oi
     WHERE oi.order_id = v_parent.id
       AND oi.dish_id IS NOT DISTINCT FROM v_child_item.dish_id
       AND oi.price   IS NOT DISTINCT FROM v_child_item.price
       AND oi.comments IS NOT DISTINCT FROM v_child_item.comments
       AND oi.status  IS NOT DISTINCT FROM v_child_item.status
       AND (oi.stock_consumed_at IS NULL) = (v_child_item.stock_consumed_at IS NULL)
       AND private.order_item_modifier_key(oi.id) = private.order_item_modifier_key(v_child_item.id)
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.order_items oi
         SET quantity = oi.quantity + v_child_item.quantity
       WHERE oi.id = v_match.id;

      DELETE FROM public.order_items WHERE id = v_child_item.id;
    ELSE
      UPDATE public.order_items oi
         SET order_id = v_parent.id
       WHERE oi.id = v_child_item.id;
    END IF;
  END LOOP;

  -- 5. Cleanup.
  DELETE FROM public.orders WHERE id = p_child_order_id;

  -- 6. Recompute parent.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(v_parent.id);

  RETURN jsonb_build_object(
    'parent', jsonb_build_object(
      'order_id', v_parent.id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    )
  );
END;
$$;
--> statement-breakpoint
DROP TRIGGER dishes_normalize_quick_notes ON public.dishes;
--> statement-breakpoint
ALTER TABLE public.dishes DROP CONSTRAINT dishes_quick_notes_check;
--> statement-breakpoint
ALTER TABLE public.dishes DROP COLUMN quick_notes;
--> statement-breakpoint
DROP FUNCTION private.normalize_dish_quick_notes();
--> statement-breakpoint
DROP FUNCTION private.quick_notes_valid(text[]);
--> statement-breakpoint
DROP FUNCTION private.normalize_quick_note(text);
--> statement-breakpoint
COMMENT ON TABLE public.menu_publications IS 'Published menu structure per restaurant (insert-only history; latest published_at, then id, wins). snapshot = private.menu_structure(): order, names, colours, icons, category/subcategory active flags, subcategory membership. Prices, stock, dish availability and modifier groups stay live. No publication = the live structure is served.';
