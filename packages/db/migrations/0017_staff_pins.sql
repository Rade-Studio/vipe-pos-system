-- Staff PINs, shared order-taking terminals and supervisor authorization
-- (odd/tasks/fase3-operacion.md, F2, S1 b).
--
-- 1. public.staff_pins: one PIN per profile, stored only as an argon2id hash
--    the API computes (the plain PIN never reaches the database; the CHECK
--    refuses anything that is not an argon2id encoded hash), the pepper
--    version the API used (1: derived from JWT_SECRET, 2: PIN_PEPPER), and
--    who set the PIN and when. vipe_api reads only the non-secret columns
--    of its restaurant; every write goes through the SECURITY DEFINER
--    helpers below.
-- 2. public.auth_sessions gains `kind` (user | terminal | acting) and
--    `parent_session_id` (the terminal of an acting session).
--    * terminal: a device opened by an active admin or cashier
--      (private.create_terminal_session); the API limits it to the
--      order-taking routes.
--    * acting: a short child session of a terminal for the staff member who
--      identified with a PIN (private.open_acting_session). Its user is that
--      staff member, so RLS, roles and the waiter recorded on orders are
--      theirs. It has no usable refresh token and dies with its terminal.
-- 3. public.supervisor_authorizations: single-use authorizations bound to an
--    action and a restaurant, created after a supervisor PIN (admin or
--    cashier) and valid 2 minutes; F1 consumes them for cancellations and
--    voids (private.consume_supervisor_authorization).
-- 4. business_config key waiter_access_mode: own_accounts (default when
--    missing, today's behaviour) | shared_terminal.
-- 5. orders.created_by_profile_id and order_items.created_by_profile_id are
--    stamped on INSERT with the caller's profile of the row's restaurant, so
--    every order and every added item records who really took it (the acting
--    staff member on a terminal) without an API change.
-- Tenant guards are composite keys to profiles(restaurant_id, id) (0014):
-- only a profile of the same restaurant fits; deleting a profile clears the
-- reference (or the PIN row).
--
-- Lockout: private.pin_attempts (no grant at all to vipe_api) keeps one
-- counter per scope: `session` (per terminal or login), `caller` (the
-- caller's profile, so a new login does not reset it), `profile` (the
-- profile whose PIN is tried) and `supervisors` (the restaurant's supervisor
-- set, for an authorization without a profile). private.claim_pin_attempt
-- counts the attempt atomically BEFORE the API verifies the PIN, under row
-- locks taken in a fixed order, and refuses while any scope is locked; a
-- correct PIN clears the claimed scopes (private.clear_pin_attempts). 5
-- attempts within 15 minutes lock every claimed scope for 5 minutes, so at
-- most 5 PINs are ever verified per scope and window, also in parallel. The
-- API passes its clock as p_now, so timing is testable; constants live in
-- private.claim_pin_attempt. Lock order everywhere: pin_attempts rows (in
-- (scope, subject) order) before staff_pins, so a claim followed by a PIN
-- write never deadlocks with an admin set or clear of the same PIN.
--
-- Every helper pins search_path = '' (150_api_role_hardening). 42501/P0002
-- texts are internal: the API answers with its own Spanish messages.
CREATE TABLE public.staff_pins (
    profile_id uuid PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    pin_hash text NOT NULL CONSTRAINT staff_pins_pin_hash_argon2id CHECK (
      pin_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,[pt]=[0-9]+,[pt]=[0-9]+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$'
    ),
    pin_pepper_version smallint DEFAULT 1 NOT NULL CONSTRAINT staff_pins_pepper_version CHECK (pin_pepper_version IN (1, 2)),
    set_by uuid,
    set_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    -- Tenant guards: the profile and who set the PIN are of the same restaurant.
    CONSTRAINT staff_pins_profile_fkey FOREIGN KEY (restaurant_id, profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT staff_pins_set_by_fkey FOREIGN KEY (restaurant_id, set_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (set_by)
);
--> statement-breakpoint
COMMENT ON TABLE public.staff_pins IS 'Per-profile PIN as an argon2id hash of the peppered PIN computed by the API (never the plain PIN), its pepper version (1 JWT_SECRET-derived, 2 PIN_PEPPER) and who set it (set_by, set_at). Lockout counters live in private.pin_attempts. vipe_api reads profile_id, restaurant_id, set_by and set_at of its restaurant; writes only through the private.*pin* helpers.';
--> statement-breakpoint
CREATE INDEX idx_staff_pins_restaurant_id ON public.staff_pins (restaurant_id);
--> statement-breakpoint
ALTER TABLE public.staff_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY staff_pins_select_policy ON public.staff_pins FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
-- The migrator's default privileges grant full DML on new tables; narrow it.
REVOKE ALL ON TABLE public.staff_pins FROM vipe_api;
--> statement-breakpoint
GRANT SELECT (profile_id, restaurant_id, set_by, set_at) ON TABLE public.staff_pins TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.auth_sessions
  ADD COLUMN kind text DEFAULT 'user' NOT NULL CONSTRAINT auth_sessions_kind_check CHECK (kind IN ('user', 'terminal', 'acting')),
  ADD COLUMN parent_session_id uuid REFERENCES public.auth_sessions(id) ON DELETE CASCADE,
  ADD CONSTRAINT auth_sessions_acting_parent CHECK ((kind = 'acting') = (parent_session_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX idx_auth_sessions_parent_session_id ON public.auth_sessions (parent_session_id) WHERE parent_session_id IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN public.auth_sessions.kind IS 'user: a personal login; terminal: a shared order-taking device opened by an admin or cashier; acting: a short child session of a terminal for the staff member identified by PIN.';
--> statement-breakpoint
GRANT SELECT (kind, parent_session_id) ON TABLE public.auth_sessions TO vipe_api;
--> statement-breakpoint
CREATE TABLE private.pin_attempts (
    scope text NOT NULL CONSTRAINT pin_attempts_scope_check CHECK (scope IN ('session', 'caller', 'profile', 'supervisors')),
    subject_id uuid NOT NULL,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    failed_attempts integer DEFAULT 0 NOT NULL CONSTRAINT pin_attempts_failed_attempts_range CHECK (failed_attempts BETWEEN 0 AND 4),
    window_started_at timestamptz,
    locked_until timestamptz,
    PRIMARY KEY (scope, subject_id)
);
--> statement-breakpoint
COMMENT ON TABLE private.pin_attempts IS 'PIN attempt counters per scope (session: auth_sessions.id; caller and profile: profiles.id; supervisors: restaurants.id). Written only by private.claim_pin_attempt / private.clear_pin_attempts and the PIN setters; vipe_api has no privilege on it.';
--> statement-breakpoint
REVOKE ALL ON TABLE private.pin_attempts FROM vipe_api;
--> statement-breakpoint
CREATE TABLE public.supervisor_authorizations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    action text NOT NULL CONSTRAINT supervisor_authorizations_action_format CHECK (action ~ '^[a-z][a-z_]{0,39}$'),
    supervisor_profile_id uuid,
    requested_by_profile_id uuid,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT supervisor_authorizations_window CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
    CONSTRAINT supervisor_authorizations_consumed_after CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CONSTRAINT supervisor_authorizations_supervisor_fkey FOREIGN KEY (restaurant_id, supervisor_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (supervisor_profile_id),
    CONSTRAINT supervisor_authorizations_requested_by_fkey FOREIGN KEY (restaurant_id, requested_by_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (requested_by_profile_id)
);
--> statement-breakpoint
COMMENT ON TABLE public.supervisor_authorizations IS 'Single-use supervisor authorizations: created by private.create_supervisor_authorization after the API verified the PIN of an admin or cashier, bound to one action and restaurant, valid 2 minutes, consumed once by private.consume_supervisor_authorization. Rows are kept as audit.';
--> statement-breakpoint
CREATE INDEX idx_supervisor_authorizations_restaurant_id ON public.supervisor_authorizations (restaurant_id, created_at);
--> statement-breakpoint
ALTER TABLE public.supervisor_authorizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY supervisor_authorizations_select_policy ON public.supervisor_authorizations FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
REVOKE ALL ON TABLE public.supervisor_authorizations FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.supervisor_authorizations TO vipe_api;
--> statement-breakpoint
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_waiter_access_mode CHECK (key <> 'waiter_access_mode' OR value IN ('own_accounts', 'shared_terminal'));
--> statement-breakpoint
ALTER TABLE public.orders
  ADD COLUMN created_by_profile_id uuid,
  ADD CONSTRAINT orders_created_by_profile_fkey FOREIGN KEY (restaurant_id, created_by_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (created_by_profile_id);
--> statement-breakpoint
COMMENT ON COLUMN public.orders.created_by_profile_id IS 'Profile that took the order (the acting staff member on a shared terminal); NULL for rows written without a caller.';
--> statement-breakpoint
ALTER TABLE public.order_items
  ADD COLUMN created_by_profile_id uuid,
  ADD CONSTRAINT order_items_created_by_profile_fkey FOREIGN KEY (restaurant_id, created_by_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (created_by_profile_id);
--> statement-breakpoint
COMMENT ON COLUMN public.order_items.created_by_profile_id IS 'Profile that added the item (the acting staff member on a shared terminal); NULL for rows written without a caller.';
--> statement-breakpoint
CREATE FUNCTION private.stamp_created_by_profile()
    RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.created_by_profile_id IS NULL THEN
    SELECT p.id INTO NEW.created_by_profile_id
      FROM public.profiles p
     WHERE p.user_id = private.current_user_id()
       AND p.restaurant_id = NEW.restaurant_id
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.stamp_created_by_profile() IS 'BEFORE INSERT on orders and order_items: fills created_by_profile_id with the caller''s profile when it belongs to the row''s restaurant (else leaves NULL, so a superuser or cross-tenant writer never breaks the tenant key).';
--> statement-breakpoint
CREATE TRIGGER orders_stamp_created_by BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.stamp_created_by_profile();
--> statement-breakpoint
CREATE TRIGGER order_items_stamp_created_by BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION private.stamp_created_by_profile();
--> statement-breakpoint
CREATE FUNCTION private.pin_caller()
    RETURNS TABLE (profile_id uuid, restaurant_id uuid, role text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.restaurant_id, p.role::text
    FROM public.profiles p
    JOIN public.users u ON u.id = p.user_id
   WHERE p.user_id = private.current_user_id()
     AND p.active
     AND u.is_active
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIN helpers require an active profile' USING ERRCODE = '42501';
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.pin_caller() IS 'Internal gate of the PIN helpers: the caller''s active profile with an active user (profile, restaurant, role), else 42501. Not executable by vipe_api.';
--> statement-breakpoint
CREATE FUNCTION private.set_staff_pin(p_profile_id uuid, p_pin_hash text, p_pepper_version smallint)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.staff_admin_restaurant();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.restaurant_id = v_restaurant) THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: pin_attempts before staff_pins, as in claim_pin_attempt -> change_own_pin.
  DELETE FROM private.pin_attempts WHERE scope = 'profile' AND subject_id = p_profile_id;
  INSERT INTO public.staff_pins (profile_id, restaurant_id, pin_hash, pin_pepper_version, set_by, set_at, updated_at)
  VALUES (p_profile_id, v_restaurant, p_pin_hash, p_pepper_version, private.current_profile_id(), pg_catalog.now(), pg_catalog.now())
  ON CONFLICT (profile_id) DO UPDATE
     SET pin_hash = excluded.pin_hash, pin_pepper_version = excluded.pin_pepper_version,
         set_by = excluded.set_by, set_at = excluded.set_at, updated_at = excluded.updated_at;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.set_staff_pin(uuid, text, smallint) IS 'Admin sets or resets the PIN hash (and its pepper version) of any profile of the caller''s restaurant (the admin included) and clears its lockout; records set_by/set_at. 42501 when the caller is not an active admin, P0002 for a profile of another restaurant.';
--> statement-breakpoint
CREATE FUNCTION private.clear_staff_pin(p_profile_id uuid)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.staff_admin_restaurant();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.restaurant_id = v_restaurant) THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: pin_attempts before staff_pins (see set_staff_pin).
  DELETE FROM private.pin_attempts WHERE scope = 'profile' AND subject_id = p_profile_id;
  DELETE FROM public.staff_pins WHERE profile_id = p_profile_id AND restaurant_id = v_restaurant;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.clear_staff_pin(uuid) IS 'Admin removes the PIN of a profile of the caller''s restaurant (no-op when it has none) and its lockout. Same gates as private.set_staff_pin.';
--> statement-breakpoint
CREATE FUNCTION private.change_own_pin(p_pin_hash text, p_pepper_version smallint)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  UPDATE public.staff_pins
     SET pin_hash = p_pin_hash, pin_pepper_version = p_pepper_version,
         set_by = v_caller.profile_id, set_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE profile_id = v_caller.profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller has no PIN' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.change_own_pin(text, smallint) IS 'Replaces the caller''s own PIN hash (the API verified the current PIN first). P0002 when the caller has no PIN yet (an admin assigns the first one).';
--> statement-breakpoint
CREATE FUNCTION private.rehash_staff_pin(p_profile_id uuid, p_pin_hash text, p_pepper_version smallint)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  UPDATE public.staff_pins
     SET pin_hash = p_pin_hash, pin_pepper_version = p_pepper_version, updated_at = pg_catalog.now()
   WHERE profile_id = p_profile_id
     AND restaurant_id = v_caller.restaurant_id
     AND pin_pepper_version < p_pepper_version;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.rehash_staff_pin(uuid, text, smallint) IS 'After a correct PIN, upgrades a profile of the caller''s restaurant to a newer pepper version (never downgrades; set_by/set_at unchanged).';
--> statement-breakpoint
CREATE FUNCTION private.pin_check_target(p_profile_id uuid)
    RETURNS TABLE (pin_hash text, pepper_version smallint, role text, eligible boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  RETURN QUERY
  SELECT sp.pin_hash, sp.pin_pepper_version, p.role::text, (p.active AND u.is_active)
    FROM public.staff_pins sp
    JOIN public.profiles p ON p.id = sp.profile_id
    JOIN public.users u ON u.id = p.user_id
   WHERE sp.profile_id = p_profile_id
     AND sp.restaurant_id = v_caller.restaurant_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.pin_check_target(uuid) IS 'PIN hash, pepper version, role and active flag of a profile of the caller''s restaurant, for the API to verify a PIN; no row for a profile without PIN or in another restaurant. 42501 without an active caller profile.';
--> statement-breakpoint
CREATE FUNCTION private.supervisor_pin_candidates(p_now timestamptz)
    RETURNS TABLE (profile_id uuid, pin_hash text, pepper_version smallint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  RETURN QUERY
  SELECT sp.profile_id, sp.pin_hash, sp.pin_pepper_version
    FROM public.staff_pins sp
    JOIN public.profiles p ON p.id = sp.profile_id
    JOIN public.users u ON u.id = p.user_id
    LEFT JOIN private.pin_attempts a ON a.scope = 'profile' AND a.subject_id = sp.profile_id
   WHERE sp.restaurant_id = v_caller.restaurant_id
     AND p.role IN ('admin', 'cashier')
     AND p.active
     AND u.is_active
     AND (a.locked_until IS NULL OR a.locked_until <= p_now)
   ORDER BY sp.set_at, sp.profile_id
   LIMIT 50;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.supervisor_pin_candidates(timestamptz) IS 'Unlocked supervisors (active admin or cashier with an active user and a PIN) of the caller''s restaurant with their PIN hash and pepper version, at most 50: the only PINs POST /auth/authorize without a profile id verifies.';
--> statement-breakpoint
CREATE FUNCTION private.pin_attempt_keys(p_session_id uuid, p_profile_id uuid, p_scopes text[])
    RETURNS TABLE (scope text, subject_id uuid, restaurant_id uuid)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  IF p_scopes IS NULL OR cardinality(p_scopes) = 0 OR NOT (p_scopes <@ ARRAY['session', 'caller', 'profile', 'supervisors']) THEN
    RAISE EXCEPTION 'pin_attempt_keys: unknown scope' USING ERRCODE = '22023';
  END IF;
  IF 'session' = ANY(p_scopes) AND NOT EXISTS (
    SELECT 1 FROM public.auth_sessions s WHERE s.id = p_session_id AND s.user_id = private.current_user_id()
  ) THEN
    RAISE EXCEPTION 'not a session of the caller' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.scope, k.subject_id, v_caller.restaurant_id
    FROM (VALUES
      ('session', CASE WHEN 'session' = ANY(p_scopes) THEN p_session_id END),
      ('caller', CASE WHEN 'caller' = ANY(p_scopes) THEN v_caller.profile_id END),
      -- A profile of another restaurant (or an unknown id) is not counted:
      -- the session and caller scopes still are.
      ('profile', CASE WHEN 'profile' = ANY(p_scopes) AND EXISTS (
         SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id AND p.restaurant_id = v_caller.restaurant_id) THEN p_profile_id END),
      ('supervisors', CASE WHEN 'supervisors' = ANY(p_scopes) THEN v_caller.restaurant_id END)
    ) AS k(scope, subject_id)
   WHERE k.subject_id IS NOT NULL
   ORDER BY k.scope, k.subject_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.pin_attempt_keys(uuid, uuid, text[]) IS 'Internal: the (scope, subject) counters an attempt touches, in lock order. 42501 for a session that is not the caller''s, 22023 for an unknown scope. Not executable by vipe_api.';
--> statement-breakpoint
CREATE FUNCTION private.claim_pin_attempt(p_session_id uuid, p_profile_id uuid, p_scopes text[], p_now timestamptz)
    RETURNS timestamptz
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  -- Documented in the header: 5 attempts within 15 minutes lock for 5 minutes.
  c_max_attempts constant integer := 5;
  c_window constant interval := interval '15 minutes';
  c_lock constant interval := interval '5 minutes';
  v_key record;
  v_scopes text[] := ARRAY[]::text[];
  v_subjects uuid[] := ARRAY[]::uuid[];
  v_until timestamptz;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'claim_pin_attempt: p_now is required' USING ERRCODE = '22023';
  END IF;
  -- Create, then lock, the counters in (scope, subject) order: concurrent
  -- attempts queue on the same rows and never deadlock.
  FOR v_key IN SELECT * FROM private.pin_attempt_keys(p_session_id, p_profile_id, p_scopes) LOOP
    INSERT INTO private.pin_attempts (scope, subject_id, restaurant_id)
    VALUES (v_key.scope, v_key.subject_id, v_key.restaurant_id)
    ON CONFLICT (scope, subject_id) DO NOTHING;
    v_scopes := v_scopes || v_key.scope;
    v_subjects := v_subjects || v_key.subject_id;
  END LOOP;
  PERFORM 1
     FROM private.pin_attempts a
     JOIN unnest(v_scopes, v_subjects) AS k(scope, subject_id) ON k.scope = a.scope AND k.subject_id = a.subject_id
    ORDER BY a.scope, a.subject_id
      FOR UPDATE OF a;
  SELECT max(a.locked_until) INTO v_until
    FROM private.pin_attempts a
    JOIN unnest(v_scopes, v_subjects) AS k(scope, subject_id) ON k.scope = a.scope AND k.subject_id = a.subject_id
   WHERE a.locked_until > p_now;
  IF v_until IS NOT NULL THEN
    RETURN v_until;
  END IF;
  UPDATE private.pin_attempts a
     SET failed_attempts = CASE WHEN n.next >= c_max_attempts THEN 0 ELSE n.next END,
         window_started_at = CASE WHEN n.next >= c_max_attempts THEN NULL WHEN n.next = 1 THEN p_now ELSE a.window_started_at END,
         locked_until = CASE WHEN n.next >= c_max_attempts THEN p_now + c_lock ELSE NULL END
    FROM (
      SELECT b.scope, b.subject_id,
             CASE WHEN b.window_started_at IS NULL OR b.window_started_at <= p_now - c_window THEN 1 ELSE b.failed_attempts + 1 END AS next
        FROM private.pin_attempts b
        JOIN unnest(v_scopes, v_subjects) AS k(scope, subject_id) ON k.scope = b.scope AND k.subject_id = b.subject_id
    ) AS n
   WHERE a.scope = n.scope AND a.subject_id = n.subject_id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.claim_pin_attempt(uuid, uuid, text[], timestamptz) IS 'Counts one PIN attempt on every claimed scope (session, caller, profile, supervisors) BEFORE the PIN is verified, under row locks taken in a fixed order, and returns NULL; when any scope is locked it changes nothing and returns the latest locked_until. The 5th attempt within 15 minutes locks every claimed scope until p_now + 5 minutes. A correct PIN is followed by private.clear_pin_attempts.';
--> statement-breakpoint
CREATE FUNCTION private.clear_pin_attempts(p_session_id uuid, p_profile_id uuid, p_scopes text[])
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM private.pin_attempts a
   USING private.pin_attempt_keys(p_session_id, p_profile_id, p_scopes) k
   WHERE a.scope = k.scope AND a.subject_id = k.subject_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.clear_pin_attempts(uuid, uuid, text[]) IS 'After a correct PIN: clears the counters of the claimed scopes (same resolution and gates as claim_pin_attempt).';
--> statement-breakpoint
CREATE FUNCTION private.staff_pin_locks(p_now timestamptz)
    RETURNS TABLE (profile_id uuid, locked_until timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid := private.staff_admin_restaurant();
BEGIN
  RETURN QUERY
  SELECT a.subject_id, a.locked_until
    FROM private.pin_attempts a
   WHERE a.scope = 'profile' AND a.restaurant_id = v_restaurant AND a.locked_until > p_now;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.staff_pin_locks(timestamptz) IS 'Admin: running PIN lockouts of the profiles of the caller''s restaurant (for the staff list). 42501 when the caller is not an active admin.';
--> statement-breakpoint
CREATE FUNCTION private.create_terminal_session(p_user_id uuid, p_refresh_hash text, p_expires_at timestamp with time zone)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.users u
      JOIN public.profiles p ON p.user_id = u.id
     WHERE u.id = p_user_id AND u.is_active AND p.active AND p.role IN ('admin', 'cashier')
  ) THEN
    RAISE EXCEPTION 'a terminal is opened by an active admin or cashier' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at, kind)
  VALUES (p_user_id, p_refresh_hash, p_expires_at, 'terminal')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_terminal_session(uuid, text, timestamp with time zone) IS 'Opens a terminal session (shared order-taking device) for an active admin or cashier with an active user; 42501 otherwise. Runs on the public terminal login route, after the API verified the password.';
--> statement-breakpoint
CREATE FUNCTION private.open_acting_session(p_terminal_session_id uuid, p_profile_id uuid, p_refresh_hash text, p_expires_at timestamp with time zone)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
  v_user uuid;
  v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  IF NOT EXISTS (
    SELECT 1 FROM public.auth_sessions s
     WHERE s.id = p_terminal_session_id
       AND s.user_id = private.current_user_id()
       AND s.kind = 'terminal'
       AND s.revoked_at IS NULL
       AND s.expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'acting sessions are opened from a live terminal of the caller' USING ERRCODE = '42501';
  END IF;
  SELECT p.user_id INTO v_user
    FROM public.profiles p
    JOIN public.users u ON u.id = p.user_id
    JOIN public.staff_pins sp ON sp.profile_id = p.id
   WHERE p.id = p_profile_id
     AND p.restaurant_id = v_caller.restaurant_id
     AND p.active
     AND u.is_active
     AND p.role IN ('admin', 'cashier', 'waiter');
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'staff profile not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.auth_sessions (user_id, refresh_hash, expires_at, kind, parent_session_id)
  VALUES (v_user, p_refresh_hash, LEAST(p_expires_at, pg_catalog.now() + interval '10 minutes'), 'acting', p_terminal_session_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.open_acting_session(uuid, uuid, text, timestamp with time zone) IS 'Opens an acting session for a staff member (active admin, cashier or waiter with a PIN, same restaurant) under one of the caller''s live terminal sessions, after the API verified the PIN; expires at most 10 minutes ahead. 42501 for a session that is not a live terminal of the caller, P0002 for an ineligible profile.';
--> statement-breakpoint
CREATE FUNCTION private.session_is_live(p_session_id uuid)
    RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.auth_sessions s
      LEFT JOIN public.auth_sessions parent ON parent.id = s.parent_session_id
     WHERE s.id = p_session_id
       AND s.user_id = private.current_user_id()
       AND s.revoked_at IS NULL
       AND s.expires_at > pg_catalog.now()
       AND (s.parent_session_id IS NULL OR (parent.revoked_at IS NULL AND parent.expires_at > pg_catalog.now()))
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.session_is_live(uuid) IS 'Is this session of the caller live (not revoked, not expired) and, for an acting session, is its terminal live too? False for any other user''s session.';
--> statement-breakpoint
DROP FUNCTION private.rotate_session(text, text, timestamp with time zone);
--> statement-breakpoint
CREATE FUNCTION private.rotate_session(p_refresh_hash text, p_new_refresh_hash text, p_expires_at timestamp with time zone)
    RETURNS TABLE (id uuid, user_id uuid, kind text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.auth_sessions s
     SET refresh_hash = p_new_refresh_hash, expires_at = p_expires_at
    FROM public.users u
   WHERE s.refresh_hash = p_refresh_hash
     AND s.kind <> 'acting'
     AND s.revoked_at IS NULL
     AND s.expires_at > pg_catalog.now()
     AND u.id = s.user_id
     AND u.is_active
     AND (s.kind <> 'terminal' OR EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.user_id = s.user_id AND p.active AND p.role IN ('admin', 'cashier')))
  RETURNING s.id, s.user_id, s.kind
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.rotate_session(text, text, timestamp with time zone) IS 'Swaps the refresh hash of a live session (not revoked, not expired, active user) in one UPDATE and returns (id, user_id, kind); no row otherwise. Acting sessions never rotate; a terminal rotates only while its user is an active admin or cashier. The old hash never matches again; concurrent rotations of the same token have one winner.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.rotate_session(text, text, timestamp with time zone) TO vipe_api;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.revoke_session(p_refresh_hash text)
    RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH revoked AS (
    UPDATE public.auth_sessions
       SET revoked_at = pg_catalog.now()
     WHERE refresh_hash = p_refresh_hash
       AND revoked_at IS NULL
    RETURNING id
  )
  UPDATE public.auth_sessions c
     SET revoked_at = pg_catalog.now()
    FROM revoked
   WHERE c.parent_session_id = revoked.id
     AND c.revoked_at IS NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.revoke_session(text) IS 'Revokes the session holding that refresh hash (logout) and its acting sessions. No-op when the hash is unknown or already revoked.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.revoke_session_by_id(p_session_id uuid)
    RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH revoked AS (
    UPDATE public.auth_sessions
       SET revoked_at = pg_catalog.now()
     WHERE id = p_session_id
       AND revoked_at IS NULL
    RETURNING id
  )
  UPDATE public.auth_sessions c
     SET revoked_at = pg_catalog.now()
    FROM revoked
   WHERE c.parent_session_id = revoked.id
     AND c.revoked_at IS NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.revoke_session_by_id(uuid) IS 'Revokes the session with that id (logout with only the access token, by its sid claim) and its acting sessions. No-op when the id is unknown or already revoked.';
--> statement-breakpoint
CREATE FUNCTION private.create_supervisor_authorization(p_supervisor_profile_id uuid, p_action text, p_now timestamptz)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
  v_id uuid;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'create_supervisor_authorization: p_now is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.users u ON u.id = p.user_id
      JOIN public.staff_pins sp ON sp.profile_id = p.id
     WHERE p.id = p_supervisor_profile_id
       AND p.restaurant_id = v_caller.restaurant_id
       AND p.role IN ('admin', 'cashier')
       AND p.active
       AND u.is_active
  ) THEN
    RAISE EXCEPTION 'not a supervisor of the caller''s restaurant' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.supervisor_authorizations
    (restaurant_id, action, supervisor_profile_id, requested_by_profile_id, created_at, expires_at)
  VALUES
    (v_caller.restaurant_id, p_action, p_supervisor_profile_id, v_caller.profile_id, p_now, p_now + interval '2 minutes')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.create_supervisor_authorization(uuid, text, timestamptz) IS 'Records a supervisor authorization for one action in the caller''s restaurant, valid from p_now for 2 minutes, after the API verified the supervisor PIN. Supervisor roles: admin, cashier (same list as SUPERVISOR_ROLES in the API). 42501 when the supervisor is not an active admin/cashier with a PIN of the caller''s restaurant.';
--> statement-breakpoint
CREATE FUNCTION private.consume_supervisor_authorization(p_id uuid, p_action text, p_now timestamptz)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller record;
  v_supervisor uuid;
BEGIN
  SELECT * INTO v_caller FROM private.pin_caller();
  UPDATE public.supervisor_authorizations a
     SET consumed_at = p_now
   WHERE a.id = p_id
     AND a.restaurant_id = v_caller.restaurant_id
     AND a.action = p_action
     AND a.consumed_at IS NULL
     AND a.expires_at > p_now
     AND p_now >= a.created_at
  RETURNING a.supervisor_profile_id INTO v_supervisor;
  RETURN v_supervisor;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.consume_supervisor_authorization(uuid, text, timestamptz) IS 'Consumes once an unexpired authorization of the caller''s restaurant for that action and returns its supervisor profile id; NULL when unknown, foreign, for another action, expired or already used.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.pin_caller() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.pin_attempt_keys(uuid, uuid, text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.stamp_created_by_profile() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.set_staff_pin(uuid, text, smallint) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.clear_staff_pin(uuid) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.change_own_pin(text, smallint) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.rehash_staff_pin(uuid, text, smallint) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.pin_check_target(uuid) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.supervisor_pin_candidates(timestamptz) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.claim_pin_attempt(uuid, uuid, text[], timestamptz) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.clear_pin_attempts(uuid, uuid, text[]) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.staff_pin_locks(timestamptz) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_terminal_session(uuid, text, timestamp with time zone) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.open_acting_session(uuid, uuid, text, timestamp with time zone) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.session_is_live(uuid) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.create_supervisor_authorization(uuid, text, timestamptz) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.consume_supervisor_authorization(uuid, text, timestamptz) TO vipe_api;
