-- Printing bridge (odd/tasks/migracion-backend-nestjs.md, T8c design steps 1
-- and 2). Printers authenticate with an opaque token whose sha256 is stored in
-- printer_tokens; kitchen commands and invoices are durable rows of print_jobs.
-- Both tables are tenant-scoped by RLS for the web roles. The printing service
-- has no app.user_id, so it reaches its jobs only through SECURITY DEFINER
-- helpers keyed by the token hash, which resolve the restaurant themselves.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(27);

-- 1-2. Tables exist with RLS enabled.
SELECT has_table('public', 'printer_tokens', 'printer_tokens exists');
SELECT has_table('public', 'print_jobs', 'print_jobs exists');
SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class
    WHERE oid IN ('public.printer_tokens'::regclass, 'public.print_jobs'::regclass)),
  'printer_tokens and print_jobs have row level security'
);

-- 4. vipe_api never reads a token hash.
SELECT ok(
  NOT has_column_privilege('vipe_api', 'public.printer_tokens', 'token_hash', 'SELECT'),
  'vipe_api cannot read printer_tokens.token_hash'
);

-- 5. Jobs are acknowledged and pruned only through the helpers.
SELECT ok(
  NOT has_table_privilege('vipe_api', 'public.print_jobs', 'UPDATE')
  AND NOT has_table_privilege('vipe_api', 'public.print_jobs', 'DELETE')
  AND NOT has_table_privilege('vipe_api', 'public.printer_tokens', 'DELETE'),
  'vipe_api cannot update or delete print_jobs nor delete printer_tokens'
);

-- 6. kind is invoice or command.
SELECT col_has_check('public', 'print_jobs', 'kind', 'print_jobs.kind has a check constraint');

-- 7. The helpers are SECURITY DEFINER, pinned, vipe_api only.
SELECT is(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('touch_printer', 'printer_pending_jobs', 'ack_print_job', 'prune_print_jobs')
      AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
      AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'))::bigint,
  4::bigint,
  'touch_printer, printer_pending_jobs, ack_print_job and prune_print_jobs are SECURITY DEFINER, pinned, vipe_api only'
);

-- Fixtures: restaurant A with an admin, restaurant B with an admin.
INSERT INTO public.restaurants (id, slug, name) VALUES
  ('20000000-0000-0000-0000-0000000000aa', 'rest-t200-a', 'Restaurant T200 A'),
  ('20000000-0000-0000-0000-0000000000bb', 'rest-t200-b', 'Restaurant T200 B');
INSERT INTO public.users (id, email, password_hash) VALUES
  ('20000000-0000-0000-0000-000000000001', 'admin@t200a.test', 'x'),
  ('20000000-0000-0000-0000-000000000002', 'admin@t200b.test', 'x');
INSERT INTO public.profiles (id, user_id, full_name, email, role, restaurant_id) VALUES
  ('20000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000001', 'Admin T200 A', 'admin@t200a.test', 'admin', '20000000-0000-0000-0000-0000000000aa'),
  ('20000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000002', 'Admin T200 B', 'admin@t200b.test', 'admin', '20000000-0000-0000-0000-0000000000bb');

