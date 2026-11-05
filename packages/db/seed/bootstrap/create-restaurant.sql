-- One restaurant and its first admin user (odd/tasks/migracion-backend-nestjs.md,
-- T17). The app has no signup screen, so this is how an empty database gets
-- its first tenant; the admin then creates the staff from Personal.
--
-- Run as vipe_migrator (the superuser connects and does SET LOCAL ROLE),
-- inside the caller's transaction (no BEGIN/COMMIT here: create-restaurant.sh
-- wraps it, and seed/demo/demo-db.sh runs it ahead of the demo data). psql
-- variables, sent as \set lines on stdin:
--   restaurant_name  display name, 1..120 characters
--   admin_email      login of the first admin (citext, unique)
--   admin_name       full name shown in the app
--   admin_username   profile username, 1..50 characters, unique
--   admin_hash       argon2id hash of the admin password (never the password)
--
-- The restaurant's AFTER INSERT triggers install the default payment methods
-- and the default inventory location. The new restaurant id is left in the
-- transaction setting vipe.restaurant_id for the scripts that follow.
--
-- Refuses a restaurant name that already exists, case-insensitively, an
-- email that already has a user or a username another profile holds.
-- create-restaurant.sh checks all three first and exits 3; for a concurrent
-- run, every unique violation in this block is raised again as 23505 with the
-- message prefix "conflict: ", which the script also maps to exit 3.

SET LOCAL vipe.restaurant_name = :'restaurant_name';
SET LOCAL vipe.admin_email = :'admin_email';
SET LOCAL vipe.admin_name = :'admin_name';
SET LOCAL vipe.admin_username = :'admin_username';
SET LOCAL vipe.admin_hash = :'admin_hash';

DO $bootstrap$
DECLARE
  v_name   text := btrim(current_setting('vipe.restaurant_name'));
  v_email  text := lower(btrim(current_setting('vipe.admin_email')));
  v_admin  text := btrim(current_setting('vipe.admin_name'));
  v_login  text := current_setting('vipe.admin_username');
  v_hash   text := current_setting('vipe.admin_hash');
  v_base   text;
  v_slug   text;
  v_n      integer := 1;
  v_rid    uuid;
  v_user   uuid;
BEGIN
  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'restaurant name must have 1..120 characters' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'admin email is not valid' USING ERRCODE = '22023';
  END IF;
  IF v_admin = '' OR length(v_admin) > 100 THEN
    RAISE EXCEPTION 'admin name must have 1..100 characters' USING ERRCODE = '22023';
  END IF;
  IF v_login = '' OR length(v_login) > 50 OR v_login ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'admin username must have 1..50 characters and no spaces' USING ERRCODE = '22023';
  END IF;
  IF v_hash NOT LIKE '$argon2id$%' THEN
    RAISE EXCEPTION 'admin_hash must be an argon2id hash' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.restaurants r WHERE lower(btrim(r.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'a restaurant named "%" already exists', v_name USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.email = v_email::public.citext) THEN
    RAISE EXCEPTION 'a user with email % already exists', v_email USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.username = v_login) THEN
    RAISE EXCEPTION 'the username % is already taken', v_login USING ERRCODE = '23505';
  END IF;

  -- Slug from the name: ASCII, lowercase, dashes; a numeric suffix when taken.
  v_base := btrim(regexp_replace(lower(translate(v_name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                                 '[^a-z0-9]+', '-', 'g'), '-');
  IF v_base = '' THEN
    v_base := 'restaurante';
  END IF;
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.restaurants r WHERE r.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.restaurants (slug, name, timezone, currency)
  VALUES (v_slug, v_name, 'America/Bogota', 'COP')
  RETURNING id INTO v_rid;

  INSERT INTO public.business_config (restaurant_id, key, value)
  VALUES (v_rid, 'business_name', v_name);

  v_user := private.create_user(v_email::public.citext, v_hash, 'argon2id');
  INSERT INTO public.profiles (user_id, full_name, username, email, role, active, restaurant_id)
  VALUES (v_user, v_admin, v_login, v_email, 'admin', true, v_rid);

  PERFORM set_config('vipe.restaurant_id', v_rid::text, true);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'conflict: %', SQLERRM USING ERRCODE = '23505';
END
$bootstrap$;
