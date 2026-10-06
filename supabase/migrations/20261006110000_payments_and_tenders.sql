-- ============================================
-- Payments + payment tenders (the replacement ledger)
-- ============================================
-- The checkout flow recorded money in public.payment_transactions through the
-- broken public.complete_payment() RPC: numeric(10,2) money, one row per method
-- with free-text method strings, no tenant-scoped tender lines, no tip or change
-- rule that the database could enforce, and nothing that let a bill be paid
-- with two methods in one atomic step. This migration adds the replacement and
-- demotes the old table to read-only history. public.pay_order (next migration)
-- is the only writer.
--
-- public.payments
--   restaurant_id     the tenant, NOT NULL and defaulted to the caller's own
--                     tenant through private.default_restaurant_id() (the same
--                     pattern as every other tenant table since 20261005120000
--                     and as public.payment_methods in 20261006100000).
--   order_id          the bill being settled, UNIQUE: one payment per order, so
--                     a retried checkout cannot double-pay. ON DELETE RESTRICT
--                     because a payment is history and must not be orphaned by
--                     an order deletion.
--   cash_register_id  the drawer it was taken on, ON DELETE RESTRICT for the
--                     same reason: the register summary of the close-register
--                     screen reads these rows.
--   cashier_profile_id  the staff member, ON DELETE SET NULL so removing a
--                     profile does not delete money history.
--   amount_due        the bill without tip.
--   tip_amount        the explicit tip the cashier charged (may be 0).
--   total_charged     amount_due + tip_amount, enforced by a CHECK.
--   change_given      what was handed back, always from cash tenders.
--   idempotency_key   the key the POS generates per checkout attempt, UNIQUE
--                     per (restaurant_id, idempotency_key): the same uuid may
--                     be reused by another tenant, never twice in one.
--
-- public.payment_tenders
--   The lines of one payment. line_no is UNIQUE per payment so a client cannot
--   append the same line twice, amount is > 0 (a zero line is not a tender,
--   remove it instead), and cash_received is the whole change rule as a CHECK:
--   a cash tender carries it and it must be >= the amount applied, an
--   electronic tender must leave it NULL. That is why "only cash gives change"
--   is a database rule and not a UI convention.
--   method_code / method_kind are SNAPSHOTS of the catalog row at payment time,
--   so a later rename or retype in public.payment_methods never rewrites
--   history, and the reports can render a method that no longer exists.
--
-- Money is whole COP pesos in bigint: the POS never does arithmetic on
-- fractional pesos, and numeric(10,2) money is what made the legacy ledger
-- ambiguous (a 19% tax column, 0/0 division guards, float drift in the client).
--
-- Cross-row invariants cannot be CHECKs, because a CHECK may not read other
-- rows. They are a DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER on both
-- tables (public.payments_assert_consistency ->
-- private.assert_payment_consistent): it fires once per affected payment at
-- COMMIT and re-computes
--   - at least one tender line;
--   - sum(tender.amount) = payments.total_charged;
--   - payments.change_given = sum(cash_received - amount) over the CASH
--     tenders only (the CHECK guarantees the electronic ones carry nothing);
--   - every tender belongs to the payment's restaurant;
--   - the payment's restaurant matches its order's and its cash register's;
--   - every tender's catalog row belongs to that same restaurant.
-- It raises check_violation (23514), the same class a CHECK violation raises,
-- so a client that already handles "amounts do not add up" keeps working.
--
-- Reads are same-tenant for every authenticated role of the tenant. Writes are
-- NOT available to any authenticated session: there is no INSERT policy, so an
-- INSERT raises 42501 (new row violates row-level security policy), and the
-- UPDATE/DELETE policies exist only so the immutability guard
-- (public.guard_payment_rows_immutable) can fire and raise 42501 on both. The
-- rows are written exclusively by the SECURITY DEFINER pay_order RPC, which
-- runs as postgres and is skipped by the guard.
--
-- Why the write GRANT is still on the table: 020_anon_lockdown pins
-- "authenticated keeps SELECT/INSERT/UPDATE/DELETE on EVERY public table" as a
-- guard against over-revocation, so revoking the write privileges here would
-- fail that suite. The grant is therefore inert - RLS has no INSERT policy and
-- the guard refuses every UPDATE/DELETE - and 060_payments_tenders asserts both
-- halves of that statement (the 42501s and the presence of the grant).
--
-- Legacy: public.payment_transactions keeps its SELECT policy and its rows and
-- loses its write path the same way, plus a COMMENT marking it as superseded
-- history. public.complete_payment still writes it (it runs as postgres) and is
-- dropped together with pay_order in the next migration.
--
-- Idempotent: re-running recreates the same policies, functions, triggers and
-- constraints, and every DROP ... IF EXISTS keeps it safe.
-- ============================================

