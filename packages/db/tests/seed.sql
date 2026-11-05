-- Test fixtures for the pgTAP suite on plain Postgres.
--
-- Loaded once by scripts/test-db.sh, as the superuser, after the migrations
-- and before the *.test.sql files, the way `supabase db start` loaded
-- supabase/seed.sql. Never applied to a real database: the baseline migration
-- is schema-only.
--
-- Contents:
--   1. The default restaurant that migration 20250917090005 inserted as data
--      (its AFTER INSERT triggers install the payment methods and the default
--      inventory location, as they did on Supabase).
--   2. tests.auth_users: a fixture shim with the column list of Supabase's
--      auth.users. An insert creates the public.users row and the linked
--      profile exactly like the dropped handle_new_user() trigger did, so the
--      ported test files keep their fixtures. Profile creation in the product
--      moves to the API (T12); this shim exists only in the test database.
--   3. supabase/seed.sql, ported (auth.identities is gone; auth_user_id is
--      now user_id).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ============================================
-- 1. Default restaurant
-- ============================================
INSERT INTO public.restaurants (id, slug, name, timezone, currency, created_at, updated_at)
VALUES ('a0eebc99-0000-0000-0000-000000000000', 'default', 'Restaurant', 'America/Bogota', 'COP', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. tests.auth_users fixture shim
-- ============================================
CREATE SCHEMA IF NOT EXISTS tests;

CREATE TABLE IF NOT EXISTS tests.auth_users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text,
  email_change_token_current text,
  phone_change text,
  phone_change_token text,
  reauthentication_token text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

-- Body of the Supabase-era public.handle_new_user(), pointed at public.users
-- and profiles.user_id.
CREATE OR REPLACE FUNCTION tests.create_user_and_profile() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
DECLARE
  v_restaurant_id uuid;
  v_role text;
BEGIN
  INSERT INTO public.users (id, email, password_hash, password_algo, created_at, updated_at)
  VALUES (NEW.id, NEW.email, coalesce(NEW.encrypted_password, '!'), 'bcrypt',
          coalesce(NEW.created_at, now()), coalesce(NEW.updated_at, now()));

  v_role := COALESCE(NEW.raw_app_meta_data ->> 'role', 'waiter');
  v_restaurant_id := NULLIF(NEW.raw_app_meta_data ->> 'restaurant_id', '')::uuid;

  IF v_restaurant_id IS NULL THEN
    SELECT r.id INTO v_restaurant_id
    FROM public.restaurants r
    ORDER BY r.created_at, r.id
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    id, user_id, email, full_name, role, restaurant_id, active, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    v_role,
    v_restaurant_id,
    true,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_user_and_profile ON tests.auth_users;
CREATE TRIGGER create_user_and_profile AFTER INSERT ON tests.auth_users
  FOR EACH ROW EXECUTE FUNCTION tests.create_user_and_profile();

-- ============================================
-- 3. supabase/seed.sql, ported
-- ============================================
-- ============================================
-- Seed data for VipePOS
--
-- IMPORTANT: Profile management has changed with P2 RLS.
-- - tests.auth_users entries are seeded here with raw_user_meta_data.role.
-- - The trigger tests.create_user_and_profile() creates matching profiles rows automatically.
-- - Old profile inserts (with hardcoded UUIDs) are removed — the trigger
--   now manages profile lifecycle.
-- - Role PINs (kitchen_password, cashier_password, etc.) are removed.
--   Role is now stored in tests.auth_users raw_user_meta_data and checked server-side.
-- ============================================

-- ============================================
-- tests.auth_users seed entries
-- These users will have matching profiles created by the
-- tests.create_user_and_profile() trigger (fires AFTER INSERT on tests.auth_users).
-- The trigger sets role from raw_user_meta_data.role (defaults to 'waiter').
--
-- Las columnas de token se escriben explícitamente como '' y no NULL: GoTrue
-- las espera con ese valor en sus consultas de confirmación/recuperación, y
-- un NULL las deja indistinguibles de "sin token pendiente".
-- ============================================
INSERT INTO tests.auth_users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'a0eebc99-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'carlos@restaurant.com',
    crypt('carlos123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Carlos López","role":"cashier"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0eebc99-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'maria@restaurant.com',
    crypt('maria123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"María","role":"waiter"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0eebc99-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@restaurant.com',
    crypt('admin123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Admin Principal","role":"admin"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0eebc99-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'deiby@restaurant.com',
    crypt('deiby123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Deiby","role":"waiter"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0eebc99-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'tester@restaurant.com',
    crypt('tester123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Test User","role":"waiter"}'::jsonb,
    now(),
    now()
  ),
  (
    'a0eebc99-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'domicilios@restaurant.com',
    crypt('domicilios123', gen_salt('bf')),
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"],"role":"delivery_operator","restaurant_id":"a0eebc99-0000-0000-0000-000000000000"}'::jsonb,
    '{"full_name":"Operador Domicilios","role":"delivery_operator"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;
-- ============================================
-- profiles seed entries
-- El trigger tests.create_user_and_profile() ya creó una fila por cada usuario de arriba, así
-- que aquí se hace UPSERT sobre profiles_user_id_unique: sin esto el seed
-- revienta con duplicate key en profiles_email_key / profiles_user_id_unique.
-- El id lo conserva el trigger (es el que usará orders.waiter_id); esta sección
-- solo alinea los datos de negocio declarados abajo.
-- ============================================
INSERT INTO "public"."profiles" ("user_id", "restaurant_id", "full_name", "username", "email", "role", "active", "created_at", "updated_at")
VALUES
  ('a0eebc99-0000-0000-0000-000000000001', 'a0eebc99-0000-0000-0000-000000000000', 'Carlos López', 'carlosl', 'carlos@restaurant.com', 'cashier', 'true', '2025-04-13 02:25:16.815455+00', '2025-04-13 02:25:16.815455+00'),
  ('a0eebc99-0000-0000-0000-000000000002', 'a0eebc99-0000-0000-0000-000000000000', 'María', 'none', 'maria@restaurant.com', 'waiter', 'true', '2025-04-13 02:25:16.815455+00', '2025-05-09 13:55:15.842+00'),
  ('a0eebc99-0000-0000-0000-000000000003', 'a0eebc99-0000-0000-0000-000000000000', 'Admin Principal', 'admin', 'admin@restaurant.com', 'admin', 'true', '2025-04-13 02:25:16.815455+00', '2025-04-13 02:25:16.815455+00'),
  ('a0eebc99-0000-0000-0000-000000000004', 'a0eebc99-0000-0000-0000-000000000000', 'Deiby', 'picon', 'deiby@restaurant.com', 'waiter', 'true', '2025-04-13 02:25:16.815455+00', '2025-05-03 23:27:29.838+00'),
  ('a0eebc99-0000-0000-0000-000000000005', 'a0eebc99-0000-0000-0000-000000000000', 'Test User', 'tester', 'tester@restaurant.com', 'waiter', 'true', '2025-09-18 00:00:00.000000+00', '2025-09-18 00:00:00.000000+00'),
  ('a0eebc99-0000-0000-0000-000000000006', 'a0eebc99-0000-0000-0000-000000000000', 'Operador Domicilios', 'domicilios', 'domicilios@restaurant.com', 'delivery_operator', 'true', '2026-10-06 00:00:00.000000+00', '2026-10-06 00:00:00.000000+00')
ON CONFLICT (user_id) DO UPDATE
  SET full_name  = EXCLUDED.full_name,
      username   = EXCLUDED.username,
      email      = EXCLUDED.email,
      role       = EXCLUDED.role,
      active     = EXCLUDED.active,
      updated_at = EXCLUDED.updated_at;

-- ============================================
-- business_config seed
-- Note: kitchen_password, cashier_password, admin_password, waiter_password
-- rows are removed. Role is now managed via tests.auth_users.app_metadata.role.
-- ============================================
INSERT INTO "public"."business_config" ("id", "key", "value", "created_at", "updated_at") VALUES
  ('13d5a11e-810a-4c21-8402-4f3321c90f55', 'business_phone', '3505379100', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:57.926+00'),
  ('33f7db87-f173-4cec-8ab6-69359c93af13', 'business_address', 'Calle 76b # 42F - 42', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:57.938+00'),
  ('9950123c-32ae-4875-a85c-570f1e762a2d', 'inventory_control_enabled', 'false', '2025-04-20 14:04:46.684171+00', '2025-05-03 23:29:57.942+00'),
  ('c136068e-73a1-4599-bf85-088a0ffa146d', 'tip_percentage', '8', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:57.997+00'),
  ('e0d19e52-e4db-4043-b6d2-a8784609404f', 'business_nit', '00000000', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:57.937+00'),
  ('e40c01f4-9218-4273-be96-03db4d8fff5f', 'price_suggestion', '300', '2025-05-02 14:04:41+00', '2025-05-03 23:29:57.93+00'),
  ('e569b69d-90df-4a1b-8cc2-50adb5b1fd48', 'tax_percentage', '0', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:57.914+00'),
  ('e769e1a7-d341-4874-aa32-d4670d305b57', 'business_name', 'WolfHouseRestaurant', '2025-04-16 14:06:56.643163+00', '2025-05-03 23:29:58.049+00');

-- ============================================
-- tables seed (restaurant_id = a0eebc99-0000-0000-0000-000000000000)
-- ============================================
INSERT INTO "public"."tables" ("id", "restaurant_id", "number", "status", "waiter_id", "created_at", "updated_at") VALUES
  ('394fa345-4d0a-4fc6-bf9b-611e1f147af4', 'a0eebc99-0000-0000-0000-000000000000', '4', 'available', NULL, '2025-04-24 16:28:09.495286+00', '2025-05-09 21:45:58.465+00'),
  ('76998525-b579-4b26-bc63-9cbb1eebd6e0', 'a0eebc99-0000-0000-0000-000000000000', '3', 'available', NULL, '2025-05-01 18:53:48.887555+00', '2025-05-01 18:53:48.887555+00'),
  ('796daf0b-cacb-433e-833d-6048a78dc8b3', 'a0eebc99-0000-0000-0000-000000000000', '1', 'available', NULL, '2025-05-09 14:09:21.103594+00', '2025-05-09 14:09:21.103594+00'),
  ('9320c931-87b7-42c1-9a67-1a9dad666805', 'a0eebc99-0000-0000-0000-000000000000', '6', 'available', NULL, '2025-04-24 16:25:56.882127+00', '2025-04-28 00:21:56.79+00'),
  ('e3ba47ef-c527-4049-b8e8-c16e5fdf7758', 'a0eebc99-0000-0000-0000-000000000000', '5', 'available', NULL, '2025-04-13 02:25:16.815455+00', '2025-05-05 21:09:04.981+00'),
  ('f17fa7b4-9799-4459-873c-f247f5392bdf', 'a0eebc99-0000-0000-0000-000000000000', '2', 'available', NULL, '2025-04-13 02:25:16.815455+00', '2025-05-08 19:46:37.799+00');

-- ============================================
-- categories seed
-- ============================================
INSERT INTO "public"."categories" ("id", "restaurant_id", "name", "description", "icon", "active", "created_at", "updated_at") VALUES
  ('0bca0448-e610-4cad-9ed4-08fea9d56179', 'a0eebc99-0000-0000-0000-000000000000', 'PICADAS / PARA COMPARTIR', '', 'Salad', 'true', '2025-04-28 14:35:31.795276+00', '2025-04-28 14:35:31.795276+00'),
  ('47be8ef5-c750-4c01-b41e-580a6986def6', 'a0eebc99-0000-0000-0000-000000000000', 'HAMBURGUESAS', '', 'Utensils', 'true', '2025-05-01 21:29:06.162763+00', '2025-05-01 21:29:06.162763+00'),
  ('6fbfee70-75f9-47fd-8635-44d79987b399', 'a0eebc99-0000-0000-0000-000000000000', 'ENTRADAS Y TACOS', 'Platos para comenzar y tacos', 'Utensils', 'true', '2025-04-13 02:25:16.815455+00', '2025-04-13 02:25:16.815455+00'),
  ('9cd10ead-1cee-4da1-ae0e-7db597d4cbcc', 'a0eebc99-0000-0000-0000-000000000000', 'BEBIDAS', '', 'Wine', 'true', '2025-05-01 21:34:09.200822+00', '2025-05-01 21:34:09.200822+00'),
  ('aedcfce6-4fc5-43c6-a1ac-6c1329aebb4d', 'a0eebc99-0000-0000-0000-000000000000', 'PLATOS FUERTES / GRILL', 'Platos fuertes', 'Beef', 'true', '2025-04-13 02:25:16.815455+00', '2025-04-13 02:25:16.815455+00'),
  ('b3b946a7-c8a3-4a60-959d-9acbf3cbee10', 'a0eebc99-0000-0000-0000-000000000000', 'PERROS CALIENTES', '', 'Flame', 'true', '2025-05-01 21:29:31.996205+00', '2025-05-01 21:29:31.996205+00'),
  ('d49b0bbf-d99d-4515-8de0-8ab8626e58b8', 'a0eebc99-0000-0000-0000-000000000000', 'PAPAS ESPECIALES Y SALCHIPAPAS', '', 'Salad', 'true', '2025-05-01 21:27:04.452712+00', '2025-05-01 21:27:04.452712+00');

-- ============================================
-- dishes seed (abbreviated; add full rows as needed)
-- ============================================
INSERT INTO "public"."dishes" ("id", "restaurant_id", "name", "description", "price", "category_id", "image_url", "active", "allow_comments", "created_at", "updated_at") VALUES
  ('009afdf5-2173-4d44-b381-6ec28f1cb386', 'a0eebc99-0000-0000-0000-000000000000', 'GRILL THE WOLF', '120gr de pechuga, 120gr de bondiola de cerdo y 1 chorizo de cerdo al barril, acompañado de ensalada de la casa, chimichurri artesanal, papa casco y salsa de la casa.', '34980.00', 'aedcfce6-4fc5-43c6-a1ac-6c1329aebb4d', NULL, 'true', 'false', '2025-05-02 22:53:37.473228+00', '2025-05-02 22:53:37.473228+00'),
  ('1d4942a8-ee55-4579-ac9d-5f436f5807ea', 'a0eebc99-0000-0000-0000-000000000000', 'DOBLE WOLF HP', 'Base de patacón gigante, pechuga (120gr), carne molida (120gr), bondiola (120gr), chicharrón (120gr), butifarra (100gr), salsa de la casa, guacamole, chimichurri, queso costeño, cebolla caramelizada y papas francesas.', '59900.00', '0bca0448-e610-4cad-9ed4-08fea9d56179', NULL, 'true', 'false', '2025-05-03 01:08:36.817634+00', '2025-05-03 01:08:36.817634+00'),
  ('29cb95fe-a9e0-4100-af59-820203cde93f', 'a0eebc99-0000-0000-0000-000000000000', 'HAMBURGUESA DOBLE', 'Pan, lechuga, carne molida (120gr), bondiola de cerdo (100gr), papa chongo, queso costeño, tocineta, salsa de la casa, salsa de piña, suero.', '21900.00', '47be8ef5-c750-4c01-b41e-580a6986def6', NULL, 'true', 'false', '2025-05-08 17:40:40.881027+00', '2025-05-08 17:40:40.881027+00'),
  ('2f3b4c33-199c-4b35-9a76-801888604229', 'a0eebc99-0000-0000-0000-000000000000', 'ALITAS DEL LOBO', '12 alitas BBQ acompañadas de papas francesas y salsa ranch.', '28000.00', '6fbfee70-75f9-47fd-8635-44d79987b399', NULL, 'true', 'false', '2025-05-03 01:08:31.84391+00', '2025-05-03 01:08:31.84391+00');
