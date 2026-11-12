-- Demo data for the staging demo, reachable only from the Tailscale network
-- (odd/tasks/migracion-backend-nestjs.md, T16, S6, L31; odd/tasks/demo-bar.md):
-- "Bruma — Bar de coctelería", a fictional cocktail and beer bar in Chapinero,
-- Bogotá, with staff for every role, a bar menu with modifiers and
-- promotions, a bar floor plan, two inventory locations (Barra, Bodega),
-- purchases, transfers, counts, daily production, 30 days of history and
-- live activity right now. Every name, phone, address and NIT is invented;
-- real brand names appear only as products sold.
--
-- Run by demo-db.sh as vipe_migrator (SET LOCAL ROLE), in the same transaction and right after
-- seed/bootstrap/create-restaurant.sql, which created the restaurant and its
-- admin and left the id in the setting vipe.restaurant_id. psql variable:
--   demo_hash  argon2id hash of DEMO_PASSWORD, for every staff account
--
-- The data goes through the same functions the API calls, run as the staff
-- member who does it in the app (app.user_id, as the API sets it per request):
-- private.create_staff_user, inventory_adjust, save_formula,
-- receive_purchase_order, the transfer and count RPCs, produce_preparations,
-- the order insert of OrdersService with private.add_order_item_modifiers,
-- recompute_caller_order_bill and consume_order_stock, create_delivery_order,
-- set_delivery_status, cancel_order, pay_order and close_register. The
-- automatic discounts of OrdersService (apps/api/src/promotions/engine) are
-- reproduced in SQL by pg_temp.demo_discounts: product_discount,
-- buy_x_pay_y, combo and bill_discount, with the toSnapshot rule on each line.
-- Their timestamps are now(), so the history rows are backdated afterwards
-- (vipe_migrator, the schema owner, passes the immutability guards for that
-- UPDATE only; no trigger or constraint is disabled). Direct inserts name
-- restaurant_id: the column default private.default_restaurant_id() only
-- fills it for the API role and for a user named postgres. No print job is
-- queued.
--
-- A business day runs from 16:00 to about 00:30 (02:30 on Friday and
-- Saturday); business_day_cutoff_hour is 5, so each register belongs to the
-- day it opened. Random choices use setseed, so a run on the same day gives
-- the same shape.

SET LOCAL vipe.demo_hash = :'demo_hash';

-- ---------------------------------------------------------------------------
-- Working tables
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE demo_staff (role text, profile_id uuid, seq integer) ON COMMIT DROP;
CREATE TEMP TABLE demo_menu (dish_id uuid, grp text, weight numeric) ON COMMIT DROP;
-- One row per pick; combo components share combo_id and carry their promotion.
CREATE TEMP TABLE demo_cart (
  ord serial, dish_id uuid, quantity integer, comments text, option_ids uuid[] DEFAULT '{}',
  combo_id uuid, promotion_id uuid
) ON COMMIT DROP;
CREATE TEMP TABLE demo_methods (code text, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE demo_couriers (id uuid) ON COMMIT DROP;
CREATE TEMP TABLE demo_customers (
  phone text PRIMARY KEY, name text, address_line text, neighborhood text, reference text,
  weight numeric, customer_id uuid, address_id uuid
) ON COMMIT DROP;
CREATE TEMP TABLE demo_tables (number integer, id uuid, seats integer) ON COMMIT DROP;
CREATE TEMP TABLE demo_od (LIKE public.order_deliveries) ON COMMIT DROP;
-- The engine rule of every promotion (toSnapshot shape), built once after the promotions.
CREATE TEMP TABLE demo_rules (id uuid PRIMARY KEY, kind text, created_at timestamptz, rule jsonb) ON COMMIT DROP;
CREATE TEMP SEQUENCE demo_line_seq;

-- First profile of a role (demo_staff.seq = 1), or the n-th.
CREATE FUNCTION pg_temp.demo_profile(p_role text, p_seq integer DEFAULT 1) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT profile_id FROM demo_staff WHERE role = p_role AND seq = p_seq
$$;

-- ---------------------------------------------------------------------------
-- Helpers (session temp schema, gone when psql exits)
-- ---------------------------------------------------------------------------

-- Act as one staff member, as the API does with SET LOCAL app.user_id.
CREATE FUNCTION pg_temp.demo_as(p_profile uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('app.user_id', (SELECT p.user_id::text FROM public.profiles p WHERE p.id = p_profile), true)
$$;

-- Local wall-clock time of the bar to timestamptz (hours past 24 are after midnight).
CREATE FUNCTION pg_temp.demo_at(p_day date, p_time interval) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT ((p_day + p_time)::timestamp AT TIME ZONE 'America/Bogota')
$$;

-- An instant as JavaScript's toISOString().
CREATE FUNCTION pg_temp.demo_iso(p_at timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Weighted random dish of one menu group (exponential race on the weights).
CREATE FUNCTION pg_temp.demo_pick(p_group text) RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT m.dish_id FROM demo_menu m WHERE m.grp = p_group
   ORDER BY -ln(1 - random()) / m.weight LIMIT 1
$$;

-- Random time between two local hours, peaking in the middle.
CREATE FUNCTION pg_temp.demo_slot(p_from numeric, p_to numeric) RETURNS interval
LANGUAGE sql VOLATILE AS $$
  SELECT make_interval(secs => ((p_from + (p_to - p_from) * (random() + random()) / 2) * 3600)::integer)
$$;

-- The options a guest picks for a dish: for each group the dish offers,
-- between min_select and max_select options, the first options more likely.
CREATE FUNCTION pg_temp.demo_options(p_dish uuid) RETURNS uuid[]
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  g record;
  v_ids uuid[] := '{}';
  v_n integer;
BEGIN
  FOR g IN
    SELECT mg.id, mg.min_select, mg.max_select FROM public.dish_modifier_groups dg
      JOIN public.modifier_groups mg ON mg.id = dg.group_id
     WHERE dg.dish_id = p_dish AND mg.is_active ORDER BY dg.sort_order
  LOOP
    v_n := greatest(g.min_select, CASE WHEN coalesce(g.max_select, 2) > 1 AND random() < 0.35 THEN 2 ELSE 1 END);
    v_n := least(v_n, coalesce(g.max_select, v_n));
    IF g.min_select = 0 AND random() < 0.5 THEN v_n := 0; END IF;
    v_ids := v_ids || ARRAY(
      SELECT o.id FROM public.modifier_options o WHERE o.group_id = g.id AND o.is_active
       ORDER BY -ln(1 - random()) * (1 + o.sort_order) LIMIT v_n);
  END LOOP;
  RETURN v_ids;
END;
$$;

-- One pick into demo_cart, with its options.
CREATE FUNCTION pg_temp.demo_cart_add(p_dish uuid, p_quantity integer DEFAULT 1, p_comments text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO demo_cart (dish_id, quantity, comments, option_ids)
  SELECT p_dish, p_quantity, p_comments, pg_temp.demo_options(p_dish) WHERE p_dish IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- Promotion engine (apps/api/src/promotions/engine, promotion-snapshot.ts)
-- ---------------------------------------------------------------------------

-- A promotion as toSnapshot stores it on order_items.promotion_snapshot
-- (PromotionCatalog.records: local dates, sorted days, ordered targets).
CREATE FUNCTION pg_temp.demo_rule_of(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'kind', p.kind, 'mode', p.mode, 'active', p.active IS TRUE,
    'startDate', to_char((p.start_date AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD'),
    'endDate', to_char((p.end_date AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD'),
    'daysOfWeek', to_jsonb(ARRAY(SELECT x FROM unnest(p.days_of_week) x ORDER BY x)),
    'timeWindows', p.time_windows, 'channels', to_jsonb(p.channels),
    'maxUsesPerOrder', p.max_uses_per_order, 'createdAt', pg_temp.demo_iso(p.created_at),
    'discountType', p.discount_type, 'discountValue', p.discount_value::numeric,
    'buyQuantity', coalesce(p.buy_quantity, 0), 'payQuantity', coalesce(p.pay_quantity, 0),
    'restDiscountPercent', coalesce(p.rest_discount_percent, 0), 'comboPrice', coalesce(p.combo_price, 0)::numeric,
    'comboGroups', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'dishIds', coalesce((
               SELECT jsonb_agg(o.dish_id ORDER BY o.created_at, o.dish_id) FROM public.promotion_combo_options o
                WHERE o.group_id = g.id), '[]'::jsonb)) ORDER BY g.position, g.created_at, g.id)
        FROM public.promotion_combo_groups g WHERE g.promotion_id = p.id), '[]'::jsonb),
    'minSubtotal', p.min_subtotal::numeric, 'maxDiscount', p.max_discount::numeric,
    'targets', jsonb_build_object(
      'dishIds', coalesce((SELECT jsonb_agg(x.dish_id ORDER BY x.dish_id) FROM public.promotion_dishes x WHERE x.promotion_id = p.id), '[]'::jsonb),
      'categoryIds', coalesce((SELECT jsonb_agg(x.category_id ORDER BY x.category_id) FROM public.promotion_categories x WHERE x.promotion_id = p.id), '[]'::jsonb),
      'subcategoryIds', coalesce((SELECT jsonb_agg(x.subcategory_id ORDER BY x.subcategory_id) FROM public.promotion_subcategories x WHERE x.promotion_id = p.id), '[]'::jsonb)),
    'unitNoun', NULL)
    FROM public.promotions p WHERE p.id = p_id
$$;

-- isLiveFor: active, inside its dates, automatic, on the day, inside a
-- [from, to) window and for the channel, at p_at in the bar's time zone.
CREATE FUNCTION pg_temp.demo_live(p_rule jsonb, p_at timestamptz, p_channel text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  WITH l AS (SELECT (p_at AT TIME ZONE 'America/Bogota') AS t)
  SELECT (p_rule ->> 'active')::boolean
     AND to_char(l.t, 'YYYY-MM-DD') >= p_rule ->> 'startDate'
     AND (p_rule ->> 'endDate' IS NULL OR to_char(l.t, 'YYYY-MM-DD') <= p_rule ->> 'endDate')
     AND p_rule ->> 'mode' = 'automatic'
     AND (jsonb_array_length(p_rule -> 'daysOfWeek') = 0 OR (p_rule -> 'daysOfWeek') @> to_jsonb(extract(isodow FROM l.t)::int))
     AND (jsonb_array_length(p_rule -> 'timeWindows') = 0 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_rule -> 'timeWindows') w
            WHERE to_char(l.t, 'HH24:MI') >= w ->> 'from' AND to_char(l.t, 'HH24:MI') < w ->> 'to'))
     AND (jsonb_array_length(p_rule -> 'channels') = 0 OR (p_rule -> 'channels') ? p_channel)
    FROM l
$$;

-- amountOff: percentage rounds to whole pesos, fixed never exceeds the base.
CREATE FUNCTION pg_temp.demo_amount_off(p_base numeric, p_rule jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rule ->> 'discountType'
           WHEN 'percentage' THEN least(p_base, round(p_base * (p_rule ->> 'discountValue')::numeric / 100))
           WHEN 'fixed_amount' THEN least(p_base, (p_rule ->> 'discountValue')::numeric)
           ELSE 0 END
$$;

-- selectPromotionForNewItem: the live automatic product_discount or
-- buy_x_pay_y the dish matches with the best unit saving, oldest on ties.
CREATE FUNCTION pg_temp.demo_tag(p_dish uuid, p_price numeric, p_at timestamptz, p_channel text)
RETURNS TABLE (promotion_id uuid, snapshot jsonb)
LANGUAGE sql STABLE AS $$
  SELECT r.id, r.rule
    FROM demo_rules r
    JOIN public.dishes d ON d.id = p_dish
   CROSS JOIN LATERAL (SELECT CASE WHEN r.kind = 'product_discount' THEN pg_temp.demo_amount_off(p_price, r.rule)
                                   ELSE p_price * ((r.rule ->> 'buyQuantity')::int - (r.rule ->> 'payQuantity')::int)
                                        * (r.rule ->> 'restDiscountPercent')::numeric / ((r.rule ->> 'buyQuantity')::int * 100) END AS saving) s
   WHERE r.kind IN ('product_discount', 'buy_x_pay_y')
     AND pg_temp.demo_live(r.rule, p_at, p_channel)
     AND ((r.rule -> 'targets' -> 'dishIds') ? d.id::text
          OR (r.rule -> 'targets' -> 'categoryIds') ? d.category_id::text
          OR (d.subcategory_id IS NOT NULL AND (r.rule -> 'targets' -> 'subcategoryIds') ? d.subcategory_id::text))
     AND s.saving > 0
   ORDER BY s.saving DESC, r.created_at, r.id
   LIMIT 1
$$;

-- OrderDiscountsService.recompute: the order's automatic order_discounts from
-- its live lines (computeOrderDiscounts: product, buy X pay Y, combo, then the
-- best live bill discount at p_at on what is left), then the bill.
CREATE FUNCTION pg_temp.demo_discounts(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_channel text;
  v_rid uuid;
  v_gross numeric;
  v_product numeric;
BEGIN
  SELECT o.order_type, o.restaurant_id INTO v_channel, v_rid FROM public.orders o WHERE o.id = p_order;
  DELETE FROM public.order_discounts WHERE order_id = p_order AND source = 'automatic';

  WITH live AS (
    SELECT oi.id, oi.price, oi.quantity, oi.promotion_id, oi.combo_id, oi.added_at,
           coalesce((SELECT sum(m.price) FROM public.order_item_modifiers m WHERE m.order_item_id = oi.id), 0) AS options_price
      FROM public.order_items oi
     WHERE oi.order_id = p_order AND oi.status IS DISTINCT FROM 'cancelled' AND oi.quantity > 0),
  rules AS (
    SELECT DISTINCT ON (oi.promotion_id) oi.promotion_id AS id, oi.promotion_snapshot AS r
      FROM public.order_items oi
     WHERE oi.order_id = p_order AND oi.promotion_id IS NOT NULL AND oi.promotion_snapshot IS NOT NULL
     ORDER BY oi.promotion_id, oi.added_at, oi.created_at, oi.id),
  prod AS (
    SELECT l.id AS item_id, ru.id AS pid, ru.r ->> 'name' AS label, NULL::uuid AS combo_id, 'promotion_item' AS kind,
           greatest(0, least(l.quantity, coalesce((ru.r ->> 'maxUsesPerOrder')::int, 1000000)
             - coalesce(sum(l.quantity) OVER (PARTITION BY ru.id ORDER BY l.added_at, l.id
                                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)))
           * pg_temp.demo_amount_off(l.price, ru.r) AS amount
      FROM live l JOIN rules ru ON ru.id = l.promotion_id
     WHERE l.combo_id IS NULL AND ru.r ->> 'kind' = 'product_discount'),
  units AS (
    SELECT l.id, ru.id AS pid, ru.r, l.price,
           row_number() OVER (PARTITION BY ru.id ORDER BY l.price DESC, l.added_at, l.id, g) AS rn,
           count(*) OVER (PARTITION BY ru.id) AS total
      FROM live l JOIN rules ru ON ru.id = l.promotion_id
     CROSS JOIN generate_series(1, l.quantity) g
     WHERE l.combo_id IS NULL AND ru.r ->> 'kind' = 'buy_x_pay_y'),
  bxy AS (
    SELECT u.id AS item_id, u.pid, u.r ->> 'name' AS label, NULL::uuid AS combo_id, 'promotion_item' AS kind,
           sum(least(u.price, round(u.price * (u.r ->> 'restDiscountPercent')::numeric / 100))) AS amount
      FROM units u
     WHERE (u.rn - 1) / (u.r ->> 'buyQuantity')::int
             < least(u.total / (u.r ->> 'buyQuantity')::int, coalesce((u.r ->> 'maxUsesPerOrder')::int, 1000000))
       AND (u.rn - 1) % (u.r ->> 'buyQuantity')::int >= (u.r ->> 'payQuantity')::int
     GROUP BY u.id, u.pid, u.r ->> 'name'),
  combo AS (
    SELECT DISTINCT ON (l.combo_id) l.id AS item_id, ru.id AS pid, ru.r ->> 'name' AS label, l.combo_id, 'combo' AS kind,
           sum((l.price - l.options_price) * l.quantity) OVER (PARTITION BY l.combo_id) - (ru.r ->> 'comboPrice')::numeric AS amount
      FROM live l JOIN rules ru ON ru.id = l.promotion_id
     WHERE l.combo_id IS NOT NULL AND ru.r ->> 'kind' = 'combo'
     ORDER BY l.combo_id, l.added_at, l.id)
  INSERT INTO public.order_discounts (restaurant_id, order_id, order_item_id, promotion_id, kind, source, label, amount,
                                      combo_id, requires_authorization)
  SELECT v_rid, p_order, x.item_id, x.pid, x.kind, 'automatic', left(x.label, 255), x.amount, x.combo_id, false
    FROM (SELECT * FROM prod UNION ALL SELECT * FROM bxy UNION ALL SELECT * FROM combo) x
   WHERE x.amount > 0;

  SELECT coalesce(sum(oi.price * oi.quantity), 0) INTO v_gross FROM public.order_items oi
   WHERE oi.order_id = p_order AND oi.status IS DISTINCT FROM 'cancelled';
  SELECT coalesce(sum(od.amount), 0) INTO v_product FROM public.order_discounts od WHERE od.order_id = p_order;
  INSERT INTO public.order_discounts (restaurant_id, order_id, promotion_id, kind, source, label, amount, requires_authorization)
  SELECT v_rid, p_order, b.id, 'promotion_bill', 'automatic', left(b.rule ->> 'name', 255), b.amount, false
    FROM (SELECT r.id, r.rule, r.created_at,
                 CASE WHEN r.rule ->> 'maxDiscount' IS NULL THEN pg_temp.demo_amount_off(v_gross - v_product, r.rule)
                      ELSE least(pg_temp.demo_amount_off(v_gross - v_product, r.rule), (r.rule ->> 'maxDiscount')::numeric) END AS amount
            FROM demo_rules r
           WHERE r.kind = 'bill_discount' AND pg_temp.demo_live(r.rule, p_at, v_channel)
             AND v_gross - v_product > 0 AND v_gross - v_product >= coalesce((r.rule ->> 'minSubtotal')::numeric, 0)) b
   WHERE b.amount > 0
   ORDER BY b.amount DESC, b.created_at, b.id
   LIMIT 1;
  PERFORM private.recompute_caller_order_bill(p_order);
END;
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

-- One round of a table: a drink each (cocktails at happy hour, beers and
-- micheladas at night, shots late), or a bucket or a bottle for the group,
-- and food to share. Sometimes the "Cubeta + picada" combo when it is live.
-- p_slot: happy | night | late. Fills demo_cart.
CREATE FUNCTION pg_temp.demo_fill_cart(p_slot text, p_party integer, p_round integer, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_bucket boolean := p_party >= 2 AND p_slot <> 'happy' AND random() < 0.30;
  v_bottle boolean := p_party >= 4 AND p_slot <> 'happy' AND p_round = 1 AND random() < 0.25;
  v_combo jsonb := (SELECT r.rule FROM demo_rules r WHERE r.kind = 'combo' ORDER BY r.created_at LIMIT 1);
  v_cid uuid;
  v_grp text;
  v_r numeric;
  g jsonb;
  i integer;
BEGIN
  TRUNCATE demo_cart;
  IF v_bucket AND p_round = 1 AND v_combo IS NOT NULL AND pg_temp.demo_live(v_combo, p_at, 'dine_in') AND random() < 0.45 THEN
    -- OrdersService combos: one line per choice, sharing a combo_id, tagged with the combo.
    v_cid := gen_random_uuid();
    FOR g IN SELECT * FROM jsonb_array_elements(v_combo -> 'comboGroups') LOOP
      INSERT INTO demo_cart (dish_id, quantity, option_ids, combo_id, promotion_id)
      SELECT x.dish, 1, pg_temp.demo_options(x.dish), v_cid, (v_combo ->> 'id')::uuid
        FROM (SELECT (d #>> '{}')::uuid AS dish FROM jsonb_array_elements(g -> 'dishIds') d ORDER BY random() LIMIT 1) x;
    END LOOP;
  ELSIF v_bucket THEN
    FOR i IN 1..greatest(1, p_party / 3) LOOP PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('cubeta')); END LOOP;
  END IF;
  IF v_bottle THEN
    PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('botella'));
  END IF;
  FOR i IN 1..p_party LOOP
    CONTINUE WHEN v_bucket AND random() < 0.8;
    CONTINUE WHEN v_bottle AND random() < 0.85;
    v_r := random();
    v_grp := CASE p_slot
      WHEN 'happy' THEN CASE WHEN v_r < 0.38 THEN 'clasico' WHEN v_r < 0.62 THEN 'autor' WHEN v_r < 0.85 THEN 'cerveza'
                             WHEN v_r < 0.93 THEN 'michelada' ELSE 'sin' END
      WHEN 'night' THEN CASE WHEN v_r < 0.40 THEN 'cerveza' WHEN v_r < 0.58 THEN 'clasico' WHEN v_r < 0.70 THEN 'autor'
                             WHEN v_r < 0.80 THEN 'michelada' WHEN v_r < 0.88 THEN 'shot' ELSE 'sin' END
      ELSE CASE WHEN v_r < 0.38 THEN 'cerveza' WHEN v_r < 0.62 THEN 'shot' WHEN v_r < 0.78 THEN 'clasico'
                WHEN v_r < 0.88 THEN 'michelada' WHEN v_r < 0.94 THEN 'autor' ELSE 'sin' END END;
    PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick(v_grp), CASE WHEN v_grp = 'shot' AND random() < 0.5 THEN 2 ELSE 1 END,
      CASE WHEN random() < 0.08 THEN (ARRAY['Poco hielo', 'Sin hielo', 'Bien fría', 'Sin sal en el borde',
                                            'Menos dulce'])[1 + floor(random() * 5)::int] END);
  END LOOP;
  IF random() < (CASE WHEN p_round = 1 THEN 0.55 ELSE 0.20 END) THEN
    IF p_party >= 4 AND random() < 0.35 THEN
      PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('picada'));
    ELSE
      FOR i IN 1..(1 + p_party / 3) LOOP
        PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('comida'), 1,
          CASE WHEN random() < 0.1 THEN (ARRAY['Salsa aparte', 'Sin picante', 'Bien tostado'])[1 + floor(random() * 3)::int] END);
      END LOOP;
    END IF;
  END IF;
END;
$$;

-- What a delivery or takeaway customer orders: food, bottles and buckets.
CREATE FUNCTION pg_temp.demo_fill_to_go() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  i integer;
BEGIN
  TRUNCATE demo_cart;
  IF random() < 0.25 THEN
    PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('picada'));
  ELSE
    FOR i IN 1..(1 + floor(random() * 2)::int) LOOP PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('comida')); END LOOP;
  END IF;
  IF random() < 0.35 THEN PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('botella')); END IF;
  IF random() < 0.30 THEN PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('cubeta')); END IF;
  IF random() < 0.30 THEN PERFORM pg_temp.demo_cart_add(pg_temp.demo_pick('sin'), 1 + floor(random() * 2)::int); END IF;
