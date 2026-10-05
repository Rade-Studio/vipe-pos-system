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
- [ ] 3. Tenant/role helpers + RLS rewrite (RED first): cross-tenant reads/writes denied,
      no `auth.uid() IS NULL` bypass, policies use `profiles`-based helpers.
- [ ] 4. Anon lockdown (RED first): revoke anon on all existing public tables and
      sequences, drop `GRANT anon/service_role TO authenticated`, explicit grants for
      `authenticated` and `service_role`.
- [ ] 5. Privilege escalation (RED first): users cannot change their own `role` or
      `restaurant_id`; `handle_new_user` ignores metadata role; signup disabled.
- [ ] 6. Tenant-scope the remaining tables (RED first): `business_config`,
      `ingredient_categories`, `ingredient_transactions_orders` get `restaurant_id`
      (where applicable) and RLS; app reads keep working.
- [ ] 7. CI: run `pnpm test:db` in GitHub Actions.

## Known follow-ups (out of scope)

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
