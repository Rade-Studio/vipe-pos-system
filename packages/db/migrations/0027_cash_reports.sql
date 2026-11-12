-- Shift validation by the admin and the business day cut-off
-- (odd/tasks/caja-cierres.md T3, S5, S7).
--
-- business_config: business_day_cutoff_hour, an hour 0..6 (default 4 in the
-- API when the key is missing). A register belongs to the business day
-- date((opening_timestamp AT TIME ZONE restaurants.timezone) - cutoff hours).
--
-- cash_registers: validated_by (the admin who validated the closed shift, of
-- the same restaurant, ON DELETE SET NULL like closed_by in 0026) and
-- validated_at (server clock). The API sets both once, on a closed register;
-- a second validation keeps the stored values. Registers never validated
-- keep NULL in both columns. The existing table grants and RLS policies of
-- vipe_api cover the new columns.
ALTER TABLE public.cash_registers
    ADD COLUMN validated_by uuid,
    ADD COLUMN validated_at timestamp with time zone,
    ADD CONSTRAINT cash_registers_validated_closed_check CHECK (validated_at IS NULL OR status = 'closed'),
    ADD CONSTRAINT cash_registers_validated_by_fkey FOREIGN KEY (restaurant_id, validated_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (validated_by);
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.validated_by IS 'Admin who validated the closed shift (Validar turno), of the same restaurant; NULL when not validated or when the profile is deleted.';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.validated_at IS 'When the admin validated the closed shift (server clock); set once, only on a closed register.';
--> statement-breakpoint
CREATE INDEX idx_cash_registers_validated_by ON public.cash_registers USING btree (validated_by);
--> statement-breakpoint
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_business_day_cutoff_hour CHECK (key <> 'business_day_cutoff_hour' OR value IN ('0', '1', '2', '3', '4', '5', '6'));
