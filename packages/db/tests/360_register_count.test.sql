-- Shift count and cash movement reasons (odd/tasks/caja-cierres.md T1, S1,
-- S2, migration 0026). cash_registers gains counted_cash, cash_difference,
-- close_note, denominations and closed_by; cash_transactions gains reason
-- and created_by (default: the caller's profile). The API stores the count
-- right after close_register; these tests pin the columns and the rules the
-- database enforces on its own.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(28);

-- ============================================
-- 1. Columns
-- ============================================
SELECT col_type_is('public', 'cash_registers', 'counted_cash', 'numeric(10,2)', 'cash_registers.counted_cash is numeric(10,2)');
SELECT col_type_is('public', 'cash_registers', 'cash_difference', 'numeric(10,2)', 'cash_registers.cash_difference is numeric(10,2)');
SELECT col_type_is('public', 'cash_registers', 'close_note', 'text', 'cash_registers.close_note is text');
SELECT col_type_is('public', 'cash_registers', 'denominations', 'jsonb', 'cash_registers.denominations is jsonb');
SELECT col_type_is('public', 'cash_registers', 'closed_by', 'uuid', 'cash_registers.closed_by is a uuid');
SELECT col_hasnt_default('public', 'cash_registers', 'closed_by', 'closed_by is set by the close, not by a default');
SELECT fk_ok('public', 'cash_registers', ARRAY['restaurant_id', 'closed_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'a register references its closer through (restaurant_id, closed_by)');
SELECT col_type_is('public', 'cash_transactions', 'reason', 'character varying(20)', 'cash_transactions.reason is varchar(20)');
SELECT col_is_null('public', 'cash_transactions', 'reason', 'reason is nullable (older movements)');
SELECT col_type_is('public', 'cash_transactions', 'created_by', 'uuid', 'cash_transactions.created_by is a uuid');
SELECT col_default_is('public', 'cash_transactions', 'created_by', 'private.current_profile_id()', 'created_by defaults to the caller profile');
SELECT fk_ok('public', 'cash_transactions', ARRAY['restaurant_id', 'created_by'], 'public', 'profiles', ARRAY['restaurant_id', 'id'],
  'a movement references its author through (restaurant_id, created_by)');
SELECT ok(
  has_table_privilege('vipe_api', 'public.cash_registers', 'SELECT, UPDATE')
    AND has_column_privilege('vipe_api', 'public.cash_registers', 'counted_cash', 'UPDATE')
    AND has_column_privilege('vipe_api', 'public.cash_transactions', 'reason', 'INSERT'),
  'vipe_api reads and writes the new columns');

-- ============================================
-- 2. Fixtures
-- ============================================
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('36000000-0000-0000-0000-0000000000a1', 't360-a', 'T360 A'),
  ('36000000-0000-0000-0000-0000000000b2', 't360-b', 'T360 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('36000000-0000-0000-0000-000000000001', 'cashier@t360a.test', 'h'),
  ('36000000-0000-0000-0000-000000000002', 'cashier@t360b.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('36100000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 'Cajera A', 'cashier@t360a.test', 'cashier', true, '36000000-0000-0000-0000-0000000000a1'),
  ('36100000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-000000000002', 'Cajero B', 'cashier@t360b.test', 'cashier', true, '36000000-0000-0000-0000-0000000000b2');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('36300000-0000-0000-0000-0000000000a1', '36000000-0000-0000-0000-0000000000a1', now(), 0, 'open');

-- ============================================
-- 3. Count constraints
-- ============================================
SELECT throws_ok($$ UPDATE public.cash_registers SET counted_cash = -1, cash_difference = -1, close_note = 'faltante' WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a negative count is refused');
SELECT throws_ok($$ UPDATE public.cash_registers SET counted_cash = 10.5, cash_difference = 10.5, close_note = 'sobrante' WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a count with cents is refused (whole pesos)');
SELECT throws_ok($$ UPDATE public.cash_registers SET counted_cash = 100 WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a count without its difference is refused');
SELECT throws_ok($$ UPDATE public.cash_registers SET counted_cash = 100, cash_difference = 100 WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a difference without a note is refused');
SELECT throws_ok($$ UPDATE public.cash_registers SET counted_cash = 100, cash_difference = 100, close_note = 'ab' WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a note under 3 characters is refused');
SELECT throws_ok($$ UPDATE public.cash_registers SET close_note = repeat('x', 301) WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'a note over 300 characters is refused');
SELECT throws_ok($$ UPDATE public.cash_registers SET denominations = '{"value": 1000}' WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23514', NULL, 'denominations must be an array');
SELECT lives_ok(
  $$ UPDATE public.cash_registers
        SET counted_cash = 0, cash_difference = 0, denominations = '[{"value": 1000, "quantity": 0}]'
      WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  'a matching count needs no note');

-- ============================================
-- 4. closed_by and movements through the API session
-- ============================================
SELECT set_config('app.user_id', '36000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok(
  $$ UPDATE public.cash_registers SET closed_by = '36100000-0000-0000-0000-000000000002' WHERE id = '36300000-0000-0000-0000-0000000000a1' $$,
  '23503', NULL, 'a profile of another restaurant cannot be the closer');
INSERT INTO public.cash_transactions (id, amount, type, description, reason, cash_register_id) VALUES
  ('36400000-0000-0000-0000-0000000000a1', 5000, 'withdrawal', '', 'supplier', '36300000-0000-0000-0000-0000000000a1');
SELECT is(
  (SELECT row(reason, created_by)::text FROM public.cash_transactions WHERE id = '36400000-0000-0000-0000-0000000000a1'),
  '(supplier,36100000-0000-0000-0000-000000000001)',
  'a movement through the API records its reason and the caller as author');
SELECT throws_ok(
  $$ INSERT INTO public.cash_transactions (amount, type, reason, cash_register_id) VALUES (1, 'deposit', 'refund', '36300000-0000-0000-0000-0000000000a1') $$,
  '23514', NULL, 'an unknown reason is refused');
SELECT throws_ok(
  $$ INSERT INTO public.cash_transactions (amount, type, description, reason, cash_register_id) VALUES (1, 'deposit', '  ', 'other', '36300000-0000-0000-0000-0000000000a1') $$,
  '23514', NULL, 'other without a description is refused');
SELECT lives_ok(
  $$ INSERT INTO public.cash_transactions (amount, type, description, reason, cash_register_id) VALUES (1, 'deposit', 'Vuelto', 'other', '36300000-0000-0000-0000-0000000000a1') $$,
  'other with a description is accepted');
RESET ROLE;
SELECT set_config('app.user_id', '', true);
INSERT INTO public.cash_transactions (id, restaurant_id, amount, type, cash_register_id) VALUES
  ('36400000-0000-0000-0000-0000000000a2', '36000000-0000-0000-0000-0000000000a1', 1, 'deposit', '36300000-0000-0000-0000-0000000000a1');
SELECT is(
  (SELECT row(reason, created_by)::text FROM public.cash_transactions WHERE id = '36400000-0000-0000-0000-0000000000a2'),
  '(,)',
  'a movement written outside a session has no reason and no author (older rows read null)');
DELETE FROM public.cash_transactions WHERE restaurant_id = '36000000-0000-0000-0000-0000000000a1';
UPDATE public.cash_registers SET closed_by = '36100000-0000-0000-0000-000000000001' WHERE id = '36300000-0000-0000-0000-0000000000a1';
DELETE FROM public.profiles WHERE id = '36100000-0000-0000-0000-000000000001';
SELECT is(
  (SELECT row(closed_by, restaurant_id)::text FROM public.cash_registers WHERE id = '36300000-0000-0000-0000-0000000000a1'),
  '(,36000000-0000-0000-0000-0000000000a1)',
  'deleting the closer clears closed_by and keeps the register''s restaurant');

SELECT * FROM finish();
ROLLBACK;
