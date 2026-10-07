# Exploration: investigar-mesa-sync-realtime

**Slug**: investigar-mesa-sync-realtime
**Date**: 2026-09-18
**Investigator**: sdd-explore (delegated)
**Mode**: hybrid (openspec + engram)
**Branch of investigation**: `sdd/revision-completa-sistema/p6c-legacy-cleanup` (current)

---

## Executive Summary

Three questions, three different answers:

1. **Why are you not on main?** Because every commit from the previous SDD change
   (`revision-completa-sistema`) lives on local stacked branches
   (`p1-realtime → p6c-legacy-cleanup`). Nothing was pushed, no PR was opened.
   This was an intentional "local commits only per user instruction" posture —
   confirmed via `gh pr list -s all` showing zero PRs from any `sdd/...` branch.
2. **Why does mesa realtime not sync?** The database currently has NO
   `supabase_realtime` publication, NO `realtime` schema, NO
   `supabase_realtime` extension, AND the postgres image is running with
   `wal_level=replica` (not `logical`). Even the migration files we wrote
   to fix this (`supabase/migrations/20250917090000_enable_realtime_publication.sql`)
   cannot apply to this database as configured. This is a **deeper problem
   than the original diagnosis** — fixing it requires changing the postgres
   Docker image and applying the migrations in the right order against a
   fresh volume, not just running SQL.
3. **Single-PR feasibility?** Technically possible (124 files,
   +10,742/-2,796 lines). Realistically dangerous: a single PR is ~5x the
   400-line recommended review cap; the diff contains the broken realtime
   infra that the user wants fixed, plus refactors that haven't been smoke-tested.
   **Recommend: ship the realtime fix first as its own narrow slice,
   THEN consolidate the rest.**

---

## Current State

### A. Realtime sync — what's actually broken (and why)

**The single sentence answer**: The Postgres database has zero infrastructure
for logical replication. Even the migration file we wrote to fix the symptom
(`20250917090000_enable_realtime_publication.sql`) cannot apply because the
extension and publication it references do not exist in this database.

**Evidence (commands run against the running docker stack):**

| Check | Command | Result | Meaning |
|---|---|---|---|
| Realtime extension available? | `SELECT name FROM pg_available_extensions WHERE name IN ('supabase_realtime','wal2json','pgoutput','pg_cdc_rls')` | **0 rows** | The Postgres image cannot serve realtime events at all |
| Realtime publication exists? | `SELECT * FROM pg_publication WHERE pubname='supabase_realtime'` | **0 rows** | No publication; `ALTER PUBLICATION supabase_realtime ADD TABLE …` will fail |
| WAL level | `SHOW wal_level` | `replica` | Postgres must be at `logical` for logical replication. `replica` is too low |
| Realtime schema exists? | `SELECT nspname FROM pg_namespace WHERE nspname LIKE '%realtime%'` | **0 rows** | The realtime service can't create its internal `realtime` schema |
| Replication slots | `SELECT * FROM pg_replication_slots` | **0 rows** | Nothing is listening for WAL changes |
| Tables in publication | `SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime'` | **0 rows** | (Confirms above) |
| RLS on `public.tables` | `SELECT * FROM pg_policies WHERE tablename='tables'` | **0 rows** | No RLS, but more importantly no publication either |
| Realtime container log | `docker logs supabase-realtime` | Repeated `MigrationsFailedToRun: schema "realtime" does not exist` | Realtime service is up but cannot run its own migrations; `migrations_ran=0` in the tenants table |
| Client subscribes? | `components/pos/TableGrid.tsx:161` calls `realtimeService.subscribeToTables` with `event:"*", schema:"public", table:"tables"` | Code looks correct | The client subscribes properly — it just never receives events because the publication doesn't exist |
| WebSocket reachability | `curl -H "Connection: Upgrade" /realtime/v1/websocket` | 401 Unauthorized (expected) + `Cowboy` server response | Kong routes correctly; auth is the gate (service role JWT validates), not the socket |
| Anon JWT expiry | Decoded `NEXT_PUBLIC_SUPABASE_ANON_KEY` payload | `exp=2104877306` (2036-09-13), `iat=2026-09-16` | JWT not expired |

