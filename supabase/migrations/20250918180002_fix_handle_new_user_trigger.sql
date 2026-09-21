-- ============================================
-- Fix: handle_new_user trigger
-- ============================================
-- El trigger original en 20250917090007_rls_policies_and_profiles_auth_link.sql
-- usaba SELECT en auth.users (vía EXISTS para chequear role) que falla porque
-- el rol authenticated no tiene GRANT sobre auth.users.
--
-- Esta migración recrea el trigger leyendo solo de public.restaurants y de
-- NEW (la fila de auth.users que GoTrue está insertando), evitando el lookup.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT id INTO v_restaurant_id
  FROM public.restaurants
  LIMIT 1;

  INSERT INTO public.profiles (
    id, auth_user_id, email, full_name, role, restaurant_id, active, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'role', 'waiter'),
    v_restaurant_id,
    true,
    now(),
    now()
  )
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();