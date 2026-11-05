-- Table numbers are unique per restaurant (odd/tasks/migracion-backend-nestjs.md,
-- T8a verification defect 5). The baseline had tables_number_key UNIQUE (number)
-- across every tenant, so a second restaurant could not have its own table 1.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(4);

SELECT hasnt_index('public', 'tables', 'tables_number_key', 'the global tables_number_key is gone');
SELECT col_is_unique('public', 'tables', ARRAY['restaurant_id', 'number'], 'tables are unique on (restaurant_id, number)');

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('18500000-0000-0000-0000-0000000000aa', 'rest-t185-a', 'Restaurant T185 A'),
  ('18500000-0000-0000-0000-0000000000bb', 'rest-t185-b', 'Restaurant T185 B');
INSERT INTO public.tables (number, restaurant_id) VALUES (1, '18500000-0000-0000-0000-0000000000aa');

SELECT lives_ok(
  $$ INSERT INTO public.tables (number, restaurant_id) VALUES (1, '18500000-0000-0000-0000-0000000000bb') $$,
  'two restaurants can both have table 1'
);
SELECT throws_ok(
  $$ INSERT INTO public.tables (number, restaurant_id) VALUES (1, '18500000-0000-0000-0000-0000000000aa') $$,
  '23505',
  NULL,
  'a duplicate number inside one restaurant is rejected'
);

SELECT * FROM finish();
ROLLBACK;
