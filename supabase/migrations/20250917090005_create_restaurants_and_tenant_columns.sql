-- ============================================
-- P2-01: Create restaurants table + add restaurant_id FK to all tenant tables
-- P2-02: Backfill existing rows to default restaurant
-- ============================================

-- restaurants: the root tenant entity.
-- RLS is intentionally NOT enabled on this table (seeded by migration, not user-data;
-- admin access is managed via direct DB access, per Q2-B in design.md).
CREATE TABLE IF NOT EXISTS public.restaurants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'America/Bogota',
  currency    text NOT NULL DEFAULT 'COP',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Fixed default restaurant UUID — used as the FK default target for all tenant tables.
-- This UUID is stable and idempotent: the INSERT is guarded by IF NOT EXISTS,
-- so re-running this migration is a no-op.
DO $$
DECLARE
  _rid uuid := 'a0eebc99-0000-0000-0000-000000000000';
BEGIN
  INSERT INTO public.restaurants (id, slug, name, timezone, currency, created_at, updated_at)
  VALUES (_rid, 'default', 'Restaurant', 'America/Bogota', 'COP', now(), now())
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Helper to DRY-up the ALTER TABLE pattern for each tenant table.
-- Runs in a single transaction so the entire migration is atomic.
-- All existing rows are backfilled to the default restaurant.

-- 1. tables
ALTER TABLE public.tables ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.tables ADD CONSTRAINT tables_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.tables SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_id ON public.tables USING btree (restaurant_id);

-- 2. categories
ALTER TABLE public.categories ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.categories ADD CONSTRAINT categories_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.categories SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_categories_restaurant_id ON public.categories USING btree (restaurant_id);

-- 3. dishes
ALTER TABLE public.dishes ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.dishes ADD CONSTRAINT dishes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.dishes SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_dishes_restaurant_id ON public.dishes USING btree (restaurant_id);

-- 4. ingredients
ALTER TABLE public.ingredients ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.ingredients SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ingredients_restaurant_id ON public.ingredients USING btree (restaurant_id);

-- 5. recipes
ALTER TABLE public.recipes ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.recipes ADD CONSTRAINT recipes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.recipes SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_id ON public.recipes USING btree (restaurant_id);

-- 6. recipe_ingredients
ALTER TABLE public.recipe_ingredients ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.recipe_ingredients SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_restaurant_id ON public.recipe_ingredients USING btree (restaurant_id);

-- 7. ingredient_transactions
ALTER TABLE public.ingredient_transactions ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.ingredient_transactions ADD CONSTRAINT ingredient_transactions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.ingredient_transactions SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ingredient_transactions_restaurant_id ON public.ingredient_transactions USING btree (restaurant_id);

-- 8. orders
ALTER TABLE public.orders ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.orders ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.orders SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON public.orders USING btree (restaurant_id);

-- 9. order_items
ALTER TABLE public.order_items ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.order_items ADD CONSTRAINT order_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.order_items SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_restaurant_id ON public.order_items USING btree (restaurant_id);

-- 10. cash_registers
ALTER TABLE public.cash_registers ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.cash_registers ADD CONSTRAINT cash_registers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.cash_registers SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_registers_restaurant_id ON public.cash_registers USING btree (restaurant_id);

-- 11. cash_transactions
ALTER TABLE public.cash_transactions ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.cash_transactions ADD CONSTRAINT cash_transactions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.cash_transactions SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_cash_transactions_restaurant_id ON public.cash_transactions USING btree (restaurant_id);

-- 12. payment_transactions
ALTER TABLE public.payment_transactions ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.payment_transactions SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_transactions_restaurant_id ON public.payment_transactions USING btree (restaurant_id);

-- 13. promotions
ALTER TABLE public.promotions ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.promotions ADD CONSTRAINT promotions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.promotions SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_restaurant_id ON public.promotions USING btree (restaurant_id);

-- 14. promotion_dishes
ALTER TABLE public.promotion_dishes ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.promotion_dishes ADD CONSTRAINT promotion_dishes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.promotion_dishes SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_dishes_restaurant_id ON public.promotion_dishes USING btree (restaurant_id);

-- 15. profiles
ALTER TABLE public.profiles ADD COLUMN restaurant_id uuid NOT NULL DEFAULT 'a0eebc99-0000-0000-0000-000000000000';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);
UPDATE public.profiles SET restaurant_id = 'a0eebc99-0000-0000-0000-000000000000' WHERE restaurant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_restaurant_id ON public.profiles USING btree (restaurant_id);
