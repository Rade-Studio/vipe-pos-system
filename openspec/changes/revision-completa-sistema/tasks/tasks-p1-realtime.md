# Tasks: P1 — Realtime Publication & Skeleton

## Phase Goal
Enable Supabase WAL replication for `tables`, `orders`, `order_items`; replace per-event full reload with client-side merge; eliminate UI flicker on realtime refetch; ensure clean subscription teardown.

## PR Slice Recommendation
- **One PR** (P1). Estimated ~130 changed lines, well under the 400-line budget.
- **Branch base**: `main` per `stacked-to-main`. PR branch: `sdd/revision-completa-sistema/p1-realtime`.

## Tasks

### T1-01 — Enable supabase_realtime publication + REPLICA IDENTITY FULL
- **description**: Create the migration that adds `tables`, `orders`, `order_items` to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` on each so `OLD` payloads carry every column. Without this, the Supabase Realtime worker never reads WAL entries for these tables, regardless of how cleanly the client subscribes. This is the root-cause fix for the user's reported "mesas no se reflejan" symptom.
- **touches**: [`supabase/migrations/20250917090000_enable_realtime_publication.sql`]
- **command**: `docker compose exec db psql -U postgres -d postgres -c "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';"` → lists `tables`, `orders`, `order_items`.
- **acceptance_criteria**: [a] migration applies idempotently under `supabase db reset`; [b] `pg_publication_tables` lists the three tables; [c] `pg_class.relreplident = 'f'` for each table.
- **depends_on**: []
- **size_lines_estimate**: ~15 lines
- **commit_split_hint**: Single commit: `feat(realtime): enable supabase_realtime publication for tables/orders/order_items`.
- **spec_refs**: R1-01 / S1-01, S1-03.

### T1-02 — Per-channel unsubscribe + stable role-scoped channel names
- **description**: Refactor `lib/supabase/realtime-service.ts` so `subscribeToTables`, `subscribeToOrders`, and `subscribeToKitchen` use stable channel names with a role suffix (no `channelCounter` race) and each returns a per-channel unsubscribe function. Also rewrite `subscribeToPosEvents` so its broadcast listeners are tracked in a `Record<string, Function>` and removable individually. Fixes HS-16 (channel race/leak) and HS-38 (broadcast no-unsubscribe).
- **touches**: [`lib/supabase/realtime-service.ts`]
- **command**: `pnpm tsc --noEmit` (exit 0) + unit-style check: subscribe → call returned unsubscribe → confirm `supabase.removeChannel` invoked (assert via `removeChannel` spy).
- **acceptance_criteria**: [a] every `subscribeTo*` returns an unsubscribe function; [b] `unsubscribeAll()` is NOT called by individual unsubscribers; [c] channel name pattern `${topic}-${role}-${ts}` is stable per role.
- **depends_on**: []
- **size_lines_estimate**: ~50 lines
- **commit_split_hint**: Single commit: `refactor(realtime): stable channel names + per-channel unsubscribe`.
- **spec_refs**: R1-04 / S1-07, S1-08.

### T1-03 — Replace `loadTables()` in `TableGrid.tsx` with merge-on-payload
- **description**: In `components/pos/TableGrid.tsx`, replace the per-event `await loadTables()` call with a `setTables(prev => mergeTable(prev, payload))` patch. Add a `mergeTable()` helper keyed by row.id: INSERT appends, UPDATE replaces if `incoming.updated_at > existing.updated_at`, DELETE removes by id. No `from("tables").select()` call on a realtime event.
- **touches**: [`components/pos/TableGrid.tsx`]
- **command**: DevTools Network tab on a non-admin role: trigger `UPDATE tables SET status='occupied' WHERE id=5` → zero `from("tables").select()` calls on the WS frame.
- **acceptance_criteria**: [a] no full reload on event; [b] merge keeps existing array order; [c] DELETE event removes by id.
- **depends_on**: [T1-02]
- **size_lines_estimate**: ~30 lines
- **commit_split_hint**: Single commit: `feat(realtime): merge-on-payload in TableGrid, no full reload`.
- **spec_refs**: R1-02 / S1-04, S1-05.

### T1-04 — First-sync skeleton gate to prevent flicker
- **description**: Distinguish "first load" (skeleton OK) from "realtime refetch" (never blank). Add an `initialLoadDone` boolean state set true after the first successful payload merge. Render the skeleton ONLY when `!initialLoadDone && loading`. Fixes HS-23.
- **touches**: [`components/pos/TableGrid.tsx`]
- **command**: Visual: with 12 visible table cards, fire UPDATE on one card from a second tab → grid stays visible, only the affected card's status changes.
- **acceptance_criteria**: [a] skeleton appears only on the very first mount; [b] subsequent events never blank the grid.
- **depends_on**: [T1-03]
- **size_lines_estimate**: ~15 lines
- **commit_split_hint**: Bundle with T1-03 to keep the diff reviewable as one behavior change.
- **spec_refs**: R1-03 / S1-06.

### T1-05 — Phase verification smoke harness
- **description**: Add `pnpm verify:p1` script that runs (1) `docker compose exec db psql -c "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'"` and (2) `pnpm tsc --noEmit`. Writes a manual two-tab browser test recipe to `docs/realtime-sync-test.md`.
- **touches**: [`package.json`, `docs/realtime-sync-test.md`]
- **command**: `pnpm verify:p1`.
- **acceptance_criteria**: [a] psql command lists the three tables; [b] tsc exits 0; [c] `docs/realtime-sync-test.md` documents the manual two-tab test.
- **depends_on**: [T1-01, T1-02, T1-03, T1-04]
- **size_lines_estimate**: ~20 lines
- **commit_split_hint**: Single commit: `chore(verify): add p1 smoke harness`.
- **spec_refs**: R1-01, R1-02, R1-03, R1-04.

## Verification (apply agent will run)
```
docker compose down -v && docker compose up -d
supabase db reset
pnpm docker:dev:seed
pnpm verify:p1
# Manual: docs/realtime-sync-test.md (two browser tabs, <500ms sync)
```

## Known environmental failures
- `pnpm docker:dev:seed` may fail with FK to `auth.users` if the `realtime` container is not yet healthy. Run `docker compose ps` first; wait until `realtime` shows `(healthy)`.
- `next.config.mjs` still has `ignoreBuildErrors: true` until P4; `pnpm build` will not catch TS errors here. P1 verification uses `tsc --noEmit` directly.

## Rollback Plan
1. `git revert <merge-sha>` — reverts the migration and TS edits atomically.
2. Surgical: `ALTER PUBLICATION supabase_realtime DROP TABLE public.tables, public.orders, public.order_items;` and `git checkout HEAD~1 -- components/pos/TableGrid.tsx lib/supabase/realtime-service.ts`.

## Out-of-phase items
- `payload.new.waiter_name` stale-closure issue (resolved in P6 via React Query refetch).
- Hard-coded fallback URL in `lib/supabase/client.ts` (resolved in P2).
- `types/models.ts` enum drift between `models.ts` and `index.ts` (resolved in P6).
