# S3b — Admin panel (panel half of slice S3)

Second of two PRs that slice S3 was split into. S3a made `useTableStore` the single owner of table state; this PR stops `TableManagementPanel` reloading the whole table list on every realtime event.

The panel stays deliberately outside the single-owner model. It holds raw database rows (`useState<any[]>`) and renders `table.waiter_id` and `table.updated_at` — column names the mapped `Table` shape does not carry. Migrating it onto the shared shape looks like the clean move and would break the admin screen. Design D9 records this as a deliberate residue, and it is also what makes the S3a/S3b seam clean.

## Completed

- **S3.5** `mergeRowList<T extends { id: string }>` and the `RowChange` type added to `lib/realtime/table-merge.ts`: the raw-row sibling of `mergeTableList`, sharing the same D10 event dispatch, the same `updated_at` out-of-order guard, and the same reference-identity-on-no-op contract, but performing no field mapping. 8 new unit tests.
- **S3.6** `components/admin/tables/TableManagementPanel.tsx`'s realtime handler merges instead of calling `await loadTables()`, which flipped `setLoading(true)` on every event. The loading indicator is no longer driven by realtime traffic.

## A regression this slice introduced, caught in review and fixed here

The first implementation merged the raw payload row directly. That was wrong, and the reason is worth recording because the same trap will recur.

Before this slice, the panel's realtime handler called `await loadTables()`, a full refetch carrying the `profiles(id, full_name)` join. The panel renders `table.profiles?.full_name`. A `postgres_changes` payload never carries a joined relation, so merging the raw row replaced an enriched row with an unenriched one and the waiter's name vanished from the admin cards until a page reload.

That refetch was not only reloading stale data — it was what kept the join alive. Removing it is what introduced the loss. This is a regression this slice created, not an inherited tradeoff: `toTable` has always dropped `waiter_name` on realtime payloads because `tables` has no such column, but the panel never went through `toTable`.

**Fix: a targeted per-row refetch.** On INSERT and UPDATE the handler reads the row id from the payload, calls `tableService.getById(id)` — which already selects the same join and derives `waiter_name`, so no new service code was needed — and merges that enriched row. DELETE needs no fetch, since `payload.old.id` is enough. `setLoading` is never called on this path; not calling it is the entire point of the slice. If `getById` fails, the handler logs and falls back to merging the raw payload row, because a row missing its waiter name beats a dropped event.

**Why a naive `{ ...existing, ...newRow }` spread was rejected.** It preserves `profiles` and costs no round trip, but when `waiter_id` changes it keeps the *previous* waiter's `profiles`, so the panel would confidently display the wrong person's name. A blank name is honest; a wrong name on an administration screen is a data bug.

`mergeRowList`'s doc comment was rewritten to match: it no longer describes the join loss as an unavoidable known limitation, because it is not one for its only consumer. It now states that the function performs no enrichment by design and that a caller holding joined data is responsible for supplying an enriched row.

## New test

`components/admin/tables/TableManagementPanel.test.tsx` captures the realtime callback, fires a raw UPDATE payload carrying only `waiter_id` and no `profiles`, then asserts that `getById` was called with that id, that the new waiter's enriched name appears, that the old name is gone, and that the DOM root's identity never changed — which proves `loading` was never toggled, since a toggle would swap the spinner subtree for the card subtree.

Writing it surfaced a reusable jsdom gotcha: a `useToast` mock returning a fresh function identity on every render gave the `[toast]`-dependent effect a new dependency each render, looping `setLoading(true)` indefinitely. Hoisting a stable mock reference fixed it.

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npm test` → **33/33 passing**, 4 files: `table-merge.test.ts` 27, `TableGrid.test.tsx` 3, `useTableStore.test.ts` 2, `TableManagementPanel.test.tsx` 1.
- `npm run lint` → exit 0, 101 warnings (down from 104 at the ST tip; S3a's dead-code deletion removed three, none added).
- `npm run build` → exit 0.
- `grep -n "await loadTables()" components/admin/tables/TableManagementPanel.tsx` → zero matches in the realtime handler.

## Pending human verification

1. The S3.8 recipe: Waiter, Admin, and the table-management panel open at once; a table change propagates to all three without a skeleton repaint or the grid blanking.
2. **The check that proves this PR specifically:** with the admin panel open, have another client reassign a table's waiter. The card must show the *new* waiter's name without a page reload and without the loading spinner appearing.
