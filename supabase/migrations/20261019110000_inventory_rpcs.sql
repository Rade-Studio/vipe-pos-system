-- ============================================
-- Inventory RPCs
-- ============================================
-- odd/tasks/admin-dashboard-inventario.md, T4 (S3, S5). Every stock change
-- goes through these SECURITY DEFINER functions (owner postgres,
-- search_path = ''), which keep ingredients.stock = sum(inventory_lots.quantity)
-- for every item they touch.
--
-- Errors: 22023 bad input, P0002 missing or another tenant's row, 42501 the
-- caller's role may not do this, P0001 business rule (insufficient stock,
-- wrong document status).
--
-- Quantities are base units (ingredients.unit). Outflows pick lots FEFO:
-- expires_on ASC NULLS LAST, received_at, id; only positive lots are taken.
-- Inbound with a cost (opening with p_unit_cost, purchase, production output)
-- updates ingredients.cost as a moving weighted average over the positive
-- stock.
--
--   inventory_adjust        opening / adjustment (admin), waste (admin, kitchen)
--   inventory_transfer      FEFO move between locations (admin)
--   save_formula            atomic replace of a dish or prep formula (admin)
--   receive_purchase_order  partial / full receipt (admin)
--   open_inventory_count    snapshot of a location (admin)
--   apply_inventory_count   final balance = counted (admin)
--   produce_preparation     batch production of a prep (admin, kitchen)
--   consume_order_stock     idempotent sale consumption (admin, cashier,
--                           waiter, delivery_operator)
--   check_dishes_stock      pre-send shortage report (every tenant role)
--   inventory_overview      dashboard KPIs (admin)
-- ============================================

