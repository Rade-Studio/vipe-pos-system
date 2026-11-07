-- Audited cancellations and voids (odd/tasks/fase3-operacion.md, F1, S1 a).
--
-- Nothing is deleted any more: an order is cancelled, an item or a payment is
-- voided, and each of them is a stored event with its reason, who did it, who
-- authorized it and the amounts at that moment.
--
-- 1. public.order_cancellations: one row per cancelled order (UNIQUE
--    order_id) with the reason, the actor, the authorizer, the bill
--    (subtotal, tax, tip, total) and the live lines as they were. The order
--    keeps its items and becomes status = 'cancelled'.
-- 2. public.order_item_voids: one row per voided line (quantity voided, unit
--    price, amount, whether it had been sent to the kitchen and whether its
--    stock had been consumed). The line's quantity goes down by the voided
--    units; at 0 it becomes status = 'cancelled' (CHECK), so every bill
--    (recompute_order_bill, pay_order) ignores it without a change. Stock is
--    never given back: a sent dish was prepared, the void row records it.
-- 3. public.payment_voids: one row per voided payment (UNIQUE payment_id)
--    with the amounts, the tenders as they were and the drawer. The payment
--    row stays, stamped payments.voided_at; the order goes back to
--    'delivered' so it can be paid again (payments_order_id_key becomes the
--    partial unique index payments_order_id_live_key). A voided payment
--    counts nowhere: vipe_api no longer sees it (payments and
--    payment_tenders SELECT policies), and the SECURITY DEFINER readers
--    (pay_order's drawer and replay lookup, register_summary, split_order,
--    undo_split, set_delivery_status) skip it. Its key stays spent: pay_order
--    refuses (P0001) a key of a voided payment.
-- 4. public.audit_log: append-only log of every cancellation and void
--    (order_cancelled | items_voided | payment_voided) with self_authorized.
--    UNIQUE authorization_id: a supervisor authorization backs one event.
-- 5. business_config key allow_self_authorization ('true' | 'false', missing
--    = false): whether a supervisor may authorize their own action; such
--    events are flagged self_authorized.
-- 6. Writers: public.cancel_order, public.void_order_items and
--    public.void_payment (SECURITY DEFINER). The API consumes the supervisor
--    authorization first (private.consume_supervisor_authorization, 0017) in
--    the same transaction; the functions accept only a consumed
--    authorization of the caller's restaurant, for that action, from an
--    active admin or cashier, not used by another event, and different from
--    the caller unless allow_self_authorization is on. Required: cancelling
--    an order with a live item or any payment, voiding any line (every
--    server-side line was sent to the kitchen) and voiding any payment.
-- 7. Guards for vipe_api (postgres and vipe_migrator, the definer functions
--    and migrations, pass): no DELETE of orders or order_items, no status
--    change into or out of 'paid' or 'cancelled', no change of an item's
--    quantity or price and no 'cancelled' item; delete_order_with_items now
--    refuses (42501); the four new tables are read-only for vipe_api (RLS
--    policies for SELECT, UPDATE and DELETE scoped to the restaurant, no
--    INSERT policy, and a trigger that refuses every write); a voided_at
--    once set never changes.
-- Tenant guards are composite keys (restaurant_id, id) to orders,
-- order_items, payments and profiles; actor and authorizer names are kept as
-- text so the history reads the same after a profile is removed. The keys to
-- orders, order_items, payments and audit_log are NO ACTION: only a
-- restaurant deletion (one cascade) removes history; undo_split refuses a
-- child order with events. vipe_api keeps its table privileges on the new
-- tables (the 020 invariant); RLS and the trigger make them read-only.
--
-- Error messages are `<function>: <code>` (the API maps the code to its
-- Spanish message): 42501 authorization_required, authorization_invalid,
-- self_authorization_not_allowed; P0002 order_not_found, item_not_found,
-- payment_not_found; P0001 order_cancelled, order_paid, order_closed,
-- delivery_order, payment_voided, register_closed; 22023 reason_invalid,
-- reason_text_required, items_invalid, void_quantity_exceeded.
ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_allow_self_authorization CHECK (key <> 'allow_self_authorization' OR value IN ('true', 'false'));
--> statement-breakpoint
ALTER TABLE public.orders ADD CONSTRAINT orders_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.order_items ADD CONSTRAINT order_items_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.payments ADD CONSTRAINT payments_restaurant_id_id_key UNIQUE (restaurant_id, id);
--> statement-breakpoint
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 0) NOT VALID,
  ADD CONSTRAINT order_items_cancelled_quantity_check CHECK ((status = 'cancelled') = (quantity = 0)) NOT VALID;
--> statement-breakpoint
COMMENT ON CONSTRAINT order_items_cancelled_quantity_check ON public.order_items IS 'A line is cancelled exactly when all its units were voided (quantity 0). NOT VALID: rows written before 0018 are not re-checked.';
--> statement-breakpoint
ALTER TABLE public.payments ADD COLUMN voided_at timestamptz;
--> statement-breakpoint
COMMENT ON COLUMN public.payments.voided_at IS 'Set once by public.void_payment; a voided payment settles nothing and counts in no total (public.payment_voids keeps the event). Never changes once set.';
--> statement-breakpoint
ALTER TABLE public.payments DROP CONSTRAINT payments_order_id_key;
--> statement-breakpoint
CREATE UNIQUE INDEX payments_order_id_live_key ON public.payments USING btree (order_id) WHERE (voided_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_payments_order_id ON public.payments USING btree (order_id);
--> statement-breakpoint
DROP POLICY payments_select_policy ON public.payments;
--> statement-breakpoint
CREATE POLICY payments_select_policy ON public.payments FOR SELECT TO vipe_api
  USING (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id) AND voided_at IS NULL);
--> statement-breakpoint
DROP POLICY payment_tenders_select_policy ON public.payment_tenders;
--> statement-breakpoint
CREATE POLICY payment_tenders_select_policy ON public.payment_tenders FOR SELECT TO vipe_api
  USING (restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)
         AND EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_tenders.payment_id AND p.voided_at IS NULL));
--> statement-breakpoint
CREATE FUNCTION private.guard_payment_voided_final() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'payments.voided_at is final once set' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_payment_voided_final() IS 'BEFORE UPDATE on payments: a voided_at once set never changes or clears (42501), for every role but the postgres superuser. vipe_api cannot update payments at all (guard_payment_rows_immutable).';
--> statement-breakpoint
CREATE TRIGGER payments_voided_final BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.guard_payment_voided_final();
--> statement-breakpoint
CREATE FUNCTION private.guard_order_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('postgres', 'vipe_migrator') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows are never deleted: cancel the order or void the item', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'orders' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND (OLD.status IN ('paid', 'cancelled') OR NEW.status IN ('paid', 'cancelled')) THEN
      RAISE EXCEPTION 'orders.status % -> % goes only through pay_order, cancel_order or void_payment', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity
        OR NEW.price IS DISTINCT FROM OLD.price
        OR (NEW.status IS DISTINCT FROM OLD.status AND 'cancelled' IN (NEW.status, OLD.status)) THEN
    RAISE EXCEPTION 'order_items quantity, price and cancellation change only through void_order_items or split_order'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_order_lifecycle() IS 'BEFORE UPDATE OR DELETE on orders and order_items for every role but postgres and vipe_migrator (the SECURITY DEFINER RPCs, migrations and seeds): no DELETE; no orders.status change into or out of paid or cancelled; no order_items quantity or price change and no cancelled item. 42501.';
