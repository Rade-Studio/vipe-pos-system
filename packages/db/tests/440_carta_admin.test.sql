-- Carta admin (odd/tasks/carta-digital.md T8, S17, L17 A3, migration 0039).
--
-- private.set_restaurant_slug(p_slug): SECURITY DEFINER, vipe_api only; an
-- admin renames the slug of their own restaurant only; the format is
-- ^[a-z0-9-]{1,64}$ (slug_invalid) and a slug of another restaurant is
-- slug_taken. Refused calls change nothing; the guest functions follow the
-- new slug and forget the old one.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(22);

SELECT ok((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
                  AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname = 'set_restaurant_slug'),
  'set_restaurant_slug is SECURITY DEFINER, pinned, vipe_api only');

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('44000000-0000-0000-0000-0000000000a1', 't440-a', 'T440 A'),
  ('44000000-0000-0000-0000-0000000000b2', 't440-b', 'T440 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('44000000-0000-0000-0000-000000000001', 'admin@t440a.test', 'h'),
  ('44000000-0000-0000-0000-000000000002', 'waiter@t440a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('44100000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', 'Admin A', 'admin@t440a.test', 'admin', true, '44000000-0000-0000-0000-0000000000a1'),
  ('44100000-0000-0000-0000-000000000002', '44000000-0000-0000-0000-000000000002', 'Mesero A', 'waiter@t440a.test', 'waiter', true, '44000000-0000-0000-0000-0000000000a1');
INSERT INTO public.carta_settings (restaurant_id, published) VALUES ('44000000-0000-0000-0000-0000000000a1', true);

-- A waiter and an anonymous caller are refused.
SELECT set_config('app.user_id', '44000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE vipe_api;
SELECT throws_ok($$ SELECT private.set_restaurant_slug('t440-nuevo') $$,
  '42501', 'set_restaurant_slug: admin_required', 'a waiter cannot change the slug');
SELECT set_config('app.user_id', '', true);
SELECT throws_ok($$ SELECT private.set_restaurant_slug('t440-nuevo') $$,
  '42501', 'set_restaurant_slug: admin_required', 'without a staff identity nobody changes the slug');

-- Format and uniqueness, as the admin of A.
SELECT set_config('app.user_id', '44000000-0000-0000-0000-000000000001', true);
SELECT throws_ok($$ SELECT private.set_restaurant_slug('La-Parrilla') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'upper case is refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('la parrilla') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'spaces are refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('peña') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'accents are refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'an empty slug is refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug(NULL) $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'a NULL slug is refused');
SELECT throws_ok(format('SELECT private.set_restaurant_slug(%L)', repeat('a', 65)),
  '22023', 'set_restaurant_slug: slug_invalid', '65 characters are refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('---') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'only dashes are refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('-a') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'a leading dash is refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('a-') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'a trailing dash is refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('a--b') $$,
  '22023', 'set_restaurant_slug: slug_invalid', 'consecutive dashes are refused');
SELECT throws_ok($$ SELECT private.set_restaurant_slug('t440-b') $$,
  '23505', 'set_restaurant_slug: slug_taken', 'the slug of another restaurant is taken');
RESET ROLE;
SELECT is((SELECT slug FROM public.restaurants WHERE id = '44000000-0000-0000-0000-0000000000a1'), 't440-a',
  'refused calls change nothing');

SET LOCAL ROLE vipe_api;
SELECT is(private.set_restaurant_slug('t440-a'), 't440-a', 'keeping the same slug is allowed');
SELECT is(private.set_restaurant_slug(repeat('a', 63) || '1'), repeat('a', 63) || '1', '64 characters are allowed');
SELECT is(private.set_restaurant_slug('b2'), 'b2', 'a short slug with a digit is allowed');
SELECT is(private.set_restaurant_slug('bruma-bar'), 'bruma-bar', 'words separated by one dash are allowed');
SELECT is(private.set_restaurant_slug('la-parrilla-2'), 'la-parrilla-2', 'the admin renames the slug of their restaurant');
SELECT set_config('app.user_id', '', true);
SELECT is(private.guest_restaurant('la-parrilla-2'), '44000000-0000-0000-0000-0000000000a1'::uuid, 'the guest menu follows the new slug');
SELECT is(private.guest_restaurant('t440-a'), NULL, 'the old slug no longer resolves');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
