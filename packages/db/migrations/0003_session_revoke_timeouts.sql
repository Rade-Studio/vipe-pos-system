-- Logout by session id (odd/tasks/migracion-backend-nestjs.md, T5 verification).
--
-- A logout that carries only the access cookie must still end the session the
-- token points to (its sid claim). SECURITY DEFINER with search_path = '' and
-- an explicit grant, like the other auth helpers of 0002.

CREATE FUNCTION private.revoke_session_by_id(p_session_id uuid)
    RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.auth_sessions
     SET revoked_at = pg_catalog.now()
   WHERE id = p_session_id
     AND revoked_at IS NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.revoke_session_by_id(uuid) IS 'Revokes the session with that id (logout with only the access token, by its sid claim). No-op when the id is unknown or already revoked.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.revoke_session_by_id(uuid) TO vipe_api;
