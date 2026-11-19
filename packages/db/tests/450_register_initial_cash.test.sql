-- H-061 (odd/tasks/qa-noviembre-2026.md T2): migration 0040 adds
-- cash_registers_initial_cash_whole_pesos, so a register opens with whole
-- pesos >= 0 whatever the writer.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(6);

SELECT col_has_check('public', 'cash_registers', 'initial_cash', 'cash_registers.initial_cash has a CHECK');

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('45000000-0000-0000-0000-0000000000aa', 'rest-t450-a', 'Restaurant T450 A');

SELECT throws_ok(
  $$ INSERT INTO public.cash_registers (restaurant_id, opening_timestamp, initial_cash, status)
     VALUES ('45000000-0000-0000-0000-0000000000aa', now(), 1000.50, 'closed') $$,
  '23514', NULL, 'initial cash with centavos is rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.cash_registers (restaurant_id, opening_timestamp, initial_cash, status)
     VALUES ('45000000-0000-0000-0000-0000000000aa', now(), -1, 'closed') $$,
  '23514', NULL, 'negative initial cash is rejected'
);
SELECT lives_ok(
  $$ INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status)
     VALUES ('45000000-0000-0000-0000-0000000000c1', '45000000-0000-0000-0000-0000000000aa', now(), 0, 'closed'),
            ('45000000-0000-0000-0000-0000000000c2', '45000000-0000-0000-0000-0000000000aa', now(), 50000, 'open') $$,
  'zero and whole-peso initial cash are accepted'
);
SELECT throws_ok(
  $$ UPDATE public.cash_registers SET initial_cash = 0.01 WHERE id = '45000000-0000-0000-0000-0000000000c2' $$,
  '23514', NULL, 'an update to centavos is rejected'
);
SELECT is(
  (SELECT initial_cash FROM public.cash_registers WHERE id = '45000000-0000-0000-0000-0000000000c2'),
  50000.00::numeric,
  'the rejected update leaves the row unchanged'
);

SELECT * FROM finish();
ROLLBACK;
