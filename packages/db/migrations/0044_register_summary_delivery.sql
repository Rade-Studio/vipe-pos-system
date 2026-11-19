-- H-080 (odd/tasks/qa-noviembre-2026.md T13, S3): the close shows
-- "Domicilios" apart from the food sales and, per courier, the cash they bring
-- and the fees owed to them. register_summary gains one key, delivery =
-- {fees, orders_count, food_billed, cash_collected, couriers: [{courier_id,
-- name, orders_count, cash_collected, fees_owed}]}, computed from the live
-- payments of the registers, order_deliveries, payment_tenders and couriers.
-- Every other key keeps the 0018 body byte for byte. No data change: a
-- register without deliveries gets a zero block. close_register embeds the
-- summary, so it carries the block too.
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
  v_delivery        jsonb;

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

  -- 0044 (H-080): delivery fees apart from the food sales, and per courier
  -- the cash they bring back (cash tenders of cash_on_delivery orders) and
  -- the fees owed to them (delivery_fee, whatever the payment mode). Every
  -- amount here is already inside total_billed / methods / expected_cash.
  WITH d AS (
    SELECT p.id AS payment_id, od.courier_id, od.delivery_fee, od.payment_mode
      FROM public.payments p
      JOIN public.order_deliveries od ON od.order_id = p.order_id
     WHERE p.cash_register_id = ANY (v_ids) AND p.voided_at IS NULL
  ), dc AS (
    SELECT d.*,
           CASE WHEN d.payment_mode = 'cash_on_delivery' THEN coalesce((
             SELECT sum(t.amount) FROM public.payment_tenders t
              WHERE t.payment_id = d.payment_id AND t.method_kind = 'cash'), 0)
           ELSE 0 END::bigint AS cash
      FROM d
  ), per AS (
    SELECT dc.courier_id, c.name,
           count(*)::bigint AS orders_count,
           sum(dc.cash)::bigint AS cash_collected,
           sum(dc.delivery_fee)::bigint AS fees_owed
      FROM dc
      LEFT JOIN public.couriers c ON c.id = dc.courier_id
     GROUP BY dc.courier_id, c.name
  )
  SELECT jsonb_build_object(
      'fees',           coalesce((SELECT sum(delivery_fee) FROM dc), 0)::bigint,
      'orders_count',   (SELECT count(*) FROM dc)::bigint,
      'food_billed',    v_total_billed - coalesce((SELECT sum(delivery_fee) FROM dc), 0)::bigint,
      'cash_collected', coalesce((SELECT sum(cash) FROM dc), 0)::bigint,
      'couriers',       coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'courier_id', per.courier_id, 'name', per.name,
                 'orders_count', per.orders_count, 'cash_collected', per.cash_collected,
                 'fees_owed', per.fees_owed)
               ORDER BY per.courier_id IS NULL, per.name, per.courier_id)
          FROM per), '[]'::jsonb))
    INTO v_delivery;

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
    'legacy',                  v_legacy,
    'delivery',                v_delivery
  );
END;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION public.register_summary(p_cash_register_ids uuid[]) IS 'Server-side aggregation for the close-register screen and the admin reports. SECURITY INVOKER (RLS), STABLE, search_path pinned; cashier, admin or delivery_operator (42501 otherwise); 1..100 distinct non-null ids (22023), all visible (P0002). Totals of the live payments (payments, payment_tenders), cash movements and expected cash; legacy payment_transactions apart. 0044: delivery = {fees, orders_count, food_billed, cash_collected, couriers[{courier_id, name, orders_count, cash_collected (cash tenders of cash_on_delivery orders), fees_owed (delivery_fee)}]}, already included in the other totals.';