END;
$$;

-- After new lines (OrdersService.afterItems): discounts at p_at, the bill,
-- the stock; then the new lines, their options and discounts carry p_at.
CREATE FUNCTION pg_temp.demo_settle(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.demo_discounts(p_order, p_at);
  PERFORM public.consume_order_stock(p_order);
  UPDATE public.order_items
     SET created_at = added_at, updated_at = added_at,
         stock_consumed_at = CASE WHEN stock_consumed_at IS NOT NULL THEN added_at END
   WHERE order_id = p_order AND created_at = now();
  UPDATE public.order_item_modifiers m SET created_at = oi.added_at
    FROM public.order_items oi WHERE oi.id = m.order_item_id AND oi.order_id = p_order AND m.created_at = now();
  UPDATE public.inventory_movements mv SET created_at = oi.added_at
    FROM public.order_items oi
   WHERE mv.reference_type = 'order_item' AND mv.reference_id = oi.id AND oi.order_id = p_order AND mv.created_at = now();
  UPDATE public.order_discounts SET created_at = p_at WHERE order_id = p_order AND created_at = now();
END;
$$;

-- Adds demo_cart to an order as OrdersService.create / addItems do: catalog
-- name, list price plus options, the promotion each line qualifies for at
-- p_at (combo lines carry their combo) with its snapshot, the option
-- snapshot (private.add_order_item_modifiers), items in kitchen.
CREATE FUNCTION pg_temp.demo_add_cart(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_channel text := (SELECT order_type FROM public.orders WHERE id = p_order);
  r record;
  v_id uuid;
  v_tag record;
BEGIN
  FOR r IN
    SELECT c.dish_id, c.option_ids, c.combo_id, c.promotion_id, sum(c.quantity)::integer AS quantity,
           max(c.comments) AS comments, d.name, d.allow_comments, d.restaurant_id,
           d.price + coalesce((SELECT sum(o.price) FROM public.modifier_options o WHERE o.id = ANY (c.option_ids)), 0) AS price
      FROM demo_cart c JOIN public.dishes d ON d.id = c.dish_id
     GROUP BY c.dish_id, c.option_ids, c.combo_id, c.promotion_id, d.name, d.allow_comments, d.restaurant_id, d.price
     ORDER BY c.combo_id NULLS FIRST, min(c.ord)
  LOOP
    v_id := gen_random_uuid();
    IF r.combo_id IS NULL THEN
      SELECT * INTO v_tag FROM pg_temp.demo_tag(r.dish_id, r.price, p_at, v_channel);
    ELSE
      SELECT r.promotion_id AS promotion_id, (SELECT x.rule FROM demo_rules x WHERE x.id = r.promotion_id) AS snapshot INTO v_tag;
    END IF;
    INSERT INTO public.order_items (id, order_id, dish_id, name, price, quantity, comments, status, added_at, restaurant_id,
                                    promotion_id, promotion_snapshot, combo_id)
    VALUES (v_id, p_order, r.dish_id, r.name, r.price, r.quantity, CASE WHEN r.allow_comments THEN r.comments END, 'kitchen',
            p_at + nextval('demo_line_seq') * interval '1 microsecond', r.restaurant_id,
            v_tag.promotion_id, v_tag.snapshot, r.combo_id);
    IF cardinality(r.option_ids) > 0 THEN
      PERFORM private.add_order_item_modifiers(v_id, r.option_ids);
    END IF;
  END LOOP;
  PERFORM pg_temp.demo_settle(p_order, p_at);
END;
$$;

-- A dine-in tab opened by a bartender or waiter with its first round (OrdersService.create).
CREATE FUNCTION pg_temp.demo_open_order(p_waiter uuid, p_table uuid, p_slot text, p_party integer, p_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid;
BEGIN
  PERFORM pg_temp.demo_as(p_waiter);
  PERFORM pg_temp.demo_fill_cart(p_slot, p_party, 1, p_at);
  INSERT INTO public.orders (table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total,
                             restaurant_id)
  VALUES (p_table, p_waiter, 'kitchen', 'dine_in', 0, 0, 8, 0, 10, 0, current_setting('vipe.restaurant_id')::uuid)
  RETURNING id INTO v_order;
  PERFORM pg_temp.demo_add_cart(v_order, p_at);
  UPDATE public.tables SET status = 'kitchen', waiter_id = coalesce(waiter_id, p_waiter), updated_at = now()
   WHERE id = p_table;
  RETURN v_order;
END;
$$;

-- Another round on an open tab (OrdersService.addItems).
CREATE FUNCTION pg_temp.demo_round(p_waiter uuid, p_order uuid, p_slot text, p_party integer, p_round integer, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.demo_as(p_waiter);
  PERFORM pg_temp.demo_fill_cart(p_slot, p_party, p_round, p_at);
  PERFORM pg_temp.demo_add_cart(p_order, p_at);
  UPDATE public.orders SET status = 'kitchen' WHERE id = p_order;
END;
$$;

-- A takeaway order at the counter (POST /orders, orderType takeaway, 0033).
CREATE FUNCTION pg_temp.demo_takeaway(p_cashier uuid, p_name text, p_phone text, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid;
BEGIN
  PERFORM pg_temp.demo_as(p_cashier);
  PERFORM pg_temp.demo_fill_to_go();
  INSERT INTO public.orders (table_id, waiter_id, status, order_type, customer_name, customer_phone, subtotal, tax,
                             tax_percentage, tip, tip_percentage, total, restaurant_id)
  VALUES (NULL, p_cashier, 'kitchen', 'takeaway', p_name, p_phone, 0, 0, 8, 0, 0, 0, current_setting('vipe.restaurant_id')::uuid)
  RETURNING id INTO v_order;
  PERFORM pg_temp.demo_add_cart(v_order, p_at);
  RETURN v_order;
END;
$$;

-- Every item served: the order is delivered and its table served (serveItems).
CREATE FUNCTION pg_temp.demo_serve(p_order uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.order_items SET status = 'served' WHERE order_id = p_order AND status = 'kitchen';
  UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = p_order;
  UPDATE public.tables t SET status = 'served', updated_at = now()
    FROM public.orders o WHERE o.id = p_order AND t.id = o.table_id;
END;
$$;

-- Tenders for a bill: mostly one method, sometimes cash plus Nequi.
CREATE FUNCTION pg_temp.demo_tenders(p_total bigint) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_r numeric := random();
  v_cash bigint;
  v_half bigint;
  v_method text;
BEGIN
  IF v_r < 0.08 AND p_total > 60000 THEN
    v_half := (p_total / 2 / 1000) * 1000;
    v_cash := ceil(v_half / 10000.0) * 10000;
    RETURN jsonb_build_array(
      jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
                         'amount', v_half, 'cash_received', v_cash),
      jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'nequi'),
                         'amount', p_total - v_half));
  END IF;
  v_method := CASE WHEN v_r < 0.30 THEN 'cash' WHEN v_r < 0.62 THEN 'bancolombia'
                   WHEN v_r < 0.88 THEN 'nequi' ELSE 'transfer' END;
  IF v_method = 'cash' THEN
    v_cash := CASE WHEN random() < 0.2 THEN p_total
                   WHEN random() < 0.5 THEN ceil(p_total / 10000.0) * 10000
                   ELSE ceil(p_total / 50000.0) * 50000 END;
    RETURN jsonb_build_array(jsonb_build_object(
      'payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
      'amount', p_total, 'cash_received', v_cash));
  END IF;
  RETURN jsonb_build_array(jsonb_build_object(
    'payment_method_id', (SELECT id FROM demo_methods WHERE code = v_method), 'amount', p_total));
END;
$$;

-- pay_order as p_cashier, with the bill pay_order itself computes (net
-- subtotal + tax + delivery fee) and, for most tabs, the suggested 10% tip.
CREATE FUNCTION pg_temp.demo_pay(p_cashier uuid, p_order uuid, p_register uuid, p_tenders jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_o public.orders%ROWTYPE;
  v_due bigint;
  v_tip bigint := 0;
BEGIN
  SELECT * INTO v_o FROM public.orders WHERE id = p_order;
  v_due := v_o.subtotal::bigint + round(v_o.subtotal * v_o.tax_percentage / 100)::bigint
         + coalesce((SELECT od.delivery_fee FROM public.order_deliveries od WHERE od.order_id = p_order), 0);
  IF v_o.order_type = 'dine_in' AND random() < 0.78 THEN
    v_tip := round(v_o.subtotal * 0.10)::bigint;
  END IF;
  PERFORM pg_temp.demo_as(p_cashier);
  PERFORM public.pay_order(p_order, p_register, v_tip, coalesce(p_tenders, pg_temp.demo_tenders(v_due + v_tip)),
                           gen_random_uuid());
END;
$$;

-- Moves an order to its real times: opened at p_at, closed at p_closed
-- (its lines already carry the time of their round).
CREATE FUNCTION pg_temp.demo_backdate(p_order uuid, p_at timestamptz, p_closed timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.orders SET created_at = p_at, updated_at = p_closed WHERE id = p_order;
  UPDATE public.order_items
     SET updated_at = CASE WHEN status = 'served' THEN greatest(added_at, least(p_closed, added_at + interval '12 minutes'))
                           ELSE added_at END
   WHERE order_id = p_order;
  UPDATE public.payments SET created_at = p_closed WHERE order_id = p_order;
END;
$$;

-- A delivery taken by the operator (create_delivery_order, lines tagged and
-- discounted as tagUntagged and recompute do), prepared by the kitchen,
-- dispatched, delivered and collected by the operator (set_delivery_status,
-- pay_order; a cancellation through cancel_order). p_stage stops it early:
-- received | preparing | ready | out_for_delivery | delivered | cancelled | retried.
CREATE FUNCTION pg_temp.demo_delivery(p_stage text, p_at timestamptz, p_register uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_c demo_customers%ROWTYPE;
  v_items jsonb;
  v_result jsonb;
  v_order uuid;
  v_courier uuid := (SELECT id FROM demo_couriers ORDER BY random() LIMIT 1);
  v_prepaid boolean := random() < 0.45;
  v_fee bigint := (SELECT CASE WHEN random() < 0.7 THEN 6000 ELSE 8000 END);
  v_estimate bigint;
  v_change bigint;
  v_due bigint;
  v_method text := CASE WHEN random() < 0.6 THEN 'nequi' ELSE 'transfer' END;
BEGIN
  SELECT * INTO v_c FROM demo_customers ORDER BY -ln(1 - random()) / weight LIMIT 1;
  PERFORM pg_temp.demo_fill_to_go();
  SELECT jsonb_agg(jsonb_build_object('dish_id', dish_id, 'quantity', quantity, 'option_ids', to_jsonb(option_ids))) INTO v_items
    FROM (SELECT dish_id, option_ids, sum(quantity)::integer AS quantity FROM demo_cart GROUP BY dish_id, option_ids) c;
  SELECT sum(d.price * c.quantity)::bigint INTO v_estimate FROM demo_cart c JOIN public.dishes d ON d.id = c.dish_id;
  v_change := CASE WHEN v_prepaid OR random() < 0.3 THEN NULL
                   ELSE ceil((v_estimate * 1.08 + v_fee) / 50000.0) * 50000 END;

  PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
  v_result := public.create_delivery_order(
    CASE WHEN v_c.customer_id IS NULL THEN jsonb_build_object('phone', v_c.phone, 'name', v_c.name)
         ELSE jsonb_build_object('id', v_c.customer_id) END,
    CASE WHEN v_c.address_id IS NULL
         THEN jsonb_build_object('address_line', v_c.address_line, 'neighborhood', v_c.neighborhood,
                                 'reference', v_c.reference, 'label', 'Casa', 'save', true)
         ELSE jsonb_build_object('id', v_c.address_id) END,
    v_items, v_fee, CASE WHEN v_prepaid THEN 'prepaid' ELSE 'cash_on_delivery' END, v_change,
    CASE WHEN random() < 0.25 THEN (ARRAY['Traer hielo extra, por favor', 'Portería: dejar con el vigilante',
                                          'Llamar antes de llegar', 'Sin cubiertos, gracias'])[1 + floor(random() * 4)::int] END,
    CASE WHEN v_prepaid THEN (SELECT id FROM demo_methods WHERE code = v_method) END);
  v_order := (v_result ->> 'order_id')::uuid;
  UPDATE demo_customers SET customer_id = (v_result ->> 'customer_id')::uuid,
                            address_id = coalesce(address_id, (v_result ->> 'address_id')::uuid)
   WHERE phone = v_c.phone;
  -- OrderDiscountsService.tagUntagged, then recompute, on the delivery channel.
  UPDATE public.order_items oi SET promotion_id = t.promotion_id, promotion_snapshot = t.snapshot,
                                   added_at = p_at + nextval('demo_line_seq') * interval '1 microsecond'
    FROM public.order_items x LEFT JOIN LATERAL pg_temp.demo_tag(x.dish_id, x.price, p_at, 'delivery') t ON true
   WHERE x.id = oi.id AND oi.order_id = v_order;
  PERFORM pg_temp.demo_settle(v_order, p_at);

  SELECT o.subtotal::bigint + o.tax::bigint + v_fee INTO v_due FROM public.orders o WHERE o.id = v_order;
  IF v_prepaid AND p_stage <> 'cancelled' THEN
    PERFORM pg_temp.demo_pay(pg_temp.demo_profile('delivery_operator'), v_order, p_register,
      jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = v_method),
                                           'amount', v_due)));
  END IF;

  IF p_stage = 'cancelled' THEN
    PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
    -- The audited cancellation (0019): a reason, no supervisor for an unpaid delivery.
    PERFORM public.cancel_order(v_order, 'other', 'El cliente canceló por teléfono');
    RETURN v_order;
  END IF;
  IF p_stage = 'received' THEN RETURN v_order; END IF;
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('kitchen'));
  PERFORM public.set_delivery_status(v_order, 'start_preparing');
  IF p_stage = 'preparing' THEN RETURN v_order; END IF;
  PERFORM public.set_delivery_status(v_order, 'mark_ready');
  IF p_stage = 'ready' THEN RETURN v_order; END IF;
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('delivery_operator'));
  PERFORM public.set_delivery_status(v_order, 'dispatch', v_courier);
  IF p_stage = 'out_for_delivery' THEN RETURN v_order; END IF;
  IF p_stage = 'retried' THEN
    PERFORM public.set_delivery_status(v_order, 'fail', NULL, 'No contestan en la dirección');
    PERFORM public.set_delivery_status(v_order, 'dispatch', v_courier);
  END IF;
  PERFORM public.set_delivery_status(v_order, 'deliver');
  IF NOT v_prepaid THEN
    PERFORM pg_temp.demo_pay(pg_temp.demo_profile('delivery_operator'), v_order, p_register,
      jsonb_build_array(jsonb_build_object('payment_method_id', (SELECT id FROM demo_methods WHERE code = 'cash'),
                                           'amount', v_due, 'cash_received', greatest(v_due, coalesce(v_change, v_due)))));
  END IF;
  RETURN v_order;
END;
$$;

-- order_deliveries stamps updated_at = now() on every UPDATE (set_updated_at),
-- and GET /delivery/active lists the rows updated since local midnight. So the
-- row is rewritten with its real times: copied, deleted and inserted again
-- (an INSERT keeps the given updated_at; the superuser passes the
-- immutability guard and the deferred consistency trigger still checks it).
CREATE FUNCTION pg_temp.demo_backdate_delivery(p_order uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Live deliveries keep every step in the past.
  PERFORM pg_temp.demo_backdate(p_order, p_at, least(now(), p_at + interval '50 minutes'));
  INSERT INTO demo_od SELECT * FROM public.order_deliveries WHERE order_id = p_order;
  UPDATE demo_od
     SET created_at = p_at,
         updated_at = least(now(), p_at + interval '50 minutes'),
         dispatched_at = CASE WHEN dispatched_at IS NOT NULL THEN least(now(), p_at + interval '25 minutes') END,
         delivered_at = CASE WHEN delivered_at IS NOT NULL THEN p_at + interval '50 minutes' END,
         failed_at = CASE WHEN failed_at IS NOT NULL THEN p_at + interval '40 minutes' END,
         cancelled_at = CASE WHEN cancelled_at IS NOT NULL THEN p_at + interval '6 minutes' END;
  UPDATE demo_od SET updated_at = cancelled_at WHERE cancelled_at IS NOT NULL;
  -- Its audited cancellation happened at the same moment (vipe_migrator passes the append-only guard).
  UPDATE public.order_cancellations c SET cancelled_at = od.cancelled_at FROM demo_od od WHERE c.order_id = od.order_id;
  UPDATE public.audit_log a SET created_at = od.cancelled_at FROM demo_od od WHERE a.order_id = od.order_id AND od.cancelled_at IS NOT NULL;
  DELETE FROM public.order_deliveries WHERE order_id = p_order;
  INSERT INTO public.order_deliveries SELECT * FROM demo_od;
  TRUNCATE demo_od;
  UPDATE public.payments p SET created_at = CASE WHEN od.payment_mode = 'prepaid' THEN p_at + interval '2 minutes'
                                                 ELSE p_at + interval '50 minutes' END
    FROM public.order_deliveries od
   WHERE p.order_id = p_order AND od.order_id = p_order;
END;
$$;

-- The Informe Z snapshot of a closed business day, as CashService.emitZ
-- freezes it: the day summary (GET /cash/days/:date without z) plus taxes,
-- order range, discounts and tips by method. Run as the admin.
CREATE FUNCTION pg_temp.demo_z(p_day date) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_cut constant interval := interval '5 hours';
  v_lo timestamptz := (p_day::timestamp + v_cut) AT TIME ZONE 'America/Bogota';
  v_hi timestamptz := ((p_day + 1)::timestamp + v_cut) AT TIME ZONE 'America/Bogota';
  v_prev_lo timestamptz := ((p_day - 7)::timestamp + v_cut) AT TIME ZONE 'America/Bogota';
  v_regs jsonb;
  v_catalog jsonb;
  v_extra record;
  v_orders record;
  v_voids jsonb;
  v_tips jsonb;
  v_waiters jsonb;
  v_prev numeric;
  v_ids uuid[];
BEGIN
  SELECT array_agg(id ORDER BY opening_timestamp, id) INTO v_ids FROM public.cash_registers
   WHERE opening_timestamp >= v_lo AND opening_timestamp < v_hi;
  SELECT jsonb_agg(jsonb_build_object(
           'id', r.id, 'status', r.status, 'openedAt', pg_temp.demo_iso(r.opening_timestamp),
           'closedAt', pg_temp.demo_iso(r.closing_timestamp),
           'openedBy', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name) FROM public.profiles p WHERE p.id = r.opened_by),
           'closedBy', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name) FROM public.profiles p WHERE p.id = r.closed_by),
           'validatedBy', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name) FROM public.profiles p WHERE p.id = r.validated_by),
           'validatedAt', pg_temp.demo_iso(r.validated_at),
           'initialCash', (s ->> 'initial_cash')::numeric, 'salesNet', (s ->> 'total_billed')::numeric,
           'tickets', (s ->> 'payments_count')::numeric, 'tips', (s ->> 'total_tips')::numeric,
           'methods', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m ->> 'payment_method_id', 'code', m ->> 'code',
                                  'name', m ->> 'name', 'kind', m ->> 'kind', 'total', (m ->> 'total')::numeric,
                                  'count', (m ->> 'tenders_count')::numeric)) FROM jsonb_array_elements(s -> 'methods') m), '[]'::jsonb),
           'deposits', (s ->> 'cash_deposits')::numeric, 'withdrawals', (s ->> 'cash_withdrawals')::numeric,
           'tipsPayout', (s ->> 'tips_payout')::numeric, 'expected', (s ->> 'expected_cash_after_tips')::numeric,
           'countedCash', r.counted_cash::bigint, 'cashDifference', r.cash_difference::bigint, 'closeNote', r.close_note)
         ORDER BY r.opening_timestamp, r.id)
    INTO v_regs
    FROM public.cash_registers r CROSS JOIN LATERAL (SELECT public.register_summary(ARRAY[r.id]) AS s) x
   WHERE r.id = ANY (v_ids);

  SELECT jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name, 'kind', m.kind,
           'total', coalesce((SELECT sum((e ->> 'total')::numeric) FROM jsonb_array_elements(v_regs) g, jsonb_array_elements(g -> 'methods') e
                               WHERE e ->> 'id' = m.id::text), 0),
           'count', coalesce((SELECT sum((e ->> 'count')::numeric) FROM jsonb_array_elements(v_regs) g, jsonb_array_elements(g -> 'methods') e
                               WHERE e ->> 'id' = m.id::text), 0)) ORDER BY m.sort_order, m.name)
    INTO v_catalog FROM public.payment_methods m;

  SELECT count(DISTINCT o.table_id) FILTER (WHERE o.order_type = 'dine_in') AS tables,
         count(*) FILTER (WHERE o.order_type = 'delivery') AS deliveries,
         coalesce(sum(p.amount_due) FILTER (WHERE o.order_type = 'delivery'), 0) AS delivery_amount,
         count(*) FILTER (WHERE o.order_type = 'takeaway') AS takeaways,
         coalesce(sum(p.amount_due) FILTER (WHERE o.order_type = 'takeaway'), 0) AS takeaway_amount
    INTO v_extra
    FROM public.payments p JOIN public.orders o ON o.id = p.order_id
   WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL;
  SELECT min(o.order_number) AS first, max(o.order_number) AS last, coalesce(sum(o.total_discounts), 0) AS discounts,
         coalesce(sum(o.subtotal), 0) AS base, coalesce(sum(o.tax), 0) AS tax
    INTO v_orders
    FROM public.payments p JOIN public.orders o ON o.id = p.order_id
   WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object('at', pg_temp.demo_iso(oc.cancelled_at), 'kind', 'order_cancellation',
           'orderNumber', o.order_number,
           'table', CASE WHEN o.order_type = 'delivery' THEN 'Domicilio'
                         WHEN o.order_type = 'takeaway' THEN 'Para llevar' || coalesce(' · ' || nullif(btrim(o.customer_name), ''), '')
                         ELSE (SELECT t.number::text FROM public.tables t WHERE t.id = o.table_id) END,
           'amount', oc.total::numeric, 'reason', oc.reason_code, 'reasonText', oc.reason_text,
           'requestedBy', oc.cancelled_by_name, 'authorizedBy', oc.authorized_by_name) ORDER BY oc.cancelled_at, oc.id), '[]'::jsonb)
    INTO v_voids
    FROM public.order_cancellations oc JOIN public.orders o ON o.id = oc.order_id
   WHERE oc.cancelled_at >= v_lo AND oc.cancelled_at < v_hi;

  -- tipsByMethod: a payment's tip split by tender amount, the last tender takes the rounding.
  WITH t AS (
    SELECT p.id, p.tip_amount AS tip, pt.payment_method_id AS method, pt.amount, pt.line_no,
           sum(pt.amount) OVER (PARTITION BY p.id) AS total,
           row_number() OVER (PARTITION BY p.id ORDER BY pt.line_no DESC) AS from_end
      FROM public.payments p JOIN public.payment_tenders pt ON pt.payment_id = p.id
     WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL AND p.tip_amount > 0),
  s AS (
    SELECT t.*, CASE WHEN t.total > 0 THEN floor(t.tip * t.amount / t.total) ELSE 0 END AS share FROM t),
  f AS (
    SELECT s.method, CASE WHEN s.from_end = 1
                          THEN s.tip - coalesce((SELECT sum(s2.share) FROM s s2 WHERE s2.id = s.id AND s2.from_end > 1), 0)
                          ELSE s.share END AS amount FROM s)
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'kind', m.kind, 'amount', x.amount)
                            ORDER BY m.sort_order, m.name), '[]'::jsonb)
    INTO v_tips
    FROM (SELECT method, sum(amount) AS amount FROM f GROUP BY method) x JOIN public.payment_methods m ON m.id = x.method
   WHERE x.amount > 0;

  SELECT coalesce(jsonb_agg(jsonb_build_object('waiterId', w.waiter_id, 'name', w.name, 'amount', w.amount)
                            ORDER BY w.amount DESC, w.name NULLS LAST), '[]'::jsonb)
    INTO v_waiters
    FROM (SELECT o.waiter_id, pr.full_name AS name, sum(p.tip_amount) AS amount
            FROM public.payments p JOIN public.orders o ON o.id = p.order_id
            LEFT JOIN public.profiles pr ON pr.id = o.waiter_id
           WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL AND p.tip_amount > 0
           GROUP BY o.waiter_id, pr.full_name) w;

  SELECT coalesce(sum(p.amount_due), 0) INTO v_prev
    FROM public.payments p JOIN public.cash_registers r ON r.id = p.cash_register_id
   WHERE r.opening_timestamp >= v_prev_lo AND r.opening_timestamp < v_prev_lo + interval '1 day' AND p.voided_at IS NULL;

  RETURN jsonb_build_object(
    'date', to_char(p_day, 'YYYY-MM-DD'), 'status', 'closed', 'registers', v_regs,
    'totals', jsonb_build_object(
      'salesNet', (SELECT sum((g ->> 'salesNet')::numeric) FROM jsonb_array_elements(v_regs) g),
      'tickets', (SELECT sum((g ->> 'tickets')::numeric) FROM jsonb_array_elements(v_regs) g),
      'avgTicket', (SELECT CASE WHEN sum((g ->> 'tickets')::numeric) > 0
                                THEN round(sum((g ->> 'salesNet')::numeric) / sum((g ->> 'tickets')::numeric)) ELSE 0 END
                      FROM jsonb_array_elements(v_regs) g),
      'tables', v_extra.tables,
      'deliveries', jsonb_build_object('count', v_extra.deliveries, 'amount', v_extra.delivery_amount),
      'takeaway', jsonb_build_object('count', v_extra.takeaways, 'amount', v_extra.takeaway_amount),
      'tips', (SELECT sum((g ->> 'tips')::numeric) FROM jsonb_array_elements(v_regs) g),
      'methods', v_catalog,
      'deposits', (SELECT sum((g ->> 'deposits')::numeric) FROM jsonb_array_elements(v_regs) g),
      'withdrawals', (SELECT sum((g ->> 'withdrawals')::numeric) FROM jsonb_array_elements(v_regs) g),
      'expected', (SELECT sum((g ->> 'expected')::numeric) FROM jsonb_array_elements(v_regs) g),
      'counted', (SELECT sum(coalesce((g ->> 'countedCash')::numeric, 0)) FROM jsonb_array_elements(v_regs) g),
      'difference', (SELECT sum(coalesce((g ->> 'cashDifference')::numeric, 0)) FROM jsonb_array_elements(v_regs) g)),
    'tipsByWaiter', v_waiters,
    'voids', jsonb_build_object('count', jsonb_array_length(v_voids),
                                'amount', (SELECT coalesce(sum((v ->> 'amount')::numeric), 0) FROM jsonb_array_elements(v_voids) v),
                                'items', v_voids),
    'previous', jsonb_build_object('date', to_char(p_day - 7, 'YYYY-MM-DD'), 'salesNet', v_prev),
    'taxes', jsonb_build_object('type', 'INC', 'name', 'Impuesto nacional al consumo', 'label', 'INC (8 %)', 'rate', 8,
                                'base', round(v_orders.base), 'tax', round(v_orders.tax)),
    'orders', jsonb_build_object('first', v_orders.first, 'last', v_orders.last),
    'discounts', round(v_orders.discounts),
    'tipsByMethod', v_tips);
