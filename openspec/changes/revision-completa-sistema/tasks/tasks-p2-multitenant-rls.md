# Tasks: P2 — Multi-Tenant Schema + RLS + Auth

## Phase Goal
Create the `restaurants` table and `restaurant_id` FK on every tenant-scoped table; enable RLS on every public table with tenant-scoped policies; move role from `business_config.*_password` PINs to `auth.users.app_metadata.role`; drop `profiles.password`; drop anonymous storage policies; remove default `GRANT ALL TO anon`.

## PR Slice Recommendation
- **Two chained PRs** (P2a, P2b) because the rough size is ~450 lines — over the 400-line PR budget.
- **P2a (schema)**: T2-01, T2-02, T2-03 — restaurants table + tenant FK + backfill + RLS enable. ~180 lines.
- **P2b (policies + auth + secrets cleanup)**: T2-04 through T2-08 — policies, auth trigger, password drop, anon grant cleanup, storage policies, /api/health route. ~270 lines.
- **Branch base**: `main` per `stacked-to-main`. PR #2a → `sdd/revision-completa-sistema/p2a-multitenant-schema`; PR #2b → `sdd/revision-completa-sistema/p2b-rls-policies` based on `main` after #2a merges.

## Tasks

### T2-01 — Create `restaurants` table + add `restaurant_id` FK to every tenant table
- **description**: Migration creates `restaurants(id uuid pk default gen_random_uuid(), slug text unique not null, name text not null, timezone text default 'America/Bogota', currency text default 'COP', created_at, updated_at)`. Adds `restaurant_id uuid references restaurants(id)` to: `tables`, `orders`, `order_items`, `payment_transactions`, `cash_transactions`, `cash_registers`, `profiles`, `categories`, `dishes`, `ingredients`, `recipes`, `recipe_ingredients`, `ingredient_transactions`, `promotions`, `promotion_dishes`. Inserts a single seed `restaurants` row so the FK has a target.
- **touches**: [`supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "\d orders"` → row includes `restaurant_id uuid`. Same for every table in the list.
- **acceptance_criteria**: [a] migration applies idempotently; [b] every tenant table shows the `restaurant_id` column; [c] one seed restaurant row exists; [d] idempotent re-run is a no-op.
- **depends_on**: [P1 must be merged; no direct task dependency]
- **size_lines_estimate**: ~80 lines (15 ALTER TABLE statements)
- **commit_split_hint**: Single commit: `feat(db): introduce restaurants table + tenant_id FK on all tenant tables`.
- **spec_refs**: R2-01 / S2-01.

### T2-02 — Backfill `auth_user_id` on existing `profiles` rows
- **description**: Within the same migration, add `auth_user_id uuid references auth.users(id) on delete cascade` and `UNIQUE(auth_user_id)` to `profiles`. Backfill existing seed profile rows by joining on email. Idempotent — uses `WHERE auth_user_id IS NULL`. The composite index `(auth_user_id)` makes the auth.uid() join cheap.
- **touches**: [`supabase/migrations/20250917090005_create_restaurants_and_tenant_columns.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "SELECT id, auth_user_id, email FROM profiles LIMIT 5;"` → every row has `auth_user_id` populated.
- **acceptance_criteria**: [a] column + unique constraint exist; [b] all seed profile rows have a non-null `auth_user_id`; [c] re-running the migration is a no-op.
- **depends_on**: [T2-01]
- **size_lines_estimate**: ~20 lines
- **commit_split_hint**: Bundle with T2-01 (single migration, single commit).
- **spec_refs**: R2-06 / S2-09.

### T2-03 — Enable RLS on every public table
- **description**: Migration enables `ROW LEVEL SECURITY` on every public table EXCEPT `restaurants` (seeded by migration, not user-data). Each table gets at minimum a SELECT policy that filters by `restaurant_id` matching the caller's `profiles.restaurant_id`. Tenant-scoped correctness is the non-negotiable invariant: anon key on restaurant A returns zero rows from restaurant B.
- **touches**: [`supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename != 'restaurants';"` → all rows show `rowsecurity = t`.
- **acceptance_criteria**: [a] RLS enabled on every public table except `restaurants`; [b] `tables_select_policy` exists with tenant filter; [c] `INSERT` policy blocks cross-tenant write (tested in T2-08).
- **depends_on**: [T2-01]
- **size_lines_estimate**: ~80 lines (15 ENABLE + 15 SELECT policies)
- **commit_split_hint**: Single commit: `feat(rls): enable RLS + tenant-scoped SELECT policies on every public table`.
- **spec_refs**: R2-02 / S2-03.

### T2-04 — Auth trigger + role in `auth.users.app_metadata`
- **description**: Migration creates `public.handle_new_user()` trigger on `auth.users` AFTER INSERT that upserts a matching `profiles` row with default role `'waiter'` and `restaurant_id = (SELECT id FROM public.restaurants LIMIT 1)`. Drops the role-PIN columns from `business_config` (`kitchen_password`, `cashier_password`, `admin_password`, `waiter_password`). Removes the four PIN checks from `use-profile.ts` and `PasswordDialog.tsx` — role now comes from `auth.users.app_metadata.role`.
- **touches**: [`supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql`, `hooks/use-profile.ts`, `components/auth/PasswordDialog.tsx`, `lib/supabase/business-config-service.ts`, `store/use-config-store.ts`]
- **command**: `supabase.auth.signUp({email, password})` then `SELECT * FROM profiles WHERE auth_user_id = auth.uid();` → returns one row with `role='waiter'`.
- **acceptance_criteria**: [a] signUp creates a `profiles` row with `auth_user_id` set; [b] PIN dialog no longer accepts `1234/5678/9999/0000`; [c] `business_config` no longer stores role PINs.
- **depends_on**: [T2-03]
- **size_lines_estimate**: ~70 lines
- **commit_split_hint**: Single commit: `feat(auth): server-side role in app_metadata + drop PIN gate`.
- **spec_refs**: R2-04 / S2-06, S2-07.

### T2-05 — Drop `profiles.password` + remove plaintext seed credentials
- **description**: Migration `ALTER TABLE profiles DROP COLUMN password`. Rewrites `supabase/seed.sql` to remove `carlos123`/`maria123`/`admin123`/`juan123` plaintext inserts. Updates TypeScript types in `types/supabase.ts` and `types/index.ts` to remove the `password` field. The auth path is `supabase.auth.signInWithPassword` against GoTrue; the column was dead AND a credential leak waiting to happen.
- **touches**: [`supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql`, `supabase/seed.sql`, `types/supabase.ts`, `types/index.ts`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "\d profiles"` → column list does NOT include `password`. `grep -r "carlos123\|maria123\|admin123\|juan123" supabase/ types/` → zero matches.
- **acceptance_criteria**: [a] `password` column dropped; [b] seed.sql contains no plaintext passwords; [c] TypeScript types compile without the field.
- **depends_on**: []
- **size_lines_estimate**: ~25 lines
- **commit_split_hint**: Single commit: `feat(auth): drop profiles.password + clean seed credentials`.
- **spec_refs**: R2-05 / S2-08.

### T2-06 — Drop default `GRANT ALL TO anon` + remove anon storage policies
- **description**: Migration `20250917090099_drop_default_anon_grants.sql` revokes the default ALL grants on tables/sequences from `anon` and `service_role`, then grants only `SELECT, INSERT, UPDATE, DELETE` on tables + `USAGE, SELECT` on sequences to `authenticated`. Drops the three anonymous storage policies on `storage.objects` (INSERT/UPDATE/DELETE). Creates a single admin-only `dishes_admin_only_insert` policy.
- **touches**: [`supabase/migrations/20250917090099_drop_default_anon_grants.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "SELECT * FROM pg_default_acl WHERE grantee = 'anon';"` → zero rows. `supabase.storage.from('dishes').upload(...)` with anon key → 400.
- **acceptance_criteria**: [a] no `GRANT ALL TO anon` for new tables; [b] anon storage upload fails; [c] admin upload still works (covered by R5 tests indirectly).
- **depends_on**: [T2-03]
- **size_lines_estimate**: ~30 lines
- **commit_split_hint**: Single commit: `feat(rls): revoke default anon grants + drop anon storage policies`.
- **spec_refs**: R2-03, R2-07 / S2-05, S2-10.

### T2-07 — Remove hard-coded fallback URL/key from `client.ts`
- **description**: Edit `lib/supabase/client.ts` to throw at module load when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing instead of silently using `https://xyzcompany.supabase.co` + the checked-in anon key. Removes a credential leak (HS-03). Add `process.env.NEXT_PUBLIC_SUPABASE_URL` validation + a runtime check that fails loudly in dev.
- **touches**: [`lib/supabase/client.ts`]
- **command**: `NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= pnpm build` → fails with a clear "missing env" error instead of booting with the fallback URL.
- **acceptance_criteria**: [a] missing env vars throw; [b] no `xyzcompany.supabase.co` literal in the source.
- **depends_on**: []
- **size_lines_estimate**: ~10 lines
- **commit_split_hint**: Single commit: `fix(security): drop hard-coded supabase fallback URL/anon key`.
- **spec_refs**: R2-03 (security implication) / —.

### T2-08 — Multi-tenant isolation smoke test (cross-tenant rejection)
- **description**: Add `pnpm verify:p2` script that seeds two restaurants with one `tables` row each; runs two psql sessions with `SET request.jwt.claim.role = 'authenticated'` for tenant A and tenant B respectively; asserts tenant A's SELECT returns only tenant A rows, INSERT into tenant B is rejected. Catches cross-tenant data leaks.
- **touches**: [`package.json`, `docs/multitenant-isolation-test.md`]
- **command**: `pnpm verify:p2`.
- **acceptance_criteria**: [a] tenant A SELECT count = 1 (own row), tenant B count = 1 (own row); [b] cross-tenant INSERT raises an RLS rejection; [c] doc explains the manual reproduction.
- **depends_on**: [T2-03, T2-04, T2-05, T2-06, T2-07]
- **size_lines_estimate**: ~40 lines
- **commit_split_hint**: Single commit: `chore(verify): add p2 multi-tenant isolation smoke`.
- **spec_refs**: R2-02 / S2-02, S2-04.

## Verification (apply agent will run)
```
docker compose down -v && docker compose up -d
supabase db reset
pnpm docker:dev:seed
pnpm verify:p2
# Expect: every public table has RLS, tenant isolation tests pass, no plaintext passwords anywhere.
```

## Known environmental failures
- `next.config.mjs` still has `ignoreBuildErrors: true` until P4 lands; tsc errors in `use-profile.ts` refactor will not break the build, but `pnpm tsc --noEmit` will catch them.
- The seed script must be re-run after `supabase db reset`; the seed now uses GoTrue users (created via the auth trigger) instead of pre-populated `auth.users` UUIDs.

## Rollback Plan
1. `git revert <merge-sha-2a>` and `git revert <merge-sha-2b>` independently (because stacked-to-main merges each PR to main separately).
2. Surgical: `DROP POLICY ... ON ...` for each policy; `ALTER TABLE ... DROP COLUMN restaurant_id`; `DROP TRIGGER ... ON auth.users`; restore `init.sql` default grants.

## Out-of-phase items
- Admin UI to create a second restaurant (P2 only ships a seed row).
- Encryption-at-rest for `auth.users` (out of scope per deferred list).
- `restaurants` table itself having RLS (admin-only via direct DB access, per Q2-B).
