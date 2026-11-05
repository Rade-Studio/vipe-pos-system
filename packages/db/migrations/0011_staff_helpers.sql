-- Staff management through gated helpers (odd/tasks/migracion-backend-nestjs.md,
-- T12 design step 1). Closes the T5 open risk:
--
--   1. public.users gets RLS: vipe_api sees the caller and the users that have
--      a profile in the caller's restaurant, nothing else (before, any
--      vipe_api session listed every tenant's emails).
--   2. Staff accounts are created, edited, deleted and given a new password
--      only through four SECURITY DEFINER helpers that check INSIDE the
--      function that the caller (app.user_id) is an active admin, that the
--      target belongs to the caller's restaurant, is not an admin and is not
--      the caller, and that the role is waiter|kitchen|cashier|delivery_operator.
--      This replaces the create-staff-account Edge Function (service role).
--   3. vipe_api loses EXECUTE on the ungated private.create_user, and
--      private.set_password only accepts the caller's own user (the login
--      bcrypt -> argon2id re-hash runs with app.user_id set to that user).
--
-- 42501/P0002 texts are internal (the API answers with its generic message
-- for those SQLSTATEs); only the 22023 role message and the P0001 assigned-
-- tables message reach the caller verbatim, so only they are Spanish.
--
-- Every helper pins search_path = '' (150_api_role_hardening); citext compares
-- through OPERATOR(public.=) as in 0002.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select_policy ON public.users FOR SELECT TO vipe_api USING (
  id = (SELECT private.current_user_id())
  OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = users.id
       AND p.restaurant_id = (SELECT private.current_restaurant_id())
  )
);
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION private.create_user(public.citext, text, text) FROM vipe_api;
--> statement-breakpoint
-- Profiles are written only through the helpers below: with the baseline DML
-- grant an admin could promote, demote, insert or delete admins with raw SQL.
-- No API code writes profiles directly (only SECURITY DEFINER functions, which
-- run as vipe_migrator).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM vipe_api;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.set_password(p_user_id uuid, p_password_hash text, p_password_algo text DEFAULT 'argon2id')
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'set_password only changes the caller''s own password' USING ERRCODE = '42501';
  END IF;
  IF p_password_algo IS NULL OR p_password_algo NOT IN ('argon2id', 'bcrypt') THEN
    RAISE EXCEPTION 'Unsupported password algorithm: %', p_password_algo USING ERRCODE = '22023';
  END IF;
  UPDATE public.users
     SET password_hash = p_password_hash, password_algo = p_password_algo, updated_at = pg_catalog.now()
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_password(uuid, text, text) IS 'Replaces the password hash and algorithm of the CALLER (app.user_id) only: the bcrypt -> argon2id re-hash on login. 42501 for any other user, P0002 for an unknown user, 22023 for an unknown algorithm. Staff passwords go through private.set_staff_password.';
--> statement-breakpoint
CREATE FUNCTION private.staff_admin_restaurant()
    RETURNS uuid
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid;
BEGIN
  SELECT p.restaurant_id INTO v_restaurant
    FROM public.profiles p
    JOIN public.users u ON u.id = p.user_id
   WHERE p.user_id = private.current_user_id()
     AND p.role = 'admin'
     AND p.active
     AND u.is_active
   LIMIT 1;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'staff management requires an active admin' USING ERRCODE = '42501';
  END IF;
  RETURN v_restaurant;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.staff_admin_restaurant() IS 'Internal gate of the staff helpers: restaurant of the caller when the caller is an active admin with an active user, else 42501. Not executable by vipe_api.';
--> statement-breakpoint
CREATE FUNCTION private.staff_target(p_profile_id uuid)
    RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.staff_admin_restaurant();
  v_target record;
BEGIN
  SELECT p.id, p.user_id, p.role INTO v_target
    FROM public.profiles p
   WHERE p.id = p_profile_id
     AND p.restaurant_id = v_restaurant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.user_id IS NOT DISTINCT FROM private.current_user_id() THEN
    RAISE EXCEPTION 'staff helpers never target the caller' USING ERRCODE = '42501';
  END IF;
  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'staff helpers never target an admin' USING ERRCODE = '42501';
  END IF;
  RETURN v_target.user_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.staff_target(uuid) IS 'Internal gate of the staff helpers: locks a profile of the caller''s restaurant and returns its user_id. P0002 when missing or in another restaurant, 42501 when it is the caller or an admin. Not executable by vipe_api.';
