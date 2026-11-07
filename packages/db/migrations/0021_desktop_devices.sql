-- Desktop devices (odd/tasks/fase3-operacion.md F5a, L10, L12, L34; contract
-- desktop/API-CONTRACT.md on feat/fase3-f5b-desktop).
--
-- 1. public.desktop_devices: a paired VIPE desktop app of one restaurant. The
--    device token (`vdt_` + 32 random bytes) is never stored, only its sha256
--    (token_hash, never granted to vipe_api). vipe_api reads the other columns
--    and updates name and revoked_at as an admin of the restaurant (RLS).
-- 2. public.desktop_pairing_codes: single-use 6-digit codes (sha256 only),
--    valid 10 minutes; no grant, reached only through the functions below.
--    A live (unclaimed) hash is unique.
-- 3. private.desktop_pairing_attempts: wrong codes per IP (5) and globally
--    (100) in 10-minute windows; only an unknown code counts. The rows are
--    locked in key order ('global' < 'ip:...') before the code is looked up.
-- 4. public.desktop_printers / desktop_printer_stations: metadata of the
--    device's local printers and the stations each serves (admin reads;
--    replaced atomically by private.desktop_put_printers).
-- 5. public.desktop_job_acks: one ack per (job, device); the first wins.
--    `printed` also sets print_jobs.printed_at. Pending for device D: jobs of
--    D's restaurant created at or after D, not acked by D, with no station or
--    a station D's printers serve, oldest first by (created_at, id).
-- 6. public.desktop_drawer_events: "Abrir cajón" records (admin reads).
-- 7. public.desktop_releases: signed builds per channel and target, global,
--    written by the publishing script as vipe_migrator; vipe_api reads them.
-- Every device entry point is SECURITY DEFINER, keyed by the token hash, and
-- re-checks revoked_at on each call (private.desktop_live_device), so a
-- revoke is immediate.
--
-- Error messages are `<function>: <code>`: 42501 desktop: device_revoked
-- (unknown or revoked token), desktop_create_pairing_code: admin_required;
-- P0001 desktop_create_pairing_code: collision; 22023
-- desktop_put_printers: station_invalid, too_many_printers, printers_invalid.
CREATE TABLE public.desktop_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    platform text DEFAULT 'windows' NOT NULL,
    app_version text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    queue_pending integer DEFAULT 0 NOT NULL,
    queue_failed integer DEFAULT 0 NOT NULL,
    printer_status jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT desktop_devices_pkey PRIMARY KEY (id),
    CONSTRAINT desktop_devices_token_hash_key UNIQUE (token_hash),
    CONSTRAINT desktop_devices_restaurant_id_id_key UNIQUE (restaurant_id, id),
    CONSTRAINT desktop_devices_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT desktop_devices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT desktop_devices_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    CONSTRAINT desktop_devices_platform_check CHECK (platform = 'windows'),
    CONSTRAINT desktop_devices_app_version_check CHECK (length(app_version) BETWEEN 1 AND 32),
    CONSTRAINT desktop_devices_queue_check CHECK (queue_pending >= 0 AND queue_failed >= 0),
    CONSTRAINT desktop_devices_printer_status_check CHECK (jsonb_typeof(printer_status) = 'array')
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_devices IS 'Paired VIPE desktop apps. token_hash is the sha256 (hex) of the device token returned once by the pairing claim; vipe_api cannot read it.';
--> statement-breakpoint
CREATE TABLE public.desktop_pairing_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    code_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + interval '10 minutes') NOT NULL,
    claimed_at timestamp with time zone,
    device_id uuid,
    CONSTRAINT desktop_pairing_codes_pkey PRIMARY KEY (id),
    CONSTRAINT desktop_pairing_codes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE,
    CONSTRAINT desktop_pairing_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT desktop_pairing_codes_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.desktop_devices(id) ON DELETE SET NULL
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_pairing_codes IS 'Single-use pairing codes (sha256 of the 6 digits), valid 10 minutes. No grant: reached through private.desktop_create_pairing_code, desktop_pairing_preview and desktop_pairing_claim.';
--> statement-breakpoint
CREATE UNIQUE INDEX desktop_pairing_codes_live_key ON public.desktop_pairing_codes USING btree (code_hash) WHERE claimed_at IS NULL;
--> statement-breakpoint
CREATE INDEX desktop_pairing_codes_code_hash_idx ON public.desktop_pairing_codes USING btree (code_hash);
--> statement-breakpoint
CREATE TABLE private.desktop_pairing_attempts (
    key text NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    failures integer DEFAULT 0 NOT NULL,
    CONSTRAINT desktop_pairing_attempts_pkey PRIMARY KEY (key)
);
--> statement-breakpoint
COMMENT ON TABLE private.desktop_pairing_attempts IS 'Wrong pairing codes per 10-minute window: key ip:<sha256 of the client IP> (5 allowed) or global (100 allowed).';
--> statement-breakpoint
CREATE TABLE public.desktop_printers (
    device_id uuid NOT NULL,
    id text NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    model text DEFAULT '' NOT NULL,
    connection text NOT NULL,
    paper_mm integer NOT NULL,
    has_drawer boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT desktop_printers_pkey PRIMARY KEY (device_id, id),
    CONSTRAINT desktop_printers_device_fkey FOREIGN KEY (restaurant_id, device_id) REFERENCES public.desktop_devices(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT desktop_printers_id_check CHECK (length(id) BETWEEN 1 AND 64),
    CONSTRAINT desktop_printers_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT desktop_printers_model_check CHECK (length(model) <= 80),
    CONSTRAINT desktop_printers_connection_check CHECK (connection IN ('usb', 'network', 'bluetooth')),
    CONSTRAINT desktop_printers_paper_mm_check CHECK (paper_mm IN (58, 80))
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_printers IS 'Printers of a desktop device (metadata only; addresses stay on the computer). id is the app''s local id. Written by private.desktop_put_printers.';
--> statement-breakpoint
CREATE TABLE public.desktop_printer_stations (
    device_id uuid NOT NULL,
    printer_id text NOT NULL,
    restaurant_id uuid NOT NULL,
    station_id uuid NOT NULL,
    CONSTRAINT desktop_printer_stations_pkey PRIMARY KEY (device_id, printer_id, station_id),
    CONSTRAINT desktop_printer_stations_printer_fkey FOREIGN KEY (device_id, printer_id) REFERENCES public.desktop_printers(device_id, id) ON DELETE CASCADE,
    CONSTRAINT desktop_printer_stations_station_fkey FOREIGN KEY (restaurant_id, station_id) REFERENCES public.stations(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT desktop_printer_stations_device_fkey FOREIGN KEY (restaurant_id, device_id) REFERENCES public.desktop_devices(restaurant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_printer_stations IS 'Stations a device printer serves; a job of one of them is pending for the device. A deleted station drops its rows.';
--> statement-breakpoint
CREATE INDEX desktop_printer_stations_station_idx ON public.desktop_printer_stations USING btree (station_id);
--> statement-breakpoint
CREATE TABLE public.desktop_job_acks (
    job_id uuid NOT NULL,
    device_id uuid NOT NULL,
    status text NOT NULL,
    reason text,
    acked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT desktop_job_acks_pkey PRIMARY KEY (job_id, device_id),
    CONSTRAINT desktop_job_acks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.print_jobs(id) ON DELETE CASCADE,
    CONSTRAINT desktop_job_acks_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.desktop_devices(id) ON DELETE CASCADE,
    CONSTRAINT desktop_job_acks_status_check CHECK (status IN ('printed', 'skipped', 'cancelled')),
    CONSTRAINT desktop_job_acks_reason_check CHECK (reason IS NULL OR length(reason) <= 200)
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_job_acks IS 'Per-device acknowledgement of a print job; the first one wins (private.desktop_ack_job).';
--> statement-breakpoint
CREATE INDEX desktop_job_acks_device_idx ON public.desktop_job_acks USING btree (device_id);
--> statement-breakpoint
CREATE TABLE public.desktop_drawer_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    device_id uuid NOT NULL,
    printer_id text NOT NULL,
    opened_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    profile_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT desktop_drawer_events_pkey PRIMARY KEY (id),
    CONSTRAINT desktop_drawer_events_device_fkey FOREIGN KEY (restaurant_id, device_id) REFERENCES public.desktop_devices(restaurant_id, id) ON DELETE CASCADE,
    CONSTRAINT desktop_drawer_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT desktop_drawer_events_printer_id_check CHECK (length(printer_id) BETWEEN 1 AND 64),
    CONSTRAINT desktop_drawer_events_reason_check CHECK (reason IN ('manual', 'cash_payment'))
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_drawer_events IS 'Cash drawer openings reported by a desktop device (L10). profile_id is kept only when it is staff of the restaurant.';
--> statement-breakpoint
CREATE INDEX desktop_drawer_events_restaurant_idx ON public.desktop_drawer_events USING btree (restaurant_id, opened_at);
--> statement-breakpoint
CREATE TABLE public.desktop_releases (
    channel text NOT NULL,
    target text NOT NULL,
    version text NOT NULL,
    file text NOT NULL,
    signature text NOT NULL,
    notes text DEFAULT '' NOT NULL,
    pub_date timestamp with time zone DEFAULT now() NOT NULL,
    required boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT desktop_releases_pkey PRIMARY KEY (channel, target, version),
    CONSTRAINT desktop_releases_channel_check CHECK (channel IN ('stable', 'pilot')),
    CONSTRAINT desktop_releases_target_check CHECK (target ~ '^[a-z0-9_-]{1,40}$'),
    CONSTRAINT desktop_releases_version_check CHECK (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
    CONSTRAINT desktop_releases_file_check CHECK (length(file) BETWEEN 1 AND 300)
);
--> statement-breakpoint
COMMENT ON TABLE public.desktop_releases IS 'Signed desktop builds per channel and target (e.g. windows-x86_64). Global; inserted by the F5c publishing script as vipe_migrator. file is the object key under DESKTOP_RELEASES_BASE_URL.';
--> statement-breakpoint
ALTER TABLE public.desktop_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_pairing_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE private.desktop_pairing_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_printers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_printer_stations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_job_acks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_drawer_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.desktop_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY desktop_devices_select_policy ON public.desktop_devices FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY desktop_devices_update_policy ON public.desktop_devices FOR UPDATE TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)))) WITH CHECK (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY desktop_printers_select_policy ON public.desktop_printers FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY desktop_printer_stations_select_policy ON public.desktop_printer_stations FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY desktop_drawer_events_select_policy ON public.desktop_drawer_events FOR SELECT TO vipe_api USING (((( SELECT private.current_app_role() AS current_app_role) = 'admin'::text) AND (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))));
--> statement-breakpoint
CREATE POLICY desktop_releases_select_policy ON public.desktop_releases FOR SELECT TO vipe_api USING (true);
--> statement-breakpoint
-- The baseline default privileges grant full DML on new tables; narrow them.
REVOKE ALL ON TABLE public.desktop_devices FROM vipe_api;
--> statement-breakpoint
GRANT SELECT (id, restaurant_id, name, platform, app_version, created_by, created_at, last_seen_at, revoked_at, queue_pending, queue_failed, printer_status) ON TABLE public.desktop_devices TO vipe_api;
--> statement-breakpoint
GRANT UPDATE (name, revoked_at) ON TABLE public.desktop_devices TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_pairing_codes FROM vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE private.desktop_pairing_attempts FROM vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_printers FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.desktop_printers TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_printer_stations FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.desktop_printer_stations TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_job_acks FROM vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_drawer_events FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.desktop_drawer_events TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.desktop_releases FROM vipe_api;
--> statement-breakpoint
GRANT SELECT ON TABLE public.desktop_releases TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_live_device(p_token_hash text, OUT device_id uuid, OUT restaurant_id uuid, OUT created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  SELECT d.id, d.restaurant_id, d.created_at INTO device_id, restaurant_id, created_at
    FROM public.desktop_devices d
   WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL;
  IF device_id IS NULL THEN
    RAISE EXCEPTION 'desktop: device_revoked' USING ERRCODE = '42501';
  END IF;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_live_device(text) IS 'The live device of a token hash; 42501 desktop: device_revoked for an unknown or revoked one. Internal: every device entry point calls it first.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_live_device(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.desktop_touch(p_token_hash text)
    RETURNS TABLE(device_id uuid, restaurant_id uuid, revoked boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH live AS (
    UPDATE public.desktop_devices d SET last_seen_at = now()
     WHERE d.token_hash = p_token_hash AND d.revoked_at IS NULL
    RETURNING d.id, d.restaurant_id
  )
  SELECT live.id, live.restaurant_id, false FROM live
  UNION ALL
  SELECT d.id, d.restaurant_id, true FROM public.desktop_devices d
   WHERE d.token_hash = p_token_hash AND d.revoked_at IS NOT NULL
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_touch(text) IS 'Device authentication: the device and restaurant of a token hash and whether it is revoked; records last_seen_at only for a live device. No row for an unknown token.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_touch(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_touch(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_create_pairing_code(p_code_hashes text[])
    RETURNS TABLE(attempt integer, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_restaurant uuid := private.current_restaurant_id();
  v_expires timestamptz;
BEGIN
  IF v_restaurant IS NULL OR private.current_app_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'desktop_create_pairing_code: admin_required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.desktop_pairing_codes c WHERE c.claimed_at IS NULL AND c.expires_at <= now();
  FOR i IN 1 .. coalesce(pg_catalog.array_length(p_code_hashes, 1), 0) LOOP
    INSERT INTO public.desktop_pairing_codes AS c (restaurant_id, code_hash, created_by, created_at, expires_at)
    VALUES (v_restaurant, p_code_hashes[i], private.current_profile_id(), now(), now() + interval '10 minutes')
    ON CONFLICT (code_hash) WHERE claimed_at IS NULL DO NOTHING
    RETURNING c.expires_at INTO v_expires;
    IF v_expires IS NOT NULL THEN
      RETURN QUERY SELECT i, v_expires;
      RETURN;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'desktop_create_pairing_code: collision' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_create_pairing_code(text[]) IS 'Admin: deletes expired unclaimed codes, then stores the first candidate hash that is not a live code of any restaurant (valid 10 minutes); attempt is its 1-based index. P0001 collision when all collide.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_create_pairing_code(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_create_pairing_code(text[]) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_pairing_blocked(p_ip_key text)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_ip_key IS NULL OR p_ip_key NOT LIKE 'ip:%' THEN
    RAISE EXCEPTION 'desktop_pairing: ip_key_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.desktop_pairing_attempts (key) VALUES ('global'), (p_ip_key) ON CONFLICT (key) DO NOTHING;
  -- Key order ('global' < 'ip:...'): concurrent attempts never lock in opposite orders.
  PERFORM 1 FROM private.desktop_pairing_attempts a WHERE a.key IN ('global', p_ip_key) ORDER BY a.key FOR UPDATE;
  UPDATE private.desktop_pairing_attempts a SET failures = 0, window_started_at = now()
   WHERE a.key IN ('global', p_ip_key) AND a.window_started_at <= now() - interval '10 minutes';
  RETURN EXISTS (
    SELECT 1 FROM private.desktop_pairing_attempts a
     WHERE (a.key = 'global' AND a.failures >= 100) OR (a.key = p_ip_key AND a.failures >= 5));
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_pairing_blocked(text) IS 'Locks the global and IP attempt rows (window of 10 minutes) and says whether 5 wrong codes from the IP or 100 overall refuse the attempt. Internal.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_pairing_blocked(text) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.desktop_pairing_restaurant(p_restaurant_id uuid)
    RETURNS TABLE(restaurant_name text, business_name text, business_address text, channel text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT r.name::text,
         (SELECT bc.value FROM public.business_config bc WHERE bc.restaurant_id = r.id AND bc.key = 'business_name'),
         (SELECT bc.value FROM public.business_config bc WHERE bc.restaurant_id = r.id AND bc.key = 'business_address'),
         CASE WHEN (SELECT bc.value FROM public.business_config bc WHERE bc.restaurant_id = r.id AND bc.key = 'desktop_update_channel') = 'pilot'
              THEN 'pilot' ELSE 'stable' END
    FROM public.restaurants r WHERE r.id = p_restaurant_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_pairing_restaurant(uuid) IS 'Name, stored business name and address, and update channel (pilot or stable) of a restaurant. Internal.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_pairing_restaurant(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION private.desktop_pairing_preview(p_code_hash text, p_ip_key text)
    RETURNS TABLE(status text, restaurant_id uuid, restaurant_name text, business_name text, business_address text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_code public.desktop_pairing_codes%ROWTYPE;
BEGIN
  IF private.desktop_pairing_blocked(p_ip_key) THEN
    RETURN QUERY SELECT 'attempts'::text, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT c.* INTO v_code FROM public.desktop_pairing_codes c
   WHERE c.code_hash = p_code_hash ORDER BY (c.claimed_at IS NULL) DESC, c.created_at DESC LIMIT 1;
  IF v_code.id IS NULL THEN
    UPDATE private.desktop_pairing_attempts a SET failures = a.failures + 1 WHERE a.key IN ('global', p_ip_key);
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_code.claimed_at IS NOT NULL OR v_code.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, v_code.restaurant_id, r.restaurant_name, r.business_name, r.business_address
    FROM private.desktop_pairing_restaurant(v_code.restaurant_id) r;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_pairing_preview(text, text) IS 'Pairing preview without a user: status ok (with the restaurant), invalid (unknown code, counted as a wrong code), expired (expired or claimed) or attempts (IP or global limit).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_pairing_preview(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_pairing_preview(text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_pairing_claim(p_code_hash text, p_ip_key text, p_name text, p_platform text, p_app_version text, p_token_hash text)
    RETURNS TABLE(status text, device_id uuid, restaurant_id uuid, restaurant_name text, business_name text, business_address text, channel text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_code public.desktop_pairing_codes%ROWTYPE;
  v_device uuid;
BEGIN
  IF private.desktop_pairing_blocked(p_ip_key) THEN
    RETURN QUERY SELECT 'attempts'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT c.* INTO v_code FROM public.desktop_pairing_codes c
   WHERE c.code_hash = p_code_hash ORDER BY (c.claimed_at IS NULL) DESC, c.created_at DESC LIMIT 1
     FOR UPDATE;
  IF v_code.id IS NULL THEN
    UPDATE private.desktop_pairing_attempts a SET failures = a.failures + 1 WHERE a.key IN ('global', p_ip_key);
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_code.claimed_at IS NOT NULL OR v_code.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  INSERT INTO public.desktop_devices (restaurant_id, name, platform, app_version, token_hash, created_by)
  VALUES (v_code.restaurant_id, p_name, p_platform, p_app_version, p_token_hash, v_code.created_by)
  RETURNING id INTO v_device;
  UPDATE public.desktop_pairing_codes c SET claimed_at = now(), device_id = v_device WHERE c.id = v_code.id;
  RETURN QUERY SELECT 'ok'::text, v_device, v_code.restaurant_id, r.restaurant_name, r.business_name, r.business_address, r.channel
    FROM private.desktop_pairing_restaurant(v_code.restaurant_id) r;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_pairing_claim(text, text, text, text, text, text) IS 'Pairing claim without a user: locks the code row, creates the device with the token hash and marks the code claimed (single use). Same statuses as desktop_pairing_preview; ok also returns the device and the restaurant channel.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_pairing_claim(text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_pairing_claim(text, text, text, text, text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_heartbeat(p_token_hash text, p_app_version text, p_printers jsonb, p_pending integer, p_failed integer)
    RETURNS TABLE(channel text, printing_enabled boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_device uuid;
  v_restaurant uuid;
BEGIN
  SELECT l.device_id, l.restaurant_id INTO v_device, v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  UPDATE public.desktop_devices d
     SET app_version = p_app_version, printer_status = coalesce(p_printers, '[]'::jsonb),
         queue_pending = greatest(coalesce(p_pending, 0), 0), queue_failed = greatest(coalesce(p_failed, 0), 0), last_seen_at = now()
   WHERE d.id = v_device;
  RETURN QUERY SELECT r.channel,
         coalesce((SELECT bc.value FROM public.business_config bc WHERE bc.restaurant_id = v_restaurant AND bc.key = 'printing_enabled'), 'true') <> 'false'
    FROM private.desktop_pairing_restaurant(v_restaurant) r;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_heartbeat(text, text, jsonb, integer, integer) IS 'Device heartbeat: stores app version, printer status and queue counts, and answers the restaurant channel and printing_enabled (missing = true).';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_heartbeat(text, text, jsonb, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_heartbeat(text, text, jsonb, integer, integer) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_stations(p_token_hash text)
    RETURNS TABLE(id uuid, name text, kind text, color text, fixed boolean, prints text, product_count integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_restaurant uuid;
  v_default uuid;
BEGIN
  SELECT l.restaurant_id INTO v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  SELECT s.id INTO v_default FROM public.stations s WHERE s.restaurant_id = v_restaurant AND s.is_default;
  RETURN QUERY
  SELECT s.id, s.name, s.kind, s.color, s.kind = 'cashier',
         CASE WHEN s.kind = 'cashier' THEN 'Facturas y precuentas'
              ELSE coalesce((
                SELECT pg_catalog.string_agg(c.name::text, ', ' ORDER BY c.sort_order, lower(c.name), c.id)
                  FROM public.categories c
                  LEFT JOIN public.stations cs ON cs.id = c.station_id AND cs.kind = 'prep'
                 WHERE c.restaurant_id = v_restaurant AND c.active AND coalesce(cs.id, v_default) = s.id), '') END,
         CASE WHEN s.kind = 'cashier' THEN 0
              ELSE (SELECT pg_catalog.count(*)::integer FROM public.dishes d
                      CROSS JOIN LATERAL private.route_dish_in(v_restaurant, d.id) r
                     WHERE d.restaurant_id = v_restaurant AND d.active AND r.station_id = s.id) END
    FROM public.stations s
   WHERE s.restaurant_id = v_restaurant
   ORDER BY s.sort_order, lower(s.name), s.id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_stations(text) IS 'Stations of the device''s restaurant with the read-only "Qué imprime" (active categories routed there, the default station also takes categories without one; Caja: Facturas y precuentas) and how many active dishes route there.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_stations(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_stations(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_put_printers(p_token_hash text, p_printers jsonb)
    RETURNS TABLE(id text, name text, model text, connection text, paper_mm integer, has_drawer boolean, station_ids uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_device uuid;
  v_restaurant uuid;
BEGIN
  SELECT l.device_id, l.restaurant_id INTO v_device, v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  IF p_printers IS NULL OR pg_catalog.jsonb_typeof(p_printers) <> 'array'
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_printers) e(p)
                 WHERE pg_catalog.jsonb_typeof(e.p) <> 'object' OR pg_catalog.jsonb_typeof(coalesce(e.p -> 'stationIds', '[]')) <> 'array') THEN
    RAISE EXCEPTION 'desktop_put_printers: printers_invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(p_printers) > 20 THEN
    RAISE EXCEPTION 'desktop_put_printers: too_many_printers' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_printers) e(p)
               CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(coalesce(e.p -> 'stationIds', '[]')) sid(v)
              WHERE NOT EXISTS (SELECT 1 FROM public.stations s WHERE s.restaurant_id = v_restaurant AND s.id::text = sid.v)) THEN
    RAISE EXCEPTION 'desktop_put_printers: station_invalid' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.desktop_printers dp WHERE dp.device_id = v_device;
  INSERT INTO public.desktop_printers (device_id, id, restaurant_id, name, model, connection, paper_mm, has_drawer)
  SELECT v_device, e.p ->> 'id', v_restaurant, e.p ->> 'name', coalesce(e.p ->> 'model', ''), e.p ->> 'connection',
         (e.p ->> 'paperMm')::integer, coalesce((e.p ->> 'hasDrawer')::boolean, false)
    FROM pg_catalog.jsonb_array_elements(p_printers) e(p);
  INSERT INTO public.desktop_printer_stations (device_id, printer_id, restaurant_id, station_id)
  SELECT DISTINCT v_device, e.p ->> 'id', v_restaurant, sid.v::uuid
    FROM pg_catalog.jsonb_array_elements(p_printers) e(p)
   CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(coalesce(e.p -> 'stationIds', '[]')) sid(v);
  RETURN QUERY
  SELECT dp.id, dp.name, dp.model, dp.connection, dp.paper_mm, dp.has_drawer,
         coalesce((SELECT pg_catalog.array_agg(ps.station_id ORDER BY ps.station_id) FROM public.desktop_printer_stations ps
                    WHERE ps.device_id = dp.device_id AND ps.printer_id = dp.id), '{}'::uuid[])
    FROM pg_catalog.jsonb_array_elements(p_printers) WITH ORDINALITY e(p, n)
    JOIN public.desktop_printers dp ON dp.device_id = v_device AND dp.id = e.p ->> 'id'
   ORDER BY e.n;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_put_printers(text, jsonb) IS 'Replaces the device''s printer list atomically (at most 20; every stationId must be a station of the device''s restaurant) and returns it in the given order.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_put_printers(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_put_printers(text, jsonb) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_pending_jobs(p_token_hash text, p_after uuid DEFAULT NULL, p_limit integer DEFAULT 500)
    RETURNS TABLE(id uuid, kind text, station_id uuid, payload jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_column
DECLARE
  v_device uuid;
  v_restaurant uuid;
  v_since timestamptz;
BEGIN
  SELECT l.device_id, l.restaurant_id, l.created_at INTO v_device, v_restaurant, v_since FROM private.desktop_live_device(p_token_hash) l;
  RETURN QUERY
  SELECT j.id, j.kind, j.station_id, j.payload, j.created_at
    FROM public.print_jobs j
    LEFT JOIN public.print_jobs a ON a.id = p_after AND a.restaurant_id = j.restaurant_id
   WHERE j.restaurant_id = v_restaurant
     AND j.created_at >= v_since
     AND NOT EXISTS (SELECT 1 FROM public.desktop_job_acks k WHERE k.job_id = j.id AND k.device_id = v_device)
     AND (j.station_id IS NULL OR j.station_id IN (
           SELECT ps.station_id FROM public.desktop_printer_stations ps WHERE ps.device_id = v_device))
     AND (p_after IS NULL OR (j.created_at, j.id) > (a.created_at, a.id))
   ORDER BY j.created_at, j.id
   LIMIT least(greatest(coalesce(p_limit, 500), 1), 500);
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_pending_jobs(text, uuid, integer) IS 'Jobs pending for a live device: its restaurant, created at or after the device, not acked by it, with no station or a station its printers serve; oldest first by (created_at, id), after p_after, at most p_limit (1..500). An unknown or foreign p_after returns nothing.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_pending_jobs(text, uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_pending_jobs(text, uuid, integer) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_ack_job(p_token_hash text, p_job_id uuid, p_status text, p_reason text DEFAULT NULL)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_device uuid;
  v_restaurant uuid;
BEGIN
  SELECT l.device_id, l.restaurant_id INTO v_device, v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  IF NOT EXISTS (SELECT 1 FROM public.print_jobs j WHERE j.id = p_job_id AND j.restaurant_id = v_restaurant) THEN
    RETURN false;
  END IF;
  INSERT INTO public.desktop_job_acks (job_id, device_id, status, reason)
  VALUES (p_job_id, v_device, p_status, p_reason)
  ON CONFLICT (job_id, device_id) DO NOTHING;
  IF FOUND AND p_status = 'printed' THEN
    UPDATE public.print_jobs j SET printed_at = coalesce(j.printed_at, now()) WHERE j.id = p_job_id;
  END IF;
  RETURN true;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_ack_job(text, uuid, text, text) IS 'Acknowledges a job of the device''s restaurant for that device, idempotently (the first status stays); printed also sets print_jobs.printed_at once. false for a job of another restaurant or unknown.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_ack_job(text, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_ack_job(text, uuid, text, text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_drawer_event(p_token_hash text, p_printer_id text, p_opened_at timestamp with time zone, p_reason text, p_profile_id uuid DEFAULT NULL)
    RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_device uuid;
  v_restaurant uuid;
  v_id uuid;
BEGIN
  SELECT l.device_id, l.restaurant_id INTO v_device, v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  INSERT INTO public.desktop_drawer_events (restaurant_id, device_id, printer_id, opened_at, reason, profile_id)
  VALUES (v_restaurant, v_device, p_printer_id, p_opened_at, p_reason,
          (SELECT p.id FROM public.profiles p WHERE p.id = p_profile_id AND p.restaurant_id = v_restaurant))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_drawer_event(text, text, timestamp with time zone, text, uuid) IS 'Records a cash drawer opening of a live device; a profile that is not staff of the restaurant is stored as NULL.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_drawer_event(text, text, timestamp with time zone, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_drawer_event(text, text, timestamp with time zone, text, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.desktop_channel(p_token_hash text)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_restaurant uuid;
BEGIN
  SELECT l.restaurant_id INTO v_restaurant FROM private.desktop_live_device(p_token_hash) l;
  RETURN (SELECT r.channel FROM private.desktop_pairing_restaurant(v_restaurant) r);
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.desktop_channel(text) IS 'Update channel (pilot or stable) of a live device''s restaurant, for GET /desktop/updates.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.desktop_channel(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.desktop_channel(text) TO vipe_api;
