-- Promotions: mechanics, schedules, explicit discounts (odd/tasks/promociones.md T1, S1-S2, L4).
--
-- 1. public.promotions gets a kind (product_discount, buy_x_pay_y, combo,
--    bill_discount), a mode (automatic, manual, manual_pin) and the fields of
--    each kind, checked per kind: discount_type/discount_value (now nullable)
--    for product_discount and bill_discount; buy_quantity N >= 2,
--    pay_quantity 1 <= M < N and rest_discount_percent 1-100 for
--    buy_x_pay_y; combo_price > 0 for combo; min_subtotal and max_discount
--    only on bill_discount. Conditions: days_of_week (ISO 1 = Monday .. 7,
--    empty = every day), time_windows ([{from, to}] "HH:MM" with from < to,
--    empty = all day), channels (orders.order_type values dine_in and
--    delivery, plus takeaway; empty = all), max_uses_per_order (> 0 or NULL)
--    and end_date (NULL = no end). Existing rows become product_discount,
--    automatic, every day, all day, all channels; their dish links stay.
-- 2. Targets beside promotion_dishes: promotion_categories and
--    promotion_subcategories. Combos: promotion_combo_groups and
--    promotion_combo_options (pick one dish per group). Tenant RLS like
--    promotion_dishes; same-restaurant composite foreign keys.
-- 3. public.order_discounts: one row per discount of an order (item or bill,
--    promotion or manual) with a label snapshot and a whole-peso amount > 0;
--    a manual row carries its reason. order_items gets promotion_id,
--    promotion_snapshot (the rule when the line was sent) and combo_id;
--    order_items.price is the unit list price (options included).
-- 4. private.order_bill_base() is the bill base: gross = sum(round(price *
--    quantity)), discounts = the order's order_discounts whose line (if any)
--    is not cancelled (a combo row only while no line of its combo is
--    cancelled), capped at gross. recompute_order_bill and pay_order use
--    it: subtotal = gross - discounts (the net base, so tax, tip and total
--    keep their meaning) and total_discounts = discounts; recompute leaves
--    paid and cancelled orders alone. split_order shares a line's item
--    discounts by the units moved, moves combo rows with their lines and
--    refuses to separate a combo; bill discounts stay on their order, and
--    undo_split brings the child's manual bill rows and combo rows back.
--    No existing order is recomputed.
-- 5. order_discounts follows the 0018 lifecycle rule: no row is added,
--    changed or removed on a paid or cancelled order (42501, except for the
--    SECURITY DEFINER RPCs). pay_order closes a fully discounted order
--    (amount_due + tip = 0) with a single 0 cash tender.
-- 6. apply_discount (T4b): a supervisor action of its own for manual
--    discounts, bound to an order. A targeted authorization names one of the
--    known actions (order: cancel_order, void_item, apply_discount; payment:
--    void_payment), so a void authorization never backs a discount nor the
--    other way round. private.discount_authorizer runs the
--    private.void_authorizer checks for the API.
ALTER TABLE public.promotions
    ADD COLUMN kind character varying(20) DEFAULT 'product_discount'::character varying NOT NULL,
    ADD COLUMN mode character varying(20) DEFAULT 'automatic'::character varying NOT NULL,
    ADD COLUMN buy_quantity integer,
    ADD COLUMN pay_quantity integer,
    ADD COLUMN rest_discount_percent integer,
    ADD COLUMN combo_price numeric(10,2),
    ADD COLUMN min_subtotal numeric(10,2),
    ADD COLUMN max_discount numeric(10,2),
    ADD COLUMN days_of_week smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    ADD COLUMN time_windows jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD COLUMN channels text[] DEFAULT '{}'::text[] NOT NULL,
    ADD COLUMN max_uses_per_order integer,
    ALTER COLUMN discount_type DROP NOT NULL,
    ALTER COLUMN discount_value DROP NOT NULL,
    ALTER COLUMN end_date DROP NOT NULL;
