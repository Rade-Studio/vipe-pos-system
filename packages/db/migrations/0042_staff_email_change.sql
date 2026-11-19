-- H-029 (odd/tasks/qa-noviembre-2026.md T7): an admin can change the login
-- email of a staff member. Same gates as the other staff helpers of 0011
-- (private.staff_target: active admin caller, same restaurant, never an admin
-- and never the caller). The login reads public.users.email, so the member
-- logs in with the new email at once; open sessions are kept (the password
-- did not change). A duplicate email answers 23505 users_email_key, which the
-- API turns into its Spanish 409.
CREATE FUNCTION private.set_staff_email(p_profile_id uuid, p_email public.citext)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user uuid := private.staff_target(p_profile_id);
BEGIN
  IF p_email IS NULL OR pg_catalog.length(p_email::text) = 0 THEN
    RAISE EXCEPTION 'El correo electrónico no es válido' USING ERRCODE = '22023';
  END IF;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.users SET email = p_email, updated_at = pg_catalog.now() WHERE id = v_user;
  UPDATE public.profiles SET email = p_email::text, updated_at = pg_catalog.now() WHERE id = p_profile_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_staff_email(uuid, public.citext) IS 'Changes the login email (users.email and profiles.email) of a staff member of the caller''s restaurant (H-029). Same gates as staff_target; 23505 users_email_key for an email in use; sessions are kept.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.set_staff_email(uuid, public.citext) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_staff_email(uuid, public.citext) TO vipe_api;