-- ============================================
-- SECTION 1: the tables
-- ============================================
CREATE TABLE IF NOT EXISTS public.payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL DEFAULT private.default_restaurant_id()
                     REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  order_id           uuid NOT NULL
                     CONSTRAINT payments_order_id_fkey
                     REFERENCES public.orders(id) ON DELETE RESTRICT,
  cash_register_id   uuid NOT NULL
                     CONSTRAINT payments_cash_register_id_fkey
                     REFERENCES public.cash_registers(id) ON DELETE RESTRICT,
  cashier_profile_id uuid
                     CONSTRAINT payments_cashier_profile_id_fkey
                     REFERENCES public.profiles(id) ON DELETE SET NULL,
  amount_due         bigint NOT NULL
                     CONSTRAINT payments_amount_due_check CHECK (amount_due >= 0),
  tip_amount         bigint NOT NULL DEFAULT 0
                     CONSTRAINT payments_tip_amount_check CHECK (tip_amount >= 0),
  total_charged      bigint NOT NULL
                     CONSTRAINT payments_total_charged_check
                     CHECK (total_charged = amount_due + tip_amount),
  change_given       bigint NOT NULL DEFAULT 0
                     CONSTRAINT payments_change_given_check CHECK (change_given >= 0),
  idempotency_key    uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_order_id_key UNIQUE (order_id),
  CONSTRAINT payments_restaurant_id_idempotency_key_key
    UNIQUE (restaurant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.payment_tenders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL DEFAULT private.default_restaurant_id()
                    REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  payment_id        uuid NOT NULL
                    CONSTRAINT payment_tenders_payment_id_fkey
                    REFERENCES public.payments(id) ON DELETE CASCADE,
  line_no           smallint NOT NULL
                    CONSTRAINT payment_tenders_line_no_check CHECK (line_no >= 1),
  payment_method_id uuid NOT NULL
                    CONSTRAINT payment_tenders_payment_method_id_fkey
                    REFERENCES public.payment_methods(id) ON DELETE RESTRICT,
  method_code       text NOT NULL,
  method_kind       text NOT NULL
                    CONSTRAINT payment_tenders_method_kind_check
                    CHECK (method_kind IN ('cash', 'electronic')),
  amount            bigint NOT NULL
                    CONSTRAINT payment_tenders_amount_check CHECK (amount > 0),
  cash_received     bigint,
  CONSTRAINT payment_tenders_cash_received_check CHECK (
      (method_kind = 'cash' AND cash_received IS NOT NULL AND cash_received >= amount)
      OR (method_kind = 'electronic' AND cash_received IS NULL)
    ),
  CONSTRAINT payment_tenders_payment_id_line_no_key UNIQUE (payment_id, line_no)
);

COMMENT ON TABLE public.payments IS
  'One row per settled order (UNIQUE order_id): the bill, the tip, the total charged, the change handed back and the drawer it was taken on. Money is whole COP pesos (bigint). Written only by public.pay_order; readable by every role of the tenant and writable by none of them.';
COMMENT ON COLUMN public.payments.total_charged IS
  'Must equal amount_due + tip_amount (CHECK) and must equal the sum of its tender amounts (deferred constraint trigger).';
COMMENT ON COLUMN public.payments.change_given IS
  'Must equal the sum of (cash_received - amount) over the cash tenders (deferred constraint trigger).';
COMMENT ON COLUMN public.payments.idempotency_key IS
  'Key generated per checkout attempt, UNIQUE per (restaurant_id, idempotency_key). The same uuid may be reused by another tenant.';
COMMENT ON COLUMN public.payments.cashier_profile_id IS
  'Staff member who took the payment. ON DELETE SET NULL: removing a profile must not delete money history.';

