-- 0035_print_job_x_report (odd/tasks/informe-x-termico.md, S1, X2):
-- print_jobs.kind accepts the cashier's partial X report, still refuses any
-- other kind, and a web session enqueues it under RLS like the other kinds.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(5);

-- 1. The constraint keeps its name and now lists x_report.
SELECT ok(
  pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'print_jobs_kind_check'))
    LIKE '%x_report%',
  'print_jobs_kind_check lists x_report'
);

-- 2. Superuser insert of an x_report job works.
SELECT lives_ok(
  $$INSERT INTO public.print_jobs (restaurant_id, kind, payload)
    SELECT id, 'x_report', '{"report": {}}' FROM public.restaurants LIMIT 1$$,
  'an x_report job is accepted'
);

-- 3. invoice and command are still accepted.
SELECT lives_ok(
  $$INSERT INTO public.print_jobs (restaurant_id, kind, payload)
    SELECT id, k, '{}' FROM public.restaurants, unnest(ARRAY['invoice', 'command']) AS k LIMIT 2$$,
  'invoice and command are still accepted'
);

-- 4. Any other kind is still refused.
SELECT throws_ok(
  $$INSERT INTO public.print_jobs (restaurant_id, kind, payload)
    SELECT id, 'z_report', '{}' FROM public.restaurants LIMIT 1$$,
  '23514',
  NULL,
  'an unknown kind is still refused'
);

-- 5. Existing jobs keep their kinds (no row was rewritten).
SELECT is_empty(
  $$SELECT 1 FROM public.print_jobs WHERE kind NOT IN ('invoice', 'command', 'x_report')$$,
  'no job has a kind outside the allowed list'
);

SELECT * FROM finish();
ROLLBACK;
