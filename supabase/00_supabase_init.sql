-- 00_supabase_init.sql
-- Runs once on fresh volume; precedes numbered migrations alphabetically.

-- Extensions (skip if not available — not all Supabase extensions ship in self-hosted images)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron not available: %', SQLERRM;
END $$;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net not available: %', SQLERRM;
END $$;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgbouncer;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pgbouncer not available: %', SQLERRM;
END $$;
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'uuid-ossp not available: %', SQLERRM;
END $$;

-- Realtime schema (required by supabase_realtime extension)
CREATE SCHEMA IF NOT EXISTS realtime;

-- Publication (table-level adds come from migrations; also created in 01_realtime_bootstrap.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Publication might already exist: %', SQLERRM;
END $$;

-- Roles (mirror official Supabase self-hosted init.sql)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN PASSWORD 'postgres' NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'postgres' NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin LOGIN PASSWORD 'postgres' NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin LOGIN PASSWORD 'postgres' NOINHERIT;
  END IF;
END $$;

-- Schema grants (auth/storage schemas created by later migrations; wrap grants to later-created roles)
DO $$
BEGIN
  GRANT USAGE ON SCHEMA public, realtime TO anon, authenticated, service_role;
END $$;
DO $$
BEGIN
  GRANT USAGE ON SCHEMA realtime TO supabase_auth_admin, supabase_admin;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'supabase_auth_admin/supabase_admin not yet exist: %', SQLERRM;
END $$;
DO $$
BEGIN
  GRANT ALL ON SCHEMA realtime TO supabase_auth_admin;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'supabase_auth_admin not yet exist: %', SQLERRM;
END $$;
DO $$
BEGIN
  GRANT ALL ON SCHEMA realtime TO supabase_admin;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'supabase_admin not yet exist: %', SQLERRM;
END $$;

-- Base table grants (RLS will tighten per-table in migrations)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
