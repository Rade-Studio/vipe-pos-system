-- Step 5 of the cut-over: compare the imported target with the staged source.
--
--   psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
--        -v s3_public_base_url="$S3_PUBLIC_BASE_URL" -f verify.sql
--   (verify.sh wraps this.)
--
-- Runs on the target as a superuser after import.sh, which leaves the source
-- rows in schema import_src. Writes only session temp tables. Prints one line per check and exits
-- non-zero (ERROR verify: N of M checks failed) when any check fails:
-- row counts per table (source dump vs export manifest vs target), users and
-- profile links, money sums, one open register per restaurant and the 0009
-- audit, orphan rows, counters >= max used numbers, and no image_url left on
-- Supabase Storage. Design: odd/tasks/migracion-backend-nestjs.md, "Design:
-- T14", step 5.
\set ON_ERROR_STOP on
\if :{?s3_public_base_url}
\else
  \echo 'verify: pass -v s3_public_base_url=<S3_PUBLIC_BASE_URL>'
  SELECT 1/0 AS missing_s3_public_base_url;
\endif
SET client_min_messages = warning;
SET verify.s3_public_base_url = :'s3_public_base_url';

DO $$
BEGIN
  IF to_regnamespace('import_src') IS NULL THEN
    RAISE EXCEPTION 'verify: schema import_src not found; run import.sh first';
  END IF;
END $$;

CREATE TEMP TABLE checks (name text, ok boolean, detail text);

-- 1. Row counts: every staged source table against its target table, and the
--    staged rows against the counts export.sh took on the source.
DO $$
DECLARE
  t text;
  src bigint;
  tgt bigint;
  manifest bigint;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'import_src'::regnamespace AND c.relkind = 'r' AND c.relname !~ '^_'
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM import_src.%I', t) INTO src;
    SELECT row_count::bigint INTO manifest FROM import_src._source_counts WHERE table_name = t;
    INSERT INTO checks VALUES (format('staged rows = source rows: %s', t), manifest IS NOT DISTINCT FROM src,
                               format('source %s, staged %s', coalesce(manifest::text, 'missing'), src));
    IF t = 'inventory_counters' THEN
      CONTINUE;  -- rebuilt upward by import.sql; checked by the counter check below
    END IF;
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      INSERT INTO checks VALUES (format('target table exists: %s', t), false, 'no public table for this source table');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO tgt;
    INSERT INTO checks VALUES (format('rows: %s', t), src = tgt, format('source %s, target %s', src, tgt));
  END LOOP;
  INSERT INTO checks
  SELECT format('export manifest table staged: %s', s.table_name), false, 'listed by export.sh, missing in import_src'
    FROM import_src._source_counts s
   WHERE to_regclass(format('import_src.%I', s.table_name)) IS NULL;
END $$;

-- 2. Users: every source user that is not soft-deleted and has an email,
--    active unless banned (no-password users are active with an unusable
--    hash); profiles keep their link.
WITH src AS (
  SELECT u.id::uuid AS id,
         nullif(u.banned_until, '') IS NULL OR u.banned_until::timestamptz <= now() AS active
    FROM import_src._auth_users u
   WHERE nullif(u.deleted_at, '') IS NULL AND coalesce(u.email, '') <> ''
)
INSERT INTO checks
SELECT 'users: imported = source users not deleted', (SELECT count(*) FROM src) = (SELECT count(*) FROM public.users)
       AND NOT EXISTS (SELECT 1 FROM src LEFT JOIN public.users u USING (id) WHERE u.id IS NULL),
       format('source %s, target %s', (SELECT count(*) FROM src), (SELECT count(*) FROM public.users))
UNION ALL
SELECT 'users: active flag (banned -> inactive, everyone else active)',
       NOT EXISTS (SELECT 1 FROM src JOIN public.users u USING (id) WHERE u.is_active IS DISTINCT FROM src.active),
       format('%s inactive', (SELECT count(*) FROM public.users WHERE NOT is_active))
UNION ALL
SELECT 'users: password_algo is bcrypt or argon2id',
       NOT EXISTS (SELECT 1 FROM public.users WHERE password_algo NOT IN ('bcrypt', 'argon2id')), ''
UNION ALL
SELECT 'profiles: link kept for every imported user',
       NOT EXISTS (SELECT 1 FROM import_src.profiles p JOIN src ON src.id = p.auth_user_id::uuid
                     LEFT JOIN public.profiles t ON t.id = p.id::uuid
                    WHERE t.user_id IS DISTINCT FROM src.id)
       AND NOT EXISTS (SELECT 1 FROM public.profiles t WHERE t.user_id IS NOT NULL AND t.user_id NOT IN (SELECT id FROM src)),
       format('%s profiles with a login', (SELECT count(*) FROM public.profiles WHERE user_id IS NOT NULL));