END;
$$;

-- ---------------------------------------------------------------------------
-- Bar settings, staff, stations and menu
-- ---------------------------------------------------------------------------

DO $setup$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_hash text := current_setting('vipe.demo_hash');
  v_admin uuid;
  v_cat uuid;
  v_dish uuid;
  r record;
  c record;
BEGIN
  PERFORM setseed(0.2026);

  SELECT p.id INTO v_admin FROM public.profiles p WHERE p.restaurant_id = v_rid AND p.role = 'admin';
  INSERT INTO demo_staff VALUES ('admin', v_admin, 1);

  -- The marker --reset uses to find demo restaurants, then the settings
  -- (impuesto al consumo INC 8 %, suggested tip 10 %, the business day ends at 05:00).
  INSERT INTO public.business_config (restaurant_id, key, value) VALUES
    (v_rid, 'demo_seed', 'true'),
    (v_rid, 'tax_percentage', '8'),
    (v_rid, 'tax_type', 'INC'),
    (v_rid, 'tip_percentage', '10'),
    (v_rid, 'business_address', 'Calle 59 # 9-34, Chapinero, Bogotá'),
    (v_rid, 'business_phone', '601 555 0187'),
    (v_rid, 'business_nit', '900000000-8'),
    (v_rid, 'delivery_default_fee', '6000'),
    (v_rid, 'business_day_cutoff_hour', '5');

  -- Staff through the same helper POST /staff uses, as the admin. Bartenders
  -- and floor staff have the waiter role; the bar kitchen has the kitchen role.
  PERFORM pg_temp.demo_as(v_admin);
  FOR r IN SELECT * FROM (VALUES
      ('waiter', 1, 'Santiago Rueda Pinzón', 'bartender.santiago@demo.vipe.pos'),
      ('waiter', 2, 'Laura Quintana Mejía', 'mesera.laura@demo.vipe.pos'),
      ('waiter', 3, 'Andrés Beltrán Ortiz', 'mesero.andres@demo.vipe.pos'),
      ('waiter', 4, 'Mariana Cortés Lozano', 'bartender.mariana@demo.vipe.pos'),
      ('kitchen', 1, 'Fabián Salcedo', 'cocina@demo.vipe.pos'),
      ('kitchen', 2, 'Diana Mora Cubillos', 'cocina.diana@demo.vipe.pos'),
      ('cashier', 1, 'Paola Gutiérrez', 'caja@demo.vipe.pos'),
      ('cashier', 2, 'Julián Castro Peña', 'caja.julian@demo.vipe.pos'),
      ('delivery_operator', 1, 'Felipe Ardila', 'domicilios@demo.vipe.pos')
    ) AS s(role, seq, full_name, email)
  LOOP
    INSERT INTO demo_staff VALUES (r.role,
      private.create_staff_user(r.email::public.citext, v_hash, 'argon2id', r.full_name,
                                split_part(r.email, '@', 1), r.role, true),
      r.seq);
  END LOOP;

  -- Two prep stations: drinks go to the Barra, food to the Cocina (0020).
  INSERT INTO public.stations (restaurant_id, name, kind, color, sort_order, is_default)
  VALUES (v_rid, 'Barra', 'prep', 'occupied', 0, true), (v_rid, 'Cocina', 'prep', 'kitchen', 1, false);

  -- Menu: 9 categories, whole-peso COP prices of a Bogotá cocktail bar.
  FOR c IN SELECT * FROM (VALUES
      (1, 'Cocteles de autor', 'Recetas de la casa con frutas colombianas', 'martini', 'violet', 'Barra'),
      (2, 'Cocteles clásicos', 'Los de siempre, bien hechos', 'cocktail', 'rose', 'Barra'),
      (3, 'Cervezas', 'Nacionales, artesanales e importadas, siempre frías', 'beer', 'yellow', 'Barra'),
      (4, 'Cubetas', 'Cerveza en balde con hielo para la mesa', 'beer', 'orange', 'Barra'),
      (5, 'Micheladas', 'Escarchadas con sal y limón, a tu gusto', 'cupsoda', 'orange', 'Barra'),
      (6, 'Shots', 'Para brindar', 'glasswater', 'rose', 'Barra'),
      (7, 'Botellas y medias', 'Servidas con hielo y mezcladores', 'wine', 'violet', 'Barra'),
      (8, 'Picadas y comida de bar', 'Para compartir mientras llega la otra ronda', 'drumstick', 'emerald', 'Cocina'),
      (9, 'Sin alcohol', 'Gaseosas, aguas, limonadas y mocktails', 'cupsoda', 'sky', 'Barra')
    ) AS t(ord, name, description, icon, color, station)
    ORDER BY ord
  LOOP
    INSERT INTO public.categories (name, description, icon, active, sort_order, color, restaurant_id, station_id)
    VALUES (c.name, c.description, c.icon, true, c.ord - 1, c.color, v_rid,
            (SELECT s.id FROM public.stations s WHERE s.restaurant_id = v_rid AND s.name = c.station))
    RETURNING id INTO v_cat;
    FOR r IN SELECT * FROM (VALUES
        ('Cocteles de autor', 'autor', 'Bruma de maracuyá', 'Ginebra, jarabe de maracuyá de la casa, limón y soda', 36000, true, 6),
        ('Cocteles de autor', 'autor', 'Niebla de Monserrate', 'Aguardiente, limón, hierbabuena y jarabe simple', 32000, true, 4),
        ('Cocteles de autor', 'autor', 'Chapinero sour', 'Bourbon, sour mix del día y amargo de angostura', 38000, true, 3),
        ('Cocteles de autor', 'autor', 'Lulo picante', 'Ron blanco, lulo, jarabe simple y un toque de ají', 34000, true, 3),
        ('Cocteles de autor', 'autor', 'Café de la Séptima', 'Ron añejo, licor de café y espresso', 36000, true, 2),
        ('Cocteles de autor', 'autor', 'Mango biche spritz', 'Vodka, mango biche, prosecco y soda', 35000, true, 3),
        ('Cocteles clásicos', 'clasico', 'Margarita', 'Tequila, triple sec y limón, borde de sal', 32000, true, 5),
        ('Cocteles clásicos', 'clasico', 'Mojito', 'Ron a elección, hierbabuena, limón y soda', 30000, true, 6),
        ('Cocteles clásicos', 'clasico', 'Negroni', 'Ginebra, Campari y vermut rojo', 34000, true, 3),
        ('Cocteles clásicos', 'clasico', 'Old Fashioned', 'Bourbon, azúcar, angostura y naranja', 36000, true, 3),
        ('Cocteles clásicos', 'clasico', 'Piña colada', 'Ron a elección, crema de coco y piña', 30000, true, 3),
        ('Cocteles clásicos', 'clasico', 'Daiquiri', 'Ron a elección, limón y jarabe simple', 29000, true, 2),
        ('Cocteles clásicos', 'clasico', 'Aperol spritz', 'Aperol, prosecco y soda', 32000, true, 4),
        ('Cocteles clásicos', 'clasico', 'Moscow mule', 'Vodka, ginger ale y limón', 31000, true, 3),
        ('Cocteles clásicos', 'clasico', 'Gin tonic', 'Ginebra, agua tónica y limón', 33000, true, 5),
        ('Cervezas', 'cerveza', 'Club Colombia Dorada', 'Botella de 330 ml', 9000, false, 6),
        ('Cervezas', 'cerveza', 'Club Colombia Roja', 'Botella de 330 ml', 9000, false, 3),
        ('Cervezas', 'cerveza', 'Águila', 'Botella de 330 ml', 8000, false, 6),
        ('Cervezas', 'cerveza', 'Poker', 'Botella de 330 ml', 8000, false, 5),
        ('Cervezas', 'cerveza', 'Costeña', 'Botella de 330 ml', 8000, false, 2),
        ('Cervezas', 'cerveza', 'Cerro Frío Golden Ale', 'Artesanal de la Sabana, 330 ml', 16000, false, 2),
        ('Cervezas', 'cerveza', 'Cerro Frío Stout', 'Artesanal negra, notas de café, 330 ml', 17000, false, 1),
        ('Cervezas', 'cerveza', 'Quebrada IPA', 'Artesanal lupulada, 330 ml', 18000, false, 2),
        ('Cervezas', 'cerveza', 'La Sabana Red Ale', 'Artesanal roja, 330 ml', 16000, false, 1),
        ('Cervezas', 'cerveza', 'Corona', 'Botella de 355 ml con limón', 14000, false, 4),
        ('Cervezas', 'cerveza', 'Stella Artois', 'Botella de 330 ml', 15000, false, 2),
        ('Cervezas', 'cerveza', 'Heineken', 'Botella de 330 ml', 13000, false, 2),
        ('Cubetas', 'cubeta', 'Cubeta nacional x6', 'Seis nacionales a elección en hielo', 45000, false, 6),
        ('Cubetas', 'cubeta', 'Cubeta Club Colombia x6', 'Seis Club Colombia en hielo', 52000, false, 4),
        ('Cubetas', 'cubeta', 'Cubeta importada x5', 'Cinco importadas a elección en hielo', 65000, false, 2),
        ('Cubetas', 'cubeta', 'Cubeta mixta x6', 'Dos Águila, dos Club Colombia y dos Corona', 58000, false, 2),
        ('Micheladas', 'michelada', 'Michelada con Águila', 'Escarchada, con la base que elijas', 13000, true, 5),
        ('Micheladas', 'michelada', 'Michelada con Club Colombia', 'Escarchada, con la base que elijas', 15000, true, 3),
        ('Micheladas', 'michelada', 'Michelada con Corona', 'Escarchada, con la base que elijas', 19000, true, 2),
        ('Shots', 'shot', 'Shot de aguardiente Antioqueño', '30 ml', 7000, false, 6),
        ('Shots', 'shot', 'Shot de tequila José Cuervo', '30 ml con sal y limón', 12000, false, 4),
        ('Shots', 'shot', 'Shot de Jägermeister', '30 ml bien frío', 14000, false, 2),
        ('Shots', 'shot', 'Shot de ron Viejo de Caldas', '30 ml', 8000, false, 2),
        ('Botellas y medias', 'botella', 'Botella aguardiente Antioqueño', '750 ml, con hielo y mezcladores', 125000, false, 6),
        ('Botellas y medias', 'botella', 'Botella aguardiente Néctar', '750 ml, con hielo y mezcladores', 115000, false, 3),
        ('Botellas y medias', 'botella', 'Botella ron Viejo de Caldas', '750 ml, con hielo y mezcladores', 140000, false, 3),
        ('Botellas y medias', 'botella', 'Botella ron Medellín añejo', '750 ml, con hielo y mezcladores', 135000, false, 2),
        ('Botellas y medias', 'botella', 'Botella whisky Old Parr 12 años', '750 ml, con hielo y mezcladores', 320000, false, 2),
        ('Botellas y medias', 'botella', 'Botella whisky Buchanan''s 12 años', '750 ml, con hielo y mezcladores', 330000, false, 1),
        ('Botellas y medias', 'botella', 'Botella tequila José Cuervo Especial', '750 ml, con sal y limón', 210000, false, 1),
        ('Botellas y medias', 'botella', 'Media aguardiente Antioqueño', '375 ml, con hielo y mezcladores', 70000, false, 5),
        ('Botellas y medias', 'botella', 'Media aguardiente Néctar', '375 ml, con hielo y mezcladores', 65000, false, 2),
        ('Botellas y medias', 'botella', 'Media ron Viejo de Caldas', '375 ml, con hielo y mezcladores', 80000, false, 2),
        ('Picadas y comida de bar', 'comida', 'Alitas x10', 'Diez alitas con la salsa que elijas', 32000, true, 6),
        ('Picadas y comida de bar', 'comida', 'Nachos con queso y guacamole', 'Totopos, queso cheddar fundido y guacamole', 28000, true, 5),
        ('Picadas y comida de bar', 'comida', 'Patacones con hogao', 'Cuatro patacones con hogao de la casa', 18000, true, 4),
        ('Picadas y comida de bar', 'comida', 'Chicharrón con limón y arepa', 'Chicharrón carnudo, arepitas y limón', 26000, true, 4),
        ('Picadas y comida de bar', 'comida', 'Empanadas x6 con ají', 'Seis empanadas de carne', 18000, false, 5),
        ('Picadas y comida de bar', 'comida', 'Papas a la francesa', 'Con salsa de la casa', 14000, true, 3),
        ('Picadas y comida de bar', 'picada', 'Picada para 2', 'Chorizo, chicharrón, alitas, papa criolla, patacón y arepa', 48000, true, 3),
        ('Picadas y comida de bar', 'picada', 'Picada para 4', 'La picada grande para compartir', 85000, true, 2),
        ('Sin alcohol', 'sin', 'Coca-Cola 350 ml', 'Original o sin azúcar', 6000, false, 4),
        ('Sin alcohol', 'sin', 'Agua sin gas', 'Botella de 600 ml', 5000, false, 3),
        ('Sin alcohol', 'sin', 'Agua con gas', 'Botella de 600 ml', 5500, false, 2),
        ('Sin alcohol', 'sin', 'Ginger ale', 'Botella de 300 ml', 6000, false, 1),
        ('Sin alcohol', 'sin', 'Red Bull', 'Lata de 250 ml', 12000, false, 3),
        ('Sin alcohol', 'sin', 'Limonada natural', 'Limón recién exprimido', 9000, true, 4),
        ('Sin alcohol', 'sin', 'Limonada de coco', 'Limón y crema de coco', 13000, true, 3),
        ('Sin alcohol', 'sin', 'Limonada de hierbabuena', 'Limón y hierbabuena', 10000, true, 2),
        ('Sin alcohol', 'sin', 'Nojito', 'Mojito sin alcohol', 16000, true, 2),
        ('Sin alcohol', 'sin', 'Maracuyá tonic', 'Jarabe de maracuyá y agua tónica', 15000, true, 2)
      ) AS d(cat, grp, name, description, price, allow_comments, weight)
      WHERE d.cat = c.name
    LOOP
      INSERT INTO public.dishes (name, description, price, category_id, active, allow_comments, restaurant_id)
      VALUES (r.name, r.description, r.price, v_cat, true, r.allow_comments, v_rid) RETURNING id INTO v_dish;
      INSERT INTO demo_menu VALUES (v_dish, r.grp, r.weight);
    END LOOP;
  END LOOP;

  -- Subcategories (S5): every dish of a category with subcategories gets
  -- one; the other categories skip the step.
  INSERT INTO public.subcategories (category_id, name, sort_order, restaurant_id)
  SELECT mc.id, ms.name, ms.ord, v_rid
    FROM (VALUES
      ('Cervezas', 'Nacionales', 0), ('Cervezas', 'Artesanales', 1), ('Cervezas', 'Importadas', 2),
      ('Botellas y medias', 'Botellas', 0), ('Botellas y medias', 'Medias', 1),
      ('Sin alcohol', 'Gaseosas y aguas', 0), ('Sin alcohol', 'Limonadas', 1), ('Sin alcohol', 'Mocktails', 2)
    ) AS ms(cat, name, ord)
    JOIN public.categories mc ON mc.restaurant_id = v_rid AND mc.name = ms.cat;
  UPDATE public.dishes md SET subcategory_id = msc.id
    FROM public.categories mc, public.subcategories msc
   WHERE md.restaurant_id = v_rid AND mc.id = md.category_id AND msc.category_id = mc.id
     AND msc.name = CASE
       WHEN mc.name = 'Cervezas' THEN CASE WHEN md.price <= 9000 THEN 'Nacionales' WHEN md.price >= 16000 THEN 'Artesanales' ELSE 'Importadas' END
       WHEN mc.name = 'Botellas y medias' THEN CASE WHEN md.name LIKE 'Media %' THEN 'Medias' ELSE 'Botellas' END
       WHEN mc.name = 'Sin alcohol' THEN CASE WHEN md.name LIKE 'Limonada%' THEN 'Limonadas'
                                              WHEN md.name IN ('Nojito', 'Maracuyá tonic') THEN 'Mocktails' ELSE 'Gaseosas y aguas' END END;

  -- The floor of a bar (x, y = centre, normalized; w, h fractions of the zone
  -- width, as lib/floor/editor.ts). Barra: a row of stools 1-8 along the
  -- counter. Salón: high tables (periqueras) 10-15 and two lounges 16-17.
  -- Terraza: tables 20-23 for four, smokers allowed. Segundo piso: group and
  -- birthday tables 30-33. No two tables of a zone overlap.
  INSERT INTO public.zones (restaurant_id, name, aspect, sort_order, labels) VALUES
    (v_rid, 'Barra', 3.2, 0, '[{"text": "Barra de servicio", "side": "top"}, {"text": "Entrada", "side": "bottom"}, {"text": "Baños", "side": "right"}]'),
    (v_rid, 'Salón', 1.6, 1, '[{"text": "Ventanal", "side": "top"}, {"text": "Barra", "side": "left"}, {"text": "Cabina DJ", "side": "right"}]'),
    (v_rid, 'Terraza', 1.8, 2, '[{"text": "Vista a la calle", "side": "bottom"}, {"text": "Zona de fumadores", "side": "right"}]'),
    (v_rid, 'Segundo piso', 1.5, 3, '[{"text": "Escaleras", "side": "top"}, {"text": "Barra auxiliar", "side": "right"}, {"text": "Balcón", "side": "bottom"}]');
  INSERT INTO public.tables (number, status, restaurant_id, zone_id, x, y, w, h, shape, rotation, seats)
  SELECT l.n, 'available', v_rid, z.id, l.x, l.y, l.w, l.h, l.shape, 0, l.seats
    FROM (VALUES
      (1, 'Barra', 0.090, 0.40, 0.05, 0.05, 'round', 1), (2, 'Barra', 0.207, 0.40, 0.05, 0.05, 'round', 1),
      (3, 'Barra', 0.324, 0.40, 0.05, 0.05, 'round', 2), (4, 'Barra', 0.441, 0.40, 0.05, 0.05, 'round', 1),
      (5, 'Barra', 0.558, 0.40, 0.05, 0.05, 'round', 1), (6, 'Barra', 0.675, 0.40, 0.05, 0.05, 'round', 2),
      (7, 'Barra', 0.792, 0.40, 0.05, 0.05, 'round', 1), (8, 'Barra', 0.909, 0.40, 0.05, 0.05, 'round', 1),
      (10, 'Salón', 0.14, 0.18, 0.08, 0.08, 'round', 2), (11, 'Salón', 0.38, 0.18, 0.08, 0.08, 'round', 2),
      (12, 'Salón', 0.62, 0.18, 0.08, 0.08, 'round', 3), (13, 'Salón', 0.86, 0.18, 0.08, 0.08, 'round', 2),
      (14, 'Salón', 0.22, 0.48, 0.09, 0.09, 'square', 4), (15, 'Salón', 0.52, 0.48, 0.09, 0.09, 'square', 4),
      (16, 'Salón', 0.25, 0.82, 0.26, 0.10, 'rect', 6), (17, 'Salón', 0.72, 0.82, 0.26, 0.10, 'rect', 6),
      (20, 'Terraza', 0.22, 0.30, 0.12, 0.12, 'square', 4), (21, 'Terraza', 0.62, 0.30, 0.12, 0.12, 'square', 4),
      (22, 'Terraza', 0.22, 0.72, 0.12, 0.12, 'square', 4), (23, 'Terraza', 0.62, 0.72, 0.12, 0.12, 'square', 4),
      (30, 'Segundo piso', 0.27, 0.25, 0.32, 0.12, 'rect', 8), (31, 'Segundo piso', 0.73, 0.25, 0.32, 0.12, 'rect', 8),
      (32, 'Segundo piso', 0.27, 0.72, 0.26, 0.11, 'rect', 6), (33, 'Segundo piso', 0.73, 0.72, 0.26, 0.11, 'rect', 6)
    ) AS l(n, zone, x, y, w, h, shape, seats)
    JOIN public.zones z ON z.restaurant_id = v_rid AND z.name = l.zone;
  INSERT INTO demo_tables SELECT t.number, t.id, t.seats FROM public.tables t WHERE t.restaurant_id = v_rid;

  INSERT INTO demo_methods SELECT m.code, m.id FROM public.payment_methods m WHERE m.restaurant_id = v_rid;

  -- Couriers (no login) with clearly fictional numbers.
  INSERT INTO public.couriers (restaurant_id, name, phone) VALUES
    (v_rid, 'Jhon Fredy Rincón', '3000000101'),
    (v_rid, 'Brayan Castiblanco', '3000000102'),
    (v_rid, 'Wilmer Ávila', '3000000103');
  INSERT INTO demo_couriers SELECT id FROM public.couriers WHERE restaurant_id = v_rid;

  -- Delivery customers around Chapinero: created by the first create_delivery_order that uses them.
  INSERT INTO demo_customers (phone, name, address_line, neighborhood, reference, weight)
  SELECT '30000010' || lpad(n::text, 2, '0'), nm, addr, hood, ref, 1 + (n % 4)
    FROM (VALUES
      (1, 'Catalina Rojas', 'Carrera 5 # 58-21, apto 402', 'Chapinero Alto', 'Edificio de ladrillo, portería 24 horas'),
      (2, 'Sebastián Herrera', 'Calle 63 # 9-15', 'Chapinero Central', 'Casa esquinera, reja negra'),
      (3, 'Valentina Prieto', 'Carrera 4 # 69-40, torre 1 apto 803', 'Rosales', 'Unidad con portería'),
      (4, 'Nicolás Forero', 'Calle 70A # 11-28', 'Quinta Camacho', NULL),
      (6, 'Daniela Castañeda', 'Carrera 13 # 61-07, apto 301', 'Chapinero Central', 'Encima de la panadería'),
      (7, 'Juan Camilo Bernal', 'Calle 54 # 7-62', 'Chapinero Alto', 'Portería norte'),
      (8, 'María José Torres', 'Carrera 19 # 37-45, int. 2', 'Teusaquillo', 'Casa blanca'),
      (9, 'Felipe Sarmiento', 'Calle 45 # 21-30, apto 202', 'Galerías', NULL),
      (10, 'Alejandra Duarte', 'Carrera 7 # 45-10, oficina 504', 'Marly', 'Oficina, preguntar en recepción'),
      (11, 'Camilo Vargas', 'Calle 85 # 12-19, apto 701', 'El Lago', 'Edificio con jardín'),
      (12, 'Paula Acosta', 'Carrera 11 # 66-34', 'Chapinero Central', NULL),
      (13, 'Esteban Moreno', 'Calle 74 # 4-55, apto 1002', 'Rosales', 'Torre B'),
      (14, 'Andrea Galindo', 'Carrera 24 # 41-12', 'La Soledad', 'Frente al parkway'),
      (15, 'Mateo Cárdenas', 'Calle 57 # 3-30, apto 501', 'Chapinero Alto', NULL),
      (16, 'Juliana Osorio', 'Carrera 9 # 72-21', 'Quinta Camacho', 'Timbre del segundo piso'),
      (17, 'Diego Parra', 'Calle 51 # 14-47', 'Palermo', NULL),
      (18, 'Sara Villamil', 'Carrera 15 # 53-08, apto 302', 'Chapinero Central', 'Junto a la droguería'),
      (19, 'Tomás Barrera', 'Calle 60 # 2-40, casa 3', 'Chapinero Alto', 'Conjunto cerrado'),
      (20, 'Manuela Ruiz', 'Carrera 21 # 39-60', 'Teusaquillo', NULL),
      (21, 'Santiago Lozano', 'Calle 66 # 10-12, apto 604', 'Chapinero Central', 'Edificio azul')
    ) AS c(n, nm, addr, hood, ref);

  -- Promotions (0028), each created when it started. Applied by the history
  -- through demo_tag / demo_discounts: the happy hour 2x1 in cocktails, the
  -- 2x1 in national beers, the product discounts, the combo and the delivery
  -- bill discount. The birthday shot is manual with PIN, so it never applies
  -- by itself; Novenas starts next month.
  INSERT INTO public.promotions (name, description, kind, buy_quantity, pay_quantity, rest_discount_percent,
                                 start_date, end_date, days_of_week, time_windows, channels, active, restaurant_id, created_at)
  VALUES ('Happy hour 2x1 en cócteles', 'De lunes a viernes de 5 a 7 p. m.: lleva 2 cócteles y paga 1, sale gratis el más económico',
          'buy_x_pay_y', 2, 1, 100, now() - interval '60 days', NULL, '{1,2,3,4,5}', '[{"from": "17:00", "to": "19:00"}]',
          '{dine_in}', true, v_rid, now() - interval '60 days'),
         ('2x1 en cervezas nacionales', 'Martes y miércoles toda la noche en cervezas nacionales', 'buy_x_pay_y', 2, 1, 100,
          now() - interval '60 days', NULL, '{2,3}', '[]', '{dine_in}', true, v_rid, now() - interval '59 days');
  INSERT INTO public.promotion_categories (promotion_id, category_id, restaurant_id)
  SELECT p.id, mc.id, v_rid FROM public.promotions p JOIN public.categories mc ON mc.restaurant_id = v_rid
   WHERE p.restaurant_id = v_rid AND p.name = 'Happy hour 2x1 en cócteles' AND mc.name IN ('Cocteles de autor', 'Cocteles clásicos');
  INSERT INTO public.promotion_subcategories (promotion_id, subcategory_id, restaurant_id)
  SELECT p.id, s.id, v_rid FROM public.promotions p JOIN public.subcategories s ON s.restaurant_id = v_rid AND s.name = 'Nacionales'
   WHERE p.restaurant_id = v_rid AND p.name = '2x1 en cervezas nacionales';

  INSERT INTO public.promotions (name, description, discount_type, discount_value, start_date, end_date, days_of_week,
                                 active, restaurant_id, created_at)
  VALUES ('Jueves de micheladas', '3.000 pesos menos en cada michelada los jueves', 'fixed_amount', 3000,
          now() - interval '45 days', NULL, '{4}', true, v_rid, now() - interval '45 days'),
         ('Gin tonic de mitad de semana', '20 % en gin tonic los miércoles', 'percentage', 20,
          now() - interval '40 days', NULL, '{3}', true, v_rid, now() - interval '40 days'),
         ('Oktoberfest artesanal', '15 % en cervezas artesanales', 'percentage', 15,
          now() - interval '42 days', now() - interval '11 days', '{}', true, v_rid, now() - interval '42 days'),
         ('Novenas: 15 % en botellas', 'Del 16 al 24 de diciembre en botellas y medias', 'percentage', 15,
          now() + interval '34 days', now() + interval '43 days', '{}', true, v_rid, now() - interval '2 days');
  INSERT INTO public.promotion_categories (promotion_id, category_id, restaurant_id)
  SELECT p.id, mc.id, v_rid FROM public.promotions p JOIN public.categories mc ON mc.restaurant_id = v_rid
   WHERE p.restaurant_id = v_rid AND ((p.name = 'Jueves de micheladas' AND mc.name = 'Micheladas')
                                   OR (p.name = 'Novenas: 15 % en botellas' AND mc.name = 'Botellas y medias'));
  INSERT INTO public.promotion_dishes (promotion_id, dish_id, restaurant_id)
  SELECT p.id, d.id, v_rid FROM public.promotions p JOIN public.dishes d ON d.restaurant_id = v_rid AND d.name = 'Gin tonic'
   WHERE p.restaurant_id = v_rid AND p.name = 'Gin tonic de mitad de semana';
  INSERT INTO public.promotion_subcategories (promotion_id, subcategory_id, restaurant_id)
  SELECT p.id, s.id, v_rid FROM public.promotions p JOIN public.subcategories s ON s.restaurant_id = v_rid AND s.name = 'Artesanales'
   WHERE p.restaurant_id = v_rid AND p.name = 'Oktoberfest artesanal';

  INSERT INTO public.promotions (name, description, kind, combo_price, start_date, end_date, channels, active, restaurant_id, created_at)
  VALUES ('Cubeta + picada', 'Una cubeta y una picada para 2 o unas alitas por $69.000', 'combo', 69000,
          now() - interval '50 days', NULL, '{dine_in}', true, v_rid, now() - interval '50 days');
  INSERT INTO public.promotion_combo_groups (promotion_id, name, position, restaurant_id)
  SELECT p.id, g.name, g.pos, v_rid FROM public.promotions p, (VALUES ('Cubeta', 0), ('Picada', 1)) AS g(name, pos)
   WHERE p.restaurant_id = v_rid AND p.name = 'Cubeta + picada';
  INSERT INTO public.promotion_combo_options (group_id, dish_id, restaurant_id)
  SELECT g.id, d.id, v_rid
    FROM (VALUES ('Cubeta', 'Cubeta nacional x6'), ('Cubeta', 'Cubeta Club Colombia x6'),
                 ('Picada', 'Picada para 2'), ('Picada', 'Alitas x10')) AS o(grp, dish)
    JOIN public.promotions p ON p.restaurant_id = v_rid AND p.name = 'Cubeta + picada'
    JOIN public.promotion_combo_groups g ON g.promotion_id = p.id AND g.name = o.grp
    JOIN public.dishes d ON d.restaurant_id = v_rid AND d.name = o.dish;

  INSERT INTO public.promotions (name, description, kind, discount_type, discount_value, min_subtotal, max_discount,
                                 start_date, end_date, channels, active, restaurant_id, created_at)
  VALUES ('10 % en domicilios desde $90.000', 'Tope de $15.000 por pedido', 'bill_discount', 'percentage', 10, 90000, 15000,
          now() - interval '50 days', NULL, '{delivery}', true, v_rid, now() - interval '50 days');

  INSERT INTO public.promotions (name, description, kind, mode, discount_type, discount_value, max_uses_per_order,
                                 start_date, end_date, active, restaurant_id, created_at)
  VALUES ('Shot de cortesía por cumpleaños', 'Un shot por cuenta para quien cumple años, con PIN de administrador',
          'product_discount', 'manual_pin', 'percentage', 100, 1, now() - interval '50 days', NULL, true, v_rid,
          now() - interval '50 days');
  INSERT INTO public.promotion_categories (promotion_id, category_id, restaurant_id)
  SELECT p.id, mc.id, v_rid FROM public.promotions p JOIN public.categories mc ON mc.restaurant_id = v_rid AND mc.name = 'Shots'
   WHERE p.restaurant_id = v_rid AND p.name = 'Shot de cortesía por cumpleaños';

  INSERT INTO demo_rules SELECT p.id, p.kind, p.created_at, pg_temp.demo_rule_of(p.id) FROM public.promotions p WHERE p.restaurant_id = v_rid;
