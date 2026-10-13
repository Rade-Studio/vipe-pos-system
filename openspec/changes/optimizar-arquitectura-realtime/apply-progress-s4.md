# S4 — Fan-out containment (B-8)

Applies design D6: narrow the *projection* consumers read from `useTableStore`, not add an equality function to the existing full-array selector (`useShallow((s) => s.tables)` compares element references and accomplishes nothing once `applyTableChange` patches in place). Every site touched by this slice was reclassified against its current, actual usage — several line-number citations in `tasks.md`/`design.md` had drifted since they were written (pre-S3/S3a/S3b), and one pre-classification (`CashierView.tsx:676, 815` as "handler-only") turned out to be wrong for current code. This document records the real classification, the real line numbers, and why each deviation was made.

## Site → Rule classification table

### `components/views/AdminView.tsx`

| Site (current line) | Actual usage | Rule | Why |
|---|---|---|---|
| `:127` `const tables = useTableStore((s) => s.tables)` (old) | fed all sites below | — | replaced by two narrowed `useShallow` selectors (see S4.4 diff) |
| `:559-571` four status counts (`available`/`reserved`/`kitchen`/`served`) | render path, "Resumen" tab | **B** | combined into one `tableStatusCounts` object via a single `useShallow`, matching design's literal example |
| `:586` per-waiter assigned-table count | render path, "Resumen" tab, inside `profiles.map` | **B** | `assignedTableCountByWaiter: Record<waiterId, number>`, a primitive-valued map via `useShallow`, per design's explicit "primitives or a primitive-valued map" wording |
| `:642` `<TabsContent value="tables">` | **not a `tables` read at all.** Renders `<TableManagementPanel />`, which owns its own raw-row state (D9, S3b) | **N/A** | design's original citation of this line as "Mesas tab full render, Rule C" predates S3b, which moved the panel onto its own self-contained data source. There is nothing to classify here now — corrected, not silently dropped. |
| `:752` (was `:726` pre-S3-drift) `tables.find((t) => t.id === order.tableId)`, feeding `<OrderCard table={table} .../>` in the "Órdenes Activas" tab | render path, but **not enumerated by design or tasks.md at all** — found by the mandated full-file search | **A-variant** | `OrderCard` (`components/pos/OrderCard.tsx`, out of scope for this slice) requires a full `Table` object and reads only `.number` from it, so Rule B's primitive-map mechanism can't be applied without either touching the out-of-scope consumer or fabricating a fake object cast `as Table` (rejected — a type lie that would mislead a future reader of `OrderCard`). Since the only field consumed (`table.number`) never changes after a table is created, a non-reactive `useTableStore.getState().getTableById(order.tableId)` read at the point of use is safe and correct, even though this site is technically inside JSX render rather than an event handler. Documented as a deviation from Rule A's literal "handler-only" wording, applying the same underlying mechanism (no subscription, fresh read at the point of use) for the same underlying reason (staleness is immaterial for this field). |

### `components/views/CashierView.tsx`

