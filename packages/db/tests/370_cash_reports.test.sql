-- Shift validation (odd/tasks/caja-cierres.md T3, S7, migration 0027).
-- cash_registers gains validated_by (the admin, same restaurant, ON DELETE
-- SET NULL) and validated_at (only on a closed register). The API sets both
-- through POST /registers/:id/validate. business_config accepts
-- business_day_cutoff_hour 0..6 only. These tests pin the columns and the
-- rules the database enforces on its own.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(12);

-- ============================================
-- 1. Columns
-- ============================================
SELECT col_type_is('public', 'cash_registers', 'validated_by', 'uuid', 'cash_registers.validated_by is a uuid');
SELECT col_hasnt_default('public', 'cash_registers', 'validated_by', 'validated_by is set by the validation, not by a default');
SELECT col_type_is('public', 'cash_registers', 'validated_at', 'timestamp with time zone', 'cash_registers.validated_at is a timestamptz');
SELECT fk_ok('public', 'cash_registers', ARRAY['restaurant_id', 'validated_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'a register references its validator through (restaurant_id, validated_by)');
SELECT ok(
  has_column_privilege('vipe_api', 'public.cash_registers', 'validated_by', 'SELECT, UPDATE')
    AND has_column_privilege('vipe_api', 'public.cash_registers', 'validated_at', 'SELECT, UPDATE'),
  'vipe_api reads and writes the new columns');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('37000000-0000-0000-0000-0000000000a1', 't370-a', 'T370 A'),
  ('37000000-0000-0000-0000-0000000000b2', 't370-b', 'T370 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('37000000-0000-0000-0000-000000000001', 'admin@t370a.test', 'h'),
  ('37000000-0000-0000-0000-000000000002', 'admin@t370b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('37100000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t370a.test', 'admin', true, '37000000-0000-0000-0000-0000000000a1'),
  ('37100000-0000-0000-0000-000000000002', '37000000-0000-0000-0000-000000000002', 'Admin B', 'admin@t370b.test', 'admin', true, '37000000-0000-0000-0000-0000000000b2');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, closing_timestamp, initial_cash, final_cash, status) VALUES
  ('37300000-0000-0000-0000-0000000000a1', '37000000-0000-0000-0000-0000000000a1', now() - interval '2 hours', now(), 0, 0, 'closed'),
  ('37300000-0000-0000-0000-0000000000a2', '37000000-0000-0000-0000-0000000000a1', now(), NULL, 0, NULL, 'open');

-- ============================================
-- 3. Rules
-- ============================================
SELECT is(
  (SELECT row(validated_by, validated_at)::text FROM public.cash_registers WHERE id = '37300000-0000-0000-0000-0000000000a1'),
  '(,)',
  'a register starts without a validation');
SELECT throws_ok(
  $$ UPDATE public.cash_registers SET validated_at = now() WHERE id = '37300000-0000-0000-0000-0000000000a2' $$,
  '23514', NULL, 'an open register cannot be validated');
SELECT throws_ok(
  $$ UPDATE public.cash_registers SET validated_by = '37100000-0000-0000-0000-000000000002', validated_at = now() WHERE id = '37300000-0000-0000-0000-0000000000a1' $$,
  '23503', NULL, 'a profile of another restaurant cannot be the validator');
SELECT lives_ok(
  $$ UPDATE public.cash_registers SET validated_by = '37100000-0000-0000-0000-000000000001', validated_at = now() WHERE id = '37300000-0000-0000-0000-0000000000a1' $$,
  'an admin of the restaurant validates a closed register');
DELETE FROM public.profiles WHERE id = '37100000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT row(validated_by, restaurant_id, validated_at IS NOT NULL)::text FROM public.cash_registers WHERE id = '37300000-0000-0000-0000-0000000000a1'),
  '(,37000000-0000-0000-0000-0000000000a1,t)',
  'deleting the validator clears validated_by and keeps the restaurant and validated_at');

SELECT throws_ok(
  $$ INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('37000000-0000-0000-0000-0000000000a1', 'business_day_cutoff_hour', '7') $$,
  '23514', NULL, 'a cut-off hour over 6 is refused');
SELECT lives_ok(
  $$ INSERT INTO public.business_config (restaurant_id, key, value) VALUES ('37000000-0000-0000-0000-0000000000a1', 'business_day_cutoff_hour', '0') $$,
  'a cut-off hour 0..6 is accepted');

SELECT * FROM finish();
ROLLBACK;
