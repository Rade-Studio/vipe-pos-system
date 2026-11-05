-- Step 3 of the cut-over: load the staged Supabase rows (schema import_src,
-- written by import.sh) into the migrated target. Run only through import.sh:
--   psql --single-transaction -v ON_ERROR_STOP=1 -v force_empty_target=on|off -f import.sql
-- One transaction, as a superuser, with session_replication_role = replica so
-- no guard, numbering or pg_notify trigger fires (foreign keys are not checked
-- either, so orphan-check.sql runs before the commit). Any error rolls back
-- everything.
--
-- Transforms (odd/tasks/migracion-backend-nestjs.md, "Design: T14", step 3):
--   auth.users -> public.users: same id and email, password_hash =
--     encrypted_password, password_algo = 'bcrypt' (the API re-hashes to
--     argon2id on the first login). No or unrecognised password: imported
--     ACTIVE with the unusable hash '!no-password' (login fails until an admin
--     sets a password; the staff helpers never touch users.is_active, so an
--     inactive import could not be re-enabled from the app). Banned: imported
--     inactive, and the report prints the reactivation UPDATE. Soft-deleted or
--     without email: skipped. Every case is reported.
--   profiles.auth_user_id -> profiles.user_id; a profile whose user was
--     skipped keeps its row (orders and payments point at it) without login,
--     deactivated.
--   cash_registers: the 0009 survivor rule (packages/db/migrations/
--     0009_one_open_register.sql): per restaurant the open register with the
--     latest activity stays open, the others are closed and recorded in
--     private.migration_0009_closed_registers.
--   private.inventory_counters: copied, then raised to the highest SKU
--     (MP-/PR-) and purchase order / count number in use.
--   dishes.image_url: Supabase Storage URLs replaced through mapping.csv
--     (copy-storage.ts); a Supabase URL without a copy is cleared; placeholder
--     and other URLs are kept.
--   Every other table: copied as is, columns matched by name and cast to the
--     target type; a source column with no target column aborts the import.
--   auth_sessions, printer_tokens and print_jobs stay empty.
\set ON_ERROR_STOP on
SET client_min_messages = warning;

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'import: must run as a superuser';
  END IF;
  IF to_regnamespace('import_src') IS NULL THEN
    RAISE EXCEPTION 'import: schema import_src not found; run import.sh, not this file';
  END IF;
END $$;

SET LOCAL session_replication_role = replica;

SELECT :'force_empty_target' = 'on' AS force_empty_target \gset
\if :force_empty_target
-- --force-empty-target: delete every application row first (the drizzle
-- schema with the migration journal is not touched).
DO $$
BEGIN
  EXECUTE (SELECT 'TRUNCATE ' || string_agg(c.oid::regclass::text, ', ') || ' CASCADE'
             FROM pg_class c
            WHERE c.relkind = 'r'
              AND (c.relnamespace = 'public'::regnamespace
                   OR c.oid IN ('private.inventory_counters'::regclass, 'private.migration_0009_closed_registers'::regclass)));
END $$;
\else
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.restaurants) THEN
    RAISE EXCEPTION 'import: target is not empty: public.restaurants has % rows; rerun with --force-empty-target',
      (SELECT count(*) FROM public.restaurants);
  END IF;
END $$;
\endif

DROP TABLE IF EXISTS import_src._report;
CREATE TABLE import_src._report (section text, item text, detail text);
CREATE TEMP TABLE imported_tables (name text PRIMARY KEY) ON COMMIT DROP;

-- Copy one staged table into public.<same name>: every target column that the
-- source has (or an override provides), cast to the target type. Overrides map
-- a target column to an SQL expression over the staged row `s`; `consumed`
-- lists source columns an override already used (renames).
CREATE FUNCTION pg_temp.import_table(p_table text, p_overrides jsonb DEFAULT '{}', p_consumed text[] DEFAULT '{}')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_src regclass := format('import_src.%I', p_table)::regclass;
  v_dst regclass := format('public.%I', p_table)::regclass;
  v_unknown text;
  v_cols text;
  v_exprs text;
  n bigint;
