# Delta for Multi-Tenant RLS and Auth (P2)

## Purpose

Establish multi-tenant data isolation via `restaurants` table + `restaurant_id` FK; enable RLS on every public table; remove plaintext credentials and role PINs; move role to `auth.users.app_metadata`; link `profiles` to `auth.users`.

## ADDED Requirements

### Requirement: R2-01 — Restaurant Tenant Model

The system MUST create a `restaurants` table with `id uuid primary key default gen_random_uuid()` and add `restaurant_id uuid references restaurants(id)` to every tenant-scoped table.

Tenant-scoped tables include: `tables`, `orders`, `order_items`, `payment_transactions`, `cash_transactions`, `cash_registers`, `profiles`, `categories`, `dishes`, `ingredients`, `recipes`, `promotions`.

#### Scenario: S2-01 — Tenant FK present on all tenant tables

- GIVEN `docker compose exec db psql -c "\d orders"` is run after migration
- THEN the output shows `restaurant_id uuid`
- AND the output shows `references restaurants(id)`

#### Scenario: S2-02 — Tenant isolation: anon key A cannot read tenant B rows

- GIVEN restaurant A's anon key is active; restaurant B has a `tables` row with `restaurant_id = B's uuid`
- WHEN the anon key client calls `from("tables").select()`
- THEN the result contains only rows where `restaurant_id = A.uuid`
- AND row B's table is not present in the response (RLS denies)

### Requirement: R2-02 — RLS Enabled on Every Public Table

The system MUST enable `ROW LEVEL SECURITY` on every table in `public` schema except `restaurants` (seeded by migration, not user-data).

Each table MUST have at minimum a policy that restricts SELECT/INSERT/UPDATE/DELETE to rows where `restaurant_id` matches `auth.jwt() -> 'restaurant_id'` or `auth.uid()` joined to `profiles.restaurant_id`.

#### Scenario: S2-03 — RLS SELECT policy enforces tenant scope

- GIVEN two restaurants A and B; RLS is enabled on `tables`; a policy filters by `restaurant_id`
- WHEN restaurant A's authenticated client calls `from("tables").select()`
- THEN the REST response contains only rows belonging to restaurant A
- AND the count is 0 for restaurant B's tables

#### Scenario: S2-04 — RLS INSERT policy blocks cross-tenant write

- GIVEN restaurant A is authenticated; restaurant B's `restaurant_id` is known
- WHEN client attempts `from("tables").insert({restaurant_id: B.uuid, status: 'free', ...})`
- THEN the INSERT returns a 400-level error or is silently rejected by RLS
- AND no row is created in restaurant B's namespace

### Requirement: R2-03 — Anonymous Access Denied on Data Tables

`init.sql` MUST NOT grant `ALL` privileges to `anon` on future tables. The default `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon` line MUST be removed or commented out.

#### Scenario: S2-05 — Default anon grant removed

- GIVEN `init.sql` is read after P2 migration is applied
- THEN line containing `GRANT ALL ON TABLES TO anon` is absent or commented
- AND new tables created thereafter are NOT writable by anon without explicit RLS policy

### Requirement: R2-04 — Role Stored in `auth.users.app_metadata`

The system SHALL migrate role gating from `business_config.*_password` PINs to `auth.users.app_metadata.role`.

A Postgres trigger on `auth.users` INSERT SHALL upsert a matching `profiles` row with the default role from `app_metadata`.

#### Scenario: S2-06 — New auth user gets auto-created profile

- GIVEN a new user signs up via `supabase.auth.signUp()`
- WHEN the INSERT into `auth.users` completes
- THEN a corresponding row in `profiles` with `auth_user_id` = that user's ID is created
- AND `profiles.role` defaults to `'waiter'`

#### Scenario: S2-07 — Role PIN no longer gates role views

- GIVEN the user is not authenticated with any role
- WHEN `PasswordDialog` is bypassed or a wrong PIN is entered
- THEN the app redirects to login rather than granting access to any role view
- AND `business_config` table no longer contains `kitchen_password`, `cashier_password`, etc.

### Requirement: R2-05 — `profiles.password` Dropped

The system MUST drop the `profiles.password` column via a migration.

Seed data MUST NOT contain plaintext passwords.

#### Scenario: S2-08 — Password column removed

- GIVEN `docker compose exec db psql -c "\d profiles"` is run
- THEN the column list does not include `password`
- AND any reference to `profiles.password` in TypeScript types is removed

### Requirement: R2-06 — `profiles.auth_user_id` Linked

`profiles.auth_user_id uuid references auth.users(id) on delete cascade` MUST be added to the `profiles` table.

A one-time backfill migration SHALL populate `auth_user_id` for all existing profile rows from the seed UUIDs.

#### Scenario: S2-09 — Profile links to auth user

- GIVEN `profiles` has an existing row with `id = profile_uuid` and `auth_user_id` = `auth_uuid`
- WHEN `supabase.auth.getUser()` returns the user with `id = auth_uuid`
- THEN the user's role can be resolved by joining `profiles.auth_user_id = auth_users.id`

### Requirement: R2-07 — Anonymous Storage Policies Removed

The `storage.objects` policies that allow anonymous INSERT/UPDATE/DELETE on the `dishes` bucket MUST be dropped.

Only authenticated users with the `admin` role SHALL be able to INSERT or UPDATE objects in the `dishes` bucket.

#### Scenario: S2-10 — Anon cannot upload dish image

- GIVEN `ANONYMOUS_USERS_ENABLED: "false"` is set in docker-compose
- WHEN an unauthenticated client calls `supabase.storage.from("dishes").upload(...)`
- THEN the upload fails with a 400-level error
- AND no object appears in the `dishes` bucket

## MODIFIED Requirements

None — P2 introduces new behavior only.

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Performance | RLS policies MUST NOT introduce >50 ms extra latency on typical queries (tested with `EXPLAIN ANALYZE`) |
| Security | Default `GRANT ALL TO anon` MUST be absent from `init.sql` before any prod migration |
| Multi-tenant | Every new table added after P2 MUST include `restaurant_id` FK and RLS policy in the same migration |

## MIGRATION / ROLLBACK

Key migration files:
- `supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql`
- `supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql`
- `supabase/migrations/20250917090099_drop_default_anon_grants.sql`

Rollback for P2 requires reverting migration order in a single down script (drop policies → drop FKs → restore columns nullable → restore `init.sql` defaults).

## OUT OF SCOPE

- Payment atomicity (P3)
- Realtime publication (P1 — prerequisite, must land first)
- React Query migration (P6)
- CI / build hardening (P4)
