-- ============================================
-- register_summary / close_register RPCs
-- ============================================
-- The close-register screen and the admin reports re-derived totals from the
-- browser on every render: a SELECT over public.payments + payment_tenders for
-- the methods array, another SELECT over public.payment_transactions for the
-- legacy section, sums over public.cash_transactions for the drawer movement,
-- and a separate code path for tips + change. Two regressions followed from
-- that client-side aggregation: the close totals silently dropped every sale
-- made through public.pay_order (because the client only read the legacy
-- payment_transactions, which were never written for the new ledger), and
-- every duplicate render opened its own window onto a moving foreign-tenant
-- drawer. This migration moves the aggregation into the database and pins the
-- close action so a waiter cannot close the drawer from the wrong role.
--
-- public.register_summary(p_cash_register_ids uuid[]) RETURNS jsonb is
-- STABLE + SECURITY INVOKER so it inherits the caller's RLS for free (a
-- waiter of another tenant reads zero rows and the function cannot leak them),
-- with SET search_path = '' and every reference schema-qualified. PUBLIC and
-- anon get nothing; authenticated and service_role get EXECUTE, which
-- 020_anon_lockdown pins against over-revocation.
--
--   1. Caller resolution. private.current_restaurant_id() resolves the tenant
--      from auth.uid(); private.current_app_role() resolves the role. NULL
--      tenant (no profile) is 42501. Only 'cashier' and 'admin' may read the
--      close register / admin reports; everything else (waiter, kitchen) is
--      42501 - the close-register screen is cashier/admin only, consistent
--      with pay_order and split_order. service_role bypasses RLS, but the
--      function still takes the role from the role table it is loaded with,
--      so service_role here resolves to whatever profile it carries (set by
--      the dashboard, usually 'admin').
--
--   2. Input validation (22023). p_cash_register_ids is a non-NULL, non-empty
--      array of unique uuids with at most 100 entries. Bad shapes raise 22023
--      with a clear message; nothing is computed.
--
--   3. Visibility check (P0002). All ids must resolve to a cash register the
--      caller's RLS can see (same tenant). One SELECT walks the array and a
--      missing or foreign-tenant id raises P0002 'cash register(s) not found'
--      - the only SQLSTATE that does not leak which id was foreign and which
--      was missing. The catalog of payment methods is also pinned to the
--      caller's tenant (RLS) so the methods array cannot list another tenant's
--      catalog.
--
--   4. Aggregations over the new ledger.
--      - payments_count: count(*) FROM public.payments for those ids.
--      - total_billed: SUM(amount_due).
--      - total_tips: SUM(tip_amount).
--      - total_sales: SUM(tender.amount). Tenders are already bigint.
--      - total_change: SUM(change_given). Informational only.
--      - methods: LEFT JOIN from public.payment_methods so a method with no
--        tenders still appears with total=0 and tenders_count=0, and an
--        inactive method still appears (it is part of history). Ordered by
--        sort_order, name; carrying payment_method_id, code, name, kind,
--        sort_order, is_active, total, tenders_count.
--
--   5. Drawer movement.
--      - initial_cash: round(SUM(cash_registers.initial_cash)) - numeric(10,2)
--        rounded to bigint with Postgres half-up rounding; the documented
--        rounding of the legacy column.
--      - cash_deposits: round(SUM(amount) WHERE type='deposit').
--      - cash_withdrawals: round(SUM(amount) WHERE type='withdrawal').
--      - expected_cash = initial_cash + cash-tender amounts + deposits -
--        withdrawals. cash-tender amounts is the same query pay_order runs for
--        drawer_cash_before (join through payments on cash_register_id,
--        method_kind='cash'), so for a single open register the two values are
--        exactly equal. 070_pay_order pins the pay_order computation; this
--        function uses the same INVERSE-free expression so equality is a single
--        matcher, not a parallel formula.
--      - tips_payout = total_tips (tips are paid to waiters at close, so the
--        drawer expects the tips out: tips are paid out as a payout of all
--        tips, any method).
--      - expected_cash_after_tips = expected_cash - tips_payout; may be
--        negative (e.g. all tips were electronic and the drawer was already
--        short), do NOT clamp, the UI reads the value as-is.
--
--   6. Legacy section. public.payment_transactions was the old money path:
--      numeric(10,2) money, free-text method, no tender split, no tip the
--      database could enforce. It is read-only history. The function exposes it
--      under `legacy` for the admin reports (so the close-register screen can
--      still render a historical column) but those rows do NOT enter
--      expected_cash - that mixing would double-count pre-migration payments
--        already documented in 20261006110000 / legacy.
--      - legacy.payments_count = count(*) FROM public.payment_transactions.
--      - legacy.total = round(SUM(amount)).
--      - legacy.tips = round(SUM(tip_amount)).
--      - legacy.change = round(SUM(cash_change)).
--      - legacy.by_method = jsonb keyed by method -> round(SUM(amount)). The
--        old free-text method lives in this nested object only; the new
--        methods array never carries it.
--
--   7. Response shape (jsonb):
--      { registers_count, initial_cash, payments_count, total_billed,
--        total_tips, total_sales, total_change,
--        methods: [{payment_method_id, code, name, kind, sort_order,
--                   is_active, total, tenders_count}, ...],
--        cash_deposits, cash_withdrawals, expected_cash, tips_payout,
--        expected_cash_after_tips,
--        legacy: { payments_count, total, tips, change, by_method: {...} } }
--
-- public.close_register(p_cash_register_id uuid) RETURNS jsonb is SECURITY
-- DEFINER (owner postgres) so the row lock and the UPDATE happen in the same
-- transaction as the role check, with SET search_path = ''. PUBLIC and anon
-- get nothing; authenticated and service_role get EXECUTE, which
-- 020_anon_lockdown pins against over-revocation.
--
--   1. Caller resolution as register_summary. 42501 for profileless callers
--      and for non-cashier / non-admin roles (waiters close no drawer).
--
--   2. Lock the register row FOR UPDATE. The row's tenant must match the
--      caller's; anything else raises P0002 'cash register not found' - the same
--      boundary register_summary uses, so the two RPCs cannot disagree on what
--      is visible. The FOR UPDATE lock serializes with pay_order, which takes
--      the same row FOR SHARE: a concurrent pay_order waits on the close
--      (and vice versa), so the close_register response can never see a
--      half-written payment. 070_pay_order pins pay_order's FOR SHARE on this
--      same row.
--
--   3. Already-closed replay. If status='closed' when the lock lands, return
--      {status:'already_closed', cash_register_id, closing_timestamp,
--      final_cash, summary} with no writes. The replay is idempotent for the
--      UI's "double-click on Close" and the retry from the admin console.
--
--   4. Happy path. Build the same summary register_summary builds (the two
--      functions must agree on every number), then UPDATE the register to set
--      status='closed', closing_timestamp=now(), final_cash=expected_cash_after_tips,
--      and updated_at=now(). Return {status:'closed', cash_register_id,
--      final_cash, summary}. The new status='closed' is the same value the
--      existing schema already uses (closed register fixtures in 070_pay_order);
--      pay_order already rejects this status with P0001, and 090 pins the
--      closed-then-pay_order rejection on the round-trip.
--
--   5. Lock order invariant (keep with pay_order / split_order). pay_order
--      locks the order row FOR UPDATE, then the register FOR SHARE.
--      close_register locks the register FOR UPDATE only. A concurrent
--      pay_order and close_register on the same drawer therefore serialize on
--      the register row, not on the order; the deadlock cycle would need a
--      lock the other way around, which neither function takes.
--
-- Idempotent: re-running drops the two functions and recreates them, then
-- re-applies the same grants.

