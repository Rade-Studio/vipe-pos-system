-- ============================================
-- Delivery schema (couriers, customers, addresses, order_deliveries)
-- ============================================
-- The POS-on-Supabase delivery module (odd/tasks/domicilios.md, task 2) adds
-- the registries and the 1:1 mirror that the operator, kitchen and the admin
-- screens will read. RPCs (create_delivery_order, the state machine, the
-- pay_order fee change) land in task 3; this migration is the schema.
--
-- public.couriers
--   restaurant_id the tenant, NOT NULL and defaulted to the caller's own
--                 tenant through private.default_restaurant_id() (same pattern
--                 as every other tenant table since 20261005120000 /
--                 20261005150000 / 20261006100000).
--   name          display name, trimmed 1..80.
--   phone         nullable, digits only, 7..15 (matches the customers regex).
--   is_active     soft delete; the row is kept so historical deliveries keep
--                 resolving the courier that was used.
--
-- public.customers
--   restaurant_id the tenant, NOT NULL defaulted to the caller's own tenant.
--   phone         NOT NULL, digits only, 7..15. UNIQUE (restaurant_id, phone):
--                 the same phone may exist in two tenants, never twice in one
--                 (the future WhatsApp integration keys on this).
--   name          trimmed 1..120.
--   notes         free text, nullable.
--
-- public.customer_addresses
--   restaurant_id the tenant, NOT NULL defaulted to the caller's own tenant.
--   customer_id   FK customers ON DELETE CASCADE: removing a customer wipes its
--                 addresses (no orphan rows; they are useless without a
--                 customer).
--   label, neighborhood, reference  free text with bounded length.
--   address_line  trimmed 1..200 (required: an address without a street line
--                 is not deliverable).
--   is_default    at most one default per customer (partial unique index
--                 WHERE is_default).
--   A deferred cross-row invariant keeps customer_addresses.restaurant_id in
--                 sync with the customer's restaurant_id, the same trigger
--                 shape payments uses (cannot be a CHECK because a CHECK may
--                 not read other rows).
--
-- orders.order_type
--   text NOT NULL DEFAULT 'dine_in' CHECK (order_type IN ('dine_in',
--   'delivery')) plus CHECK (order_type = 'dine_in' OR table_id IS NULL). The
--   default keeps every existing row dine_in; the cross-check stops a delivery
--   order from carrying a table_id.
--
-- public.order_deliveries (1:1 with orders)
--   order_id     PK + FK orders ON DELETE CASCADE: deleting the order wipes
--                its delivery mirror.
--   restaurant_id the tenant, NOT NULL defaulted to the caller's own tenant.
--   customer_id  FK customers.
--   snapshot columns (customer_name, customer_phone, address_line,
--                    neighborhood, address_reference): the address the operator
--                    used at the time the order was placed. A later rename of
--                    the customer or the address must not rewrite the ticket
--                    (the kitchen prints it from this row).
--   delivery_fee bigint NOT NULL DEFAULT 0 CHECK >= 0: whole COP pesos (same
--                 convention payments/payment_tenders established), no tax and
--                 no tip (task 3 fee wiring).
--   payment_mode CHECK IN ('prepaid', 'cash_on_delivery'); cash_change_for
--                 bigint nullable >= 0 and only allowed when payment_mode =
--                 'cash_on_delivery' (a CHECK is the database rule for "only
--                 COD asks for change").
--   courier_id   FK couriers nullable: the courier is assigned at dispatch.
--   delivery_status CHECK IN ('received', 'preparing', 'ready',
--                 'out_for_delivery', 'delivered', 'failed', 'cancelled')
--                 DEFAULT 'received'. failure_reason text required when
--                 delivery_status = 'failed', length(btrim(failure_reason))
--                 <= 200.
--   dispatched_at, delivered_at, failed_at, cancelled_at timestamptz nullable:
--                 the lifecycle timestamps the operator/courier write at
--                 dispatch/closure; the CHECK that failure_reason is set lives
--                 next to the status column so the two cannot drift.
--   A deferred cross-row invariant (same shape as payments) verifies at COMMIT
--                 that
--                 - the underlying order.order_type = 'delivery',
--                 - order_deliveries.restaurant_id = order.restaurant_id,
--                 - customer.restaurant_id = order.restaurant_id,
--                 - courier.restaurant_id = order.restaurant_id when courier_id
--                   is set.
--                 raises check_violation (23514) when one fails.
--
-- Reads are same-tenant for admin / cashier / delivery_operator (the registry
-- they work in). Kitchen also reads order_deliveries (the customer goes on the
-- kitchen ticket) but NOT customers or customer_addresses: a kitchen account
-- has no business knowing the customer registry, only the single delivery it
-- is about to cook.
--
-- Waiters have no read on couriers / customers / customer_addresses /
-- order_deliveries: a waiter never handles a delivery.
--
-- Writes:
--   - couriers: admin only (same shape as public.payment_methods).
--   - customers / customer_addresses: admin / cashier / delivery_operator
--     (the operator registers unknown customers at the counter).
--   - order_deliveries: NONE for authenticated. The rows are written by the
--     SECURITY DEFINER RPCs of task 3 only. There is no INSERT policy on
--     order_deliveries (42501), and the UPDATE/DELETE policies exist so the
--     immutability guard fires and raises 42501 on both. The GRANT is inert by
--     design and 020_anon_lockdown pins it (same reasoning as payments).
--
-- Realtime: order_deliveries added to supabase_realtime with REPLICA IDENTITY
-- FULL, the same shape 20250917090000 uses for tables/orders/order_items.
-- The client (operator board) needs the full OLD row on UPDATE/DELETE to merge
-- the row into its in-memory state without a follow-up SELECT.
--
-- Grants: anon gets nothing on the four new tables (the 020 lockdown
-- enumerates every public table). authenticated / service_role keep the full
-- set on every one (020 also pins that authenticated keeps SELECT/INSERT/
-- UPDATE/DELETE on EVERY public table, which is why the inert write GRANT on
-- order_deliveries stays).
--
-- Idempotent: re-running recreates the same policies, functions, triggers and
-- constraints, and the column DROPs/ADDs are guarded with IF [NOT] EXISTS.
-- ============================================

-- ============================================
-- SECTION 0: the shared updated_at trigger function
-- ============================================
-- Every new table in this migration carries updated_at, and every BEFORE UPDATE
-- trigger that maintains it is the same one-liner: NEW.updated_at = now().
-- public.payment_methods has its own per-table function
-- (public.payment_methods_set_updated_at, 20261006100000); this one is shared
-- by the four new tables and any future table that wants the same behaviour.
-- Same shape: SECURITY INVOKER (the trigger fires as the caller, so a trigger
-- fired by a SECURITY DEFINER function runs as the function owner), search_path
-- = '' to defuse search-path hijacking, plpgsql for the assignment.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE trigger: stamps NEW.updated_at = now(). Used by the delivery module tables (couriers, customers, customer_addresses, order_deliveries); the payment_methods table has its own per-table variant in 20261006100000.';

-- Same lockdown pattern as every other trigger function in this chain.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM authenticated;

-- ============================================
-- SECTION 1: couriers
-- ============================================
CREATE TABLE IF NOT EXISTS public.couriers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name          text NOT NULL
                CONSTRAINT couriers_name_check
                CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  phone         text
                CONSTRAINT couriers_phone_check
                CHECK (phone IS NULL OR phone ~ '^[0-9]{7,15}$'),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_couriers_restaurant_id_is_active
  ON public.couriers USING btree (restaurant_id, is_active);

COMMENT ON TABLE public.couriers IS
  'Per-tenant courier registry. Read by admin / cashier / delivery_operator of the tenant; written by admins only (couriers do not log in). Couriers do not use the app.';

-- updated_at maintenance.
DROP TRIGGER IF EXISTS couriers_set_updated_at ON public.couriers;
CREATE TRIGGER couriers_set_updated_at
  BEFORE UPDATE ON public.couriers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS couriers_select_policy ON public.couriers;
DROP POLICY IF EXISTS couriers_insert_policy ON public.couriers;
DROP POLICY IF EXISTS couriers_update_policy ON public.couriers;

-- Read: every role of the tenant that works with couriers. Admin, cashier and
-- delivery_operator all need the list to assign a courier / render the
-- dropdown.
CREATE POLICY couriers_select_policy ON public.couriers
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id())
         AND (SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator'));

-- Write: admin only. The courier list is configured by the admin; the cashier
-- and the operator pick from it.
CREATE POLICY couriers_insert_policy ON public.couriers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY couriers_update_policy ON public.couriers
  FOR UPDATE TO authenticated
  USING ((SELECT private.current_app_role()) = 'admin'
         AND restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK ((SELECT private.current_app_role()) = 'admin'
              AND restaurant_id = (SELECT private.current_restaurant_id()));

-- No DELETE policy: a courier stays in history even when deactivated
-- (is_active=false is the soft delete; a future delivery references the row).

-- ============================================
-- SECTION 2: customers
-- ============================================
CREATE TABLE IF NOT EXISTS public.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  phone         text NOT NULL
                CONSTRAINT customers_phone_check
                CHECK (phone ~ '^[0-9]{7,15}$'),
  name          text NOT NULL
                CONSTRAINT customers_name_check
                CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_restaurant_id_phone_key UNIQUE (restaurant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_restaurant_id_phone
  ON public.customers USING btree (restaurant_id, phone);

COMMENT ON TABLE public.customers IS
  'Per-tenant customer registry keyed by phone, UNIQUE (restaurant_id, phone): the same phone may exist in two tenants, never twice in one. Read and written by admin / cashier / delivery_operator of the tenant (the operator registers unknown customers at the counter); no DELETE policy.';

DROP TRIGGER IF EXISTS customers_set_updated_at ON public.customers;
CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select_policy ON public.customers;
DROP POLICY IF EXISTS customers_insert_policy ON public.customers;
DROP POLICY IF EXISTS customers_update_policy ON public.customers;

-- Read / write: admin, cashier and delivery_operator of the tenant.
CREATE POLICY customers_select_policy ON public.customers
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id())
         AND (SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator'));

CREATE POLICY customers_insert_policy ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY customers_update_policy ON public.customers
  FOR UPDATE TO authenticated
  USING ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
         AND restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
              AND restaurant_id = (SELECT private.current_restaurant_id()));

-- ============================================
-- SECTION 3: customer_addresses
-- ============================================
CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL DEFAULT private.default_restaurant_id()
                REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_id   uuid NOT NULL
                CONSTRAINT customer_addresses_customer_id_fkey
                REFERENCES public.customers(id) ON DELETE CASCADE,
  label         text
                CONSTRAINT customer_addresses_label_check
                CHECK (label IS NULL OR length(label) <= 40),
  address_line  text NOT NULL
                CONSTRAINT customer_addresses_address_line_check
                CHECK (length(btrim(address_line)) BETWEEN 1 AND 200),
  neighborhood  text
                CONSTRAINT customer_addresses_neighborhood_check
                CHECK (neighborhood IS NULL OR length(neighborhood) <= 80),
  reference     text
                CONSTRAINT customer_addresses_reference_check
                CHECK (reference IS NULL OR length(reference) <= 200),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_restaurant_id_customer_id
  ON public.customer_addresses USING btree (restaurant_id, customer_id);

-- At most one default per customer: a partial unique index keyed on the
-- customer when is_default = true. Non-default rows are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_addresses_one_default_per_customer
  ON public.customer_addresses (customer_id)
  WHERE is_default;

COMMENT ON TABLE public.customer_addresses IS
  'Saved addresses per customer. ON DELETE CASCADE with the customer; at most one default per customer (partial unique index WHERE is_default). Read and written by admin / cashier / delivery_operator of the tenant; restaurant consistency with the customer is checked by a deferred constraint trigger (the same shape payments uses).';

DROP TRIGGER IF EXISTS customer_addresses_set_updated_at ON public.customer_addresses;
CREATE TRIGGER customer_addresses_set_updated_at
  BEFORE UPDATE ON public.customer_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_addresses_select_policy ON public.customer_addresses;
DROP POLICY IF EXISTS customer_addresses_insert_policy ON public.customer_addresses;
DROP POLICY IF EXISTS customer_addresses_update_policy ON public.customer_addresses;

CREATE POLICY customer_addresses_select_policy ON public.customer_addresses
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id())
         AND (SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator'));

CREATE POLICY customer_addresses_insert_policy ON public.customer_addresses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
              AND restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY customer_addresses_update_policy ON public.customer_addresses
  FOR UPDATE TO authenticated
  USING ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
         AND restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK ((SELECT private.current_app_role()) IN ('admin', 'cashier', 'delivery_operator')
              AND restaurant_id = (SELECT private.current_restaurant_id()));

-- The deferred restaurant-consistency invariant: a CHECK cannot read other
-- rows, so the "address belongs to the same tenant as its customer" rule is
-- a DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER. SECURITY DEFINER
-- (owned by postgres): runs at COMMIT and has to see the customer regardless
-- of the caller's role. search_path = '' with every reference
-- schema-qualified.
CREATE OR REPLACE FUNCTION private.assert_customer_address_consistent(p_address_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_addr      public.customer_addresses%ROWTYPE;
  v_cust_rid  uuid;
BEGIN
  SELECT a.* INTO v_addr
    FROM public.customer_addresses a
   WHERE a.id = p_address_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT c.restaurant_id INTO v_cust_rid
    FROM public.customers c
   WHERE c.id = v_addr.customer_id;

  IF v_cust_rid IS NULL THEN
    RAISE EXCEPTION
      'customer_addresses % points at a customer that does not exist',
      p_address_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_cust_rid <> v_addr.restaurant_id THEN
    RAISE EXCEPTION
      'customer_addresses % belongs to tenant %, the customer has %',
      p_address_id, v_addr.restaurant_id, v_cust_rid USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION private.assert_customer_address_consistent(uuid) IS
  'Re-checks at COMMIT that customer_addresses.restaurant_id matches its customer''s restaurant_id. Called by public.customer_addresses_assert_consistency.';

CREATE OR REPLACE FUNCTION public.customer_addresses_assert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.assert_customer_address_consistent(OLD.id);
  ELSE
    PERFORM private.assert_customer_address_consistent(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.customer_addresses_assert_consistency() IS
  'DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER on public.customer_addresses: at COMMIT, re-checks every address touched by the transaction (same shape as public.payments_assert_consistency).';

DROP TRIGGER IF EXISTS customer_addresses_consistency ON public.customer_addresses;
CREATE CONSTRAINT TRIGGER customer_addresses_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_addresses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.customer_addresses_assert_consistency();

-- ============================================
-- SECTION 4: orders.order_type + cross-check
-- ============================================
-- The cross-check has to be its own constraint so a future edit that drops it
-- is visible: a delivery order with a table_id is a logic error and must
-- fail the INSERT, not silently degrade.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'dine_in';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_order_type_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_type_check
      CHECK (order_type IN ('dine_in', 'delivery'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_order_type_table_id_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_type_table_id_check
      CHECK (order_type = 'dine_in' OR table_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.orders.order_type IS
  '''dine_in'' (default; the original model) or ''delivery''. A delivery row must have table_id IS NULL (CHECK). Existing rows stay dine_in.';

-- ============================================
-- SECTION 5: order_deliveries (1:1 mirror)
-- ============================================
CREATE TABLE IF NOT EXISTS public.order_deliveries (
  order_id          uuid PRIMARY KEY
                    CONSTRAINT order_deliveries_order_id_fkey
                    REFERENCES public.orders(id) ON DELETE CASCADE,
  restaurant_id     uuid NOT NULL DEFAULT private.default_restaurant_id()
                    REFERENCES public.restaurants(id) ON UPDATE CASCADE ON DELETE CASCADE,
  customer_id       uuid NOT NULL
                    CONSTRAINT order_deliveries_customer_id_fkey
                    REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_name     text NOT NULL
                    CONSTRAINT order_deliveries_customer_name_check
                    CHECK (length(btrim(customer_name)) BETWEEN 1 AND 120),
  customer_phone    text NOT NULL
                    CONSTRAINT order_deliveries_customer_phone_check
                    CHECK (customer_phone ~ '^[0-9]{7,15}$'),
  address_line      text NOT NULL
                    CONSTRAINT order_deliveries_address_line_check
                    CHECK (length(btrim(address_line)) BETWEEN 1 AND 200),
  neighborhood      text
                    CONSTRAINT order_deliveries_neighborhood_check
                    CHECK (neighborhood IS NULL OR length(neighborhood) <= 80),
  address_reference text
                    CONSTRAINT order_deliveries_address_reference_check
                    CHECK (address_reference IS NULL OR length(address_reference) <= 200),
  delivery_fee      bigint NOT NULL DEFAULT 0
                    CONSTRAINT order_deliveries_delivery_fee_check
                    CHECK (delivery_fee >= 0),
  payment_mode      text NOT NULL DEFAULT 'cash_on_delivery'
                    CONSTRAINT order_deliveries_payment_mode_check
                    CHECK (payment_mode IN ('prepaid', 'cash_on_delivery')),
  cash_change_for   bigint
                    CONSTRAINT order_deliveries_cash_change_for_check
                    CHECK (
                      (payment_mode = 'cash_on_delivery'
                       AND (cash_change_for IS NULL OR cash_change_for >= 0))
                      OR
                      (payment_mode = 'prepaid' AND cash_change_for IS NULL)
                    ),
  courier_id        uuid
                    CONSTRAINT order_deliveries_courier_id_fkey
                    REFERENCES public.couriers(id) ON DELETE RESTRICT,
  delivery_status   text NOT NULL DEFAULT 'received'
                    CONSTRAINT order_deliveries_delivery_status_check
                    CHECK (delivery_status IN (
                      'received', 'preparing', 'ready', 'out_for_delivery',
                      'delivered', 'failed', 'cancelled'
                    )),
  failure_reason    text
                    CONSTRAINT order_deliveries_failure_reason_check
                    CHECK (
                      (delivery_status = 'failed'
                       AND failure_reason IS NOT NULL
                       AND length(btrim(failure_reason)) BETWEEN 1 AND 200)
                      OR
                      (delivery_status <> 'failed'
                       AND (failure_reason IS NULL OR length(failure_reason) <= 200))
                    ),
  dispatched_at     timestamptz,
  delivered_at      timestamptz,
  failed_at         timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The dispatch / kitchen queues read "food" by restaurant and lifecycle status.
CREATE INDEX IF NOT EXISTS idx_order_deliveries_restaurant_id_delivery_status
  ON public.order_deliveries USING btree (restaurant_id, delivery_status);

CREATE INDEX IF NOT EXISTS idx_order_deliveries_restaurant_id_courier_id
  ON public.order_deliveries USING btree (restaurant_id, courier_id);

COMMENT ON TABLE public.order_deliveries IS
  '1:1 mirror of a public.orders row of type ''delivery'': the customer / address snapshot, the delivery fee, the payment mode, the courier and the lifecycle progress. Read by admin / cashier / delivery_operator / kitchen of the tenant; written ONLY by the SECURITY DEFINER RPCs of task 3 (no INSERT policy + immutability guard). Whole COP pesos (bigint).';
COMMENT ON COLUMN public.order_deliveries.delivery_fee IS
  'Whole COP pesos, default 0; task 3 wires the configurable suggested fee and adds it to amount_due.';
COMMENT ON COLUMN public.order_deliveries.cash_change_for IS
  'Cash the courier must hand back, only allowed when payment_mode = cash_on_delivery (CHECK). Prepaid orders never carry cash_change_for.';
COMMENT ON COLUMN public.order_deliveries.failure_reason IS
  'Required when delivery_status = failed (CHECK); bounded to 200 characters even when the order is not failed.';
COMMENT ON COLUMN public.order_deliveries.delivery_status IS
  'received -> preparing -> ready -> out_for_delivery -> delivered | failed (with reason) | cancelled. Transitions are enforced by the task 3 RPCs.';

DROP TRIGGER IF EXISTS order_deliveries_set_updated_at ON public.order_deliveries;
CREATE TRIGGER order_deliveries_set_updated_at
  BEFORE UPDATE ON public.order_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_deliveries_select_policy ON public.order_deliveries;
DROP POLICY IF EXISTS order_deliveries_update_policy ON public.order_deliveries;
DROP POLICY IF EXISTS order_deliveries_delete_policy ON public.order_deliveries;

-- Read: admin / cashier / delivery_operator (the registry they work in) AND
-- kitchen (the kitchen ticket prints the customer snapshot from this row, and
-- only the operator / courier updates it). A kitchen account does NOT read
-- public.customers or public.customer_addresses (the whole registry) - only
-- the single delivery it is about to cook.
CREATE POLICY order_deliveries_select_policy ON public.order_deliveries
  FOR SELECT TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id())
         AND (SELECT private.current_app_role()) IN ('admin', 'cashier',
                                                      'delivery_operator', 'kitchen'));

-- No INSERT policy (442): with RLS enabled and no INSERT policy, an INSERT
-- raises 42501 (new row violates row-level security policy). Writes are
-- RPC-only (task 3).

-- The UPDATE/DELETE policies below are NOT a write path: they exist so the
-- row is visible to the scan and the immutability guard fires, which raises
-- 42501 on every attempt. WITH CHECK/USING keep the tenant scoping honest so
-- a DELETE aimed at another tenant still touches zero rows instead of raising.
CREATE POLICY order_deliveries_update_policy ON public.order_deliveries
  FOR UPDATE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()))
  WITH CHECK (restaurant_id = (SELECT private.current_restaurant_id()));

CREATE POLICY order_deliveries_delete_policy ON public.order_deliveries
  FOR DELETE TO authenticated
  USING (restaurant_id = (SELECT private.current_restaurant_id()));

-- The immutability guard: rows are written only by the task 3 SECURITY DEFINER
-- RPCs (which run as postgres) and never by an authenticated session. Same
-- shape as public.guard_payment_rows_immutable (20261006110000).
CREATE OR REPLACE FUNCTION public.guard_order_deliveries_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order_deliveries rows are immutable: writes are done by the task 3 SECURITY DEFINER RPCs'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION public.guard_order_deliveries_immutable() IS
  'BEFORE UPDATE OR DELETE guard on public.order_deliveries: a delivery row is written only by the task 3 SECURITY DEFINER RPCs. Raises insufficient_privilege (42501) for every caller except postgres / service_role / supabase_admin.';

DROP TRIGGER IF EXISTS order_deliveries_immutable ON public.order_deliveries;
CREATE TRIGGER order_deliveries_immutable
  BEFORE UPDATE OR DELETE ON public.order_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_deliveries_immutable();

-- The deferred consistency invariant: at COMMIT, verify that the underlying
-- order is delivery, that order_deliveries.restaurant_id matches its order,
-- customer and courier. Same shape as private.assert_payment_consistent.
CREATE OR REPLACE FUNCTION private.assert_order_delivery_consistent(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_d        public.order_deliveries%ROWTYPE;
  v_order_rid uuid;
  v_order_type text;
  v_cust_rid  uuid;
  v_cour_rid  uuid;
BEGIN
  SELECT d.* INTO v_d
    FROM public.order_deliveries d
   WHERE d.order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT o.restaurant_id, o.order_type
    INTO v_order_rid, v_order_type
    FROM public.orders o
   WHERE o.id = p_order_id;

  IF v_order_type IS DISTINCT FROM 'delivery' THEN
    RAISE EXCEPTION
      'order % is not delivery (it is %s), cannot carry an order_deliveries row',
      p_order_id, v_order_type USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_rid <> v_d.restaurant_id THEN
    RAISE EXCEPTION
      'order_deliveries % (tenant %) belongs to order % (tenant %)',
      p_order_id, v_d.restaurant_id, p_order_id, v_order_rid USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.restaurant_id INTO v_cust_rid
    FROM public.customers c
   WHERE c.id = v_d.customer_id;

  IF v_cust_rid IS NULL THEN
    RAISE EXCEPTION
      'order_deliveries % points at a customer that does not exist',
      p_order_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_cust_rid <> v_d.restaurant_id THEN
    RAISE EXCEPTION
      'order_deliveries % customer is in tenant %, not %',
      p_order_id, v_cust_rid, v_d.restaurant_id USING ERRCODE = 'check_violation';
  END IF;

  IF v_d.courier_id IS NOT NULL THEN
    SELECT co.restaurant_id INTO v_cour_rid
      FROM public.couriers co
     WHERE co.id = v_d.courier_id;

    IF v_cour_rid IS NULL THEN
      RAISE EXCEPTION
        'order_deliveries % points at a courier that does not exist',
        p_order_id USING ERRCODE = 'check_violation';
    END IF;

    IF v_cour_rid <> v_d.restaurant_id THEN
      RAISE EXCEPTION
        'order_deliveries % courier is in tenant %, not %',
        p_order_id, v_cour_rid, v_d.restaurant_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION private.assert_order_delivery_consistent(uuid) IS
  'Re-checks at COMMIT that the order is delivery and that order_deliveries / orders / couriers / customers all share the same tenant. Called by public.order_deliveries_assert_consistency.';

CREATE OR REPLACE FUNCTION public.order_deliveries_assert_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.assert_order_delivery_consistent(OLD.order_id);
  ELSE
    PERFORM private.assert_order_delivery_consistent(NEW.order_id);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.order_deliveries_assert_consistency() IS
  'DEFERRABLE INITIALLY DEFERRED CONSTRAINT TRIGGER on public.order_deliveries: at COMMIT, re-checks every delivery row touched by the transaction (same shape as public.payments_assert_consistency).';

DROP TRIGGER IF EXISTS order_deliveries_consistency ON public.order_deliveries;
CREATE CONSTRAINT TRIGGER order_deliveries_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.order_deliveries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.order_deliveries_assert_consistency();

-- ============================================
-- SECTION 6: realtime publication
-- ============================================
-- Same shape 20250917090000 uses for tables / orders / order_items.
ALTER TABLE public.order_deliveries REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'order_deliveries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_deliveries;
  END IF;
END $$;

-- ============================================
-- SECTION 7: privileges
-- ============================================
-- Same lockdown pattern as every other migration in this chain:
-- - anon gets nothing (020_anon_lockdown enumerates every public table).
-- - authenticated / service_role keep the full set on every public table
--   (020 also pins SELECT/INSERT/UPDATE/DELETE for authenticated on EVERY
--   public table, which is why the inert write GRANT on order_deliveries
--   stays: RLS plus the immutability guard refuse the writes (42501)).
-- - trigger functions fire without EXECUTE; revoke the default-ACL grant so
--   the SECURITY DEFINER guards / consistency triggers are reachable only
--   through their triggers.
REVOKE ALL ON FUNCTION public.guard_order_deliveries_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_order_deliveries_immutable() FROM anon;
REVOKE ALL ON FUNCTION public.guard_order_deliveries_immutable() FROM authenticated;
REVOKE ALL ON FUNCTION public.order_deliveries_assert_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.order_deliveries_assert_consistency() FROM anon;
REVOKE ALL ON FUNCTION public.order_deliveries_assert_consistency() FROM authenticated;
REVOKE ALL ON FUNCTION private.assert_order_delivery_consistent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_order_delivery_consistent(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.customer_addresses_assert_consistency() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_addresses_assert_consistency() FROM anon;
REVOKE ALL ON FUNCTION public.customer_addresses_assert_consistency() FROM authenticated;
REVOKE ALL ON FUNCTION private.assert_customer_address_consistent(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.assert_customer_address_consistent(uuid) FROM anon;

REVOKE ALL ON TABLE public.couriers FROM anon;
REVOKE ALL ON TABLE public.customers FROM anon;
REVOKE ALL ON TABLE public.customer_addresses FROM anon;
REVOKE ALL ON TABLE public.order_deliveries FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couriers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_deliveries TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.couriers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_addresses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_deliveries TO service_role;