COMMENT ON TABLE public.payment_tenders IS
  'The tender lines of one payment (UNIQUE (payment_id, line_no)): how a single bill was split across methods. method_code and method_kind are validated against the public.payment_methods catalog row at insert time and then frozen as history, so a later rename or retype does not rewrite history. Written only by public.pay_order.';
COMMENT ON COLUMN public.payment_tenders.cash_received IS
  'What the customer handed over for this line. Required for a cash tender and must be >= amount; forbidden (NULL) for an electronic one. This CHECK is the whole "only cash gives change" rule.';

-- The register summary (close-register screen, reports) reads one register of
-- one tenant in date order; the admin reports read one tenant's tenders per
-- method.
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_id_cash_register_id_created_at
  ON public.payments USING btree (restaurant_id, cash_register_id, created_at);

CREATE INDEX IF NOT EXISTS idx_payment_tenders_restaurant_id_payment_method_id
  ON public.payment_tenders USING btree (restaurant_id, payment_method_id);

-- ============================================
-- SECTION 2: RLS
-- ============================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_tenders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select_policy ON public.payments;
DROP POLICY IF EXISTS payments_update_policy ON public.payments;
DROP POLICY IF EXISTS payments_delete_policy ON public.payments;
DROP POLICY IF EXISTS payment_tenders_select_policy ON public.payment_tenders;
DROP POLICY IF EXISTS payment_tenders_update_policy ON public.payment_tenders;
DROP POLICY IF EXISTS payment_tenders_delete_policy ON public.payment_tenders;

-- Read: every role of the tenant, cashiers included - the drawer they just
-- closed has to be renderable. The private helper is wrapped in (SELECT ...) so
-- it is evaluated once per statement.
CREATE POLICY payments_select_policy ON public.payments
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- There is deliberately NO INSERT policy: with RLS enabled and no INSERT
-- policy, an INSERT raises 42501 (new row violates row-level security policy).

-- The UPDATE/DELETE policies below are NOT a write path. They exist so that the
-- row is visible to the scan and the immutability guard fires, which raises
-- 42501 on every attempt; WITH CHECK/USING keep the tenant scoping honest so a
-- DELETE aimed at another tenant still touches zero rows instead of raising.
CREATE POLICY payments_update_policy ON public.payments
  FOR UPDATE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payments_delete_policy ON public.payments
  FOR DELETE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_tenders_select_policy ON public.payment_tenders
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_tenders_update_policy ON public.payment_tenders
  FOR UPDATE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_tenders_delete_policy ON public.payment_tenders
  FOR DELETE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- ============================================
-- SECTION 3: the immutability guard
-- ============================================
-- A payment is money history: once written it is corrected by a reversing
-- entry, never by rewriting the row. RLS alone cannot express that - without a
-- policy an UPDATE or DELETE affects zero rows silently instead of refusing -
-- and a policy cannot reason about "who is calling", so the refusal is a
-- trigger, the same shape as public.guard_profiles_privileged_columns
-- (20261005140000) and public.guard_payment_methods_code_immutable
-- (20261006100000).
--
-- SECURITY INVOKER on purpose: the guard must reason about the caller. It cannot
-- be bypassed from the Data API either - only the table owner (postgres) can
-- create or replace a trigger on these tables.
--
-- The skip list is the service path, not an app one: postgres (migrations,
-- seeds, the pay_order RPC), service_role and supabase_admin. Everything else -
-- which is to say every request carrying a user JWT, and therefore the whole
-- browser attack surface - is refused.
CREATE OR REPLACE FUNCTION public.guard_payment_rows_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% rows are immutable: payments are written only by public.pay_order',
    TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION public.guard_payment_rows_immutable() IS
  'BEFORE UPDATE OR DELETE guard on public.payments and public.payment_tenders: a payment is money history and is never rewritten or deleted by an authenticated caller. Raises insufficient_privilege (42501) for everyone except postgres/service_role/supabase_admin.';

DROP TRIGGER IF EXISTS payments_immutable ON public.payments;
CREATE TRIGGER payments_immutable
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_rows_immutable();

DROP TRIGGER IF EXISTS payment_tenders_immutable ON public.payment_tenders;
CREATE TRIGGER payment_tenders_immutable
  BEFORE UPDATE OR DELETE ON public.payment_tenders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_rows_immutable();