END
$setup$;

-- ---------------------------------------------------------------------------
-- Inventory: two locations, items with opening stock, preparations,
-- formulas, modifiers
-- ---------------------------------------------------------------------------

DO $inventory$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_barra uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND is_default);
  v_bodega uuid;
  v_item uuid;
  v_group uuid;
  r record;
BEGIN
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));

  -- The default location is the bar itself; the stockroom upstairs feeds it.
  UPDATE public.inventory_locations SET name = 'Barra', code = 'BARRA' WHERE id = v_barra;
  INSERT INTO public.inventory_locations (restaurant_id, name, code, is_default)
  VALUES (v_rid, 'Bodega', 'BODEGA', false) RETURNING id INTO v_bodega;

  INSERT INTO public.ingredient_categories (name, description, restaurant_id) VALUES
    ('Licores', 'Por mililitro; se compran por botella', v_rid),
    ('Cervezas', 'Por unidad; se compran por canasta o caja', v_rid),
    ('Mezcladores', 'Gaseosas, aguas y energizantes', v_rid),
    ('Frutas y hierbas', 'Fruta fresca para la barra', v_rid),
    ('Hielo', 'En cubos, por bolsa de 5 kg', v_rid),
    ('Cocina', 'Insumos de la comida de bar', v_rid),
    ('Secos y jarabes', 'Azúcar, sal, pulpas y café', v_rid),
    ('Preparaciones', 'Jarabes, zumos y premezclas de la barra', v_rid);

  INSERT INTO public.suppliers (restaurant_id, name, tax_id, contact_name, phone, email, lead_time_days) VALUES
    (v_rid, 'Licores del Altiplano S.A.S.', '900000000-2', 'Gustavo Peñaloza', '601 555 0171', 'pedidos@licoresaltiplano.example', 2),
    (v_rid, 'Distribuidora Cervecera Sabana Norte', '900000000-3', 'Lorena Bautista', '601 555 0188', 'ventas@sabananorte.example', 1),
    (v_rid, 'Frutas Frescas La Calera', '900000000-4', 'Ramiro Cifuentes', '601 555 0193', NULL, 1),
    (v_rid, 'Hielo Glaciar Bogotá', '900000000-5', 'Yolanda Rincón', '601 555 0120', 'despachos@hieloglaciar.example', 0),
    (v_rid, 'Abastos Chapinero', '900000000-6', 'Hernando Sua', '601 555 0164', 'abastos@chapinero.example', 2);

  -- name, category, unit, cost per unit, min stock, opening at Barra, at
  -- Bodega, supplier, purchase unit and factor (1 purchase unit = factor units).
  FOR r IN SELECT * FROM (VALUES
      ('Aguardiente Antioqueño', 'Licores', 'ml', 52, 3750, 5250, 12000, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Aguardiente Néctar', 'Licores', 'ml', 48, 1500, 2250, 4500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Ron Viejo de Caldas', 'Licores', 'ml', 60, 2250, 3000, 7500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Ron Medellín añejo', 'Licores', 'ml', 58, 750, 750, 1500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Ron blanco', 'Licores', 'ml', 44, 1500, 2250, 4500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Ginebra', 'Licores', 'ml', 105, 1500, 2250, 4500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Vodka', 'Licores', 'ml', 78, 750, 1500, 2250, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Tequila José Cuervo', 'Licores', 'ml', 118, 2250, 2250, 6000, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Whisky bourbon', 'Licores', 'ml', 135, 750, 1500, 3000, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Whisky Old Parr 12 años', 'Licores', 'ml', 185, 1500, 1500, 3000, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Whisky Buchanan''s 12 años', 'Licores', 'ml', 195, 750, 750, 1500, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Campari', 'Licores', 'ml', 92, 750, 750, 750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Vermut rojo', 'Licores', 'ml', 64, 750, 750, 750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Aperol', 'Licores', 'ml', 98, 750, 750, 2250, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Triple sec', 'Licores', 'ml', 70, 750, 750, 750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Licor de café', 'Licores', 'ml', 82, 750, 750, 750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Jägermeister', 'Licores', 'ml', 128, 750, 750, 750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Prosecco', 'Licores', 'ml', 42, 1500, 1500, 3750, 'Licores del Altiplano S.A.S.', 'botella', 750),
      ('Angostura', 'Licores', 'ml', 260, 200, 200, 200, 'Licores del Altiplano S.A.S.', 'frasco', 200),
      ('Crema de coco', 'Secos y jarabes', 'ml', 30, 850, 850, 1700, 'Abastos Chapinero', 'lata', 425),
      ('Águila 330 ml', 'Cervezas', 'unidad', 2350, 90, 120, 300, 'Distribuidora Cervecera Sabana Norte', 'canasta', 30),
      ('Poker 330 ml', 'Cervezas', 'unidad', 2300, 42, 60, 138, 'Distribuidora Cervecera Sabana Norte', 'canasta', 30),
      ('Costeña 330 ml', 'Cervezas', 'unidad', 2250, 24, 36, 78, 'Distribuidora Cervecera Sabana Norte', 'canasta', 30),
      ('Club Colombia Dorada 330 ml', 'Cervezas', 'unidad', 2950, 90, 120, 294, 'Distribuidora Cervecera Sabana Norte', 'canasta', 30),
      ('Club Colombia Roja 330 ml', 'Cervezas', 'unidad', 2950, 36, 48, 108, 'Distribuidora Cervecera Sabana Norte', 'canasta', 30),
      ('Corona 355 ml', 'Cervezas', 'unidad', 5100, 42, 54, 132, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Stella Artois 330 ml', 'Cervezas', 'unidad', 5600, 12, 18, 36, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Heineken 330 ml', 'Cervezas', 'unidad', 4800, 12, 12, 30, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Cerro Frío Golden Ale 330 ml', 'Cervezas', 'unidad', 6400, 12, 12, 24, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Cerro Frío Stout 330 ml', 'Cervezas', 'unidad', 6900, 6, 6, 12, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Quebrada IPA 330 ml', 'Cervezas', 'unidad', 7400, 6, 6, 18, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('La Sabana Red Ale 330 ml', 'Cervezas', 'unidad', 6400, 6, 6, 12, 'Distribuidora Cervecera Sabana Norte', 'caja', 24),
      ('Soda 300 ml', 'Mezcladores', 'unidad', 1500, 36, 48, 120, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Ginger ale 300 ml', 'Mezcladores', 'unidad', 1750, 18, 24, 0, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Coca-Cola 350 ml', 'Mezcladores', 'unidad', 1950, 12, 18, 42, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Agua tónica 300 ml', 'Mezcladores', 'unidad', 2100, 24, 30, 66, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Agua sin gas 600 ml', 'Mezcladores', 'unidad', 1300, 6, 6, 12, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Agua con gas 600 ml', 'Mezcladores', 'unidad', 1450, 6, 6, 12, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Red Bull 250 ml', 'Mezcladores', 'unidad', 6600, 6, 12, 0, 'Distribuidora Cervecera Sabana Norte', 'paca', 24),
      ('Limón tahití', 'Frutas y hierbas', 'kg', 4300, 6.5, 8.5, 0, 'Frutas Frescas La Calera', 'bulto', 25),
      ('Maracuyá', 'Frutas y hierbas', 'kg', 5900, 1, 1.5, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Mango biche', 'Frutas y hierbas', 'kg', 4600, 1, 1.5, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Piña', 'Frutas y hierbas', 'kg', 3300, 1, 1, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Lulo', 'Frutas y hierbas', 'kg', 6200, 1, 1, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Naranja', 'Frutas y hierbas', 'kg', 2900, 1, 1, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Hierbabuena', 'Frutas y hierbas', 'kg', 18000, 0.5, 0.5, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Aguacate', 'Frutas y hierbas', 'unidad', 2600, 18, 24, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Plátano verde', 'Frutas y hierbas', 'unidad', 950, 66, 90, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Tomate', 'Frutas y hierbas', 'kg', 3700, 2, 2.5, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Cebolla', 'Frutas y hierbas', 'kg', 3100, 1, 1.5, 0, 'Frutas Frescas La Calera', NULL, 1),
      ('Hielo en cubos', 'Hielo', 'kg', 900, 79.5, 106, 0, 'Hielo Glaciar Bogotá', 'bolsa', 5),
      ('Azúcar', 'Secos y jarabes', 'kg', 4200, 1.5, 2, 4.5, 'Abastos Chapinero', NULL, 1),
      ('Sal de michelada', 'Secos y jarabes', 'kg', 9500, 1, 1, 2, 'Abastos Chapinero', NULL, 1),
      ('Pulpa de tamarindo', 'Secos y jarabes', 'kg', 14500, 0.5, 0.5, 1, 'Abastos Chapinero', NULL, 1),
      ('Café espresso', 'Secos y jarabes', 'kg', 52000, 0.5, 0.5, 0.5, 'Abastos Chapinero', NULL, 1),
      ('Alitas de pollo', 'Cocina', 'kg', 14800, 16.5, 21.5, 53.5, 'Abastos Chapinero', NULL, 1),
      ('Totopos', 'Cocina', 'kg', 18500, 2.5, 3.5, 8, 'Abastos Chapinero', NULL, 1),
      ('Queso cheddar', 'Cocina', 'kg', 26000, 1.5, 2, 0, 'Abastos Chapinero', NULL, 1),
      ('Chorizo', 'Cocina', 'unidad', 2300, 36, 48, 114, 'Abastos Chapinero', NULL, 1),
      ('Chicharrón', 'Cocina', 'kg', 24500, 7, 9.5, 0, 'Abastos Chapinero', NULL, 1),
      ('Empanadas congeladas', 'Cocina', 'unidad', 1250, 108, 144, 348, 'Abastos Chapinero', 'paquete', 30),
      ('Papa a la francesa', 'Cocina', 'kg', 7900, 6.5, 8.5, 21, 'Abastos Chapinero', NULL, 1),
      ('Arepa de maíz', 'Cocina', 'unidad', 650, 66, 84, 210, 'Abastos Chapinero', NULL, 1),
      ('Aceite vegetal', 'Cocina', 'litro', 9800, 3.5, 5, 11.5, 'Abastos Chapinero', NULL, 1),
      ('Salsa BBQ', 'Cocina', 'kg', 12500, 1, 1.5, 3, 'Abastos Chapinero', NULL, 1),
      ('Salsa búfalo', 'Cocina', 'kg', 15500, 1, 1, 2, 'Abastos Chapinero', NULL, 1),
      ('Salsa miel mostaza', 'Cocina', 'kg', 14000, 0.5, 0.5, 1, 'Abastos Chapinero', NULL, 1)
    ) AS i(name, cat, unit, cost, min_stock, barra, bodega, supplier, purchase_unit, factor)
  LOOP
    INSERT INTO public.ingredients (name, unit, min_stock, category_id, default_supplier_id, restaurant_id, kind,
                                    purchase_unit, purchase_factor)
    VALUES (r.name, r.unit, r.min_stock,
            (SELECT id FROM public.ingredient_categories WHERE restaurant_id = v_rid AND name = r.cat),
            (SELECT id FROM public.suppliers WHERE restaurant_id = v_rid AND name = r.supplier),
            v_rid, 'raw', r.purchase_unit, r.factor)
    RETURNING id INTO v_item;
    PERFORM public.inventory_adjust(p_ingredient_id => v_item, p_location_id => v_barra, p_movement_type => 'opening',
                                    p_quantity => r.barra, p_unit_cost => r.cost, p_reason => 'Stock inicial');
    IF r.bodega > 0 THEN
      PERFORM public.inventory_adjust(p_ingredient_id => v_item, p_location_id => v_bodega, p_movement_type => 'opening',
                                      p_quantity => r.bodega, p_unit_cost => r.cost, p_reason => 'Stock inicial');
    END IF;
  END LOOP;
  UPDATE public.inventory_movements SET created_at = now() - interval '31 days'
   WHERE restaurant_id = v_rid AND movement_type = 'opening';

  -- Preparations of the bar (Fórmulas > Preparaciones), as POST
  -- /inventory/preparations and PUT of its formula do: a kind = 'prep' item,
  -- then save_formula with the batch yield (in ml).
  FOR r IN SELECT * FROM (VALUES
      ('Zumo de limón del día', 500, 1, 1000, '[["Limón tahití",2.2]]'),
      ('Jarabe simple', 1000, 10, 1600, '[["Azúcar",1]]'),
      ('Jarabe de maracuyá', 500, 5, 1500, '[["Maracuyá",1.2],["Azúcar",0.6]]'),
      ('Sour mix', 800, 2, 1000, '[["Zumo de limón del día",500],["Jarabe simple",500]]'),
      ('Premezcla de michelada', 500, 2, 500, '[["Zumo de limón del día",400],["Sal de michelada",0.08]]')
    ) AS p(name, min_stock, shelf_life, yield, lines)
  LOOP
    INSERT INTO public.ingredients (name, unit, kind, min_stock, shelf_life_days, category_id, restaurant_id)
    VALUES (r.name, 'ml', 'prep', r.min_stock, r.shelf_life,
            (SELECT id FROM public.ingredient_categories WHERE restaurant_id = v_rid AND name = 'Preparaciones'), v_rid)
    RETURNING id INTO v_item;
    PERFORM public.save_formula('prep', v_item, r.yield,
      (SELECT jsonb_agg(jsonb_build_object(
                'ingredient_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = l ->> 0),
                'quantity', (l ->> 1)::numeric))
         FROM jsonb_array_elements(r.lines::jsonb) l));
  END LOOP;

  -- Modifier groups (0023), admin only. An option with an ingredient is
  -- deducted by consume_order_stock next to the dish formula: the rum of a
  -- Mojito, the six beers of a bucket, the mixers of a bottle.
  FOR r IN SELECT * FROM (VALUES
      ('Base de michelada', 1, 1, '{"Michelada con Águila","Michelada con Club Colombia","Michelada con Corona"}',
       '[["Limón y sal",0,null,null],["Mango biche",2000,"Mango biche",0.06],["Tamarindo",2000,"Pulpa de tamarindo",0.04]]'),
      ('Licor del coctel', 1, 1, '{"Mojito","Piña colada","Daiquiri"}',
       '[["Ron blanco",0,"Ron blanco",60],["Ron añejo Viejo de Caldas",5000,"Ron Viejo de Caldas",60]]'),
      ('Mezclador para botella', 1, 2, '{"Botella aguardiente Antioqueño","Botella aguardiente Néctar","Botella ron Viejo de Caldas","Botella ron Medellín añejo","Botella whisky Old Parr 12 años","Botella whisky Buchanan''s 12 años","Media aguardiente Antioqueño","Media aguardiente Néctar","Media ron Viejo de Caldas"}',
       '[["Soda",0,"Soda 300 ml",3],["Ginger ale",0,"Ginger ale 300 ml",3],["Coca-Cola",0,"Coca-Cola 350 ml",3],["Agua tónica",0,"Agua tónica 300 ml",3]]'),
      ('Nacional de la cubeta', 1, 1, '{"Cubeta nacional x6"}',
       '[["Águila",0,"Águila 330 ml",6],["Poker",0,"Poker 330 ml",6],["Costeña",0,"Costeña 330 ml",6]]'),
      ('Club Colombia de la cubeta', 1, 1, '{"Cubeta Club Colombia x6"}',
       '[["Dorada",0,"Club Colombia Dorada 330 ml",6],["Roja",0,"Club Colombia Roja 330 ml",6]]'),
      ('Importada de la cubeta', 1, 1, '{"Cubeta importada x5"}',
       '[["Corona",0,"Corona 355 ml",5],["Stella Artois",0,"Stella Artois 330 ml",5],["Heineken",0,"Heineken 330 ml",5]]'),
      ('Salsa de las alitas', 1, 1, '{"Alitas x10"}',
       '[["BBQ",0,"Salsa BBQ",0.06],["Búfalo picante",0,"Salsa búfalo",0.06],["Miel mostaza",0,"Salsa miel mostaza",0.06]]')
    ) AS g(name, min_select, max_select, dishes, options)
  LOOP
    INSERT INTO public.modifier_groups (restaurant_id, name, required, min_select, max_select)
    VALUES (v_rid, r.name, r.min_select >= 1, r.min_select, r.max_select) RETURNING id INTO v_group;
    INSERT INTO public.modifier_options (restaurant_id, group_id, name, price, ingredient_id, ingredient_qty, sort_order)
    SELECT v_rid, v_group, o.v ->> 0, (o.v ->> 1)::numeric,
           (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = o.v ->> 2),
           (o.v ->> 3)::numeric, o.n - 1
      FROM jsonb_array_elements(r.options::jsonb) WITH ORDINALITY AS o(v, n);
    INSERT INTO public.dish_modifier_groups (restaurant_id, dish_id, group_id)
    SELECT v_rid, d.id, v_group FROM public.dishes d WHERE d.restaurant_id = v_rid AND d.name = ANY (r.dishes::text[]);
  END LOOP;

  -- Formulas (one portion): liquor in ml, fruit and ice in kg, beers and mixers by unit.
  FOR r IN SELECT * FROM (VALUES
      ('Bruma de maracuyá', '[["Ginebra",60],["Jarabe de maracuyá",30],["Zumo de limón del día",20],["Soda 300 ml",0.5],["Hielo en cubos",0.25]]'),
      ('Niebla de Monserrate', '[["Aguardiente Antioqueño",60],["Zumo de limón del día",25],["Jarabe simple",20],["Hierbabuena",0.005],["Hielo en cubos",0.25]]'),
      ('Chapinero sour', '[["Whisky bourbon",60],["Sour mix",60],["Angostura",1],["Hielo en cubos",0.2]]'),
      ('Lulo picante', '[["Ron blanco",60],["Lulo",0.12],["Jarabe simple",20],["Hielo en cubos",0.25]]'),
      ('Café de la Séptima', '[["Ron Viejo de Caldas",45],["Licor de café",20],["Café espresso",0.018],["Jarabe simple",10],["Hielo en cubos",0.2]]'),
      ('Mango biche spritz', '[["Vodka",45],["Mango biche",0.08],["Prosecco",60],["Soda 300 ml",0.3],["Hielo en cubos",0.25]]'),
      ('Margarita', '[["Tequila José Cuervo",50],["Triple sec",20],["Zumo de limón del día",25],["Sal de michelada",0.005],["Hielo en cubos",0.2]]'),
      ('Mojito', '[["Hierbabuena",0.008],["Zumo de limón del día",25],["Jarabe simple",20],["Soda 300 ml",0.4],["Hielo en cubos",0.3]]'),
      ('Negroni', '[["Ginebra",30],["Campari",30],["Vermut rojo",30],["Naranja",0.05],["Hielo en cubos",0.2]]'),
      ('Old Fashioned', '[["Whisky bourbon",60],["Jarabe simple",10],["Angostura",2],["Naranja",0.03],["Hielo en cubos",0.2]]'),
      ('Piña colada', '[["Crema de coco",60],["Piña",0.12],["Hielo en cubos",0.3]]'),
      ('Daiquiri', '[["Zumo de limón del día",30],["Jarabe simple",20],["Hielo en cubos",0.2]]'),
      ('Aperol spritz', '[["Aperol",60],["Prosecco",90],["Soda 300 ml",0.3],["Naranja",0.03],["Hielo en cubos",0.25]]'),
      ('Moscow mule', '[["Vodka",60],["Ginger ale 300 ml",0.6],["Zumo de limón del día",15],["Hielo en cubos",0.25]]'),
      ('Gin tonic', '[["Ginebra",60],["Agua tónica 300 ml",1],["Limón tahití",0.02],["Hielo en cubos",0.25]]'),
      ('Club Colombia Dorada', '[["Club Colombia Dorada 330 ml",1]]'),
      ('Club Colombia Roja', '[["Club Colombia Roja 330 ml",1]]'),
      ('Águila', '[["Águila 330 ml",1]]'),
      ('Poker', '[["Poker 330 ml",1]]'),
      ('Costeña', '[["Costeña 330 ml",1]]'),
      ('Cerro Frío Golden Ale', '[["Cerro Frío Golden Ale 330 ml",1]]'),
      ('Cerro Frío Stout', '[["Cerro Frío Stout 330 ml",1]]'),
      ('Quebrada IPA', '[["Quebrada IPA 330 ml",1]]'),
      ('La Sabana Red Ale', '[["La Sabana Red Ale 330 ml",1]]'),
      ('Corona', '[["Corona 355 ml",1],["Limón tahití",0.01]]'),
      ('Stella Artois', '[["Stella Artois 330 ml",1]]'),
      ('Heineken', '[["Heineken 330 ml",1]]'),
      ('Cubeta nacional x6', '[["Hielo en cubos",1]]'),
      ('Cubeta Club Colombia x6', '[["Hielo en cubos",1]]'),
      ('Cubeta importada x5', '[["Hielo en cubos",1],["Limón tahití",0.05]]'),
      ('Cubeta mixta x6', '[["Águila 330 ml",2],["Club Colombia Dorada 330 ml",2],["Corona 355 ml",2],["Hielo en cubos",1]]'),
      ('Michelada con Águila', '[["Águila 330 ml",1],["Premezcla de michelada",40],["Sal de michelada",0.01],["Hielo en cubos",0.15]]'),
      ('Michelada con Club Colombia', '[["Club Colombia Dorada 330 ml",1],["Premezcla de michelada",40],["Sal de michelada",0.01],["Hielo en cubos",0.15]]'),
      ('Michelada con Corona', '[["Corona 355 ml",1],["Premezcla de michelada",40],["Sal de michelada",0.01],["Hielo en cubos",0.15]]'),
      ('Shot de aguardiente Antioqueño', '[["Aguardiente Antioqueño",30]]'),
      ('Shot de tequila José Cuervo', '[["Tequila José Cuervo",30],["Limón tahití",0.01],["Sal de michelada",0.002]]'),
      ('Shot de Jägermeister', '[["Jägermeister",30]]'),
      ('Shot de ron Viejo de Caldas', '[["Ron Viejo de Caldas",30]]'),
      ('Botella aguardiente Antioqueño', '[["Aguardiente Antioqueño",750],["Hielo en cubos",1]]'),
      ('Botella aguardiente Néctar', '[["Aguardiente Néctar",750],["Hielo en cubos",1]]'),
      ('Botella ron Viejo de Caldas', '[["Ron Viejo de Caldas",750],["Hielo en cubos",1]]'),
      ('Botella ron Medellín añejo', '[["Ron Medellín añejo",750],["Hielo en cubos",1]]'),
      ('Botella whisky Old Parr 12 años', '[["Whisky Old Parr 12 años",750],["Hielo en cubos",1]]'),
      ('Botella whisky Buchanan''s 12 años', '[["Whisky Buchanan''s 12 años",750],["Hielo en cubos",1]]'),
      ('Botella tequila José Cuervo Especial', '[["Tequila José Cuervo",750],["Limón tahití",0.2],["Sal de michelada",0.05]]'),
      ('Media aguardiente Antioqueño', '[["Aguardiente Antioqueño",375],["Hielo en cubos",0.5]]'),
      ('Media aguardiente Néctar', '[["Aguardiente Néctar",375],["Hielo en cubos",0.5]]'),
      ('Media ron Viejo de Caldas', '[["Ron Viejo de Caldas",375],["Hielo en cubos",0.5]]'),
      ('Alitas x10', '[["Alitas de pollo",0.45],["Aceite vegetal",0.05]]'),
      ('Nachos con queso y guacamole', '[["Totopos",0.15],["Queso cheddar",0.08],["Aguacate",1]]'),
      ('Patacones con hogao', '[["Plátano verde",2],["Tomate",0.1],["Cebolla",0.05],["Aceite vegetal",0.05]]'),
      ('Chicharrón con limón y arepa', '[["Chicharrón",0.25],["Arepa de maíz",2],["Limón tahití",0.03]]'),
      ('Empanadas x6 con ají', '[["Empanadas congeladas",6],["Aceite vegetal",0.05]]'),
      ('Papas a la francesa', '[["Papa a la francesa",0.25],["Aceite vegetal",0.04]]'),
      ('Picada para 2', '[["Chorizo",2],["Chicharrón",0.2],["Alitas de pollo",0.25],["Papa a la francesa",0.2],["Plátano verde",2],["Arepa de maíz",2]]'),
      ('Picada para 4', '[["Chorizo",4],["Chicharrón",0.4],["Alitas de pollo",0.5],["Papa a la francesa",0.4],["Plátano verde",4],["Arepa de maíz",4]]'),
      ('Coca-Cola 350 ml', '[["Coca-Cola 350 ml",1]]'),
      ('Agua sin gas', '[["Agua sin gas 600 ml",1]]'),
      ('Agua con gas', '[["Agua con gas 600 ml",1]]'),
      ('Ginger ale', '[["Ginger ale 300 ml",1]]'),
      ('Red Bull', '[["Red Bull 250 ml",1]]'),
      ('Limonada natural', '[["Limón tahití",0.1],["Jarabe simple",30],["Hielo en cubos",0.2]]'),
      ('Limonada de coco', '[["Limón tahití",0.08],["Crema de coco",40],["Jarabe simple",15],["Hielo en cubos",0.2]]'),
      ('Limonada de hierbabuena', '[["Limón tahití",0.1],["Hierbabuena",0.005],["Jarabe simple",30],["Hielo en cubos",0.2]]'),
      ('Nojito', '[["Hierbabuena",0.008],["Zumo de limón del día",25],["Jarabe simple",25],["Soda 300 ml",0.6],["Hielo en cubos",0.3]]'),
      ('Maracuyá tonic', '[["Jarabe de maracuyá",40],["Agua tónica 300 ml",1],["Hielo en cubos",0.25]]')
    ) AS f(dish, lines)
  LOOP
    PERFORM public.save_formula('dish',
      (SELECT id FROM public.dishes WHERE restaurant_id = v_rid AND name = r.dish), 1,
      (SELECT jsonb_agg(jsonb_build_object(
                'ingredient_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = l ->> 0),
                'quantity', (l ->> 1)::numeric))
         FROM jsonb_array_elements(r.lines::jsonb) l));
  END LOOP;

  -- Production templates (admin, 0025): the daily mise en place of the bar.
  INSERT INTO public.production_templates (restaurant_id, name, lines, created_by, created_at, updated_at)
  SELECT v_rid, t.name,
         (SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'quantity', (l ->> 1)::numeric) ORDER BY l.n)
            FROM jsonb_array_elements(t.lines::jsonb) WITH ORDINALITY AS l(v, n)
            CROSS JOIN LATERAL (SELECT l.v AS l) x(l)
            JOIN public.ingredients i ON i.restaurant_id = v_rid AND i.name = x.l ->> 0),
         pg_temp.demo_profile('admin'), now() - interval '30 days', now() - interval '30 days'
    FROM (VALUES
      ('Mise en place diaria', '[["Zumo de limón del día",2000],["Jarabe simple",1600],["Jarabe de maracuyá",1500]]'),
      ('Bases de la noche', '[["Sour mix",1500],["Premezcla de michelada",1000]]'),
      ('Viernes y sábado', '[["Zumo de limón del día",3000],["Jarabe simple",3200],["Jarabe de maracuyá",3000]]')
    ) AS t(name, lines);
END
$inventory$;

-- ---------------------------------------------------------------------------
-- Purchases, transfers and production (as the admin and the bar kitchen)
-- ---------------------------------------------------------------------------

-- A purchase order to a supplier, delivered at p_at to p_location:
-- received (receive_purchase_order, every line), partial (half the lines)
-- or still ordered. p_lines: [{item_id, quantity, unit_cost}] in base units.
CREATE FUNCTION pg_temp.demo_po(p_supplier uuid, p_location uuid, p_at timestamptz, p_lines jsonb, p_mode text, p_notes text)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_po uuid;
  v_lead integer := (SELECT coalesce(lead_time_days, 1) FROM public.suppliers WHERE id = p_supplier);
  v_receipt jsonb;
BEGIN
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));
  INSERT INTO public.purchase_orders (restaurant_id, supplier_id, location_id, status, expected_on, notes, ordered_at, created_by)
  VALUES (v_rid, p_supplier, p_location, 'ordered', (p_at AT TIME ZONE 'America/Bogota')::date, p_notes,
          p_at - make_interval(days => greatest(v_lead, 1)), pg_temp.demo_profile('admin'))
  RETURNING id INTO v_po;
  INSERT INTO public.purchase_order_lines (restaurant_id, purchase_order_id, ingredient_id, quantity, unit_cost)
  SELECT v_rid, v_po, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric, (l ->> 'unit_cost')::numeric
    FROM jsonb_array_elements(p_lines) l;
  IF p_mode IN ('received', 'partial') THEN
    SELECT jsonb_agg(jsonb_build_object('line_id', pl.id, 'quantity', pl.quantity,
             'expires_on', CASE WHEN c.name = 'Frutas y hierbas' THEN (p_at AT TIME ZONE 'America/Bogota')::date + 6 END,
             'lot_code', CASE WHEN c.name = 'Frutas y hierbas' THEN 'OC' || po.number END)
             ORDER BY pl.created_at, pl.id)
      INTO v_receipt
      FROM public.purchase_order_lines pl
      JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
      JOIN public.ingredients i ON i.id = pl.ingredient_id
      LEFT JOIN public.ingredient_categories c ON c.id = i.category_id
     WHERE pl.purchase_order_id = v_po
       AND (p_mode = 'received' OR pl.id IN (SELECT x.id FROM public.purchase_order_lines x WHERE x.purchase_order_id = v_po
                                              ORDER BY x.ingredient_id LIMIT greatest(1, jsonb_array_length(p_lines) / 2)));
    PERFORM public.receive_purchase_order(v_po, v_receipt);
  END IF;
  UPDATE public.purchase_orders
     SET created_at = ordered_at, updated_at = CASE WHEN status = 'ordered' THEN ordered_at ELSE p_at END,
         received_at = CASE WHEN received_at IS NOT NULL THEN p_at END,
         payment_status = CASE WHEN status = 'received' AND p_at < now() - interval '7 days' THEN 'paid' ELSE 'pending' END
   WHERE id = v_po;
  UPDATE public.purchase_order_lines SET created_at = (SELECT ordered_at FROM public.purchase_orders WHERE id = v_po),
                                         updated_at = least(p_at, now())
   WHERE purchase_order_id = v_po;
  UPDATE public.inventory_movements SET created_at = p_at WHERE reference_type = 'purchase_order' AND reference_id = v_po;
  RETURN v_po;