-- 2b. Bcrypt users keep the source hash and email; no-password users hold the unusable marker.
INSERT INTO checks
SELECT 'users: bcrypt hash and email equal the source',
       NOT EXISTS (SELECT 1 FROM import_src._auth_users s JOIN public.users t ON t.id = s.id::uuid
                    WHERE t.password_algo = 'bcrypt'
                      AND (t.email::text IS DISTINCT FROM s.email
                           OR t.password_hash IS DISTINCT FROM CASE WHEN coalesce(s.encrypted_password, '') LIKE '$2%'
                                                                   THEN s.encrypted_password ELSE '!no-password' END)),
       format('%s bcrypt users', (SELECT count(*) FROM public.users WHERE password_algo = 'bcrypt'));

-- 2c. profiles.active as in the source, except the listed profiles that lost their login.
INSERT INTO checks
SELECT 'profiles: active equals the source (except lost logins)',
       NOT EXISTS (SELECT 1 FROM import_src.profiles s JOIN public.profiles t ON t.id = s.id::uuid
                    WHERE t.active IS DISTINCT FROM s.active::boolean
                      AND NOT (NOT t.active AND t.user_id IS NULL AND s.auth_user_id IS NOT NULL)),
       coalesce((SELECT 'deactivated, lost login: ' || string_agg(t.id::text, ', ')
                   FROM import_src.profiles s JOIN public.profiles t ON t.id = s.id::uuid
                  WHERE s.auth_user_id IS NOT NULL AND t.user_id IS NULL), 'none deactivated');

-- 3. Money: the same totals on both sides.
INSERT INTO checks
SELECT format('money: %s', name), src IS NOT DISTINCT FROM tgt, format('source %s, target %s', src, tgt)
  FROM (VALUES
    ('payments.total_charged', (SELECT sum(total_charged::bigint)::numeric FROM import_src.payments), (SELECT sum(total_charged)::numeric FROM public.payments)),
    ('payments.amount_due', (SELECT sum(amount_due::bigint)::numeric FROM import_src.payments), (SELECT sum(amount_due)::numeric FROM public.payments)),
    ('payments.tip_amount', (SELECT sum(tip_amount::bigint)::numeric FROM import_src.payments), (SELECT sum(tip_amount)::numeric FROM public.payments)),
    ('payment_tenders.amount', (SELECT sum(amount::bigint)::numeric FROM import_src.payment_tenders), (SELECT sum(amount)::numeric FROM public.payment_tenders)),
    ('cash_transactions.amount', (SELECT sum(amount::numeric) FROM import_src.cash_transactions), (SELECT sum(amount) FROM public.cash_transactions)),
    ('payment_transactions.amount', (SELECT sum(amount::numeric) FROM import_src.payment_transactions), (SELECT sum(amount) FROM public.payment_transactions)),
    ('orders.total', (SELECT sum(total::numeric) FROM import_src.orders), (SELECT sum(total) FROM public.orders)),
    ('cash_registers.initial_cash', (SELECT sum(initial_cash::numeric) FROM import_src.cash_registers), (SELECT sum(initial_cash) FROM public.cash_registers))
  ) AS m(name, src, tgt);

-- 4. Registers: at most one open per restaurant; every source-open register
--    the import closed is in the 0009 audit table, and nothing else is.
INSERT INTO checks
SELECT 'registers: at most one open per restaurant',
       NOT EXISTS (SELECT 1 FROM public.cash_registers WHERE status = 'open' GROUP BY restaurant_id HAVING count(*) > 1),
       format('%s open', (SELECT count(*) FROM public.cash_registers WHERE status = 'open'))
UNION ALL
SELECT 'registers: closed by the import = private.migration_0009_closed_registers',
       (SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') FROM public.cash_registers t
          JOIN import_src._open_registers s ON s.id = t.id WHERE t.status <> 'open')
       = (SELECT coalesce(array_agg(cash_register_id ORDER BY cash_register_id), '{}') FROM private.migration_0009_closed_registers),
       format('%s closed', (SELECT count(*) FROM private.migration_0009_closed_registers));

-- 5. No orphan rows (foreign keys were not enforced during the load).
\ir orphan-check.sql
INSERT INTO checks
SELECT 'orphans: none', coalesce(bool_and(orphans = 0), true),
       coalesce(string_agg(format('%s: %s', fk, orphans), '; ') FILTER (WHERE orphans > 0), format('%s foreign keys', count(*)))
  FROM orphan_findings;