--> statement-breakpoint
CREATE FUNCTION private.check_staff_role(p_role text)
    RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('waiter', 'kitchen', 'cashier', 'delivery_operator') THEN
    RAISE EXCEPTION 'El rol no es válido' USING ERRCODE = '22023';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION private.create_staff_user(
    p_email public.citext,
    p_password_hash text,
    p_password_algo text,
    p_full_name text,
    p_username text,
    p_role text,
    p_active boolean)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.staff_admin_restaurant();
  v_user uuid;
  v_profile uuid;
BEGIN
  PERFORM private.check_staff_role(p_role);
  IF p_password_algo IS NULL OR p_password_algo NOT IN ('argon2id', 'bcrypt') THEN
    RAISE EXCEPTION 'Unsupported password algorithm: %', p_password_algo USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.users (email, password_hash, password_algo)
  VALUES (p_email, p_password_hash, p_password_algo)
  RETURNING id INTO v_user;
  INSERT INTO public.profiles (user_id, full_name, username, email, role, active, restaurant_id)
  VALUES (v_user, p_full_name, nullif(p_username, ''), p_email::text, p_role, coalesce(p_active, true), v_restaurant)
  RETURNING id INTO v_profile;
  RETURN v_profile;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_staff_user(public.citext, text, text, text, text, text, boolean) IS 'Creates a staff login and its profile in the caller''s restaurant in one statement set; returns the profile id. Caller must be an active admin (42501); role in waiter|kitchen|cashier|delivery_operator (22023 El rol no es válido); duplicate email 23505.';
--> statement-breakpoint
CREATE FUNCTION private.update_staff_profile(
    p_profile_id uuid,
    p_full_name text,
    p_username text,
    p_active boolean,
    p_role text)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM private.staff_target(p_profile_id);
  IF p_role IS NOT NULL THEN
    PERFORM private.check_staff_role(p_role);
  END IF;
  UPDATE public.profiles
     SET full_name = coalesce(p_full_name, full_name),
         username = CASE WHEN p_username IS NULL THEN username ELSE nullif(p_username, '') END,
         active = coalesce(p_active, active),
         role = coalesce(p_role, role),
         updated_at = pg_catalog.now()
   WHERE id = p_profile_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.update_staff_profile(uuid, text, text, boolean, text) IS 'Edits a staff profile of the caller''s restaurant. NULL keeps a field; an empty username clears it. Same gates as staff_target plus the role allow-list.';
--> statement-breakpoint
CREATE FUNCTION private.set_staff_password(p_profile_id uuid, p_password_hash text, p_password_algo text)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid := private.staff_target(p_profile_id);
BEGIN
  IF p_password_algo IS NULL OR p_password_algo NOT IN ('argon2id', 'bcrypt') THEN
    RAISE EXCEPTION 'Unsupported password algorithm: %', p_password_algo USING ERRCODE = '22023';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.users
     SET password_hash = p_password_hash, password_algo = p_password_algo, updated_at = pg_catalog.now()
   WHERE id = v_user;
  -- A new password ends the member's open sessions.
  UPDATE public.auth_sessions
     SET revoked_at = pg_catalog.now()
   WHERE user_id = v_user
     AND revoked_at IS NULL;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_staff_password(uuid, text, text) IS 'Replaces the password of a staff member of the caller''s restaurant and revokes their sessions. Same gates as staff_target.';
--> statement-breakpoint
CREATE FUNCTION private.delete_staff_user(p_profile_id uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid := private.staff_target(p_profile_id);
BEGIN
  -- tables.waiter_id has no ON DELETE action: refuse with a message instead of a bare 23503.
  IF EXISTS (SELECT 1 FROM public.tables t WHERE t.waiter_id = p_profile_id) THEN
    RAISE EXCEPTION 'El integrante tiene mesas asignadas';
  END IF;
  IF v_user IS NULL THEN
    DELETE FROM public.profiles WHERE id = p_profile_id;
  ELSE
    -- profiles and auth_sessions cascade from users.
    DELETE FROM public.users WHERE id = v_user;
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.delete_staff_user(uuid) IS 'Deletes a staff member of the caller''s restaurant: the users row (profile and sessions cascade), so the login is gone. Same gates as staff_target; P0001 while the member has assigned tables.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.staff_admin_restaurant() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.staff_target(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.check_staff_role(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_staff_user(public.citext, text, text, text, text, text, boolean) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.update_staff_profile(uuid, text, text, boolean, text) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_staff_password(uuid, text, text) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.delete_staff_user(uuid) TO vipe_api;
