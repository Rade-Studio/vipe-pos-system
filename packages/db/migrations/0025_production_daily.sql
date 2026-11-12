-- Daily production: business date, responsible person, bulk production and
-- production templates (odd/tasks/produccion-diaria.md T1, S3, S4, S6, L4).
--
-- 1. public.production_batches gains produced_on (the business date, NOT NULL)
--    and produced_by (the staff profile responsible; SET NULL when the profile
--    is deleted). created_by stays the caller. Existing rows are backfilled
--    with created_at as a local date of the restaurant timezone and with
--    created_by. The column DEFAULT is current_date (a default cannot read the
--    row's restaurant); the RPCs always set the restaurant's local date.
-- 2. private.production_context validates the business date (today or up to
--    7 days back in the restaurant timezone, never future: 22023) and the
--    responsible person (an active profile of the restaurant, else 22023).
--    private.produce_batch is the former body of produce_preparation, driven
--    by them: expires_on = produced_on + shelf_life_days, the output lot is
--    received now() for today or at local 00:00 of produced_on for a past day,
--    and the default lot code is PB-<produced_on YYYYMMDD>-<local HH24MISS>.
-- 3. public.produce_preparation keeps its signature (pgTAP 130 pins it, and an
--    overload would make named calls ambiguous); it produces today as the
--    caller. public.produce_preparation_on adds p_produced_on / p_produced_by
--    and keeps the produce_preparation error prefix and shortage DETAIL the UI
--    matches.
-- 4. public.produce_preparations runs every line of a daily report in one
--    transaction: it validates every line, locks every preparation and input
--    in one id-ordered statement, checks the combined demand of all lines per
--    ingredient at the location and raises P0001 listing every short line
--    before writing anything; then produces each line through produce_batch.
-- 5. public.production_templates stores named quantity sets (admin only, RLS).
--
-- Errors: 22023 bad input, P0002 unknown preparation or location, P0001 no
-- formula or insufficient stock, 42501 role, 23505 duplicate template name.
ALTER TABLE public.production_batches
    ADD COLUMN produced_on date,
    ADD COLUMN produced_by uuid;
--> statement-breakpoint
UPDATE public.production_batches b
   SET produced_on = (b.created_at AT TIME ZONE COALESCE(r.timezone, 'America/Bogota'))::date,
       produced_by = b.created_by
  FROM public.restaurants r
 WHERE r.id = b.restaurant_id;
--> statement-breakpoint
UPDATE public.production_batches SET produced_on = created_at::date WHERE produced_on IS NULL;
--> statement-breakpoint
ALTER TABLE public.production_batches
    ALTER COLUMN produced_on SET DEFAULT current_date,
    ALTER COLUMN produced_on SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.production_batches
    ADD CONSTRAINT production_batches_produced_by_fkey FOREIGN KEY (produced_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_production_batches_restaurant_id_produced_on
    ON public.production_batches USING btree (restaurant_id, produced_on DESC, created_at DESC);
--> statement-breakpoint
COMMENT ON COLUMN public.production_batches.produced_on IS 'Business date of the production (local date of the restaurant): today or up to 7 days back. Drives expires_on. Backfilled from created_at in the restaurant timezone (0025).';
--> statement-breakpoint
COMMENT ON COLUMN public.production_batches.produced_by IS 'Staff profile responsible for the production (defaults to the caller); NULL after the profile is deleted. created_by stays the caller.';
--> statement-breakpoint
CREATE FUNCTION private.production_context(p_fn text, p_restaurant_id uuid, p_profile_id uuid, p_produced_on date, p_produced_by uuid,
                                           OUT produced_on date, OUT produced_by uuid, OUT tz text, OUT is_today boolean) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_today date;
BEGIN
  SELECT COALESCE(r.timezone, 'America/Bogota') INTO tz FROM public.restaurants r WHERE r.id = p_restaurant_id;
  tz := COALESCE(tz, 'America/Bogota');
  v_today := (now() AT TIME ZONE tz)::date;
  produced_on := COALESCE(p_produced_on, v_today);
  IF produced_on > v_today THEN
    RAISE EXCEPTION '%: produced_on cannot be in the future', p_fn USING ERRCODE = '22023';
  END IF;
  IF produced_on < v_today - 7 THEN
    RAISE EXCEPTION '%: produced_on cannot be more than 7 days ago', p_fn USING ERRCODE = '22023';
  END IF;
  is_today := produced_on = v_today;

  IF p_produced_by IS NULL THEN
    produced_by := p_profile_id;
  ELSE
    SELECT p.id INTO produced_by FROM public.profiles p
     WHERE p.id = p_produced_by AND p.restaurant_id = p_restaurant_id AND p.active;
    IF produced_by IS NULL THEN
      RAISE EXCEPTION '%: produced_by % is not an active staff member', p_fn, p_produced_by USING ERRCODE = '22023';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.production_context(text, uuid, uuid, date, uuid) FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION private.production_context(text, uuid, uuid, date, uuid) IS 'Resolves the business date (NULL = today in the restaurant timezone; future or more than 7 days back raises 22023) and the responsible person (NULL = the caller; else an active profile of the restaurant, 22023 otherwise). Returns {produced_on, produced_by, tz, is_today}.';
--> statement-breakpoint
CREATE FUNCTION private.produce_batch(p_fn text, p_restaurant_id uuid, p_profile_id uuid, p_ingredient_id uuid, p_quantity numeric,
                                      p_location_id uuid, p_lot_code text, p_notes text,
                                      p_produced_on date, p_produced_by uuid, p_tz text, p_is_today boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_item      public.ingredients%ROWTYPE;
  v_recipe    public.recipes%ROWTYPE;
  v_loc       uuid := p_location_id;
  v_batch     uuid := gen_random_uuid();
  v_req       record;
  v_shortages jsonb;
  v_taken     jsonb;
  v_consumed  jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_unit      numeric;
  v_expires   date;
  v_code      text;
  v_lot       uuid;
  v_received  timestamptz;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '%: p_quantity must be positive', p_fn USING ERRCODE = '22023';
  END IF;

  -- No lock yet: the preparation is locked together with its inputs below,
  -- in one id-ordered statement, so it queues behind consume_order_stock
  -- (which locks every ingredient in id order) instead of deadlocking.
  SELECT * INTO v_item FROM public.ingredients i
   WHERE i.id = p_ingredient_id AND i.restaurant_id = p_restaurant_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '%: preparation % not found', p_fn, p_ingredient_id USING ERRCODE = 'P0002';
  END IF;
  IF v_item.kind <> 'prep' THEN
    RAISE EXCEPTION '%: % is not a preparation', p_fn, v_item.name USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipe FROM public.recipes r WHERE r.ingredient_id = v_item.id;
  IF v_recipe.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = v_recipe.id) THEN
    RAISE EXCEPTION '%: % has no formula', p_fn, v_item.name USING ERRCODE = 'P0001';
  END IF;

  -- Lock the preparation and its inputs in one id-ordered statement, then
  -- check every requirement before writing anything.
  PERFORM 1 FROM public.ingredients i
   WHERE i.id = v_item.id
      OR i.id IN (SELECT ri.ingredient_id FROM public.recipe_ingredients ri WHERE ri.recipe_id = v_recipe.id)
   ORDER BY i.id
   FOR UPDATE;
  SELECT * INTO v_item FROM public.ingredients i WHERE i.id = v_item.id;

  SELECT jsonb_agg(jsonb_build_object(
           'ingredient_id', q.ingredient_id, 'name', q.name, 'unit', q.unit,
           'required', q.required, 'available', q.available,
           'missing', (q.required - q.available)::numeric(14,3)) ORDER BY q.name)
    INTO v_shortages
    FROM (
      SELECT i.id AS ingredient_id, i.name, i.unit,
             (ri.quantity * p_quantity / v_recipe.yield_quantity)::numeric(14,3) AS required,
             COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l
                        WHERE l.ingredient_id = i.id AND l.location_id = v_loc AND l.quantity > 0), 0)::numeric(14,3) AS available
        FROM public.recipe_ingredients ri
        JOIN public.ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = v_recipe.id
    ) q
   WHERE q.required > q.available;

  IF v_shortages IS NOT NULL THEN
    RAISE EXCEPTION '%: insufficient stock: %', p_fn,
      (SELECT string_agg((s->>'name') || ' (missing ' || (s->>'missing') || ' ' || (s->>'unit') || ')', ', ')
         FROM jsonb_array_elements(v_shortages) s)
      USING ERRCODE = 'P0001', DETAIL = v_shortages::text;
  END IF;

  FOR v_req IN
    SELECT i.id, i.name, (ri.quantity * p_quantity / v_recipe.yield_quantity)::numeric(14,3) AS required
      FROM public.recipe_ingredients ri
      JOIN public.ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = v_recipe.id
     ORDER BY i.id
  LOOP
    CONTINUE WHEN v_req.required <= 0;
    v_taken := private.inventory_take(p_restaurant_id, v_req.id, v_loc, v_req.required, 'production_consume',
                                      'production_batch', v_batch, p_profile_id, false, NULL, p_notes);
    v_total := v_total + (v_taken->>'total_cost')::numeric;
    v_consumed := v_consumed || jsonb_build_object(
      'ingredient_id', v_req.id, 'name', v_req.name, 'quantity', v_req.required,
      'total_cost', round((v_taken->>'total_cost')::numeric, 4));
    PERFORM private.inventory_sync_stock(v_req.id);
  END LOOP;

  v_unit := round(v_total / p_quantity, 4);
  v_expires := CASE WHEN v_item.shelf_life_days IS NOT NULL THEN p_produced_on + v_item.shelf_life_days END;
  v_code := COALESCE(NULLIF(btrim(p_lot_code), ''),
                     'PB-' || to_char(p_produced_on, 'YYYYMMDD') || '-' || to_char(now() AT TIME ZONE p_tz, 'HH24MISS'));
  v_received := CASE WHEN p_is_today THEN now() ELSE p_produced_on::timestamp AT TIME ZONE p_tz END;

  PERFORM private.inventory_average_cost(v_item.id, p_quantity, v_unit);
  v_lot := private.inventory_put(p_restaurant_id, v_item.id, v_loc, p_quantity, v_unit, v_code, v_expires,
                                 v_received, 'production_output', 'production_batch', v_batch,
                                 p_profile_id, NULL, p_notes);
  PERFORM private.inventory_sync_stock(v_item.id);

  INSERT INTO public.production_batches
    (id, restaurant_id, ingredient_id, location_id, quantity, lot_id, unit_cost, total_cost, expires_on, notes, created_by,
     produced_on, produced_by)
  VALUES (v_batch, p_restaurant_id, v_item.id, v_loc, p_quantity, v_lot, v_unit, v_total, v_expires,
          p_notes, p_profile_id, p_produced_on, p_produced_by);

  RETURN jsonb_build_object(
    'batch_id', v_batch,
    'lot_id', v_lot,
    'lot_code', v_code,
    'ingredient_id', v_item.id,
    'location_id', v_loc,
    'quantity', p_quantity::numeric(14,3),
    'unit_cost', v_unit::numeric(14,4),
    'total_cost', round(v_total, 4),
    'expires_on', v_expires,
    'consumed', v_consumed
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.produce_batch(text, uuid, uuid, uuid, numeric, uuid, text, text, date, uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
COMMENT ON FUNCTION private.produce_batch(text, uuid, uuid, uuid, numeric, uuid, text, text, date, uuid, text, boolean) IS 'Body of produce_preparation for a resolved tenant, caller, location and production_context: locks the preparation and its inputs, raises P0001 with the shortages (DETAIL jsonb) before writing, consumes FEFO, writes the output lot (expires_on = produced_on + shelf_life_days; received now() today, local 00:00 of produced_on otherwise; default code PB-<produced_on>-<local HH24MISS>), the weighted-average cost and the production_batches row.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.produce_preparation(p_ingredient_id uuid, p_quantity numeric, p_location_id uuid DEFAULT NULL::uuid, p_lot_code text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN public.produce_preparation_on(p_ingredient_id, p_quantity, p_location_id, p_lot_code, p_notes, NULL, NULL);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.produce_preparation_on(p_ingredient_id uuid, p_quantity numeric, p_location_id uuid, p_lot_code text, p_notes text,
                                              p_produced_on date, p_produced_by uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  -- The UI matches the produce_preparation prefix.
  c_fn constant text := 'produce_preparation';
  v_caller record;
  v_ctx    record;
  v_loc    uuid;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'kitchen']);
  SELECT * INTO v_ctx FROM private.production_context(c_fn, v_caller.restaurant_id, v_caller.profile_id, p_produced_on, p_produced_by);
  v_loc := private.inventory_location(c_fn, v_caller.restaurant_id, p_location_id);
  RETURN private.produce_batch(c_fn, v_caller.restaurant_id, v_caller.profile_id, p_ingredient_id, p_quantity, v_loc,
                               p_lot_code, p_notes, v_ctx.produced_on, v_ctx.produced_by, v_ctx.tz, v_ctx.is_today);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.produce_preparation_on(uuid, numeric, uuid, text, text, date, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.produce_preparation_on(uuid, numeric, uuid, text, text, date, uuid) TO vipe_api;
--> statement-breakpoint
COMMENT ON FUNCTION public.produce_preparation(p_ingredient_id uuid, p_quantity numeric, p_location_id uuid, p_lot_code text, p_notes text) IS 'Produces p_quantity of a preparation today as the caller: produce_preparation_on(..., NULL, NULL). Admin or kitchen.';
--> statement-breakpoint
COMMENT ON FUNCTION public.produce_preparation_on(uuid, numeric, uuid, text, text, date, uuid) IS 'Produces p_quantity of a preparation at a location (NULL = default), admin or kitchen, on business date p_produced_on (NULL = today in the restaurant timezone; up to 7 days back, never future: 22023) by p_produced_by (NULL = caller; an active profile of the restaurant, else 22023). Consumes each formula line x (p_quantity / yield_quantity) FEFO (production_consume), creates an output lot (p_lot_code or PB-<produced_on YYYYMMDD>-<local HH24MISS>, expires_on = produced_on + shelf_life_days) with unit_cost = consumed cost / p_quantity, updates the weighted-average cost and records a production_batches row (created_by = caller). Insufficient stock raises P0001 produce_preparation: insufficient stock (DETAIL = jsonb [{ingredient_id, name, unit, required, available, missing}]) and writes nothing. Returns {batch_id, lot_id, lot_code, ingredient_id, location_id, quantity, unit_cost, total_cost, expires_on, consumed:[{ingredient_id, name, quantity, total_cost}]}.';
--> statement-breakpoint
CREATE FUNCTION public.produce_preparations(p_lines jsonb, p_location_id uuid DEFAULT NULL::uuid, p_produced_on date DEFAULT NULL::date,
                                            p_produced_by uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'produce_preparations';
  v_caller    record;
  v_ctx       record;
  v_loc       uuid;
  v_line      jsonb;
  v_id        uuid;
  v_qty       numeric;
  v_ids       uuid[] := '{}';
  v_item      public.ingredients%ROWTYPE;
  v_shortages jsonb;
  v_result    jsonb;
  v_batches   jsonb := '[]'::jsonb;
  v_total     numeric := 0;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'kitchen']);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '%: p_lines must be an array of 1 to 100 lines', c_fn USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ctx FROM private.production_context(c_fn, v_caller.restaurant_id, v_caller.profile_id, p_produced_on, p_produced_by);
  v_loc := private.inventory_location(c_fn, v_caller.restaurant_id, p_location_id);

  -- Validate every line before locking anything.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_id := (v_line->>'item_id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION '%: invalid line %', c_fn, v_line USING ERRCODE = '22023';
    END;
    IF v_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '%: each line needs an item_id and a positive quantity', c_fn USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION '%: preparation % appears twice', c_fn, v_id USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_id;

    SELECT * INTO v_item FROM public.ingredients i WHERE i.id = v_id AND i.restaurant_id = v_caller.restaurant_id;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION '%: preparation % not found', c_fn, v_id USING ERRCODE = 'P0002';
    END IF;
    IF v_item.kind <> 'prep' THEN
      RAISE EXCEPTION '%: % is not a preparation', c_fn, v_item.name USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.recipes r JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                    WHERE r.ingredient_id = v_id) THEN
      RAISE EXCEPTION '%: % has no formula', c_fn, v_item.name USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Lock every preparation and input in one id-ordered statement.
  PERFORM 1 FROM public.ingredients i
   WHERE i.id = ANY (v_ids)
      OR i.id IN (SELECT ri.ingredient_id FROM public.recipes r JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                   WHERE r.ingredient_id = ANY (v_ids))
   ORDER BY i.id
   FOR UPDATE;

  -- Combined demand of every line per input at the location; each short input
  -- is listed under every line that uses it, with the combined figures.
  WITH lines AS (
    SELECT (l->>'item_id')::uuid AS item_id, (l->>'quantity')::numeric AS quantity FROM jsonb_array_elements(p_lines) l
  ), demand AS (
    SELECT ln.item_id, ri.ingredient_id, ri.quantity * ln.quantity / r.yield_quantity AS required
      FROM lines ln
      JOIN public.recipes r ON r.ingredient_id = ln.item_id
      JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
  ), short AS (
    SELECT q.* FROM (
      SELECT d.ingredient_id, i.name, i.unit, sum(d.required)::numeric(14,3) AS required,
             COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l
                        WHERE l.ingredient_id = d.ingredient_id AND l.location_id = v_loc AND l.quantity > 0), 0)::numeric(14,3) AS available
        FROM demand d JOIN public.ingredients i ON i.id = d.ingredient_id
       GROUP BY d.ingredient_id, i.name, i.unit
    ) q
     WHERE q.required > q.available
  ), per_line AS (
    SELECT d.item_id, p.name,
           jsonb_agg(jsonb_build_object(
             'ingredient_id', s.ingredient_id, 'name', s.name, 'unit', s.unit, 'required', s.required,
             'available', s.available, 'missing', (s.required - s.available)::numeric(14,3)) ORDER BY s.name) AS ingredients
      FROM demand d
      JOIN short s ON s.ingredient_id = d.ingredient_id
      JOIN public.ingredients p ON p.id = d.item_id
     GROUP BY d.item_id, p.name
  )
  SELECT jsonb_agg(jsonb_build_object('item_id', pl.item_id, 'name', pl.name, 'ingredients', pl.ingredients) ORDER BY pl.name, pl.item_id)
    INTO v_shortages
    FROM per_line pl;

  IF v_shortages IS NOT NULL THEN
    RAISE EXCEPTION '%: insufficient stock: %', c_fn,
      (SELECT string_agg((l->>'name') || ' (' ||
                (SELECT string_agg((g->>'name') || ' missing ' || (g->>'missing') || ' ' || (g->>'unit'), ', ')
                   FROM jsonb_array_elements(l->'ingredients') g) || ')', ', ')
         FROM jsonb_array_elements(v_shortages) l)
      USING ERRCODE = 'P0001', DETAIL = v_shortages::text;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_result := private.produce_batch(c_fn, v_caller.restaurant_id, v_caller.profile_id, (v_line->>'item_id')::uuid,
                                      (v_line->>'quantity')::numeric, v_loc, v_line->>'lot_code', p_notes,
                                      v_ctx.produced_on, v_ctx.produced_by, v_ctx.tz, v_ctx.is_today);
    v_total := v_total + (v_result->>'total_cost')::numeric;
    v_batches := v_batches || jsonb_build_array(v_result);
  END LOOP;

  RETURN jsonb_build_object('batches', v_batches, 'total_cost', round(v_total, 4));
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.produce_preparations(jsonb, uuid, date, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.produce_preparations(jsonb, uuid, date, uuid, text) TO vipe_api;
--> statement-breakpoint
COMMENT ON FUNCTION public.produce_preparations(jsonb, uuid, date, uuid, text) IS 'Daily production report, admin or kitchen: produces every line of p_lines [{item_id, quantity, lot_code?}] (1..100, unique item_id) at one location (NULL = default) on one business date by one responsible person (production_context rules) in ONE transaction, all or nothing. The combined demand of all lines is checked per input at the location before writing: a shortage raises P0001 produce_preparations: insufficient stock with DETAIL = jsonb [{item_id, name, ingredients:[{ingredient_id, name, unit, required, available, missing}]}] (required = combined demand of every line, each short input listed under every line that uses it). Returns {batches:[produce_preparation result per line, in order], total_cost}.';
--> statement-breakpoint
CREATE TABLE public.production_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid DEFAULT private.default_restaurant_id() NOT NULL,
    name text NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_templates_pkey PRIMARY KEY (id),
    CONSTRAINT production_templates_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT production_templates_lines_check CHECK (jsonb_typeof(lines) = 'array'),
    CONSTRAINT production_templates_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT production_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX production_templates_restaurant_id_name_key ON public.production_templates USING btree (restaurant_id, lower(btrim(name)));
--> statement-breakpoint
COMMENT ON TABLE public.production_templates IS 'Named sets of production quantities [{item_id, quantity > 0}] that fill the daily production sheet (S4). Names are unique per restaurant ignoring case. Admin only (read and write); lines are validated by the API against the active preparations.';
--> statement-breakpoint
ALTER TABLE public.production_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY production_templates_select_policy ON public.production_templates FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY production_templates_insert_policy ON public.production_templates FOR INSERT TO vipe_api WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY production_templates_update_policy ON public.production_templates FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY production_templates_delete_policy ON public.production_templates FOR DELETE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.production_templates TO vipe_api;