END;
$$;

-- A transfer from Bodega to Barra (0032), created and sent half an hour
-- before p_at and received at p_at: received, short (the first line arrives
-- incomplete, with its reason) or still in transit.
CREATE FUNCTION pg_temp.demo_transfer(p_from uuid, p_to uuid, p_at timestamptz, p_lines jsonb, p_mode text, p_notes text)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));
  v_id := (public.create_inventory_transfer(p_from, p_to, p_lines, p_notes) ->> 'transfer_id')::uuid;
  PERFORM public.send_inventory_transfer(v_id);
  IF p_mode <> 'transit' THEN
    PERFORM public.receive_inventory_transfer(v_id, (
      SELECT jsonb_agg(jsonb_build_object('line_id', l.id,
               'received_quantity', CASE WHEN p_mode = 'short' AND l.rn = 1 THEN l.requested_quantity - greatest(1, round(l.requested_quantity * 0.1))
                                         ELSE l.requested_quantity END,
               'shortfall_reason', CASE WHEN p_mode = 'short' AND l.rn = 1 THEN 'Unidades rotas al subirlas por la escalera' END))
        FROM (SELECT tl.*, row_number() OVER (ORDER BY tl.created_at, tl.id) AS rn
                FROM public.inventory_transfer_lines tl WHERE tl.transfer_id = v_id) l));
  END IF;
  UPDATE public.inventory_transfers
     SET created_at = p_at - interval '40 minutes', sent_at = p_at - interval '30 minutes',
         received_at = CASE WHEN received_at IS NOT NULL THEN p_at END,
         updated_at = CASE WHEN received_at IS NOT NULL THEN p_at ELSE p_at - interval '30 minutes' END
   WHERE id = v_id;
  UPDATE public.inventory_transfer_lines SET created_at = p_at - interval '40 minutes',
                                             updated_at = CASE WHEN received_quantity IS NULL THEN p_at - interval '40 minutes' ELSE p_at END
   WHERE transfer_id = v_id;
  UPDATE public.inventory_transit_lots SET created_at = p_at - interval '30 minutes' WHERE transfer_id = v_id;
  UPDATE public.inventory_movements
     SET created_at = CASE WHEN movement_type = 'transfer_out' THEN p_at - interval '30 minutes' ELSE p_at END
   WHERE reference_type = 'inventory_transfer' AND reference_id = v_id;
  RETURN v_id;
