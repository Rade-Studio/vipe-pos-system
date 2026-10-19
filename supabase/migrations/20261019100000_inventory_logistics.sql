-- ============================================
-- Inventory logistics and formulas schema
-- ============================================
-- odd/tasks/admin-dashboard-inventario.md, T4 (S3, S5). The RPCs that write
-- stock land in 20261019110000_inventory_rpcs.sql; this migration is the
-- schema, the per-table RLS and the backfill.
--
-- public.ingredients stays the inventory item table:
--   sku            unique per restaurant, ^[A-Z0-9][A-Z0-9-]{1,31}$, trimmed
--                  and uppercased; NULL/blank on insert generates MP-0001
--                  (raw) / PR-0001 (prep) from a row-locked per-restaurant
--                  counter (private.inventory_counters).
--   kind           raw | prep (a preparation produced in batches from its own
--                  formula). A prep that has a formula cannot become raw.
--   barcode, max_stock, purchase_unit + purchase_factor (1 purchase unit =
--                  factor base units), default_supplier_id, track_lots,
--                  shelf_life_days, is_active.
--   stock/min_stock numeric(14,3), cost numeric(14,4). stock is the total
--                  across locations and the inventory RPCs keep it equal to
--                  sum(inventory_lots.quantity).
--
-- New tables (all tenant scoped, restaurant_id DEFAULT
-- private.default_restaurant_id()):
--   inventory_locations   one is_default per restaurant ("Bodega principal",
--                         seeded for every restaurant and on insert).
--   suppliers
--   inventory_lots        one general lot (lot_code NULL, expires_on NULL)
--                         per item + location; only it may go negative.
--   inventory_movements   signed ledger, RPC-written only.
--   purchase_orders(+lines), inventory_counts(+lines), production_batches.
--
-- recipes: dish_id nullable, ingredient_id (prep output, unique),
-- yield_quantity, notes; exactly one target; the output must be a prep;
-- recipe_ingredients rejects self-reference and cycles (22023).
--
-- order_items.stock_consumed_at: idempotent sale consumption.
--
-- RLS (role matrix):
--   inventory_locations        read tenant, write admin.
--   suppliers, purchase_orders(+lines), inventory_counts(+lines),
--   inventory_movements        admin only (movements read only).
--   inventory_lots, production_batches  read admin + kitchen, no write.
--   ingredients, recipes, recipe_ingredients  read tenant, write admin.
--
-- Direct writes outside the RPCs are limited by SECURITY INVOKER guard
-- triggers that let through only current_user postgres / service_role /
-- supabase_admin (the RPCs run as postgres): ingredients.stock / cost
-- (42501), recipes / recipe_ingredients (42501, save_formula only), purchase
-- order receipt statuses and received_quantity, count application and
-- expected_quantity. One default location always exists (moving the flag
-- clears the previous one; clearing the only default is P0001).
--
-- Backfill: SKUs for existing items, a default location per restaurant, and a
-- general lot + one opening movement for every item with stock <> 0. The
-- legacy ingredient_transactions(_orders) tables are left untouched.
-- ============================================

-- ============================================
-- SECTION 1: per-restaurant counters
-- ============================================
CREATE TABLE IF NOT EXISTS private.inventory_counters (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  counter       text NOT NULL,
  value         bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, counter)
);

COMMENT ON TABLE private.inventory_counters IS
  'Per-restaurant sequences for SKUs (sku_raw, sku_prep), purchase order numbers (purchase_order) and count numbers (inventory_count). Bumped by private.next_inventory_counter only.';

