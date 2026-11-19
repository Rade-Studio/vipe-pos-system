-- H-017 (odd/tasks/qa-noviembre-2026.md T7): migration 0041 keeps at least
-- one active payment method and one active cash method per restaurant.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(16);

SELECT has_trigger('public', 'payment_methods', 'payment_methods_keep_one_active', 'payment_methods has the keep-one-active trigger');

-- A new restaurant gets the four defaults: Efectivo (cash) plus three electronic methods.
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('46000000-0000-0000-0000-0000000000aa', 'rest-t460-a', 'Restaurant T460 A'),
  ('46000000-0000-0000-0000-0000000000bb', 'rest-t460-b', 'Restaurant T460 B');

CREATE FUNCTION pg_temp.active(p_kind text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.payment_methods
   WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND is_active AND (p_kind IS NULL OR kind = p_kind)
$$;

SELECT is(pg_temp.active('cash'), 1::bigint, 'restaurant A starts with one active cash method');

SELECT throws_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND kind = 'cash' $$,
  'P0001', 'Debe quedar al menos un método de pago en efectivo activo para dar cambio.',
  'deactivating the last active cash method is refused'
);
SELECT throws_ok(
  $$ UPDATE public.payment_methods SET kind = 'electronic'
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND kind = 'cash' $$,
  'P0001', 'Debe quedar al menos un método de pago en efectivo activo para dar cambio.',
  'turning the last active cash method electronic is refused'
);
SELECT throws_ok(
  $$ DELETE FROM public.payment_methods
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND kind = 'cash' $$,
  'P0001', 'Debe quedar al menos un método de pago en efectivo activo para dar cambio.',
  'deleting the last active cash method is refused'
);
SELECT is(pg_temp.active('cash'), 1::bigint, 'the refused changes leave the cash method active');

SELECT lives_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND kind = 'electronic' $$,
  'electronic methods can all be deactivated while cash stays'
);
SELECT is(pg_temp.active(), 1::bigint, 'only the cash method is left active');

-- A second cash method lets the first one go.
INSERT INTO public.payment_methods (restaurant_id, code, name, kind)
VALUES ('46000000-0000-0000-0000-0000000000aa', 'caja_dos', 'Efectivo caja 2', 'cash');
SELECT lives_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND code = 'cash' $$,
  'a cash method can be deactivated while another active cash method remains'
);
SELECT throws_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' AND code = 'caja_dos' $$,
  'P0001', 'Debe quedar al menos un método de pago activo para poder cobrar.',
  'deactivating the last active method is refused with the active-method message'
);
SELECT lives_ok(
  $$ UPDATE public.payment_methods SET sort_order = sort_order + 10, name = name || ' x'
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' $$,
  'renaming and reordering are not affected'
);
SELECT lives_ok(
  $$ UPDATE public.payment_methods SET is_active = true
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' $$,
  'reactivating is not affected'
);

SELECT throws_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000aa' $$,
  'P0001', NULL,
  'deactivating every method in one statement is refused'
);
SELECT is(pg_temp.active(), 5::bigint, 'the refused statement leaves every method active');

-- Restaurant B is independent: its rules count its own rows only.
SELECT throws_ok(
  $$ UPDATE public.payment_methods SET is_active = false
      WHERE restaurant_id = '46000000-0000-0000-0000-0000000000bb' AND kind = 'cash' $$,
  'P0001', NULL,
  'restaurant B cannot drop its own last cash method even though A has two'
);

SELECT lives_ok(
  $$ DELETE FROM public.restaurants WHERE id = '46000000-0000-0000-0000-0000000000bb' $$,
  'deleting a restaurant still cascades to its payment methods'
);

SELECT * FROM finish();
ROLLBACK;