-- 6. Counters at least the highest number in use, so new SKUs and documents do not collide.
WITH used AS (
  SELECT restaurant_id, 'sku_raw' AS counter, max(substring(sku FROM '^MP-([0-9]+)$')::bigint) AS used FROM public.ingredients GROUP BY 1
  UNION ALL SELECT restaurant_id, 'sku_prep', max(substring(sku FROM '^PR-([0-9]+)$')::bigint) FROM public.ingredients GROUP BY 1
  UNION ALL SELECT restaurant_id, 'purchase_order', max(number) FROM public.purchase_orders GROUP BY 1
  UNION ALL SELECT restaurant_id, 'inventory_count', max(number) FROM public.inventory_counts GROUP BY 1
)
INSERT INTO checks
SELECT 'counters: >= max used number', coalesce(bool_and(coalesce(c.value, 0) >= u.used), true),
       coalesce(string_agg(format('%s %s: counter %s < used %s', u.restaurant_id, u.counter, coalesce(c.value, 0), u.used), '; ')
                  FILTER (WHERE coalesce(c.value, 0) < u.used), format('%s counters', count(*)))
  FROM used u
  LEFT JOIN private.inventory_counters c USING (restaurant_id, counter)
 WHERE u.used IS NOT NULL;

-- 6b. Counters never go below the source values.
DO $$
DECLARE bad text;
BEGIN
  IF to_regclass('import_src.inventory_counters') IS NULL THEN
    INSERT INTO checks VALUES ('counters: >= source counters', true, 'source had no private.inventory_counters');
    RETURN;
  END IF;
  SELECT string_agg(format('%s %s: target %s < source %s', s.restaurant_id, s.counter, coalesce(t.value::text, 'missing'), s.value), '; ')
    INTO bad
    FROM import_src.inventory_counters s
    LEFT JOIN private.inventory_counters t ON t.restaurant_id = s.restaurant_id::uuid AND t.counter = s.counter
   WHERE t.value IS NULL OR t.value < s.value::bigint;
  INSERT INTO checks VALUES ('counters: >= source counters', bad IS NULL,
                             coalesce(bad, format('%s source counters', (SELECT count(*) FROM import_src.inventory_counters))));
END $$;

-- 7. Images: nothing left on Supabase Storage; other external URLs are listed, not failed.
INSERT INTO checks
SELECT 'images: no image_url on Supabase Storage',
       NOT EXISTS (SELECT 1 FROM public.dishes WHERE image_url LIKE '%/storage/v1/object/%'),
       format('%s under %s', (SELECT count(*) FROM public.dishes WHERE image_url LIKE current_setting('verify.s3_public_base_url') || '/%'),
              current_setting('verify.s3_public_base_url'))
UNION ALL
SELECT 'images: every copied URL under S3_PUBLIC_BASE_URL/<restaurantId>/dishes/',
       NOT EXISTS (SELECT 1 FROM public.dishes d
                    WHERE d.image_url LIKE current_setting('verify.s3_public_base_url') || '/%'
                      AND d.image_url NOT LIKE current_setting('verify.s3_public_base_url') || '/' || d.restaurant_id || '/dishes/%'), ''
UNION ALL
SELECT 'images: every dish whose object exists is rewritten or listed as refused',
       NOT EXISTS (SELECT 1 FROM import_src.dishes s JOIN public.dishes t ON t.id = s.id::uuid
                    WHERE s.image_url LIKE '%/storage/v1/object/%'
                      AND NOT EXISTS (SELECT 1 FROM import_src._storage_report r
                                       WHERE r.old_url = s.image_url AND r.restaurant_id = s.restaurant_id AND r.status = 'missing_object')
                      AND t.image_url IS DISTINCT FROM (SELECT m.new_url FROM import_src._mapping m
                                                         WHERE m.old_url = s.image_url AND m.restaurant_id = s.restaurant_id)
                      AND NOT EXISTS (SELECT 1 FROM import_src._storage_report r
                                       WHERE r.old_url = s.image_url AND r.restaurant_id = s.restaurant_id AND r.status = 'refused_type')),
       format('%s refused', (SELECT count(*) FROM import_src._storage_report WHERE status = 'refused_type'))
UNION ALL
SELECT 'images: external URLs kept as they were (informational)', true,
       coalesce((SELECT string_agg(DISTINCT image_url, ', ') FROM public.dishes
                  WHERE image_url IS NOT NULL AND image_url <> ''
                    AND image_url NOT LIKE current_setting('verify.s3_public_base_url') || '/%'
                    AND image_url NOT LIKE '%placeholder.svg%'), 'none');

\pset footer off
SELECT CASE WHEN ok THEN 'ok  ' ELSE 'FAIL' END AS result, name AS check, detail FROM checks ORDER BY ok, name;

DO $$
DECLARE
  failed int := (SELECT count(*) FROM checks WHERE NOT ok OR ok IS NULL);
  total int := (SELECT count(*) FROM checks);
BEGIN
  IF failed > 0 THEN
    RAISE EXCEPTION 'verify: % of % checks failed', failed, total;
  END IF;
  RAISE WARNING 'verify: all % checks passed', total;
END $$;