-- The upsert takes the row lock, so two concurrent callers get distinct
-- values and a rolled-back caller never leaves a gap visible to others.
CREATE OR REPLACE FUNCTION private.next_inventory_counter(p_restaurant_id uuid, p_counter text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO private.inventory_counters AS c (restaurant_id, counter, value)
  VALUES (p_restaurant_id, p_counter, 1)
  ON CONFLICT (restaurant_id, counter) DO UPDATE SET value = c.value + 1
  RETURNING c.value
$$;

COMMENT ON FUNCTION private.next_inventory_counter(uuid, text) IS
  'Returns the next value of a per-restaurant counter (1-based), row-locked through the upsert.';

-- ============================================
-- SECTION 2: suppliers
-- ============================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL DEFAULT private.default_restaurant_id()
                 REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name           text NOT NULL CONSTRAINT suppliers_name_check
                 CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  tax_id         text CONSTRAINT suppliers_tax_id_check CHECK (tax_id IS NULL OR length(tax_id) <= 30),
  contact_name   text CONSTRAINT suppliers_contact_name_check CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  phone          text CONSTRAINT suppliers_phone_check CHECK (phone IS NULL OR length(phone) <= 30),
  email          text CONSTRAINT suppliers_email_check CHECK (email IS NULL OR length(email) <= 160),
  lead_time_days integer CONSTRAINT suppliers_lead_time_days_check
                 CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
  notes          text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_restaurant_id_is_active
  ON public.suppliers USING btree (restaurant_id, is_active);

COMMENT ON TABLE public.suppliers IS
  'Per-tenant supplier registry. Admin only (read and write); soft delete through is_active.';

-- ============================================
-- SECTION 3: inventory_locations
-- ============================================
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name          text NOT NULL CONSTRAINT inventory_locations_name_check
                CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  code          text NOT NULL CONSTRAINT inventory_locations_code_check
                CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_locations_restaurant_id_code_key UNIQUE (restaurant_id, code),
  CONSTRAINT inventory_locations_default_active_check CHECK (NOT is_default OR is_active)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_locations_one_default
  ON public.inventory_locations (restaurant_id)
  WHERE is_default;

COMMENT ON TABLE public.inventory_locations IS
  'Warehouses / storage locations. Exactly one is_default per restaurant ("Bodega principal", seeded on restaurant insert); the default cannot be inactive. Read by the tenant, written by admin.';

-- Exactly one default per restaurant at all times: marking another location
-- default moves the flag (the old default is cleared first, before the
-- partial unique index sees two); clearing the only default is refused.
CREATE OR REPLACE FUNCTION public.inventory_locations_default_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF OLD.is_default AND NOT NEW.is_default THEN
    RAISE EXCEPTION 'location % is the default; mark another location as default instead', OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.is_default AND NOT OLD.is_default THEN
    UPDATE public.inventory_locations
       SET is_default = false
     WHERE restaurant_id = NEW.restaurant_id AND is_default AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.inventory_locations_default_guard() IS
  'BEFORE UPDATE OF is_default on public.inventory_locations: setting is_default moves the default from the previous one; clearing the only default raises P0001.';

DROP TRIGGER IF EXISTS inventory_locations_default_guard ON public.inventory_locations;
CREATE TRIGGER inventory_locations_default_guard
  BEFORE UPDATE OF is_default ON public.inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_locations_default_guard();

CREATE OR REPLACE FUNCTION private.ensure_default_inventory_location(p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT l.id INTO v_id
    FROM public.inventory_locations l
   WHERE l.restaurant_id = p_restaurant_id AND l.is_default;

  IF v_id IS NULL THEN
    INSERT INTO public.inventory_locations (restaurant_id, name, code, is_default)
    VALUES (p_restaurant_id, 'Bodega principal',
            CASE WHEN EXISTS (SELECT 1 FROM public.inventory_locations l
                               WHERE l.restaurant_id = p_restaurant_id AND l.code = 'PRINCIPAL')
                 THEN 'PRINCIPAL-' || upper(substr(gen_random_uuid()::text, 1, 6))
                 ELSE 'PRINCIPAL' END,
            true)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION private.ensure_default_inventory_location(uuid) IS
  'Returns the default location of a restaurant, creating "Bodega principal" (code PRINCIPAL) when none exists.';

CREATE OR REPLACE FUNCTION public.seed_inventory_location_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.ensure_default_inventory_location(NEW.id);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_inventory_location_default() IS
  'AFTER INSERT on public.restaurants: creates the default inventory location of the new tenant.';

DROP TRIGGER IF EXISTS restaurants_seed_inventory_location ON public.restaurants;
CREATE TRIGGER restaurants_seed_inventory_location
  AFTER INSERT ON public.restaurants
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_inventory_location_default();

SELECT private.ensure_default_inventory_location(r.id) FROM public.restaurants r;

-- ============================================
-- SECTION 4: ingredients as inventory items
-- ============================================
ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS sku                 text,
  ADD COLUMN IF NOT EXISTS kind                text NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS barcode             text,
  ADD COLUMN IF NOT EXISTS max_stock           numeric(14,3),
  ADD COLUMN IF NOT EXISTS purchase_unit       varchar(20),
  ADD COLUMN IF NOT EXISTS purchase_factor     numeric(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_supplier_id uuid,
  ADD COLUMN IF NOT EXISTS track_lots          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shelf_life_days     integer,
  ADD COLUMN IF NOT EXISTS is_active           boolean NOT NULL DEFAULT true;

ALTER TABLE public.ingredients
  ALTER COLUMN stock TYPE numeric(14,3),
  ALTER COLUMN min_stock TYPE numeric(14,3),
  ALTER COLUMN cost TYPE numeric(14,4);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_kind_check') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_kind_check CHECK (kind IN ('raw', 'prep'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_purchase_factor_check') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_purchase_factor_check CHECK (purchase_factor > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_shelf_life_days_check') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_shelf_life_days_check
      CHECK (shelf_life_days IS NULL OR shelf_life_days BETWEEN 1 AND 3650);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_max_stock_check') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_max_stock_check CHECK (max_stock IS NULL OR max_stock >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_default_supplier_id_fkey') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_default_supplier_id_fkey
      FOREIGN KEY (default_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- SKU normalisation / generation and the prep -> raw guard. SECURITY DEFINER
-- so the counter and the recipes lookup work for every caller.
CREATE OR REPLACE FUNCTION public.ingredients_inventory_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix    text;
  v_n         bigint;
  v_candidate text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.kind = 'prep' AND NEW.kind <> 'prep'
     AND EXISTS (SELECT 1 FROM public.recipes r WHERE r.ingredient_id = NEW.id) THEN
    RAISE EXCEPTION 'ingredient % has a formula and must stay a preparation', NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  NEW.sku := NULLIF(upper(btrim(NEW.sku)), '');

  IF NEW.sku IS NULL THEN
    v_prefix := CASE WHEN NEW.kind = 'prep' THEN 'PR-' ELSE 'MP-' END;
    LOOP
      v_n := private.next_inventory_counter(NEW.restaurant_id, 'sku_' || NEW.kind);
      v_candidate := v_prefix || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.ingredients i
         WHERE i.restaurant_id = NEW.restaurant_id AND i.sku = v_candidate AND i.id <> NEW.id
      );
    END LOOP;
    NEW.sku := v_candidate;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ingredients_inventory_guard() IS
  'BEFORE INSERT / UPDATE OF sku, kind on public.ingredients: trims and uppercases the SKU, generates MP-0001 / PR-0001 per restaurant when it is blank, and refuses (P0001) turning a preparation with a formula into a raw item.';

DROP TRIGGER IF EXISTS ingredients_inventory_guard ON public.ingredients;
CREATE TRIGGER ingredients_inventory_guard
  BEFORE INSERT OR UPDATE OF sku, kind ON public.ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.ingredients_inventory_guard();

-- Backfill SKUs in creation order so MP-0001 is the oldest item.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT i.id FROM public.ingredients i
     WHERE i.sku IS NULL
     ORDER BY i.restaurant_id, i.created_at NULLS FIRST, i.id
  LOOP
    UPDATE public.ingredients SET sku = NULL WHERE id = v_id;
  END LOOP;
END $$;

-- DEFAULT '' keeps sku optional for clients: the guard turns blank into a
-- generated SKU before the CHECK runs.
ALTER TABLE public.ingredients ALTER COLUMN sku SET NOT NULL;
ALTER TABLE public.ingredients ALTER COLUMN sku SET DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_sku_check') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_sku_check CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.ingredients'::regclass AND conname = 'ingredients_restaurant_id_sku_key') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_restaurant_id_sku_key UNIQUE (restaurant_id, sku);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ingredients_stock_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.stock <> 0 THEN
    RAISE EXCEPTION 'ingredients.stock starts at 0; load stock through inventory_adjust (opening)'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.stock IS DISTINCT FROM OLD.stock OR NEW.cost IS DISTINCT FROM OLD.cost) THEN
    RAISE EXCEPTION 'ingredients.stock and cost are written only by the inventory RPCs'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ingredients_stock_guard() IS
  'SECURITY INVOKER BEFORE INSERT / UPDATE OF stock, cost on public.ingredients: outside the inventory RPCs (current_user not postgres/service_role/supabase_admin) a new item must have stock 0 (cost may be set once as the initial reference cost) and stock / cost never change (42501).';

