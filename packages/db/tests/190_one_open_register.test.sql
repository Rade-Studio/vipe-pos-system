-- One open cash register per restaurant (odd/tasks/migracion-backend-nestjs.md,
-- T9 design step 4). The web guarded a second open register only in the
-- browser store; the partial unique index one_open_register_per_restaurant on
-- cash_registers(restaurant_id) WHERE status = 'open' makes it a database rule,
-- so POST /registers/open answers 409 on a race too.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(10);

SELECT has_index('public', 'cash_registers', 'one_open_register_per_restaurant', ARRAY['restaurant_id'],
  'cash_registers has one_open_register_per_restaurant on (restaurant_id)');
SELECT is(
  (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.one_open_register_per_restaurant'::regclass),
  true,
  'the index is unique'
);
SELECT is(
  (SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid = 'public.one_open_register_per_restaurant'::regclass),
  '((status)::text = ''open''::text)',
  'the index covers open registers only'
);

INSERT INTO public.restaurants (id, slug, name) VALUES
  ('19000000-0000-0000-0000-0000000000aa', 'rest-t190-a', 'Restaurant T190 A'),
  ('19000000-0000-0000-0000-0000000000bb', 'rest-t190-b', 'Restaurant T190 B');
INSERT INTO public.cash_registers (restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('19000000-0000-0000-0000-0000000000aa', now(), 0, 'open'),
  ('19000000-0000-0000-0000-0000000000aa', now(), 0, 'closed');

SELECT throws_ok(
  $$ INSERT INTO public.cash_registers (restaurant_id, opening_timestamp, initial_cash, status)
     VALUES ('19000000-0000-0000-0000-0000000000aa', now(), 0, 'open') $$,
  '23505',
  NULL,
  'a second open register in one restaurant is rejected'
);
SELECT lives_ok(
  $$ INSERT INTO public.cash_registers (restaurant_id, opening_timestamp, initial_cash, status)
     VALUES ('19000000-0000-0000-0000-0000000000aa', now(), 0, 'closed'),
            ('19000000-0000-0000-0000-0000000000bb', now(), 0, 'open') $$,
  'closed registers and another restaurant''s open register are accepted'
);
SELECT throws_ok(
  $$ UPDATE public.cash_registers SET status = 'open'
      WHERE restaurant_id = '19000000-0000-0000-0000-0000000000aa' AND status = 'closed' $$,
  '23505',
  NULL,
  'reopening a closed register while another is open is rejected'
);

-- Migration 0009 dedupe (T9 verification advisory 1): with the index dropped,
-- three open registers of one restaurant; the oldest has a cash movement, the
-- middle one the latest payment. The statement below is the migration's verbatim.
DROP INDEX public.one_open_register_per_restaurant;
INSERT INTO public.restaurants (id, slug, name) VALUES ('19000000-0000-0000-0000-0000000000cc', 'rest-t190-c', 'Restaurant T190 C');
INSERT INTO public.cash_registers (id, restaurant_id, opening_timestamp, initial_cash, status) VALUES
  ('19000000-0000-0000-0000-0000000000c1', '19000000-0000-0000-0000-0000000000cc', now() - interval '3 hours', 1000, 'open'),
  ('19000000-0000-0000-0000-0000000000c2', '19000000-0000-0000-0000-0000000000cc', now() - interval '2 hours', 2000, 'open'),
  ('19000000-0000-0000-0000-0000000000c3', '19000000-0000-0000-0000-0000000000cc', now() - interval '30 minutes', 3000, 'open');
INSERT INTO public.cash_transactions (id, restaurant_id, amount, type, "timestamp", cash_register_id) VALUES
  ('19000000-0000-0000-0000-0000000000d1', '19000000-0000-0000-0000-0000000000cc', 500, 'deposit', now() - interval '2 hours 30 minutes',
   '19000000-0000-0000-0000-0000000000c1');
INSERT INTO public.orders (id, status, subtotal, tax, tax_percentage, total, restaurant_id)
  VALUES ('19000000-0000-0000-0000-0000000000e1', 'paid', 100, 0, 0, 100, '19000000-0000-0000-0000-0000000000cc');
INSERT INTO public.payments (restaurant_id, order_id, cash_register_id, amount_due, tip_amount, total_charged, idempotency_key, created_at)
  VALUES ('19000000-0000-0000-0000-0000000000cc', '19000000-0000-0000-0000-0000000000e1', '19000000-0000-0000-0000-0000000000c2',
          100, 0, 100, gen_random_uuid(), now() - interval '10 minutes');

WITH activity AS (
  SELECT cr.id, cr.restaurant_id,
         coalesce(greatest((SELECT max(p.created_at) FROM public.payments p WHERE p.cash_register_id = cr.id),
                           (SELECT max(ct."timestamp") FROM public.cash_transactions ct WHERE ct.cash_register_id = cr.id)),
                  cr.opening_timestamp) AS last_activity,
         cr.opening_timestamp, cr.created_at
    FROM public.cash_registers cr
   WHERE cr.status = 'open'
), ranked AS (
  SELECT id, restaurant_id,
         row_number() OVER (PARTITION BY restaurant_id
                            ORDER BY last_activity DESC, opening_timestamp DESC, created_at DESC NULLS LAST, id DESC) AS rank
    FROM activity
), closed AS (
  UPDATE public.cash_registers cr
     SET status = 'closed',
         closing_timestamp = coalesce(cr.closing_timestamp, now()),
         updated_at = now()
    FROM ranked
   WHERE cr.id = ranked.id
     AND ranked.rank > 1
  RETURNING cr.id, cr.restaurant_id
)
INSERT INTO private.migration_0009_closed_registers (cash_register_id, restaurant_id)
SELECT id, restaurant_id FROM closed;

CREATE UNIQUE INDEX one_open_register_per_restaurant ON public.cash_registers (restaurant_id) WHERE status = 'open';

SELECT results_eq(
  $$ SELECT id::text FROM public.cash_registers WHERE restaurant_id = '19000000-0000-0000-0000-0000000000cc' AND status = 'open' $$,
  ARRAY['19000000-0000-0000-0000-0000000000c2'],
  'dedupe keeps the register with the latest activity open'
);
SELECT results_eq(
  $$ SELECT id::text, initial_cash::int, final_cash IS NULL, closing_timestamp IS NOT NULL
       FROM public.cash_registers WHERE id IN ('19000000-0000-0000-0000-0000000000c1', '19000000-0000-0000-0000-0000000000c3')
      ORDER BY id $$,
  $$ VALUES ('19000000-0000-0000-0000-0000000000c1', 1000, true, true), ('19000000-0000-0000-0000-0000000000c3', 3000, true, true) $$,
  'closed duplicates keep initial_cash, final_cash NULL, closing_timestamp set'
);
SELECT is(
  (SELECT count(*) FROM public.cash_transactions WHERE id = '19000000-0000-0000-0000-0000000000d1')::int, 1,
  'the cash movement of a closed duplicate is kept'
);
SELECT results_eq(
  $$ SELECT cash_register_id::text FROM private.migration_0009_closed_registers
      WHERE restaurant_id = '19000000-0000-0000-0000-0000000000cc' ORDER BY 1 $$,
  ARRAY['19000000-0000-0000-0000-0000000000c1', '19000000-0000-0000-0000-0000000000c3'],
  'the audit table lists exactly the two closed registers'
);

SELECT * FROM finish();
ROLLBACK;
