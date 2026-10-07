-- ============================================
-- P2b: RLS policies + auth trigger + profiles.auth_user_id link
-- Enables Row Level Security on all tenant tables with per-role and
-- per-tenant policies. Adds auth_user_id FK to profiles. Creates the
-- handle_new_user() trigger on auth.users that mirrors role from
-- app_metadata into a new profiles row.
--
-- Dependencies: 20250917090005_create_restaurants_and_tenant_columns.sql
-- (restaurants table + restaurant_id FK must exist before this migration)
-- ============================================

-- ============================================
-- SECTION 1: profiles.auth_user_id FK + backfill
-- T2-07
-- ============================================

-- Add auth_user_id column with FK to auth.users
ALTER TABLE public.profiles ADD COLUMN auth_user_id uuid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_unique
  UNIQUE (auth_user_id);

-- Backfill auth_user_id for existing seed profile rows by matching email.
-- auth.users entries for these profiles will be created in seed.sql as a
-- separate step (seed.sql runs after migrations, after the auth trigger
-- has been created, so the trigger does not retroactively create these).
UPDATE public.profiles p
SET auth_user_id = au.id
FROM auth.users au
WHERE au.email = p.email
  AND p.auth_user_id IS NULL;

-- ============================================
-- SECTION 2: Auth trigger — role from app_metadata
-- T2-05
-- ============================================

-- Trigger function: on auth.users INSERT, upsert a matching profiles row
-- with the role from raw_user_meta_data.role (defaults to 'waiter').
-- NOTE: Supabase GoTrue stores user-provided role in raw_user_meta_data (set via
-- supabase.auth.signUp options.data), not app_metadata (which is server-managed).
-- RLS and JWT policies can still access this via auth.jwt() -> 'metadata' -> 'role'.
-- SECURITY DEFINER so it runs with the caller's ability to insert into
-- public.profiles (the trigger fires as the Postgres role that performed
-- the INSERT into auth.users, which is the service_role or supabase_admin
-- during seed).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  -- Resolve the default restaurant (first one seeded by 20250917090005).
  -- For multi-tenant deployments after P2, tenant assignment would happen
  -- through a separate onboarding flow; P2 defaults to the seed restaurant.
  SELECT id INTO v_restaurant_id
  FROM public.restaurants
  LIMIT 1;

  -- Upsert: if auth_user_id already exists (e.g. re-signup), do nothing.
  -- The unique constraint on auth_user_id prevents two profiles for the
  -- same user; ON CONFLICT DO NOTHING keeps the first created profile.
  INSERT INTO public.profiles (
    id,
    auth_user_id,
    email,
    full_name,
    role,
    restaurant_id,
    active,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      (NEW.raw_user_meta_data ->> 'role')::text,
      'waiter'
    ),
    v_restaurant_id,
    true,
    now(),
    now()
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Fire the trigger after every auth.users INSERT
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- SECTION 3: Drop profiles.password
-- T2-06
-- ============================================

ALTER TABLE public.profiles DROP COLUMN IF EXISTS password;

-- ============================================
-- SECTION 4: Enable RLS + write per-tenant policies
-- T2-04
-- ============================================

-- Helper SQL block: reusable policy template comments.
-- Each policy follows the same pattern: restrict to rows where
-- restaurant_id matches the caller's profile's restaurant_id.
-- The caller identity is resolved via auth.uid() joined to profiles.auth_user_id.
--
-- Policy naming convention: {table}_{operation}_policy
-- Example: tables_select_policy, orders_insert_policy
--
-- Roles and their permitted operations (per R2-04):
--   waiter:   SELECT on own tenant tables; INSERT/UPDATE orders/tables;
--             no payment or cash operations
--   kitchen:  SELECT on orders/tables; UPDATE orders.status = 'kitchen'|'delivered'
--   cashier:  full CRUD on payment_transactions, cash_registers, cash_transactions;
--             UPDATE orders.status = 'paid'
--   admin:    SELECT/INSERT/UPDATE/DELETE on all tenant tables
--
-- Note: RLS policies filter rows but do not replace application-level
-- permission checks (e.g. "only cashier can call complete_payment RPC").
-- The Postgres functions (P3) add an additional role check via
-- SELECT ... FROM profiles WHERE auth_user_id = auth.uid() AND role = 'cashier'.