DROP TRIGGER IF EXISTS ingredients_stock_guard ON public.ingredients;
CREATE TRIGGER ingredients_stock_guard
  BEFORE INSERT OR UPDATE OF stock, cost ON public.ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.ingredients_stock_guard();

DROP TRIGGER IF EXISTS ingredients_set_updated_at ON public.ingredients;
CREATE TRIGGER ingredients_set_updated_at
  BEFORE UPDATE ON public.ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN public.ingredients.stock IS
  'Total stock across locations in base units. Maintained by the inventory RPCs as sum(inventory_lots.quantity).';
COMMENT ON COLUMN public.ingredients.purchase_factor IS
  '1 purchase_unit = purchase_factor base units (unit).';
COMMENT ON COLUMN public.ingredients.kind IS
  'raw (bought) or prep (produced in batches from its formula in public.recipes.ingredient_id).';

-- ============================================
-- SECTION 5: inventory_lots
-- ============================================
CREATE TABLE IF NOT EXISTS public.inventory_lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  lot_code      text CONSTRAINT inventory_lots_lot_code_check
                CHECK (lot_code IS NULL OR length(btrim(lot_code)) BETWEEN 1 AND 60),
  expires_on    date,
  quantity      numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost     numeric(14,4) NOT NULL DEFAULT 0 CONSTRAINT inventory_lots_unit_cost_check CHECK (unit_cost >= 0),
  received_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_lots_quantity_check
    CHECK (quantity >= 0 OR (lot_code IS NULL AND expires_on IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_lots_general
  ON public.inventory_lots (ingredient_id, location_id)
  WHERE lot_code IS NULL AND expires_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo
  ON public.inventory_lots (ingredient_id, location_id, expires_on, received_at);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_restaurant_id
  ON public.inventory_lots (restaurant_id);

COMMENT ON TABLE public.inventory_lots IS
  'Stock per item, location and lot. The general lot (lot_code NULL, expires_on NULL) is unique per item + location and is the only one allowed to go negative (sale shortage). Read by admin and kitchen; written only by the inventory RPCs.';

DROP TRIGGER IF EXISTS inventory_lots_set_updated_at ON public.inventory_lots;
CREATE TRIGGER inventory_lots_set_updated_at
  BEFORE UPDATE ON public.inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- SECTION 6: inventory_movements
-- ============================================
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL DEFAULT private.default_restaurant_id()
                 REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  location_id    uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  lot_id         uuid REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  movement_type  text NOT NULL CONSTRAINT inventory_movements_movement_type_check
                 CHECK (movement_type IN ('opening', 'purchase', 'sale', 'production_consume',
                                          'production_output', 'adjustment', 'waste',
                                          'transfer_out', 'transfer_in', 'count_adjustment')),
  quantity       numeric(14,3) NOT NULL CONSTRAINT inventory_movements_quantity_check CHECK (quantity <> 0),
  unit_cost      numeric(14,4) NOT NULL DEFAULT 0,
  total_cost     numeric(18,4) NOT NULL DEFAULT 0,
  reason         text CONSTRAINT inventory_movements_reason_check CHECK (reason IS NULL OR length(reason) <= 200),
  notes          text,
  reference_type text,
  reference_id   uuid,
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_restaurant_id_created_at
  ON public.inventory_movements (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ingredient_id_created_at
  ON public.inventory_movements (ingredient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
  ON public.inventory_movements (reference_type, reference_id);

COMMENT ON TABLE public.inventory_movements IS
  'Signed stock ledger (positive in, negative out); total_cost = quantity * unit_cost. reference_type is one of purchase_order, production_batch, order_item, transfer, inventory_count or NULL. Admin read only; written only by the inventory RPCs.';

-- ============================================
-- SECTION 7: purchase orders
-- ============================================
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL DEFAULT private.default_restaurant_id()
                 REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  number         integer NOT NULL,
  supplier_id    uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  location_id    uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'draft' CONSTRAINT purchase_orders_status_check
                 CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
  expected_on    date,
  payment_status text NOT NULL DEFAULT 'pending' CONSTRAINT purchase_orders_payment_status_check
                 CHECK (payment_status IN ('pending', 'paid')),
  notes          text,
  ordered_at     timestamptz,
  received_at    timestamptz,
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_restaurant_id_number_key UNIQUE (restaurant_id, number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_restaurant_id_status
  ON public.purchase_orders (restaurant_id, status);

COMMENT ON TABLE public.purchase_orders IS
  'Purchase orders, numbered per restaurant. Admin only. draft -> ordered -> partially_received -> received (the last two only through receive_purchase_order); draft | ordered -> cancelled.';

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL DEFAULT private.default_restaurant_id()
                    REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  ingredient_id     uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  quantity          numeric(14,3) NOT NULL CONSTRAINT purchase_order_lines_quantity_check CHECK (quantity > 0),
  unit_cost         numeric(14,4) NOT NULL DEFAULT 0 CONSTRAINT purchase_order_lines_unit_cost_check CHECK (unit_cost >= 0),
  received_quantity numeric(14,3) NOT NULL DEFAULT 0
                    CONSTRAINT purchase_order_lines_received_quantity_check CHECK (received_quantity >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_lines_order_ingredient_key UNIQUE (purchase_order_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_restaurant_id
  ON public.purchase_order_lines (restaurant_id);

COMMENT ON TABLE public.purchase_order_lines IS
  'Purchase order lines; quantity and unit_cost in base units. received_quantity is written only by receive_purchase_order. Admin only; editable while the order is draft or ordered.';

-- ============================================
-- SECTION 8: physical counts
-- ============================================
CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  number        integer NOT NULL,
  location_id   uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'open' CONSTRAINT inventory_counts_status_check
                CHECK (status IN ('open', 'applied', 'cancelled')),
  notes         text,
  applied_at    timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_counts_restaurant_id_number_key UNIQUE (restaurant_id, number)
);

COMMENT ON TABLE public.inventory_counts IS
  'Physical counts per location, numbered per restaurant. Created by open_inventory_count, applied by apply_inventory_count; admin may edit notes or cancel an open count.';

CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL DEFAULT private.default_restaurant_id()
                    REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  count_id          uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  ingredient_id     uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  expected_quantity numeric(14,3) NOT NULL DEFAULT 0,
  counted_quantity  numeric(14,3) CONSTRAINT inventory_count_lines_counted_quantity_check
                    CHECK (counted_quantity IS NULL OR counted_quantity >= 0),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_count_lines_count_ingredient_key UNIQUE (count_id, ingredient_id)
);

COMMENT ON TABLE public.inventory_count_lines IS
  'Count lines: expected_quantity is the location balance snapshot at open time; admin fills counted_quantity (NULL = not counted, skipped on apply) while the count is open.';

-- ============================================
-- SECTION 9: production batches
-- ============================================
CREATE TABLE IF NOT EXISTS public.production_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  quantity      numeric(14,3) NOT NULL CONSTRAINT production_batches_quantity_check CHECK (quantity > 0),
  lot_id        uuid REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  unit_cost     numeric(14,4) NOT NULL DEFAULT 0,
  total_cost    numeric(18,4) NOT NULL DEFAULT 0,
  expires_on    date,
  notes         text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_batches_restaurant_id_created_at
  ON public.production_batches (restaurant_id, created_at DESC);

COMMENT ON TABLE public.production_batches IS
  'One row per produce_preparation call: output quantity, the lot it created and its computed unit cost. Read by admin and kitchen; written only by the RPC.';

-- ============================================
-- SECTION 10: numbering and write guards
-- ============================================
-- Direct-write mechanism (verifier B1/B2/B3): the guards below are SECURITY
-- INVOKER, so current_user is the caller's role. A Data API client is always
-- `authenticated`; the inventory RPCs are SECURITY DEFINER owned by postgres,
-- so inside them current_user = 'postgres'. A client cannot become postgres,
-- so "current_user IN (postgres, service_role, supabase_admin)" identifies
-- RPC / server writes and cannot be satisfied by a direct client write.
-- Numbering needs the private counter, so it lives in its own SECURITY
-- DEFINER trigger (public.inventory_documents_number).
CREATE OR REPLACE FUNCTION public.inventory_documents_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.number IS NULL THEN
    NEW.number := private.next_inventory_counter(NEW.restaurant_id,
      CASE TG_TABLE_NAME WHEN 'purchase_orders' THEN 'purchase_order' ELSE 'inventory_count' END);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.inventory_documents_number() IS
  'BEFORE INSERT on purchase_orders / inventory_counts: assigns the next per-restaurant number when it is NULL.';

DROP TRIGGER IF EXISTS purchase_orders_number ON public.purchase_orders;
CREATE TRIGGER purchase_orders_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_number();
DROP TRIGGER IF EXISTS inventory_counts_number ON public.inventory_counts;
CREATE TRIGGER inventory_counts_number
  BEFORE INSERT ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_number();

CREATE OR REPLACE FUNCTION public.inventory_documents_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rpc     boolean := current_user IN ('postgres', 'service_role', 'supabase_admin');
  v_status  text;
  v_rid     uuid;
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NOT v_rpc AND NEW.status NOT IN ('draft', 'ordered') THEN
        RAISE EXCEPTION 'purchase orders start as draft or ordered' USING ERRCODE = 'P0001';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.number <> OLD.number THEN
        RAISE EXCEPTION 'purchase order numbers are immutable' USING ERRCODE = 'P0001';
      END IF;
      IF NOT v_rpc AND NEW.status IS DISTINCT FROM OLD.status
         AND NOT (OLD.status = 'draft' AND NEW.status IN ('ordered', 'cancelled'))
         AND NOT (OLD.status = 'ordered' AND NEW.status IN ('draft', 'cancelled')) THEN
        RAISE EXCEPTION 'purchase order cannot move from % to % (receipts go through receive_purchase_order)',
          OLD.status, NEW.status USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status = 'ordered' AND OLD.status <> 'ordered' AND NEW.ordered_at IS NULL THEN
        NEW.ordered_at := now();
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF NOT v_rpc AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'only draft purchase orders can be deleted' USING ERRCODE = 'P0001';
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      IF NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = NEW.supplier_id AND s.restaurant_id = NEW.restaurant_id)
         OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = NEW.location_id AND l.restaurant_id = NEW.restaurant_id) THEN
        RAISE EXCEPTION 'supplier and location must belong to the purchase order restaurant' USING ERRCODE = 'P0002';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'purchase_order_lines' THEN
    SELECT po.status, po.restaurant_id INTO v_status, v_rid
      FROM public.purchase_orders po
     WHERE po.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.purchase_order_id ELSE NEW.purchase_order_id END;

    IF NOT v_rpc AND v_status NOT IN ('draft', 'ordered') THEN
      RAISE EXCEPTION 'purchase order lines can only change while the order is draft or ordered'
        USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF NOT v_rpc AND NEW.received_quantity IS DISTINCT FROM
       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.received_quantity ELSE 0 END) THEN
      RAISE EXCEPTION 'received_quantity is written by receive_purchase_order only' USING ERRCODE = '42501';
    END IF;
    -- The line always follows its order's tenant; RLS WITH CHECK then refuses
    -- a line that points at another tenant's order.
    NEW.restaurant_id := COALESCE(v_rid, NEW.restaurant_id);
    IF NOT EXISTS (SELECT 1 FROM public.ingredients i WHERE i.id = NEW.ingredient_id AND i.restaurant_id = NEW.restaurant_id) THEN
      RAISE EXCEPTION 'ingredient % not found', NEW.ingredient_id USING ERRCODE = 'P0002';
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'inventory_counts' THEN
    IF TG_OP = 'UPDATE' AND NOT v_rpc THEN
      IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'count % is %', OLD.number, OLD.status USING ERRCODE = 'P0001';
      END IF;
      IF NEW.status NOT IN ('open', 'cancelled') THEN
        RAISE EXCEPTION 'counts are applied through apply_inventory_count' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.number <> OLD.number
         OR NEW.location_id <> OLD.location_id OR NEW.applied_at IS DISTINCT FROM OLD.applied_at THEN
        RAISE EXCEPTION 'counts are applied through apply_inventory_count' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_TABLE_NAME = 'inventory_count_lines' THEN
    IF NOT v_rpc THEN
      SELECT c.status INTO v_status FROM public.inventory_counts c WHERE c.id = OLD.count_id;
      IF v_status <> 'open' THEN
        RAISE EXCEPTION 'count lines can only change while the count is open' USING ERRCODE = 'P0001';
      END IF;
      IF NEW.count_id <> OLD.count_id OR NEW.ingredient_id <> OLD.ingredient_id
         OR NEW.expected_quantity <> OLD.expected_quantity OR NEW.restaurant_id <> OLD.restaurant_id THEN
        RAISE EXCEPTION 'only counted_quantity and notes are editable' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.inventory_documents_before_write() IS
  'SECURITY INVOKER BEFORE trigger for purchase_orders, purchase_order_lines, inventory_counts and inventory_count_lines. Direct (non-RPC, i.e. current_user not postgres/service_role/supabase_admin) writes: purchase orders only draft <-> ordered -> cancelled, received/partially_received only via receive_purchase_order (P0001); received_quantity only via the RPC (42501); counts only open -> cancelled, applied only via apply_inventory_count (P0001); count lines only counted_quantity / notes (42501). Keeps lines in their parent tenant.';

DROP TRIGGER IF EXISTS purchase_orders_before_write ON public.purchase_orders;
CREATE TRIGGER purchase_orders_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_before_write();
DROP TRIGGER IF EXISTS purchase_order_lines_before_write ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_before_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_before_write();
DROP TRIGGER IF EXISTS inventory_counts_before_write ON public.inventory_counts;
CREATE TRIGGER inventory_counts_before_write
  BEFORE INSERT OR UPDATE ON public.inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_before_write();
DROP TRIGGER IF EXISTS inventory_count_lines_before_write ON public.inventory_count_lines;
CREATE TRIGGER inventory_count_lines_before_write
  BEFORE UPDATE ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION public.inventory_documents_before_write();

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['suppliers', 'inventory_locations', 'purchase_orders',
                             'purchase_order_lines', 'inventory_counts', 'inventory_count_lines']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', tbl || '_set_updated_at', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
                   tbl || '_set_updated_at', tbl);
  END LOOP;
END $$;

-- ============================================
-- SECTION 11: formulas (recipes)
-- ============================================
ALTER TABLE public.recipes ALTER COLUMN dish_id DROP NOT NULL;
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS ingredient_id  uuid,
  ADD COLUMN IF NOT EXISTS yield_quantity numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS notes          text,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.recipe_ingredients ALTER COLUMN quantity TYPE numeric(14,4);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.recipes'::regclass AND conname = 'recipes_ingredient_id_fkey') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_ingredient_id_fkey
      FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.recipes'::regclass AND conname = 'recipes_ingredient_id_key') THEN
    ALTER TABLE public.recipes ADD CONSTRAINT recipes_ingredient_id_key UNIQUE (ingredient_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.recipes'::regclass AND conname = 'recipes_target_check') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_target_check CHECK (num_nonnulls(dish_id, ingredient_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.recipes'::regclass AND conname = 'recipes_yield_quantity_check') THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_yield_quantity_check CHECK (yield_quantity > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.recipes.ingredient_id IS
  'Preparation produced by this formula (kind = prep). Exactly one of dish_id / ingredient_id is set.';
COMMENT ON COLUMN public.recipes.yield_quantity IS
  'Output quantity (in the target unit) the listed lines produce; 1 portion for dishes.';

DROP TRIGGER IF EXISTS recipes_set_updated_at ON public.recipes;
CREATE TRIGGER recipes_set_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.recipes_target_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_rid  uuid;
BEGIN
  IF NEW.ingredient_id IS NOT NULL THEN
    SELECT i.kind, i.restaurant_id INTO v_kind, v_rid
      FROM public.ingredients i WHERE i.id = NEW.ingredient_id;
    IF v_rid IS DISTINCT FROM NEW.restaurant_id THEN
      RAISE EXCEPTION 'formula output % not found', NEW.ingredient_id USING ERRCODE = 'P0002';
    END IF;
    IF v_kind <> 'prep' THEN
      RAISE EXCEPTION 'formula output must be a preparation' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.dish_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.dishes d WHERE d.id = NEW.dish_id AND d.restaurant_id = NEW.restaurant_id) THEN
    RAISE EXCEPTION 'dish % not found', NEW.dish_id USING ERRCODE = 'P0002';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.recipes_target_guard() IS
  'BEFORE INSERT / UPDATE on public.recipes: the target dish or preparation must belong to the recipe restaurant (P0002) and a preparation target must have kind = prep (22023).';

CREATE OR REPLACE FUNCTION public.formulas_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION '% is written only through save_formula', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.formulas_rpc_only() IS
  'SECURITY INVOKER BEFORE INSERT / UPDATE / DELETE on recipes and recipe_ingredients: direct client writes raise 42501; formulas change only through save_formula (and FK cascades, which run as the table owner).';

DROP TRIGGER IF EXISTS recipes_rpc_only ON public.recipes;
CREATE TRIGGER recipes_rpc_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.formulas_rpc_only();
DROP TRIGGER IF EXISTS recipe_ingredients_rpc_only ON public.recipe_ingredients;
CREATE TRIGGER recipe_ingredients_rpc_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.formulas_rpc_only();

DROP TRIGGER IF EXISTS recipes_target_guard ON public.recipes;
CREATE TRIGGER recipes_target_guard
  BEFORE INSERT OR UPDATE OF dish_id, ingredient_id, restaurant_id ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.recipes_target_guard();

-- Self-reference and cycle guard. A prep formula reaches a cycle when, walking
-- from the new line's ingredient through the formulas of the preparations it
-- uses, the walk comes back to the formula's own output.
CREATE OR REPLACE FUNCTION public.recipe_ingredients_cycle_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_output uuid;
  v_rid    uuid;
BEGIN
  SELECT r.ingredient_id, r.restaurant_id INTO v_output, v_rid
    FROM public.recipes r WHERE r.id = NEW.recipe_id;

  IF v_rid IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION 'recipe % not found', NEW.recipe_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ingredients i
                  WHERE i.id = NEW.ingredient_id AND i.restaurant_id = v_rid) THEN
    RAISE EXCEPTION 'ingredient % not found', NEW.ingredient_id USING ERRCODE = 'P0002';
  END IF;

  IF v_output IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ingredient_id = v_output THEN
    RAISE EXCEPTION 'a preparation cannot use itself' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH RECURSIVE reach(ingredient_id) AS (
      SELECT NEW.ingredient_id
      UNION
      SELECT ri.ingredient_id
        FROM reach
        JOIN public.recipes r ON r.ingredient_id = reach.ingredient_id
        JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
    )
    SELECT 1 FROM reach WHERE reach.ingredient_id = v_output
  ) THEN
    RAISE EXCEPTION 'formula cycle: % already uses this preparation', NEW.ingredient_id
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.recipe_ingredients_cycle_guard() IS
  'AFTER INSERT / UPDATE on public.recipe_ingredients: the recipe and the line ingredient must belong to the line restaurant_id (P0002); the line ingredient must belong to the recipe restaurant (P0002); a preparation formula may not use itself or any preparation that (transitively) uses it (22023).';

