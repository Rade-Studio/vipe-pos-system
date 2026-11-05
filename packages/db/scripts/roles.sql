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

-- Bound every vipe_api session, including raw SQL outside the API: a hung
-- statement or an open transaction never holds a connection forever. The API
-- pool sets the same values per connection (apps/api/src/db/db-client.ts);
-- vipe_migrator cannot ALTER ROLE, so the role-level setting lives here.
ALTER ROLE vipe_api SET statement_timeout = '30s';
ALTER ROLE vipe_api SET idle_in_transaction_session_timeout = '15s';

SELECT format('ALTER DATABASE %I OWNER TO vipe_migrator', :'db_name')
\gexec