-- ============================================
-- SECTION 4: the deferred cross-row invariants
-- ============================================
-- Re-computes the invariants of one payment from its tender lines. Split from
-- the trigger so both tables share one statement and one set of messages.
--
-- SECURITY DEFINER (owned by postgres): the check runs at COMMIT, from a
-- deferred trigger, and has to see the payment and its tenders regardless of
-- which role wrote them. search_path = '' with every reference
-- schema-qualified.
CREATE OR REPLACE FUNCTION private.assert_payment_consistent(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment    public.payments%ROWTYPE;
  v_line_count integer;
  v_amount_sum bigint;
  v_change_sum bigint;
BEGIN
  SELECT p.* INTO v_payment
    FROM public.payments p
   WHERE p.id = p_payment_id;

  -- The payment itself is gone: its tender lines went with it (ON DELETE
  -- CASCADE), so there is nothing left to reconcile.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*),
         coalesce(sum(t.amount), 0),
         coalesce(sum(t.cash_received - t.amount)
                  FILTER (WHERE t.method_kind = 'cash'), 0)
    INTO v_line_count, v_amount_sum, v_change_sum
    FROM public.payment_tenders t
   WHERE t.payment_id = p_payment_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION
      'payment % has no tender lines: a payment is at least one line applied to the bill',
      p_payment_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_amount_sum <> v_payment.total_charged THEN
    RAISE EXCEPTION
      'payment % charges % but its tender lines add up to %',
      p_payment_id, v_payment.total_charged, v_amount_sum USING ERRCODE = 'check_violation';
  END IF;

  IF v_change_sum <> v_payment.change_given THEN
    RAISE EXCEPTION
      'payment % records % of change but its cash tender lines give %',
      p_payment_id, v_payment.change_given, v_change_sum USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = v_payment.order_id
       AND o.restaurant_id = v_payment.restaurant_id) THEN
    RAISE EXCEPTION
      'payment % settles an order that belongs to another restaurant',
      p_payment_id USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cash_registers c
     WHERE c.id = v_payment.cash_register_id
       AND c.restaurant_id = v_payment.restaurant_id) THEN
    RAISE EXCEPTION
      'payment % was taken on a cash register that belongs to another restaurant',
      p_payment_id USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_tenders t
     WHERE t.payment_id = p_payment_id
       AND t.restaurant_id <> v_payment.restaurant_id) THEN
    RAISE EXCEPTION
      'payment % has a tender line that belongs to another restaurant',
      p_payment_id USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_tenders t
     WHERE t.payment_id = p_payment_id
       AND NOT EXISTS (SELECT 1 FROM public.payment_methods m
                        WHERE m.id = t.payment_method_id
                          AND m.restaurant_id = v_payment.restaurant_id)) THEN
    RAISE EXCEPTION
      'payment % has a tender line whose payment method belongs to another restaurant',
      p_payment_id USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.assert_payment_consistent(uuid) IS
  'Re-computes the cross-row invariants of one payment (tender sum = total_charged, change_given = the cash overshoot, at least one line, one restaurant across payment/order/register/tender/catalog) and raises check_violation (23514) when one fails. Called at COMMIT by public.payments_assert_consistency.';

-- The trigger dispatch: it runs once per written row, and the checks are cheap
-- enough to re-compute from the affected payment alone. A tender line moved
-- between payments re-checks both.
--
-- DEFERRABLE INITIALLY DEFERRED so a payment and its lines can be written over
-- several statements inside one transaction - the pay_order RPC inserts the
-- payment first - while still being rejected before the transaction commits.
CREATE OR REPLACE FUNCTION public.payments_assert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM private.assert_payment_consistent(OLD.id);
    ELSE
      PERFORM private.assert_payment_consistent(NEW.id);
    END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM private.assert_payment_consistent(NEW.payment_id);
    END IF;
    IF TG_OP <> 'INSERT' THEN
      PERFORM private.assert_payment_consistent(OLD.payment_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.payments_assert_consistency() IS
  'DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER on public.payments and public.payment_tenders: at COMMIT, re-checks every payment touched by the transaction through private.assert_payment_consistent. A CHECK cannot read other rows, so the tender sum, the change and the one-restaurant rule live here.';

DROP TRIGGER IF EXISTS payments_consistency ON public.payments;
CREATE CONSTRAINT TRIGGER payments_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_assert_consistency();

DROP TRIGGER IF EXISTS payment_tenders_consistency ON public.payment_tenders;
CREATE CONSTRAINT TRIGGER payment_tenders_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_tenders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_assert_consistency();

-- The snapshot is validated at insert time: it is history, not a live mirror
-- of the catalog. SECURITY INVOKER: the writer is always postgres (pay_order
-- in production, the test session in tests) and already sees the catalog row.
CREATE OR REPLACE FUNCTION public.guard_payment_tender_snapshot_at_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payment_methods m
     WHERE m.id = NEW.payment_method_id AND m.code = NEW.method_code AND m.kind = NEW.method_kind) THEN
    RAISE EXCEPTION 'payment_tender snapshot does not match the catalog row at insert time (tender %)', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_payment_tender_snapshot_at_insert() IS
  'BEFORE INSERT guard on public.payment_tenders: snapshot must match catalog at insert time, then is frozen.';

