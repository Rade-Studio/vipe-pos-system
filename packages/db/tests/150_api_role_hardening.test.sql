-- API role hardening after the T4 verification
-- (odd/tasks/migracion-backend-nestjs.md, T4 evidence).
--
-- vipe_api is now a SQL login, not a PostgREST pseudo-role, so defence in depth
-- against raw SQL as vipe_api matters: DML only, no object creation, every
-- SECURITY DEFINER function pinned to an empty search_path (pg_temp shadowing),
-- and functions created later never executable by PUBLIC by default.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SET LOCAL search_path = public, extensions;
SELECT plan(7);

-- 1. vipe_api holds only DML on public tables: no TRUNCATE, REFERENCES or TRIGGER.
SELECT is(
  (SELECT count(*)
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace,
          unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND has_table_privilege('vipe_api', c.oid, p))::bigint,
  0::bigint,
  'vipe_api has only SELECT/INSERT/UPDATE/DELETE on public tables'
);

-- 2. vipe_api cannot create objects in either schema.
SELECT ok(
  NOT has_schema_privilege('vipe_api', 'public', 'CREATE')
  AND NOT has_schema_privilege('vipe_api', 'private', 'CREATE'),
  'vipe_api cannot create objects in public or private'
);

-- 3. The guard triggers trust only postgres and vipe_migrator.
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~ 'current_user IN'
      AND p.prosrc ~ '(service_role|supabase_admin|authenticated)')::bigint,
  0::bigint,
  'guard trusted role lists name no Supabase role'
);

-- 4. Every SECURITY DEFINER function pins search_path to '' (no pg_temp shadowing).
SELECT is(
  (SELECT count(*)
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.prosecdef
      AND NOT coalesce(p.proconfig @> ARRAY['search_path=""'], false))::bigint,
  0::bigint,
  'every SECURITY DEFINER function sets search_path to the empty string'
);

-- 5. A function created later by vipe_migrator is not executable by PUBLIC.
SET LOCAL ROLE vipe_migrator;
CREATE FUNCTION public.__t150_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1';
RESET ROLE;
SELECT ok(
  NOT has_function_privilege('public', 'public.__t150_probe()', 'EXECUTE'),
  'functions created later by vipe_migrator are not executable by PUBLIC'
);

-- 6. vipe_migrator gets no default tenant (fail closed outside postgres/vipe_api).
SET LOCAL ROLE vipe_migrator;
SELECT is(private.default_restaurant_id(), NULL::uuid, 'vipe_migrator gets no default restaurant');
RESET ROLE;

-- 7. A malformed app.user_id is rejected, never silently ignored.
SELECT set_config('app.user_id', 'not-a-uuid', true);
SELECT throws_ok(
  'SELECT private.current_user_id()',
  '22P02',
  NULL,
  'a non-uuid app.user_id raises invalid_text_representation'
);
SELECT set_config('app.user_id', '', true);

SELECT * FROM finish();
ROLLBACK;