BEGIN
  SELECT string_agg(s.attname, ', ') INTO v_unknown
    FROM pg_attribute s
   WHERE s.attrelid = v_src AND s.attnum > 0 AND NOT s.attisdropped
     AND s.attname <> ALL (p_consumed)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute t
                      WHERE t.attrelid = v_dst AND t.attname = s.attname AND t.attnum > 0 AND NOT t.attisdropped);
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'import: source columns of % have no target column: %', p_table, v_unknown;
  END IF;

  SELECT string_agg(format('%I', t.attname), ', ' ORDER BY t.attnum),
         string_agg(coalesce(p_overrides ->> t.attname, format('s.%I::%s', t.attname, format_type(t.atttypid, t.atttypmod))),
                    ', ' ORDER BY t.attnum)
    INTO v_cols, v_exprs
    FROM pg_attribute t
   WHERE t.attrelid = v_dst AND t.attnum > 0 AND NOT t.attisdropped AND t.attgenerated = ''
     AND (p_overrides ? t.attname
          OR EXISTS (SELECT 1 FROM pg_attribute s
                      WHERE s.attrelid = v_src AND s.attname = t.attname AND s.attnum > 0 AND NOT s.attisdropped));

  EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM %s s', v_dst, v_cols, v_exprs, v_src);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO import_src._report VALUES ('table_rows', p_table, n::text);
  INSERT INTO imported_tables VALUES (p_table);
  RETURN n;
END $$;

-- ---------------------------------------------------------------- users
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(e, ', ') INTO dup
    FROM (SELECT lower(email) AS e FROM import_src._auth_users
           WHERE nullif(deleted_at, '') IS NULL AND coalesce(email, '') <> ''
           GROUP BY 1 HAVING count(*) > 1) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'import: auth.users has emails that differ only in case (users.email is citext unique): %', dup;
  END IF;
END $$;

INSERT INTO import_src._report
SELECT 'user_deleted_skipped', coalesce(nullif(u.email, ''), u.id),
       coalesce('profile ' || string_agg(p.id, ', ') || ' kept without login, deactivated', 'no profile')
  FROM import_src._auth_users u
  LEFT JOIN import_src.profiles p ON p.auth_user_id = u.id
 WHERE nullif(u.deleted_at, '') IS NOT NULL
 GROUP BY u.id, u.email;
INSERT INTO import_src._report
SELECT 'user_without_email_skipped', u.id, 'no email to log in with'
  FROM import_src._auth_users u
 WHERE nullif(u.deleted_at, '') IS NULL AND coalesce(u.email, '') = '';
INSERT INTO import_src._report
SELECT CASE WHEN coalesce(u.encrypted_password, '') = '' THEN 'user_without_password' ELSE 'user_unrecognised_hash' END,
       u.email,
       'imported active with an unusable hash: cannot log in until an admin sets a password in Personal (POST /api/staff/'
         || coalesce((SELECT string_agg(p.id, ', ') FROM import_src.profiles p WHERE p.auth_user_id = u.id), '<no profile>')
         || '/password)'
  FROM import_src._auth_users u
 WHERE nullif(u.deleted_at, '') IS NULL AND coalesce(u.email, '') <> ''
   AND coalesce(u.encrypted_password, '') NOT LIKE '$2%';
INSERT INTO import_src._report
SELECT 'user_banned', u.email,
       'banned until ' || u.banned_until || '; imported inactive. When the ban should end, run as vipe_migrator: '
         || format('UPDATE public.users SET is_active = true WHERE id = %L;', u.id)
  FROM import_src._auth_users u
 WHERE nullif(u.deleted_at, '') IS NULL AND coalesce(u.email, '') <> ''
   AND nullif(u.banned_until, '')::timestamptz > now();

INSERT INTO public.users (id, email, password_hash, password_algo, is_active, created_at, updated_at)
SELECT u.id::uuid,
       u.email,
       CASE WHEN coalesce(u.encrypted_password, '') LIKE '$2%' THEN u.encrypted_password ELSE '!no-password' END,
       'bcrypt',
       nullif(u.banned_until, '') IS NULL OR u.banned_until::timestamptz <= now(),
       coalesce(nullif(u.created_at, '')::timestamptz, now()),
       now()
  FROM import_src._auth_users u
 WHERE nullif(u.deleted_at, '') IS NULL AND coalesce(u.email, '') <> '';
INSERT INTO import_src._report SELECT 'table_rows', 'users', count(*)::text FROM public.users;