DROP TRIGGER IF EXISTS payment_tenders_snapshot_at_insert ON public.payment_tenders;
CREATE TRIGGER payment_tenders_snapshot_at_insert
  BEFORE INSERT ON public.payment_tenders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_tender_snapshot_at_insert();
-- ============================================
-- SECTION 5: the legacy ledger becomes read-only history
-- ============================================
-- public.payment_transactions stays exactly where the reports and the order
-- history still read it, and loses its write path: the INSERT policy goes away
-- (42501) and the UPDATE/DELETE policies are reduced to what the immutability
-- guard needs to fire (42501). Its rows are not rewritten or deleted, so the
-- history of every order ever paid stays readable.
DROP POLICY IF EXISTS payment_transactions_insert_policy ON public.payment_transactions;
DROP POLICY IF EXISTS payment_transactions_update_policy ON public.payment_transactions;
DROP POLICY IF EXISTS payment_transactions_delete_policy ON public.payment_transactions;

CREATE POLICY payment_transactions_update_policy ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY payment_transactions_delete_policy ON public.payment_transactions
  FOR DELETE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

DROP TRIGGER IF EXISTS payment_transactions_read_only ON public.payment_transactions;
CREATE TRIGGER payment_transactions_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_rows_immutable();

COMMENT ON TABLE public.payment_transactions IS
  'LEGACY history, superseded by public.payments + public.payment_tenders (numeric(10,2) money, free-text method, no tender lines, written only by the retired public.complete_payment). Kept readable so old orders and reports keep rendering; read-only for every authenticated caller. Do not write here - public.pay_order is the only writer of the ledger.';

-- ============================================
-- SECTION 6: privileges
-- ============================================
-- Same lockdown pattern as 20261005120000 / 20261005130000 / 20261005140000 /
-- 20261006100000: PostgreSQL grants EXECUTE to PUBLIC on every new function and
-- trigger functions are not privilege-checked when they fire, so revoking them
-- cannot break the guards themselves.
REVOKE ALL ON FUNCTION public.guard_payment_rows_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_payment_rows_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.payments_assert_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payments_assert_consistency() FROM anon;
REVOKE ALL ON FUNCTION private.assert_payment_consistent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_payment_consistent(uuid) FROM anon;
-- The default-ACL grant, so a user JWT cannot call the guards or the deferred
-- check directly: the same hardening 20261006100000 applies to the catalog.
REVOKE ALL ON FUNCTION public.guard_payment_rows_immutable() FROM authenticated;
REVOKE ALL ON FUNCTION public.payments_assert_consistency() FROM authenticated;
REVOKE ALL ON FUNCTION public.guard_payment_tender_snapshot_at_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_payment_tender_snapshot_at_insert() FROM anon;
REVOKE ALL ON FUNCTION public.guard_payment_tender_snapshot_at_insert() FROM authenticated;

-- anon gets nothing (020_anon_lockdown enumerates every public table/function).
REVOKE ALL ON TABLE public.payments FROM anon;
REVOKE ALL ON TABLE public.payment_tenders FROM anon;

-- The write grants are inert by design (see the header): 020_anon_lockdown pins
-- SELECT/INSERT/UPDATE/DELETE for authenticated on EVERY public table, so the
-- grants stay and RLS plus the immutability guard refuse every write (42501).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_tenders TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;
GRANT ALL ON TABLE public.payment_tenders TO service_role;