**What the user sees**: Two waiters on two devices. Waiter A clicks a mesa
and sets status to `occupied`. Waiter B's grid never updates. The waiter must
refresh the page to see the new state.

**Why, in plain language**: Even though Waiter A successfully `UPDATE`s the
`public.tables` row in Postgres, that change is not being broadcast over
WebSocket because:
1. There is no `supabase_realtime` publication that includes `public.tables`.
2. Even if a publication existed, Postgres would refuse to emit logical
   change events because `wal_level=replica`, not `logical`.
3. Even if logical replication were enabled, the realtime service is running
   on `supabase/realtime:v2.135.5` which expects the
   `supabase_realtime` extension in the database to translate WAL → JSON. The
   extension isn't available in `postgis/postgis:16-3.4`.

**Bigger problem**: NONE of the new migrations from the previous session
(`20250917090000_*`, `20250917090005_*`, … `20250917090099_*`) were
applied to the running database. Confirmed by:

```
SELECT version FROM public.schema_migrations ORDER BY version;
-- 85 rows, latest = 20260805000000 (a stock Supabase migration)
-- NONE of the new 2025091709* numbers appear
```

The migration SQL files are present in `supabase/migrations/`, and the
`./supabase/migrations:/docker-entrypoint-initdb.d:ro` volume makes them
available to the container, but `/docker-entrypoint-initdb.d/` only runs
on a **fresh database volume**. The volume `supabase-db-data` was created
before these files existed, so init scripts were skipped. There is no
auto-migration runner configured (no `supabase db reset` was ever run after
the new files were added).

**This means**: even the parts of the previous session that did NOT depend
on the realtime publication (P2 multi-tenant schema, P2 RLS, P3 atomic
payment, P4 build infra, P5 printer, P6 store split, P6c legacy cleanup)
are ALSO not applied. The user is running on the OLD database state plus
the NEW app code. The app code reads `restaurant_id` columns that don't
exist, calls `complete_payment` RPCs that don't exist, queries `profiles`
without `auth_user_id`, etc. (Though this isn't surfacing as user-visible
errors because the API contracts are flexible enough to mostly degrade
gracefully — except for the realtime part, which has NO graceful
degradation path.)

### B. Branch / PR state — what's actually on disk and on GitHub

**Local branches** (`git branch -a`):
- `main` (clean, baseline)
- `sdd/revision-completa-sistema/p1-realtime`
- `sdd/revision-completa-sistema/p2-schema`
- `sdd/revision-completa-sistema/p2-rls-auth`
- `sdd/revision-completa-sistema/p3-payment`
- `sdd/revision-completa-sistema/p4-build-infra`
- `sdd/revision-completa-sistema/p5-printer`
- `sdd/revision-completa-sistema/p6a-store-split`
- `sdd/revision-completa-sistema/p6b-react-query`
- `sdd/revision-completa-sistema/p6c-legacy-cleanup` ← current HEAD
- All 9 phase branches exist locally, none pushed, none have a PR

**Branch topology**: stacked-to-main. Each branch contains the previous branch's commits PLUS new commits. From `git log --oneline --all --graph -30`:

```
* (p6c) e158ea3 docs: append PR #6c apply-progress section
* (p6c) 01dedcd refactor: delete legacy supabase-service.ts and types/models.ts
* (p6b) 2eba867 docs: append PR #6b apply-progress section
* (p6b) 378ccf1 refactor(views): migrate CashierView to useQuery
* (p6a) c798c34 feat(pos): migrate AdminView to useTableStore/useOrderStore selectors
* (p5)  369de4e feat(print): shared renderer for kitchen + invoice (TS + Python)
* (p4)  13feb7b docs: update apply-progress for PR #4 (P4 build & infra safety)
* (p3)  11f3bac refactor(service): add RPC wrappers with deprecation shims
* (p2-rls) a1783b2 feat(db): enable RLS on all public tables
* (p2-schema) d9cf5a6 feat(db): create restaurants table with default tenant seed
* (p1) 9cf5b51 feat(db): enable supabase_realtime publication for tables/orders/order_items
* (main HEAD) earlier commits
```

**Commits per branch vs main**:

| Branch | New commits |
|---|---|
| p1-realtime | 5 |
| p2-schema | 7 |
| p2-rls-auth | 8 |
| p3-payment | 11 |
| p4-build-infra | 18 |
| p5-printer | 25 |
| p6a-store-split | 29 |
| p6b-react-query | 35 |
| **p6c-legacy-cleanup** | **37** |

**Open / merged PRs on GitHub** (`gh pr list -s all -L 30`):
- Latest 30 PRs shown are all from `codex/*`, `feat/ronald`, `dev`, `bug/admin_dashboard` branches — pre-SDD work, dates 2025-06
- **Zero PRs from any `sdd/revision-completa-sistema/*` branch**
- The only currently-open PR is #72 (`codex/refactorizar-acceso-a-datos-en-restaurant-pos`) — unrelated, from before this work
- One historic PR of interest: PR #50 "Fix Waiter table realtime update" (2025-06-04, `codex/actualizar-mesas-en-tiempo-real`, MERGED) — but that fix was in client code only and didn't address the missing publication. That's why the bug came back: a client-only fix without the publication change is a no-op.

**Uncommitted change** (`git status`):
- `docker-compose.yml` modified locally on `p6c-legacy-cleanup`:
    - Changed image `supabase/gotrue:v2.158.1` → `vipe-gotrue-patched:v2.158.1`
    - Added `GOTRUE_DB_NAMESPACE: auth`
  - **These changes are UNCOMMITTED and would NOT be in a PR.** This was likely from a sandbox experiment; before opening any PR, the user needs to either commit or discard this diff.

**Remote**: `origin` is `git@github.com:Rade-Studio/vipe-pos-system.git`, `gh auth status` shows authenticated as `ahernand53`. So PRs CAN be opened; they just weren't.

### C. Single-PR feasibility

**Consolidated PR size** (`git diff main...sdd/revision-completa-sistema/p6c-legacy-cleanup --shortstat`):
- **124 files changed, +10,742 insertions, −2,796 deletions**
- Net +7,946 lines

**What dominates the count** (top files in diff):
| File | Lines | Category |
|---|---|---|
| `pnpm-lock.yaml` | +1,407 / -? | auto-generated; always bloats PRs |
| `openspec/changes/revision-completa-sistema/design.md` | +1,378 | design doc, not code |
| `store/use-pos-store.ts` | -748 | god-store deletion (good!) |
| `supabase/migrations/20250917090007_rls_policies_and_profiles_auth_link.sql` | +705 | new migration |
| `openspec/changes/revision-completa-sistema/apply-progress.md` | +489 | meta doc |
| `components/views/WaiterView.tsx` | +394 / -? | refactor |
| `pos/print_renderer.py` | +336 | new module |
| `store/useOrderStore.ts` | +313 | new store |
| `lib/supabase/service.ts` | +303 / -? | refactor |
| `docs/payment-atomicity-test.md` | +298 | test recipe doc |
| `docker-compose.yml` | +254 | infra changes |
| `lib/print/renderKitchenOrder.ts` | +232 | new module |
| `lib/supabase-service.ts` | -229 | legacy deletion (good!) |
| `openspec/changes/revision-completa-sistema/proposal.md` | +224 | meta doc |
| `components/printing/InvoicePrintView.tsx` | +159 / -? | refactor |

**Code-only diff (excluding openspec/docs/lockfile/README/.atl):**
- **117 files, +8,895 / -2,560 = net +6,335 lines**
- Still well over the 400-line review cap from `chained-pr` skill.

**Migration-only diff** (`supabase/migrations/**`):
- 7 files, +1,286 lines, -0
- Includes the broken P1 migration

**Bottom line on single-PR**:
- Technically mergeable: yes, no destructive conflicts expected
- Realistic for human review: no — even a senior reviewer can't keep 8,000 net added lines in working memory; risk of regression escapes review is high
- The user's stated "un único PR" is a delivery preference, not a correctness requirement. The chained-pr skill explicitly recommends slicing PRs > 400 lines for reviewability.

---

## Root Cause Hypothesis

**Why mesa sync doesn't work** (the user's reported symptom):

The root cause is **environment, not code**. The code path is:
1. UI calls `realtimeService.subscribeToTables(callback)` with `schema:"public", table:"tables"` — correct.
2. Supabase JS sends the subscribe request over WebSocket — correct.
3. Realtime service receives the request and tries to subscribe to logical replication changes for `public.tables` — **fails silently** because no replication slot exists for this table.
4. UI waits forever; no events arrive.
5. User reloads page → fresh `getAll()` reads the new state directly from Postgres.

**The deeper root cause** is that the previous SDD session wrote the migration file `supabase/migrations/20250917090000_enable_realtime_publication.sql` but never ran it. The migration:
- Sets `REPLICA IDENTITY FULL` on `public.tables/orders/order_items` (good)
- Does `ALTER PUBLICATION supabase_realtime ADD TABLE …` — **but the publication doesn't exist on this database**, so this would fail if applied

The reason the publication doesn't exist:
- The base Docker image is `postgis/postgis:16-3.4`, NOT `supabase/postgres`
- `postgis/postgis` doesn't bundle the `supabase_realtime` extension
- The `supabase_realtime` extension is what creates the `supabase_realtime` publication on `CREATE EXTENSION supabase_realtime`
- Without the extension, no publication; without publication, no `postgres_changes` events

**Why this slipped through earlier diagnosis**: The previous exploration
(`openspec/changes/revision-completa-sistema/exploration.md`) listed
"tables never added to supabase_realtime publication" as **HS-01** with
high confidence and prescribed the P1 migration as the fix. That diagnosis
was correct about the publication, but it **didn't verify** whether the
publication mechanism itself was available. The migration was written and
committed, but never `supabase db reset`-applied, so the broken state
persisted.

**Secondary issues that will surface after the publication is fixed**:
1. `wal_level=replica` — Postgres must be restarted with `wal_level=logical` for logical replication. The `postgis/postgis:16-3.4` image doesn't set this by default; needs a `command: ["postgres", "-c", "wal_level=logical"]` override or a config file mount.
2. The `realtime` schema is missing — even if the publication existed, the realtime service can't bootstrap its subscription managers without the schema. The `init.sql` referenced in the docker-compose comments doesn't exist in the repo.
3. The `supabase_admin` role DOES exist (created somehow — possibly by the realtime service itself), but `BYPASSRLS`/`GRANT`s are inconsistent. RLS is OFF everywhere; that's the de-facto working baseline.

**Why the realtime service "works" (sort of)**:
- WebSocket connections succeed (broadcasts work because they're not DB-driven)
- Presence tracking works (in-memory only)
- `postgres_changes` events DO NOT fire (no publication, no slot)

The waiter view's subscription registration is correct; the realtime service's
broadcast/presence features work; only the database-driven changes are silent.

---

## Affected Areas

| Path | Why affected |
|---|---|
| `docker-compose.yml` | Uses `postgis/postgis:16-3.4` instead of `supabase/postgres`; lacks `wal_level=logical`; the missing `init.sql` referenced in comments; gotrue image swapped to a non-existent `vipe-gotrue-patched:v2.158.1` (uncommitted change). |
| `supabase/migrations/20250917090000_enable_realtime_publication.sql` | The P1 fix migration — does `ALTER PUBLICATION supabase_realtime ADD TABLE …` which assumes the publication exists. Will not apply as-is. |
| `supabase/migrations/*.sql` (all 7 new files) | None of the `2025091709*` migrations have been applied to the running DB. The DB volume is older than the files. |
| `lib/supabase/realtime-service.ts` | Client subscription logic is correct. Has a subtle bug: when `subscribeToTables` is called twice in the same role (WaiterView + TableGrid both subscribe), the second call returns a teardown WITHOUT registering the callback. One of the two subscribers silently loses its handler. |
| `components/pos/TableGrid.tsx:161` | Subscribes to `postgres_changes` on `public.tables`. Receives nothing because the publication is missing. |
| `components/views/WaiterView.tsx:216` | Same subscription; has `localChangesRef` dedup for self-emitted events. Also affected by the `subscribeToTables` double-call bug. |
| `components/views/CashierView.tsx`, `KitchenView.tsx`, `AdminView.tsx` | Use `useQuery` to fetch tables/orders. Realtime invalidation hooked but never fires. |
| `hooks/use-profile.ts` | Refactored in P6b — points to `useProfileStore` that doesn't exist in the running DB schema (which still has `password` column, no `auth_user_id`). |
| `openspec/changes/revision-completa-sistema/apply-progress.md` | Records all 9 PRs as "completed" but they exist only as local commits — none are on remote, none have PRs, none are on `main`. |
| `openspec/changes/revision-completa-sistema/` | All 7 specs, design doc, task lists, exploration, proposal — 14 SDD artifacts. |

---

## Approaches

### Approach 1: Fix the realtime infra first, ship a narrow PR (RECOMMENDED)

**Idea**: One PR that does ONLY the infra work needed to make realtime
events fire end-to-end. No refactors, no RLS, no schema changes.

**Steps**:
1. Replace `postgis/postgis:16-3.4` → `supabase/postgres:15.8.1.085` (the standard Supabase local dev image) in `docker-compose.yml`.
2. Mount or inline the missing `supabase/init.sql` (creates `supabase_admin` role with BYPASSRLS, `wal_level=logical` if needed by image, `CREATE EXTENSION supabase_realtime`, the publication).
3. Add `command: postgres -c wal_level=logical` to the db service OR ensure the image has it by default.
4. Apply the existing P1 migration (`ALTER PUBLICATION supabase_realtime ADD TABLE …`) which now will succeed.
5. Apply the P2-RLS migration in a single transaction (or skip RLS for now and just get realtime working).
6. `supabase db reset` the volume.
7. Re-test: 2 tabs, modify mesa in one, see update in the other within 500ms.

**Pros**:
- Fixes the user's reported symptom directly and verifiably
- Smallest possible PR; reviewer can fully audit
- Establishes the foundation for P2-P6 work
- Resets the broken state to a clean baseline

**Cons**:
- Does NOT deliver P2-P6 work
- Requires user to lose existing local DB data (or carefully migrate seed)
- `supabase/postgres` is bigger image; docker pull required
- The migration order matters — getting it wrong leaves you in the same broken state

**Effort**: Low-Medium (mostly infra; SQL is already written)

### Approach 2: Skip the infra fix, push the existing code as a single PR

**Idea**: Just create the consolidating PR (with all 124 files / 10,742 lines)
against main, even though nothing is applied to the DB. When the PR merges,
deal with migrations separately.

**Pros**:
- Matches user's "un único PR" request
- Captures all the work in one atomic unit
- If reviewers are willing, fastest path to main

**Cons**:
- DOES NOT FIX THE USER'S REPORTED SYMPTOM. The realtime still won't work after merge, because the DB still won't have the publication.
- Review-unfriendly: 10K lines is unreviewable in one sitting
- The P1 migration file in the PR won't apply as-is to a fresh `supabase db reset` because the infra doesn't support it
- High regression risk: 9 stacked phases of refactor + infra + schema mixed together
- The user's running app is still broken after merge; they'll come back with the same complaint

**Effort**: Low to open the PR; very High to get it reviewed; High to fix symptoms after merge

**Recommendation: Do NOT do this**. It satisfies the literal request but defeats the spirit. The user's REAL ask is "fix mesa sync AND get this work onto main."

### Approach 3: Split into two PRs (compromise)

**Idea**: PR-A = realtime infra fix (small, ~5-10 files). PR-B = everything else (P2-P6, ~119 files, ~10,500 lines).

**Pros**:
- PR-A fixes the user's symptom independently — even if PR-B never merges, the bug is fixed
- PR-B can be reviewed as "block of related work" rather than "10K line mystery"
- Easier to revert either piece independently

**Cons**:
- PR-B is still >400 lines (chained-pr threshold)
- Stacking PR-B on top of PR-A means `main` doesn't have all the work until both merge
- Still doesn't honor "un único PR"

**Effort**: Medium. Best balance.

---

## Recommendation

**Approach 1 (narrow realtime fix PR) FIRST, then revisit the single-PR question.**

Reasoning:
1. **The user's bug is independent of the P2-P6 work.** Realtime sync doesn't
   work because the docker infra is broken, not because P2-P6 wasn't merged.
   Even on a totally fresh clone of `main`, mesa sync won't work.
2. **A single PR doesn't fix the bug.** Approach 2's PR includes the broken
   P1 migration file that won't apply. Pushing the work doesn't help.
3. **Stacking the right fix in front of the rest of the work is the only
   path that delivers both "fix the bug" and "get the work onto main".**

**Concrete sequence**:
1. **Phase 0 (this change, narrow scope)** — Open a single fixup PR titled
   something like `fix(realtime): enable postgres_changes for public.tables`
   that:
   - Switches docker DB image to `supabase/postgres:15.8.1.085`
   - Adds the missing `supabase/init.sql` (creates roles, sets `wal_level=logical`, `CREATE EXTENSION supabase_realtime`)
   - Applies the existing P1 migration successfully
   - Adds an idempotent `supabase/migrations/20250918000000_apply_pending_migrations.sql` shim that the user runs ONCE against the existing volume (`supabase db reset` is destructive; the shim is non-destructive)
   - Touches ~5-10 files, +~300 lines, easy to review
2. **After that PR merges to main** — Re-evaluate the single-PR question for
   P2-P6 work. With the realtime fix in place, P2-P6 can ship as 1 (small
   enough to swallow), 2 (split RLS+schema from refactors), or more PRs.
3. **Re-test mesa sync in two browser tabs** before declaring success.
4. **Single-PR for P2-P6 work is still risky at 10K lines.** Recommend
   splitting into 2-3 chained PRs even after the realtime fix lands.

**Branch consolidation for the eventual P2-P6 PR(s)**:
- Use `sdd/revision-completa-sistema/p6c-legacy-cleanup` as the source branch — it has all 37 commits stacked on top of main
- Squash to a smaller commit count IF the user wants reviewability (current 37 commits are atomic and well-named, so this is a stylistic choice, not a correctness one)
- Rebase onto main once the realtime fix lands so the diff is "everything new since realtime fix" rather than "everything new since old main"

---

## Risks

1. **Data loss risk**: `supabase db reset` would wipe the running DB (the user has 5 profiles, 6 tables, presumably orders/menu). The P1-shim approach must be idempotent and non-destructive. Verify it before recommending.
2. **Docker pull risk**: Switching to `supabase/postgres:15.8.1.085` requires network access and a multi-GB pull. On a slow connection this could take 10+ minutes. Plan for it.
3. **Migration ordering risk**: The new `2025091709*` migrations depend on each other in order. If `20250917090007_rls_policies_and_profiles_auth_link.sql` runs before `20250917090005_create_restaurants_and_tenant_columns.sql`, the `restaurant_id` columns won't exist and the RLS policies will fail. The shim must respect ordering.
4. **Existing seed data**: The current DB has been running with the old schema; after applying P2 migrations, the existing 5 profiles and 6 tables won't have `restaurant_id` set. The migration must include a backfill (`UPDATE profiles SET restaurant_id = (SELECT id FROM restaurants LIMIT 1) WHERE restaurant_id IS NULL;`).
5. **JWT secret mismatch**: The `JWT_SECRET` in docker-compose is `super-secret-jwt-token-with-at-least-32-characters-long`. The anon key in `env.docker.template` was generated against the previous JWT secret. If we change the JWT secret in the migration, all anon keys must be regenerated, or the app will fail to authenticate.
6. **Single-PR risk**: 10,742 insertions in one PR is genuinely unreviewable. Even if the user insists on "un único PR", at least flag this loudly and recommend splitting for review even if it means two PRs land on the same day.
7. **Realtime `localChangesRef` dedup bug**: After fix lands, there's still a subtle bug where `subscribeToTables` returns the existing channel but drops the new callback, meaning one of `WaiterView` or `TableGrid` won't receive updates. This is a separate fix.
8. **TypeScript debt**: 484 pre-existing TS errors on `p6c-legacy-cleanup` (from apply-progress.md). The build is failing. Pre-existing, not introduced by these changes, but it'll show up in CI on the PR.

---

## Open Questions (for the user / orchestrator)

1. **"un único PR" — is this a hard requirement or a preference?** If it's a
   hard requirement, the answer is "yes, technically, but the realtime fix
   has to land first or the symptom won't be fixed." If it's a preference,
   "two PRs (realtime fix, then everything else) is faster and safer."
2. **DB data — keep or reset?** The current DB has 5 profiles and 6 tables
   of test data. A `supabase db reset` will wipe this. The user must decide.
3. **Docker pull — does the user have network access on this machine?** The
   `supabase/postgres` image is required for the fix; without network the
   fix can't land.
4. **Should the uncommitted docker-compose.yml change (gotrue image swap)
   be committed or discarded?** It's currently uncommitted and would NOT
   ship in any PR. Likely experimental from a sandbox.

---

## Ready for Proposal

**Partially Yes.**

The investigation is complete and the bug is root-caused with evidence.
Before drafting a proposal, the orchestrator should ask the user:

1. **"un único PR" — hard or soft?** (See Open Questions #1)
2. **"¿OK si pierdo los datos actuales de la base de datos local?"** (See Open Questions #2)
3. **"¿Tienes acceso a internet para hacer `docker pull`?"** (See Open Questions #3)
4. **"¿Qué hago con el cambio sin commitear en `docker-compose.yml` (imagen `vipe-gotrue-patched`)?"** (See Open Questions #4)

Once those four answers are in, `sdd-propose` can write a concrete
proposal that:
- Names the exact docker image swap
- Names the exact init.sql to create
- Names the exact shim migration to apply
- Names the exact verification recipe (2-browser-tab test)
- Names whether this lands as 1 or 2 PRs

---

## Evidence Appendix (raw commands run)

```
git branch -a
git log --oneline --all --graph -30
git log --oneline main..sdd/revision-completa-sistema/p{1,2-rls-auth,3,4,5,6a,6b,6c}-* --no-merges
git diff main...sdd/revision-completa-sistema/p6c-legacy-cleanup --shortstat
git diff main...sdd/revision-completa-sistema/p6c-legacy-cleanup --stat | tail -5
git status
git remote -v
gh pr list -s all -L 30
gh pr view --json title,state,baseRefName (returns "no pull requests found")

docker ps --format "table {{.Names}}\t{{.Status}}"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM pg_publication WHERE pubname='supabase_realtime'"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles'"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM pg_policies WHERE tablename='tables'"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT version FROM public.schema_migrations ORDER BY version"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT nspname FROM pg_namespace"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT extname FROM pg_extension"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM pg_replication_slots"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT name FROM pg_available_extensions WHERE name IN ('supabase_realtime','wal2json','pgoutput','pg_cdc_rls')"
docker exec supabase-db psql -U postgres -d postgres -c "SHOW wal_level"
docker exec supabase-db psql -U postgres -d postgres -c "\d public.tenants"
docker exec supabase-db psql -U postgres -d postgres -c "SELECT * FROM public.tenants LIMIT 1"
docker exec supabase-db psql -U postgres -d postgres -c "CREATE PUBLICATION supabase_realtime;"   # warning about wal_level
docker exec supabase-db psql -U postgres -d postgres -c "DROP PUBLICATION supabase_realtime;"     # cleaned up
docker logs supabase-realtime --tail 100 2>&1 | grep -iE 'error|exception|fail|schema|tenant|connect'
docker inspect supabase-db --format '{{.Config.Image}}'   # = postgis/postgis:16-3.4
curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" "http://localhost:54321/realtime/v1/websocket" --max-time 5
```