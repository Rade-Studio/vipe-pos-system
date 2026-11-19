-- H-057 (odd/tasks/qa-noviembre-2026.md T14, S4): migration 0045 adds
-- order_items.kitchen_status (pending | preparing | ready), default pending,
-- beside the unchanged lifecycle status.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(8);

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('49500000-0000-0000-0000-0000000000a1', 't495-a', 'T495 A');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('49500000-0000-0000-0000-000000000001', 'cook@t495a.test', 'h');
INSERT INTO public.profiles (id, user_id, full_name, email, role, active, restaurant_id) VALUES
  ('49500000-0000-0000-0000-000000000002', '49500000-0000-0000-0000-000000000001', 'Cook A', 'cook@t495a.test', 'kitchen', true, '49500000-0000-0000-0000-0000000000a1');
INSERT INTO public.orders (id, restaurant_id, status, subtotal, tax, tax_percentage, total) VALUES
  ('49500000-0000-0000-0000-000000000011', '49500000-0000-0000-0000-0000000000a1', 'kitchen', 0, 0, 0, 0);
-- A line written the old way, without kitchen_status.
INSERT INTO public.order_items (id, order_id, name, price, quantity, status, restaurant_id) VALUES
  ('49500000-0000-0000-0000-000000000021', '49500000-0000-0000-0000-000000000011', 'Ajiaco', 20000, 1, 'kitchen', '49500000-0000-0000-0000-0000000000a1'),
  ('49500000-0000-0000-0000-000000000022', '49500000-0000-0000-0000-000000000011', 'Jugo', 5000, 1, 'served', '49500000-0000-0000-0000-0000000000a1');

SELECT col_not_null('public', 'order_items', 'kitchen_status', 'kitchen_status is NOT NULL');
SELECT col_default_is('public', 'order_items', 'kitchen_status', 'pending', 'kitchen_status defaults to pending');
SELECT is(
  (SELECT string_agg(status || ':' || kitchen_status, ',' ORDER BY name) FROM public.order_items
    WHERE order_id = '49500000-0000-0000-0000-000000000011'),
  'kitchen:pending,served:pending',
  'a line inserted without kitchen_status is pending and keeps its lifecycle status'
);

SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '49500000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$ UPDATE public.order_items SET kitchen_status = 'preparing' WHERE id = '49500000-0000-0000-0000-000000000021' $$,
  'vipe_api sets a line preparing'
);
SELECT lives_ok(
  $$ UPDATE public.order_items SET kitchen_status = 'ready' WHERE id = '49500000-0000-0000-0000-000000000021' $$,
  'vipe_api sets a line ready'
);
SELECT throws_ok(
  $$ UPDATE public.order_items SET kitchen_status = 'served' WHERE id = '49500000-0000-0000-0000-000000000021' $$,
  '23514', NULL,
  'any other step is refused by the CHECK'
);
RESET ROLE;
SELECT is(
  (SELECT status || ':' || kitchen_status FROM public.order_items WHERE id = '49500000-0000-0000-0000-000000000021'),
  'kitchen:ready',
  'the refused step left the line ready and still in the kitchen'
);
-- Serving keeps working exactly as before, from any step.
UPDATE public.order_items SET status = 'served' WHERE id = '49500000-0000-0000-0000-000000000021';
SELECT is(
  (SELECT status FROM public.order_items WHERE id = '49500000-0000-0000-0000-000000000021'),
  'served',
  'a ready line is still served through status'
);

SELECT * FROM finish();
ROLLBACK;
