-- ============================================
-- Init: Habilitar extensiones y roles
-- ============================================

-- Habilitar UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Crear schemas requeridos por Supabase (GoTrue, Storage)
-- GoTrue asume que el schema "auth" ya existe cuando corre su migración inicial.
-- Storage asume que el schema "storage" ya existe.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- Crear rol anon (para acceso público vía PostgREST)
DO $$
BEGIN
    CREATE ROLE anon;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Crear rol authenticated
DO $$
BEGIN
    CREATE ROLE authenticated;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Crear rol service_role (requerido por Storage API)
DO $$
BEGIN
    CREATE ROLE service_role NOLOGIN;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Crear rol supabase_admin (requerido por Supabase Studio para operaciones
-- privilegiadas como listar usuarios de auth.users; la imagen postgis no
-- lo crea por defecto — solo la supabase/postgres oficial lo trae).
-- LOGIN porque Studio abre conexiones separadas como este rol (no solo SET ROLE).
-- BYPASSRLS para saltar RLS en queries administrativas.
-- GRANT al rol postgres para que pueda SET ROLE supabase_admin.
DO $$
BEGIN
    CREATE ROLE supabase_admin WITH LOGIN PASSWORD 'postgres' BYPASSRLS CREATEDB CREATEROLE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
-- El stack del Supabase CLI no crea `postgres` como superusuario, y desde
-- PostgreSQL 16 la membresía del rol reservado `supabase_admin` solo puede
-- otorgarla un superusuario. El CLI ya se encarga de dársela, así que aquí
-- solo se intenta cuando el rol actual sí puede.
DO $$
BEGIN
    IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        EXECUTE 'GRANT supabase_admin TO postgres';
    END IF;
END $$;

-- supabase_admin se crea DESPUÉS de los schemas auth/storage/public,
-- por lo tanto no es owner y no recibe permisos implícitos. BYPASSRLS
-- solo esquiva políticas RLS — no da USAGE sobre schemas ni acceso a
-- tablas/funciones. Hacemos GRANT explícito para que Studio pueda
-- listar tablas (Table Editor) y consultar auth.users (Users page).
--
-- En el stack del Supabase CLI los schemas auth/storage/realtime son propiedad
-- de supabase_admin (que además es superusuario) y `postgres` no es owner de
-- ellos, así que Postgres rechaza estos GRANT con "permission denied for
-- schema". Ahí son innecesarios, así que solo se aplican cuando el rol actual
-- realmente puede (_owns_schema_anywhere_).
DO $$
DECLARE
    _owns_auth_storage boolean := EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname IN ('auth', 'storage') AND pg_get_userbyid(nspowner) = current_user
    );
BEGIN
    IF _owns_auth_storage THEN
        EXECUTE 'GRANT USAGE ON SCHEMA auth, storage, public TO supabase_admin';
        EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA auth, storage, public TO supabase_admin';
        EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA auth, storage, public TO supabase_admin';
        EXECUTE 'GRANT ALL ON ALL FUNCTIONS IN SCHEMA auth, storage, public TO supabase_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth, storage, public GRANT ALL ON TABLES TO supabase_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth, storage, public GRANT ALL ON SEQUENCES TO supabase_admin';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth, storage, public GRANT ALL ON FUNCTIONS TO supabase_admin';
    END IF;
END $$;

-- Asignar roles
GRANT anon TO authenticated;
GRANT service_role TO authenticated;

-- Habilitar uuid-ossp para los roles
GRANT ALL ON SCHEMA public TO anon, authenticated, service_role;
-- Los schemas auth/storage pertenecen a supabase_admin en el stack del CLI
-- (que ya otorga estos permisos); solo se concede aquí cuando el rol actual es
-- su owner, para no chocar con "permission denied for schema".
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname IN ('auth', 'storage') AND pg_get_userbyid(nspowner) = current_user
    ) THEN
        GRANT ALL ON SCHEMA auth TO service_role;
        GRANT ALL ON SCHEMA storage TO service_role;
    END IF;
END $$;

-- Permissions básicas
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- ============================================
-- Fix: GoTrue v2.158.1 migrations create enums (factor_type,
-- factor_status, aal_level) WITHOUT a schema prefix. If we don't
-- pre-create them in `auth`, they land in `public` and break the
-- downstream migration `20240729123726_add_mfa_phone_config.up.sql`
-- with "type auth.factor_type does not exist".
--
-- El stack del Supabase CLI ya los crea en `auth` (son propiedad de
-- supabase_admin) y `postgres` no tiene CREATE sobre ese schema, así que
-- crearlos a mano falla con "permission denied for schema auth". Por eso el
-- bloque solo actúa si el tipo falta de verdad y el rol actual puede crearlo.
--
-- NOTA: NO seteamos `ALTER ROLE postgres SET search_path = auth, public`
-- porque eso rompe Realtime (su Ecto encuentra auth.schema_migrations
-- y trata de insertar sin la columna inserted_at).
--
-- Solución: pre-crear los enums con prefijo de schema aquí.
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'auth' AND t.typname = 'factor_type'
    ) AND has_schema_privilege(current_user, 'auth', 'CREATE') THEN
        CREATE TYPE auth.factor_type AS ENUM ('totp', 'webauthn');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'auth' AND t.typname = 'factor_status'
    ) AND has_schema_privilege(current_user, 'auth', 'CREATE') THEN
        CREATE TYPE auth.factor_status AS ENUM ('unverified', 'verified');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'auth' AND t.typname = 'aal_level'
    ) AND has_schema_privilege(current_user, 'auth', 'CREATE') THEN
        CREATE TYPE auth.aal_level AS ENUM ('aal1', 'aal2', 'aal3');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
-- Los hace accesibles para usuarios autenticados y service_role.
-- GoTrue ya los otorga en el stack del CLI, donde `postgres` no es owner de
-- `auth`; solo se concede aquí cuando el rol actual puede.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname = 'auth' AND pg_get_userbyid(nspowner) = current_user
    ) THEN
        GRANT USAGE ON TYPE auth.factor_type, auth.factor_status, auth.aal_level TO authenticated, service_role, anon;
    END IF;
END $$;
