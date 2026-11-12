-- Public digital menu, DB layer (odd/tasks/carta-digital.md T1, S1, S2, S5,
-- S6, S7, S10, L12 option D).
--
-- 1. public.carta_settings: one row per restaurant (published, description,
--    brand colour, logo, cover, social links, ordering switches, opening
--    hours). public.carta_dayparts and public.carta_daypart_categories: the
--    dayparts of the carta (Desayuno 07:00-11:00, ...) with their categories
--    and an optional featured dish. public.dish_public_details: guest tags
--    and the English description of a dish. Staff of the restaurant read
--    them; only an admin writes (RLS).
-- 2. public.table_qr_tokens: one random token per table (18 random bytes as
--    base64url, 24 characters), created by a trigger on every new table and
--    backfilled for the existing ones. vipe_api only reads them (no write
--    policy); private.regenerate_table_qr_token, admin only, replaces one so
--    a printed QR stops working.
-- 3. Guest functions for the API's public routes, called on the pool with no
--    app.user_id, like the printing helpers (0010): private.guest_restaurant,
--    guest_carta, guest_menu_data and guest_table. SECURITY DEFINER, STABLE,
--    vipe_api only; they resolve the restaurant only from its slug (exact,
--    published carta) and the table only from its token, never read the
--    staff identity and return guest-safe columns only: no costs, recipes,
--    stock quantities, staff or customers.
-- 4. Availability: the body of check_dishes_stock after its role check moves
--    to private.dishes_stock_check(fn, restaurant, items), which reads only.
--    check_dishes_stock keeps its role check, creates the default location
--    as before and delegates, so its result and errors are unchanged.
--    private.dishes_available(restaurant, dish ids) is one portion of each
--    dish through the same rule, for guest_menu_data.
ALTER TABLE public.tables ADD CONSTRAINT tables_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
CREATE FUNCTION private.carta_opening_hours_valid(p_hours jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_hours IS NULL OR (
    pg_catalog.jsonb_typeof(p_hours) = 'object'
    AND (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(p_hours) k) = ARRAY['1', '2', '3', '4', '5', '6', '7']
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_each(p_hours) d(k, v)
       WHERE pg_catalog.jsonb_typeof(d.v) <> 'null'
         AND (pg_catalog.jsonb_typeof(d.v) <> 'object'
              OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(d.v)) <> 2
              OR pg_catalog.jsonb_typeof(d.v -> 'opens') IS DISTINCT FROM 'string'
              OR pg_catalog.jsonb_typeof(d.v -> 'closes') IS DISTINCT FROM 'string'
              OR (d.v ->> 'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              OR (d.v ->> 'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              OR (d.v ->> 'opens') = (d.v ->> 'closes'))))
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.carta_opening_hours_valid(jsonb) IS 'CHECK helper of carta_settings.opening_hours: NULL, or an object with exactly the ISO days "1" (Monday) .. "7", each null (closed) or {opens, closes} "HH:MM" 00:00-23:59 with opens <> closes (closes < opens = closes after midnight). A CHECK runs as the writing role, so vipe_api executes it.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.carta_opening_hours_valid(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.carta_opening_hours_valid(jsonb) TO vipe_api;
--> statement-breakpoint
CREATE TABLE public.carta_settings (
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    published boolean DEFAULT false NOT NULL,
    description text,
    brand_color text,
    logo_url text,
    cover_url text,
    instagram text,
    tiktok text,
    whatsapp text,
    maps_url text,
    google_review_url text,
    table_ordering_enabled boolean DEFAULT false NOT NULL,
    delivery_ordering_enabled boolean DEFAULT false NOT NULL,
    show_table_bill boolean DEFAULT true NOT NULL,
    english_enabled boolean DEFAULT true NOT NULL,
    opening_hours jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carta_settings_pkey PRIMARY KEY (restaurant_id),
    CONSTRAINT carta_settings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_settings_description_check CHECK (description IS NULL OR length(description) <= 160),
    CONSTRAINT carta_settings_brand_color_check CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$'),
    CONSTRAINT carta_settings_logo_url_check CHECK (logo_url IS NULL OR (logo_url ~ '^https?://\S+$' AND length(logo_url) <= 1000)),
    CONSTRAINT carta_settings_cover_url_check CHECK (cover_url IS NULL OR (cover_url ~ '^https?://\S+$' AND length(cover_url) <= 1000)),
    CONSTRAINT carta_settings_instagram_check CHECK (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$'),
    CONSTRAINT carta_settings_tiktok_check CHECK (tiktok IS NULL OR tiktok ~ '^[A-Za-z0-9._]{1,30}$'),
    CONSTRAINT carta_settings_whatsapp_check CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{7,15}$'),
    CONSTRAINT carta_settings_maps_url_check CHECK (maps_url IS NULL OR (maps_url ~ '^https://\S+$' AND length(maps_url) <= 500)),
    CONSTRAINT carta_settings_google_review_url_check CHECK (google_review_url IS NULL OR (google_review_url ~ '^https://\S+$' AND length(google_review_url) <= 500)),
    CONSTRAINT carta_settings_opening_hours_check CHECK (private.carta_opening_hours_valid(opening_hours))
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_settings IS 'Public digital menu of a restaurant (/c/<slug>): published, branding, social links, ordering switches and opening hours. No row = not published.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.published IS 'The guest functions answer only for a published carta; otherwise the public routes show not found.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.brand_color IS 'Lower-case #rrggbb; the web adjusts it per theme for WCAG AA contrast.';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.instagram IS 'Instagram handle without @ (letters, digits, dot, underscore; at most 30).';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.tiktok IS 'TikTok handle without @ (letters, digits, dot, underscore; at most 30).';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.whatsapp IS 'WhatsApp number with country code, digits only (7-15).';
--> statement-breakpoint
COMMENT ON COLUMN public.carta_settings.opening_hours IS '{"1".."7": null (closed) | {"opens": "HH:MM", "closes": "HH:MM"}}, ISO days in the restaurant timezone; NULL = not configured.';
--> statement-breakpoint
CREATE TRIGGER carta_settings_set_updated_at BEFORE UPDATE ON public.carta_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TABLE public.carta_dayparts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    name text NOT NULL,
    name_en text,
    starts_at time without time zone NOT NULL,
    ends_at time without time zone NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    featured_dish_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carta_dayparts_pkey PRIMARY KEY (id),
    CONSTRAINT carta_dayparts_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT carta_dayparts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT carta_dayparts_featured_dish_id_fkey FOREIGN KEY (restaurant_id, featured_dish_id) REFERENCES public.dishes(restaurant_id, id) ON DELETE SET NULL (featured_dish_id),
    CONSTRAINT carta_dayparts_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 40),
    CONSTRAINT carta_dayparts_name_en_check CHECK (name_en IS NULL OR length(btrim(name_en)) BETWEEN 1 AND 40),
    CONSTRAINT carta_dayparts_hours_check CHECK (starts_at < ends_at),
    CONSTRAINT carta_dayparts_sort_order_check CHECK (sort_order >= 0)
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_dayparts IS 'Dayparts of the public menu (Desayuno 07:00-11:00, ...), restaurant timezone, starts_at < ends_at; featured_dish_id is the "Plato del día" (same restaurant, NULL when the dish is deleted).';
--> statement-breakpoint
CREATE INDEX idx_carta_dayparts_restaurant_id ON public.carta_dayparts USING btree (restaurant_id, sort_order);
--> statement-breakpoint
CREATE INDEX idx_carta_dayparts_featured_dish_id ON public.carta_dayparts USING btree (featured_dish_id) WHERE (featured_dish_id IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER carta_dayparts_set_updated_at BEFORE UPDATE ON public.carta_dayparts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TABLE public.carta_daypart_categories (
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    daypart_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT carta_daypart_categories_pkey PRIMARY KEY (daypart_id, category_id),
    CONSTRAINT carta_daypart_categories_daypart_id_fkey FOREIGN KEY (restaurant_id, daypart_id) REFERENCES public.carta_dayparts(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT carta_daypart_categories_category_id_fkey FOREIGN KEY (restaurant_id, category_id) REFERENCES public.categories(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.carta_daypart_categories IS 'Categories a daypart lists. Same restaurant through the composite keys.';
--> statement-breakpoint
CREATE INDEX idx_carta_daypart_categories_category_id ON public.carta_daypart_categories USING btree (category_id);
--> statement-breakpoint
CREATE INDEX idx_carta_daypart_categories_restaurant_id ON public.carta_daypart_categories USING btree (restaurant_id);
--> statement-breakpoint
CREATE TABLE public.dish_public_details (
    dish_id uuid NOT NULL,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    description_en text,
    description_en_reviewed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dish_public_details_pkey PRIMARY KEY (dish_id),
    CONSTRAINT dish_public_details_dish_id_fkey FOREIGN KEY (restaurant_id, dish_id) REFERENCES public.dishes(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT dish_public_details_tags_check CHECK (
      tags <@ ARRAY['vegetarian', 'spicy', 'gluten_free', 'dairy']::text[] AND array_position(tags, NULL) IS NULL),
    CONSTRAINT dish_public_details_description_en_check CHECK (description_en IS NULL OR length(description_en) <= 400)
);
--> statement-breakpoint
COMMENT ON TABLE public.dish_public_details IS 'What the public menu adds to a dish: tags (vegetarian, spicy, gluten_free, dairy) and the English description (machine translated, description_en_reviewed once the restaurant checked it).';
--> statement-breakpoint
CREATE INDEX idx_dish_public_details_restaurant_id ON public.dish_public_details USING btree (restaurant_id);
--> statement-breakpoint
CREATE TRIGGER dish_public_details_set_updated_at BEFORE UPDATE ON public.dish_public_details
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TABLE public.table_qr_tokens (
    table_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    token text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT table_qr_tokens_pkey PRIMARY KEY (table_id),
    CONSTRAINT table_qr_tokens_token_key UNIQUE (token),
    CONSTRAINT table_qr_tokens_table_id_fkey FOREIGN KEY (restaurant_id, table_id) REFERENCES public.tables(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT table_qr_tokens_token_check CHECK (token ~ '^[A-Za-z0-9_-]{24}$')
);
--> statement-breakpoint
COMMENT ON TABLE public.table_qr_tokens IS 'Random token of a table QR (/c/<slug>/m/<token>): never the table number or id. Created for every table by a trigger; replaced only by private.regenerate_table_qr_token. vipe_api reads, never writes.';
--> statement-breakpoint
CREATE INDEX idx_table_qr_tokens_restaurant_id ON public.table_qr_tokens USING btree (restaurant_id);
--> statement-breakpoint
CREATE FUNCTION private.new_table_qr_token() RETURNS text
    LANGUAGE sql VOLATILE
    SET search_path TO ''
    AS $$
  -- 18 random bytes from two v4 UUIDs (pg_strong_random), skipping their
  -- version and variant bytes: 13 of the first, 5 of the second.
  SELECT pg_catalog.translate(
           pg_catalog.encode(pg_catalog.substr(u.a, 1, 6) || pg_catalog.substr(u.a, 10, 7) || pg_catalog.substr(u.b, 1, 5), 'base64'),
           '+/', '-_')
    FROM (SELECT pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) AS a, pg_catalog.uuid_send(pg_catalog.gen_random_uuid()) AS b) u
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.new_table_qr_token() IS 'A new table QR token: 18 random bytes as base64url without padding (24 characters). Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.new_table_qr_token() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.tables_create_qr_token() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.table_qr_tokens (table_id, restaurant_id, token)
  VALUES (NEW.id, NEW.restaurant_id, private.new_table_qr_token());
  RETURN NULL;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.tables_create_qr_token() IS 'AFTER INSERT on tables: gives the new table its QR token.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.tables_create_qr_token() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tables_create_qr_token AFTER INSERT ON public.tables
    FOR EACH ROW EXECUTE FUNCTION private.tables_create_qr_token();
--> statement-breakpoint
INSERT INTO public.table_qr_tokens (table_id, restaurant_id, token)
SELECT t.id, t.restaurant_id, private.new_table_qr_token() FROM public.tables t;
--> statement-breakpoint
CREATE FUNCTION private.regenerate_table_qr_token(p_table_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant_id uuid := private.current_restaurant_id();
  v_token text;
BEGIN
  IF v_restaurant_id IS NULL OR private.current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'regenerate_table_qr_token: admin_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.table_qr_tokens q
     SET token = private.new_table_qr_token(), created_at = now()
   WHERE q.table_id = p_table_id AND q.restaurant_id = v_restaurant_id
  RETURNING q.token INTO v_token;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'regenerate_table_qr_token: table_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_token;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.regenerate_table_qr_token(uuid) IS 'Replaces the QR token of a table of the caller''s restaurant and returns the new one; the old printed QR stops resolving. Admin only (42501 regenerate_table_qr_token: admin_required); a table of another restaurant or unknown is P0002 table_not_found.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.regenerate_table_qr_token(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.regenerate_table_qr_token(uuid) TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.carta_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.carta_dayparts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.carta_daypart_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.dish_public_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.table_qr_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY carta_settings_select_policy ON public.carta_settings FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY carta_settings_insert_policy ON public.carta_settings FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_settings_update_policy ON public.carta_settings FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_dayparts_select_policy ON public.carta_dayparts FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY carta_dayparts_insert_policy ON public.carta_dayparts FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_dayparts_update_policy ON public.carta_dayparts FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_dayparts_delete_policy ON public.carta_dayparts FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_daypart_categories_select_policy ON public.carta_daypart_categories FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY carta_daypart_categories_insert_policy ON public.carta_daypart_categories FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY carta_daypart_categories_delete_policy ON public.carta_daypart_categories FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_public_details_select_policy ON public.dish_public_details FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY dish_public_details_insert_policy ON public.dish_public_details FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_public_details_update_policy ON public.dish_public_details FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY dish_public_details_delete_policy ON public.dish_public_details FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
-- No write policy: tokens change only through the SECURITY DEFINER trigger and regenerate_table_qr_token.
CREATE POLICY table_qr_tokens_select_policy ON public.table_qr_tokens FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.carta_settings, public.carta_dayparts, public.carta_daypart_categories,
    public.dish_public_details, public.table_qr_tokens TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.dishes_stock_check(p_fn text, p_restaurant_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_loc       uuid;
  v_item      jsonb;
  v_dish      uuid;
  v_qty       integer;
  v_shortages jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION '%: p_items must be an array of at most 100 items', p_fn USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_dish := (v_item->>'dish_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: each item needs a uuid dish_id and an integer quantity', p_fn USING ERRCODE = '22023';
    END;
    IF v_dish IS NULL OR v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 999 THEN
      RAISE EXCEPTION '%: each item needs dish_id and quantity 1..999', p_fn USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dishes d WHERE d.id = v_dish AND d.restaurant_id = p_restaurant_id) THEN
      RAISE EXCEPTION '%: dish % not found', p_fn, v_dish USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  IF NOT private.inventory_control_enabled(p_restaurant_id) THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'shortages', '[]'::jsonb);
  END IF;

  -- Read only: a missing default location holds no lots, as a new one would.
  SELECT l.id INTO v_loc
    FROM public.inventory_locations l
   WHERE l.restaurant_id = p_restaurant_id AND l.is_default;

  SELECT jsonb_agg(jsonb_build_object(
           'ingredient_id', q.ingredient_id, 'name', q.name, 'unit', q.unit,
           'required', q.required, 'available', q.available,
           'missing', (q.required - q.available)::numeric(14,3)) ORDER BY q.name)
    INTO v_shortages
    FROM (
      SELECT i.id AS ingredient_id, i.name, i.unit,
             sum(ri.quantity * x.quantity / r.yield_quantity)::numeric(14,3) AS required,
             greatest(COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l
                                 WHERE l.ingredient_id = i.id AND l.location_id = v_loc), 0), 0)::numeric(14,3) AS available
        FROM jsonb_to_recordset(p_items) AS x(dish_id uuid, quantity integer)
        JOIN public.recipes r ON r.dish_id = x.dish_id
        JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
        JOIN public.ingredients i ON i.id = ri.ingredient_id
       GROUP BY i.id, i.name, i.unit
    ) q
   WHERE q.required > q.available;

  RETURN jsonb_build_object('ok', v_shortages IS NULL, 'enabled', true,
                            'shortages', COALESCE(v_shortages, '[]'::jsonb));
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.dishes_stock_check(text, uuid, jsonb) IS 'Body of check_dishes_stock for p_restaurant_id without a role check and without writes (errors prefixed p_fn): validates p_items = [{dish_id, quantity 1..999}] (<= 100, dishes of the restaurant), then {ok, enabled, shortages} against the default-location balance. Callers check the caller first. Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.dishes_stock_check(text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_dishes_stock(p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'check_dishes_stock';
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn,
    ARRAY['admin', 'cashier', 'waiter', 'kitchen', 'delivery_operator']);
  -- As before 0035 the check creates the default location when control is on
  -- (an invalid cart still raises below and rolls it back).
  IF private.inventory_control_enabled(v_caller.restaurant_id) THEN
    PERFORM private.ensure_default_inventory_location(v_caller.restaurant_id);
  END IF;
  RETURN private.dishes_stock_check(c_fn, v_caller.restaurant_id, p_items);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION private.dishes_available(p_restaurant_id uuid, p_dish_ids uuid[])
    RETURNS TABLE(dish_id uuid, available boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT d.id,
         (private.dishes_stock_check('dishes_available', p_restaurant_id,
            jsonb_build_array(jsonb_build_object('dish_id', d.id, 'quantity', 1)))->>'ok')::boolean
    FROM public.dishes d
   WHERE d.restaurant_id = p_restaurant_id AND d.id = ANY(p_dish_ids)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.dishes_available(uuid, uuid[]) IS 'One portion of each dish of p_restaurant_id in p_dish_ids through the check_dishes_stock rule (control off -> available; a dish without formula is available); ids of other restaurants or unknown are left out. No role check: only for SECURITY DEFINER callers such as guest_menu_data. Not granted to vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.dishes_available(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.guest_restaurant(p_slug text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT r.id
    FROM public.restaurants r
    JOIN public.carta_settings s ON s.restaurant_id = r.id AND s.published
   WHERE r.slug = p_slug
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_restaurant(text) IS 'Guest-facing (public menu, no login, no app.user_id): the restaurant of a slug (exact, case-sensitive) whose carta is published; NULL otherwise. Never reads the staff identity.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_restaurant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_restaurant(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_carta(p_slug text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
           'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'timezone', r.timezone, 'currency', r.currency),
           'settings', jsonb_build_object(
             'description', s.description, 'brandColor', s.brand_color, 'logoUrl', s.logo_url, 'coverUrl', s.cover_url,
             'instagram', s.instagram, 'tiktok', s.tiktok, 'whatsapp', s.whatsapp, 'mapsUrl', s.maps_url,
             'googleReviewUrl', s.google_review_url, 'tableOrderingEnabled', s.table_ordering_enabled,
             'deliveryOrderingEnabled', s.delivery_ordering_enabled, 'showTableBill', s.show_table_bill,
             'englishEnabled', s.english_enabled, 'openingHours', s.opening_hours),
           'dayparts', coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', d.id, 'name', d.name, 'nameEn', d.name_en,
                      'startsAt', to_char(d.starts_at, 'HH24:MI'), 'endsAt', to_char(d.ends_at, 'HH24:MI'),
                      'sortOrder', d.sort_order, 'featuredDishId', d.featured_dish_id,
                      'categoryIds', coalesce((
                        SELECT jsonb_agg(dc.category_id ORDER BY c.sort_order, c.name, c.id)
                          FROM public.carta_daypart_categories dc
                          JOIN public.categories c ON c.restaurant_id = dc.restaurant_id AND c.id = dc.category_id
                         WHERE dc.restaurant_id = r.id AND dc.daypart_id = d.id), '[]'::jsonb))
                    ORDER BY d.sort_order, d.starts_at, d.id)
               FROM public.carta_dayparts d WHERE d.restaurant_id = r.id), '[]'::jsonb),
           -- Same rules as apps/api/src/settings/business-config.ts: wholeFee and number(v, 10).
           'deliveryFee', coalesce((
             SELECT trunc(btrim(bc.value, E' \t\r\n')::numeric)
               FROM public.business_config bc
              WHERE bc.restaurant_id = r.id AND bc.key = 'delivery_default_fee'
                AND btrim(bc.value, E' \t\r\n') ~ '^[0-9]+(\.0*)?$'
              LIMIT 1), 0),
           'tipPercentage', coalesce((
             SELECT substring(btrim(bc.value, E' \t\r\n') FROM '^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)')::numeric
               FROM public.business_config bc
              WHERE bc.restaurant_id = r.id AND bc.key = 'tip_percentage'
              LIMIT 1), 10))
    FROM public.restaurants r
    JOIN public.carta_settings s ON s.restaurant_id = r.id
   WHERE r.id = private.guest_restaurant(p_slug)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_carta(text) IS 'Guest-facing (public menu, no login, no app.user_id): the carta of a published slug, NULL otherwise. {restaurant: {name, slug, timezone, currency}, settings: {description, brandColor, logoUrl, coverUrl, instagram, tiktok, whatsapp, mapsUrl, googleReviewUrl, tableOrderingEnabled, deliveryOrderingEnabled, showTableBill, englishEnabled, openingHours}, dayparts: [{id, name, nameEn, startsAt "HH:MM", endsAt "HH:MM", sortOrder, featuredDishId, categoryIds}] (sort_order, starts_at), deliveryFee (business_config delivery_default_fee, a whole non-negative number else 0), tipPercentage (tip_percentage, default 10)}. Never returns timestamps, other business_config keys or staff data.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_carta(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_carta(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_menu_data(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_rid uuid := private.guest_restaurant(p_slug);
  v_dishes uuid[];
BEGIN
  IF v_rid IS NULL THEN
    RETURN NULL;
  END IF;
  -- DishesService.list({active: true}): the dishes the menu can list.
  SELECT coalesce(array_agg(d.id), '{}') INTO v_dishes
    FROM public.dishes d WHERE d.restaurant_id = v_rid AND d.active;

  RETURN jsonb_build_object(
    'snapshot', coalesce((
      SELECT p.snapshot FROM public.menu_publications p
       WHERE p.restaurant_id = v_rid ORDER BY p.published_at DESC, p.id DESC LIMIT 1), 'null'::jsonb),
    'categories', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'description', c.description, 'icon', c.icon, 'active', c.active,
               'sortOrder', c.sort_order, 'color', c.color, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
               'hasSubcategories', EXISTS (SELECT 1 FROM public.dishes d
                                            WHERE d.restaurant_id = v_rid AND d.category_id = c.id AND d.subcategory_id IS NOT NULL))
             ORDER BY c.sort_order, c.name, c.id)
        FROM public.categories c WHERE c.restaurant_id = v_rid), '[]'::jsonb),
    'subcategories', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'category_id', s.category_id, 'name', s.name, 'sort_order', s.sort_order, 'active', s.active,
               'created_at', s.created_at, 'updated_at', s.updated_at)
             ORDER BY c.sort_order, c.name, c.id, s.sort_order, lower(s.name), s.id)
        FROM public.subcategories s
        JOIN public.categories c ON c.restaurant_id = s.restaurant_id AND c.id = s.category_id
       WHERE s.restaurant_id = v_rid), '[]'::jsonb),
    'dishes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'name', d.name, 'description', d.description, 'price', d.price, 'categoryId', d.category_id,
               'subcategoryId', d.subcategory_id, 'imageUrl', d.image_url, 'active', d.active,
               'allowComments', d.allow_comments, 'sortOrder', d.sort_order, 'createdAt', d.created_at, 'updatedAt', d.updated_at)
             ORDER BY d.name, d.id)
        FROM public.dishes d WHERE d.restaurant_id = v_rid AND d.id = ANY(v_dishes)), '[]'::jsonb),
    'liveDishIds', coalesce((
      SELECT jsonb_agg(d.id ORDER BY d.id) FROM public.dishes d WHERE d.restaurant_id = v_rid), '[]'::jsonb),
    'availability', coalesce((
      SELECT jsonb_object_agg(a.dish_id, a.available) FROM private.dishes_available(v_rid, v_dishes) a), '{}'::jsonb),
    'modifierLinks', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'dish_id', dg.dish_id,
               'row', jsonb_build_object(
                 'id', g.id, 'name', g.name, 'required', g.required, 'min_select', g.min_select, 'max_select', g.max_select,
                 'sort_order', g.sort_order, 'is_active', g.is_active,
                 'options', coalesce((
                   SELECT jsonb_agg(jsonb_build_object(
                            'id', o.id, 'group_id', o.group_id, 'name', o.name, 'price', o.price,
                            'ingredient_id', NULL, 'ingredient_qty', NULL, 'sort_order', o.sort_order, 'is_active', o.is_active)
                          ORDER BY o.sort_order, lower(o.name), o.id)
                     FROM public.modifier_options o
                    WHERE o.restaurant_id = v_rid AND o.group_id = g.id AND o.is_active), '[]'::jsonb)))
             ORDER BY dg.dish_id, dg.sort_order, lower(g.name), g.id)
        FROM public.dish_modifier_groups dg
        JOIN public.modifier_groups g ON g.restaurant_id = dg.restaurant_id AND g.id = dg.group_id
       WHERE dg.restaurant_id = v_rid AND dg.dish_id = ANY(v_dishes) AND g.is_active), '[]'::jsonb),
    -- PromotionCatalog.records() row shape; only what the server applies by itself.
    'promotions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'kind', p.kind, 'mode', p.mode, 'active', p.active,
               'start_date', p.start_date, 'end_date', p.end_date,
               'start_local', to_char((p.start_date AT TIME ZONE r.timezone)::date, 'YYYY-MM-DD'),
               'end_local', to_char((p.end_date AT TIME ZONE r.timezone)::date, 'YYYY-MM-DD'),
               'days_of_week', p.days_of_week, 'time_windows', p.time_windows, 'channels', p.channels,
               'max_uses_per_order', p.max_uses_per_order, 'discount_type', p.discount_type, 'discount_value', p.discount_value,
               'buy_quantity', p.buy_quantity, 'pay_quantity', p.pay_quantity, 'rest_discount_percent', p.rest_discount_percent,
               'combo_price', p.combo_price, 'min_subtotal', p.min_subtotal, 'max_discount', p.max_discount,
               'created_at', p.created_at, 'updated_at', p.updated_at,
               'dish_ids', coalesce((SELECT jsonb_agg(x.dish_id ORDER BY x.dish_id) FROM public.promotion_dishes x
                                      WHERE x.restaurant_id = v_rid AND x.promotion_id = p.id), '[]'::jsonb),
               'category_ids', coalesce((SELECT jsonb_agg(x.category_id ORDER BY x.category_id) FROM public.promotion_categories x
                                          WHERE x.restaurant_id = v_rid AND x.promotion_id = p.id), '[]'::jsonb),
               'subcategory_ids', coalesce((SELECT jsonb_agg(x.subcategory_id ORDER BY x.subcategory_id) FROM public.promotion_subcategories x
                                             WHERE x.restaurant_id = v_rid AND x.promotion_id = p.id), '[]'::jsonb),
               'combo_groups', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'dish_ids', coalesce((
                          SELECT jsonb_agg(o.dish_id ORDER BY o.created_at, o.dish_id) FROM public.promotion_combo_options o
                           WHERE o.restaurant_id = v_rid AND o.group_id = g.id), '[]'::jsonb))
                        ORDER BY g.position, g.created_at, g.id)
                   FROM public.promotion_combo_groups g WHERE g.restaurant_id = v_rid AND g.promotion_id = p.id), '[]'::jsonb))
             ORDER BY p.created_at, p.id)
        FROM public.promotions p
        JOIN public.restaurants r ON r.id = p.restaurant_id
       WHERE p.restaurant_id = v_rid AND p.active IS TRUE AND p.mode = 'automatic'), '[]'::jsonb),
    'details', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'dishId', x.dish_id, 'tags', to_jsonb(x.tags), 'descriptionEn', x.description_en,
               'descriptionEnReviewed', x.description_en_reviewed)
             ORDER BY x.dish_id)
        FROM public.dish_public_details x WHERE x.restaurant_id = v_rid AND x.dish_id = ANY(v_dishes)), '[]'::jsonb),
    -- "Lo más pedido": units of the listed dishes on paid orders of the last 30 days, voided lines out.
    'mostOrdered', coalesce((
      SELECT jsonb_agg(m.dish_id ORDER BY m.units DESC, m.dish_id)
        FROM (SELECT oi.dish_id, sum(oi.quantity) AS units
                FROM public.order_items oi
                JOIN public.orders o ON o.restaurant_id = oi.restaurant_id AND o.id = oi.order_id
               WHERE oi.restaurant_id = v_rid AND o.status = 'paid' AND o.created_at >= now() - interval '30 days'
                 AND oi.status IS DISTINCT FROM 'cancelled' AND oi.quantity > 0 AND oi.dish_id = ANY(v_dishes)
               GROUP BY oi.dish_id
               ORDER BY units DESC, oi.dish_id
               LIMIT 5) m), '[]'::jsonb));
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_menu_data(text) IS 'Guest-facing (public menu, no login, no app.user_id): the raw rows MenuService builds the waiter menu from, for the restaurant of a published slug only; NULL otherwise. {snapshot: latest menu_publications.snapshot or null, categories: [CategoryRow camelCase {id, name, description, icon, active, sortOrder, color, createdAt, updatedAt} + hasSubcategories] (every category), subcategories: [SubcategoryRow {id, category_id, name, sort_order, active, created_at, updated_at}] (every subcategory, staff order), dishes: [DishRow camelCase {id, name, description, price, categoryId, subcategoryId, imageUrl, active, allowComments, sortOrder, createdAt, updatedAt}] (active dishes, by name), liveDishIds: [every dish id], availability: {dishId: boolean} (check_dishes_stock rule, one portion, listed dishes), modifierLinks: [{dish_id, row: group {id, name, required, min_select, max_select, sort_order, is_active, options: [{id, group_id, name, price, ingredient_id null, ingredient_qty null, sort_order, is_active}]}}] (ModifiersService.groupsForDishes rows), promotions: [PromotionCatalog.records() row] (active automatic only), details: [{dishId, tags, descriptionEn, descriptionEnReviewed}], mostOrdered: [up to 5 dish ids by units on paid orders of the last 30 days]}. Never returns costs, recipes, ingredients, stock quantities, stations, staff, customers or manual promotions.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_menu_data(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_menu_data(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guest_table(p_slug text, p_token text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
           'tableId', t.id, 'number', t.number, 'zoneName', z.name,
           'isOpen', EXISTS (SELECT 1 FROM public.orders o
                              WHERE o.restaurant_id = t.restaurant_id AND o.table_id = t.id
                                AND o.status IN ('active', 'kitchen', 'delivered')))
    FROM public.table_qr_tokens q
    JOIN public.tables t ON t.restaurant_id = q.restaurant_id AND t.id = q.table_id
    LEFT JOIN public.zones z ON z.restaurant_id = t.restaurant_id AND z.id = t.zone_id
   WHERE q.token = p_token
     AND q.restaurant_id = private.guest_restaurant(p_slug)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guest_table(text, text) IS 'Guest-facing (table QR, no login, no app.user_id): {tableId, number, zoneName, isOpen} of the table whose current token is p_token, only when it belongs to the restaurant of a published slug; NULL otherwise (unknown, regenerated or another restaurant''s token). isOpen = the table has an order in active, kitchen or delivered (0024). Never returns the waiter, the order or other tables.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guest_table(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.guest_table(text, text) TO vipe_api;