-- 8. An admin of A registers a printer; the restaurant comes from the session.
SET LOCAL ROLE vipe_api;
SELECT set_config('app.user_id', '20000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$INSERT INTO public.printer_tokens (id, name, token_hash)
    VALUES ('20000000-0000-0000-0000-0000000001a1', 'Cocina A', encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'))$$,
  'an admin of A inserts a printer token'
);

-- 9. A web session of A enqueues a command job.
SELECT lives_ok(
  $$INSERT INTO public.print_jobs (id, kind, payload)
    VALUES ('20000000-0000-0000-0000-0000000002a1', 'command', '{"items": [], "waiter": "Ana"}')$$,
  'a session of A inserts a print job'
);

-- 10. kind outside invoice|command is refused.
SELECT throws_ok(
  $$INSERT INTO public.print_jobs (kind, payload) VALUES ('other', '{}')$$,
  '23514',
  NULL,
  'print_jobs refuses an unknown kind'
);

-- 11. B's session sees none of A's printers or jobs.
SELECT set_config('app.user_id', '20000000-0000-0000-0000-000000000002', true);
SELECT is(
  (SELECT count(*) FROM public.printer_tokens) + (SELECT count(*) FROM public.print_jobs),
  0::bigint,
  'restaurant B sees no printer or job of A'
);
INSERT INTO public.printer_tokens (id, name, token_hash)
VALUES ('20000000-0000-0000-0000-0000000001b1', 'Cocina B', encode(sha256(convert_to('tok-b', 'UTF8')), 'hex'));
INSERT INTO public.print_jobs (id, kind, payload)
VALUES ('20000000-0000-0000-0000-0000000002b1', 'invoice', '{"invoiceNumber": "F-B"}');

-- 12. B cannot write a job into A.
SELECT throws_ok(
  $$INSERT INTO public.print_jobs (kind, payload, restaurant_id)
    VALUES ('command', '{}', '20000000-0000-0000-0000-0000000000aa')$$,
  '42501',
  NULL,
  'restaurant B cannot insert a job for A'
);

-- The printing service: no app.user_id, only the helpers.
SELECT set_config('app.user_id', '', true);

-- 13. Without app.user_id, plain selects return nothing.
SELECT is((SELECT count(*) FROM public.print_jobs), 0::bigint, 'without app.user_id print_jobs is empty for vipe_api');

-- 14. touch_printer resolves A's token to A and its printer.
SELECT results_eq(
  $$SELECT id, restaurant_id FROM private.touch_printer(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'))$$,
  $$VALUES ('20000000-0000-0000-0000-0000000001a1'::uuid, '20000000-0000-0000-0000-0000000000aa'::uuid)$$,
  'touch_printer resolves the token hash to its printer and restaurant'
);

-- 15. An unknown token resolves to nothing.
SELECT is_empty(
  $$SELECT * FROM private.touch_printer(encode(sha256(convert_to('nope', 'UTF8')), 'hex'))$$,
  'touch_printer of an unknown token returns no row'
);

-- 16. Pending jobs of A's token: only A's job.
SELECT results_eq(
  $$SELECT id, kind FROM private.printer_pending_jobs(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'))$$,
  $$VALUES ('20000000-0000-0000-0000-0000000002a1'::uuid, 'command'::text)$$,
  'printer_pending_jobs returns only the restaurant''s unprinted jobs'
);

-- 17. A's token cannot ack B's job.
SELECT is(
  private.ack_print_job(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002b1'),
  false,
  'ack of another restaurant''s job is refused'
);

-- 18-19. Ack is idempotent: the first printed_at stays.
SELECT is(
  private.ack_print_job(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002a1'),
  true,
  'ack of the restaurant''s job succeeds'
);
SELECT is(
  private.ack_print_job(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002a1'),
  true,
  'a second ack also succeeds'
);
RESET ROLE;
UPDATE public.print_jobs SET printed_at = '2026-01-01T00:00:00Z' WHERE id = '20000000-0000-0000-0000-0000000002a1';
SET LOCAL ROLE vipe_api;
SELECT private.ack_print_job(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002a1');
RESET ROLE;
SELECT is(
  (SELECT printed_at FROM public.print_jobs WHERE id = '20000000-0000-0000-0000-0000000002a1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'a repeated ack keeps the first printed_at'
);

-- 21. The ack recorded the printer; B's job is still pending.
SELECT results_eq(
  $$SELECT id, printer_token_id FROM public.print_jobs ORDER BY id$$,
  $$VALUES ('20000000-0000-0000-0000-0000000002a1'::uuid, '20000000-0000-0000-0000-0000000001a1'::uuid),
           ('20000000-0000-0000-0000-0000000002b1'::uuid, NULL::uuid)$$,
  'ack stores the printer; B''s job is untouched'
);

-- 22. touch_printer recorded last_seen_at; a revoked token resolves to nothing.
SELECT isnt(
  (SELECT last_seen_at FROM public.printer_tokens WHERE id = '20000000-0000-0000-0000-0000000001a1'),
  NULL,
  'touch_printer sets last_seen_at'
);
UPDATE public.printer_tokens SET revoked_at = now() WHERE id = '20000000-0000-0000-0000-0000000001a1';
SET LOCAL ROLE vipe_api;
SELECT is(
  (SELECT count(*) FROM private.touch_printer(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex')))
  + (SELECT count(*) FROM private.printer_pending_jobs(encode(sha256(convert_to('tok-a', 'UTF8')), 'hex'))),
  0::bigint,
  'a revoked token resolves to no printer and no job'
);
RESET ROLE;

-- 24-25. Pending jobs page with a keyset cursor (created_at, id) after a job id.
INSERT INTO public.print_jobs (id, restaurant_id, kind, payload, created_at) VALUES
  ('20000000-0000-0000-0000-0000000002b2', '20000000-0000-0000-0000-0000000000bb', 'command', '{}', now() + interval '1 minute'),
  ('20000000-0000-0000-0000-0000000002b3', '20000000-0000-0000-0000-0000000000bb', 'command', '{}', now() + interval '2 minutes');
SET LOCAL ROLE vipe_api;
SELECT results_eq(
  $$SELECT id FROM private.printer_pending_jobs(encode(sha256(convert_to('tok-b', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002b1')$$,
  $$VALUES ('20000000-0000-0000-0000-0000000002b2'::uuid), ('20000000-0000-0000-0000-0000000002b3'::uuid)$$,
  'printer_pending_jobs after a job id returns the later jobs only'
);
SELECT is_empty(
  $$SELECT id FROM private.printer_pending_jobs(encode(sha256(convert_to('tok-b', 'UTF8')), 'hex'), '20000000-0000-0000-0000-0000000002b3')$$,
  'printer_pending_jobs after the newest job is empty'
);
RESET ROLE;

-- 26-27. prune_print_jobs deletes jobs older than 7 days only and reports the unprinted ones.
UPDATE public.print_jobs SET created_at = now() - interval '8 days'
 WHERE id IN ('20000000-0000-0000-0000-0000000002a1', '20000000-0000-0000-0000-0000000002b2');
SET LOCAL ROLE vipe_api;
SELECT results_eq(
  $$SELECT deleted, unprinted FROM private.prune_print_jobs()$$,
  $$VALUES (2, 1)$$,
  'prune_print_jobs returns the deleted count and how many of them were never printed'
);
RESET ROLE;
SELECT results_eq(
  $$SELECT id FROM public.print_jobs ORDER BY id$$,
  $$VALUES ('20000000-0000-0000-0000-0000000002b1'::uuid), ('20000000-0000-0000-0000-0000000002b3'::uuid)$$,
  'prune_print_jobs removes jobs older than 7 days and keeps the rest'
);

SELECT * FROM finish();
ROLLBACK;
