-- API authentication storage (odd/tasks/migracion-backend-nestjs.md, T5
-- design steps 1b and 3).
--
--   1. vipe_api stops reading public.users.password_hash: the table grant from
--      the baseline becomes column-level SELECT on the non-secret columns.
--      Hashes are reached only through private.find_user_for_login, and users
--      are written only through private.create_user / private.set_password.
--   2. public.auth_sessions holds one row per refresh token (sha256 of an
--      opaque random value). vipe_api reads its own rows (RLS on app.user_id,
--      refresh_hash excluded) and writes only through private.create_session,
--      private.rotate_session and private.revoke_session, which run on public
--      routes before any app.user_id exists.
--
-- Every helper is SECURITY DEFINER with search_path = '' (150_api_role_hardening)
-- and needs its own GRANT EXECUTE, because functions created by vipe_migrator
-- are not executable by PUBLIC (0001). citext comparisons name the operator
-- with OPERATOR(public.=): under an empty search_path a bare `=` resolves to
-- text equality and would turn the email lookup case-sensitive.

REVOKE ALL ON TABLE public.users FROM vipe_api;
--> statement-breakpoint
GRANT SELECT (id, email, is_active, created_at, updated_at) ON TABLE public.users TO vipe_api;
--> statement-breakpoint
CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT auth_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT auth_sessions_refresh_hash_key UNIQUE (refresh_hash),
    CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX idx_auth_sessions_user_id ON public.auth_sessions USING btree (user_id);
--> statement-breakpoint
COMMENT ON TABLE public.auth_sessions IS 'Refresh sessions issued by the API. refresh_hash is the sha256 (hex) of the opaque refresh cookie; rotation replaces it in place, so a used refresh token never matches again. Written only through the private.*_session SECURITY DEFINER helpers.';
--> statement-breakpoint
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_sessions_select_policy ON public.auth_sessions FOR SELECT TO vipe_api USING ((user_id = ( SELECT private.current_user_id() AS current_user_id)));
--> statement-breakpoint
-- The migrator's default privileges grant full DML on new tables; narrow it.
REVOKE ALL ON TABLE public.auth_sessions FROM vipe_api;
--> statement-breakpoint
GRANT SELECT (id, user_id, expires_at, revoked_at, created_at) ON TABLE public.auth_sessions TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.find_user_for_login(p_email public.citext)
    RETURNS TABLE (id uuid, password_hash text, password_algo text, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT u.id, u.password_hash, u.password_algo, u.is_active
    FROM public.users u
   WHERE u.email OPERATOR(public.=) p_email
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.find_user_for_login(public.citext) IS 'Login lookup for the API: id, password hash, algorithm and active flag of the user with that email (case-insensitive), or no row. The only path through which vipe_api sees password_hash.';
--> statement-breakpoint
CREATE FUNCTION private.create_user(p_email public.citext, p_password_hash text, p_password_algo text DEFAULT 'argon2id')
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_password_algo IS NULL OR p_password_algo NOT IN ('argon2id', 'bcrypt') THEN
    RAISE EXCEPTION 'Unsupported password algorithm: %', p_password_algo USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.users (email, password_hash, password_algo)
  VALUES (p_email, p_password_hash, p_password_algo)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_user(public.citext, text, text) IS 'Creates a login identity with an already-computed hash (argon2id or bcrypt). 23505 for a duplicate email (case-insensitive), 22023 for an unknown algorithm.';
--> statement-breakpoint
CREATE FUNCTION private.set_password(p_user_id uuid, p_password_hash text, p_password_algo text DEFAULT 'argon2id')
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_password_algo IS NULL OR p_password_algo NOT IN ('argon2id', 'bcrypt') THEN
    RAISE EXCEPTION 'Unsupported password algorithm: %', p_password_algo USING ERRCODE = '22023';
  END IF;
  UPDATE public.users
     SET password_hash = p_password_hash, password_algo = p_password_algo
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_password(uuid, text, text) IS 'Replaces the password hash and algorithm of a user (password change, or the bcrypt -> argon2id re-hash on first login). P0002 for an unknown user, 22023 for an unknown algorithm.';
--> statement-breakpoint
CREATE FUNCTION private.create_session(p_user_id uuid, p_refresh_hash text, p_expires_at timestamp with time zone)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.is_active) THEN
    RAISE EXCEPTION 'User not found or inactive: %', p_user_id USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at)
  VALUES (p_user_id, p_refresh_hash, p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_session(uuid, text, timestamp with time zone) IS 'Opens a refresh session for an active user and returns its id (the sid claim). 42501 when the user is missing or inactive.';
--> statement-breakpoint
CREATE FUNCTION private.rotate_session(p_refresh_hash text, p_new_refresh_hash text, p_expires_at timestamp with time zone)
    RETURNS TABLE (id uuid, user_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.auth_sessions s
     SET refresh_hash = p_new_refresh_hash, expires_at = p_expires_at
    FROM public.users u
   WHERE s.refresh_hash = p_refresh_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > pg_catalog.now()
     AND u.id = s.user_id
     AND u.is_active
  RETURNING s.id, s.user_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.rotate_session(text, text, timestamp with time zone) IS 'Swaps the refresh hash of a live session (not revoked, not expired, active user) in one UPDATE and returns (id, user_id); no row otherwise. The old hash never matches again, so a reused refresh token is rejected; concurrent rotations of the same token have one winner.';
--> statement-breakpoint
CREATE FUNCTION private.revoke_session(p_refresh_hash text)
    RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.auth_sessions
     SET revoked_at = pg_catalog.now()
   WHERE refresh_hash = p_refresh_hash
     AND revoked_at IS NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.revoke_session(text) IS 'Revokes the session holding that refresh hash (logout). No-op when the hash is unknown or already revoked.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.find_user_for_login(public.citext) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_user(public.citext, text, text) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_password(uuid, text, text) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_session(uuid, text, timestamp with time zone) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.rotate_session(text, text, timestamp with time zone) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.revoke_session(text) TO vipe_api;
