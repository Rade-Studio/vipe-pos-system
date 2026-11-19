-- H-061 (odd/tasks/qa-noviembre-2026.md T2): a register opens with whole
-- pesos >= 0. POST /registers/open already validates it (wholePesos); this
-- CHECK makes it a database rule for every writer.
--
-- NOT VALID: rows written before this migration (Supabase era) are not
-- checked when it runs, so the migration cannot fail on legacy data. Postgres
-- still checks the constraint on every INSERT and on every UPDATE of a row,
-- whatever column the UPDATE changes: a legacy row with centavos or a negative
-- initial_cash must be corrected before that register is updated or closed.
ALTER TABLE public.cash_registers
  ADD CONSTRAINT cash_registers_initial_cash_whole_pesos
  CHECK (initial_cash >= 0 AND initial_cash = trunc(initial_cash)) NOT VALID;
