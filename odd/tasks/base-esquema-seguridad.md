# Feature: base-esquema-seguridad

Branch: `feat/base-esquema-seguridad` (cut from PR #73 tip `1cbd88b`, upstream unset)
Worktree: `../vipe-pos-system-worktrees/base-esquema-seguridad`
Engram mirror: `odd/base-esquema-seguridad/tasks`

## Goal

Make the local Supabase schema reproducible from scratch and close the P0 security holes
(anon access, user-editable tenant/role) with pgTAP tests written first. This is the
foundation for the payments redesign (next feature) and later delivery/WhatsApp.

## Decisions

- Local Docker stack is the schema source of truth; Cloud test project
  `ictccwqkdbptpqbcbjwb` becomes staging via `supabase db push` later (user runs login).
- DB tests use pgTAP SQL files run inside `supabase-db`, each wrapped in a rolled-back
  transaction. No Vitest dependency (Vitest lives on the realtime branch chain).
- Tenant and role resolve server-side from `profiles` via `SECURITY DEFINER` helpers,
  never from `user_metadata`.
- Local DB volume holds no real data (0 users, 0 dishes, 1 restaurant, verified
  2026-10-05), so rebuilding it with `down -v` is safe.
- 2026-10-05 (user): adopt the Supabase CLI for local development. One versioned
  `supabase/migrations/` folder, `supabase start` / `supabase db reset` locally,
  `supabase test db` for pgTAP, `supabase db push` to the Cloud test project later.
  The custom docker-compose Supabase stack and its post-auth-init hack are retired.

## Tasks

- [x] 1. pgTAP harness: `supabase/tests/*.test.sql` + runner script + `pnpm test:db`,
      with a schema smoke test proving the harness reports pass and fail.
- [x] 2a. Adopt Supabase CLI: `supabase` dev dependency + `config.toml`, consolidate
      `post-auth-migrations/` into `supabase/migrations/` in timestamp order, fix
      whatever blocks a clean `supabase db reset` (migrations + seed), port pgTAP
      tests to `supabase test db`, RED/GREEN bootstrap test.
- [x] 2b. Retire the legacy docker-compose Supabase stack (db/auth/rest/realtime/
      kong/post-auth-init, init SQL, patched GoTrue) and update README/DOCKER.md.
- [x] 3. Tenant/role helpers + RLS rewrite (RED first): cross-tenant reads/writes denied,
      no `auth.uid() IS NULL` bypass, policies use `profiles`-based helpers.
- [x] 4. Anon lockdown (RED first): revoke anon on all existing public tables and
      sequences, drop `GRANT anon/service_role TO authenticated`, explicit grants for
      `authenticated` and `service_role`.
- [x] 5. Privilege escalation (RED first): users cannot change their own `role` or
      `restaurant_id`; `handle_new_user` ignores metadata role; signup disabled.
- [x] 6. Tenant-scope the remaining tables (RED first): `business_config`,
      `ingredient_categories`, `ingredient_transactions_orders` get `restaurant_id`
      (where applicable) and RLS; app reads keep working.
- [ ] 7. CI: run `pnpm test:db` in GitHub Actions.

## Known follow-ups (out of scope)

- New-tenant provisioning must seed business_config: app `initializeDefaultConfig` runs for every
  role post-login and non-admins now get 42501 when keys are missing (no-op for the seeded tenant).

- Cloud test project: disable signups in the dashboard (Auth > Providers > Email > Allow new users
  to sign up = off); `enable_signup = false` in config.toml only affects local.
- handle_new_user() falls back to the oldest restaurant when app_metadata has no restaurant_id;
  make it fail closed (requires updating auth.users fixtures in tests 010/030).
- Any SECURITY DEFINER function owned by postgres bypasses the profiles guard; audit every new one.
- Admin "create waiter" is broken today: WaiterForm/service.ts send the dropped `password` column
  (PGRST204). Fix in its own task.

- `supabase_admin` default ACLs still auto-grant anon on new public objects (not revocable from a
  migration); `020_anon_lockdown` enumerates every public table/function, so any new object
  exposed to anon fails the suite. Decide later on `auto_expose_new_tables = false`.
- PUBLIC keeps default EXECUTE on new functions; revoke per function (pattern in 20261005130000).
- `authenticated` still has TRUNCATE/REFERENCES/TRIGGER on public tables and CREATE on schema public.

- `001_bootstrap.test.sql` hardcodes 29 migrations; update it with every new migration.
- `docs/payment-atomicity-test.md` still uses `docker exec supabase-db psql`; rewrite it in the
  payments redesign feature.
- Worktree `.atl/` skill-registry churn is stashed (`git stash list`) because a dirty
  tree makes RDD review the dirty files instead of the commit.

- DB-level `search_path` is `realtime, public`; unqualified objects land in `realtime`.
  Investigate its origin in task 2 (runner pins pgtap to `public`).

- `WaiterForm` inserts `profiles.password` (dropped column) without `auth_user_id`
  (`components/admin/staff/WaiterForm.tsx:99-108`, `lib/supabase/service.ts:550-557`).
- Printer listener `pos/app.py` reads `SUPABASE_KEY` from `.env`; confirm it is not the
  anon key before anon lockdown ships to staging.
- Payments redesign (catalog, tender lines, tip/change) is the next feature.

## Evidence log

| Task | Commit | Checks |
|---|---|---|
| 1 | `d7cd948` | `pnpm test:db` 1/1 PASS; deliberate failure and plan mismatch detected (exit 1); pgtap not left installed. RDD lineage `review-8e3ef50661bbebc4`: risk + resilience admitted, readability/reliability refused 4x for invalid reviewer JSON (tool defect); left open, abandon needs maintainer authorization. Harness superseded by `supabase test db` in 2a. |
| 2a | `99163c5` | Verifier: `supabase start` on ports 4432x, `db reset` clean (29 migrations + seed), `pnpm test:db` Files=2 Tests=18 PASS, seeded user login 200 / wrong password 400. RED captured before fixes. Lockfile untouched (CLI via `npx supabase@2.119.0`). RDD lineage `review-96e6f3ec43551b31`: risk, resilience, readability admitted; reliability refused 2x for invalid reviewer JSON; refused claims read manually, none confirmed (brittle hardcoded migration count noted). |
| 2b | `9872534` | `docker compose config -q` exit 0 (dummy env), `pnpm test:db` 18/18 PASS, `pnpm typecheck` exit 0; only stale ref left in `docs/payment-atomicity-test.md`. RDD lineage `review-9bb0a1ea12ecc16f`: risk, resilience, reliability admitted; readability refused (finding without line) then native failure; terminal `escalated` (`unknown_causality`) on R3-001..003 and two R4 findings, all assessed false or intentional (healthcheck exists; fail-fast env is by design; compose no longer owns Supabase; CLI local anon key is deterministic). |
| 3 | `fa39c07` | RED: `010_tenant_isolation` 15 failures (metadata-lying JWT reads tenant B, sub-less JWT reads 9 tables, cross-tenant UPDATE hits 2 rows). GREEN: `pnpm test:db` Files=3 Tests=37 PASS; `db reset` clean, seed loads (6 tables, 4 dishes, 7 categories, 5 profiles). RDD lineage `review-d0f0777767295c7e` (tier medium, reliability only): captured first try; refuter refuted the profiles recursion finding; escalated on `R3-bootstrap-default-mismatch` (seed may not load), refuted by the clean reset above. |
| 4 | `23e46b6` | Pre-login audit: no data access before auth (no exception kept). RED: `020_anon_lockdown` 15 failures (anon held 133 table privileges, could read/write business_config, execute payment RPCs; authenticated was member of anon and service_role). GREEN: Files=4 Tests=62 PASS. Live API: anon GET business_config/orders/restaurants and RPC complete_payment -> 401 42501; logged-in cashier GET tables -> 200 (6 rows). RDD lineage `review-40856ec21a602870`: **approved**, acknowledged (authority burned); 5 informational findings on the test file. |
| 5 | `5a521a1` + correction `0ceb9c3` | RED: `030_profile_privileges` 16/26 failed (waiter self-promotion, cashier DELETE, waiter INSERT, signup metadata role honoured). GREEN: Files=5 Tests=99 PASS; seed roles intact. Live API: waiter PATCH role -> 403 42501, PATCH restaurant_id -> 403, PATCH name -> 200; signup -> 422 signup_disabled; admin insert/edit/delete staff -> 201/200/200. RDD lineage `review-fb3a173d36809968`: refuter corroborated 5 'deterministic' findings -> correction_required. Verified R3-001/003/004/006 false (waiter deletes/updates 0 unlinked rows; test is BEGIN/ROLLBACK), R3-007 real (unordered LIMIT 1 tenant fallback). Correction `0ceb9c3` (112 of 120 planned lines): deterministic oldest-restaurant fallback + proofs for the false findings. Targeted validator refused 2x (does not bind the correction request, tool defect): lineage left in correction_required without verdict. |
| 6 | (this commit) | RED: `040_remaining_tables_tenancy` 40/56 failed (waiter saw tenant B config and 3 restaurants, waiter wrote config, junction unscoped); orchestrator added a RED for service_role inserting config without restaurant_id (silently landed in oldest tenant) and restricted the fallback to postgres. GREEN: Files=6 Tests=157 PASS; db reset clean, 8 seed config rows in 1 tenant. Live API: waiter GET config 200 (8 rows), waiter PATCH 0 rows, admin PATCH/POST/DELETE ok, waiter GET restaurants = 1 row, anon 401. |
