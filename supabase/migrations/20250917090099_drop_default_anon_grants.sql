-- ============================================
-- P2b: Revoke default anon grants + drop anon storage policies
-- T2-08
--
-- The init.sql (migration 20250501000000_init.sql) sets:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
--
-- This migration revokes those defaults and replaces them with explicit
-- grants to the authenticated role only. Anonymous clients can no longer
-- write to any table without an explicit RLS policy grant.
--
-- Also drops the anonymous storage policies on the dishes bucket
-- (Allow Anonymous Upload/Update/Delete) which were a content-takeover risk.
--
-- Dependencies: 20250917090007_rls_policies_and_profiles_auth_link.sql
-- (storage policies are dropped after RLS is enabled on tables)
-- ============================================

-- ============================================
-- SECTION 1: Revoke default ALL grants from anon and service_role
-- Replaces the defaults set in init.sql (20250501000000_init.sql lines 78-81).
-- After this, new tables are NOT writable by anon without explicit grants.
-- ============================================

-- Revoke default table and sequence privileges from anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Revoke default table and sequence privileges from service_role
-- (service_role should receive only explicit grants where needed;
-- it already bypasses RLS via BYPASSRLS, so default grants are redundant)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM service_role;

-- Grant only the operations needed by authenticated clients.
-- This replaces the implicit ALL grant that init.sql gave to anon.
-- RLS policies enforce tenant isolation; these grants only allow
-- the connection to reach the table at all.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
  SELECT, INSERT, UPDATE, DELETE
  ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
  USAGE, SELECT
  ON SEQUENCES TO authenticated;

-- ============================================
-- SECTION 2: Drop anonymous storage policies on dishes bucket
-- These policies allowed unauthenticated clients to upload/modify/delete
-- dish images. Combined with open RLS (pre-P2), this was a content
-- takeover risk. With anon globally disabled in docker-compose
-- (ANONYMOUS_USERS_ENABLED: "false"), these policies are redundant
-- defense-in-depth removal.
-- ============================================

-- Drop anonymous upload policy
DROP POLICY IF EXISTS "Allow Anonymous Upload" ON storage.objects;

-- Drop anonymous update policy
DROP POLICY IF EXISTS "Allow Anonymous Update" ON storage.objects;

-- Drop anonymous delete policy
DROP POLICY IF EXISTS "Allow Anonymous Delete" ON storage.objects;

-- Keep the "Public Access" (SELECT) policy on storage.objects for dishes
-- so dish images are readable without authentication (needed for menu display).
-- The "Authenticated Users Can Upload" policy is kept for authenticated
-- uploads but is reinforced by RLS at the images endpoint level.

-- Add an admin-only insert policy: only users whose profile role = 'admin'
-- can upload dish images. This is a second layer of defense beyond
-- the RLS policies on the tables.
CREATE POLICY dishes_admin_only_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'dishes'
    AND (
      SELECT role FROM public.profiles
      WHERE auth_user_id = auth.uid()
    ) = 'admin'
  );

-- Add an admin-only update policy for dish images
CREATE POLICY dishes_admin_only_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'dishes'
    AND (
      SELECT role FROM public.profiles
      WHERE auth_user_id = auth.uid()
    ) = 'admin'
  );

-- Add an admin-only delete policy for dish images
CREATE POLICY dishes_admin_only_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'dishes'
    AND (
      SELECT role FROM public.profiles
      WHERE auth_user_id = auth.uid()
    ) = 'admin'
  );