-- ============================================
-- SECTION 1: register_summary
-- ============================================
CREATE OR REPLACE FUNCTION public.register_summary(p_cash_register_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
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
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'register_summary: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'register_summary: only cashier or admin may read the summary'
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

  IF (SELECT count(*) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> v_array_len THEN
    -- array_length was non-null, so this is a NULL inside the array; rejected
    -- the same way a duplicate would be.
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM (
         SELECT v FROM unnest(p_cash_register_ids) v
       ) s) <> (SELECT count(DISTINCT v) FROM unnest(p_cash_register_ids) v) THEN
    RAISE EXCEPTION 'register_summary: p_cash_register_ids must not contain duplicates'
      USING ERRCODE = '22023';
  END IF;

  -- 3. Visibility check. The visible set comes from a single SELECT against
  -- cash_registers (RLS filters out other tenants); if any id is missing or
  -- foreign, the count is below the array length and we raise P0002. The
  -- catalog SELECT below is RLS-scoped too, so a method from another tenant
  -- never enters the methods array.
  SELECT count(*) INTO v_visible_count
    FROM public.cash_registers
   WHERE id = ANY (p_cash_register_ids);

  IF v_visible_count <> v_array_len THEN
    RAISE EXCEPTION 'register_summary: cash register(s) not found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Keep a deduplicated copy for the catalog LEFT JOIN (RLS-scoped).
  v_ids := ARRAY(SELECT DISTINCT v FROM unnest(p_cash_register_ids) v);

  -- 4. Aggregations over the new ledger.
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
   WHERE p.cash_register_id = ANY (v_ids);

  -- total_sales is the sum of tender amounts (already bigint).
  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_total_sales
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids);

  -- 5. Drawer movement: deposits / withdrawals / cash-spend rows.
  SELECT
      coalesce(round(SUM(CASE WHEN ct.type = 'deposit'    THEN ct.amount ELSE 0 END))::bigint, 0),
      coalesce(round(SUM(CASE WHEN ct.type = 'withdrawal' THEN ct.amount ELSE 0 END))::bigint, 0)
    INTO v_cash_deposits, v_cash_withdrawals
    FROM public.cash_transactions ct
   WHERE ct.cash_register_id = ANY (v_ids);

  -- The cash side of total_sales: same JOIN as pay_order''s drawer_cash_before,
  -- so for a single open register the value equals pay_order''s number.
  SELECT coalesce(sum(t.amount), 0)::bigint
    INTO v_cash_tender_total
    FROM public.payment_tenders t
    JOIN public.payments p ON p.id = t.payment_id
   WHERE p.cash_register_id = ANY (v_ids)
     AND t.method_kind = 'cash';

  v_expected_cash   := v_initial_cash + v_cash_tender_total + v_cash_deposits - v_cash_withdrawals;
  v_tips_payout     := v_total_tips;
  v_after_tips      := v_expected_cash - v_tips_payout;

  -- Methods array: LEFT JOIN from the catalog so zero-sale and inactive methods
  -- still appear. Ordered by sort_order, name. Aggregations only over the new
  -- ledger (no legacy rows in the methods array).
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
           WHERE p.cash_register_id = ANY (v_ids)
           GROUP BY t.payment_method_id
        ) agg ON agg.payment_method_id = cat.id
       WHERE cat.restaurant_id = v_caller_tenant
    ) m;

  -- Legacy section: read-only history from public.payment_transactions.
  -- RLS-scoped via restaurant_id. Does NOT contribute to expected_cash.
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

  -- Coerce a NULL legacy object to a structured zero object (no legacy rows).
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