END;
$$;

-- Lines of a routine order: every raw item of the supplier at p_mult times
-- its minimum, in whole purchase units. A few items stop arriving in the
-- last days, so they end below their minimum (on the order still open).
CREATE FUNCTION pg_temp.demo_po_lines(p_supplier uuid, p_mult numeric, p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_agg(jsonb_build_object('item_id', i.id,
           'quantity', ceil(i.min_stock * p_mult / i.purchase_factor) * i.purchase_factor, 'unit_cost', i.cost) ORDER BY i.name)
    FROM public.ingredients i
   WHERE i.default_supplier_id = p_supplier AND i.kind = 'raw'
     AND (p_at < now() - interval '3 days' OR i.name NOT IN ('Ginger ale 300 ml', 'Red Bull 250 ml', 'Mango biche', 'Hierbabuena', 'Aguacate'))
$$;

-- Lines of a transfer to the bar: what the Bodega holds of each item, up to
-- p_mult times its minimum, in whole purchase units.
CREATE FUNCTION pg_temp.demo_transfer_lines(p_from uuid, p_mult numeric) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_agg(jsonb_build_object('item_id', x.id, 'quantity', x.q) ORDER BY x.name)
    FROM (SELECT i.id, i.name,
                 least(ceil(i.min_stock * p_mult / i.purchase_factor) * i.purchase_factor,
                       floor(coalesce((SELECT sum(l.quantity) FROM public.inventory_lots l
                                        WHERE l.ingredient_id = i.id AND l.location_id = p_from AND l.quantity > 0), 0)
                             / i.purchase_factor) * i.purchase_factor) AS q
            FROM public.ingredients i
           WHERE i.restaurant_id = current_setting('vipe.restaurant_id')::uuid AND i.kind = 'raw') x
   WHERE x.q > 0
$$;

DO $supply$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_barra uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND is_default);
  v_bodega uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND code = 'BODEGA');
  v_today date := ((now() AT TIME ZONE 'America/Bogota') - interval '5 hours')::date;
  v_cal date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_s record;
  v_day date;
  v_at timestamptz;
  v_dow integer;
  v_mode text;
  v_result jsonb;
  d integer;