DROP TRIGGER IF EXISTS recipe_ingredients_cycle_guard ON public.recipe_ingredients;
CREATE TRIGGER recipe_ingredients_cycle_guard
  AFTER INSERT OR UPDATE OF ingredient_id, recipe_id, restaurant_id ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.recipe_ingredients_cycle_guard();

-- ============================================
-- SECTION 12: order_items.stock_consumed_at
-- ============================================
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_consumed_at timestamptz;

COMMENT ON COLUMN public.order_items.stock_consumed_at IS
  'Set by consume_order_stock when the item''s formula was deducted; a stamped item is never consumed again.';

-- ============================================
-- SECTION 13: RLS
-- ============================================
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  pol record;
  v_tenant constant text := 'restaurant_id = (SELECT private.current_restaurant_id())';
  v_admin  constant text := '(SELECT private.current_app_role()) = ''admin'' AND restaurant_id = (SELECT private.current_restaurant_id())';
  v_stock  constant text := '(SELECT private.current_app_role()) IN (''admin'', ''kitchen'') AND restaurant_id = (SELECT private.current_restaurant_id())';
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['suppliers', 'inventory_locations', 'inventory_lots', 'inventory_movements',
                                 'purchase_orders', 'purchase_order_lines', 'inventory_counts',
                                 'inventory_count_lines', 'production_batches',
                                 'ingredients', 'recipes', 'recipe_ingredients'])
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;

  -- Read by the tenant, written by admin. ingredients / recipes /
  -- recipe_ingredients keep tenant-wide reads for the menu stock check.
  FOR tbl IN SELECT unnest(ARRAY['inventory_locations', 'ingredients', 'recipes', 'recipe_ingredients']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', tbl || '_select_policy', tbl, v_tenant);
  END LOOP;

  -- Admin only, read and write.
  FOR tbl IN SELECT unnest(ARRAY['suppliers', 'purchase_orders', 'purchase_order_lines',
                                 'inventory_counts', 'inventory_count_lines']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)', tbl || '_select_policy', tbl, v_admin);
  END LOOP;

  -- Admin writes. Counts are inserted by open_inventory_count only, and
  -- suppliers / locations are soft-deleted (is_active), so those get no
  -- INSERT / DELETE policy respectively.
  FOR tbl IN SELECT unnest(ARRAY['inventory_locations', 'suppliers', 'purchase_orders', 'purchase_order_lines',
                                 'ingredients', 'recipes', 'recipe_ingredients']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', tbl || '_insert_policy', tbl, v_admin);
  END LOOP;
  FOR tbl IN SELECT unnest(ARRAY['inventory_locations', 'suppliers', 'purchase_orders', 'purchase_order_lines',
                                 'inventory_counts', 'inventory_count_lines',
                                 'ingredients', 'recipes', 'recipe_ingredients']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   tbl || '_update_policy', tbl, v_admin, v_admin);
  END LOOP;
  FOR tbl IN SELECT unnest(ARRAY['purchase_orders', 'purchase_order_lines',
                                 'ingredients', 'recipes', 'recipe_ingredients']) LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)', tbl || '_delete_policy', tbl, v_admin);
  END LOOP;

  -- RPC-written tables: read only.
  EXECUTE format('CREATE POLICY inventory_lots_select_policy ON public.inventory_lots FOR SELECT TO authenticated USING (%s)', v_stock);
  EXECUTE format('CREATE POLICY production_batches_select_policy ON public.production_batches FOR SELECT TO authenticated USING (%s)', v_stock);
  EXECUTE format('CREATE POLICY inventory_movements_select_policy ON public.inventory_movements FOR SELECT TO authenticated USING (%s)', v_admin);
END $$;

-- ============================================
-- SECTION 14: opening backfill
-- ============================================
CREATE OR REPLACE FUNCTION private.backfill_inventory_opening()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item  record;
  v_loc   uuid;
  v_lot   uuid;
  v_count integer := 0;
BEGIN
  FOR v_item IN
    SELECT i.id, i.restaurant_id, i.stock, COALESCE(i.cost, 0) AS cost
      FROM public.ingredients i
     WHERE i.stock <> 0
       AND NOT EXISTS (SELECT 1 FROM public.inventory_lots l WHERE l.ingredient_id = i.id)
     ORDER BY i.restaurant_id, i.id
  LOOP
    v_loc := private.ensure_default_inventory_location(v_item.restaurant_id);

    INSERT INTO public.inventory_lots (restaurant_id, ingredient_id, location_id, quantity, unit_cost)
    VALUES (v_item.restaurant_id, v_item.id, v_loc, v_item.stock, greatest(v_item.cost, 0))
    RETURNING id INTO v_lot;

    INSERT INTO public.inventory_movements
      (restaurant_id, ingredient_id, location_id, lot_id, movement_type, quantity,
       unit_cost, total_cost, reason)
    VALUES (v_item.restaurant_id, v_item.id, v_loc, v_lot, 'opening', v_item.stock,
            greatest(v_item.cost, 0), v_item.stock * greatest(v_item.cost, 0),
            'Saldo inicial migrado');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION private.backfill_inventory_opening() IS
  'For every ingredient with stock <> 0 and no lot yet: creates the general lot at the default location (quantity = stock, unit_cost = cost) and one opening movement. Idempotent; returns the number of items backfilled.';

SELECT private.backfill_inventory_opening();

-- ============================================
-- SECTION 15: privileges
-- ============================================
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['suppliers', 'inventory_locations', 'inventory_lots', 'inventory_movements',
                             'purchase_orders', 'purchase_order_lines', 'inventory_counts',
                             'inventory_count_lines', 'production_batches']
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', tbl);
  END LOOP;
END $$;

REVOKE ALL ON TABLE private.inventory_counters FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.next_inventory_counter(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.ensure_default_inventory_location(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.backfill_inventory_opening() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_inventory_location_default() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingredients_inventory_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_documents_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_documents_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingredients_stock_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.formulas_rpc_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_locations_default_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recipes_target_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recipe_ingredients_cycle_guard() FROM PUBLIC, anon, authenticated;
