-- ============================================
-- Fix: profiles RLS policies (no recursion)
-- ============================================
-- El P2 original (20250917090007_rls_policies_and_profiles_auth_link.sql)
-- tenía dos problemas:
-- 1. profiles_select_policy hacía SELECT sobre la misma tabla profiles →
--    infinite recursion detected in policy for relation "profiles".
-- 2. Las policies de tablas tenant usaban subquery a profiles (que requiere
--    GRANT SELECT ON auth.users al rol authenticated).
--
-- Esta migración los reemplaza con policies que usan auth.jwt() en lugar
-- de subqueries sobre auth.users / profiles. La función auth.jwt() es
-- accesible al rol authenticated sin grants adicionales.

DO $$
DECLARE pol record;
BEGIN
  -- Drop todas las policies existentes en public.profiles
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR restaurant_id::text = (auth.jwt() -> 'user_metadata' ->> 'restaurant_id')
  );

CREATE POLICY profiles_insert_policy ON public.profiles
  FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY profiles_update_policy ON public.profiles
  FOR UPDATE
  USING (auth_user_id = auth.uid());

-- Reemplazar policies de tablas tenant (mismo patrón: auth.jwt() en vez de auth.users)
DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tables', 'orders', 'order_items', 'payment_transactions',
      'cash_registers', 'cash_transactions', 'categories', 'dishes',
      'ingredients', 'recipes', 'recipe_ingredients',
      'ingredient_transactions', 'promotions', 'promotion_dishes'
    ])
  LOOP
    -- Drop existentes
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    -- Habilitar RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    -- Crear las 4 policies (select/insert/update/delete) con auth.jwt()
    EXECUTE format('
      CREATE POLICY %I_select_policy ON public.%I
        FOR SELECT
        USING (
          auth.uid() IS NULL
          OR restaurant_id::text = (auth.jwt() -> ''user_metadata'' ->> ''restaurant_id'')
        )', tbl, tbl);

    EXECUTE format('
      CREATE POLICY %I_insert_policy ON public.%I
        FOR INSERT
        WITH CHECK (
          auth.uid() IS NULL
          OR restaurant_id::text = (auth.jwt() -> ''user_metadata'' ->> ''restaurant_id'')
        )', tbl, tbl);

    EXECUTE format('
      CREATE POLICY %I_update_policy ON public.%I
        FOR UPDATE
        USING (
          auth.uid() IS NULL
          OR restaurant_id::text = (auth.jwt() -> ''user_metadata'' ->> ''restaurant_id'')
        )', tbl, tbl);

    EXECUTE format('
      CREATE POLICY %I_delete_policy ON public.%I
        FOR DELETE
        USING (
          auth.uid() IS NULL
          OR restaurant_id::text = (auth.jwt() -> ''user_metadata'' ->> ''restaurant_id'')
        )', tbl, tbl);
  END LOOP;
END $$;