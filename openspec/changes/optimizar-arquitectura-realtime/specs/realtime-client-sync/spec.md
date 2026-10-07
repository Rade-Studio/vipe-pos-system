# Realtime Client Sync Specification

## Purpose

Define how table state is owned, updated, and rendered on the client when a `postgres_changes` event arrives. A single module owns table state; realtime events patch that state in place from the payload the event already carries; selection and navigation state never forces a render subtree to remount; and store writes reach only the consumers whose own data actually changed.

This is a NEW capability. `openspec/specs/` is currently empty because the prior change `investigar-mesa-sync-realtime` is unarchived, so there is no root spec to write a delta against.

## Supersession Notice

This spec **reverses one clause** and **extends the scope** of two requirements carried in the unarchived change `investigar-mesa-sync-realtime`. Because that change has not been archived, these requirements are not yet root specs and no delta mechanism captures the reversal automatically — it is recorded here explicitly so a future reader does not re-implement the reversed behavior from the older document.

- **`openspec/changes/investigar-mesa-sync-realtime/specs/p6-state-cleanup.md`, Requirement R6-02, Scenario R6-02-S2 ("Realtime event invalidates query cache") is REVERSED.** That scenario required: `GIVEN useQuery(['tables']) has loaded tables into cache` / `WHEN a postgres_changes UPDATE event fires for tables` / `THEN queryClient.invalidateQueries({ queryKey: ['tables'] }) is called`. This clause is the direct cause of finding F2 in `exploration.md`: it mandates discarding the row the event already delivered and re-fetching the entire collection instead. It is replaced by this spec's **Requirement: Realtime Table Events Patch State In Place**, below. The rest of R6-02 (React Query as the server-state source for the initial fetch; no `useEffect(() => loadX())` for initial loads) is unaffected and still stands.
- **`openspec/changes/investigar-mesa-sync-realtime/specs/p1-realtime.md`, Requirement R1-02 ("Realtime Subscription Uses Merge, Not Full Reload") is EXTENDED.** R1-02 as written covers only `TableGrid.tsx`. This spec's **Requirement: Realtime Table Events Patch State In Place** carries the same "merge, not reload" principle to every table consumer in the application (`WaiterView`, `AdminView` including `TableManagementPanel`, `KitchenView`, `CashierView`, `CompletedOrdersTable`), not `TableGrid` alone.

If `investigar-mesa-sync-realtime` is archived after this change lands, these two requirements should be reconciled as genuine deltas against the promoted root specs at that time.

## Requirements

### Requirement: Single Owner For Table State

Exactly one module in the application MUST own the canonical in-memory table collection. Every component that renders or reads table state MUST read from that one owner, directly or through a selector over it. No second, independently-fetched copy of the table collection may be kept alive as `useState` and fed by a `postgres_changes` handler.

This requirement is owner-agnostic: it does not name the module. The concrete choice of owner (for example, a Zustand store patched in place from the realtime payload, or a React Query cache updated via `setQueryData`) is a design-phase decision recorded in `design.md`, not a spec-phase decision.

#### Scenario: Exactly one table-state container exists

- GIVEN the full set of realtime-relevant view components (`WaiterView`, `AdminView`, `KitchenView`, `CashierView`, `CompletedOrdersTable`, `TableManagementPanel`) after this change is applied
- WHEN a `postgres_changes` event for `public.tables` fires
- THEN exactly one state container in the codebase receives and applies that event
- AND a code search for `useState<Table[]>` (or an equivalent typed table-array `useState`) fed by a realtime handler returns zero matches outside the designated owner

#### Scenario: Consumers read through the owner, not a private copy

- GIVEN any view component that renders table cards, a table list, or a table-derived count
- WHEN that component is inspected for its data source
- THEN it reads table data from the single owner (directly or via a selector/hook over it)
- AND it does not maintain its own independently-fetched `tables` array used for rendering

### Requirement: Realtime Table Events Patch State In Place

(Reverses: `p6-state-cleanup.md` R6-02-S2. Extends: `p1-realtime.md` R1-02 to every table consumer, not `TableGrid` alone.)