BEGIN
  PERFORM setseed(0.59);
  -- Day by day: deliveries arrive at 14:00-15:00, before the bar opens;
  -- today's only if that hour has passed.
  FOR d IN REVERSE 30..0 LOOP
    v_day := v_today - d;
    v_dow := extract(isodow FROM v_day);
    FOR v_s IN
      SELECT s.id, s.name, x.loc, x.mult, x.hour, x.note FROM public.suppliers s
      JOIN (VALUES
        ('Licores del Altiplano S.A.S.', 'bodega', 2.5, 14.0, d IN (28, 21, 14, 7, 2), 'Pedido semanal de licores'),
        ('Distribuidora Cervecera Sabana Norte', 'bodega', 1.2, 14.5, d IN (29, 26, 22, 19, 15, 12, 8, 5, 1), 'Reposición de cerveza y mezcladores'),
        ('Frutas Frescas La Calera', 'barra', 1.2, 13.5, d % 3 = 0 AND d > 0, 'Fruta fresca para la barra'),
        ('Hielo Glaciar Bogotá', 'barra', CASE WHEN v_dow IN (4, 5, 6) THEN 0.55 ELSE 0.3 END, 15.0, v_dow <> 1, 'Hielo del día'),
        ('Abastos Chapinero', 'barra', 2.5, 13.0, d IN (27, 20, 13, 6), 'Insumos de cocina y secos')
      ) AS x(name, loc, mult, hour, due, note) ON x.name = s.name AND x.due
      WHERE s.restaurant_id = v_rid
    LOOP
      v_at := pg_temp.demo_at(v_day, make_interval(mins => (v_s.hour * 60)::int));
      CONTINUE WHEN v_at > now() - interval '10 minutes';
      v_mode := CASE WHEN d = 2 AND v_s.name LIKE 'Licores%' THEN 'partial' ELSE 'received' END;
      PERFORM pg_temp.demo_po(v_s.id, CASE WHEN v_s.loc = 'barra' THEN v_barra ELSE v_bodega END, v_at,
                              pg_temp.demo_po_lines(v_s.id, v_s.mult, v_at), v_mode,
                              v_s.note || CASE WHEN v_mode = 'partial' THEN '; el resto llega la otra semana' ELSE '' END);
    END LOOP;

    -- Stock goes up to the bar at 15:30 on most days.
    IF d IN (27, 24, 20, 17, 13, 10, 9, 6, 3, 1) THEN
      v_at := pg_temp.demo_at(v_day, interval '15 hours 30 minutes');
      PERFORM pg_temp.demo_transfer(v_bodega, v_barra, v_at, pg_temp.demo_transfer_lines(v_bodega, 1.0),
                                    CASE WHEN d = 9 THEN 'short' ELSE 'received' END, 'Surtido de la barra');
    END IF;
  END LOOP;

  -- Still open: liquor for the weekend and beer and mixers (Ginger ale and Red Bull ran short).
  PERFORM pg_temp.demo_po(s.id, v_bodega, now() + interval '2 days', pg_temp.demo_po_lines(s.id, 1.5, now()), 'ordered',
                          'Licores para el fin de semana')
     FROM public.suppliers s WHERE s.restaurant_id = v_rid AND s.name = 'Licores del Altiplano S.A.S.';
  PERFORM pg_temp.demo_po(s.id, v_bodega, now() + interval '1 day',
                          jsonb_build_array(
                            jsonb_build_object('item_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = 'Ginger ale 300 ml'), 'quantity', 96, 'unit_cost', 1750),
                            jsonb_build_object('item_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = 'Red Bull 250 ml'), 'quantity', 72, 'unit_cost', 6600),
                            jsonb_build_object('item_id', (SELECT id FROM public.ingredients WHERE restaurant_id = v_rid AND name = 'Corona 355 ml'), 'quantity', 120, 'unit_cost', 5100)),
                          'ordered', 'Urgente: ginger y Red Bull por debajo del mínimo')
     FROM public.suppliers s WHERE s.restaurant_id = v_rid AND s.name = 'Distribuidora Cervecera Sabana Norte';
  UPDATE public.purchase_orders SET ordered_at = now() - interval '3 hours', created_at = now() - interval '3 hours',
                                    updated_at = now() - interval '3 hours'
   WHERE restaurant_id = v_rid AND status = 'ordered';
  UPDATE public.purchase_order_lines pl SET created_at = po.created_at, updated_at = po.created_at
    FROM public.purchase_orders po WHERE po.id = pl.purchase_order_id AND po.status = 'ordered' AND po.restaurant_id = v_rid;
  -- Going up to the bar right now.
  PERFORM pg_temp.demo_transfer(v_bodega, v_barra, now() - interval '5 minutes', pg_temp.demo_transfer_lines(v_bodega, 0.5),
                                'transit', 'Surtido para esta noche');

  -- Daily mise en place (produce_preparations, the kitchen reports it, the
  -- bartender of the day is responsible), before opening: juices and syrups
  -- first, then the bases made from them, sized by the day's expected
  -- crowd. The RPC takes up to 7 days back; older days are produced as today
  -- and moved to their date (business date, expiry, lot code and times).
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('kitchen'));
  FOR d IN REVERSE 30..0 LOOP
    v_day := v_cal - d;
    v_dow := extract(isodow FROM v_day);
    v_at := least(now() - interval '20 minutes', pg_temp.demo_at(v_day, interval '15 hours'));
    FOR v_s IN SELECT * FROM (VALUES
        (1, 'Mise en place diaria', '[["Zumo de limón del día",1000],["Jarabe simple",500],["Jarabe de maracuyá",300]]'),
        (2, 'Bases de la noche', '[["Sour mix",200],["Premezcla de michelada",500]]')) AS x(n, notes, lines)
      ORDER BY n
    LOOP
      v_result := public.produce_preparations(
        (SELECT jsonb_agg(jsonb_build_object('item_id', i.id, 'quantity',
                  greatest(100, round((l ->> 1)::numeric * CASE v_dow WHEN 1 THEN 0.4 WHEN 2 THEN 0.6 WHEN 3 THEN 0.8 WHEN 4 THEN 1.1
                                                                      WHEN 5 THEN 1.5 WHEN 6 THEN 1.7 ELSE 0.5 END / 100) * 100)))
           FROM jsonb_array_elements(v_s.lines::jsonb) l
           JOIN public.ingredients i ON i.restaurant_id = v_rid AND i.name = l ->> 0),
        NULL, CASE WHEN d <= 6 THEN v_day END, pg_temp.demo_profile('waiter', 1 + d % 2 * 3), v_s.notes);
    END LOOP;
    UPDATE public.inventory_lots l
       SET lot_code = 'PB-' || to_char(v_day, 'YYYYMMDD') || substr(l.lot_code, 12),
           expires_on = v_day + i.shelf_life_days, received_at = v_day::timestamp AT TIME ZONE 'America/Bogota'
      FROM public.production_batches b JOIN public.ingredients i ON i.id = b.ingredient_id
     WHERE d > 6 AND b.lot_id = l.id AND b.created_at = now() AND b.restaurant_id = v_rid;
    UPDATE public.production_batches b SET produced_on = v_day, expires_on = v_day + i.shelf_life_days
      FROM public.ingredients i WHERE d > 6 AND i.id = b.ingredient_id AND b.created_at = now() AND b.restaurant_id = v_rid;
    UPDATE public.inventory_movements m SET created_at = v_at
      FROM public.production_batches b
     WHERE m.reference_type = 'production_batch' AND m.reference_id = b.id AND b.created_at = now() AND b.restaurant_id = v_rid;
    UPDATE public.production_batches SET created_at = v_at WHERE restaurant_id = v_rid AND created_at = now();
  END LOOP;

  -- Lots were received when their first movement happened.
  UPDATE public.inventory_lots l SET received_at = least(l.received_at, m.first_at), created_at = least(l.created_at, m.first_at)
    FROM (SELECT lot_id, min(created_at) AS first_at FROM public.inventory_movements WHERE restaurant_id = v_rid GROUP BY lot_id) m
   WHERE m.lot_id = l.id;
  -- Inventory control is on: every order from now on consumes stock at the Barra.
  INSERT INTO public.business_config (restaurant_id, key, value) VALUES (v_rid, 'inventory_control_enabled', 'true');
END
$supply$;

-- ---------------------------------------------------------------------------
-- 30 days of service: one register a day from 15:30 to the close (02:30 on
-- Friday and Saturday, 00:30 most days, early on a quiet Monday and Sunday),
-- Thursday to Saturday peaks. Tabs of several rounds at the tables, takeaway
-- at the counter, a few deliveries, drawer movements and the cashier's count.
-- ---------------------------------------------------------------------------

DO $history$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_today date := ((now() AT TIME ZONE 'America/Bogota') - interval '5 hours')::date;
  v_day date;
  v_dow integer;
  v_factor numeric;
  v_close_h numeric;
  v_cashier uuid;
  v_register uuid;
  v_open timestamptz;
  v_close timestamptz;
  v_cutoff timestamptz;
  v_at timestamptz;
  v_last timestamptz;
  v_paid timestamptz;
  v_order uuid;
  v_waiter uuid;
  v_party integer;
  v_rounds integer;
  v_slot text;
  v_r numeric;
  v_diff bigint;
  d integer;
  k integer;
  r record;
BEGIN
  PERFORM setseed(0.731);
  FOR d IN REVERSE 30..0 LOOP
    v_day := v_today - d;
    v_dow := extract(isodow FROM v_day);
    v_factor := CASE v_dow WHEN 1 THEN 0.35 WHEN 2 THEN 0.60 WHEN 3 THEN 0.75 WHEN 4 THEN 1.10
                           WHEN 5 THEN 1.50 WHEN 6 THEN 1.70 ELSE 0.50 END;
    v_close_h := CASE WHEN v_dow IN (5, 6) THEN 26.5 WHEN v_dow = 1 THEN 23.0 WHEN v_dow = 7 THEN 23.5 ELSE 24.5 END;
    v_cashier := pg_temp.demo_profile('cashier', 1 + (d % 2));
    v_open := pg_temp.demo_at(v_day, CASE WHEN v_dow = 1 THEN interval '16 hours 30 minutes' ELSE interval '15 hours 30 minutes' END);
    v_close := pg_temp.demo_at(v_day, make_interval(mins => (v_close_h * 60)::int));
    -- Today only the hours already gone are history.
    v_cutoff := CASE WHEN d = 0 THEN now() - interval '45 minutes' ELSE v_close - interval '15 minutes' END;
    IF d = 0 THEN
      v_open := least(v_open, now() - interval '3 hours');
    END IF;

    -- RegistersService.open, as the cashier of the day.
    PERFORM pg_temp.demo_as(v_cashier);
    INSERT INTO public.cash_registers (opening_timestamp, initial_cash, status, restaurant_id)
    VALUES (now(), 300000, 'open', v_rid) RETURNING id INTO v_register;

    -- Tabs: happy hour, the night and, late, the after-midnight crowd.
    FOR r IN
      SELECT m.slot, pg_temp.demo_at(v_day, pg_temp.demo_slot(m.h_from, m.h_to)) AS at
        FROM (VALUES ('happy', 16.4, 19.0, 7), ('night', 19.0, 23.0, 14),
                     ('late', 23.0, v_close_h - 0.8, CASE WHEN v_dow IN (5, 6) THEN 9 WHEN v_dow = 1 THEN 0 ELSE 3 END)) AS m(slot, h_from, h_to, base),
             LATERAL generate_series(1, round(m.base * v_factor * (0.85 + random() * 0.3))::integer)
       WHERE m.h_to > m.h_from
       ORDER BY 2
    LOOP
      CONTINUE WHEN r.at > v_cutoff - interval '30 minutes' OR r.at < v_open + interval '20 minutes';
      v_party := CASE r.slot WHEN 'happy' THEN 1 + floor(random() * 3)::int
                             WHEN 'night' THEN 2 + floor(random() * random() * 6)::int
                             ELSE 2 + floor(random() * 4)::int END;
      v_waiter := CASE WHEN r.slot = 'happy' THEN pg_temp.demo_profile('waiter', 1 + floor(random() * 2)::int)
                       ELSE pg_temp.demo_profile('waiter', 1 + floor(random() * 4)::int) END;
      v_order := pg_temp.demo_open_order(v_waiter,
        (SELECT id FROM demo_tables WHERE seats >= v_party AND seats <= v_party + 3 ORDER BY random() LIMIT 1),
        r.slot, v_party, r.at);
      v_last := r.at;
      v_rounds := 1 + (random() < 0.6)::int + (random() < 0.3)::int + (r.slot = 'late' AND random() < 0.3)::int;
      FOR k IN 2..v_rounds LOOP
        v_at := v_last + make_interval(mins => 30 + floor(random() * 16)::int);
        EXIT WHEN v_at > v_cutoff - interval '20 minutes';
        v_slot := CASE WHEN extract(hour FROM v_at AT TIME ZONE 'America/Bogota') BETWEEN 16 AND 18 THEN 'happy'
                       WHEN extract(hour FROM v_at AT TIME ZONE 'America/Bogota') BETWEEN 19 AND 22 THEN 'night' ELSE 'late' END;
        PERFORM pg_temp.demo_round(v_waiter, v_order, v_slot, v_party, k, v_at);
        v_last := v_at;
      END LOOP;
      PERFORM pg_temp.demo_serve(v_order);
      PERFORM pg_temp.demo_pay(v_cashier, v_order, v_register);
      v_paid := least(v_last + make_interval(mins => 25 + floor(random() * 35)::int), v_cutoff);
      IF d = 0 THEN
        v_paid := least(v_paid, now() - interval '1 minute');
      END IF;
      PERFORM pg_temp.demo_backdate(v_order, r.at, greatest(v_paid, v_last + interval '1 minute'));
    END LOOP;

    -- Takeaway at the counter: wings and buckets to go.
    FOR r IN
      SELECT pg_temp.demo_at(v_day, pg_temp.demo_slot(18.0, 23.0)) AS at,
             (ARRAY['Ana María', 'Carlos Pérez', 'Juanita', 'Óscar Méndez', 'Luisa F.', 'Ricardo Gómez',
                    'Natalia', 'Iván Rojas'])[1 + floor(random() * 8)::int] AS name
        FROM generate_series(1, round(3 * v_factor * (0.7 + random() * 0.6))::integer)
       ORDER BY 1
    LOOP
      CONTINUE WHEN r.at > v_cutoff - interval '30 minutes' OR r.at < v_open;
      v_order := pg_temp.demo_takeaway(v_cashier, r.name, CASE WHEN random() < 0.5 THEN '30000020' || lpad((floor(random() * 90) + 10)::text, 2, '0') END, r.at);
      PERFORM pg_temp.demo_serve(v_order);
      PERFORM pg_temp.demo_pay(v_cashier, v_order, v_register);
      PERFORM pg_temp.demo_backdate(v_order, r.at, r.at + interval '22 minutes');
    END LOOP;

    -- Deliveries: mostly delivered, a few cancelled or re-dispatched.
    FOR r IN
      SELECT pg_temp.demo_at(v_day, pg_temp.demo_slot(18.5, v_close_h - 1.0)) AS at
        FROM generate_series(1, round(4 * v_factor * (0.8 + random() * 0.4))::integer)
       ORDER BY 1
    LOOP
      CONTINUE WHEN r.at > v_cutoff - interval '50 minutes' OR r.at < v_open;
      v_r := random();
      v_order := pg_temp.demo_delivery(CASE WHEN v_r < 0.05 THEN 'cancelled' WHEN v_r < 0.08 THEN 'retried' ELSE 'delivered' END,
                                       r.at, v_register);
      PERFORM pg_temp.demo_backdate_delivery(v_order, r.at);
    END LOOP;

    -- Drawer movements with their reason (RegistersService.addCashTransaction, 0026).
    PERFORM pg_temp.demo_as(v_cashier);
    INSERT INTO public.cash_transactions (amount, type, reason, description, cash_register_id, "timestamp", restaurant_id)
    SELECT m.amount, m.type, m.reason, m.description, v_register, m.at, v_rid
      FROM (VALUES
        (CASE WHEN v_dow IN (5, 6) THEN 45000 ELSE 28000 END, 'withdrawal', 'petty_cash', 'Compra de hielo de emergencia',
         pg_temp.demo_at(v_day, interval '21 hours'), random() < (CASE WHEN v_dow IN (4, 5, 6) THEN 0.7 ELSE 0.25 END)),
        (18000, 'withdrawal', 'petty_cash', 'Compra de limones en la plaza', pg_temp.demo_at(v_day, interval '17 hours'), random() < 0.35),
        (50000, 'deposit', 'change_fund', 'Sencillo para la base', pg_temp.demo_at(v_day, interval '16 hours'), random() < 0.2),
        (CASE WHEN v_dow IN (5, 6) THEN 120000 ELSE 60000 END, 'withdrawal', 'tips_payout', 'Propinas en efectivo repartidas al equipo',
         v_close - interval '20 minutes', d > 0 AND random() < 0.5)
      ) AS m(amount, type, reason, description, at, due)
     WHERE m.due AND m.at <= v_cutoff AND m.at > v_open;

    IF d > 0 THEN
      -- close_register computes the summary and final cash; then the
      -- cashier's count (0026) and the real times, after the last payment.
      PERFORM pg_temp.demo_as(v_cashier);
      PERFORM public.close_register(v_register);
      v_close := greatest(v_close, (SELECT max(p.created_at) + interval '7 minutes'
                                      FROM public.payments p WHERE p.cash_register_id = v_register));
      v_r := random();
      v_diff := CASE WHEN v_r < 0.72 THEN 0 WHEN v_r < 0.82 THEN -2000 WHEN v_r < 0.88 THEN 1000
                     WHEN v_r < 0.94 THEN -5000 WHEN v_r < 0.98 THEN 3000 ELSE -10000 END;
      UPDATE public.cash_registers
         SET opening_timestamp = v_open, closing_timestamp = v_close, created_at = v_open, updated_at = v_close,
             counted_cash = round(final_cash) + v_diff, cash_difference = v_diff, closed_by = v_cashier,
             close_note = CASE WHEN v_diff < -5000 THEN 'Faltante grande: se revisa con el equipo y las cámaras'
                               WHEN v_diff < 0 THEN 'Faltante menor, posible vuelto de más en barra'
                               WHEN v_diff > 0 THEN 'Sobrante: propina en efectivo sin registrar' END,
             validated_by = CASE WHEN d >= 2 THEN pg_temp.demo_profile('admin') END,
             validated_at = CASE WHEN d >= 2 THEN v_close + interval '11 hours' END
       WHERE id = v_register;
    ELSE
      UPDATE public.cash_registers SET opening_timestamp = v_open, created_at = v_open, updated_at = v_open
       WHERE id = v_register;
    END IF;
    UPDATE public.cash_transactions SET created_at = "timestamp", updated_at = "timestamp"
     WHERE cash_register_id = v_register;
  END LOOP;

  -- Informe Z of every validated day, numbered in day order, emitted by the
  -- admin a few minutes after validating it.
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));
  INSERT INTO public.z_reports (restaurant_id, number, business_day, snapshot, emitted_by, emitted_at)
  SELECT v_rid, row_number() OVER (ORDER BY x.day), x.day, pg_temp.demo_z(x.day), pg_temp.demo_profile('admin'),
         x.validated_at + interval '5 minutes'
    FROM (SELECT ((cr.opening_timestamp AT TIME ZONE 'America/Bogota') - interval '5 hours')::date AS day, cr.validated_at
            FROM public.cash_registers cr WHERE cr.restaurant_id = v_rid AND cr.validated_at IS NOT NULL) x
   ORDER BY x.day;

  -- Customers and their addresses: first seen with their first order.
  UPDATE public.customers c
     SET created_at = s.first_at
    FROM (SELECT od.customer_id, min(od.created_at) AS first_at
            FROM public.order_deliveries od WHERE od.restaurant_id = v_rid GROUP BY od.customer_id) s
   WHERE c.id = s.customer_id;
  UPDATE public.customer_addresses a SET created_at = c.created_at
    FROM public.customers c WHERE a.customer_id = c.id AND c.restaurant_id = v_rid;
  -- Every table is free again after the last paid tab.
  UPDATE public.tables SET status = 'available', waiter_id = NULL WHERE restaurant_id = v_rid;