-- ---------------------------------------------------------------- 0009 survivor rule (same ranking as the migration)
CREATE TABLE import_src._closed_registers AS
WITH activity AS (
  SELECT cr.id::uuid AS id, cr.restaurant_id::uuid AS restaurant_id,
         coalesce(greatest((SELECT max(p.created_at::timestamptz) FROM import_src.payments p WHERE p.cash_register_id = cr.id),
                           (SELECT max(ct."timestamp"::timestamptz) FROM import_src.cash_transactions ct WHERE ct.cash_register_id = cr.id)),
                  cr.opening_timestamp::timestamptz) AS last_activity,
         cr.opening_timestamp::timestamptz AS opening_timestamp, cr.created_at::timestamptz AS created_at
    FROM import_src.cash_registers cr
   WHERE cr.status = 'open'
), ranked AS (
  SELECT id, restaurant_id,
         row_number() OVER (PARTITION BY restaurant_id
                            ORDER BY last_activity DESC, opening_timestamp DESC, created_at DESC NULLS LAST, id DESC) AS rank
    FROM activity
)
SELECT id, restaurant_id FROM ranked WHERE rank > 1;
INSERT INTO import_src._report
SELECT 'register_closed_0009', id::text, 'restaurant ' || restaurant_id || '; another open register had later activity'
  FROM import_src._closed_registers;

-- ---------------------------------------------------------------- images
INSERT INTO import_src._report
SELECT CASE WHEN m.new_url IS NOT NULL THEN 'image_rewritten'
            WHEN r.status = 'refused_type' THEN 'image_refused_type'
            WHEN d.image_url LIKE '%/storage/v1/object/%' THEN 'image_cleared'
            ELSE 'image_external_kept' END,
       d.id,
       CASE WHEN m.new_url IS NOT NULL THEN m.new_url
            WHEN r.status = 'refused_type' THEN d.name || ': ' || r.name || ' is ' || r.detail
                 || ', not an allowed image (SVG and non-images are refused, as by the API); not copied, image cleared. Upload a PNG/JPG/WebP again.'
            WHEN d.image_url LIKE '%/storage/v1/object/%' THEN d.name || ': ' || d.image_url || ' is not in Supabase Storage (see storage-report.csv); image cleared'
            ELSE d.image_url END
  FROM import_src.dishes d
  LEFT JOIN import_src._mapping m ON m.old_url = d.image_url AND m.restaurant_id = d.restaurant_id
  LEFT JOIN import_src._storage_report r ON r.old_url = d.image_url AND r.restaurant_id = d.restaurant_id AND r.status = 'refused_type'
 WHERE coalesce(d.image_url, '') <> '' AND d.image_url NOT LIKE '%placeholder.svg%';

-- ---------------------------------------------------------------- tables, parents first
\o /dev/null
SELECT pg_temp.import_table('restaurants');
SELECT pg_temp.import_table('business_config');
SELECT pg_temp.import_table('profiles',
  jsonb_build_object(
    'user_id', 'CASE WHEN EXISTS (SELECT 1 FROM public.users u WHERE u.id = s.auth_user_id::uuid) THEN s.auth_user_id::uuid END',
    'active', 's.active::boolean AND NOT (s.auth_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = s.auth_user_id::uuid))'),
  ARRAY['auth_user_id']);
