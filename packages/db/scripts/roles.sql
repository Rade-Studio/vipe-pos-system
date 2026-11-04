-- Application roles for plain Postgres (no Supabase).
--
--   vipe_migrator  owns the schema and runs migrations (pnpm db:migrate).
--   vipe_api       runtime role of the API: LOGIN, NOINHERIT, never superuser,
--                  never BYPASSRLS, so row level security always applies.
--
-- Object grants for vipe_api live in the baseline migration, because the
-- objects do not exist yet when this runs. Idempotent: safe to run again.
--
-- Run as a superuser with psql and three variables:
--   psql -v migrator_password=... -v api_password=... -v db_name=... -f roles.sql
-- db_name is the database handed to vipe_migrator.

SELECT format('CREATE ROLE %I', r)
  FROM unnest(ARRAY['vipe_migrator', 'vipe_api']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE vipe_migrator WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT
  PASSWORD :'migrator_password';
ALTER ROLE vipe_api WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT
  PASSWORD :'api_password';

SELECT format('ALTER DATABASE %I OWNER TO vipe_migrator', :'db_name')
\gexec
