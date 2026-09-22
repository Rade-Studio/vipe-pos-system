# Apply Progress: optimizar-arquitectura-realtime

## Slice S1 — Acute flicker fix (A-1, A-2, A-6)

**Status**: S1.1–S1.7 complete. S1.8's automated portion (lint/typecheck/build) complete; its manual two-tab recipe is pending human verification and was NOT executed by this agent (no running app or browser in this environment).

### Commits

- `6ca74c8` — `fix(realtime): patch table state in place instead of remounting/refetching` — branch `sdd/optimizar-arquitectura-realtime/s1-flicker-fix`. Not pushed, no PR opened (delivery is the user's decision per the phase instructions).

### Completed Tasks

- [x] S1.1 — Created `lib/realtime/table-merge.ts` exporting `TableRow`, `TableChange`, `toTable`, `mergeTableList`, `toTimestamp`. Pure module, only `import type { Table } from "@/types"`. Implements all 11 D10 behaviour-table rows; every no-op row returns the identical `prev` reference (verified by code inspection — no unit test exists yet, ST introduces the runner).
- [x] S1.2 — `toTable` carries `updated_at` mapped as `row.updated_at ? new Date(row.updated_at) : undefined`, with the required `// D4: makes the out-of-order guard live for the first time — see design.md` comment directly above the mapping line.
- [x] S1.3 — Reviewer-notice sentence included in the commit message (see commit `6ca74c8` body).
- [x] S1.4 — Deleted the local `mergeTable` function body in `TableGrid.tsx` (including the `as unknown as string` cast) and replaced the call site with `mergeTableList(prev, payload as unknown as TableChange)` imported from `lib/realtime/table-merge.ts`. `TableGrid`'s local `useState` for `tables` is untouched (S3 removes it).
- [x] S1.5 — Removed `key={\`tables-section-${activeTable ?? 'none'}\`}}` from `<TablesSection>` in `WaiterView.tsx`. No replacement key added.
- [x] S1.6 — Replaced `queryClient.invalidateQueries({ queryKey: ['tables'] })` in the `subscribeToTables` handler with a `setTables((prevTables) => { const merged = mergeTableList(prevTables, payload as unknown as TableChange); if (merged !== prevTables) useTableStore.getState().setTables(merged); return merged })` call, writing into the same dual-write locations the hydration effect already used (component-local `tables` state + `useTableStore` mirror). Ownership model unchanged — `applyTableChange` is not introduced (S3 scope).
- [x] S1.7 — Replaced `console.log`/`console.error` in `fetchTables` with `log.info`/`log.error` from the newly added `import { log } from "@/lib/log"`.
- [~] S1.8 — Automated portion done (see Verification below). Manual two-tab recipe NOT executed — see "Pending Human Verification" below.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `lib/realtime/table-merge.ts` | Created | Pure merge module: `TableRow`, `TableChange`, `toTimestamp`, `toTable`, `mergeTableList`. All 11 D10 rows. |
| `components/pos/TableGrid.tsx` | Modified | Deleted local `mergeTable` (incl. the `as unknown as string` cast); now calls `mergeTableList`/`toTable` from the shared module. Removed the now-unused `RealtimePostgresChangesPayload` import. |
| `components/views/WaiterView.tsx` | Modified | Removed the selection-keyed `key` on `<TablesSection>`; replaced the `tables`-topic `invalidateQueries` with a direct `mergeTableList` patch into the existing dual-write locations; replaced `console.log`/`console.error` with `lib/log.ts`'s `log.info`/`log.error`; added the `mergeTableList`/`TableChange`/`log` imports. |
| `openspec/changes/optimizar-arquitectura-realtime/tasks.md` | Modified | S1.1–S1.7 marked `[x]`. S1.8's manual-recipe checkbox left unticked. |

### Deviations from Design

None — implementation matches design D3, D4, D10 exactly. `toTable`'s field mapping required two `as` casts (`row.number as number`, `row.status as Table["status"]`) not spelled out verbatim in design.md's interface sketch, because `TableRow`'s fields are nullable while `Table`'s corresponding fields are not; this keeps the type-narrowing local to `toTable` rather than reintroducing a scattered cast at call sites, consistent with design's stated intent for the module's `as` usage.

### Out-of-scope findings (recorded, not fixed)

None found while working the S1 file set. All findings and follow-ups noted for other slices are already captured in design.md's Open Questions and were not touched here (`realtime-service.ts`, `TableManagementPanel.tsx`, `useTableStore.ts`, `TablesSection.tsx`, `KitchenView`/`CashierView`/`AdminView`, `CompletedOrdersTable`, `app/page.tsx`, `supabase/**` — all explicitly out of scope for S1 and left untouched).

## Verification (all commands actually run, with observed results)

1. **Baseline `tsc --noEmit`** (before any edit, on HEAD `ecce6e8`):
   `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0**
   (Note: the ~484-error baseline cited in tasks.md/spec.md/design.md is stale for this checkout — the measured baseline on this branch's HEAD is 0. Reporting the measured figure per the phase instructions, not the stale document figure.)

2. **`npm run lint`**: exits 0. Warning count unchanged before/after: **104** warnings both with the stash applied and with it reverted (verified via `git stash` / `git stash pop` around the lint run). No new warning appears in `lib/realtime/table-merge.ts`, `components/pos/TableGrid.tsx`, or `components/views/WaiterView.tsx` on any line this slice touched. Clean/unchanged from baseline — PASS.

3. **`tsc --noEmit` delta**: after all S1 edits, `grep -c "error TS"` → **0**. Delta = 0 − 0 = **0** (≤ 0 required) — PASS.

4. **`npm run build`**: exit 0. Static generation completed (`✓ Generating static pages (2/2)`) — PASS.

5. **Grep invariants** (all run after the edits, all returned zero matches as required):
   - `grep -n "as unknown as string" components/pos/TableGrid.tsx` → no matches (exit 1) — PASS
   - `grep -n 'tables-section-${activeTable' components/views/WaiterView.tsx` → no matches (exit 1) — PASS
   - `grep -n "invalidateQueries({ queryKey: \['tables'\]" components/views/WaiterView.tsx` → no matches (exit 1) — PASS
   - `grep -nE "console\.(log|warn|error)" components/views/WaiterView.tsx` → no matches (exit 1) — PASS

## Pending Human Verification (cannot be executed by this agent)

Task **S1.8**'s two-tab manual recipe was NOT run — there is no running app and no browser in this environment. The user must run it manually:

1. Start the dev server (`npm run dev`) and open the Waiter view in two browser tabs, tab A and tab B, both logged in as a waiter.
2. **Flicker/patch check**: in tab A, flip a table's status (reserve/release, or complete an order that frees the table). In tab B, confirm the affected table's card updates to the new status WITHOUT a skeleton repaint and WITHOUT the grid blanking.
3. **Remount check**: in tab A, click a table to select it (and click again to deselect it). Confirm the table grid does not remount or flash/reset scroll position on selection change.
4. Report back whether both checks pass; if either fails, it is a genuine regression against this slice's intent (A-1/A-2) and should be raised before proceeding to S2/ST.

## Engram Persistence

`mem_save` was attempted once with `topic_key: "sdd/optimizar-arquitectura-realtime/apply-progress"`, `type: "architecture"`, `project: "vipe-pos-system"`. Result: **engram_write: pending** — per the known environment failure noted in the launch instructions (`multiple active runtime sessions match the current project and directory`), this was not retried. The orchestrator is expected to mirror this file via the `engram` CLI.

## Next Steps

- Slice S1 is code-complete and committed. Remaining before archive/next-slice: the human two-tab manual recipe above (S1.8).
- Next slice per `tasks.md`'s dependency order: S2 (channel lifecycle) — independent of S1, can proceed in parallel/next.
