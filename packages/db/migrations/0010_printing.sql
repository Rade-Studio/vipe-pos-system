-- Printing bridge (odd/tasks/migracion-backend-nestjs.md, T8c design steps 1
-- and 2). Supabase broadcast sent every restaurant's tickets to every printer
-- and lost them while the listener was offline. Printers now authenticate with
-- an opaque token (only its sha256 is stored) bound to one restaurant, and
-- kitchen commands and invoices are durable print_jobs acknowledged after
-- printing. The web roles reach both tables through RLS by tenant; the
-- printing service has no app.user_id, so it reaches its own jobs only through
-- the SECURITY DEFINER helpers below, keyed by the token hash.
CREATE TABLE public.printer_tokens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now() NOT NULL,
    revoked_at timestamptz,
    last_seen_at timestamptz
);
--> statement-breakpoint
COMMENT ON TABLE public.printer_tokens IS 'Printing service identities. token_hash is the sha256 (hex) of the plaintext token shown once at creation; vipe_api cannot read it.';
--> statement-breakpoint
CREATE TABLE public.print_jobs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid DEFAULT private.current_restaurant_id() NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('invoice', 'command')),
    payload jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    printed_at timestamptz,
    printer_token_id uuid REFERENCES public.printer_tokens(id) ON DELETE SET NULL
);
--> statement-breakpoint
COMMENT ON TABLE public.print_jobs IS 'Durable print queue: invoice and command payloads byte-compatible with the former room_bills/room_commands broadcasts. printed_at is set once by private.ack_print_job; rows older than 7 days are pruned by private.prune_print_jobs.';
--> statement-breakpoint
CREATE INDEX print_jobs_pending_idx ON public.print_jobs (restaurant_id, created_at) WHERE printed_at IS NULL;
--> statement-breakpoint
CREATE INDEX print_jobs_created_at_idx ON public.print_jobs (created_at);
--> statement-breakpoint
ALTER TABLE public.printer_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY printer_tokens_select_policy ON public.printer_tokens FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY printer_tokens_insert_policy ON public.printer_tokens FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY printer_tokens_update_policy ON public.printer_tokens FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id))) WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY print_jobs_select_policy ON public.print_jobs FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY print_jobs_insert_policy ON public.print_jobs FOR INSERT TO vipe_api WITH CHECK ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
-- The baseline default privileges grant full DML on new tables; narrow them.
REVOKE ALL ON TABLE public.printer_tokens FROM vipe_api;
--> statement-breakpoint
GRANT SELECT (id, restaurant_id, name, created_at, revoked_at, last_seen_at) ON TABLE public.printer_tokens TO vipe_api;
--> statement-breakpoint
GRANT INSERT (id, restaurant_id, name, token_hash) ON TABLE public.printer_tokens TO vipe_api;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON TABLE public.printer_tokens TO vipe_api;
--> statement-breakpoint
REVOKE ALL ON TABLE public.print_jobs FROM vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.print_jobs TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.touch_printer(p_token_hash text)
    RETURNS TABLE(id uuid, restaurant_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE public.printer_tokens t
     SET last_seen_at = now()
   WHERE t.token_hash = p_token_hash
     AND t.revoked_at IS NULL
  RETURNING t.id, t.restaurant_id
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.touch_printer(text) IS 'Printing service authentication: the live (not revoked) printer and restaurant of a token hash, recording last_seen_at; no row otherwise.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.touch_printer(text) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.printer_pending_jobs(p_token_hash text, p_after uuid DEFAULT NULL)
    RETURNS TABLE(id uuid, kind text, payload jsonb, created_at timestamptz)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT j.id, j.kind, j.payload, j.created_at
    FROM public.print_jobs j
    JOIN public.printer_tokens t ON t.restaurant_id = j.restaurant_id
    LEFT JOIN public.print_jobs a ON a.id = p_after AND a.restaurant_id = j.restaurant_id
   WHERE t.token_hash = p_token_hash
     AND t.revoked_at IS NULL
     AND j.printed_at IS NULL
     AND (p_after IS NULL OR (j.created_at, j.id) > (a.created_at, a.id))
   ORDER BY j.created_at, j.id
   LIMIT 500
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.printer_pending_jobs(text, uuid) IS 'Unprinted jobs of the restaurant of a live printer token hash, oldest first, at most 500. p_after pages by (created_at, id) after that job; an unknown or foreign p_after returns nothing.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.printer_pending_jobs(text, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.ack_print_job(p_token_hash text, p_job_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_printer_id uuid;
  v_restaurant_id uuid;
BEGIN
  SELECT t.id, t.restaurant_id INTO v_printer_id, v_restaurant_id
    FROM public.printer_tokens t
   WHERE t.token_hash = p_token_hash
     AND t.revoked_at IS NULL;
  IF v_printer_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.print_jobs j
     SET printed_at = coalesce(j.printed_at, now()),
         printer_token_id = coalesce(j.printer_token_id, v_printer_id)
   WHERE j.id = p_job_id
     AND j.restaurant_id = v_restaurant_id;
  RETURN FOUND;
END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.ack_print_job(text, uuid) IS 'Marks a job of the token''s restaurant as printed, idempotently (the first printed_at and printer stay). false for an unknown or revoked token or a job of another restaurant.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.ack_print_job(text, uuid) TO vipe_api;
--> statement-breakpoint
CREATE FUNCTION private.prune_print_jobs()
    RETURNS TABLE(deleted integer, unprinted integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH gone AS (
    DELETE FROM public.print_jobs WHERE created_at < now() - interval '7 days' RETURNING printed_at
  )
  SELECT count(*)::integer, (count(*) FILTER (WHERE printed_at IS NULL))::integer FROM gone
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.prune_print_jobs() IS 'Deletes print jobs older than 7 days across every restaurant; run by the API on start. Returns how many were deleted and how many of those were never printed.';
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.prune_print_jobs() TO vipe_api;