END
$history$;

-- ---------------------------------------------------------------------------
-- Right now: tabs at the bar and on the floor, a bucket going, a bottle on
-- a lounge, a birthday table reserved, takeaway at the counter, deliveries
-- on the way, today's register open, a stock count in progress.
-- ---------------------------------------------------------------------------

-- A cart of named dishes (each with its options).
CREATE FUNCTION pg_temp.demo_cart_of(p_dishes text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  TRUNCATE demo_cart;
  FOREACH v_name IN ARRAY p_dishes LOOP
    PERFORM pg_temp.demo_cart_add((SELECT d.id FROM public.dishes d
                                    WHERE d.restaurant_id = current_setting('vipe.restaurant_id')::uuid AND d.name = v_name));
  END LOOP;
END;
$$;

-- A live tab on table p_table with exactly p_dishes, opened at p_at.
CREATE FUNCTION pg_temp.demo_live_tab(p_waiter uuid, p_table integer, p_dishes text[], p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order uuid;
  v_table uuid := (SELECT id FROM demo_tables WHERE number = p_table);
BEGIN
  PERFORM pg_temp.demo_as(p_waiter);
  PERFORM pg_temp.demo_cart_of(p_dishes);
  INSERT INTO public.orders (table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total,
                             restaurant_id)
  VALUES (v_table, p_waiter, 'kitchen', 'dine_in', 0, 0, 8, 0, 10, 0, current_setting('vipe.restaurant_id')::uuid)
  RETURNING id INTO v_order;
  PERFORM pg_temp.demo_add_cart(v_order, p_at);
  UPDATE public.tables SET status = 'kitchen', waiter_id = p_waiter, updated_at = now() WHERE id = v_table;
  PERFORM pg_temp.demo_backdate(v_order, p_at, p_at);
  RETURN v_order;
END;
$$;

DO $live$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_register uuid := (SELECT id FROM public.cash_registers WHERE restaurant_id = v_rid AND status = 'open');
  v_order uuid;
  v_at timestamptz;
BEGIN
  PERFORM setseed(0.88);
  -- Stool 2: a cocktail just sent to the bar.
  PERFORM pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 1), 2, '{"Bruma de maracuyá"}', now() - interval '4 minutes');

  -- Stool 3: a couple, first round served, the second just ordered (addItems).
  v_order := pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 1), 3, '{"Negroni","Gin tonic","Nachos con queso y guacamole"}',
                                   now() - interval '41 minutes');
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, now() - interval '41 minutes', now() - interval '30 minutes');
  PERFORM pg_temp.demo_cart_of('{"Old Fashioned","Margarita"}');
  PERFORM pg_temp.demo_add_cart(v_order, now() - interval '2 minutes');
  UPDATE public.orders SET status = 'kitchen' WHERE id = v_order;
  UPDATE public.tables SET status = 'kitchen' WHERE restaurant_id = v_rid AND number = 3;

  -- Stool 6 just sat down.
  UPDATE public.tables SET status = 'occupied', waiter_id = pg_temp.demo_profile('waiter', 4)
   WHERE restaurant_id = v_rid AND number = 6;

  -- Periquera 11: a bucket going, wings on the way.
  v_order := pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 2), 11, '{"Cubeta nacional x6","Alitas x10"}',
                                   now() - interval '26 minutes');
  UPDATE public.order_items SET status = 'served', updated_at = added_at + interval '3 minutes'
   WHERE order_id = v_order AND name = 'Cubeta nacional x6';

  -- Periquera 14: food just sent to the kitchen.
  PERFORM pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 2), 14,
                                '{"Picada para 2","Club Colombia Dorada","Club Colombia Dorada","Michelada con Águila"}',
                                now() - interval '9 minutes');

  -- Lounge 16: a birthday group with a bottle, a second round of shots now.
  v_order := pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 3), 16,
                                   '{"Botella aguardiente Antioqueño","Picada para 4","Agua sin gas","Agua sin gas"}',
                                   now() - interval '70 minutes');
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, now() - interval '70 minutes', now() - interval '50 minutes');
  PERFORM pg_temp.demo_cart_of('{"Shot de tequila José Cuervo","Shot de tequila José Cuervo","Shot de tequila José Cuervo","Shot de Jägermeister","Shot de Jägermeister","Shot de Jägermeister"}');
  PERFORM pg_temp.demo_add_cart(v_order, now() - interval '6 minutes');
  UPDATE public.orders SET status = 'kitchen' WHERE id = v_order;
  UPDATE public.tables SET status = 'kitchen' WHERE restaurant_id = v_rid AND number = 16;

  -- Terraza 21: everything served, waiting for the bill.
  v_order := pg_temp.demo_live_tab(pg_temp.demo_profile('waiter', 3), 21,
                                   '{"Corona","Corona","Heineken","Stella Artois","Empanadas x6 con ají"}', now() - interval '55 minutes');
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, now() - interval '55 minutes', now() - interval '35 minutes');

  -- Segundo piso 30: reserved for a birthday later tonight (0022).
  UPDATE public.tables SET status = 'reserved', reservation_name = 'Cumpleaños de Valentina',
                           reservation_arrival_at = now() + interval '2 hours', reserved_by = pg_temp.demo_profile('cashier', 1),
                           reserved_at = now() - interval '5 hours'
   WHERE restaurant_id = v_rid AND number = 30;

  -- Takeaway at the counter: one being prepared, one ready to pick up.
  v_order := pg_temp.demo_takeaway(pg_temp.demo_profile('cashier', 1), 'Mauricio Téllez', '3000002077', now() - interval '12 minutes');
  PERFORM pg_temp.demo_backdate(v_order, now() - interval '12 minutes', now() - interval '12 minutes');
  v_order := pg_temp.demo_takeaway(pg_temp.demo_profile('cashier', 1), 'Lina Bohórquez', NULL, now() - interval '25 minutes');
  PERFORM pg_temp.demo_serve(v_order);
  PERFORM pg_temp.demo_backdate(v_order, now() - interval '25 minutes', now() - interval '8 minutes');

  -- Deliveries in progress.
  v_order := pg_temp.demo_delivery('received', now() - interval '3 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '3 minutes');
  v_order := pg_temp.demo_delivery('preparing', now() - interval '15 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '15 minutes');
  v_order := pg_temp.demo_delivery('out_for_delivery', now() - interval '36 minutes', v_register);
  PERFORM pg_temp.demo_backdate_delivery(v_order, now() - interval '36 minutes');
END
$live$;

-- Stock counts (0034): the weekly blind count of the bar, counted by a
-- bartender and approved by the admin, applied four days ago; and tonight's
-- count of the Bodega, still being counted by the cashier.
DO $counts$
DECLARE
  v_rid uuid := current_setting('vipe.restaurant_id')::uuid;
  v_barra uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND is_default);
  v_bodega uuid := (SELECT id FROM public.inventory_locations WHERE restaurant_id = v_rid AND code = 'BODEGA');
  v_count uuid;
  v_at timestamptz := pg_temp.demo_at(((now() AT TIME ZONE 'America/Bogota') - interval '5 hours')::date - 4, interval '15 hours');
  l record;
BEGIN
  PERFORM setseed(0.42);
  -- This afternoon's fruit arrived spoiled: written off as waste by the
  -- kitchen, so these items are below their minimum tonight.
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('kitchen'));
  FOR l IN SELECT i.id, i.stock - round(i.min_stock * 0.4, CASE WHEN i.unit = 'unidad' THEN 0 ELSE 1 END) AS q FROM public.ingredients i
            WHERE i.restaurant_id = v_rid AND i.name IN ('Aguacate', 'Mango biche', 'Hierbabuena')
              AND i.stock > round(i.min_stock * 0.4, CASE WHEN i.unit = 'unidad' THEN 0 ELSE 1 END)
  LOOP
    PERFORM public.inventory_adjust(p_ingredient_id => l.id, p_location_id => v_barra, p_movement_type => 'waste',
                                    p_quantity => l.q, p_reason => 'Producto dañado',
                                    p_notes => 'Llegó maduro de más; se descarta');
  END LOOP;
  UPDATE public.inventory_movements SET created_at = now() - interval '2 hours'
   WHERE restaurant_id = v_rid AND movement_type = 'waste' AND created_at = now();
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));
  v_count := (public.prepare_inventory_count(v_barra,
    ARRAY(SELECT i.id FROM public.ingredients i WHERE i.restaurant_id = v_rid AND i.name IN (
            'Aguardiente Antioqueño', 'Ron Viejo de Caldas', 'Ron blanco', 'Ginebra', 'Vodka', 'Tequila José Cuervo',
            'Whisky Old Parr 12 años', 'Aperol', 'Águila 330 ml', 'Poker 330 ml', 'Club Colombia Dorada 330 ml', 'Corona 355 ml',
            'Limón tahití', 'Hielo en cubos')),
    pg_temp.demo_profile('waiter', 1), pg_temp.demo_profile('admin'), 'Conteo semanal de la barra') ->> 'count_id')::uuid;
  PERFORM public.start_inventory_count(v_count);
  -- The bartender counts blind (count_my_inventory_line): bottles a little
  -- short, beers and fruit as expected or one or two off.
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('waiter', 1));
  FOR l IN SELECT cl.id, cl.expected_quantity AS q, i.unit FROM public.inventory_count_lines cl
             JOIN public.ingredients i ON i.id = cl.ingredient_id WHERE cl.count_id = v_count ORDER BY i.name
  LOOP
    PERFORM public.count_my_inventory_line(v_count, l.id, greatest(0,
      CASE l.unit WHEN 'ml' THEN round((l.q - l.q * random() * 0.03) / 10) * 10
                  WHEN 'unidad' THEN l.q - floor(random() * 3)
                  ELSE round((l.q - l.q * random() * 0.04)::numeric, 1) END)::numeric);
  END LOOP;
  PERFORM public.submit_inventory_count(v_count);
  -- The admin writes the reasons of the differences and applies it.
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('admin'));
  UPDATE public.inventory_count_lines cl
     SET notes = CASE i.unit WHEN 'ml' THEN 'Servido de más en cócteles y derrames'
                             WHEN 'unidad' THEN 'Botellas rotas en la nevera' ELSE 'Merma normal' END
    FROM public.ingredients i
   WHERE cl.count_id = v_count AND i.id = cl.ingredient_id AND cl.counted_quantity <> cl.expected_quantity;
  PERFORM public.apply_inventory_count(v_count);
  UPDATE public.inventory_counts SET created_at = v_at - interval '30 minutes', submitted_at = v_at + interval '40 minutes',
                                     applied_at = v_at + interval '55 minutes', updated_at = v_at + interval '55 minutes'
   WHERE id = v_count;
  UPDATE public.inventory_movements SET created_at = v_at + interval '55 minutes'
   WHERE reference_type = 'inventory_count' AND reference_id = v_count;

  -- Tonight's count of the Bodega: the cashier is halfway.
  v_count := (public.prepare_inventory_count(v_bodega,
    ARRAY(SELECT i.id FROM public.ingredients i JOIN public.ingredient_categories c ON c.id = i.category_id
           WHERE i.restaurant_id = v_rid AND c.name IN ('Licores', 'Cervezas')),
    pg_temp.demo_profile('cashier', 2), pg_temp.demo_profile('admin'), 'Conteo de bodega antes del fin de semana') ->> 'count_id')::uuid;
  PERFORM public.start_inventory_count(v_count);
  PERFORM pg_temp.demo_as(pg_temp.demo_profile('cashier', 2));
  FOR l IN SELECT cl.id, cl.expected_quantity AS q FROM public.inventory_count_lines cl
             JOIN public.ingredients i ON i.id = cl.ingredient_id
            WHERE cl.count_id = v_count ORDER BY i.name LIMIT 12
  LOOP
    PERFORM public.count_my_inventory_line(v_count, l.id, l.q);
  END LOOP;
  UPDATE public.inventory_counts SET created_at = now() - interval '40 minutes', updated_at = now() - interval '35 minutes'
   WHERE id = v_count;
  PERFORM set_config('app.user_id', '', true);
END
$counts$;