| Site (current line) | Actual usage | Rule | Why |
|---|---|---|---|
| `:123` `const tables = useTableStore((s) => s.tables)` (old) | fed all sites below | — | replaced by one `tableNumberById: Record<string, number>` `useShallow` selector, reused by both render sites |
| `:420` (was `:411`) inside `showInvoice(orderId)` | **dead code** — this handler is defined but never called anywhere in the file (confirmed via repo-wide grep; `PaymentMethodDialog.tsx`'s same-named `showInvoice` is an unrelated local `useState`) | **A** | genuinely handler-shaped (only runs on-demand, never during render); classified and fixed on its structural shape regardless of current dead-code status, since a future caller would inherit the correct pattern |
| `:686` (was cited as `:676`) `tables.find((t) => t.id === order.tableId)`, only `table?.number` used in JSX (`Mesa {table?.number} - Orden Parcial`) | **render path, not a handler** — `tasks.md`'s pre-classification of this line as "handler-only" is wrong for current code; caught by re-classifying against actual usage instead of trusting the stale label | **B** | only a primitive (`.number`) is displayed, directly in JSX, with no out-of-scope consumer — narrows cleanly to `tableNumberById[order.tableId]` |
| `:825` (was cited as `:815`) `tables.find((t) => t.id === tableId)`, only `table?.number` used (`Mesa {table?.number}`) | **render path**, same misclassification as above | **B** | same as above — `tableNumberById[tableId]` |

### `components/views/KitchenView.tsx`

| Site (current line) | Actual usage | Rule | Why |
|---|---|---|---|
| `:89` `const tables = useTableStore((s) => s.tables)` | feeds the table-filter dropdown at `:912-913` (lists every non-available table, sorted, as filter menu items) *and* the render-path lookups at `:601` (filter-by-table comparison) and `:998` (per-order `<OrderCard table={table} .../>`, same out-of-scope-consumer situation as AdminView's `:752`) | **C** (unchanged, kept intentionally at all three sites) | the filter dropdown genuinely needs every non-available table's `id`/`status`/`number` reactively — a legitimate Rule C need, matching the explicit instruction to leave this site alone. Because this one Rule C subscription already exists in the component, `KitchenView` re-renders on every table write regardless of anything else done here — narrowing `:601`/`:998` to a primitive projection would add a `useShallow` map with **zero** additional re-render reduction, so it was not done. This is a considered decision, documented here, not an oversight. |
| `:299, :406, :428` (previously cited as `:288, :394, :415`) inside `handleOrderUpdate`'s new-order/new-item branches, showing a toast with `table?.number` | genuine realtime-event handlers (async functions invoked from `subscribeToOrders`'s callback, never during render) | **A** | converted to `useTableStore.getState().getTableById(storeOrder.tableId)` — decouples these three handler reads from the Rule C subscription above, so they read fresh state at call time regardless of when `KitchenView` last rendered, independent of whether the Rule C dependency is ever narrowed later |
| `:912-913` filter-by-table dropdown (design's stale citation: `:899`) | render path, genuinely lists every non-available table | **C** (unchanged, per explicit instruction) | not the "Mesas" `TabsContent` tab itself (that is `:1018`, see below) — it is a separate filter-menu UI rendered in the "Órdenes" toolbar. Corrected the citation: design's "899, 1007" conflated this dropdown with the actual Mesas tab. |
| `:1018` `<TabsContent value="tables">` → `<TablesSection>` → `<TableGrid>` | **not a `tables` read in this file** — `TableGrid` subscribes to the store independently (S3) | **N/A** | design's "1007" citation predates S3's ownership move; nothing to classify here now, same situation as `AdminView.tsx:642` |

### `app/page.tsx`

| Site | Rule | Action |
|---|---|---|
| `:30` `const { setTables } = useTableStore()` | selectorless — widest blast-radius subscription in the codebase | fixed → `const setTables = useTableStore((s) => s.setTables)` (S4.6) |
| `:31` `const { loadCurrentRegister, loadAllRegisters } = useCashRegisterStore()` | selectorless, same pattern | **left unchanged** — out of scope. B-8 authorizes `useTableStore` only (S4.7 decision). |
| `:34` `const { loadConfigFromDB } = useConfigStore()` | selectorless, same pattern | **left unchanged** — out of scope, same reason (S4.7 decision). |

## S4.7 — explicit scope decision

Decision: **leave `useCashRegisterStore()` and `useConfigStore()` unchanged** at `app/page.tsx:31` and `:34`. Both share `:30`'s exact selectorless-destructure pattern and would benefit from the identical fix, but B-8's authorized scope (this spec requirement, this design decision) is `useTableStore` only. Fixing them here would be scope creep into stores this slice was never asked to touch, verify, or reason about the blast radius of. Recorded explicitly per the phase instructions rather than silently fixed or silently skipped.

## Deviations from `tasks.md`'s pre-classification (found by re-classifying against actual code, not stale line numbers)

1. **`AdminView.tsx:642`** and **`KitchenView.tsx:1018`** (design's stale "1007" citation) are not `tables` reads at all anymore — both "Mesas" tabs now delegate to self-contained components (`TableManagementPanel` since S3b's D9; `TableGrid` since S3's D1). Nothing to narrow or leave as Rule C there; the real Rule C site in Kitchen is the filter dropdown at `:912-913` (design's "899" citation), which does still read `tables` directly.
2. **`CashierView.tsx:676, 815`** (task's line numbers; now `:686, :825`) were pre-classified in `tasks.md` as "handler-only reads" for Rule A. They are not — both are inside `.map()` render callbacks producing JSX (`Mesa {table?.number}`), never inside an event handler. Reclassified as Rule B and narrowed to a shared `tableNumberById` primitive map instead of `useTableStore.getState()`.
3. **`AdminView.tsx:752`** (new — not enumerated by design or `tasks.md`) — found via the mandated full-file search for additional sites. Passes a full `Table` object into `OrderCard` (out of scope, `components/pos/*`), so Rule B doesn't cleanly apply; classified as an Rule-A-mechanism variant, documented above.
4. **`KitchenView.tsx:601, :998`** were not pre-classified individually (`tasks.md` only asked to classify `:89-93`). Both share the file's necessary Rule C dependency (the filter dropdown), so narrowing them individually would not reduce any actual re-renders — documented as a considered "no additional narrowing" decision, not a skip.

## S4.8 — fan-out test and empirical "does it bite" check

New file: `components/views/table-fanout.test.tsx`. Two `describe` blocks:

- **Rule A** — renders the real `CompletedOrdersTable` (a paid order for table `t-1`, via `React.Profiler` render-count probe). Asserts a table patch (even for the exact table the visible order references) causes **zero** additional renders, then clicks "Factura" and asserts the invoice dialog resolves the correct table number via the `getState()`/`getTableById` lookup — proving Rule A is "no subscription, fresh read on demand," not "no subscription, no data."
- **Rule B** — a local harness component mirroring `AdminView`'s exact `tableStatusCounts` pattern (`useTableStore(useShallow((s) => ({ available: ..., reserved: ... })))`). Asserts a waiter-only patch (status unchanged) causes zero re-renders, and a status-changing patch causes exactly one re-render with updated counts.

**Empirical "the test bites" check (done, not committed):**

1. Temporarily reverted `CompletedOrdersTable.tsx` to its pre-S4.2 shape (`const tables = useTableStore((s) => s.tables)` + `tables.find(...)` in the handler). Re-ran `components/views/table-fanout.test.tsx`: the Rule A assertion failed — `expected 7 to be 5` (render count jumped by 2 instead of staying flat) — proving the test does detect the regression. Restored the file from a pre-edit copy and re-ran the full suite (35/35 green) to confirm the restore was exact.
2. Temporarily changed the Rule B harness's selector (inside the test file only) from the narrowed `useShallow((s) => ({ available, reserved }))` object to `useShallow((s) => s.tables)` feeding an inline count computation — i.e., exactly the documented trap ("wrapping the full array accomplishes nothing"). Re-ran the test: it failed — `expected 2 to be 1` — on the waiter-only patch that should have been suppressed. Reverted the harness to the narrowed selector and re-ran the full suite (35/35 green).

Both reverts were local, temporary, and never committed — confirmed via `git diff --stat` showing only the intended final state before committing.

## Verification

- **Baseline (before any S4 edit):** `npx tsc --noEmit` → 0 errors. `npm test` → 33/33 (4 files).
- `npm run lint` → exit 0, **101 warnings** (unchanged from the S3b baseline).
- `npx tsc --noEmit` → **0 errors** (delta 0).
- `npm run build` → exit 0. (Note: `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` are set project-wide, so a green build does not by itself imply a clean typecheck — both were verified independently above.)
- `npm test` → **35/35 passing**, 5 files (33 pre-existing + 2 new in `table-fanout.test.tsx`).
- `grep -n "useShallow" components/views/AdminView.tsx` → present only at the two narrowed-projection selectors (`tableStatusCounts`, `assignedTableCountByWaiter`), never wrapping `(s) => s.tables`.
- `grep -n "const { setTables } = useTableStore()" app/page.tsx` → zero matches.
- `git diff --name-only 4dfb6b2..HEAD` (working tree, pre-commit) → `app/page.tsx`, `components/admin/CompletedOrdersTable.tsx`, `components/views/AdminView.tsx`, `components/views/CashierView.tsx`, `components/views/KitchenView.tsx` — all within the authorized scope boundary. (`.atl/*` cache files also show modified but are pre-existing, unrelated tooling state present before this slice started — not staged or committed by this slice.)

## Line footprint

`git diff --stat` against the S3b tip (`4dfb6b2`), production files only: **76 lines** (44 insertions + net changes across `AdminView.tsx`, `CashierView.tsx`, `KitchenView.tsx`, `CompletedOrdersTable.tsx`, `app/page.tsx`). Plus the new test file: **171 lines**, entirely additions. **Total: 247 authored lines**, against the ~180-line forecast and the 400-line review budget — under budget, no `size:exception` needed. The overage versus the forecast is the new test file's thoroughness (two full scenarios plus the module-mock boilerplate needed to render a real view component in jsdom), not scope creep in production code.

## Pending — S4.9's manual recipe (not verifiable by this agent)

S4.9's automated checks (lint, tsc, build, `npm test`) all pass, recorded above. Its manual half — **not run, not simulated, not ticked**:

1. Start the dev server, open four browser tabs: Kitchen, Cashier, Admin, Waiter, each signed in with an appropriate role.
2. In Waiter, change one table's status (e.g. seat a walk-in or mark a table available).
3. In Kitchen: confirm the "Mesas" tab (if open) still updates that table's card (Rule C, expected), and confirm the "Órdenes" tab's filter dropdown and order cards are unaffected in a way that causes visible flicker.
4. In Cashier: confirm no visible re-paint of unrelated partial-order or per-table cards; the changed table's own card (if visible in an open order list) should update.
5. In Admin: confirm the "Resumen" tab's status counts and per-waiter counts update correctly and promptly; confirm the "Órdenes Activas" tab's cards are not blanked/flickered.
6. Repeat with a rapid sequence of 2-3 table changes to check there's no accumulated staleness in the Rule A `getState()` reads (expected to be fine, since they resolve fresh on every call, but unverified live).

A render-count probe in jsdom (S4.8) proves the selector narrowing suppresses re-renders in isolation. It does not prove four real screens behave correctly under live multi-client Supabase Realtime traffic — that requires this manual recipe.

## Status

S4.1–S4.8: **done**, all automated checks green. S4.9: automated half done (folded into the checks above); manual half pending human verification per the steps listed. `engram_write: pending` (see below).
