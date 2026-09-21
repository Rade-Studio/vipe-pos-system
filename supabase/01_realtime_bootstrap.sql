-- 01_realtime_bootstrap.sql
-- Manually bootstrap the supabase_realtime publication.
-- The official supabase_realtime postgres extension does NOT exist in any
-- self-hosted postgres image we tested; the realtime container creates its
-- own schema via internal Phoenix migrations on first boot. This script
-- creates the publication that bridges Postgres logical replication to the
-- realtime container.

-- Create realtime schema (if not exists) so Ecto migrations can use it
CREATE SCHEMA IF NOT EXISTS realtime;
GRANT USAGE ON SCHEMA realtime TO supabase_admin;
GRANT CREATE ON SCHEMA realtime TO supabase_admin;

-- Ecto schema_migrations table (without inserted_at column) - must exist
-- before realtime's Phoenix migrations run. Ecto later adds inserted_at via
-- its own migration.
CREATE TABLE IF NOT EXISTS realtime.schema_migrations (
  version bigint primary key
);

-- Publication for postgres_changes events (PostgreSQL <16 does not support
-- CREATE PUBLICATION IF NOT EXISTS, so use a DO block)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- Ensure supabase_admin has replication privileges
DO $$
BEGIN
  ALTER ROLE supabase_admin WITH REPLICATION;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'supabase_admin replication: %', SQLERRM;
END $$;

-- Grant realtime schema rights for supabase_admin
GRANT ALL ON SCHEMA realtime TO supabase_admin;
GRANT ALL ON ALL TABLES IN SCHEMA realtime TO supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA realtime TO supabase_admin;

-- Grant public schema rights
GRANT ALL ON SCHEMA public TO supabase_admin;
GRANT CREATE ON DATABASE postgres TO supabase_admin;

-- Set default search_path for the database so realtime's Ecto finds realtime.schema_migrations
ALTER DATABASE postgres SET search_path TO 'realtime, public';