-- ============================================
-- SECTION 1: private helpers
-- ============================================
CREATE OR REPLACE FUNCTION private.inventory_caller(
  p_fn    text,
  p_roles text[],
  OUT profile_id uuid,
  OUT restaurant_id uuid,
  OUT app_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT p.id, p.restaurant_id, p.role INTO profile_id, restaurant_id, app_role
    FROM public.profiles p
   WHERE p.auth_user_id = auth.uid()
   LIMIT 1;

  IF profile_id IS NULL THEN
    RAISE EXCEPTION '%: the caller has no profile', p_fn USING ERRCODE = '42501';
  END IF;
  IF NOT (app_role = ANY (p_roles)) THEN
    RAISE EXCEPTION '%: role % may not call this function', p_fn, app_role USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.inventory_caller(text, text[]) IS
  'Resolves the caller profile / tenant / role from auth.uid() and raises 42501 when there is no profile or the role is not in p_roles.';

CREATE OR REPLACE FUNCTION private.inventory_location(p_fn text, p_restaurant_id uuid, p_location_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_location_id IS NULL THEN
    RETURN private.ensure_default_inventory_location(p_restaurant_id);
  END IF;

  SELECT l.id INTO v_id
    FROM public.inventory_locations l
   WHERE l.id = p_location_id AND l.restaurant_id = p_restaurant_id AND l.is_active;

  IF v_id IS NULL THEN
    RAISE EXCEPTION '%: location % not found', p_fn, p_location_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION private.inventory_location(text, uuid, uuid) IS
  'Returns p_location_id when it is an active location of the tenant (else P0002), or the default location when NULL.';

CREATE OR REPLACE FUNCTION private.inventory_sync_stock(p_ingredient_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.ingredients i
     SET stock = COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l WHERE l.ingredient_id = i.id), 0)
   WHERE i.id = p_ingredient_id
  RETURNING i.stock
$$;

COMMENT ON FUNCTION private.inventory_sync_stock(uuid) IS
  'Sets ingredients.stock = sum(inventory_lots.quantity) for one item and returns it.';

CREATE OR REPLACE FUNCTION private.inventory_average_cost(p_ingredient_id uuid, p_quantity numeric, p_unit_cost numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.ingredients i
     SET cost = CASE
                  WHEN greatest(i.stock, 0) + p_quantity <= 0 THEN p_unit_cost
                  ELSE (greatest(i.stock, 0) * COALESCE(i.cost, 0) + p_quantity * p_unit_cost)
                       / (greatest(i.stock, 0) + p_quantity)
                END
   WHERE i.id = p_ingredient_id
$$;

COMMENT ON FUNCTION private.inventory_average_cost(uuid, numeric, numeric) IS
  'Moving weighted-average cost: (max(stock, 0) * cost + quantity * unit_cost) / (max(stock, 0) + quantity). Call before the inbound quantity is added to stock.';

-- Adds a positive quantity to a lot (general lot when no code and no expiry;
-- otherwise the lot with the same code + expiry at the location, created when
-- missing) and writes the inbound movement. Returns the lot id.
CREATE OR REPLACE FUNCTION private.inventory_put(
  p_restaurant_id uuid,
  p_ingredient_id uuid,
  p_location_id   uuid,
  p_quantity      numeric,
  p_unit_cost     numeric,
  p_lot_code      text,
  p_expires_on    date,
  p_received_at   timestamptz,
  p_type          text,
  p_ref_type      text,
  p_ref_id        uuid,
  p_by            uuid,
  p_reason        text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text := NULLIF(btrim(p_lot_code), '');
  v_cost numeric := greatest(COALESCE(p_unit_cost, 0), 0);
  v_lot  public.inventory_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_lot
    FROM public.inventory_lots l
   WHERE l.ingredient_id = p_ingredient_id AND l.location_id = p_location_id
     AND l.lot_code IS NOT DISTINCT FROM v_code AND l.expires_on IS NOT DISTINCT FROM p_expires_on
   ORDER BY l.received_at
   LIMIT 1
   FOR UPDATE;

  IF v_lot.id IS NULL THEN
    INSERT INTO public.inventory_lots
      (restaurant_id, ingredient_id, location_id, lot_code, expires_on, quantity, unit_cost, received_at)
    VALUES (p_restaurant_id, p_ingredient_id, p_location_id, v_code, p_expires_on, p_quantity, v_cost,
            COALESCE(p_received_at, now()))
    RETURNING * INTO v_lot;
  ELSE
    UPDATE public.inventory_lots
       SET unit_cost = CASE WHEN quantity > 0 THEN (quantity * unit_cost + p_quantity * v_cost) / (quantity + p_quantity)
                            ELSE v_cost END,
           quantity = quantity + p_quantity
     WHERE id = v_lot.id;
  END IF;

  INSERT INTO public.inventory_movements
    (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost,
     total_cost, reason, notes, reference_type, reference_id, created_by)
  VALUES (p_restaurant_id, p_ingredient_id, p_location_id, v_lot.id, p_type, p_quantity, v_cost,
          p_quantity * v_cost, p_reason, p_notes, p_ref_type, p_ref_id, p_by);

  RETURN v_lot.id;
END;
$$;

COMMENT ON FUNCTION private.inventory_put(uuid, uuid, uuid, numeric, numeric, text, date, timestamptz, text, text, uuid, uuid, text, text) IS
  'Adds p_quantity (> 0) to the matching lot (general when no code and no expiry), blending its unit cost, and writes one inbound movement. Returns the lot id.';

-- Takes a positive quantity FEFO from the positive lots of an item at a
-- location, one outbound movement per lot. When the lots run out:
-- p_allow_negative drives the general lot negative (sale shortage), otherwise
-- P0001. Returns {total_cost, missing, portions:[{lot_id, lot_code,
-- expires_on, received_at, quantity, unit_cost}]}.
CREATE OR REPLACE FUNCTION private.inventory_take(
  p_restaurant_id  uuid,
  p_ingredient_id  uuid,
  p_location_id    uuid,
  p_quantity       numeric,
  p_type           text,
  p_ref_type       text,
  p_ref_id         uuid,
  p_by             uuid,
  p_allow_negative boolean,
  p_reason         text DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_left     numeric := p_quantity;
  v_take     numeric;
  v_total    numeric := 0;
  v_portions jsonb := '[]'::jsonb;
  v_lot      record;
  v_general  public.inventory_lots%ROWTYPE;
  v_item     public.ingredients%ROWTYPE;
BEGIN
  FOR v_lot IN
    SELECT l.* FROM public.inventory_lots l
     WHERE l.ingredient_id = p_ingredient_id AND l.location_id = p_location_id AND l.quantity > 0
     ORDER BY l.expires_on ASC NULLS LAST, l.received_at, l.id
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := least(v_lot.quantity, v_left);
    UPDATE public.inventory_lots SET quantity = quantity - v_take WHERE id = v_lot.id;
    INSERT INTO public.inventory_movements
      (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost,
       total_cost, reason, notes, reference_type, reference_id, created_by)
    VALUES (p_restaurant_id, p_ingredient_id, p_location_id, v_lot.id, p_type, -v_take, v_lot.unit_cost,
            -v_take * v_lot.unit_cost, p_reason, p_notes, p_ref_type, p_ref_id, p_by);
    v_total := v_total + v_take * v_lot.unit_cost;
    v_portions := v_portions || jsonb_build_object(
      'lot_id', v_lot.id, 'lot_code', v_lot.lot_code, 'expires_on', v_lot.expires_on,
      'received_at', v_lot.received_at, 'quantity', v_take, 'unit_cost', v_lot.unit_cost);
    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    SELECT * INTO v_item FROM public.ingredients i WHERE i.id = p_ingredient_id;
    IF NOT p_allow_negative THEN
      RAISE EXCEPTION 'insufficient stock: % (missing % %)', v_item.name, v_left::numeric(14,3), v_item.unit
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object('ingredient_id', p_ingredient_id, 'missing', v_left)::text;
    END IF;

    INSERT INTO public.inventory_lots (restaurant_id, ingredient_id, location_id, quantity, unit_cost)
    VALUES (p_restaurant_id, p_ingredient_id, p_location_id, 0, greatest(COALESCE(v_item.cost, 0), 0))
    ON CONFLICT (ingredient_id, location_id) WHERE lot_code IS NULL AND expires_on IS NULL DO NOTHING;

    SELECT * INTO v_general FROM public.inventory_lots l
     WHERE l.ingredient_id = p_ingredient_id AND l.location_id = p_location_id
       AND l.lot_code IS NULL AND l.expires_on IS NULL
     FOR UPDATE;

    UPDATE public.inventory_lots SET quantity = quantity - v_left WHERE id = v_general.id;
    INSERT INTO public.inventory_movements
      (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost,
       total_cost, reason, notes, reference_type, reference_id, created_by)
    VALUES (p_restaurant_id, p_ingredient_id, p_location_id, v_general.id, p_type, -v_left,
            COALESCE(v_item.cost, 0), -v_left * COALESCE(v_item.cost, 0), p_reason, p_notes,
            p_ref_type, p_ref_id, p_by);
    v_total := v_total + v_left * COALESCE(v_item.cost, 0);
  END IF;

  RETURN jsonb_build_object('total_cost', v_total,
                            'missing', CASE WHEN v_left > 0 THEN v_left ELSE 0 END,
                            'portions', v_portions);
END;
$$;

COMMENT ON FUNCTION private.inventory_take(uuid, uuid, uuid, numeric, text, text, uuid, uuid, boolean, text, text) IS
  'Removes p_quantity (> 0) FEFO from the positive lots of an item at a location, writing one outbound movement per lot. Shortage: general lot goes negative when p_allow_negative, else P0001. Returns {total_cost, missing, portions[]}.';

-- ============================================
-- SECTION 2: inventory_adjust
-- ============================================
CREATE OR REPLACE FUNCTION public.inventory_adjust(
  p_ingredient_id uuid,
  p_location_id   uuid,
  p_movement_type text,
  p_quantity      numeric,
  p_unit_cost     numeric DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_notes         text DEFAULT NULL,
  p_lot_id        uuid DEFAULT NULL,
  p_lot_code      text DEFAULT NULL,
  p_expires_on    date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'inventory_adjust';
  v_caller record;
  v_item   public.ingredients%ROWTYPE;
  v_loc    uuid;
  v_signed numeric;
  v_cost   numeric;
  v_total  numeric := 0;
  v_lot    public.inventory_lots%ROWTYPE;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'kitchen']);

  IF p_movement_type IS NULL OR p_movement_type NOT IN ('opening', 'adjustment', 'waste') THEN
    RAISE EXCEPTION '%: p_movement_type must be opening, adjustment or waste', c_fn USING ERRCODE = '22023';
  END IF;
  IF v_caller.app_role <> 'admin' AND p_movement_type <> 'waste' THEN
    RAISE EXCEPTION '%: only admin may record %', c_fn, p_movement_type USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION '%: p_quantity must be non-zero', c_fn USING ERRCODE = '22023';
  END IF;
  IF p_movement_type IN ('opening', 'waste') AND p_quantity < 0 THEN
    RAISE EXCEPTION '%: p_quantity must be positive for %', c_fn, p_movement_type USING ERRCODE = '22023';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION '%: p_unit_cost must be >= 0', c_fn USING ERRCODE = '22023';
  END IF;
  IF length(p_reason) > 200 THEN
    RAISE EXCEPTION '%: p_reason accepts at most 200 characters', c_fn USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.ingredients i
   WHERE i.id = p_ingredient_id AND i.restaurant_id = v_caller.restaurant_id
   FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '%: ingredient % not found', c_fn, p_ingredient_id USING ERRCODE = 'P0002';
  END IF;

  v_loc := private.inventory_location(c_fn, v_caller.restaurant_id, p_location_id);
  v_signed := CASE WHEN p_movement_type = 'waste' THEN -p_quantity ELSE p_quantity END;

  IF v_signed > 0 THEN
    v_cost := COALESCE(p_unit_cost, v_item.cost, 0);
    IF p_unit_cost IS NOT NULL THEN
      PERFORM private.inventory_average_cost(v_item.id, v_signed, p_unit_cost);
    END IF;
    PERFORM private.inventory_put(v_caller.restaurant_id, v_item.id, v_loc, v_signed, v_cost,
                                  p_lot_code, p_expires_on, now(), p_movement_type, NULL, NULL,
                                  v_caller.profile_id, p_reason, p_notes);
    v_total := v_signed * v_cost;
  ELSIF p_lot_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM public.inventory_lots l
     WHERE l.id = p_lot_id AND l.ingredient_id = v_item.id AND l.location_id = v_loc
     FOR UPDATE;
    IF v_lot.id IS NULL THEN
      RAISE EXCEPTION '%: lot % not found', c_fn, p_lot_id USING ERRCODE = 'P0002';
    END IF;
    IF v_lot.quantity < -v_signed THEN
      RAISE EXCEPTION '%: insufficient stock in lot (available %)', c_fn, v_lot.quantity USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.inventory_lots SET quantity = quantity + v_signed WHERE id = v_lot.id;
    INSERT INTO public.inventory_movements
      (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity, unit_cost,
       total_cost, reason, notes, created_by)
    VALUES (v_caller.restaurant_id, v_item.id, v_loc, v_lot.id, p_movement_type, v_signed, v_lot.unit_cost,
            v_signed * v_lot.unit_cost, p_reason, p_notes, v_caller.profile_id);
    v_total := v_signed * v_lot.unit_cost;
  ELSE
    v_total := -(private.inventory_take(v_caller.restaurant_id, v_item.id, v_loc, -v_signed, p_movement_type,
                                        NULL, NULL, v_caller.profile_id, false, p_reason, p_notes)->>'total_cost')::numeric;
  END IF;

  RETURN jsonb_build_object(
    'ingredient_id', v_item.id,
    'location_id', v_loc,
    'movement_type', p_movement_type,
    'quantity', v_signed::numeric(14,3),
    'total_cost', round(v_total, 4),
    'stock', private.inventory_sync_stock(v_item.id)
  );
END;
$$;

COMMENT ON FUNCTION public.inventory_adjust(uuid, uuid, text, numeric, numeric, text, text, uuid, text, date) IS
  'Manual stock change. p_movement_type: opening (> 0, admin), adjustment (signed, admin), waste (> 0, recorded negative; admin or kitchen). p_location_id NULL = default location. Positive: goes to the lot matching p_lot_code / p_expires_on (general when both NULL) at p_unit_cost (default ingredients.cost; an explicit cost updates the weighted-average cost). Negative: from p_lot_id when given, else FEFO; never below zero (P0001). Returns {ingredient_id, location_id, movement_type, quantity (signed), total_cost (signed), stock}. Errors: 22023 / P0002 / 42501 / P0001.';

-- ============================================
-- SECTION 3: inventory_transfer
-- ============================================
CREATE OR REPLACE FUNCTION public.inventory_transfer(
  p_ingredient_id    uuid,
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_quantity         numeric,
  p_notes            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'inventory_transfer';
  v_caller   record;
  v_item     public.ingredients%ROWTYPE;
  v_from     uuid;
  v_to       uuid;
  v_id       uuid := gen_random_uuid();
  v_taken    jsonb;
  v_portion  jsonb;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '%: p_quantity must be positive', c_fn USING ERRCODE = '22023';
  END IF;
  IF p_from_location_id IS NULL OR p_to_location_id IS NULL OR p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION '%: source and destination must be two different locations', c_fn USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.ingredients i
   WHERE i.id = p_ingredient_id AND i.restaurant_id = v_caller.restaurant_id
   FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '%: ingredient % not found', c_fn, p_ingredient_id USING ERRCODE = 'P0002';
  END IF;
  v_from := private.inventory_location(c_fn, v_caller.restaurant_id, p_from_location_id);
  v_to := private.inventory_location(c_fn, v_caller.restaurant_id, p_to_location_id);

  v_taken := private.inventory_take(v_caller.restaurant_id, v_item.id, v_from, p_quantity, 'transfer_out',
                                    'transfer', v_id, v_caller.profile_id, false, NULL, p_notes);

  FOR v_portion IN SELECT * FROM jsonb_array_elements(v_taken->'portions') LOOP
    PERFORM private.inventory_put(v_caller.restaurant_id, v_item.id, v_to,
                                  (v_portion->>'quantity')::numeric, (v_portion->>'unit_cost')::numeric,
                                  v_portion->>'lot_code', (v_portion->>'expires_on')::date,
                                  (v_portion->>'received_at')::timestamptz, 'transfer_in',
                                  'transfer', v_id, v_caller.profile_id, NULL, p_notes);
  END LOOP;

  PERFORM private.inventory_sync_stock(v_item.id);

  RETURN jsonb_build_object(
    'transfer_id', v_id,
    'ingredient_id', v_item.id,
    'from_location_id', v_from,
    'to_location_id', v_to,
    'quantity', p_quantity::numeric(14,3),
    'total_cost', round((v_taken->>'total_cost')::numeric, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.inventory_transfer(uuid, uuid, uuid, numeric, text) IS
  'Moves p_quantity (> 0) of an item between two active locations of the tenant (admin). Takes FEFO from the source and recreates each portion at the destination with the same lot_code, expires_on, received_at and unit_cost (transfer_out / transfer_in movements sharing reference transfer:<transfer_id>). Never below zero (P0001). Returns {transfer_id, ingredient_id, from_location_id, to_location_id, quantity, total_cost}.';

-- ============================================
-- SECTION 4: save_formula
-- ============================================
CREATE OR REPLACE FUNCTION public.save_formula(
  p_target_type    text,
  p_target_id      uuid,
  p_yield_quantity numeric,
  p_lines          jsonb,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'save_formula';
  v_caller  record;
  v_kind    text;
  v_recipe  uuid;
  v_line    jsonb;
  v_ing     uuid;
  v_qty     numeric;
  v_seen    uuid[] := '{}';
  v_total   numeric;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  -- Serialize formula saves per tenant so two concurrent saves (A uses B,
  -- B uses A) cannot both pass the cycle check.
  PERFORM pg_advisory_xact_lock(hashtext('save_formula:' || v_caller.restaurant_id::text));

  IF p_target_type IS NULL OR p_target_type NOT IN ('dish', 'prep') THEN
    RAISE EXCEPTION '%: p_target_type must be dish or prep', c_fn USING ERRCODE = '22023';
  END IF;
  IF p_yield_quantity IS NULL OR p_yield_quantity <= 0 THEN
    RAISE EXCEPTION '%: p_yield_quantity must be positive', c_fn USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION '%: p_lines must be an array of 1..200 lines', c_fn USING ERRCODE = '22023';
  END IF;

  IF p_target_type = 'dish' THEN
    IF NOT EXISTS (SELECT 1 FROM public.dishes d WHERE d.id = p_target_id AND d.restaurant_id = v_caller.restaurant_id) THEN
      RAISE EXCEPTION '%: dish % not found', c_fn, p_target_id USING ERRCODE = 'P0002';
    END IF;
    SELECT r.id INTO v_recipe FROM public.recipes r WHERE r.dish_id = p_target_id FOR UPDATE;
  ELSE
    SELECT i.kind INTO v_kind FROM public.ingredients i
     WHERE i.id = p_target_id AND i.restaurant_id = v_caller.restaurant_id;
    IF v_kind IS NULL THEN
      RAISE EXCEPTION '%: preparation % not found', c_fn, p_target_id USING ERRCODE = 'P0002';
    END IF;
    IF v_kind <> 'prep' THEN
      RAISE EXCEPTION '%: the formula output must be a preparation', c_fn USING ERRCODE = '22023';
    END IF;
    SELECT r.id INTO v_recipe FROM public.recipes r WHERE r.ingredient_id = p_target_id FOR UPDATE;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_ing := (v_line->>'ingredient_id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: each line needs a uuid ingredient_id and a numeric quantity', c_fn USING ERRCODE = '22023';
    END;
    IF v_ing IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '%: each line needs an ingredient_id and a positive quantity', c_fn USING ERRCODE = '22023';
    END IF;
    IF v_ing = ANY (v_seen) THEN
      RAISE EXCEPTION '%: ingredient % appears twice', c_fn, v_ing USING ERRCODE = '22023';
    END IF;
    IF p_target_type = 'prep' AND v_ing = p_target_id THEN
      RAISE EXCEPTION '%: a preparation cannot use itself', c_fn USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = v_ing AND i.restaurant_id = v_caller.restaurant_id) THEN
      RAISE EXCEPTION '%: ingredient % not found', c_fn, v_ing USING ERRCODE = 'P0002';
    END IF;
    v_seen := v_seen || v_ing;
  END LOOP;

  IF v_recipe IS NULL THEN
    INSERT INTO public.recipes (restaurant_id, dish_id, ingredient_id, yield_quantity, notes)
    VALUES (v_caller.restaurant_id,
            CASE WHEN p_target_type = 'dish' THEN p_target_id END,
            CASE WHEN p_target_type = 'prep' THEN p_target_id END,
            p_yield_quantity, p_notes)
    RETURNING id INTO v_recipe;
  ELSE
    UPDATE public.recipes SET yield_quantity = p_yield_quantity, notes = p_notes WHERE id = v_recipe;
    DELETE FROM public.recipe_ingredients WHERE recipe_id = v_recipe;
  END IF;

  -- The cycle guard on recipe_ingredients raises 22023 here and rolls back the
  -- whole call, so the previous formula stays intact.
  INSERT INTO public.recipe_ingredients (restaurant_id, recipe_id, ingredient_id, quantity)
  SELECT v_caller.restaurant_id, v_recipe, (l->>'ingredient_id')::uuid, (l->>'quantity')::numeric
    FROM jsonb_array_elements(p_lines) l;

  SELECT COALESCE(sum(ri.quantity * COALESCE(i.cost, 0)), 0) INTO v_total
    FROM public.recipe_ingredients ri JOIN public.ingredients i ON i.id = ri.ingredient_id
   WHERE ri.recipe_id = v_recipe;

  RETURN jsonb_build_object(
    'recipe_id', v_recipe,
    'target_type', p_target_type,
    'target_id', p_target_id,
    'yield_quantity', p_yield_quantity::numeric(14,3),
    'lines_count', jsonb_array_length(p_lines),
    'total_cost', round(v_total, 4),
    'unit_cost', round(v_total / p_yield_quantity, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.save_formula(text, uuid, numeric, jsonb, text) IS
  'Atomically replaces the formula of a dish (p_target_type = dish) or a preparation (prep, output kind must be prep), admin only. p_lines = [{ingredient_id, quantity > 0}] (1..200, no duplicates, tenant items). Rejects self-reference and cycles (22023), foreign targets / items (P0002). Returns {recipe_id, target_type, target_id, yield_quantity, lines_count, total_cost, unit_cost = total_cost / yield_quantity} at current ingredients.cost.';

-- ============================================
-- SECTION 5: receive_purchase_order
-- ============================================
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_lines             jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'receive_purchase_order';
  v_caller  record;
  v_po      public.purchase_orders%ROWTYPE;
  v_line    jsonb;
  v_pol     public.purchase_order_lines%ROWTYPE;
  v_id      uuid;
  v_qty     numeric;
  v_cost    numeric;
  v_expires date;
  v_seen    uuid[] := '{}';
  v_total   numeric := 0;
  v_status  text;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  SELECT * INTO v_po FROM public.purchase_orders po
   WHERE po.id = p_purchase_order_id AND po.restaurant_id = v_caller.restaurant_id
   FOR UPDATE;
  IF v_po.id IS NULL THEN
    RAISE EXCEPTION '%: purchase order % not found', c_fn, p_purchase_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_po.status NOT IN ('ordered', 'partially_received') THEN
    RAISE EXCEPTION '%: purchase order % is %', c_fn, v_po.number, v_po.status USING ERRCODE = 'P0001';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '%: p_lines must be a non-empty array', c_fn USING ERRCODE = '22023';
  END IF;

  -- Lock every ingredient of the order up front, in id order, instead of in
  -- the order the caller listed the lines, so concurrent stock writers queue.
  PERFORM 1 FROM public.ingredients i
   WHERE i.id IN (SELECT l.ingredient_id FROM public.purchase_order_lines l
                   WHERE l.purchase_order_id = v_po.id)
   ORDER BY i.id
   FOR UPDATE;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN
      v_id := (v_line->>'line_id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
      v_cost := (v_line->>'unit_cost')::numeric;
      v_expires := (v_line->>'expires_on')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: invalid receipt line %', c_fn, v_line USING ERRCODE = '22023';
    END;
    IF v_id IS NULL OR v_qty IS NULL OR v_qty <= 0 OR (v_cost IS NOT NULL AND v_cost < 0) THEN
      RAISE EXCEPTION '%: each line needs line_id and a positive quantity', c_fn USING ERRCODE = '22023';
    END IF;
    IF v_id = ANY (v_seen) THEN
      RAISE EXCEPTION '%: line % appears twice', c_fn, v_id USING ERRCODE = '22023';
    END IF;
    v_seen := v_seen || v_id;

    SELECT * INTO v_pol FROM public.purchase_order_lines l
     WHERE l.id = v_id AND l.purchase_order_id = v_po.id
     FOR UPDATE;
    IF v_pol.id IS NULL THEN
      RAISE EXCEPTION '%: line % not found', c_fn, v_id USING ERRCODE = 'P0002';
    END IF;
    IF v_pol.received_quantity + v_qty > v_pol.quantity THEN
      RAISE EXCEPTION '%: receiving % exceeds the pending quantity %', c_fn, v_qty,
        v_pol.quantity - v_pol.received_quantity USING ERRCODE = 'P0001';
    END IF;

    v_cost := COALESCE(v_cost, v_pol.unit_cost);
    PERFORM private.inventory_average_cost(v_pol.ingredient_id, v_qty, v_cost);
    PERFORM private.inventory_put(v_caller.restaurant_id, v_pol.ingredient_id, v_po.location_id, v_qty, v_cost,
                                  v_line->>'lot_code', v_expires, now(), 'purchase',
                                  'purchase_order', v_po.id, v_caller.profile_id, NULL, NULL);
    UPDATE public.purchase_order_lines SET received_quantity = received_quantity + v_qty WHERE id = v_pol.id;
    PERFORM private.inventory_sync_stock(v_pol.ingredient_id);
    v_total := v_total + v_qty * v_cost;
  END LOOP;

  v_status := CASE WHEN EXISTS (SELECT 1 FROM public.purchase_order_lines l
                                 WHERE l.purchase_order_id = v_po.id AND l.received_quantity < l.quantity)
                   THEN 'partially_received' ELSE 'received' END;
  UPDATE public.purchase_orders
     SET status = v_status,
         received_at = CASE WHEN v_status = 'received' THEN now() ELSE received_at END
   WHERE id = v_po.id;

  RETURN jsonb_build_object(
    'purchase_order_id', v_po.id,
    'status', v_status,
    'received_lines', jsonb_array_length(p_lines),
    'total_cost', round(v_total, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.receive_purchase_order(uuid, jsonb) IS
  'Receives goods for an ordered / partially_received purchase order (admin). p_lines = [{line_id, quantity > 0, unit_cost? (default line cost), lot_code?, expires_on?}] in base units, at the order location. Writes purchase movements, updates the weighted-average ingredients.cost and received_quantity; over-receipt is P0001. Status becomes received (received_at = now()) when every line is complete, else partially_received. Returns {purchase_order_id, status, received_lines, total_cost}.';

-- ============================================
-- SECTION 6: physical counts
-- ============================================
CREATE OR REPLACE FUNCTION public.open_inventory_count(
  p_location_id    uuid DEFAULT NULL,
  p_ingredient_ids uuid[] DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'open_inventory_count';
  v_caller record;
  v_loc    uuid;
  v_count  public.inventory_counts%ROWTYPE;
  v_lines  integer;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);
  v_loc := private.inventory_location(c_fn, v_caller.restaurant_id, p_location_id);

  IF p_ingredient_ids IS NOT NULL THEN
    IF cardinality(p_ingredient_ids) = 0 THEN
      RAISE EXCEPTION '%: p_ingredient_ids must not be empty (use NULL for every active item)', c_fn
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_ingredient_ids) x(id)
                WHERE NOT EXISTS (SELECT 1 FROM public.ingredients i
                                   WHERE i.id = x.id AND i.restaurant_id = v_caller.restaurant_id)) THEN
      RAISE EXCEPTION '%: an ingredient was not found', c_fn USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.inventory_counts (restaurant_id, location_id, notes, created_by)
  VALUES (v_caller.restaurant_id, v_loc, p_notes, v_caller.profile_id)
  RETURNING * INTO v_count;

  INSERT INTO public.inventory_count_lines (restaurant_id, count_id, ingredient_id, expected_quantity)
  SELECT v_caller.restaurant_id, v_count.id, i.id,
         COALESCE((SELECT sum(l.quantity) FROM public.inventory_lots l
                    WHERE l.ingredient_id = i.id AND l.location_id = v_loc), 0)
    FROM public.ingredients i
   WHERE i.restaurant_id = v_caller.restaurant_id
     AND (CASE WHEN p_ingredient_ids IS NULL THEN i.is_active ELSE i.id = ANY (p_ingredient_ids) END);
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  RETURN jsonb_build_object(
    'count_id', v_count.id,
    'number', v_count.number,
    'location_id', v_loc,
    'status', v_count.status,
    'lines_count', v_lines
  );
END;
$$;

COMMENT ON FUNCTION public.open_inventory_count(uuid, uuid[], text) IS
  'Opens a physical count at a location (NULL = default), admin only, with one line per item (p_ingredient_ids, or every active item when NULL) carrying expected_quantity = current location balance. Admin then fills inventory_count_lines.counted_quantity. Returns {count_id, number, location_id, status, lines_count}.';

CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'apply_inventory_count';
  v_caller   record;
  v_count    public.inventory_counts%ROWTYPE;
  v_line     record;
  v_current  numeric;
  v_diff     numeric;
  v_cost     numeric;
  v_adjusted integer := 0;
  v_delta    numeric := 0;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  SELECT * INTO v_count FROM public.inventory_counts c
   WHERE c.id = p_count_id AND c.restaurant_id = v_caller.restaurant_id
   FOR UPDATE;
  IF v_count.id IS NULL THEN
    RAISE EXCEPTION '%: count % not found', c_fn, p_count_id USING ERRCODE = 'P0002';
  END IF;
  IF v_count.status <> 'open' THEN
    RAISE EXCEPTION '%: count % is %', c_fn, v_count.number, v_count.status USING ERRCODE = 'P0001';
  END IF;

  FOR v_line IN
    SELECT cl.ingredient_id, cl.counted_quantity, i.cost
      FROM public.inventory_count_lines cl
      JOIN public.ingredients i ON i.id = cl.ingredient_id
     WHERE cl.count_id = v_count.id AND cl.counted_quantity IS NOT NULL
     ORDER BY cl.ingredient_id
     FOR UPDATE OF i
  LOOP
    SELECT COALESCE(sum(l.quantity), 0) INTO v_current
      FROM public.inventory_lots l
     WHERE l.ingredient_id = v_line.ingredient_id AND l.location_id = v_count.location_id;
    v_diff := v_line.counted_quantity - v_current;
    CONTINUE WHEN v_diff = 0;

    IF v_diff > 0 THEN
      v_cost := COALESCE(v_line.cost, 0);
      PERFORM private.inventory_put(v_caller.restaurant_id, v_line.ingredient_id, v_count.location_id, v_diff,
                                    v_cost, NULL, NULL, now(), 'count_adjustment',
                                    'inventory_count', v_count.id, v_caller.profile_id, NULL, NULL);
      v_delta := v_delta + v_diff * v_cost;
    ELSE
      v_delta := v_delta - (private.inventory_take(v_caller.restaurant_id, v_line.ingredient_id, v_count.location_id,
                                                   -v_diff, 'count_adjustment', 'inventory_count', v_count.id,
                                                   v_caller.profile_id, false, NULL, NULL)->>'total_cost')::numeric;
    END IF;
    PERFORM private.inventory_sync_stock(v_line.ingredient_id);
    v_adjusted := v_adjusted + 1;
  END LOOP;

  UPDATE public.inventory_counts SET status = 'applied', applied_at = now() WHERE id = v_count.id;

  RETURN jsonb_build_object(
    'count_id', v_count.id,
    'status', 'applied',
    'adjusted_lines', v_adjusted,
    'value_delta', round(v_delta, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_inventory_count(uuid) IS
  'Applies an open count (admin): for every line with counted_quantity, writes count_adjustment movements so the location balance equals counted_quantity (surplus to the general lot at ingredients.cost, deficit FEFO). Lines left NULL are skipped. Marks the count applied (P0001 when not open). Returns {count_id, status, adjusted_lines, value_delta}.';

-- ============================================
-- SECTION 7: produce_preparation
-- ============================================
CREATE OR REPLACE FUNCTION public.produce_preparation(
  p_ingredient_id uuid,
  p_quantity      numeric,
  p_location_id   uuid DEFAULT NULL,
  p_lot_code      text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'produce_preparation';
  v_caller    record;
  v_item      public.ingredients%ROWTYPE;
  v_recipe    public.recipes%ROWTYPE;
  v_loc       uuid;
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
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'kitchen']);

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '%: p_quantity must be positive', c_fn USING ERRCODE = '22023';
  END IF;

  -- No lock yet: the preparation is locked together with its inputs below,
  -- in one id-ordered statement, so it queues behind consume_order_stock
  -- (which locks every ingredient in id order) instead of deadlocking.
  SELECT * INTO v_item FROM public.ingredients i
   WHERE i.id = p_ingredient_id AND i.restaurant_id = v_caller.restaurant_id;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '%: preparation % not found', c_fn, p_ingredient_id USING ERRCODE = 'P0002';
  END IF;
  IF v_item.kind <> 'prep' THEN
    RAISE EXCEPTION '%: % is not a preparation', c_fn, v_item.name USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_recipe FROM public.recipes r WHERE r.ingredient_id = v_item.id;
  IF v_recipe.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.recipe_ingredients ri WHERE ri.recipe_id = v_recipe.id) THEN
    RAISE EXCEPTION '%: % has no formula', c_fn, v_item.name USING ERRCODE = 'P0001';
  END IF;

  v_loc := private.inventory_location(c_fn, v_caller.restaurant_id, p_location_id);

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
    RAISE EXCEPTION '%: insufficient stock: %', c_fn,
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
    v_taken := private.inventory_take(v_caller.restaurant_id, v_req.id, v_loc, v_req.required, 'production_consume',
                                      'production_batch', v_batch, v_caller.profile_id, false, NULL, p_notes);
    v_total := v_total + (v_taken->>'total_cost')::numeric;
    v_consumed := v_consumed || jsonb_build_object(
      'ingredient_id', v_req.id, 'name', v_req.name, 'quantity', v_req.required,
      'total_cost', round((v_taken->>'total_cost')::numeric, 4));
    PERFORM private.inventory_sync_stock(v_req.id);
  END LOOP;

  v_unit := round(v_total / p_quantity, 4);
  v_expires := CASE WHEN v_item.shelf_life_days IS NOT NULL THEN current_date + v_item.shelf_life_days END;
  v_code := COALESCE(NULLIF(btrim(p_lot_code), ''), 'PB-' || to_char(now(), 'YYYYMMDD-HH24MISS'));

  PERFORM private.inventory_average_cost(v_item.id, p_quantity, v_unit);
  v_lot := private.inventory_put(v_caller.restaurant_id, v_item.id, v_loc, p_quantity, v_unit, v_code, v_expires,
                                 now(), 'production_output', 'production_batch', v_batch,
                                 v_caller.profile_id, NULL, p_notes);
  PERFORM private.inventory_sync_stock(v_item.id);

  INSERT INTO public.production_batches
    (id, restaurant_id, ingredient_id, location_id, quantity, lot_id, unit_cost, total_cost, expires_on, notes, created_by)
  VALUES (v_batch, v_caller.restaurant_id, v_item.id, v_loc, p_quantity, v_lot, v_unit, v_total, v_expires,
          p_notes, v_caller.profile_id);

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

COMMENT ON FUNCTION public.produce_preparation(uuid, numeric, uuid, text, text) IS
  'Produces p_quantity of a preparation at a location (NULL = default), admin or kitchen. Consumes each formula line x (p_quantity / yield_quantity) FEFO (production_consume), creates an output lot (p_lot_code or PB-YYYYMMDD-HH24MISS, expires_on = today + shelf_life_days) with unit_cost = consumed cost / p_quantity, updates the weighted-average cost and records a production_batches row. Insufficient stock raises P0001 naming every short item (DETAIL = jsonb shortages) and writes nothing. Returns {batch_id, lot_id, lot_code, ingredient_id, location_id, quantity, unit_cost, total_cost, expires_on, consumed:[{ingredient_id, name, quantity, total_cost}]}.';

-- ============================================
-- SECTION 8: consume_order_stock
-- ============================================
CREATE OR REPLACE FUNCTION private.inventory_control_enabled(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_config bc
     WHERE bc.restaurant_id = p_restaurant_id
       AND bc.key = 'inventory_control_enabled'
       AND lower(btrim(bc.value)) = 'true'
  )
$$;

COMMENT ON FUNCTION private.inventory_control_enabled(uuid) IS
  'business_config inventory_control_enabled = ''true'' for the restaurant (missing key = disabled).';

CREATE OR REPLACE FUNCTION public.consume_order_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
        AND oi.stock_consumed_at IS NULL)
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
      SELECT ri.ingredient_id, (ri.quantity * v_item.quantity / r.yield_quantity)::numeric(14,3) AS required
        FROM public.recipes r
        JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
       WHERE r.dish_id = v_item.dish_id
       ORDER BY ri.ingredient_id
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

COMMENT ON FUNCTION public.consume_order_stock(uuid) IS
  'Deducts the dish formulas of an order''s not-yet-consumed, non-cancelled items from the default location (admin, cashier, waiter, delivery_operator). Reads order_items server-side; each item is stamped stock_consumed_at so repeated calls are idempotent. FEFO by expires_on then received_at; a shortage drives the general lot negative and is reported. No-op when business_config inventory_control_enabled is not ''true''. Returns {order_id, enabled, consumed_items, total_cost, shortages:[{ingredient_id, name, unit, missing}]}.';

-- ============================================
-- SECTION 9: check_dishes_stock
-- ============================================
CREATE OR REPLACE FUNCTION public.check_dishes_stock(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'check_dishes_stock';
  v_caller    record;
  v_loc       uuid;
  v_item      jsonb;
  v_dish      uuid;
  v_qty       integer;
  v_shortages jsonb;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn,
    ARRAY['admin', 'cashier', 'waiter', 'kitchen', 'delivery_operator']);

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION '%: p_items must be an array of at most 100 items', c_fn USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_dish := (v_item->>'dish_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION '%: each item needs a uuid dish_id and an integer quantity', c_fn USING ERRCODE = '22023';
    END;
    IF v_dish IS NULL OR v_qty IS NULL OR v_qty NOT BETWEEN 1 AND 999 THEN
      RAISE EXCEPTION '%: each item needs dish_id and quantity 1..999', c_fn USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.dishes d WHERE d.id = v_dish AND d.restaurant_id = v_caller.restaurant_id) THEN
      RAISE EXCEPTION '%: dish % not found', c_fn, v_dish USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  IF NOT private.inventory_control_enabled(v_caller.restaurant_id) THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'shortages', '[]'::jsonb);
  END IF;

  v_loc := private.ensure_default_inventory_location(v_caller.restaurant_id);

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

COMMENT ON FUNCTION public.check_dishes_stock(jsonb) IS
  'Pre-send stock check for a cart (any tenant role). p_items = [{dish_id, quantity 1..999}] (<= 100). Aggregates the dish formulas and compares against the default-location balance (negative counts as 0). Writes nothing. Returns {ok, enabled, shortages:[{ingredient_id, name, unit, required, available, missing}]}; enabled = false (ok = true, no shortages) when inventory control is off.';

-- ============================================
-- SECTION 10: inventory_overview
-- ============================================
CREATE OR REPLACE FUNCTION public.inventory_overview(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_fn constant text := 'inventory_overview';
  v_caller record;
  v_tz     text;
  v_today  date;
  v_from   date;
  v_start  timestamptz;
  v_kpis   jsonb;
  v_series jsonb;
  v_cats   jsonb;
  v_top    jsonb;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin']);

  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION '%: p_days must be between 1 and 365', c_fn USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(r.timezone, 'America/Bogota') INTO v_tz FROM public.restaurants r WHERE r.id = v_caller.restaurant_id;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_from := v_today - (p_days - 1);
  v_start := v_from::timestamp AT TIME ZONE v_tz;

  SELECT jsonb_build_object(
    'total_value', COALESCE((SELECT round(sum(l.quantity * l.unit_cost), 2) FROM public.inventory_lots l
                              WHERE l.restaurant_id = v_caller.restaurant_id AND l.quantity > 0), 0),
    'items_count', (SELECT count(*) FROM public.ingredients i WHERE i.restaurant_id = v_caller.restaurant_id),
    'active_items', (SELECT count(*) FROM public.ingredients i WHERE i.restaurant_id = v_caller.restaurant_id AND i.is_active),
    'low_stock_count', (SELECT count(*) FROM public.ingredients i
                         WHERE i.restaurant_id = v_caller.restaurant_id AND i.is_active
                           AND i.min_stock > 0 AND i.stock > 0 AND i.stock <= i.min_stock),
    'out_of_stock_count', (SELECT count(*) FROM public.ingredients i
                            WHERE i.restaurant_id = v_caller.restaurant_id AND i.is_active AND i.stock <= 0),
    'expiring_soon_count', (SELECT count(*) FROM public.inventory_lots l
                             WHERE l.restaurant_id = v_caller.restaurant_id AND l.quantity > 0
                               AND l.expires_on BETWEEN v_today AND v_today + 7),
    'expired_count', (SELECT count(*) FROM public.inventory_lots l
                       WHERE l.restaurant_id = v_caller.restaurant_id AND l.quantity > 0 AND l.expires_on < v_today),
    'waste_value', COALESCE((SELECT round(-sum(m.total_cost), 2) FROM public.inventory_movements m
                              WHERE m.restaurant_id = v_caller.restaurant_id AND m.created_at >= v_start
                                AND m.movement_type = 'waste'), 0),
    'purchases_value', COALESCE((SELECT round(sum(m.total_cost), 2) FROM public.inventory_movements m
                                  WHERE m.restaurant_id = v_caller.restaurant_id AND m.created_at >= v_start
                                    AND m.movement_type = 'purchase'), 0),
    'consumption_value', COALESCE((SELECT round(-sum(m.total_cost), 2) FROM public.inventory_movements m
                                    WHERE m.restaurant_id = v_caller.restaurant_id AND m.created_at >= v_start
                                      AND m.movement_type IN ('sale', 'production_consume')), 0),
    'open_purchase_orders', (SELECT count(*) FROM public.purchase_orders po
                              WHERE po.restaurant_id = v_caller.restaurant_id
                                AND po.status IN ('ordered', 'partially_received'))
  ) INTO v_kpis;

  SELECT jsonb_agg(jsonb_build_object(
           'date', d.day,
           'in_value', COALESCE(s.in_value, 0),
           'out_value', COALESCE(s.out_value, 0),
           'waste_value', COALESCE(s.waste_value, 0)) ORDER BY d.day)
    INTO v_series
    FROM generate_series(v_from, v_today, interval '1 day') AS g(ts)
    CROSS JOIN LATERAL (SELECT g.ts::date AS day) d
    LEFT JOIN (
      SELECT (m.created_at AT TIME ZONE v_tz)::date AS day,
             round(sum(m.total_cost) FILTER (WHERE m.quantity > 0
                   AND m.movement_type NOT IN ('transfer_in')), 2) AS in_value,
             round(-sum(m.total_cost) FILTER (WHERE m.movement_type IN ('sale', 'production_consume')), 2) AS out_value,
             round(-sum(m.total_cost) FILTER (WHERE m.movement_type = 'waste'), 2) AS waste_value
        FROM public.inventory_movements m
       WHERE m.restaurant_id = v_caller.restaurant_id AND m.created_at >= v_start
       GROUP BY 1
    ) s ON s.day = d.day;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category_id', c.category_id, 'category_name', c.category_name, 'value', c.value)
           ORDER BY c.value DESC), '[]'::jsonb)
    INTO v_cats
    FROM (
      SELECT i.category_id, COALESCE(ic.name, 'Sin categoría') AS category_name,
             round(sum(l.quantity * l.unit_cost), 2) AS value
        FROM public.inventory_lots l
        JOIN public.ingredients i ON i.id = l.ingredient_id
        LEFT JOIN public.ingredient_categories ic ON ic.id = i.category_id
       WHERE l.restaurant_id = v_caller.restaurant_id AND l.quantity > 0
       GROUP BY i.category_id, ic.name
    ) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', t.ingredient_id, 'name', t.name, 'unit', t.unit,
           'quantity', t.quantity, 'value', t.value) ORDER BY t.value DESC, t.name), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT i.id AS ingredient_id, i.name, i.unit,
             -sum(m.quantity) AS quantity, round(-sum(m.total_cost), 2) AS value
        FROM public.inventory_movements m
        JOIN public.ingredients i ON i.id = m.ingredient_id
       WHERE m.restaurant_id = v_caller.restaurant_id AND m.created_at >= v_start
         AND m.movement_type IN ('sale', 'production_consume')
       GROUP BY i.id, i.name, i.unit
       ORDER BY 5 DESC, i.name
       LIMIT 10
    ) t;

  RETURN jsonb_build_object(
    'days', p_days,
    'generated_at', now(),
    'kpis', v_kpis,
    'series', v_series,
    'value_by_category', v_cats,
    'top_consumed', v_top
  );
END;
$$;

COMMENT ON FUNCTION public.inventory_overview(integer) IS
  'Inventory dashboard data for the last p_days (1..365) in the restaurant timezone, admin only. Returns {days, generated_at, kpis:{total_value, items_count, active_items, low_stock_count, out_of_stock_count, expiring_soon_count (positive lots expiring within 7 days), expired_count, waste_value, purchases_value, consumption_value (sale + production_consume), open_purchase_orders}, series:[{date, in_value, out_value, waste_value}] one point per day, value_by_category:[{category_id, category_name, value}], top_consumed:[{ingredient_id, name, unit, quantity, value}] (top 10 by value)}. Values are cost amounts (quantity x unit_cost).';

-- ============================================
-- SECTION 11: privileges
-- ============================================
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.inventory_adjust(uuid, uuid, text, numeric, numeric, text, text, uuid, text, date)',
    'public.inventory_transfer(uuid, uuid, uuid, numeric, text)',
    'public.save_formula(text, uuid, numeric, jsonb, text)',
    'public.receive_purchase_order(uuid, jsonb)',
    'public.open_inventory_count(uuid, uuid[], text)',
    'public.apply_inventory_count(uuid)',
    'public.produce_preparation(uuid, numeric, uuid, text, text)',
    'public.consume_order_stock(uuid)',
    'public.check_dishes_stock(jsonb)',
    'public.inventory_overview(integer)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'private.inventory_caller(text, text[])',
    'private.inventory_location(text, uuid, uuid)',
    'private.inventory_sync_stock(uuid)',
    'private.inventory_average_cost(uuid, numeric, numeric)',
    'private.inventory_put(uuid, uuid, uuid, numeric, numeric, text, date, timestamptz, text, text, uuid, uuid, text, text)',
    'private.inventory_take(uuid, uuid, uuid, numeric, text, text, uuid, uuid, boolean, text, text)',
    'private.inventory_control_enabled(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
