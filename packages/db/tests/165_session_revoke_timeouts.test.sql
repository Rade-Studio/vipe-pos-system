-- Logout by session id (odd/tasks/migracion-backend-nestjs.md, T5 verification
-- correction 4) and vipe_api role-level timeouts (correction 5). The timeouts
-- live in scripts/roles.sql (run as superuser) because vipe_migrator cannot
-- ALTER ROLE vipe_api; the API pool sets the same values per connection.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(6);

-- Role-level timeouts: raw SQL sessions as vipe_api are bounded too.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
           WHERE r.rolname = 'vipe_api' AND s.setdatabase = 0
             AND 'statement_timeout=30s' = ANY (s.setconfig)),
  'vipe_api has statement_timeout = 30s at role level'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
           WHERE r.rolname = 'vipe_api' AND s.setdatabase = 0
             AND 'idle_in_transaction_session_timeout=15s' = ANY (s.setconfig)),
  'vipe_api has idle_in_transaction_session_timeout = 15s at role level'
);

INSERT INTO public.users (id, email, password_hash) VALUES
  ('16500000-0000-0000-0000-000000000001', 'sid@t165.test', 'h');

SET LOCAL ROLE vipe_api;
SELECT private.create_session('16500000-0000-0000-0000-000000000001', 'r165', now() + interval '1 day') AS sid \gset
SELECT lives_ok(
  format('SELECT private.revoke_session_by_id(%L)', :'sid'),
  'vipe_api revokes a session by id'
);
SELECT is(
  (SELECT count(*) FROM private.rotate_session('r165', 'r165b', now() + interval '1 day'))::bigint,
  0::bigint,
  'a session revoked by id no longer rotates'
);
SELECT lives_ok(
  $$ SELECT private.revoke_session_by_id('16500000-0000-0000-0000-0000000000ff') $$,
  'revoking an unknown session id is a no-op'
);
RESET ROLE;

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
          AND has_function_privilege('vipe_api', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('public', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'revoke_session_by_id'),
  'revoke_session_by_id is SECURITY DEFINER, search_path pinned, vipe_api only'
);

SELECT * FROM finish();
ROLLBACK;