COMMENT ON FUNCTION public.register_summary(uuid[]) IS
  'Server-side aggregation for the close-register screen and the admin reports. SECURITY INVOKER (rely on RLS), STABLE, search_path pinned. Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-cashier/admin). Input validation: NULL/empty/duplicates/>100 ids raise 22023. Visibility: any id the caller''s RLS cannot see raises P0002 (other tenant or missing). The methods array is a LEFT JOIN from the tenant catalog so zero-sale and inactive methods still appear (sort_order, name). expected_cash = round(initial_cash) + cash_tender_amounts + deposits - withdrawals, the same formula pay_order uses for drawer_cash_before on a single open register (equality pinned by 090). tips are paid out to waiters at close, so tips_payout = total_tips (all tips, any method) and expected_cash_after_tips = expected_cash - tips_payout (may be negative, not clamped). Legacy section reads public.payment_transactions (zeros when none) and is reported separately: legacy rows do NOT enter expected_cash. Money as bigint (whole COP pesos); numeric(10,2) columns are rounded with Postgres half-up rounding.';

-- ============================================
-- SECTION 2: close_register
-- ============================================
CREATE OR REPLACE FUNCTION public.close_register(p_cash_register_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant   uuid;
  v_caller_role     text;

  v_register        public.cash_registers%ROWTYPE;
  v_summary         jsonb;
  v_final_cash      bigint;
BEGIN
  -- 1. Caller resolution.
  v_caller_tenant := private.current_restaurant_id();
  v_caller_role   := private.current_app_role();

  IF v_caller_tenant IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'close_register: the caller has no profile'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_caller_role NOT IN ('cashier', 'admin') THEN
    RAISE EXCEPTION 'close_register: only cashier or admin may close a register'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Lock the register row FOR UPDATE. The same row pay_order takes FOR SHARE;
  -- a concurrent close_register / pay_order pair serialize on this row, not on
  -- any order row.
  SELECT cr.* INTO v_register
    FROM public.cash_registers cr
   WHERE cr.id = p_cash_register_id
     FOR UPDATE;

  IF NOT FOUND OR v_register.restaurant_id <> v_caller_tenant THEN
    RAISE EXCEPTION 'close_register: cash register % not found', p_cash_register_id
      USING ERRCODE = 'P0002';
  END IF;

  -- The summary is computed at the lock instant: it is the snapshot the close
  -- dialog renders, and is what pay_order / register_summary would see if they
  -- ran right after the close.
  v_summary := public.register_summary(ARRAY[p_cash_register_id]::uuid[]);

  IF v_register.status = 'closed' THEN
    -- 3. Already-closed replay. No writes; closing_timestamp and final_cash are
    -- the stored values from the original close.
    RETURN jsonb_build_object(
      'status',            'already_closed',
      'cash_register_id',  v_register.id,
      'closing_timestamp', v_register.closing_timestamp,
      'final_cash',        coalesce(round(v_register.final_cash)::bigint, 0),
      'summary',           v_summary
    );
  END IF;

  -- 4. Happy path: close the drawer.
  v_final_cash := (v_summary ->> 'expected_cash_after_tips')::bigint;

  UPDATE public.cash_registers cr
     SET status            = 'closed',
         closing_timestamp = now(),
         final_cash        = v_final_cash,
         updated_at        = now()
   WHERE cr.id = p_cash_register_id;

  RETURN jsonb_build_object(
    'status',           'closed',
    'cash_register_id', v_register.id,
    'final_cash',       v_final_cash,
    'summary',          v_summary
  );
END;
$$;

COMMENT ON FUNCTION public.close_register(uuid) IS
  'Closes one cash register. SECURITY DEFINER (owner postgres). Caller resolution through private.current_restaurant_id() / private.current_app_role() (42501 for non-cashier/admin). Locks the register row FOR UPDATE so it serializes with pay_order (FOR SHARE on the same row) - the deadlock cycle would need a lock the other way around, which neither function takes. P0002 if the row is missing or belongs to another tenant. If status=''closed'' when the lock lands, returns {status:''already_closed'', cash_register_id, closing_timestamp, final_cash, summary} with no writes (idempotent replay). Otherwise computes the summary with public.register_summary, UPDATEs the register (status=''closed'', closing_timestamp=now(), final_cash=expected_cash_after_tips, updated_at=now()) and returns {status:''closed'', cash_register_id, final_cash, summary}. The ''closed'' status value is the same one the existing schema already uses; pay_order already rejects it with P0001, pinned on the round-trip by 090.';

-- ============================================
-- SECTION 3: privileges
-- ============================================
REVOKE ALL ON FUNCTION public.register_summary(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_summary(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_summary(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_summary(uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.close_register(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_register(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_register(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_register(uuid) TO service_role;