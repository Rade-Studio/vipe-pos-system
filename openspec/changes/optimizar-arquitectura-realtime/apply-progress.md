# Apply Progress: optimizar-arquitectura-realtime

## Slice S1 — Acute flicker fix (A-1, A-2, A-6)

**Status**: S1.1–S1.7 complete, including two post-commit fixes from orchestrator review (see "Orchestrator Review Fixes" below). S1.8's automated portion (lint/typecheck/build) complete and re-verified after the fixes; its manual two-tab recipe is pending human verification and was NOT executed by this agent (no running app or browser in this environment).

### Commits

- `6ca74c8` — `fix(realtime): patch table state in place instead of remounting/refetching` — branch `sdd/optimizar-arquitectura-realtime/s1-flicker-fix`.
- `7b30746` — `docs(sdd): record S1 apply progress and tick S1.3`.
- `efb941b` — `fix(realtime): hydrate updated_at and purify the tables setState updater` — orchestrator-review fixes, see "Orchestrator Review Fixes" below.

Not pushed, no PR opened (delivery is the user's decision per the phase instructions).

### Completed Tasks

- [x] S1.1 — Created `lib/realtime/table-merge.ts` exporting `TableRow`, `TableChange`, `toTable`, `mergeTableList`, `toTimestamp`. Pure module, only `import type { Table } from "@/types"`. Implements all 11 D10 behaviour-table rows; every no-op row returns the identical `prev` reference (verified by code inspection — no unit test exists yet, ST introduces the runner).
- [x] S1.2 — `toTable` carries `updated_at` mapped as `row.updated_at ? new Date(row.updated_at) : undefined`, with the required `// D4: makes the out-of-order guard live for the first time — see design.md` comment directly above the mapping line.
- [x] S1.3 — Reviewer-notice sentence included in the commit message (see commit `6ca74c8` body).
- [x] S1.4 — Deleted the local `mergeTable` function body in `TableGrid.tsx` (including the `as unknown as string` cast) and replaced the call site with `mergeTableList(prev, payload as unknown as TableChange)` imported from `lib/realtime/table-merge.ts`. `TableGrid`'s local `useState` for `tables` is untouched (S3 removes it).
- [x] S1.5 — Removed `key={\`tables-section-${activeTable ?? 'none'}\`}}` from `<TablesSection>` in `WaiterView.tsx`. No replacement key added.
- [x] S1.6 — Replaced `queryClient.invalidateQueries({ queryKey: ['tables'] })` in the `subscribeToTables` handler with `setTables((prevTables) => mergeTableList(prevTables, payload as unknown as TableChange))`, a pure updater (revised post-review, see "Orchestrator Review Fixes" below). The store mirror lives in a dedicated `useEffect` keyed on `tables`, so the dual write (component-local `tables` state + `useTableStore` mirror) is still exactly what S1.6 originally specified — only *where* the store write happens changed. Ownership model unchanged — `applyTableChange` is not introduced (S3 scope).
- [x] S1.7 — Replaced `console.log`/`console.error` in `fetchTables` with `log.info`/`log.error` from the newly added `import { log } from "@/lib/log"`.
- [~] S1.8 — Automated portion done (see Verification below). Manual two-tab recipe NOT executed — see "Pending Human Verification" below.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `lib/realtime/table-merge.ts` | Created | Pure merge module: `TableRow`, `TableChange`, `toTimestamp`, `toTable`, `mergeTableList`. All 11 D10 rows. |
| `components/pos/TableGrid.tsx` | Modified | Deleted local `mergeTable` (incl. the `as unknown as string` cast); now calls `mergeTableList`/`toTable` from the shared module. Removed the now-unused `RealtimePostgresChangesPayload` import. |
| `components/views/WaiterView.tsx` | Modified | Removed the selection-keyed `key` on `<TablesSection>`; replaced the `tables`-topic `invalidateQueries` with a direct `mergeTableList` patch into the existing dual-write locations; replaced `console.log`/`console.error` with `lib/log.ts`'s `log.info`/`log.error`; added the `mergeTableList`/`TableChange`/`log` imports. |
| `openspec/changes/optimizar-arquitectura-realtime/tasks.md` | Modified | S1.1–S1.7 marked `[x]`. S1.8's manual-recipe checkbox left unticked. |

## Orchestrator Review Fixes

The orchestrator independently reviewed the S1 diff after the initial commit (`6ca74c8`) and confirmed the tsc baseline, the four grep invariants, and the commits were sound, but found two real defects, both fixed in commit `efb941b`.

### Finding 1 — the D4 out-of-order guard was still inert for hydrated rows

`toTable` correctly carries `updated_at` for realtime payloads (S1.2), but neither hydration mapper did:

- `components/views/WaiterView.tsx`'s `fetchTables` returned only `id, number, status, waiter, waiter_name`.
- `components/pos/TableGrid.tsx`'s `loadTables` (`formattedTables`) had the same five fields.

Consequence: immediately after any load, every row's `updated_at` was `undefined`, so `toTimestamp(existing.updated_at)` was `0` for every row until that specific row received its first realtime UPDATE. A genuinely out-of-order/stale event arriving before that first UPDATE would still pass `incoming >= 0` and overwrite fresher data — the guard D4 claims this slice makes live was only live for a subset of rows, not all of them, right after any hydration.

**Fix**: both mappers now include `updated_at: table.updated_at ? new Date(table.updated_at) : undefined`, normalized identically to `toTable`, with the same `// D4: ...` comment. `tableService.getAll()` already `select("*, ...")`s the `tables` row, so `updated_at` was present on the wire and simply dropped by both mappers — no data-layer change needed.

### Finding 2 — a side effect inside a React state updater

The original S1.6 implementation wrote to `useTableStore` from inside the `setTables` updater passed to the realtime handler:

```ts
setTables((prevTables) => {
  const merged = mergeTableList(prevTables, payload as unknown as TableChange)
  if (merged !== prevTables) {
    useTableStore.getState().setTables(merged)
  }
  return merged
})
```

A `setState` updater must be pure. React 19 double-invokes updaters under StrictMode in development specifically to surface impurity, and a Zustand `set()` synchronously notifies subscribers — five other components subscribe to this store (`KitchenView`, `CashierView`, `AdminView`, `CompletedOrdersTable`, `app/page.tsx`) — so this could push a store update into React's render phase and risk "Cannot update a component while rendering a different component."

**Fix**: the updater is now pure — `setTables((prevTables) => mergeTableList(prevTables, payload as unknown as TableChange))` — with no side effect. A new dedicated `useEffect` in `WaiterView.tsx`, keyed on `[tables]`, is the single place that mirrors the local `tables` copy into `useTableStore`:

```ts
useEffect(() => {
  useTableStore.getState().setTables(tables)
}, [tables])
```

The now-redundant `useTableStore.getState().setTables(tablesData)` call inside the hydration effect was removed, so there is exactly one mirror site covering both hydration and every realtime patch. The dual-write model itself (local `useState` + store mirror) is unchanged — S1.6's original intent survives, only the mechanism moved from inside the updater to an effect. Comment added explaining why the mirror lives in the effect.

### Re-verification (all commands re-run after both fixes)

1. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0** (unchanged from the 0 baseline).
2. `npm run lint` → exit 0; warning count → **104** (unchanged).
3. `npm run build` → exit 0; static generation completed.
4. Grep invariants, all still zero matches:
   - `grep -n "as unknown as string" components/pos/TableGrid.tsx` → none
   - `grep -n 'tables-section-${activeTable' components/views/WaiterView.tsx` → none
   - `grep -n "invalidateQueries({ queryKey: \['tables'\]" components/views/WaiterView.tsx` → none
   - `grep -nE "console\.(log|warn|error)" components/views/WaiterView.tsx` → none

### Deviations from Design

None — implementation matches design D3, D4, D10 exactly. `toTable`'s field mapping required two `as` casts (`row.number as number`, `row.status as Table["status"]`) not spelled out verbatim in design.md's interface sketch, because `TableRow`'s fields are nullable while `Table`'s corresponding fields are not; this keeps the type-narrowing local to `toTable` rather than reintroducing a scattered cast at call sites, consistent with design's stated intent for the module's `as` usage.

### Out-of-scope findings (recorded, not fixed)

None found while working the S1 file set. All findings and follow-ups noted for other slices are already captured in design.md's Open Questions and were not touched here (`realtime-service.ts`, `TableManagementPanel.tsx`, `useTableStore.ts`, `TablesSection.tsx`, `KitchenView`/`CashierView`/`AdminView`, `CompletedOrdersTable`, `app/page.tsx`, `supabase/**` — all explicitly out of scope for S1 and left untouched).

## Verification — initial run, before orchestrator review (all commands actually run, with observed results)

Superseded in part by "Orchestrator Review Fixes" → "Re-verification" above, which re-ran all four checks after the two findings were fixed. Kept here for the historical record of the pre-review commit `6ca74c8`.

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