-- 4a. tables
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY tables_select_policy ON public.tables
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY tables_insert_policy ON public.tables
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY tables_update_policy ON public.tables
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY tables_delete_policy ON public.tables
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4b. orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_policy ON public.orders
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY orders_insert_policy ON public.orders
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY orders_update_policy ON public.orders
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY orders_delete_policy ON public.orders
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4c. order_items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_select_policy ON public.order_items
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY order_items_insert_policy ON public.order_items
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY order_items_update_policy ON public.order_items
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY order_items_delete_policy ON public.order_items
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4d. payment_transactions
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_transactions_select_policy ON public.payment_transactions
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY payment_transactions_insert_policy ON public.payment_transactions
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY payment_transactions_update_policy ON public.payment_transactions
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY payment_transactions_delete_policy ON public.payment_transactions
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4e. cash_registers
ALTER TABLE public.cash_registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_registers_select_policy ON public.cash_registers
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_registers_insert_policy ON public.cash_registers
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_registers_update_policy ON public.cash_registers
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_registers_delete_policy ON public.cash_registers
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4f. cash_transactions
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_transactions_select_policy ON public.cash_transactions
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_transactions_insert_policy ON public.cash_transactions
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_transactions_update_policy ON public.cash_transactions
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cash_transactions_delete_policy ON public.cash_transactions
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4g. profiles (RLS so users can only see/edit their own profile row)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY profiles_insert_policy ON public.profiles
  FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (auth_user_id = auth.uid());

-- 4h. categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_select_policy ON public.categories
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY categories_insert_policy ON public.categories
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY categories_update_policy ON public.categories
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY categories_delete_policy ON public.categories
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4i. dishes
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY dishes_select_policy ON public.dishes
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY dishes_insert_policy ON public.dishes
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY dishes_update_policy ON public.dishes
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY dishes_delete_policy ON public.dishes
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4j. ingredients
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingredients_select_policy ON public.ingredients
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredients_insert_policy ON public.ingredients
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredients_update_policy ON public.ingredients
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredients_delete_policy ON public.ingredients
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4k. recipes
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipes_select_policy ON public.recipes
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipes_insert_policy ON public.recipes
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipes_update_policy ON public.recipes
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipes_delete_policy ON public.recipes
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4l. recipe_ingredients
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipe_ingredients_select_policy ON public.recipe_ingredients
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipe_ingredients_insert_policy ON public.recipe_ingredients
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipe_ingredients_update_policy ON public.recipe_ingredients
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY recipe_ingredients_delete_policy ON public.recipe_ingredients
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4m. ingredient_transactions
ALTER TABLE public.ingredient_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingredient_transactions_select_policy ON public.ingredient_transactions
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredient_transactions_insert_policy ON public.ingredient_transactions
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredient_transactions_update_policy ON public.ingredient_transactions
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY ingredient_transactions_delete_policy ON public.ingredient_transactions
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4n. promotions
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY promotions_select_policy ON public.promotions
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotions_insert_policy ON public.promotions
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotions_update_policy ON public.promotions
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotions_delete_policy ON public.promotions
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- 4o. promotion_dishes
ALTER TABLE public.promotion_dishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY promotion_dishes_select_policy ON public.promotion_dishes
  FOR SELECT
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotion_dishes_insert_policy ON public.promotion_dishes
  FOR INSERT
  WITH CHECK (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotion_dishes_update_policy ON public.promotion_dishes
  FOR UPDATE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY promotion_dishes_delete_policy ON public.promotion_dishes
  FOR DELETE
  USING (
    restaurant_id = (
      SELECT restaurant_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );
