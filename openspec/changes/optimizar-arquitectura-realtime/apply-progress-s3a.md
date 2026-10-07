# S3a — Single owner (ownership half of slice S3)

`useTableStore` becomes the single owner of table state. This is the first of two PRs that slice S3 was split into; S3b carries the admin-panel half.

## Completed

- **S3.1** `applyTableChange` added to `store/useTableStore.ts` per design D1. Every other store member is unchanged — that is the point of choosing O1 over O2.
- **S3.2** `store/useTableStore.test.ts` (new, 2 tests): a no-op change leaves `tables` reference-identical; an UPDATE replaces exactly one element and preserves every other element reference.
- **S3.3** `components/pos/TableGrid.tsx` reads from the store. Its local `useState`, its self-fetch effect, its `loading`/`initialLoadDone` state and its skeleton branch are all deleted — the last three were necessary, because leaving them would have stranded the grid permanently on its skeleton once the effect that cleared them was gone.
- **S3.4** `components/views/WaiterView.tsx` routes realtime through `applyTableChange`. Its local `tables` state, the mirror effect, and nine redundant echo-writes are gone.
- **S3.7** `components/pos/TablesSection.tsx` dead `tables` prop and `searchTerm`/`filterStatus`/`filteredTables` removed. One collateral line in `components/views/KitchenView.tsx` drops its now-invalid `tables={tables}` prop pass; without it `tsc` fails. `KitchenView` is otherwise untouched and remains S4 scope.

## Two correctness fixes a mechanical implementation would have missed

**`tables.sort(...)` became `[...tables].sort(...)`.** `tables` is now the store's own shared array reference, and `Array.prototype.sort` mutates its receiver — sorting in place would have corrupted shared state for every consumer on every render. Caught by inspection, not by a failing test; recorded as a coverage gap.

**The `TableGrid` double-fetch is eliminated, not relocated.** Its data-loading effect had dependency array `[initialLoadDone]` while the effect itself set `initialLoadDone(true)`, so `tableService.getAll()` and `realtimeService.subscribeToTables()` each ran twice per mount. The effect is deleted outright: the final file contains no `tableService`, no `realtimeService`, and no `useEffect` at all.

## F1 remount invariant — strengthened, not weakened

`components/pos/TableGrid.test.tsx` was rewritten because the component's data source changed underneath it. Before, it mocked `tableService`/`realtimeService` and proved the invariant against a self-fetching component. Now it seeds the store directly, renders synchronously, and asserts stable DOM identity across two selection toggles — plus a third test that applies a real `applyTableChange` UPDATE and asserts the grid still does not remount. That third path was structurally unreachable before, because the old stub made `subscribeToTables` a no-op.

## Verification

- `npx tsc --noEmit` → 0 errors, delta 0.
- `npm test` → **24/24 passing** on this branch alone, with none of S3b present: `table-merge.test.ts` 19, `TableGrid.test.tsx` 3, `useTableStore.test.ts` 2.
- `npm run lint` → exit 0.
- `npm run build` → exit 0.
- `grep -n "useState<Table\[\]>" components/views/WaiterView.tsx components/pos/TableGrid.tsx` → zero matches.
- `grep -n "filteredTables\|searchTerm\|filterStatus" components/pos/TablesSection.tsx` → zero matches.

That this branch is independently green is the evidence the split is real rather than cosmetic.

## Pending human verification

Two browser tabs plus the admin panel, per the S3.8 recipe: confirm a table change propagates to every open view without a skeleton repaint and without the grid blanking. No automated test in this PR exercises multi-client delivery.
