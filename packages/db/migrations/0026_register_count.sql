-- Shift count and cash movement reasons (odd/tasks/caja-cierres.md T1, S1, S2).
--
-- cash_registers: the API stores the cashier's count right after
-- close_register, in the same transaction: counted_cash (whole pesos),
-- cash_difference (counted_cash - final_cash, final_cash keeps its meaning:
-- expected_cash_after_tips), close_note (required by the API and by
-- cash_registers_count_note_check when the difference is not 0),
-- denominations ([{value, quantity}]) and closed_by (the caller's profile).
-- Registers closed before this migration keep NULL in every count column.
--
-- cash_transactions: reason (one of six codes; NULL for older movements) and
-- created_by (default: the caller's profile, like cash_registers.opened_by).
-- The existing table grants and RLS policies of vipe_api cover the new columns.
ALTER TABLE public.cash_registers
    ADD COLUMN counted_cash numeric(10,2),
    ADD COLUMN cash_difference numeric(10,2),
    ADD COLUMN close_note text,
    ADD COLUMN denominations jsonb,
    ADD COLUMN closed_by uuid,
    ADD CONSTRAINT cash_registers_counted_cash_check CHECK (counted_cash >= 0 AND counted_cash = trunc(counted_cash)),
    ADD CONSTRAINT cash_registers_count_pair_check CHECK ((counted_cash IS NULL) = (cash_difference IS NULL)),
    ADD CONSTRAINT cash_registers_close_note_check CHECK (char_length(close_note) BETWEEN 3 AND 300),
    ADD CONSTRAINT cash_registers_count_note_check CHECK (cash_difference = 0 OR close_note IS NOT NULL),
    ADD CONSTRAINT cash_registers_denominations_check CHECK (jsonb_typeof(denominations) = 'array'),
    ADD CONSTRAINT cash_registers_closed_by_fkey FOREIGN KEY (restaurant_id, closed_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (closed_by);
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.counted_cash IS 'Cash the cashier counted at the close (whole pesos); NULL for registers closed before migration 0026.';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.cash_difference IS 'counted_cash - final_cash at the close (final_cash is expected_cash_after_tips); NULL when no count was stored.';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.close_note IS 'Cashier note on the close, 3..300 characters, trimmed by the API; required when cash_difference is not 0.';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.denominations IS 'Optional count by denomination: [{value, quantity}], whose sum is counted_cash (checked by the API).';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_registers.closed_by IS 'Profile that closed the register (the caller of the API session), of the same restaurant; NULL for registers closed before migration 0026 or when the profile is deleted.';
--> statement-breakpoint
CREATE INDEX idx_cash_registers_closed_by ON public.cash_registers USING btree (closed_by);
--> statement-breakpoint
ALTER TABLE public.cash_transactions
    ADD COLUMN reason character varying(20),
    ADD COLUMN created_by uuid,
    ADD CONSTRAINT cash_transactions_reason_check CHECK (reason IN ('change_fund', 'supplier', 'petty_cash', 'tips_payout', 'safe_deposit', 'other')),
    ADD CONSTRAINT cash_transactions_other_description_check CHECK (reason IS DISTINCT FROM 'other' OR btrim(coalesce(description, '')) <> ''),
    ADD CONSTRAINT cash_transactions_created_by_fkey FOREIGN KEY (restaurant_id, created_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (created_by);
--> statement-breakpoint
-- Set after ADD COLUMN so existing movements stay NULL.
ALTER TABLE public.cash_transactions
    ALTER COLUMN created_by SET DEFAULT private.current_profile_id();
--> statement-breakpoint
COMMENT ON COLUMN public.cash_transactions.reason IS 'Why the cash moved: change_fund, supplier, petty_cash, tips_payout, safe_deposit or other (other requires a description); NULL for movements before migration 0026.';
--> statement-breakpoint
COMMENT ON COLUMN public.cash_transactions.created_by IS 'Profile that recorded the movement (default: the caller of the API session), of the same restaurant; NULL for movements before migration 0026 or when the profile is deleted.';
--> statement-breakpoint
CREATE INDEX idx_cash_transactions_created_by ON public.cash_transactions USING btree (created_by);
