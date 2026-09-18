-- 01_realtime_bootstrap.sql
-- Manually bootstrap the supabase_realtime publication.
-- The official supabase_realtime postgres extension does NOT exist in any
-- self-hosted postgres image we tested; the realtime container creates its
-- own schema via internal Phoenix migrations on first boot. This script
-- creates the publication that bridges Postgres logical replication to the
-- realtime container.

-- Publication for postgres_changes events
CREATE PUBLICATION IF NOT EXISTS supabase_realtime;

-- Ensure supabase_admin has replication privileges
ALTER ROLE supabase_admin WITH REPLICATION;

-- Realtime container's required schema is created on first boot by the
-- container's Phoenix migrations. We grant it the rights to do so:
GRANT ALL ON SCHEMA public TO supabase_admin;
GRANT CREATE ON DATABASE postgres TO supabase_admin;