SELECT pg_temp.import_table('categories');
SELECT pg_temp.import_table('dishes',
  jsonb_build_object('image_url',
    'coalesce((SELECT m.new_url FROM import_src._mapping m WHERE m.old_url = s.image_url AND m.restaurant_id = s.restaurant_id),
              CASE WHEN s.image_url LIKE ''%/storage/v1/object/%'' THEN NULL ELSE s.image_url END)'));
SELECT pg_temp.import_table('promotions');
SELECT pg_temp.import_table('promotion_dishes');
SELECT pg_temp.import_table('tables');
SELECT pg_temp.import_table('suppliers');
SELECT pg_temp.import_table('ingredient_categories');
SELECT pg_temp.import_table('inventory_locations');
SELECT pg_temp.import_table('ingredients');
SELECT pg_temp.import_table('inventory_lots');
SELECT pg_temp.import_table('purchase_orders');
SELECT pg_temp.import_table('purchase_order_lines');
SELECT pg_temp.import_table('production_batches');
SELECT pg_temp.import_table('inventory_movements');
SELECT pg_temp.import_table('inventory_counts');
SELECT pg_temp.import_table('inventory_count_lines');
SELECT pg_temp.import_table('recipes');
SELECT pg_temp.import_table('recipe_ingredients');
SELECT pg_temp.import_table('cash_registers',
  jsonb_build_object(
    'status', 'CASE WHEN s.id::uuid IN (SELECT id FROM import_src._closed_registers) THEN ''closed'' ELSE s.status END',
    'closing_timestamp', 'CASE WHEN s.id::uuid IN (SELECT id FROM import_src._closed_registers) THEN coalesce(s.closing_timestamp::timestamptz, now()) ELSE s.closing_timestamp::timestamptz END',
    'updated_at', 'CASE WHEN s.id::uuid IN (SELECT id FROM import_src._closed_registers) THEN now() ELSE s.updated_at::timestamptz END'));
INSERT INTO private.migration_0009_closed_registers (cash_register_id, restaurant_id)
SELECT id, restaurant_id FROM import_src._closed_registers;
SELECT pg_temp.import_table('cash_transactions');
SELECT pg_temp.import_table('customers');
SELECT pg_temp.import_table('customer_addresses');
SELECT pg_temp.import_table('couriers');
SELECT pg_temp.import_table('orders');
SELECT pg_temp.import_table('order_items');
SELECT pg_temp.import_table('order_deliveries');
SELECT pg_temp.import_table('payment_methods');
SELECT pg_temp.import_table('payments');
SELECT pg_temp.import_table('payment_tenders');
SELECT pg_temp.import_table('payment_transactions');
SELECT pg_temp.import_table('ingredient_transactions');
SELECT pg_temp.import_table('ingredient_transactions_orders');
\o

INSERT INTO import_src._report
SELECT 'profile_lost_login', p.id::text, 'source auth user ' || s.auth_user_id || ' was not imported; deactivated'
  FROM public.profiles p JOIN import_src.profiles s ON s.id::uuid = p.id
 WHERE s.auth_user_id IS NOT NULL AND p.user_id IS NULL;
INSERT INTO import_src._report
SELECT 'user_without_profile', u.email, 'can log in only after a profile is created (login answers 403)'
  FROM public.users u WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

-- ---------------------------------------------------------------- counters
DO $$
BEGIN
  IF to_regclass('import_src.inventory_counters') IS NOT NULL THEN
    INSERT INTO private.inventory_counters (restaurant_id, counter, value)
    SELECT restaurant_id::uuid, counter, value::bigint FROM import_src.inventory_counters;
    INSERT INTO imported_tables VALUES ('inventory_counters');
  END IF;
END $$;
WITH used AS (
  SELECT restaurant_id, 'sku_raw' AS counter, max(substring(sku FROM '^MP-([0-9]+)$')::bigint) AS value FROM public.ingredients GROUP BY 1
  UNION ALL SELECT restaurant_id, 'sku_prep', max(substring(sku FROM '^PR-([0-9]+)$')::bigint) FROM public.ingredients GROUP BY 1
  UNION ALL SELECT restaurant_id, 'purchase_order', max(number) FROM public.purchase_orders GROUP BY 1
  UNION ALL SELECT restaurant_id, 'inventory_count', max(number) FROM public.inventory_counts GROUP BY 1
), raised AS (
  INSERT INTO private.inventory_counters AS c (restaurant_id, counter, value)
  SELECT restaurant_id, counter, value FROM used WHERE value IS NOT NULL
  ON CONFLICT (restaurant_id, counter) DO UPDATE SET value = excluded.value WHERE c.value < excluded.value
  RETURNING c.restaurant_id, c.counter, c.value
)
INSERT INTO import_src._report
SELECT 'counter_raised', restaurant_id || ' ' || counter, 'set to ' || value || ' (highest number in use)' FROM raised;

-- ---------------------------------------------------------------- completeness and integrity
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
    FROM pg_class c
   WHERE c.relnamespace = 'import_src'::regnamespace AND c.relkind = 'r' AND c.relname !~ '^_'
     AND c.relname NOT IN (SELECT name FROM imported_tables);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'import: staged source tables this script does not know: % (extend import.sql)', missing;
  END IF;
END $$;

\ir orphan-check.sql
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s (%s rows)', fk, orphans), '; ') INTO bad FROM orphan_findings WHERE orphans > 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'import: rows point at nothing, rolled back: %', bad;
  END IF;
END $$;

-- ---------------------------------------------------------------- report
\pset footer off
\echo ''
\echo 'import report (also in import_src._report)'
SELECT section, item, detail FROM import_src._report WHERE section <> 'table_rows'
 ORDER BY section <> 'image_refused_type', section <> 'user_banned', section, item;
SELECT item AS imported_table, detail AS rows FROM import_src._report WHERE section = 'table_rows' ORDER BY item;
