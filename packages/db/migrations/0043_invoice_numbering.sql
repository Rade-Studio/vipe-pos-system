-- H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): invoice consecutive per
-- restaurant with a prefix (POS-000123), assigned when the order is charged,
-- and the DIAN data (resolution, authorized range, validity, tax regime)
-- configured in Ajustes and printed on the invoice.
--
-- The number is assigned by a BEFORE INSERT trigger on payments, so it runs
-- inside the pay_order transaction for every order type (dine_in, takeaway,
-- delivery) without rewriting pay_order. S7: each prefix has its own
-- sequence. Next = max(invoice_seq) + 1 of the restaurant and the current
-- prefix, never below the configured range start (a new prefix starts at its
-- range start; switching back continues that prefix), under a per-restaurant
-- transaction advisory lock (the same rule as the Z numbering of 0029):
-- concurrent payments serialize, and a payment that rolls back takes its
-- number with it, so the sequence has no gaps. A replay of pay_order returns
-- the stored payment and inserts nothing, so the number never changes. A voided
-- payment keeps its number (an annulled invoice); paying the order again gets
-- the next one. Payments made before 0043 keep invoice_seq NULL.
--
-- invoice_fiscal snapshots the configuration used for the number, so a reprint
-- prints the data in force when it was charged. Exceeding the range or the
-- validity never blocks a payment: the API warns (S2: do not block payments).
--
-- The keys live in business_config (text values, '' = not set); the CHECKs
-- below keep every stored value readable by the trigger.
ALTER TABLE public.payments
  ADD COLUMN invoice_seq bigint,
  ADD COLUMN invoice_prefix text,
  ADD COLUMN invoice_number text,
  ADD COLUMN invoice_fiscal jsonb,
  ADD CONSTRAINT payments_invoice_seq_check CHECK (invoice_seq >= 1);
--> statement-breakpoint
CREATE UNIQUE INDEX payments_restaurant_id_invoice_prefix_seq_key ON public.payments USING btree (restaurant_id, invoice_prefix, invoice_seq);
--> statement-breakpoint
COMMENT ON COLUMN public.payments.invoice_prefix IS 'Prefix the number was assigned under (0043, S7): each prefix of a restaurant has its own sequence.';
--> statement-breakpoint
COMMENT ON COLUMN public.payments.invoice_seq IS 'Invoice consecutive of the restaurant and prefix (0043), assigned by payments_assign_invoice_number inside pay_order; NULL on payments made before 0043.';
--> statement-breakpoint
COMMENT ON COLUMN public.payments.invoice_number IS 'Printed invoice number: prefix, dash, consecutive padded to 6 digits (POS-000123). Reprints show it.';
--> statement-breakpoint
COMMENT ON COLUMN public.payments.invoice_fiscal IS 'Snapshot of the invoice configuration at the charge: prefix, resolution, range_from, range_to, valid_from, valid_to (YYYY-MM-DD), tax_regime; unset values are null.';
--> statement-breakpoint
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_invoice_prefix CHECK (key <> 'invoice_prefix' OR value ~ '^[A-Z0-9]{1,10}$'),
  ADD CONSTRAINT business_config_invoice_resolution CHECK (key <> 'invoice_resolution' OR (length(value) <= 60 AND value ~ '^[[:alnum:] ./-]*$')),
  ADD CONSTRAINT business_config_invoice_range_from CHECK (key <> 'invoice_range_from' OR value ~ '^[1-9][0-9]{0,11}$'),
  ADD CONSTRAINT business_config_invoice_range_to CHECK (key <> 'invoice_range_to' OR value ~ '^([1-9][0-9]{0,11})?$'),
  ADD CONSTRAINT business_config_invoice_valid_from CHECK (key <> 'invoice_valid_from' OR value ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
  ADD CONSTRAINT business_config_invoice_valid_to CHECK (key <> 'invoice_valid_to' OR value ~ '^([0-9]{4}-[0-9]{2}-[0-9]{2})?$'),
  ADD CONSTRAINT business_config_tax_regime CHECK (key <> 'tax_regime' OR value IN ('', 'responsable_iva', 'no_responsable_iva', 'regimen_simple'));
--> statement-breakpoint
CREATE FUNCTION private.assign_invoice_number() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_config  jsonb;
  v_prefix  text;
  v_from    bigint;
  v_next    bigint;
  v_digits  text;
BEGIN
  SELECT coalesce(jsonb_object_agg(bc.key, nullif(bc.value, '')), '{}'::jsonb)
    INTO v_config
    FROM public.business_config bc
   WHERE bc.restaurant_id = NEW.restaurant_id
     AND bc.key IN ('invoice_prefix', 'invoice_resolution', 'invoice_range_from', 'invoice_range_to',
                    'invoice_valid_from', 'invoice_valid_to', 'tax_regime');

  v_prefix := coalesce(v_config ->> 'invoice_prefix', 'POS');
  v_from := coalesce((v_config ->> 'invoice_range_from')::bigint, 1);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice_number:' || NEW.restaurant_id::text, 0));

  SELECT greatest(coalesce(max(p.invoice_seq), 0) + 1, v_from)
    INTO v_next
    FROM public.payments p
   WHERE p.restaurant_id = NEW.restaurant_id
     AND p.invoice_prefix = v_prefix;

  v_digits := v_next::text;
  IF length(v_digits) < 6 THEN
    v_digits := lpad(v_digits, 6, '0');
  END IF;

  NEW.invoice_prefix := v_prefix;
  NEW.invoice_seq := v_next;
  NEW.invoice_number := v_prefix || '-' || v_digits;
  NEW.invoice_fiscal := jsonb_build_object(
    'prefix',     v_prefix,
    'resolution', v_config ->> 'invoice_resolution',
    'range_from', v_from,
    'range_to',   (v_config ->> 'invoice_range_to')::bigint,
    'valid_from', v_config ->> 'invoice_valid_from',
    'valid_to',   v_config ->> 'invoice_valid_to',
    'tax_regime', v_config ->> 'tax_regime');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.assign_invoice_number() IS 'BEFORE INSERT on payments (0043): the next invoice consecutive of the restaurant and its current prefix (max + 1, at least invoice_range_from; S7) under a per-restaurant advisory lock, the printed number and the fiscal snapshot. Any value the writer sent is replaced.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.assign_invoice_number() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER payments_assign_invoice_number
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.assign_invoice_number();
