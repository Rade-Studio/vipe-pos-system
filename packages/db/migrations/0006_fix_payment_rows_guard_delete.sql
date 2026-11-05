-- payment rows guard on DELETE (odd/tasks/migracion-backend-nestjs.md, T6
-- closing audit).
--
-- Same defect as 0005: the trusted branch of guard_payment_rows_immutable
-- returned NEW, which is NULL in a BEFORE DELETE trigger, so a trusted delete of
-- payments, payment_tenders or payment_transactions was silently skipped. With
-- cash_registers -> payment_transactions ON DELETE CASCADE that left history
-- rows pointing at a deleted register. Return the row the operation needs.
-- Everything else is unchanged: SECURITY INVOKER, empty search_path, 42501 for
-- every other caller (payments stay immutable for the API role).

CREATE OR REPLACE FUNCTION public.guard_payment_rows_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('postgres', 'vipe_migrator') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION '% rows are immutable: payments are written only by public.pay_order',
    TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
