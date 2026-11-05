-- Fixture-specific cases of the rehearsal (rehearse.sh), on top of the generic
-- verify.sql. Ids are the ones of fixtures/source-data.sql. Runs inside a
-- transaction that is rolled back, so the probes (a new SKU, a new purchase
-- order) leave the imported target untouched. Fails on the first broken case.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
BEGIN;
SET LOCAL rehearsal.base = :'s3_public_base_url';

CREATE TEMP TABLE expectations (name text, ok boolean, detail text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.expect(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void
  LANGUAGE sql AS $$ INSERT INTO expectations VALUES (p_name, coalesce(p_ok, false), p_detail) $$;
\o /dev/null

-- Users and profiles
SELECT pg_temp.expect('NULL-password user imported active with an unusable hash (an admin can set a password)',
  (SELECT is_active AND password_hash = '!no-password' FROM public.users WHERE email = 'cocina.b@example.test'));
SELECT pg_temp.expect('empty-password user imported active with an unusable hash',
  (SELECT is_active AND password_hash = '!no-password' FROM public.users WHERE email = 'invitado.a@example.test'));
SELECT pg_temp.expect('no-password users reported',
  (SELECT count(*) = 2 FROM import_src._report WHERE section = 'user_without_password'
      AND item IN ('cocina.b@example.test', 'invitado.a@example.test')));
SELECT pg_temp.expect('banned user imported inactive and reported with the reactivation SQL',
  (SELECT NOT is_active FROM public.users WHERE email = 'vetado.a@example.test')
  AND EXISTS (SELECT 1 FROM import_src._report WHERE section = 'user_banned' AND item = 'vetado.a@example.test'
                 AND detail LIKE '%UPDATE public.users SET is_active = true WHERE id = ''c1000000-0000-4000-8000-000000000007'';%'));
SELECT pg_temp.expect('soft-deleted user skipped',
  NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'borrado.b@example.test'
                 OR id = 'c1000000-0000-4000-8000-000000000006'));
SELECT pg_temp.expect('soft-deleted user reported with its profile',
  EXISTS (SELECT 1 FROM import_src._report WHERE section = 'user_deleted_skipped' AND item = 'borrado.b@example.test'
             AND detail LIKE '%c2000000-0000-4000-8000-000000000006%'));
SELECT pg_temp.expect('profile of the deleted user kept, without login, inactive',
  (SELECT user_id IS NULL AND NOT active FROM public.profiles WHERE id = 'c2000000-0000-4000-8000-000000000006'));
SELECT pg_temp.expect('bcrypt user imported with the GoTrue hash',
  (SELECT is_active AND password_algo = 'bcrypt' AND password_hash = '$2a$10$QtVKisMjTNwU/l5aehGUqeZOgvj.qgfyKxcRk7wspY5zq1K1ECvki'
     FROM public.users WHERE email = 'admin.a@example.test'));
SELECT pg_temp.expect('profiles.auth_user_id became profiles.user_id',
  (SELECT user_id = 'c1000000-0000-4000-8000-000000000001' FROM public.profiles WHERE id = 'c2000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect('profile without login stays without login',
  (SELECT user_id IS NULL FROM public.profiles WHERE id = 'c2000000-0000-4000-8000-000000000008'));

-- 0009 survivor rule
SELECT pg_temp.expect('register with the latest activity stays open (R1)',
  (SELECT status = 'open' AND closing_timestamp IS NULL FROM public.cash_registers WHERE id = 'c4000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect('other open register closed (R2), final_cash untouched',
  (SELECT status = 'closed' AND closing_timestamp IS NOT NULL AND final_cash IS NULL
     FROM public.cash_registers WHERE id = 'c4000000-0000-4000-8000-000000000002'));
SELECT pg_temp.expect('R2 recorded in private.migration_0009_closed_registers, nothing else',
  (SELECT array_agg(cash_register_id) = ARRAY['c4000000-0000-4000-8000-000000000002'::uuid]
     FROM private.migration_0009_closed_registers));
SELECT pg_temp.expect('restaurant B single open register untouched',
  (SELECT status = 'open' FROM public.cash_registers WHERE id = 'c4000000-0000-4000-8000-000000000003'));

-- Counters: stale (A) raised, absent (B) rebuilt, and new numbers do not collide
SELECT pg_temp.expect('counters A raised to the used maxima',
  (SELECT array_agg(counter || '=' || value ORDER BY counter) FROM private.inventory_counters
    WHERE restaurant_id = 'a0000000-0000-4000-8000-000000000001')
  = ARRAY['inventory_count=1', 'purchase_order=2', 'sku_prep=1', 'sku_raw=2']);
SELECT pg_temp.expect('counters B rebuilt from SKUs and document numbers',
  (SELECT array_agg(counter || '=' || value ORDER BY counter) FROM private.inventory_counters
    WHERE restaurant_id = 'b0000000-0000-4000-8000-000000000001')
  = ARRAY['purchase_order=3', 'sku_raw=7']);
INSERT INTO public.ingredients (id, name, unit, restaurant_id, kind, sku)
VALUES ('d5000000-0000-4000-8000-0000000000a1', 'Probe A', 'kg', 'a0000000-0000-4000-8000-000000000001', 'raw', ''),
       ('d5000000-0000-4000-8000-0000000000b1', 'Probe B', 'kg', 'b0000000-0000-4000-8000-000000000001', 'raw', '');
SELECT pg_temp.expect('new SKU after import does not collide (A -> MP-0003, B -> MP-0008)',
  (SELECT array_agg(sku ORDER BY sku) FROM public.ingredients WHERE name LIKE 'Probe %') = ARRAY['MP-0003', 'MP-0008']);
INSERT INTO public.purchase_orders (id, restaurant_id, number, supplier_id, location_id)
VALUES ('d9000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', NULL,
        'd2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect('new purchase order number after import does not collide (A -> 3)',
  (SELECT number = 3 FROM public.purchase_orders WHERE id = 'd9000000-0000-4000-8000-0000000000a1'));

-- image_url rewrite
SELECT pg_temp.expect('Supabase URL rewritten to S3_PUBLIC_BASE_URL/<restaurantId>/dishes/<uuid>.<ext>',
  (SELECT bool_and(image_url ~ ('^' || current_setting('rehearsal.base') || '/' || restaurant_id
                                || '/dishes/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.' || ext || '$'))
     FROM (VALUES ('cd000000-0000-4000-8000-000000000001'::uuid, 'png'), ('cd000000-0000-4000-8000-000000000002', 'webp'),
                  ('cd000000-0000-4000-8000-000000000006', 'jpg'), ('cd000000-0000-4000-8000-000000000007', 'png')) AS e(id, ext)
     JOIN public.dishes d USING (id)));
SELECT pg_temp.expect('one object shared by two restaurants copied under each tenant prefix',
  (SELECT a.image_url <> b.image_url FROM public.dishes a, public.dishes b
    WHERE a.id = 'cd000000-0000-4000-8000-000000000001' AND b.id = 'cd000000-0000-4000-8000-000000000007'));
SELECT pg_temp.expect('placeholder and NULL image_url unchanged',
  (SELECT image_url = '/placeholder.svg?height=300&width=400&query=limonada' FROM public.dishes WHERE id = 'cd000000-0000-4000-8000-000000000003')
  AND (SELECT image_url IS NULL FROM public.dishes WHERE id = 'cd000000-0000-4000-8000-000000000004'));
SELECT pg_temp.expect('URL of a missing object cleared and reported',
  (SELECT image_url IS NULL FROM public.dishes WHERE id = 'cd000000-0000-4000-8000-000000000005')
  AND EXISTS (SELECT 1 FROM import_src._report WHERE section = 'image_cleared'
                 AND item = 'cd000000-0000-4000-8000-000000000005'));

SELECT pg_temp.expect('SVG image not copied, cleared and reported as a refused type with the dish name',
  (SELECT image_url IS NULL FROM public.dishes WHERE id = 'cd000000-0000-4000-8000-000000000008')
  AND EXISTS (SELECT 1 FROM import_src._report WHERE section = 'image_refused_type'
                 AND item = 'cd000000-0000-4000-8000-000000000008' AND detail LIKE 'Postre del chef:%logo.svg%'));

-- Money (also checked generically by verify.sql)
SELECT pg_temp.expect('money: payments 105000, tenders 105000, legacy 42000.00, cash movements 17000.00',
  (SELECT sum(total_charged) FROM public.payments) = 105000
  AND (SELECT sum(amount) FROM public.payment_tenders) = 105000
  AND (SELECT sum(amount) FROM public.payment_transactions) = 42000.00
  AND (SELECT sum(amount) FROM public.cash_transactions) = 17000.00);

-- Tables the source never had stay empty
SELECT pg_temp.expect('auth_sessions, printer_tokens, print_jobs empty',
  NOT EXISTS (SELECT 1 FROM public.auth_sessions) AND NOT EXISTS (SELECT 1 FROM public.printer_tokens)
  AND NOT EXISTS (SELECT 1 FROM public.print_jobs));

\o
\pset footer off
SELECT CASE WHEN ok THEN 'ok  ' ELSE 'FAIL' END AS result, name AS case FROM expectations ORDER BY ok, name;
DO $$
DECLARE failed int := (SELECT count(*) FROM expectations WHERE NOT ok);
BEGIN
  IF failed > 0 THEN
    RAISE EXCEPTION 'rehearsal assertions: % of % cases failed', failed, (SELECT count(*) FROM expectations);
  END IF;
  RAISE WARNING 'rehearsal assertions: all % cases passed', (SELECT count(*) FROM expectations);
END $$;
ROLLBACK;
