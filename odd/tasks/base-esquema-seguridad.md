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

## Tasks

- [x] 1. pgTAP harness: `supabase/tests/*.test.sql` + runner script + `pnpm test:db`,
      with a schema smoke test proving the harness reports pass and fail.
- [ ] 2. Reproducible bootstrap: move `20250918180000/1/2` after the post-auth
      migrations, make post-auth-init fail fast with migration tracking (idempotent
      re-runs), fix the GoTrue wait loop and the seed conflict; verify a clean
      `down -v && up --build` applies every migration and the seed.
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