--> statement-breakpoint
CREATE TRIGGER orders_lifecycle_guard BEFORE UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_order_lifecycle();
--> statement-breakpoint
CREATE TRIGGER order_items_lifecycle_guard BEFORE UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION private.guard_order_lifecycle();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.delete_order_with_items(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'delete_order_with_items: orders are never deleted; cancel order % with public.cancel_order', p_order_id
    USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.delete_order_with_items(p_order_id uuid) IS 'Retired by 0018: orders are never deleted. Always raises 42501; use public.cancel_order. Kept (with its grant) so an old caller gets a clear refusal instead of a missing function.';
--> statement-breakpoint
CREATE FUNCTION private.guard_append_only() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF current_user IN ('postgres', 'vipe_migrator') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION '% is append-only: rows are written by cancel_order, void_order_items and void_payment', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.guard_append_only() IS 'BEFORE INSERT OR UPDATE OR DELETE on audit_log, order_cancellations, order_item_voids and payment_voids: 42501 for every role but postgres and vipe_migrator (the SECURITY DEFINER writers, a restaurant cascade, the demo reset).';
--> statement-breakpoint
CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    event_type text NOT NULL CONSTRAINT audit_log_event_type_check CHECK (event_type IN ('order_cancelled', 'items_voided', 'payment_voided')),
    order_id uuid NOT NULL,
    payment_id uuid,
    actor_profile_id uuid,
    actor_name text NOT NULL,
    authorized_by_profile_id uuid,
    authorized_by_name text,
    authorization_id uuid,
    self_authorized boolean DEFAULT false NOT NULL,
    reason_code text NOT NULL,
    reason_text text,
    amount numeric(12,2) NOT NULL CONSTRAINT audit_log_amount_check CHECK (amount >= 0),
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_reason_code_check CHECK (reason_code IN ('waiter_error', 'customer_left', 'dish_returned', 'duplicate_charge', 'wrong_payment_method', 'other')),
    CONSTRAINT audit_log_reason_text_check CHECK (reason_text IS NULL OR length(btrim(reason_text)) BETWEEN 3 AND 200),
    CONSTRAINT audit_log_other_reason_check CHECK (reason_code <> 'other' OR reason_text IS NOT NULL),
    CONSTRAINT audit_log_payment_check CHECK ((event_type = 'payment_voided') = (payment_id IS NOT NULL)),
    CONSTRAINT audit_log_authorizer_check CHECK ((authorization_id IS NULL) = (authorized_by_name IS NULL)),
    CONSTRAINT audit_log_self_check CHECK (NOT self_authorized OR authorization_id IS NOT NULL),
    CONSTRAINT audit_log_self_match_check CHECK (authorized_by_profile_id IS NULL OR actor_profile_id IS NULL OR self_authorized = (authorized_by_profile_id = actor_profile_id)),
    CONSTRAINT audit_log_details_check CHECK (jsonb_typeof(details) = 'object'),
    CONSTRAINT audit_log_order_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id),
    CONSTRAINT audit_log_payment_fkey FOREIGN KEY (restaurant_id, payment_id) REFERENCES public.payments(restaurant_id, id),
    CONSTRAINT audit_log_actor_fkey FOREIGN KEY (restaurant_id, actor_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (actor_profile_id),
    CONSTRAINT audit_log_authorizer_fkey FOREIGN KEY (restaurant_id, authorized_by_profile_id) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (authorized_by_profile_id)
);
--> statement-breakpoint
COMMENT ON TABLE public.audit_log IS 'Append-only log of every order cancellation, item void and payment void: who did it (actor), who authorized it (supervisor PIN, F2), whether it was the same person (self_authorized, only with allow_self_authorization), the reason, the money removed (amount) and the event details. Written only by cancel_order, void_order_items and void_payment; vipe_api reads its restaurant and writes nothing.';
--> statement-breakpoint
COMMENT ON COLUMN public.audit_log.amount IS 'Money the event removed, in pesos: the order total, the voided lines (price x quantity) or the payment total_charged.';
--> statement-breakpoint
CREATE UNIQUE INDEX audit_log_authorization_id_key ON public.audit_log USING btree (authorization_id) WHERE (authorization_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_audit_log_restaurant_id_created_at ON public.audit_log USING btree (restaurant_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_audit_log_order_id ON public.audit_log USING btree (order_id);
--> statement-breakpoint
CREATE TABLE public.order_cancellations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL CONSTRAINT order_cancellations_order_id_key UNIQUE,
    audit_id uuid NOT NULL REFERENCES public.audit_log(id),
    previous_status text NOT NULL CONSTRAINT order_cancellations_previous_status_check CHECK (previous_status IN ('active', 'kitchen', 'delivered')),
    reason_code text NOT NULL,
    reason_text text,
    cancelled_by uuid,
    cancelled_by_name text NOT NULL,
    authorized_by uuid,
    authorized_by_name text,
    authorization_id uuid,
    self_authorized boolean DEFAULT false NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    tax numeric(10,2) NOT NULL,
    tip numeric(10,2) NOT NULL,
    total numeric(10,2) NOT NULL,
    items jsonb NOT NULL,
    sent_items integer NOT NULL CONSTRAINT order_cancellations_sent_items_check CHECK (sent_items >= 0),
    cancelled_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT order_cancellations_reason_code_check CHECK (reason_code IN ('waiter_error', 'customer_left', 'dish_returned', 'duplicate_charge', 'wrong_payment_method', 'other')),
    CONSTRAINT order_cancellations_reason_text_check CHECK (reason_text IS NULL OR length(btrim(reason_text)) BETWEEN 3 AND 200),
    CONSTRAINT order_cancellations_other_reason_check CHECK (reason_code <> 'other' OR reason_text IS NOT NULL),
    CONSTRAINT order_cancellations_amounts_check CHECK (subtotal >= 0 AND tax >= 0 AND tip >= 0 AND total >= 0),
    CONSTRAINT order_cancellations_items_check CHECK (jsonb_typeof(items) = 'array'),
    CONSTRAINT order_cancellations_authorizer_check CHECK ((authorization_id IS NULL) = (authorized_by_name IS NULL)),
    CONSTRAINT order_cancellations_self_check CHECK (NOT self_authorized OR authorization_id IS NOT NULL),
    CONSTRAINT order_cancellations_self_match_check CHECK (authorized_by IS NULL OR cancelled_by IS NULL OR self_authorized = (authorized_by = cancelled_by)),
    CONSTRAINT order_cancellations_order_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id),
    CONSTRAINT order_cancellations_cancelled_by_fkey FOREIGN KEY (restaurant_id, cancelled_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (cancelled_by),
    CONSTRAINT order_cancellations_authorized_by_fkey FOREIGN KEY (restaurant_id, authorized_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (authorized_by)
);
--> statement-breakpoint
COMMENT ON TABLE public.order_cancellations IS 'One row per cancelled order (written by public.cancel_order): reason, actor, authorizer, self_authorized, the status it had, the bill at that moment and its live lines (items: id, dish_id, name, price, quantity, status, sent_to_kitchen, stock_consumed). The order row stays with status cancelled. Append-only.';
--> statement-breakpoint
CREATE INDEX idx_order_cancellations_restaurant_id_cancelled_at ON public.order_cancellations USING btree (restaurant_id, cancelled_at);
--> statement-breakpoint
CREATE TABLE public.order_item_voids (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    audit_id uuid NOT NULL REFERENCES public.audit_log(id),
    dish_id uuid,
    item_name text NOT NULL,
    quantity integer NOT NULL CONSTRAINT order_item_voids_quantity_check CHECK (quantity >= 1),
    remaining_quantity integer NOT NULL CONSTRAINT order_item_voids_remaining_check CHECK (remaining_quantity >= 0),
    unit_price numeric(10,2) NOT NULL CONSTRAINT order_item_voids_unit_price_check CHECK (unit_price >= 0),
    amount numeric(12,2) NOT NULL CONSTRAINT order_item_voids_amount_check CHECK (amount >= 0),
    sent_to_kitchen boolean NOT NULL,
    stock_consumed boolean NOT NULL,
    reason_code text NOT NULL,
    reason_text text,
    voided_by uuid,
    voided_by_name text NOT NULL,
    authorized_by uuid,
    authorized_by_name text,
    authorization_id uuid,
    self_authorized boolean DEFAULT false NOT NULL,
    voided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT order_item_voids_reason_code_check CHECK (reason_code IN ('waiter_error', 'customer_left', 'dish_returned', 'duplicate_charge', 'wrong_payment_method', 'other')),
    CONSTRAINT order_item_voids_reason_text_check CHECK (reason_text IS NULL OR length(btrim(reason_text)) BETWEEN 3 AND 200),
    CONSTRAINT order_item_voids_other_reason_check CHECK (reason_code <> 'other' OR reason_text IS NOT NULL),
    CONSTRAINT order_item_voids_authorizer_check CHECK ((authorization_id IS NULL) = (authorized_by_name IS NULL)),
    CONSTRAINT order_item_voids_sent_check CHECK (NOT sent_to_kitchen OR authorization_id IS NOT NULL),
    CONSTRAINT order_item_voids_self_check CHECK (NOT self_authorized OR authorization_id IS NOT NULL),
    CONSTRAINT order_item_voids_self_match_check CHECK (authorized_by IS NULL OR voided_by IS NULL OR self_authorized = (authorized_by = voided_by)),
    CONSTRAINT order_item_voids_order_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id),
    CONSTRAINT order_item_voids_item_fkey FOREIGN KEY (restaurant_id, order_item_id) REFERENCES public.order_items(restaurant_id, id),
    CONSTRAINT order_item_voids_voided_by_fkey FOREIGN KEY (restaurant_id, voided_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (voided_by),
    CONSTRAINT order_item_voids_authorized_by_fkey FOREIGN KEY (restaurant_id, authorized_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (authorized_by)
);
--> statement-breakpoint
COMMENT ON TABLE public.order_item_voids IS 'One row per voided order line (written by public.void_order_items): units voided, units left, unit price, amount, whether the line had been sent to the kitchen (a sent line needs a supervisor authorization, CHECK) and whether its stock had been consumed (stock is never given back: F11 reports read it as waste). Append-only.';
--> statement-breakpoint
CREATE INDEX idx_order_item_voids_restaurant_id_voided_at ON public.order_item_voids USING btree (restaurant_id, voided_at);
--> statement-breakpoint
CREATE INDEX idx_order_item_voids_order_id ON public.order_item_voids USING btree (order_id);
--> statement-breakpoint
CREATE TABLE public.payment_voids (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    payment_id uuid NOT NULL CONSTRAINT payment_voids_payment_id_key UNIQUE,
    order_id uuid NOT NULL,
    cash_register_id uuid NOT NULL,
    audit_id uuid NOT NULL REFERENCES public.audit_log(id),
    amount_due bigint NOT NULL,
    tip_amount bigint NOT NULL,
    total_charged bigint NOT NULL,
    change_given bigint NOT NULL,
    methods text NOT NULL,
    tenders jsonb NOT NULL,
    paid_at timestamptz NOT NULL,
    reason_code text NOT NULL,
    reason_text text,
    voided_by uuid,
    voided_by_name text NOT NULL,
    authorized_by uuid,
    authorized_by_name text NOT NULL,
    authorization_id uuid NOT NULL,
    self_authorized boolean DEFAULT false NOT NULL,
    voided_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT payment_voids_amounts_check CHECK (amount_due >= 0 AND tip_amount >= 0 AND change_given >= 0 AND total_charged = amount_due + tip_amount),
    CONSTRAINT payment_voids_tenders_check CHECK (jsonb_typeof(tenders) = 'array' AND jsonb_array_length(tenders) >= 1),
    CONSTRAINT payment_voids_reason_code_check CHECK (reason_code IN ('waiter_error', 'customer_left', 'dish_returned', 'duplicate_charge', 'wrong_payment_method', 'other')),
    CONSTRAINT payment_voids_reason_text_check CHECK (reason_text IS NULL OR length(btrim(reason_text)) BETWEEN 3 AND 200),
    CONSTRAINT payment_voids_other_reason_check CHECK (reason_code <> 'other' OR reason_text IS NOT NULL),
    CONSTRAINT payment_voids_self_match_check CHECK (authorized_by IS NULL OR voided_by IS NULL OR self_authorized = (authorized_by = voided_by)),
    CONSTRAINT payment_voids_payment_fkey FOREIGN KEY (restaurant_id, payment_id) REFERENCES public.payments(restaurant_id, id),
    CONSTRAINT payment_voids_order_fkey FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id),
    CONSTRAINT payment_voids_voided_by_fkey FOREIGN KEY (restaurant_id, voided_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (voided_by),
    CONSTRAINT payment_voids_authorized_by_fkey FOREIGN KEY (restaurant_id, authorized_by) REFERENCES public.profiles(restaurant_id, id) ON DELETE SET NULL (authorized_by)
);
--> statement-breakpoint
COMMENT ON TABLE public.payment_voids IS 'One row per voided payment (written by public.void_payment, always with a supervisor authorization): the amounts, the methods and tender lines as they were, the drawer and when it was paid. The payments row stays, stamped voided_at, and no longer counts in any total. Append-only.';
--> statement-breakpoint
CREATE INDEX idx_payment_voids_restaurant_id_voided_at ON public.payment_voids USING btree (restaurant_id, voided_at);
--> statement-breakpoint
CREATE INDEX idx_payment_voids_cash_register_id ON public.payment_voids USING btree (cash_register_id);
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE INSERT OR UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.guard_append_only();
--> statement-breakpoint
CREATE TRIGGER order_cancellations_append_only BEFORE INSERT OR UPDATE OR DELETE ON public.order_cancellations
  FOR EACH ROW EXECUTE FUNCTION private.guard_append_only();
--> statement-breakpoint
CREATE TRIGGER order_item_voids_append_only BEFORE INSERT OR UPDATE OR DELETE ON public.order_item_voids
  FOR EACH ROW EXECUTE FUNCTION private.guard_append_only();
--> statement-breakpoint
CREATE TRIGGER payment_voids_append_only BEFORE INSERT OR UPDATE OR DELETE ON public.payment_voids
  FOR EACH ROW EXECUTE FUNCTION private.guard_append_only();
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.order_cancellations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.order_item_voids ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payment_voids ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_select_policy ON public.audit_log FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY audit_log_update_policy ON public.audit_log FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY audit_log_delete_policy ON public.audit_log FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_cancellations_select_policy ON public.order_cancellations FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_cancellations_update_policy ON public.order_cancellations FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_cancellations_delete_policy ON public.order_cancellations FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_item_voids_select_policy ON public.order_item_voids FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_item_voids_update_policy ON public.order_item_voids FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY order_item_voids_delete_policy ON public.order_item_voids FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY payment_voids_select_policy ON public.payment_voids FOR SELECT TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY payment_voids_update_policy ON public.payment_voids FOR UPDATE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
CREATE POLICY payment_voids_delete_policy ON public.payment_voids FOR DELETE TO vipe_api USING ((restaurant_id = ( SELECT private.current_restaurant_id() AS current_restaurant_id)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_log TO vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_cancellations TO vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_item_voids TO vipe_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_voids TO vipe_api;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pay_order(p_order_id uuid, p_cash_register_id uuid, p_tip_amount bigint, p_tenders jsonb, p_idempotency_key uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;
  v_caller_profile  uuid;

  v_order           public.orders%ROWTYPE;
  v_register        public.cash_registers%ROWTYPE;
  v_delivery_fee    bigint := 0;

  v_subtotal        bigint := 0;
  v_tax             bigint := 0;
  v_amount_due      bigint := 0;

  v_tender_count    integer;
  v_tenders_sum     bigint := 0;
  v_change_given    bigint := 0;
  v_cash_received_sum bigint := 0;

  v_existing        public.payments%ROWTYPE;
  v_payment_id      uuid;

  v_drawer_cash_before bigint := 0;
  v_drawer_warning  boolean := false;

  v_tender          jsonb;
  v_method_id       uuid;
  v_method_code     text;
  v_method_kind     text;
  v_method_active   boolean;
  v_method_tenant   uuid;
  v_amount          bigint;
  v_cash_received   bigint;
  v_reference       text;

  v_line_no         smallint := 0;
  v_tender_json     jsonb;
  v_tender_lines    jsonb := '[]'::jsonb;

  v_pending_line_no        smallint[] := '{}'::smallint[];
  v_pending_payment_method uuid[]    := '{}'::uuid[];
  v_pending_amount         bigint[]  := '{}'::bigint[];
  v_pending_cash_received  bigint[]  := '{}'::bigint[];
  v_pending_reference      text[]    := '{}'::text[];

  v_i              integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- CHANGE 1: delivery_operator is admitted so the operator can record a
  -- prepaid payment or a cash-on-delivery collection without handing the
  -- drawer to a cashier.
  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'pay_order: only cashier, admin or delivery_operator may settle an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_caller_profile
    FROM public.profiles p
   WHERE p.user_id = private.current_user_id()
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'pay_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'pay_order: p_idempotency_key must not be null'
      USING ERRCODE = '22023';
  END IF;

  IF p_tip_amount IS NULL OR p_tip_amount < 0 THEN
    RAISE EXCEPTION 'pay_order: p_tip_amount must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_tenders IS NULL OR jsonb_typeof(p_tenders) <> 'array' OR jsonb_array_length(p_tenders) = 0 THEN
    RAISE EXCEPTION 'pay_order: p_tenders must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_tenders) > 20 THEN
    RAISE EXCEPTION 'pay_order: p_tenders accepts at most 20 lines'
      USING ERRCODE = '22023';
  END IF;

  v_tender_count := jsonb_array_length(p_tenders);

  FOR v_line_no IN 1..v_tender_count LOOP
    v_tender := p_tenders -> (v_line_no - 1);

    IF v_tender IS NULL OR jsonb_typeof(v_tender) <> 'object' THEN
      RAISE EXCEPTION 'pay_order: tender[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_tender ? 'payment_method_id') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing payment_method_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_method_id := (v_tender ->> 'payment_method_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_tender ? 'amount') THEN
      RAISE EXCEPTION 'pay_order: tender[%] is missing amount', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_amount := (v_tender ->> 'amount')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'pay_order: tender[%].amount must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF v_tender ? 'cash_received' AND v_tender -> 'cash_received' IS NOT NULL AND v_tender -> 'cash_received' <> 'null'::jsonb THEN
      BEGIN
        v_cash_received := (v_tender ->> 'cash_received')::bigint;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received is not an integer', v_line_no
          USING ERRCODE = '22023';
      END;
    ELSE
      v_cash_received := NULL;
    END IF;

    -- 0014: optional manual reference (absent or JSON null = none).
    IF v_tender ? 'reference' AND v_tender -> 'reference' <> 'null'::jsonb THEN
      IF jsonb_typeof(v_tender -> 'reference') <> 'string' THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be a string', v_line_no
          USING ERRCODE = '22023';
      END IF;
      v_reference := btrim(v_tender ->> 'reference');
      IF length(v_reference) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'pay_order: tender[%].reference must be 1 to 60 characters', v_line_no
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_reference := NULL;
    END IF;

    v_pending_line_no        := v_pending_line_no || v_line_no;
    v_pending_payment_method := v_pending_payment_method || v_method_id;
    v_pending_amount         := v_pending_amount || v_amount;
    v_pending_cash_received  := v_pending_cash_received || v_cash_received;
    v_pending_reference      := v_pending_reference || v_reference;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_order.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Existing payment for this order? UNIQUE (order_id) makes this a 0/1
  -- decision.
  -- 0018: a voided payment does not settle the order; its key stays spent.
  IF EXISTS (SELECT 1 FROM public.payments p
              WHERE p.restaurant_id = v_caller_tenant
                AND p.idempotency_key = p_idempotency_key
                AND p.voided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'pay_order: idempotency key % belongs to a voided payment; retry with a new key', p_idempotency_key
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_existing
    FROM public.payments p
   WHERE p.order_id = p_order_id
     AND p.voided_at IS NULL;

  IF FOUND THEN
    IF v_existing.idempotency_key = p_idempotency_key THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'line_no', t.line_no,
                 'method_code', t.method_code,
                 'amount', t.amount,
                 'cash_received', t.cash_received)
                 ORDER BY t.line_no), '[]'::jsonb)
        INTO v_tender_lines
        FROM public.payment_tenders t
       WHERE t.payment_id = v_existing.id;

      RETURN jsonb_build_object(
        'payment_id',         v_existing.id,
        'status',             'already_paid',
        'amount_due',         v_existing.amount_due,
        'tip_amount',         v_existing.tip_amount,
        'total_charged',      v_existing.total_charged,
        'change_given',       v_existing.change_given,
        'drawer_warning',     false,
        'drawer_cash_before', 0,
        'tenders',            v_tender_lines
      );
    ELSE
      RAISE EXCEPTION 'pay_order: order % is already paid', p_order_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_order.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'pay_order: order % cannot be paid (status=%)',
      p_order_id, v_order.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Cash register.
  SELECT r.* INTO v_register
    FROM public.cash_registers r
   WHERE r.id = p_cash_register_id
     FOR SHARE;

  IF NOT FOUND OR v_register.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'pay_order: cash register % not found', p_cash_register_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_register.status <> 'open' THEN
    RAISE EXCEPTION 'pay_order: cash register % is not open (status=%)',
      p_cash_register_id, v_register.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Server-side amount.
  SELECT coalesce(sum(round(oi.price * oi.quantity)), 0)::bigint
    INTO v_subtotal
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.restaurant_id = v_caller_tenant;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'pay_order: order % has no items', p_order_id
      USING ERRCODE = 'P0001';
  END IF;

  v_tax := round(v_subtotal * coalesce(v_order.tax_percentage, 0)::numeric / 100)::bigint;

  -- CHANGE 2: add the delivery fee when the order is a delivery. The
  -- order_deliveries row is guaranteed to exist by the consistency trigger
  -- (1:1 with the order, same restaurant). No tax on the fee, no tip on the
  -- fee: the tax is computed on the food subtotal only, and the tip is the
  -- caller's p_tip_amount as today.
  v_delivery_fee := 0;
  IF v_order.order_type = 'delivery' THEN
    SELECT coalesce(od.delivery_fee, 0)
      INTO v_delivery_fee
      FROM public.order_deliveries od
     WHERE od.order_id = p_order_id;

    IF v_delivery_fee IS NULL THEN
      -- A delivery order with no order_deliveries row is a schema invariant
      -- break. The 23514 from the consistency trigger would already have
      -- fired; this is a defense in depth.
      v_delivery_fee := 0;
    END IF;
  END IF;

  v_amount_due := v_subtotal + v_tax + v_delivery_fee;

  -- 6. Tenders.
  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind, m.is_active, m.restaurant_id
      INTO v_method_code, v_method_kind, v_method_active, v_method_tenant
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    IF NOT FOUND OR v_method_tenant <> v_caller_tenant THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id does not resolve to a method of the caller tenant', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_method_active THEN
      RAISE EXCEPTION 'pay_order: tender[%].payment_method_id resolves to an inactive method (% of tenant %)',
        v_line_no, v_method_code, v_method_tenant
        USING ERRCODE = 'P0001';
    END IF;

    v_tenders_sum := v_tenders_sum + v_amount;

    IF v_method_kind = 'cash' THEN
      IF v_cash_received IS NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is a cash method but cash_received is NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
      IF v_cash_received < v_amount THEN
        RAISE EXCEPTION 'pay_order: tender[%].cash_received (%) is below amount (%)',
          v_line_no, v_cash_received, v_amount
          USING ERRCODE = 'P0001';
      END IF;
      v_change_given := v_change_given + (v_cash_received - v_amount);
      v_cash_received_sum := v_cash_received_sum + v_cash_received;
    ELSE
      IF v_cash_received IS NOT NULL THEN
        RAISE EXCEPTION 'pay_order: tender[%] is an electronic method but cash_received is not NULL', v_line_no
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  IF v_tenders_sum <> (v_amount_due + p_tip_amount) THEN
    RAISE EXCEPTION 'pay_order: tenders sum to % but amount_due + tip = %',
      v_tenders_sum, (v_amount_due + p_tip_amount)
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Drawer warning (warn only).
  v_drawer_cash_before := v_register.initial_cash;

  SELECT coalesce(v_drawer_cash_before + sum(t.amount), v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = p_cash_register_id
     AND p.voided_at IS NULL
     AND t.method_kind = 'cash';

  SELECT coalesce(v_drawer_cash_before
                  + coalesce(sum(CASE WHEN ct.type = 'deposit' THEN ct.amount ELSE 0 END), 0)
                  - coalesce(sum(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END), 0),
                  v_drawer_cash_before)::bigint
    INTO v_drawer_cash_before
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = p_cash_register_id;

  v_drawer_warning := v_change_given > v_drawer_cash_before;

  -- 8. Writes.
  INSERT INTO public.payments (
    restaurant_id, order_id, cash_register_id, cashier_profile_id,
    amount_due, tip_amount, total_charged, change_given, idempotency_key
  ) VALUES (
    v_caller_tenant, p_order_id, p_cash_register_id, v_caller_profile,
    v_amount_due, p_tip_amount, v_amount_due + p_tip_amount, v_change_given, p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  FOR v_i IN 1..array_length(v_pending_line_no, 1) LOOP
    v_line_no        := v_pending_line_no[v_i];
    v_method_id      := v_pending_payment_method[v_i];
    v_amount         := v_pending_amount[v_i];
    v_cash_received  := v_pending_cash_received[v_i];

    SELECT m.code, m.kind
      INTO v_method_code, v_method_kind
      FROM public.payment_methods m
     WHERE m.id = v_method_id;

    INSERT INTO public.payment_tenders (
      restaurant_id, payment_id, line_no, payment_method_id,
      method_code, method_kind, amount, cash_received, reference
    ) VALUES (
      v_caller_tenant, v_payment_id, v_line_no, v_method_id,
      v_method_code, v_method_kind, v_amount, v_cash_received, v_pending_reference[v_i]
    );
  END LOOP;

  -- 9. Order update. tip_percentage is the tip / subtotal ratio (the food
  -- subtotal, NOT amount_due), the same as the original pay_order.
  UPDATE public.orders o
     SET subtotal = v_subtotal,
         tax = v_tax,
         tip = p_tip_amount,
         tip_percentage = CASE WHEN v_subtotal > 0
                               THEN round((p_tip_amount * 100.0 / v_subtotal)::numeric, 2)
                               ELSE 0 END,
         total = v_amount_due + p_tip_amount,
         status = 'paid',
         updated_at = now()
   WHERE o.id = p_order_id;

  -- 10. Table release (delivery orders have table_id NULL; the IF guard
  -- already short-circuits).
  IF v_order.table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.table_id = v_order.table_id
         AND o.id <> p_order_id
         AND o.status IN ('active', 'kitchen', 'delivered')
    ) THEN
      UPDATE public.tables t
         SET status = 'available',
             updated_at = now()
       WHERE t.id = v_order.table_id;
    END IF;
  END IF;

  -- 11. Response.
  RETURN jsonb_build_object(
    'payment_id',         v_payment_id,
    'status',             'paid',
    'amount_due',         v_amount_due,
    'tip_amount',         p_tip_amount,
    'total_charged',      v_amount_due + p_tip_amount,
    'change_given',       v_change_given,
    'drawer_warning',     v_drawer_warning,
    'drawer_cash_before', v_drawer_cash_before,
    'tenders',            (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'line_no',        t.line_no,
        'method_code',    t.method_code,
        'amount',         t.amount,
        'cash_received',  t.cash_received
      ) ORDER BY t.line_no), '[]'::jsonb)
        FROM public.payment_tenders t
       WHERE t.payment_id = v_payment_id
    )
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.register_summary(p_cash_register_ids uuid[]) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_visible_count   bigint := 0;
  v_array_len       integer;

  v_initial_cash    bigint := 0;
  v_payments_count  bigint := 0;
  v_total_billed    bigint := 0;
  v_total_tips      bigint := 0;
  v_total_sales     bigint := 0;
  v_total_change    bigint := 0;

  v_cash_deposits    bigint := 0;
  v_cash_withdrawals bigint := 0;
  v_cash_tender_total bigint := 0;
  v_expected_cash    bigint := 0;
  v_tips_payout      bigint := 0;
  v_after_tips       bigint := 0;

  v_methods         jsonb;
  v_legacy          jsonb;

  v_ids uuid[];
BEGIN
  -- 1. Caller resolution. delivery_operator is admitted (read-only) so the
  -- operator can read the same summary the cashier / admin close screen
  -- shows. The summary is a SECURITY INVOKER read; it does not write.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'register_summary: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin', 'delivery_operator') THEN
    RAISE EXCEPTION 'register_summary: only cashier, admin or delivery_operator may read the summary'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_cash_register_ids IS NULL THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  v_array_len := array_length(p_cash_register_ids, 1);
  IF v_array_len IS NULL OR v_array_len = 0 THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must be a non-empty array'
      USING ERRCODE = '22023';
  END IF;

  IF v_array_len > 100 THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids accepts at most 100 entries'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(v) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> v_array_len THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> (SELECT count(DISTINCT v) FROM unnest(p_cash_register_ids) v) THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain duplicates'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_visible_count
    FROM public.cash_registers
   WHERE id = ANY (p_cash_register_ids);

  IF v_visible_count <> v_array_len THEN
    RAISE EXCEPTION 'register_summary: cash register(s) not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT v FROM unnest(p_cash_register_ids) v);

  SELECT
      coalesce(round(SUM(cr.initial_cash))::bigint, 0)
    INTO v_initial_cash
    FROM public.cash_registers cr
   WHERE cr.id = ANY (v_ids);

  SELECT
      count(*),
      coalesce(sum(p.amount_due), 0)::bigint,
      coalesce(sum(p.tip_amount),  0)::bigint,
      coalesce(sum(p.change_given), 0)::bigint
    INTO v_payments_count, v_total_billed, v_total_tips, v_total_change
    FROM public.payments p
   WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL;

  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_total_sales
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL;

  SELECT
      coalesce(round(SUM(CASE WHEN ct.type = 'deposit'    THEN ct.amount ELSE 0 END))::bigint, 0),
      coalesce(round(SUM(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END))::bigint, 0)
    INTO v_cash_deposits, v_cash_withdrawals
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = ANY (v_ids);

  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_cash_tender_total
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL
     AND t.method_kind = 'cash';

  v_expected_cash   := v_initial_cash + v_cash_tender_total + v_cash_deposits - v_cash_withdrawals;
  v_tips_payout     := v_total_tips;
  v_after_tips      := v_expected_cash - v_tips_payout;

  SELECT coalesce(jsonb_agg(row_to_json(m) ORDER BY m.sort_order, m.name), '[]'::jsonb)
    INTO v_methods
    FROM (
      SELECT
          cat.id            AS payment_method_id,
          cat.code          AS code,
          cat.name          AS name,
          cat.kind          AS kind,
          cat.sort_order    AS sort_order,
          cat.is_active     AS is_active,
          coalesce(agg.total, 0)::bigint       AS total,
          coalesce(agg.tenders_count, 0)::bigint AS tenders_count
        FROM public.payment_methods cat
        LEFT JOIN (
          SELECT t.payment_method_id,
                 sum(t.amount)::bigint AS total,
                 count(*)::bigint      AS tenders_count
            FROM public.payment_tenders t
            JOIN public.payments p ON p.id = t.payment_id
           WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL
           GROUP BY t.payment_method_id
        ) agg ON agg.payment_method_id = cat.id
       WHERE cat.restaurant_id = v_caller_tenant
    ) m;

  SELECT jsonb_build_object(
      'payments_count', count(*)::bigint,
      'total',         coalesce(round(SUM(pt.amount))::bigint,       0),
      'tips',          coalesce(round(SUM(pt.tip_amount))::bigint,   0),
      'change',        coalesce(round(SUM(pt.cash_change))::bigint,  0),
      'by_method',     (
        SELECT coalesce(jsonb_object_agg(method, total), '{}'::jsonb)
          FROM (
            SELECT pt2.method,
                   round(SUM(pt2.amount))::bigint AS total
              FROM public.payment_transactions pt2
             WHERE pt2.cash_register_id = ANY (v_ids)
             GROUP BY pt2.method
          ) bm
      )
    )
    INTO v_legacy
    FROM public.payment_transactions pt
   WHERE pt.cash_register_id = ANY (v_ids);

  v_legacy := coalesce(v_legacy, jsonb_build_object(
    'payments_count', 0,
    'total',         0,
    'tips',          0,
    'change',        0,
    'by_method',     '{}'::jsonb
  ));

  RETURN jsonb_build_object(
    'registers_count',         v_array_len::bigint,
    'initial_cash',            v_initial_cash,
    'payments_count',          v_payments_count,
    'total_billed',            v_total_billed,
    'total_tips',              v_total_tips,
    'total_sales',             v_total_sales,
    'total_change',            v_total_change,
    'methods',                 v_methods,
    'cash_deposits',           v_cash_deposits,
    'cash_withdrawals',        v_cash_withdrawals,
    'expected_cash',           v_expected_cash,
    'tips_payout',             v_tips_payout,
    'expected_cash_after_tips', v_after_tips,
    'legacy',                  v_legacy
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.split_order(p_parent_order_id uuid, p_items jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_parent          public.orders%ROWTYPE;
  v_child_id        uuid;

  v_item_count      integer := 0;
  v_item            jsonb;
  v_line_no         integer := 0;
  v_item_id         uuid;
  v_item_qty        integer;

  v_pending_item_id  uuid[]    := '{}'::uuid[];
  v_pending_quantity integer[] := '{}'::integer[];

  v_remaining jsonb;

  v_parent_item public.order_items%ROWTYPE;

  v_child_subtotal bigint;
  v_child_tax      bigint;
  v_child_tip      bigint;
  v_child_total    bigint;
  v_child_tax_pct  numeric;
  v_child_tip_pct  numeric;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;

  v_i integer;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'split_order: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'split_order: only cashier or admin may split an order'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Input validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'split_order: p_items must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'split_order: p_items must be a non-empty JSON array'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'split_order: p_items accepts at most 50 lines'
      USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  FOR v_line_no IN 1..v_item_count LOOP
    v_item := p_items -> (v_line_no - 1);

    IF v_item IS NULL OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'split_order: item[%] must be a JSON object', v_line_no
        USING ERRCODE = '22023';
    END IF;

    IF NOT (v_item ? 'order_item_id') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing order_item_id', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_id := (v_item ->> 'order_item_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id is not a uuid', v_line_no
        USING ERRCODE = '22023';
    END;

    IF NOT (v_item ? 'quantity') THEN
      RAISE EXCEPTION 'split_order: item[%] is missing quantity', v_line_no
        USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_item_qty := (v_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'split_order: item[%].quantity is not an integer', v_line_no
        USING ERRCODE = '22023';
    END;

    IF v_item_qty IS NULL OR v_item_qty < 1 THEN
      RAISE EXCEPTION 'split_order: item[%].quantity must be a positive integer', v_line_no
        USING ERRCODE = '22023';
    END IF;

    v_i := array_position(v_pending_item_id, v_item_id);
    IF v_i IS NOT NULL THEN
      RAISE EXCEPTION 'split_order: item[%].order_item_id duplicates item[%]',
        v_line_no, v_i
        USING ERRCODE = '22023';
    END IF;

    v_pending_item_id  := v_pending_item_id || v_item_id;
    v_pending_quantity := v_pending_quantity || v_item_qty;
  END LOOP;

  -- 3. Order.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = p_parent_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'split_order: order % not found', p_parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- CHANGE: reject delivery orders. A delivery order carries a snapshot of
  -- the customer / address in order_deliveries; splitting it would either
  -- double the delivery (one courier, two orders) or orphan a partial
  -- delivery with no destination. Refuse explicitly.
  IF v_parent.order_type = 'delivery' THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (it is a delivery order)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Parent rules.
  IF v_parent.is_partial_order THEN
    RAISE EXCEPTION 'split_order: order % is itself a partial child (cannot be split further)',
      p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_parent.status NOT IN ('active', 'kitchen', 'delivered') THEN
    RAISE EXCEPTION 'split_order: order % cannot be split (status=%)',
      p_parent_order_id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_parent_order_id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'split_order: order % already has a payment', p_parent_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Items.
  v_remaining := '{}'::jsonb;

  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'split_order: item[%] does not belong to the order', v_line_no
        USING ERRCODE = 'P0001';
    END IF;

    IF v_item_qty > v_parent_item.quantity THEN
      RAISE EXCEPTION 'split_order: item[%] quantity % exceeds the available quantity %',
        v_line_no, v_item_qty, v_parent_item.quantity
        USING ERRCODE = 'P0001';
    END IF;

    v_remaining := v_remaining || jsonb_build_object(
      v_item_id::text,
      to_jsonb(v_parent_item.quantity - v_item_qty)
    );
  END LOOP;

  -- 6. Move-all guard.
  SELECT count(*)::bigint
    INTO v_i
    FROM (
      SELECT (v_remaining ->> k.k)::int AS remaining
        FROM jsonb_object_keys(v_remaining) k(k)
       WHERE (v_remaining ->> k.k)::int > 0
      UNION ALL
      SELECT oi.quantity
        FROM public.order_items oi
       WHERE oi.order_id = p_parent_order_id
         AND NOT (v_remaining ? oi.id::text)
    ) s
   WHERE s.remaining > 0;

  IF v_i = 0 THEN
    RAISE EXCEPTION 'split_order: cannot move every item; pay the order instead'
      USING ERRCODE = 'P0001';
  END IF;

  -- 7. Child.
  INSERT INTO public.orders (
    restaurant_id, table_id, waiter_id, status,
    subtotal, tax, tax_percentage, tip, tip_percentage, total,
    total_discounts, is_partial_order, parent_order_id
  ) VALUES (
    v_caller_tenant, v_parent.table_id, v_parent.waiter_id, v_parent.status,
    0, 0, v_parent.tax_percentage, 0, v_parent.tip_percentage, 0,
    v_parent.total_discounts, true, p_parent_order_id
  )
  RETURNING id INTO v_child_id;

  -- 8. Move.
  FOR v_line_no IN 1..v_item_count LOOP
    v_item_id  := v_pending_item_id[v_line_no];
    v_item_qty := v_pending_quantity[v_line_no];

    SELECT oi.* INTO v_parent_item
      FROM public.order_items oi
     WHERE oi.id = v_item_id
       AND oi.order_id = p_parent_order_id
       AND oi.restaurant_id = v_caller_tenant
     FOR UPDATE;

    IF v_item_qty = v_parent_item.quantity THEN
      UPDATE public.order_items oi
         SET order_id = v_child_id
       WHERE oi.id = v_item_id;
    ELSE
      UPDATE public.order_items oi
         SET quantity = oi.quantity - v_item_qty
       WHERE oi.id = v_item_id;

      INSERT INTO public.order_items (
        order_id, dish_id, name, price, quantity, comments,
        status, added_at, restaurant_id, stock_consumed_at
      ) VALUES (
        v_child_id, v_parent_item.dish_id, v_parent_item.name, v_parent_item.price,
        v_item_qty, v_parent_item.comments, v_parent_item.status,
        v_parent_item.added_at, v_caller_tenant, v_parent_item.stock_consumed_at
      );
    END IF;
  END LOOP;

  -- 9. Recompute.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_child_subtotal, v_child_tax, v_child_tip, v_child_total,
         v_child_tax_pct, v_child_tip_pct
    FROM private.recompute_order_bill(v_child_id);

  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(p_parent_order_id);

  -- 10. Response.
  RETURN jsonb_build_object(
    'child_order_id', v_child_id,
    'parent', jsonb_build_object(
      'order_id', p_parent_order_id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    ),
    'child', jsonb_build_object(
      'order_id', v_child_id,
      'subtotal', v_child_subtotal,
      'tax',      v_child_tax,
      'tip',      v_child_tip,
      'total',    v_child_total
    )
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.undo_split(p_child_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_child           public.orders%ROWTYPE;
  v_parent          public.orders%ROWTYPE;
  v_child_item      public.order_items%ROWTYPE;
  v_match           public.order_items%ROWTYPE;

  v_parent_subtotal bigint;
  v_parent_tax      bigint;
  v_parent_tip      bigint;
  v_parent_total    bigint;
  v_parent_tax_pct  numeric;
  v_parent_tip_pct  numeric;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'undo_split: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'undo_split: only cashier or admin may undo a split'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Read the child first (without lock) to learn its parent id; the
  -- tenant boundary and the partial-flag check both fire on this read. The
  -- lock is acquired later (parent first, then child) to avoid deadlocks with
  -- split_order running concurrently on the same parent.
  SELECT o.* INTO v_child
    FROM public.orders o
   WHERE o.id = p_child_order_id
     AND o.restaurant_id = v_caller_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'undo_split: order % not found', p_child_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Child rules.
  IF NOT v_child.is_partial_order OR v_child.parent_order_id IS NULL THEN
    RAISE EXCEPTION 'undo_split: order % is not a partial order', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_child.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: child order % has status=% (cannot undo)',
      p_child_order_id, v_child.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_child_order_id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'undo_split: child order % already has a payment', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 0018: voids are history, so a child order with events is not merged back.
  IF EXISTS (SELECT 1 FROM public.audit_log a WHERE a.order_id = p_child_order_id) THEN
    RAISE EXCEPTION 'undo_split: child order % has voided items or payments', p_child_order_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Lock the parent now that we know it is non-NULL.
  SELECT o.* INTO v_parent
    FROM public.orders o
   WHERE o.id = v_child.parent_order_id
     AND o.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND OR v_parent.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'undo_split: parent order % not found', v_child.parent_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock the child now (parent already locked).
  PERFORM 1 FROM public.orders o
    WHERE o.id = p_child_order_id
      AND o.restaurant_id = v_caller_tenant
      FOR UPDATE;

  -- Parent rules.
  IF v_parent.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'undo_split: parent order % has status=% (cannot undo)',
      v_parent.id, v_parent.status
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = v_parent.id AND p.voided_at IS NULL) THEN
    RAISE EXCEPTION 'undo_split: parent order % already has a payment', v_parent.id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Merge each child item back to the parent.
  FOR v_child_item IN
    SELECT oi.*
      FROM public.order_items oi
     WHERE oi.order_id = p_child_order_id
     ORDER BY oi.id
     FOR UPDATE
  LOOP
    -- Match against a parent row with the same dish_id, price, comments
    -- (NULL-safe) and status. The cheapest way to express the NULL-safety is
    -- IS NOT DISTINCT FROM.
    SELECT oi.* INTO v_match
      FROM public.order_items oi
     WHERE oi.order_id = v_parent.id
       AND oi.dish_id IS NOT DISTINCT FROM v_child_item.dish_id
       AND oi.price   IS NOT DISTINCT FROM v_child_item.price
       AND oi.comments IS NOT DISTINCT FROM v_child_item.comments
       AND oi.status  IS NOT DISTINCT FROM v_child_item.status
       AND (oi.stock_consumed_at IS NULL) = (v_child_item.stock_consumed_at IS NULL)
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE public.order_items oi
         SET quantity = oi.quantity + v_child_item.quantity
       WHERE oi.id = v_match.id;

      DELETE FROM public.order_items WHERE id = v_child_item.id;
    ELSE
      UPDATE public.order_items oi
         SET order_id = v_parent.id
       WHERE oi.id = v_child_item.id;
    END IF;
  END LOOP;

  -- 5. Cleanup.
  DELETE FROM public.orders WHERE id = p_child_order_id;

  -- 6. Recompute parent.
  SELECT subtotal, tax, tip, total, tax_percentage, tip_percentage
    INTO v_parent_subtotal, v_parent_tax, v_parent_tip, v_parent_total,
         v_parent_tax_pct, v_parent_tip_pct
    FROM private.recompute_order_bill(v_parent.id);

  RETURN jsonb_build_object(
    'parent', jsonb_build_object(
      'order_id', v_parent.id,
      'subtotal', v_parent_subtotal,
      'tax',      v_parent_tax,
      'tip',      v_parent_tip,
      'total',    v_parent_total
    )
  );
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_delivery_status(p_order_id uuid, p_action text, p_courier_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_courier_eta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_courier_location text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_delivery        public.order_deliveries%ROWTYPE;
  v_order           public.orders%ROWTYPE;
  v_current_state   text;
  v_target_state    text;
  v_courier         public.couriers%ROWTYPE;
  v_reason_text     text;
  v_location        text;

  v_allowed_states  text[];
  v_kitchen_allowed boolean := false;
  v_caller_allowed  boolean := false;

  v_now             timestamptz := now();
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'set_delivery_status: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Lock the delivery row in the caller's tenant.
  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id
     AND od.restaurant_id = v_caller_tenant
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_delivery_status: delivery for order % not found', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  v_current_state := v_delivery.delivery_status;

  -- 3. Action dispatch.
  IF p_action NOT IN ('start_preparing', 'mark_ready', 'dispatch', 'deliver', 'fail', 'cancel') THEN
    RAISE EXCEPTION 'set_delivery_status: unknown action ''%''', p_action
      USING ERRCODE = '22023';
  END IF;

  -- role/action matrix.
  IF p_action IN ('start_preparing', 'mark_ready') THEN
    v_kitchen_allowed := v_caller_role IN ('kitchen', 'delivery_operator', 'admin');
    v_caller_allowed  := v_kitchen_allowed;
  ELSE
    v_caller_allowed := v_caller_role IN ('delivery_operator', 'admin');
  END IF;

  IF NOT v_caller_allowed THEN
    RAISE EXCEPTION 'set_delivery_status: role ''%'' may not perform ''%''',
      v_caller_role, p_action
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4. State machine.
  IF p_action = 'start_preparing' THEN
    v_allowed_states := ARRAY['received'];
    v_target_state   := 'preparing';
  ELSIF p_action = 'mark_ready' THEN
    v_allowed_states := ARRAY['received', 'preparing'];
    v_target_state   := 'ready';
  ELSIF p_action = 'dispatch' THEN
    v_allowed_states := ARRAY['ready', 'failed'];
    v_target_state   := 'out_for_delivery';
  ELSIF p_action = 'deliver' THEN
    v_allowed_states := ARRAY['out_for_delivery'];
    v_target_state   := 'delivered';
  ELSIF p_action = 'fail' THEN
    v_allowed_states := ARRAY['out_for_delivery'];
    v_target_state   := 'failed';
  ELSIF p_action = 'cancel' THEN
    v_allowed_states := ARRAY['received', 'preparing', 'ready', 'failed'];
    v_target_state   := 'cancelled';
  END IF;

  -- Same-state replays: P0001 with a clear message naming the current state.
  -- Easier to reason about in the UI than a silent no-op.
  IF v_current_state = v_target_state THEN
    RAISE EXCEPTION 'set_delivery_status: delivery for order % is already in state ''%''',
      p_order_id, v_current_state
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (v_current_state = ANY (v_allowed_states)) THEN
    RAISE EXCEPTION 'set_delivery_status: action ''%'' is not allowed from state ''%'' (allowed: %)',
      p_action, v_current_state, array_to_string(v_allowed_states, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Per-action validation.
  IF p_action = 'fail' THEN
    v_reason_text := btrim(coalesce(p_reason, ''));
    IF v_reason_text = '' THEN
      RAISE EXCEPTION 'set_delivery_status: fail requires a non-empty reason'
        USING ERRCODE = '22023';
    END IF;
    IF length(v_reason_text) > 200 THEN
      RAISE EXCEPTION 'set_delivery_status: fail reason must be <= 200 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_action <> 'dispatch' AND (p_courier_eta IS NOT NULL OR p_courier_location IS NOT NULL) THEN
    RAISE EXCEPTION 'set_delivery_status: p_courier_eta and p_courier_location are only allowed with dispatch'
      USING ERRCODE = '22023';
  END IF;

  IF p_action = 'dispatch' THEN
    -- Typed by the operator (no courier GPS): when the courier is expected
    -- back, and where they are.
    IF p_courier_eta IS NOT NULL
       AND (p_courier_eta <= v_now OR p_courier_eta > v_now + interval '6 hours') THEN
      RAISE EXCEPTION 'set_delivery_status: p_courier_eta must be after now and within 6 hours'
        USING ERRCODE = '22023';
    END IF;

    v_location := btrim(p_courier_location);
    IF p_courier_location IS NOT NULL AND (v_location = '' OR length(v_location) > 60) THEN
      RAISE EXCEPTION 'set_delivery_status: p_courier_location must be 1..60 characters'
        USING ERRCODE = '22023';
    END IF;

    IF p_courier_id IS NULL THEN
      RAISE EXCEPTION 'set_delivery_status: dispatch requires p_courier_id'
        USING ERRCODE = '22023';
    END IF;

    SELECT co.* INTO v_courier
      FROM public.couriers co
     WHERE co.id = p_courier_id
       AND co.restaurant_id = v_caller_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_delivery_status: courier % not found', p_courier_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_courier.is_active THEN
      RAISE EXCEPTION 'set_delivery_status: courier % is not active', p_courier_id
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_action = 'cancel' THEN
    -- Lock the order before looking for payments: pay_order holds this lock
    -- while it writes, so the check cannot pass and then lose to a payment
    -- committed in between (which would cancel a paid order).
    PERFORM 1 FROM public.orders o
      WHERE o.id = p_order_id
        AND o.restaurant_id = v_caller_tenant
        FOR UPDATE;

    -- Refuse to cancel an order that has a payment: refunds are out of scope.
    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id AND p.voided_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.orders o
                   WHERE o.id = p_order_id AND o.status = 'paid') THEN
      RAISE EXCEPTION 'set_delivery_status: order % already has a payment (refunds are out of scope)',
        p_order_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 6. Writes.
  IF p_action = 'start_preparing' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'preparing'
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'mark_ready' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'ready'
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'dispatch' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'out_for_delivery',
           courier_id     = v_courier.id,
           dispatched_at  = v_now,
           failure_reason = NULL,
           courier_eta    = p_courier_eta,
           courier_location = v_location,
           returned_at    = NULL
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'deliver' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'delivered',
           delivered_at    = v_now
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'fail' THEN
    UPDATE public.order_deliveries od
       SET delivery_status = 'failed',
           failure_reason  = v_reason_text,
           failed_at       = v_now
     WHERE od.order_id = p_order_id;
  ELSIF p_action = 'cancel' THEN
    -- The order row is already locked by the payment check above. pay_order
    -- locks the order FOR UPDATE and never the delivery row, so a concurrent
    -- cancel + pay_order pair cannot form a cycle.
    UPDATE public.order_deliveries od
       SET delivery_status = 'cancelled',
           cancelled_at    = v_now
     WHERE od.order_id = p_order_id;

    UPDATE public.orders o
       SET status      = 'cancelled',
           updated_at  = v_now
     WHERE o.id = p_order_id
       AND o.restaurant_id = v_caller_tenant;
  END IF;

  -- 7. Response.
  SELECT od.* INTO v_delivery
    FROM public.order_deliveries od
   WHERE od.order_id = p_order_id;

  RETURN to_jsonb(v_delivery);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION private.void_reason_text(p_fn text, p_reason_code text, p_reason_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_text text := nullif(btrim(regexp_replace(coalesce(p_reason_text, ''), '\s+', ' ', 'g')), '');
BEGIN
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('waiter_error', 'customer_left', 'dish_returned', 'duplicate_charge', 'wrong_payment_method', 'other') THEN
    RAISE EXCEPTION '%: reason_invalid', p_fn USING ERRCODE = '22023';
  END IF;
  IF (p_reason_code = 'other' AND v_text IS NULL) OR (v_text IS NOT NULL AND length(v_text) NOT BETWEEN 3 AND 200) THEN
    RAISE EXCEPTION '%: reason_text_required', p_fn USING ERRCODE = '22023';
  END IF;
  RETURN v_text;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.void_reason_text(text, text, text) IS 'Validates a cancellation/void reason code (the fixed list of the API, VOID_REASONS) and returns the free text collapsed and trimmed (NULL when blank). "other" needs a text; a text is 3..200 characters. 22023 reason_invalid / reason_text_required.';
--> statement-breakpoint
CREATE FUNCTION private.void_authorizer(p_fn text, p_restaurant_id uuid, p_actor uuid, p_action text, p_authorization_id uuid, p_required boolean,
                                        OUT authorized_by uuid, OUT authorized_by_name text, OUT self_authorized boolean) RETURNS record
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_auth public.supervisor_authorizations%ROWTYPE;
BEGIN
  self_authorized := false;
  IF p_authorization_id IS NULL THEN
    IF p_required THEN
      RAISE EXCEPTION '%: authorization_required', p_fn USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  SELECT a.* INTO v_auth
    FROM public.supervisor_authorizations a
   WHERE a.id = p_authorization_id
     AND a.restaurant_id = p_restaurant_id
     AND a.action = p_action
     AND a.consumed_at IS NOT NULL
     AND a.supervisor_profile_id IS NOT NULL;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.audit_log l WHERE l.authorization_id = p_authorization_id) THEN
    RAISE EXCEPTION '%: authorization_invalid', p_fn USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.full_name INTO authorized_by, authorized_by_name
    FROM public.profiles p
   WHERE p.id = v_auth.supervisor_profile_id
     AND p.restaurant_id = p_restaurant_id
     AND p.active
     AND p.role IN ('admin', 'cashier');
  IF authorized_by IS NULL THEN
    RAISE EXCEPTION '%: authorization_invalid', p_fn USING ERRCODE = '42501';
  END IF;

  IF authorized_by = p_actor THEN
    IF NOT EXISTS (SELECT 1 FROM public.business_config bc
                    WHERE bc.restaurant_id = p_restaurant_id
                      AND bc.key = 'allow_self_authorization'
                      AND bc.value = 'true') THEN
      RAISE EXCEPTION '%: self_authorization_not_allowed', p_fn USING ERRCODE = '42501';
    END IF;
    self_authorized := true;
  END IF;
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION private.void_authorizer(text, uuid, uuid, text, uuid, boolean) IS 'The supervisor behind a cancellation or void. Without an authorization: 42501 authorization_required when p_required, else no authorizer. With one: it must be of the restaurant, for p_action, already consumed in this request (private.consume_supervisor_authorization), not backing another audit_log event, from an active admin or cashier (else authorization_invalid); the actor themself only with allow_self_authorization = true (else self_authorization_not_allowed), then self_authorized.';
--> statement-breakpoint
CREATE FUNCTION public.cancel_order(p_order_id uuid, p_reason_code text, p_reason_text text DEFAULT NULL, p_authorization_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'cancel_order';
  v_caller  record;
  v_name    text;
  v_order   public.orders%ROWTYPE;
  v_text    text;
  v_items   jsonb;
  v_sent    integer;
  v_live    integer;
  v_paid    boolean;
  v_auth    record;
  v_audit   uuid;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier', 'waiter']);
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_caller.profile_id;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.restaurant_id = v_caller.restaurant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: order_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION '%: order_cancelled', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_order.status = 'paid' THEN
    RAISE EXCEPTION '%: order_paid', c_fn USING ERRCODE = 'P0001';
  END IF;
  IF v_order.order_type = 'delivery' THEN
    RAISE EXCEPTION '%: delivery_order', c_fn USING ERRCODE = 'P0001';
  END IF;
  v_text := private.void_reason_text(c_fn, p_reason_code, p_reason_text);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', oi.id, 'dish_id', oi.dish_id, 'name', oi.name, 'price', oi.price, 'quantity', oi.quantity,
           'status', oi.status, 'sent_to_kitchen', true, 'stock_consumed', oi.stock_consumed_at IS NOT NULL)
           ORDER BY oi.added_at, oi.created_at, oi.id), '[]'::jsonb),
         count(*)
    INTO v_items, v_live
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.quantity > 0
     AND coalesce(oi.status, '') <> 'cancelled';
  -- Every server-side line was sent to the kitchen (the cart lives in the client).
  v_sent := v_live;
  v_paid := EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id);

  SELECT * INTO v_auth FROM private.void_authorizer(c_fn, v_caller.restaurant_id, v_caller.profile_id, 'cancel_order',
                                                    p_authorization_id, v_live > 0 OR v_paid);

  INSERT INTO public.audit_log
    (restaurant_id, event_type, order_id, actor_profile_id, actor_name, authorized_by_profile_id, authorized_by_name,
     authorization_id, self_authorized, reason_code, reason_text, amount, details)
  VALUES
    (v_caller.restaurant_id, 'order_cancelled', p_order_id, v_caller.profile_id, v_name, v_auth.authorized_by,
     v_auth.authorized_by_name, CASE WHEN v_auth.authorized_by IS NULL THEN NULL ELSE p_authorization_id END,
     v_auth.self_authorized, p_reason_code, v_text, v_order.total,
     jsonb_build_object('order_number', v_order.order_number, 'previous_status', v_order.status,
                        'subtotal', v_order.subtotal, 'tax', v_order.tax, 'tip', v_order.tip, 'total', v_order.total,
                        'items', v_items, 'sent_items', v_sent))
  RETURNING id INTO v_audit;

  INSERT INTO public.order_cancellations
    (restaurant_id, order_id, audit_id, previous_status, reason_code, reason_text, cancelled_by, cancelled_by_name,
     authorized_by, authorized_by_name, authorization_id, self_authorized, subtotal, tax, tip, total, items, sent_items)
  VALUES
    (v_caller.restaurant_id, p_order_id, v_audit, v_order.status, p_reason_code, v_text, v_caller.profile_id, v_name,
     v_auth.authorized_by, v_auth.authorized_by_name, CASE WHEN v_auth.authorized_by IS NULL THEN NULL ELSE p_authorization_id END,
     v_auth.self_authorized, v_order.subtotal, v_order.tax, v_order.tip, v_order.total, v_items, v_sent);

  UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = p_order_id;

  -- The table is free when no other open order remains on it (the old DELETE did the same).
  IF v_order.table_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.table_id = v_order.table_id AND o.status IN ('active', 'kitchen', 'delivered')) THEN
    UPDATE public.tables SET status = 'available', waiter_id = NULL, updated_at = now() WHERE id = v_order.table_id;
  END IF;

  RETURN jsonb_build_object('audit_id', v_audit, 'order_id', p_order_id, 'authorized_by', v_auth.authorized_by,
                            'self_authorized', v_auth.self_authorized, 'total', v_order.total);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.cancel_order(uuid, text, text, uuid) IS 'Cancels an open dine-in order of the caller''s restaurant (admin, cashier, waiter; else 42501): never deletes it. P0002 order_not_found; P0001 order_cancelled, order_paid (void the payment first), delivery_order (set_delivery_status cancels deliveries). A supervisor authorization (action cancel_order, private.void_authorizer) is required when the order has a live line or any payment; an empty order needs none. Writes audit_log (order_cancelled) and order_cancellations with the bill and the live lines at that moment, sets status cancelled and frees the table when no other open order remains. Stock already consumed stays consumed. Returns {audit_id, order_id, authorized_by, self_authorized, total}.';
--> statement-breakpoint
CREATE FUNCTION public.void_order_items(p_order_id uuid, p_items jsonb, p_reason_code text, p_reason_text text DEFAULT NULL, p_authorization_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'void_order_items';
  v_caller  record;
  v_name    text;
  v_order   public.orders%ROWTYPE;
  v_text    text;
  v_lines   jsonb := '[]'::jsonb;
  v_amount  numeric := 0;
  v_sent    boolean := false;
  v_auth    record;
  v_audit   uuid;
  v_req     record;
  v_item    public.order_items%ROWTYPE;
  v_count   integer;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier', 'waiter']);
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_caller.profile_id;

  SELECT o.* INTO v_order FROM public.orders o
   WHERE o.id = p_order_id AND o.restaurant_id = v_caller.restaurant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: order_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION '%: order_closed', c_fn USING ERRCODE = 'P0001';
  END IF;
  v_text := private.void_reason_text(c_fn, p_reason_code, p_reason_text);

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION '%: items_invalid', c_fn USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT count(DISTINCT x.order_item_id) FILTER (WHERE x.quantity >= 1)
      INTO v_count
      FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity integer);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '%: items_invalid', c_fn USING ERRCODE = '22023';
  END;
  IF v_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '%: items_invalid', c_fn USING ERRCODE = '22023';
  END IF;

  -- Lock the lines in id order, then check each one.
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND oi.id IN (SELECT (e->>'order_item_id')::uuid FROM jsonb_array_elements(p_items) e)
   ORDER BY oi.id
     FOR UPDATE;
  FOR v_req IN SELECT x.order_item_id, x.quantity FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity integer) LOOP
    SELECT oi.* INTO v_item FROM public.order_items oi
     WHERE oi.id = v_req.order_item_id AND oi.order_id = p_order_id
       AND oi.quantity > 0 AND coalesce(oi.status, '') <> 'cancelled';
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: item_not_found', c_fn USING ERRCODE = 'P0002';
    END IF;
    IF v_req.quantity > v_item.quantity THEN
      RAISE EXCEPTION '%: void_quantity_exceeded', c_fn USING ERRCODE = '22023';
    END IF;
    -- Every server-side line was sent to the kitchen (the cart lives in the client).
    v_sent := true;
    v_amount := v_amount + round(v_item.price * v_req.quantity);
    v_lines := v_lines || jsonb_build_object(
      'order_item_id', v_item.id, 'dish_id', v_item.dish_id, 'name', v_item.name, 'unit_price', v_item.price,
      'quantity', v_req.quantity, 'remaining_quantity', v_item.quantity - v_req.quantity,
      'amount', round(v_item.price * v_req.quantity), 'sent_to_kitchen', true,
      'stock_consumed', v_item.stock_consumed_at IS NOT NULL);
  END LOOP;

  SELECT * INTO v_auth FROM private.void_authorizer(c_fn, v_caller.restaurant_id, v_caller.profile_id, 'void_item',
                                                    p_authorization_id, v_sent);

  INSERT INTO public.audit_log
    (restaurant_id, event_type, order_id, actor_profile_id, actor_name, authorized_by_profile_id, authorized_by_name,
     authorization_id, self_authorized, reason_code, reason_text, amount, details)
  VALUES
    (v_caller.restaurant_id, 'items_voided', p_order_id, v_caller.profile_id, v_name, v_auth.authorized_by,
     v_auth.authorized_by_name, CASE WHEN v_auth.authorized_by IS NULL THEN NULL ELSE p_authorization_id END,
     v_auth.self_authorized, p_reason_code, v_text, v_amount,
     jsonb_build_object('order_number', v_order.order_number, 'lines', v_lines))
  RETURNING id INTO v_audit;

  INSERT INTO public.order_item_voids
    (restaurant_id, order_id, order_item_id, audit_id, dish_id, item_name, quantity, remaining_quantity, unit_price, amount,
     sent_to_kitchen, stock_consumed, reason_code, reason_text, voided_by, voided_by_name, authorized_by, authorized_by_name,
     authorization_id, self_authorized)
  SELECT v_caller.restaurant_id, p_order_id, (l->>'order_item_id')::uuid, v_audit, (l->>'dish_id')::uuid, l->>'name',
         (l->>'quantity')::integer, (l->>'remaining_quantity')::integer, (l->>'unit_price')::numeric, (l->>'amount')::numeric,
         (l->>'sent_to_kitchen')::boolean, (l->>'stock_consumed')::boolean, p_reason_code, v_text, v_caller.profile_id, v_name,
         v_auth.authorized_by, v_auth.authorized_by_name,
         CASE WHEN v_auth.authorized_by IS NULL THEN NULL ELSE p_authorization_id END, v_auth.self_authorized
    FROM jsonb_array_elements(v_lines) l;

  -- Stock is not given back: a sent dish was prepared (order_item_voids.stock_consumed records it).
  UPDATE public.order_items oi
     SET quantity = oi.quantity - x.quantity,
         status = CASE WHEN oi.quantity - x.quantity = 0 THEN 'cancelled' ELSE oi.status END,
         updated_at = now()
    FROM jsonb_to_recordset(p_items) AS x(order_item_id uuid, quantity integer)
   WHERE oi.id = x.order_item_id;

  PERFORM private.recompute_order_bill(p_order_id);

  -- Nothing left for the kitchen: the order leaves the kitchen screen (as serving the last item does).
  IF v_order.status = 'kitchen' AND NOT EXISTS (
       SELECT 1 FROM public.order_items oi WHERE oi.order_id = p_order_id AND oi.status = 'kitchen') THEN
    UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = p_order_id;
    IF v_order.table_id IS NOT NULL THEN
      UPDATE public.tables SET status = 'served', updated_at = now() WHERE id = v_order.table_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('audit_id', v_audit, 'order_id', p_order_id, 'authorized_by', v_auth.authorized_by,
                            'self_authorized', v_auth.self_authorized, 'amount', v_amount, 'lines', v_lines);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.void_order_items(uuid, jsonb, text, text, uuid) IS 'Voids units of live lines of an open order of the caller''s restaurant (admin, cashier, waiter; else 42501). p_items: 1..100 distinct {order_item_id, quantity >= 1} (else 22023 items_invalid); a line not on the order or already cancelled is P0002 item_not_found, more units than it has 22023 void_quantity_exceeded; a paid or cancelled order P0001 order_closed. Every server-side line was sent to the kitchen, so a supervisor authorization (action void_item) is required. Writes one audit_log event (items_voided) and one order_item_voids row per line, lowers the quantity (0 = cancelled), recomputes the bill and, when no kitchen line remains, moves a kitchen order to delivered and its table to served. Stock is not given back.';
--> statement-breakpoint
CREATE FUNCTION public.void_payment(p_payment_id uuid, p_reason_code text, p_reason_text text DEFAULT NULL, p_authorization_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c_fn constant text := 'void_payment';
  v_caller   record;
  v_name     text;
  v_order_id uuid;
  v_order    public.orders%ROWTYPE;
  v_payment  public.payments%ROWTYPE;
  v_register public.cash_registers%ROWTYPE;
  v_text     text;
  v_tenders  jsonb;
  v_methods  text;
  v_auth     record;
  v_audit    uuid;
BEGIN
  SELECT * INTO v_caller FROM private.inventory_caller(c_fn, ARRAY['admin', 'cashier']);
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_caller.profile_id;

  -- Order first, then the payment, then the drawer: the order pay_order takes.
  SELECT p.order_id INTO v_order_id FROM public.payments p
   WHERE p.id = p_payment_id AND p.restaurant_id = v_caller.restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: payment_not_found', c_fn USING ERRCODE = 'P0002';
  END IF;
  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = v_order_id FOR UPDATE;
  SELECT p.* INTO v_payment FROM public.payments p WHERE p.id = p_payment_id FOR UPDATE;
  IF v_payment.voided_at IS NOT NULL THEN
    RAISE EXCEPTION '%: payment_voided', c_fn USING ERRCODE = 'P0001';
  END IF;
  SELECT r.* INTO v_register FROM public.cash_registers r WHERE r.id = v_payment.cash_register_id FOR SHARE;
  IF v_register.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION '%: register_closed', c_fn USING ERRCODE = 'P0001';
  END IF;
  v_text := private.void_reason_text(c_fn, p_reason_code, p_reason_text);

  SELECT * INTO v_auth FROM private.void_authorizer(c_fn, v_caller.restaurant_id, v_caller.profile_id, 'void_payment',
                                                    p_authorization_id, true);

  SELECT jsonb_agg(jsonb_build_object('line_no', t.line_no, 'payment_method_id', t.payment_method_id,
                                      'method_code', t.method_code, 'method_kind', t.method_kind, 'amount', t.amount,
                                      'cash_received', t.cash_received, 'reference', t.reference) ORDER BY t.line_no),
         string_agg(DISTINCT t.method_code, ', ')
    INTO v_tenders, v_methods
    FROM public.payment_tenders t
   WHERE t.payment_id = p_payment_id;

  INSERT INTO public.audit_log
    (restaurant_id, event_type, order_id, payment_id, actor_profile_id, actor_name, authorized_by_profile_id,
     authorized_by_name, authorization_id, self_authorized, reason_code, reason_text, amount, details)
  VALUES
    (v_caller.restaurant_id, 'payment_voided', v_order_id, p_payment_id, v_caller.profile_id, v_name,
     v_auth.authorized_by, v_auth.authorized_by_name, p_authorization_id, v_auth.self_authorized, p_reason_code, v_text,
     v_payment.total_charged,
     jsonb_build_object('order_number', v_order.order_number, 'cash_register_id', v_payment.cash_register_id,
                        'amount_due', v_payment.amount_due, 'tip_amount', v_payment.tip_amount,
                        'total_charged', v_payment.total_charged, 'change_given', v_payment.change_given,
                        'methods', v_methods, 'tenders', v_tenders))
  RETURNING id INTO v_audit;

  INSERT INTO public.payment_voids
    (restaurant_id, payment_id, order_id, cash_register_id, audit_id, amount_due, tip_amount, total_charged, change_given,
     methods, tenders, paid_at, reason_code, reason_text, voided_by, voided_by_name, authorized_by, authorized_by_name,
     authorization_id, self_authorized)
  VALUES
    (v_caller.restaurant_id, p_payment_id, v_order_id, v_payment.cash_register_id, v_audit, v_payment.amount_due,
     v_payment.tip_amount, v_payment.total_charged, v_payment.change_given, v_methods, v_tenders, v_payment.created_at,
     p_reason_code, v_text, v_caller.profile_id, v_name, v_auth.authorized_by, v_auth.authorized_by_name,
     p_authorization_id, v_auth.self_authorized);

  UPDATE public.payments SET voided_at = now() WHERE id = p_payment_id;

  -- The order is open again (to be paid again or cancelled), with its suggested bill.
  IF v_order.status = 'paid' THEN
    UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = v_order_id;
  END IF;
  PERFORM private.recompute_order_bill(v_order_id);
  IF v_order.table_id IS NOT NULL THEN
    UPDATE public.tables t SET status = 'served', updated_at = now()
     WHERE t.id = v_order.table_id AND t.status = 'available'
       AND NOT EXISTS (SELECT 1 FROM public.orders o
                        WHERE o.table_id = v_order.table_id AND o.id <> v_order_id
                          AND o.status IN ('active', 'kitchen', 'delivered'));
  END IF;

  RETURN jsonb_build_object('audit_id', v_audit, 'payment_id', p_payment_id, 'order_id', v_order_id,
                            'authorized_by', v_auth.authorized_by, 'self_authorized', v_auth.self_authorized,
                            'total_charged', v_payment.total_charged);
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.void_payment(uuid, text, text, uuid) IS 'Voids a payment of the caller''s restaurant (admin, cashier; else 42501), always with a supervisor authorization (action void_payment). P0002 payment_not_found; P0001 payment_voided, register_closed (the drawer of the payment is closed: its Z stands). Locks the order, the payment and the drawer (FOR SHARE, as pay_order), writes audit_log (payment_voided) and payment_voids with the amounts and tender lines, stamps payments.voided_at (the payment then counts in no total), reopens a paid order as delivered with its suggested bill and marks a free table served again. Returns {audit_id, payment_id, order_id, authorized_by, self_authorized, total_charged}.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_payment_voided_final() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_order_lifecycle() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_append_only() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.void_reason_text(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.void_authorizer(text, uuid, uuid, text, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cancel_order(uuid, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.void_order_items(uuid, jsonb, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.void_payment(uuid, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text, text, uuid) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.void_order_items(uuid, jsonb, text, text, uuid) TO vipe_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.void_payment(uuid, text, text, uuid) TO vipe_api;