--> statement-breakpoint
CREATE FUNCTION private.promotion_time_windows_valid(p_windows jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT pg_catalog.jsonb_typeof(p_windows) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(p_windows) w(v)
        WHERE pg_catalog.jsonb_typeof(w.v) <> 'object'
           OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(w.v)) <> 2
           OR pg_catalog.jsonb_typeof(w.v -> 'from') IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(w.v -> 'to') IS DISTINCT FROM 'string'
           OR (w.v ->> 'from') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (w.v ->> 'to') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (w.v ->> 'from') >= (w.v ->> 'to'))
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.promotion_time_windows_valid(jsonb) IS 'CHECK helper of promotions.time_windows: a JSON array of {from, to} objects (only those keys), each "HH:MM" 00:00-23:59 with from < to. [] = all day. A CHECK runs as the inserting role, so vipe_api executes it.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.promotion_time_windows_valid(jsonb) TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.promotions
    ADD CONSTRAINT promotions_restaurant_id_id_key UNIQUE (restaurant_id, id),
    ADD CONSTRAINT promotions_kind_check CHECK (kind IN ('product_discount', 'buy_x_pay_y', 'combo', 'bill_discount')),
    ADD CONSTRAINT promotions_mode_check CHECK (mode IN ('automatic', 'manual', 'manual_pin')),
    ADD CONSTRAINT promotions_discount_check CHECK (
      CASE WHEN kind IN ('product_discount', 'bill_discount')
           THEN discount_type IS NOT NULL AND discount_value IS NOT NULL AND discount_value >= 0
           ELSE discount_type IS NULL AND discount_value IS NULL END),
    ADD CONSTRAINT promotions_buy_x_pay_y_check CHECK (
      CASE WHEN kind = 'buy_x_pay_y'
           THEN coalesce(buy_quantity >= 2 AND pay_quantity >= 1 AND pay_quantity < buy_quantity
                         AND rest_discount_percent BETWEEN 1 AND 100, false)
           ELSE buy_quantity IS NULL AND pay_quantity IS NULL AND rest_discount_percent IS NULL END),
    ADD CONSTRAINT promotions_combo_check CHECK (
      CASE WHEN kind = 'combo' THEN coalesce(combo_price > 0, false) ELSE combo_price IS NULL END),
    ADD CONSTRAINT promotions_bill_discount_check CHECK (
      (kind = 'bill_discount' OR (min_subtotal IS NULL AND max_discount IS NULL))
      AND (min_subtotal IS NULL OR min_subtotal >= 0)
      AND (max_discount IS NULL OR max_discount > 0)),
    ADD CONSTRAINT promotions_days_of_week_check CHECK (
      days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND array_position(days_of_week, NULL) IS NULL),
    ADD CONSTRAINT promotions_time_windows_check CHECK (private.promotion_time_windows_valid(time_windows)),
    ADD CONSTRAINT promotions_channels_check CHECK (
      channels <@ ARRAY['dine_in', 'takeaway', 'delivery']::text[] AND array_position(channels, NULL) IS NULL),
    ADD CONSTRAINT promotions_max_uses_per_order_check CHECK (max_uses_per_order IS NULL OR max_uses_per_order > 0);
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.kind IS 'product_discount (discount_type/value per unit), buy_x_pay_y (buy_quantity N, pay_quantity M, rest_discount_percent on the N-M cheapest), combo (combo_price for one dish of each promotion_combo_groups row) or bill_discount (discount_type/value on the bill, optional min_subtotal and max_discount). CHECKed per kind.';
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.mode IS 'automatic (applied by the server when items are sent), manual (the cashier picks it) or manual_pin (manual with the PIN authorization of voids). Manual modes never apply by themselves.';
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.days_of_week IS 'ISO days 1 = Monday .. 7 = Sunday in the restaurant timezone; {} = every day.';
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.time_windows IS '[{"from": "HH:MM", "to": "HH:MM"}] with from < to, restaurant timezone; [] = all day.';
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.channels IS 'Subset of dine_in (salón), takeaway (para llevar), delivery (domicilio); {} = every channel. dine_in and delivery are the orders.order_type values.';
--> statement-breakpoint
COMMENT ON COLUMN public.promotions.end_date IS 'NULL = no end.';
--> statement-breakpoint
CREATE INDEX idx_promotions_kind ON public.promotions USING btree (restaurant_id, kind);
--> statement-breakpoint
ALTER TABLE public.subcategories ADD CONSTRAINT subcategories_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
CREATE TABLE public.promotion_categories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id),
    promotion_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotion_categories_promotion_id_category_id_key UNIQUE (promotion_id, category_id),
    CONSTRAINT promotion_categories_promotion_id_fkey FOREIGN KEY (restaurant_id, promotion_id) REFERENCES public.promotions(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT promotion_categories_category_id_fkey FOREIGN KEY (restaurant_id, category_id) REFERENCES public.categories(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.promotion_categories IS 'Categories a product_discount or buy_x_pay_y promotion targets: every dish of the category matches.';
--> statement-breakpoint
CREATE INDEX idx_promotion_categories_category_id ON public.promotion_categories USING btree (category_id);
--> statement-breakpoint
CREATE INDEX idx_promotion_categories_restaurant_id ON public.promotion_categories USING btree (restaurant_id);
--> statement-breakpoint
CREATE TABLE public.promotion_subcategories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id),
    promotion_id uuid NOT NULL,
    subcategory_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotion_subcategories_promotion_id_subcategory_id_key UNIQUE (promotion_id, subcategory_id),
    CONSTRAINT promotion_subcategories_promotion_id_fkey FOREIGN KEY (restaurant_id, promotion_id) REFERENCES public.promotions(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT promotion_subcategories_subcategory_id_fkey FOREIGN KEY (restaurant_id, subcategory_id) REFERENCES public.subcategories(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.promotion_subcategories IS 'Subcategories a product_discount or buy_x_pay_y promotion targets: every dish of the subcategory matches.';
--> statement-breakpoint
CREATE INDEX idx_promotion_subcategories_subcategory_id ON public.promotion_subcategories USING btree (subcategory_id);
--> statement-breakpoint
CREATE INDEX idx_promotion_subcategories_restaurant_id ON public.promotion_subcategories USING btree (restaurant_id);
--> statement-breakpoint
CREATE TABLE public.promotion_combo_groups (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id),
    promotion_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotion_combo_groups_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT promotion_combo_groups_promotion_id_fkey FOREIGN KEY (restaurant_id, promotion_id) REFERENCES public.promotions(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT promotion_combo_groups_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT promotion_combo_groups_position_check CHECK ("position" >= 0)
);
--> statement-breakpoint
COMMENT ON TABLE public.promotion_combo_groups IS 'Groups of a combo promotion, in position order ("Sopa", "Plato", "Bebida"); the customer picks exactly one option of each.';
--> statement-breakpoint
CREATE INDEX idx_promotion_combo_groups_promotion_id ON public.promotion_combo_groups USING btree (promotion_id, "position");
--> statement-breakpoint
CREATE TABLE public.promotion_combo_options (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id),
    group_id uuid NOT NULL,
    dish_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotion_combo_options_group_id_dish_id_key UNIQUE (group_id, dish_id),
    CONSTRAINT promotion_combo_options_group_id_fkey FOREIGN KEY (restaurant_id, group_id) REFERENCES public.promotion_combo_groups(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT promotion_combo_options_dish_id_fkey FOREIGN KEY (restaurant_id, dish_id) REFERENCES public.dishes(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.promotion_combo_options IS 'Dishes the customer can pick in one combo group.';
--> statement-breakpoint
CREATE INDEX idx_promotion_combo_options_dish_id ON public.promotion_combo_options USING btree (dish_id);
--> statement-breakpoint
ALTER TABLE public.order_items
    ADD COLUMN promotion_id uuid,
    ADD COLUMN promotion_snapshot jsonb,
    ADD COLUMN combo_id uuid,
    ADD CONSTRAINT order_items_promotion_id_fkey FOREIGN KEY (restaurant_id, promotion_id) REFERENCES public.promotions(restaurant_id, id) ON DELETE SET NULL (promotion_id);
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.price IS 'Unit list price charged before discounts, options included (since 0027; older rows may hold a price a promotion already lowered). Discounts are order_discounts rows.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.promotion_id IS 'The automatic promotion the line qualified for when it was sent (NULL = none or deleted promotion).';
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.promotion_snapshot IS 'The rule of promotion_id when the line was sent; a later edit of the promotion does not change the line.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.combo_id IS 'Shared by the lines of one ordered combo (the order_discounts combo row carries the same id).';
--> statement-breakpoint
CREATE INDEX idx_order_items_promotion_id ON public.order_items USING btree (promotion_id) WHERE (promotion_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_order_items_combo_id ON public.order_items USING btree (combo_id) WHERE (combo_id IS NOT NULL);
--> statement-breakpoint
CREATE TABLE public.order_discounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id),
    order_id uuid NOT NULL,
    order_item_id uuid,
    promotion_id uuid,
    kind text NOT NULL,
    source text NOT NULL,
    label text NOT NULL,
    amount numeric(10,2) NOT NULL,
    combo_id uuid,
    reason text,
    created_by uuid,
    authorized_by uuid,
    requires_authorization boolean DEFAULT true NOT NULL,
    line_quantity integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_discounts_order_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT order_discounts_item_fkey FOREIGN KEY (restaurant_id, order_item_id) REFERENCES public.order_items(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT order_discounts_promotion_id_fkey FOREIGN KEY (restaurant_id, promotion_id) REFERENCES public.promotions(restaurant_id, id) ON DELETE SET NULL (promotion_id),
    CONSTRAINT order_discounts_created_by_fkey FOREIGN KEY (restaurant_id, created_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (created_by),
    CONSTRAINT order_discounts_authorized_by_fkey FOREIGN KEY (restaurant_id, authorized_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (authorized_by),
    CONSTRAINT order_discounts_kind_check CHECK (kind IN ('promotion_item', 'promotion_bill', 'combo', 'manual_item', 'manual_bill')),
    CONSTRAINT order_discounts_source_check CHECK (source IN ('automatic', 'manual')),
    CONSTRAINT order_discounts_kind_source_check CHECK ((kind NOT IN ('manual_item', 'manual_bill') OR source = 'manual') AND (kind <> 'combo' OR source = 'automatic')),
    CONSTRAINT order_discounts_item_check CHECK (
      CASE kind WHEN 'promotion_item' THEN order_item_id IS NOT NULL
                WHEN 'manual_item' THEN order_item_id IS NOT NULL
                WHEN 'combo' THEN combo_id IS NOT NULL
                ELSE order_item_id IS NULL END),
    CONSTRAINT order_discounts_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 255),
    CONSTRAINT order_discounts_amount_check CHECK (amount > 0 AND amount = trunc(amount)),
    CONSTRAINT order_discounts_line_quantity_check CHECK (line_quantity IS NULL OR line_quantity > 0),
    CONSTRAINT order_discounts_reason_check CHECK (
      CASE WHEN source = 'manual' THEN reason IS NOT NULL AND length(btrim(reason)) BETWEEN 3 AND 200
           ELSE reason IS NULL END)
);
--> statement-breakpoint
COMMENT ON TABLE public.order_discounts IS 'One discount of an order (0027, S2): on a line (order_item_id) or on the bill, from a promotion (promotion_id, set NULL when it is deleted; label keeps its name) or manual, whole pesos > 0. source = manual (manual_item, manual_bill, or a manual-mode promotion as promotion_item/promotion_bill) needs a reason (3-200 characters) and carries created_by/authorized_by. combo rows carry the combo_id of their lines. Rows of a cancelled line do not count; orders.total_discounts and orders.subtotal come from private.order_bill_base().';
--> statement-breakpoint
COMMENT ON COLUMN public.order_discounts.requires_authorization IS 'Whether removing the row needs an apply_discount authorization, fixed when it is added: true for a free discount or a manual_pin promotion, false for a manual-mode promotion and for automatic rows. A later change of the promotion mode does not change it.';
--> statement-breakpoint
COMMENT ON COLUMN public.order_discounts.line_quantity IS 'For a manual line discount, the line quantity its amount is for; a partial void rescales the amount to the remaining quantity (round(amount * remaining / line_quantity)). NULL on other rows.';
--> statement-breakpoint
CREATE INDEX idx_order_discounts_order_id ON public.order_discounts USING btree (order_id);
--> statement-breakpoint
CREATE INDEX idx_order_discounts_order_item_id ON public.order_discounts USING btree (order_item_id) WHERE (order_item_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_order_discounts_promotion_id ON public.order_discounts USING btree (promotion_id) WHERE (promotion_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.promotion_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.promotion_subcategories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.promotion_combo_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.promotion_combo_options ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.order_discounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY promotion_categories_select_policy ON public.promotion_categories FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_categories_insert_policy ON public.promotion_categories FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_categories_update_policy ON public.promotion_categories FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_categories_delete_policy ON public.promotion_categories FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotion_categories TO vipe_api;
--> statement-breakpoint
CREATE POLICY promotion_subcategories_select_policy ON public.promotion_subcategories FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_subcategories_insert_policy ON public.promotion_subcategories FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_subcategories_update_policy ON public.promotion_subcategories FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_subcategories_delete_policy ON public.promotion_subcategories FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotion_subcategories TO vipe_api;
--> statement-breakpoint
CREATE POLICY promotion_combo_groups_select_policy ON public.promotion_combo_groups FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_groups_insert_policy ON public.promotion_combo_groups FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_groups_update_policy ON public.promotion_combo_groups FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_groups_delete_policy ON public.promotion_combo_groups FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotion_combo_groups TO vipe_api;
--> statement-breakpoint
CREATE POLICY promotion_combo_options_select_policy ON public.promotion_combo_options FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_options_insert_policy ON public.promotion_combo_options FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_options_update_policy ON public.promotion_combo_options FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY promotion_combo_options_delete_policy ON public.promotion_combo_options FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promotion_combo_options TO vipe_api;
--> statement-breakpoint
CREATE POLICY order_discounts_select_policy ON public.order_discounts FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_discounts_insert_policy ON public.order_discounts FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_discounts_update_policy ON public.order_discounts FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_discounts_delete_policy ON public.order_discounts FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_discounts TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.guard_order_discount_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('postgres', 'vipe_migrator') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.id IN (OLD.order_id, NEW.order_id) AND o.status IN ('paid', 'cancelled')) THEN
    RAISE EXCEPTION 'order_discounts: the order is paid or cancelled' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_order_discount_lifecycle() IS 'BEFORE INSERT OR UPDATE OR DELETE on order_discounts, for every role but postgres and vipe_migrator (the SECURITY DEFINER RPCs, migrations and seeds): no discount is added, changed or removed on a paid or cancelled order (the 0018 guard_order_lifecycle rule). 42501.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_order_discount_lifecycle() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER order_discounts_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON public.order_discounts
  FOR EACH ROW EXECUTE FUNCTION private.guard_order_discount_lifecycle();
--> statement-breakpoint
CREATE FUNCTION private.order_bill_base(p_order_id uuid, OUT gross bigint, OUT discounts bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT g.gross, LEAST(g.gross, d.discounts)
    FROM (SELECT coalesce(sum(round(oi.price * oi.quantity)), 0)::bigint AS gross
            FROM public.order_items oi
           WHERE oi.order_id = p_order_id) g,
         (SELECT coalesce(sum(od.amount), 0)::bigint AS discounts
            FROM public.order_discounts od
            LEFT JOIN public.order_items oi ON oi.id = od.order_item_id
           WHERE od.order_id = p_order_id
             AND (od.order_item_id IS NULL OR oi.status IS DISTINCT FROM 'cancelled')
             AND NOT (od.kind = 'combo'
                      AND EXISTS (SELECT 1 FROM public.order_items ci
                                   WHERE ci.combo_id = od.combo_id AND ci.status = 'cancelled'))) d
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.order_bill_base(uuid) IS 'Bill base of an order (0027): gross = sum(round(price * quantity)) of its lines (list prices), discounts = sum of its order_discounts whose line is not cancelled (a combo row only while no line of its combo is cancelled), capped at gross. subtotal = gross - discounts. Used by recompute_order_bill and pay_order; not executable by vipe_api.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.order_bill_base(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.recompute_order_bill(p_order_id uuid) RETURNS TABLE(subtotal numeric, tax numeric, tip numeric, total numeric, tax_percentage numeric, tip_percentage numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_gross     bigint := 0;
  v_discounts bigint := 0;
  v_subtotal  bigint := 0;
  v_tax_pct   numeric := 0;
  v_tip_pct   numeric := 0;
  v_tax       bigint := 0;
  v_tip       bigint := 0;
  v_total     bigint := 0;
BEGIN
  -- 0027: a paid or cancelled order keeps the bill it was closed with.
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.status IN ('paid', 'cancelled')) THEN
    RETURN QUERY SELECT o.subtotal, o.tax, o.tip, o.total, o.tax_percentage, o.tip_percentage
                   FROM public.orders o WHERE o.id = p_order_id;
    RETURN;
  END IF;

  SELECT b.gross, b.discounts INTO v_gross, v_discounts
    FROM private.order_bill_base(p_order_id) b;
  v_subtotal := v_gross - v_discounts;

  SELECT coalesce(o.tax_percentage, 0), coalesce(o.tip_percentage, 0)
    INTO v_tax_pct, v_tip_pct
    FROM public.orders o
   WHERE o.id = p_order_id;

  v_tax   := round((v_subtotal * v_tax_pct / 100)::numeric)::bigint;
  v_tip   := round((v_subtotal * v_tip_pct / 100)::numeric)::bigint;
  v_total := v_subtotal + v_tax + v_tip;

  UPDATE public.orders o
     SET subtotal = v_subtotal,
         total_discounts = v_discounts,
         tax      = v_tax,
         tip      = v_tip,
         total    = v_total,
         updated_at = now()
   WHERE o.id = p_order_id;

  RETURN QUERY SELECT v_subtotal::numeric, v_tax::numeric, v_tip::numeric,
                      v_total::numeric, v_tax_pct, v_tip_pct;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.recompute_order_bill(p_order_id uuid) IS 'Private bill recompute helper (split_order, undo_split, void_order_items, void_payment, recompute_caller_order_bill). SECURITY DEFINER. Since 0027 subtotal is the net base of private.order_bill_base (list prices minus the order''s discounts) and total_discounts the discounts; tax and the suggested tip (tip_percentage, as pay_order) are computed on that subtotal. A paid or cancelled order is not rewritten (its current values are returned). Not executable by vipe_api.';
--> statement-breakpoint
ALTER TABLE public.payment_tenders
    DROP CONSTRAINT payment_tenders_amount_check,
    ADD CONSTRAINT payment_tenders_amount_check CHECK (amount > 0 OR (amount = 0 AND line_no = 1 AND method_kind = 'cash' AND cash_received = 0));
--> statement-breakpoint
COMMENT ON CONSTRAINT payment_tenders_amount_check ON public.payment_tenders IS 'A tender applies a positive amount; since 0027 a single 0 cash line with cash_received 0 closes an order with nothing to charge (pay_order checks amount_due + tip = 0).';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pay_order(p_order_id uuid, p_cash_register_id uuid, p_tip_amount bigint, p_tenders jsonb, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_order           public.orders%ROWTYPE;
  v_register        public.cash_registers%ROWTYPE;
  v_delivery_fee    bigint := 0;

  v_subtotal        bigint := 0;
  v_gross           bigint := 0;
  v_discounts       bigint := 0;
  v_tax             bigint := 0;
  v_amount_due      bigint := 0;

  v_tender_count    integer;
  v_tenders_sum     bigint := 0;
  v_change_given    bigint := 0;
  v_cash_received_sum bigint := 0;

  v_existing        public.payments%ROWTYPE;
  v_payment_id      uuid;

  v_drawer_cash_before bigint := 0;
  v_drawer_warning  boolean := false;

  v_tender          jsonb;
  v_method_id       uuid;
  v_method_code     text;
  v_method_kind     text;
  v_method_active   boolean;
  v_method_tenant   uuid;
  v_amount          bigint;
  v_cash_received   bigint;
  v_reference       text;

  v_line_no         smallint := 0;
  v_tender_json     jsonb;
  v_tender_lines    jsonb := '[]'::jsonb;

  v_pending_line_no        smallint[] := '{}'::smallint[];
  v_pending_payment_method uuid[]    := '{}'::uuid[];
  v_pending_amount         bigint[]  := '{}'::bigint[];
  v_pending_cash_received  bigint[]  := '{}'::bigint[];
  v_pending_reference      text[]    := '{}'::text[];

  v_i              integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- CHANGE 1: delivery_operator is admitted so the operator can record a
  -- prepaid payment or a cash-on-delivery collection without handing the
  -- drawer to a cashier.
  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'pay_order: only cashier, admin or delivery_operator may settle an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id()
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'pay_order: p_idempotency_key must not be null'
      USING ERRCODE = '22023';
  END IF;

  IF p_tip_amount IS NULL OR p_tip_amount < 0 THEN
    RAISE EXCEPTION 'pay_order: p_tip_amount must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_tenders IS NULL OR jsonb_typeof(p_tenders) <> 'array' OR jsonb_array_length(p_tenders) = 0 THEN
    RAISE EXCEPTION 'pay_order: p_tenders must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_tenders) > 20 THEN
    RAISE EXCEPTION 'pay_order: p_tenders accepts at most 20 lines'
      USING ERRCODE = '22023';
  END IF;

  v_tender_count := jsonb_array_length(p_tenders);

  FOR v_line_no IN 1..v_tender_count LOOP
    v_tender := p_tenders -> (v_line_no - 1);

    IF v_tender IS NULL OR jsonb_typeof(v_tender) <> 'object' THEN
      RAISE EXCEPTION 'pay_order: tender[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_tender ? 'payment_method_id') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing payment_method_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_method_id := (v_tender ->> 'payment_method_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_tender ? 'amount') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing amount', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_amount := (v_tender ->> 'amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    -- 0027: a single 0 tender closes an order with nothing to charge
    -- (amount_due + tip = 0, a 100 % courtesy); step 6 checks it is cash and
    -- the sum check re-checks the amount under the order lock.
    IF v_amount IS NULL OR v_amount < 0
       OR (v_amount = 0 AND NOT (v_tender_count = 1 AND p_tip_amount = 0 AND EXISTS (
             SELECT 1 FROM public.orders o, private.order_bill_base(o.id) b
              WHERE o.id = p_order_id AND o.restaurant_id = v_caller_tenant
                AND b.gross > 0 AND b.discounts = b.gross
                AND (o.order_type <> 'delivery'
                     OR coalesce((SELECT od.delivery_fee FROM public.order_deliveries od WHERE od.order_id = o.id), 0) = 0)))) THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF v_tender ? 'cash_received' AND v_tender -> 'cash_received' IS NOT NULL AND v_tender -> 'cash_received' <> 'null'::jsonb THEN
      BEGIN
        v_cash_received := (v_tender ->> 'cash_received')::bigint;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received is not an integer', v_line_no
          USING ERRCODE = '22023';
      END;
    ELSE
      v_cash_received := NULL;
    END IF;

    -- 0014: optional manual reference (absent or JSON null = none).
    IF v_tender ? 'reference' AND v_tender -> 'reference' <> 'null'::jsonb THEN
      IF jsonb_typeof(v_tender -> 'reference') <> 'string' THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be a string', v_line_no
          USING ERRCODE = '22023';
      END IF;
      v_reference := btrim(v_tender ->> 'reference');
      IF length(v_reference) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be 1 to 60 characters', v_line_no
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_reference := NULL;
    END IF;

    v_pending_line_no        := v_pending_line_no || v_line_no;
    v_pending_payment_method := v_pending_payment_method || v_method_id;
    v_pending_amount         := v_pending_amount || v_amount;
    v_pending_cash_received  := v_pending_cash_received || v_cash_received;
    v_pending_reference      := v_pending_reference || v_reference;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_order.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Existing payment for this order? UNIQUE (order_id) makes this a 0/1
  -- decision.
  -- 0018: a voided payment does not settle the order; its key stays spent.
  IF EXISTS (SELECT 1 FROM public.payments p
              WHERE p.restaurant_id = v_caller_tenant
                AND p.idempotency_key = p_idempotency_key
                AND p.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'pay_order: idempotency key % belongs to a voided payment; retry with a new key', p_idempotency_key
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_existing
    FROM public.payments p
   WHERE p.order_id = p_order_id
     AND p.voided_at IS NULL;

  IF FOUND THEN
    IF v_existing.idempotency_key = p_idempotency_key THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'line_no', t.line_no,
                 'method_code', t.method_code,
                 'amount', t.amount,
                 'cash_received', t.cash_received)
                 ORDER BY t.line_no), '[]'::jsonb)
        INTO v_tender_lines
        FROM public.payment_tenders t
       WHERE t.payment_id = v_existing.id;

      RETURN jsonb_build_object(
        'payment_id',         v_existing.id,
        'status',             'already_paid',
        'amount_due',         v_existing.amount_due,
        'tip_amount',         v_existing.tip_amount,
        'total_charged',      v_existing.total_charged,
        'change_given',       v_existing.change_given,
        'drawer_warning',     false,
        'drawer_cash_before', 0,
        'tenders',            v_tender_lines
      );
    ELSE
      RAISE EXCEPTION 'pay_order: order % is already paid', p_order_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_order.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'pay_order: order % cannot be paid (status=%)',
      p_order_id, v_order.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Cash register.
  SELECT r.* INTO v_register
    FROM public.cash_registers r
   WHERE r.id = p_cash_register_id
     FOR SHARE;

  IF NOT FOUND OR v_register.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: cash register % not found', p_cash_register_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_register.status <> 'open' THEN
    RAISE EXCEPTION 'pay_order: cash register % is not open (status=%)',
      p_cash_register_id, v_register.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Server-side amount. 0027: the net base, list prices minus the
  -- order's discounts (private.order_bill_base); a fully discounted order
  -- with lines is payable with a single 0 cash tender (step 2).
  SELECT b.gross, b.discounts INTO v_gross, v_discounts
    FROM private.order_bill_base(p_order_id) b;
  v_subtotal := v_gross - v_discounts;

  IF v_gross <= 0 THEN
    RAISE EXCEPTION 'pay_order: order % has no items', p_order_id
      USING ERRCODE = 'P0001';
  END IF;

  v_tax := round(v_subtotal * coalesce(v_order.tax_percentage, 0)::numeric / 100)::bigint;

  -- CHANGE 2: add the delivery fee when the order is a delivery. The
  -- order_deliveries row is guaranteed to exist by the consistency trigger
  -- (1:1 with the order, same restaurant). No tax on the fee, no tip on the
  -- fee: the tax is computed on the food subtotal only, and the tip is the
  -- caller's p_tip_amount as today.
  v_delivery_fee := 0;
  IF v_order.order_type = 'delivery' THEN
    SELECT coalesce(od.delivery_fee, 0)
      INTO v_delivery_fee
      FROM public.order_deliveries od
     WHERE od.order_id = p_order_id;

    IF v_delivery_fee IS NULL THEN
      -- A delivery order with no order_deliveries row is a schema invariant
      -- break. The 23514 from the consistency trigger would already have
      -- fired; this is a defense in depth.
      v_delivery_fee := 0;
    END IF;
  END IF;

  v_amount_due := v_subtotal + v_tax + v_delivery_fee;

  -- 6. Tenders.
  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind, m.is_active, m.restaurant_id
      INTO v_method_code, v_method_kind, v_method_active, v_method_tenant
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    IF NOT FOUND OR v_method_tenant <> v_caller_tenant THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id does not resolve to a method of the caller tenant', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_method_active THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id resolves to an inactive method (% of tenant %)',
        v_line_no, v_method_code, v_method_tenant
        USING ERRCODE = 'P0001';
    END IF;

    IF v_amount = 0 AND v_method_kind <> 'cash' THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    -- 0027: a 0 tender takes no cash, so it gives no change.
    IF v_amount = 0 AND v_cash_received IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'pay_order: tender[%].cash_received must be 0 for a 0 amount', v_line_no
        USING ERRCODE = '22023';
    END IF;

    v_tenders_sum := v_tenders_sum + v_amount;

    IF v_method_kind = 'cash' THEN
      IF v_cash_received IS NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is a cash method but cash_received is NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
      IF v_cash_received < v_amount THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received (%) is below amount (%)',
          v_line_no, v_cash_received, v_amount
          USING ERRCODE = 'P0001';
      END IF;
      v_change_given := v_change_given + (v_cash_received - v_amount);
      v_cash_received_sum := v_cash_received_sum + v_cash_received;
    ELSE
      IF v_cash_received IS NOT NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is an electronic method but cash_received is not NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF v_tenders_sum <> (v_amount_due + p_tip_amount) THEN
    RAISE EXCEPTION 'pay_order: tenders sum to % but amount_due + tip = %',
      v_tenders_sum, (v_amount_due + p_tip_amount)
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Drawer warning (warn only).
  v_drawer_cash_before := v_register.initial_cash;

  SELECT coalesce(v_drawer_cash_before + sum(t.amount), v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = p_cash_register_id
     AND p.voided_at IS NULL
     AND t.method_kind = 'cash';

  SELECT coalesce(v_drawer_cash_before
                  + coalesce(sum(CASE WHEN ct.type = 'deposit' THEN ct.amount ELSE 0 END), 0)
                  - coalesce(sum(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END), 0),
                  v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = p_cash_register_id;

  v_drawer_warning := v_change_given > v_drawer_cash_before;

  -- 8. Writes.
  INSERT INTO public.payments (
    restaurant_id, order_id, cash_register_id, cashier_profile_id,
    amount_due, tip_amount, total_charged, change_given, idempotency_key
  ) VALUES (
    v_caller_tenant, p_order_id, p_cash_register_id, v_caller_profile,
    v_amount_due, p_tip_amount, v_amount_due + p_tip_amount, v_change_given, p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind
      INTO v_method_code, v_method_kind
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    INSERT INTO public.payment_tenders (
      restaurant_id, payment_id, line_no, payment_method_id,
      method_code, method_kind, amount, cash_received, reference
    ) VALUES (
      v_caller_tenant, v_payment_id, v_line_no, v_method_id,
      v_method_code, v_method_kind, v_amount, v_cash_received, v_pending_reference[v_i]
    );
  END LOOP;

  -- 9. Order update. tip_percentage is the tip / subtotal ratio (the food
  -- subtotal, NOT amount_due), the same as the original pay_order.
  UPDATE public.orders o
     SET subtotal = v_subtotal,
         total_discounts = v_discounts,
         tax = v_tax,
         tip = p_tip_amount,
         tip_percentage = CASE WHEN v_subtotal > 0
                               THEN round((p_tip_amount * 100.0 / v_subtotal)::numeric, 2)
                               ELSE 0 END,
         total = v_amount_due + p_tip_amount,
         status = 'paid',
         updated_at = now()
   WHERE o.id = p_order_id;

  -- 10. Table release (delivery orders have table_id NULL; the IF guard
  -- already short-circuits).
  IF v_order.table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.table_id = v_order.table_id
         AND o.id <> p_order_id
         AND o.status IN ('active', 'kitchen', 'delivered')
    ) THEN
      UPDATE public.tables t
         SET status = 'available',
             updated_at = now()
       WHERE t.id = v_order.table_id;
    END IF;
  END IF;

  -- 11. Response.
  RETURN jsonb_build_object(
    'payment_id',         v_payment_id,
    'status',             'paid',
    'amount_due',         v_amount_due,
    'tip_amount',         p_tip_amount,
    'total_charged',      v_amount_due + p_tip_amount,
    'change_given',       v_change_given,
    'drawer_warning',     v_drawer_warning,
    'drawer_cash_before', v_drawer_cash_before,
    'tenders',            (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'line_no',        t.line_no,
        'method_code',    t.method_code,
        'amount',         t.amount,
        'cash_received',  t.cash_received
      ) ORDER BY t.line_no), '[]'::jsonb)
        FROM public.payment_tenders t
       WHERE t.payment_id = v_payment_id
    )
  );
END;
$$;
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
  v_combo_id uuid;
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

  -- 0027: a combo moves whole: every standing line of its combo, all units.
  FOR v_line_no IN 1..v_item_count LOOP
    SELECT oi.combo_id INTO v_combo_id
      FROM public.order_items oi
     WHERE oi.id = v_pending_item_id[v_line_no];

    IF v_combo_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.order_items ci
       WHERE ci.order_id = p_parent_order_id
         AND ci.combo_id = v_combo_id
         AND ci.status IS DISTINCT FROM 'cancelled'
         AND coalesce(v_pending_quantity[array_position(v_pending_item_id, ci.id)], 0) <> ci.quantity) THEN
      RAISE EXCEPTION 'split_order: item[%] is part of a combo; move every line of the combo together', v_line_no
        USING ERRCODE = 'P0001';
    END IF;
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
    0, true, p_parent_order_id
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

      -- 0027: the line's discounts go with it.
      UPDATE public.order_discounts d
         SET order_id = v_child_id
       WHERE d.order_item_id = v_item_id;
    ELSE
      UPDATE public.order_items oi
         SET quantity = oi.quantity - v_item_qty
       WHERE oi.id = v_item_id;

      INSERT INTO public.order_items (
        order_id, dish_id, name, price, quantity, comments,
        status, added_at, restaurant_id, stock_consumed_at,
        promotion_id, promotion_snapshot, combo_id
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant, v_parent_item.stock_consumed_at,
        v_parent_item.promotion_id, v_parent_item.promotion_snapshot, v_parent_item.combo_id
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

      -- 0027: the line's item discounts are shared by units, allocated per
      -- line: the new line's running share over the rows (by created_at, id)
      -- is round(running amount * moved / quantity), clamped so neither side
      -- ever holds more than its own value round(price * quantity); each row
      -- takes the step of that running share, the line keeps the rest, and
      -- a row left at 0 is dropped.
      WITH r AS (
        SELECT d.id,
               row_number() OVER w AS rn,
               sum(d.amount) OVER w AS run,
               round(sum(d.amount) OVER w * v_item_qty / v_parent_item.quantity) AS naive
          FROM public.order_discounts d
         WHERE d.order_item_id = v_item_id
        WINDOW w AS (ORDER BY d.created_at, d.id)
      ), c AS (
        SELECT r.id, r.rn,
               LEAST(GREATEST(r.naive, r.run - round(v_parent_item.price * (v_parent_item.quantity - v_item_qty))),
                     round(v_parent_item.price * v_item_qty), r.run) AS cum
          FROM r
      ), s AS (
        SELECT c.id, c.cum - coalesce(lag(c.cum) OVER (ORDER BY c.rn), 0) AS share
          FROM c
      ), moved AS (
        INSERT INTO public.order_discounts (
          restaurant_id, order_id, order_item_id, promotion_id, kind, source, label,
          amount, combo_id, reason, created_by, authorized_by, requires_authorization, line_quantity, created_at
        )
        SELECT d.restaurant_id, v_child_id, v_new_item_id, d.promotion_id, d.kind, d.source, d.label,
               s.share, d.combo_id, d.reason, d.created_by, d.authorized_by, d.requires_authorization,
               CASE WHEN d.line_quantity IS NOT NULL THEN v_item_qty END, d.created_at
          FROM public.order_discounts d
          JOIN s ON s.id = d.id
         WHERE s.share > 0
      )
      -- line_quantity follows the units each side keeps, so the shares are not rescaled again.
      UPDATE public.order_discounts d
         SET amount = d.amount - s.share,
             line_quantity = CASE WHEN d.line_quantity IS NOT NULL THEN v_parent_item.quantity - v_item_qty END
        FROM s
       WHERE d.id = s.id;

      DELETE FROM public.order_discounts d
       WHERE d.order_item_id = v_item_id
         AND d.amount <= 0;
    END IF;
  END LOOP;

  -- 0027: combo rows go with their lines (a combo moves whole, see 5).
  UPDATE public.order_discounts d
     SET order_id = v_child_id
   WHERE d.order_id = p_parent_order_id
     AND d.kind = 'combo'
     AND d.combo_id IN (SELECT oi.combo_id FROM public.order_items oi
                         WHERE oi.order_id = v_child_id AND oi.combo_id IS NOT NULL);

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
       AND oi.promotion_id IS NOT DISTINCT FROM v_child_item.promotion_id
       AND oi.combo_id IS NOT DISTINCT FROM v_child_item.combo_id
       AND private.order_item_modifier_key(oi.id) = private.order_item_modifier_key(v_child_item.id)
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.order_items oi
         SET quantity = oi.quantity + v_child_item.quantity
       WHERE oi.id = v_match.id;

      -- 0027: the line's discounts move to the line it merges into.
      UPDATE public.order_discounts d
         SET order_id = v_parent.id, order_item_id = v_match.id
       WHERE d.order_item_id = v_child_item.id;

      DELETE FROM public.order_items WHERE id = v_child_item.id;
    ELSE
      UPDATE public.order_items oi
         SET order_id = v_parent.id
       WHERE oi.id = v_child_item.id;

      UPDATE public.order_discounts d
         SET order_id = v_parent.id
       WHERE d.order_item_id = v_child_item.id;
    END IF;
  END LOOP;

  -- 0027: the child's manual bill discounts and combo rows go back to the
  -- parent; its automatic bill rows go with it (the API recomputes them).
  UPDATE public.order_discounts d
     SET order_id = v_parent.id
   WHERE d.order_id = p_child_order_id
     AND d.order_item_id IS NULL
     AND (d.source = 'manual' OR d.kind = 'combo');

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
ALTER TABLE public.supervisor_authorizations
  DROP CONSTRAINT supervisor_authorizations_target_action_check,
  ADD CONSTRAINT supervisor_authorizations_target_action_check CHECK (
    target_type IS NULL
    OR (target_type = 'order' AND action IN ('cancel_order', 'void_item', 'apply_discount'))
    OR (target_type = 'payment' AND action = 'void_payment'));
--> statement-breakpoint
COMMENT ON COLUMN public.supervisor_authorizations.target_id IS 'The order (cancel_order, void_item, apply_discount since 0027) or payment (void_payment) the authorization is for (0018); the cancellation, void or discount must name the same target and be done by requested_by_profile_id. NULL on rows from before 0018, which back no event.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.create_target_authorization(p_supervisor_profile_id uuid, p_action text, p_now timestamptz, p_target_type text, p_target_id uuid)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_target_type IS NULL OR p_target_id IS NULL
     OR NOT ((p_target_type = 'order' AND p_action IN ('cancel_order', 'void_item', 'apply_discount'))
             OR (p_target_type = 'payment' AND p_action = 'void_payment')) THEN
    RAISE EXCEPTION 'create_target_authorization: the target does not match the action' USING ERRCODE = '22023';
  END IF;
  v_id := private.create_supervisor_authorization(p_supervisor_profile_id, p_action, p_now);
  UPDATE public.supervisor_authorizations SET target_type = p_target_type, target_id = p_target_id WHERE id = v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_target_authorization(uuid, text, timestamptz, text, uuid) IS 'private.create_supervisor_authorization (same checks: an active admin or cashier with a PIN of the caller''s restaurant, requested_by = the caller, which on a shared terminal is the identified staff member) bound to one target: an order for cancel_order, void_item and apply_discount (0027), a payment for void_payment (else 22023, also for an unknown action). The target is not looked up here: an authorization for a foreign or unknown target simply backs no event.';
--> statement-breakpoint
CREATE FUNCTION private.discount_authorizer(p_order_id uuid, p_authorization_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'apply_discount';
  v_caller record;
  v_auth   record;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier']);
  SELECT * INTO v_auth FROM private.void_authorizer(c_fn, v_caller.restaurant_id, v_caller.profile_id, 'apply_discount',
                                                    'order', p_order_id, p_authorization_id, true);
  RETURN v_auth.authorized_by;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.discount_authorizer(uuid, uuid) IS 'The supervisor behind a manual discount or its removal (0027, S7): private.void_authorizer for action apply_discount on this order and the calling admin or cashier (42501 apply_discount: authorization_required / authorization_invalid / self_authorization_not_allowed). The API consumes the authorization (private.consume_supervisor_authorization) in the same transaction first.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.discount_authorizer(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.discount_authorizer(uuid, uuid) TO vipe_api;
