-- Table reservations (odd/tasks/reservas-mesas.md T1, S2, S5, L5, migration 0022).
--
-- reservation_name (trimmed 1..80) is set exactly when status = 'reserved';
-- reserved_by is a profile, SET NULL on delete. Tables already reserved before
-- 0022 were backfilled with 'Sin nombre', so the CHECK is validated.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(22);

-- ============================================
-- 1. Schema and grants
-- ============================================
SELECT col_is_null('public', 'tables', 'reservation_name', 'tables.reservation_name is nullable');
SELECT col_type_is('public', 'tables', 'reservation_name', 'text', 'tables.reservation_name is text');
SELECT col_type_is('public', 'tables', 'reservation_arrival_at', 'timestamp with time zone', 'tables.reservation_arrival_at is timestamptz');
SELECT col_type_is('public', 'tables', 'reserved_by', 'uuid', 'tables.reserved_by is uuid');
SELECT col_type_is('public', 'tables', 'reserved_at', 'timestamp with time zone', 'tables.reserved_at is timestamptz');
SELECT col_hasnt_default('public', 'tables', 'reservation_name', 'tables.reservation_name has no default');
SELECT fk_ok('public', 'tables', 'reserved_by', 'public', 'profiles', 'id', 'reserved_by references profiles');
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conname = 'tables_reserved_by_fkey'), 'n',
  'deleting the profile sets reserved_by to NULL');
SELECT is((SELECT array_agg(convalidated ORDER BY conname) FROM pg_constraint
            WHERE conrelid = 'public.tables'::regclass AND conname IN ('tables_reservation_check', 'tables_reservation_name_check')),
  ARRAY[true, true], 'both reservation CHECKs are validated (not NOT VALID)');
SELECT is((SELECT count(*)::int FROM public.tables WHERE status = 'reserved' AND reservation_name IS NULL), 0,
  'no reserved table is left without a name');
SELECT ok(has_table_privilege('vipe_api', 'public.tables', 'SELECT,INSERT,UPDATE,DELETE'), 'vipe_api keeps its table grants');
SELECT ok(NOT has_table_privilege('vipe_api', 'public.tables', 'TRUNCATE'), 'vipe_api still cannot truncate tables');

-- ============================================
-- 2. CHECKs
-- ============================================
INSERT INTO public.tables (id, number, status, restaurant_id)
VALUES ('33000000-0000-0000-0000-000000000001', 9301, 'available', 'a0eebc99-0000-0000-0000-000000000000');

SELECT throws_ok($$ UPDATE public.tables SET status = 'reserved' WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'reserved without a name is refused');
SELECT throws_ok($$ UPDATE public.tables SET reservation_name = 'Ana' WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'a name on a table that is not reserved is refused');
SELECT throws_ok($$ UPDATE public.tables SET status = 'reserved', reservation_name = '   ' WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'a blank name is refused');
SELECT throws_ok($$ UPDATE public.tables SET status = 'reserved', reservation_name = repeat('a', 81) WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'a name longer than 80 characters is refused');
SELECT lives_ok($$ UPDATE public.tables SET status = 'reserved', reservation_name = repeat('a', 80) WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  'an 80-character name is accepted');
SELECT lives_ok($$
  UPDATE public.tables
     SET reservation_name = 'Familia Pérez', reservation_arrival_at = now() + interval '2 hours', reserved_at = now(),
         reserved_by = (SELECT id FROM public.profiles WHERE email = 'maria@restaurant.com')
   WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  'a reservation with arrival time and profile is accepted');
SELECT throws_ok($$ UPDATE public.tables SET status = 'occupied' WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23514', NULL, 'leaving reserved without clearing the name is refused');
SELECT lives_ok($$
  UPDATE public.tables SET status = 'occupied', reservation_name = NULL, reservation_arrival_at = NULL, reserved_by = NULL, reserved_at = NULL
   WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  'seating clears the reservation');
SELECT throws_ok($$ UPDATE public.tables SET reserved_by = '33000000-0000-0000-0000-0000000000ff' WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  '23503', NULL, 'reserved_by must be a profile');

-- ============================================
-- 3. reserved_by is optional
-- ============================================
UPDATE public.tables
   SET status = 'reserved', reservation_name = 'Ana',
       reserved_by = (SELECT id FROM public.profiles WHERE email = 'maria@restaurant.com')
 WHERE id = '33000000-0000-0000-0000-000000000001';
SELECT lives_ok($$ UPDATE public.tables SET reserved_by = NULL WHERE id = '33000000-0000-0000-0000-000000000001' $$,
  'reserved_by may be cleared while the reservation stays');

SELECT * FROM finish();
ROLLBACK;
