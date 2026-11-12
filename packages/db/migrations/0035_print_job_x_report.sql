-- Informe X on the thermal printer (odd/tasks/informe-x-termico.md, S1, X2).
-- print_jobs.kind accepted only 'invoice' and 'command' (0010_printing); the
-- cashier's partial X report now also travels as a print job so the station
-- prints it instead of the browser dialog. Existing rows are untouched.
ALTER TABLE public.print_jobs DROP CONSTRAINT print_jobs_kind_check;
--> statement-breakpoint
ALTER TABLE public.print_jobs
    ADD CONSTRAINT print_jobs_kind_check CHECK (kind IN ('invoice', 'command', 'x_report'));
--> statement-breakpoint
COMMENT ON TABLE public.print_jobs IS 'Durable print queue: invoice and command payloads byte-compatible with the former room_bills/room_commands broadcasts, and the cashier''s partial X report (x_report). printed_at is set once by private.ack_print_job; rows older than 7 days are pruned by private.prune_print_jobs.';