A `postgres_changes` handler for `public.tables` (and, where applicable, for `public.orders` insofar as it affects a table's derived status) MUST apply the event's `payload.new` directly to the single owner's state. No `postgres_changes` handler for `public.tables` may call `queryClient.invalidateQueries` or trigger an equivalent full re-fetch of the table collection in response to a realtime event.

This obligation applies to every table consumer, not only `TableGrid`: `WaiterView`, `AdminView`'s `TableManagementPanel`, `KitchenView`, and `CashierView` must each apply the payload in place rather than reloading.

#### Scenario: Update event patches one row without a re-fetch

- GIVEN the owner holds a table collection including `table2` with `status: 'free'`
- WHEN a `postgres_changes` UPDATE event arrives for `table2` with `payload.new = { id: table2.id, status: 'occupied' }`
- THEN the owner's state reflects `table2` with `status: 'occupied'` and every other table unchanged
- AND no `tableService.getAll()` (or equivalent full-collection fetch) call is issued as a result of that event

#### Scenario: Zero invalidateQueries calls inside a postgres_changes handler

- GIVEN the full set of `postgres_changes` event handlers for `public.tables` across the codebase, after this change is applied
- WHEN each handler's body is inspected
- THEN none of them calls `queryClient.invalidateQueries`
- AND a `grep` for `invalidateQueries` within a `postgres_changes` handler body returns zero matches

#### Scenario: TableManagementPanel merges instead of reloading

- GIVEN `TableManagementPanel` is mounted and subscribed to table events
- WHEN a `postgres_changes` event for `public.tables` arrives
- THEN `TableManagementPanel` applies the payload to the owner in place
- AND `TableManagementPanel` does not call its full `loadTables()` reload path in response to that event, and its loading indicator is not toggled by that event

### Requirement: Selection State Must Not Force A Grid Remount

No React component subtree that renders table state may be keyed, directly or indirectly, on selection state (for example, the currently active/selected table). A change to which table is selected MUST NOT cause the table grid or its ancestor subtree to unmount and remount.

#### Scenario: Selecting a table does not remount the grid

- GIVEN `WaiterView` is rendering a table grid with an active-table selection of `null`
- WHEN the user selects a table, changing the active-table selection
- THEN the table grid subtree is not unmounted and remounted
- AND no loading/skeleton state is shown as a result of the selection change

#### Scenario: A remote update that changes selection does not remount the grid

- GIVEN a table is currently selected in `WaiterView` and a remote client marks that same table as free (for example, by completing payment on it)
- WHEN `WaiterView` reacts to that remote event by clearing the active-table selection
- THEN clearing the selection does not unmount or remount the table grid subtree
- AND the grid remains visible throughout, showing the affected card's new state without a skeleton repaint

### Requirement: Store Writes Must Not Fan Out To Unaffected Consumers

A write to the single owner's table state MUST NOT cause a consumer whose own selected/derived data did not change to re-render. Patching a single row in place MUST NOT be implemented by replacing the entire collection with a new array/object reference in a way that defeats reference-equality checks in downstream consumers.

#### Scenario: An unrelated view does not re-render on a table change

- GIVEN `KitchenView`, `CashierView`, `AdminView`, and `CompletedOrdersTable` each select table-derived data from the single owner
- WHEN a table's status changes in `WaiterView` and the owner applies that patch
- THEN a view whose selected/derived data did not change as a result of that patch does not re-render its tables-derived UI
- AND only the view(s) whose derived data actually changed re-render

#### Scenario: A realtime update repaints only the affected card

- GIVEN a table grid is visible on Waiter, Admin, Kitchen, or Cashier with multiple cards rendered
- WHEN a `postgres_changes` UPDATE event arrives for one table
- THEN only the card corresponding to that table re-renders with its new state
- AND the grid remains visible throughout with no skeleton repaint, on all four screens

### Requirement: Dead Table-Filter State Is Removed

`TablesSection` MUST NOT accept a `tables` prop or compute derived filter state (`filteredTables`, `searchTerm`, `filterStatus`) that it never renders and never forwards to `TableGrid`.

#### Scenario: No unused tables prop or filter state remains

- GIVEN `TablesSection`'s implementation after this change
- WHEN its props and internal state are inspected
- THEN it does not declare a `tables` prop
- AND it does not compute `filteredTables`, `searchTerm`, or `filterStatus` values that are never rendered or forwarded

### Requirement: Structured Logging In WaiterView

`WaiterView` MUST use `lib/log.ts` for all logging. It MUST NOT call `console.log`, `console.warn`, or `console.error` directly.

#### Scenario: No bare console calls in WaiterView

- GIVEN `components/views/WaiterView.tsx` after this change
- WHEN `grep -n "console\.(log|warn|error)" components/views/WaiterView.tsx` is run
- THEN zero matches are returned
- AND `WaiterView.tsx` imports `log` from `lib/log.ts`

## Verification Notes

These scenarios are verified by the mechanisms actually available in this repository at the time each slice ships:

- Slices S1, S2, and S4 (no test runner yet, or scenarios describing render/remount behavior): verified by `npm run lint`, `npx tsc --noEmit` (delta against the ~484-error pre-existing baseline, never a clean-zero claim), `npm run build`, a `grep`-able code invariant (for example, absence of `invalidateQueries` inside a handler, absence of a selection-derived `key`, absence of `console.*`), and the documented two-tab manual recipe.
- From slice ST onward, pure logic extracted by this change (the shared table-merge function, and the owner's patch/reducer function once the design phase names it) SHOULD have unit test coverage under the newly introduced Vitest runner. No scenario in this spec assumes a test suite exists before slice ST.
- No scenario in this spec asserts a measured performance number (e.g. a latency figure); "within 500 ms" style claims from the superseded `p1-realtime.md` are infrastructure-layer claims already verified by the prior change and are not re-asserted here.
