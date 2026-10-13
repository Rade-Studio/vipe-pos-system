# Design: optimizar-arquitectura-realtime

Technical design for the realtime client consolidation. Settles the B-7 ownership fork and specifies the modules, signatures, and slice order that `sdd-tasks` will break down.

- Change: `optimizar-arquitectura-realtime`
- Date: 2026-09-21
- Base branch: `sdd/revision-completa-sistema/p6c-legacy-cleanup`
- Inputs: `proposal.md` (authorized scope, A1 + A2 + C-12), `exploration.md` (findings F1–F9)
- Artifact store: hybrid

## Evidence Basis and Honesty Boundaries

Every file:line citation below was read from disk during this phase. Nothing was reproduced at runtime — there is no running app, no database, and no test runner in this environment, so no claim here is a measurement. Statements about current behaviour are read from source; statements about the effect of a change are predictions to be confirmed by the manual recipe in `proposal.md`.

Library APIs were verified against what is actually installed, not from memory. `package.json` pins `zustand`, `@tanstack/react-query`, and `immer` to `"latest"`, so the declared versions carry no information and the installed tree is the only authority:

| Package | Declared | Installed (verified) | Source of truth |
|---|---|---|---|
| `zustand` | `latest` | **5.0.15** | `node_modules/zustand/package.json:6` |
| `@tanstack/react-query` | `latest` | **5.103.1** | `node_modules/@tanstack/react-query/package.json:3` |
| `react` | `^19` | **19.0.0** | pnpm store path `react@19.0.0` |

Two API facts this design depends on, both verified against the installed source rather than asserted:

1. `useShallow` is exported from `zustand/react/shallow` with signature `useShallow<S, U>(selector: (state: S) => U): (state: S) => U` (`node_modules/zustand/react/shallow.d.ts:1`). The subpath resolves through the wildcard `"./*"` entry in the package `exports` map (`node_modules/zustand/package.json:43-56`). The Zustand v4 `useStore(selector, equalityFn)` two-argument overload does **not** exist in 5.0.15; `useShallow` is the replacement.
2. Zustand skips listener notification when a `set` updater returns the identical state object: `if (!Object.is(nextState, state))` (`node_modules/zustand/esm/vanilla.mjs:6`). Returning `state` unchanged from an updater produces **zero** re-renders. The existing store already relies on this (`store/useTableStore.ts:61, 74, 96`).

Items that could not be verified statically are marked **[confirm at apply]** inline rather than stated as fact.

## Technical Approach

One sentence: **a `postgres_changes` payload is applied to exactly one owner by one pure function, and consumers subscribe to the narrowest projection they actually render.**

Three mechanisms carry that:

1. **One pure merge function** (`lib/realtime/table-merge.ts`, slice S1) that turns a payload plus the previous list into the next list, returning the *identical* previous array reference whenever nothing changed. Reference stability is the load-bearing property — it is what lets Zustand's `Object.is` check and React's bailout suppress the re-render.
2. **One owner** for table state (`useTableStore`, decision D1 below), reached through a thin `applyTableChange` action that delegates to the merge function and preserves state identity on no-ops.
3. **One channel per topic**, callbacks in a `Set`, with any per-event enrichment performed once in the shared handler before fan-out.

Nothing under `supabase/` is created, edited, or deleted. This change is entirely client-side TypeScript.

## Architecture Decisions

### D1 — Table state owner: `useTableStore` (Option O1)

**Choice**: `useTableStore` (Zustand) is the single owner of table state. React Query's `['tables']` query is **demoted to hydration and fallback refresh** — it is not deleted. Realtime events call a new `applyTableChange(change)` store action that patches one row in place. `TableGrid` stops self-fetching and reads from the store.

**Alternatives considered**: Option O2 — React Query `['tables']` becomes the source of truth, realtime events call `queryClient.setQueryData(['tables'], patch)`, and the Zustand table slice is deleted.

**Rationale**: I re-derived the call-site inventory rather than accepting the proposal's count. `grep` finds **27 call-site lines across 7 files** (plus the definition at `store/useTableStore.ts:19`). `WaiterView` alone holds the eleven the proposal cited — `components/views/WaiterView.tsx:5, 216, 384, 432, 455, 504, 556, 624, 838, 877, 921` — of which line 5 is the import and the other ten are `getState()` mutator calls. The full surface:

| Kind | Sites | Locations |
|---|---|---|
| Read-only `(s) => s.tables` | 4 | `KitchenView.tsx:89`, `CashierView.tsx:123`, `AdminView.tsx:127`, `CompletedOrdersTable.tsx:29` |
| Mutator invocations | 16 | `WaiterView.tsx:216, 384, 432, 455, 504, 556, 624, 838, 877, 921`; `KitchenView.tsx:454, 680, 743, 788, 789`; `app/page.tsx:30` |
| Mutator/helper bindings | 7 | `AdminView.tsx:128-130`; `KitchenView.tsx:90-93` |

Blast radius alone would be a weak argument — "there is more of it" is not a reason to keep a worse design. Three findings from this phase make O2 actively wrong for this codebase, and none of them were in the proposal:

**(a) O2 cannot actually delete the slice.** `activeTable` and `setActiveTable` are store state (`store/useTableStore.ts:6, 41`) and `KitchenView` consumes them (`KitchenView.tsx:93`, invoked at `:789`). Selection state is client state, not server state, and has no home in a React Query cache. O2 would not remove the Zustand table slice; it would **split** it into a surviving selection slice plus a query cache, leaving two owners where the whole point of B-7 is to have one. That inverts O2's central claim. (`WaiterView` separately keeps its own local `activeTable` at `WaiterView.tsx:63` — an independent duplication, out of scope here, recorded under *Open Questions*.)

**(b) The mutators are optimistic write-through echoes, and they carry re-render suppression O2 would discard.** The pattern at `WaiterView.tsx:378-391` is: mark the change local → `await tableService.releaseTable(tableId)` → echo into the store → echo into local state. Each of the 16 mutator invocations would become a `queryClient.setQueryData(['tables'], updater)` call under O2, with the cache shape written inline at each site. More costly than the count suggests: `releaseTable`, `updateTableStatus`, and `assignWaiterToTable` each return `state` unchanged when the write is a no-op (`store/useTableStore.ts:60-62, 73-75, 95-97`), and per the verified `Object.is` check that means **zero re-renders**. That is exactly the anti-re-render machinery this change exists to strengthen. O2 throws it away and would have to reimplement it at every call site, because `setQueryData` has no equivalent built-in short-circuit.

**(c) React Query is already not a single cache in the adjacent domain.** The three `subscribeToOrders` consumers invalidate three different keys with three different projections: `['tables']`/`['orders']` (`WaiterView.tsx:240, 264`), `['orders', 'cashier']` (`CashierView.tsx:238`), `['orders', 'admin']` (`AdminView.tsx:217`). O2's "one cache, aligned with R6-02" argument describes an alignment the codebase does not have.

Against O1, honestly: it couples `TableGrid` to global state, and it partially walks back the P6b direction. The first is accepted — `TableGrid` is already the only table consumer that does *not* read the store, and that asymmetry is a cause of the three-copy problem, not a virtue. The second is addressed directly by the proposal's spec note: R6-02's "invalidate on realtime events" clause is the direct cause of F2 and is being reversed deliberately. R6-02's other clauses — React Query as the server-state source for the *initial* fetch, no `useEffect(() => loadX())` — are **preserved** by O1, because O1 keeps the query for hydration.

**Consequence recorded**: O1 keeps `useQuery(['tables'])` alive as the hydration and refresh path. That is what makes D2 cheap.

### D2 — F9 (30 s polling fallback): out of scope as authorized, but its cost under O1 is ~3 lines, not a hand-rolled follow-up

The proposal states that O1 "makes the F9 polling fallback a hand-rolled follow-up rather than a one-line query option". **That framing is incorrect, and the correction matters for the fork.** It assumes O1 deletes the query. O1 demotes it; the `useQuery(['tables'])` at `WaiterView.tsx:159-162` survives as the hydration path, so it can still carry query options.

Verified client defaults (`lib/queryClient.ts:3-11`):

| Option | Configured | Effect on F9 |
|---|---|---|
| `staleTime` | `30_000` | Already the R1 window, but `staleTime` only marks data stale — it never schedules a fetch. |
| `refetchOnWindowFocus` | `false` | Explicitly disabled. Tab focus does **not** self-heal. |
| `retry` | `2` | Unrelated. |
| `refetchOnReconnect` | not set → library default `true` | A browser offline→online transition **already** refetches `['tables']` today. |

So the residual gap is narrower than F9 states: reconnect recovery already exists; what is missing is recovery from a **silent websocket death without a network transition**. Under O1 the fix is to add `refetchInterval: 30_000` to the surviving hydration query and let its existing effect pipe the result into the store. That is roughly three lines in one place.

It is also nearly free at runtime: a poll that finds nothing new reaches `setTables`, whose equality short-circuit (`store/useTableStore.ts:23-39`) returns without calling `set`, producing zero re-renders. One caveat to carry forward — that short-circuit compares only `id`, `status`, and `waiter`; a poll whose only delta is `waiter_name` or `updated_at` would be silently dropped. Under O1's `applyTableChange` model the realtime path no longer depends on `setTables`, so this affects the polling path alone.

**Decision**: F9 stays **out of scope** for this change, as authorized. It is not urgent enough to reopen the fork, and it does not pull toward O2 — the cost differential between O1 (~3 lines) and O2 (~1 line) is immaterial. Recommended as a follow-up, or as an optional addendum to slice S3 at the orchestrator's discretion. Recording the honest number replaces the proposal's bare deferral.

### D3 — Merge module is pure, reference-stable, and owns normalization

**Choice**: a single pure module `lib/realtime/table-merge.ts` exporting a row normalizer and a list merger. No imports of the Supabase client, the store, `lib/log`, or React. The only import is a type-only `import type { Table } from "@/types"`.

**Alternatives considered**: (a) leave `mergeTable` inside `TableGrid` and duplicate it in `WaiterView` — rejected, it is the duplication the change exists to remove; (b) put the merge inside the store as a private helper — rejected, it must be unit-testable before slice ST introduces the runner and before S3 introduces the store action; (c) make it a method on `realtimeService` — rejected, that couples the pure logic to a module that imports the Supabase client, which would drag a network client into every unit test.

**Rationale**: this is the only unit-testable surface that exists before slice ST, it is the surface S3's reducer composes with, and purity is what makes reference stability provable. `lib/realtime/` is a new directory consistent with the existing flat `lib/{domain}/` convention (`lib/supabase/`, `lib/print/`).

### D4 — The extracted merge fixes an inert ordering guard (a deliberate behaviour change, not a pure move)

`proposal.md` records S1's extraction as a "pure move, identical semantics". **It is not, and the design corrects it.**

The current `mergeTable` compares `updated_at` to reject out-of-order events (`TableGrid.tsx:118-121`) but constructs the merged row **without** `updated_at` (`TableGrid.tsx:109-115`). `Table.updated_at` is optional (`types/index.ts:39`), and `WaiterView.fetchTables` does not map it either (`WaiterView.tsx:108-114`). Therefore `existingTime` is `0` for every row after the first merge, `incomingTime >= 0` is always true, and **the out-of-order guard never rejects anything today.** The `as unknown as string` cast at `TableGrid.tsx:120` is the fingerprint of the type mismatch that hid this.

The extracted module carries `updated_at` onto the normalized row, which makes the guard live for the first time. Confirmed the field exists on the wire: `TableManagementPanel` renders `table.updated_at` from raw rows (`TableManagementPanel.tsx:304-305`).

**Consequence**: the extraction changes observable behaviour — an out-of-order UPDATE that is applied today will be rejected after S1. That is the intended semantics and it is why the guard was written, but the S1 reviewer must be told it is a fix rather than a move, and the S1 risk line in `proposal.md` ("pure move, identical semantics") should be read as superseded by this decision.

### D5 — Unknown table id on UPDATE is dropped, not upserted

**Choice**: an UPDATE whose `id` is absent from the previous list returns the previous list **unchanged, by reference**.

**Alternatives considered**: upsert the unknown row, which would self-heal a client that missed the preceding INSERT during a websocket gap.

**Rationale**: `subscribeToTables` subscribes without a server-side filter (`realtime-service.ts:63-69`), so an upsert could not inject an out-of-scope row — the filter objection does not apply. It is rejected for a different reason: `prev` is empty during initial hydration, so an upsert would paint a one-card grid before the full list lands. That is precisely the partial-render defect class this change exists to eliminate, and it would be triggered by the same race the change is fixing. Self-healing from a missed INSERT is deferred to the reconnect refetch that already exists (D2) and, if adopted, to F9's poll. Recorded as the explicit trade-off: **D5 shifts self-healing onto D2.**

### D6 — Fan-out containment is achieved by narrowing the projection, not by adding an equality function

**Choice**: per-site strategy, classified by how each consumer actually uses `tables`. `useShallow` is applied only where the selector projects to a narrower value.

**Alternatives considered**: the proposal's B-8 shape — "narrowed selectors with shallow equality" applied uniformly at the four cited sites.

**Rationale**: wrapping the existing selector, `useTableStore(useShallow((s) => s.tables))`, **accomplishes nothing**. Shallow comparison of an array of objects compares element *references*; patch-in-place deliberately replaces exactly one element reference, so shallow equality reports "changed" and the consumer re-renders anyway. The re-render win comes from projecting to primitives (a count, a number, a lookup map of primitives) — `useShallow` is then what makes the freshly-allocated projection compare equal to the previous one. Applying `useShallow` without narrowing would ship the ceremony and none of the benefit, and would look correct in review.

Verified per-site usage drives three rules:

| Rule | When | Mechanism | Sites |
|---|---|---|---|
| **A — no subscription** | `tables` is read only inside an event handler | `useTableStore.getState().tables` / `getTableById(id)` at the point of use; drop the hook binding | `CompletedOrdersTable.tsx:133` (inside `handlePrintInvoice`); `CashierView.tsx:411, 676, 815`; `AdminView.tsx` handler reads **[confirm at apply — classify each site as handler vs. render before choosing a rule]** |
| **B — narrowed projection** | render path needs a derived primitive, not the rows | `useTableStore(useShallow(selector))` returning primitives or a primitive-valued map | `AdminView.tsx:559-571` (four status counts → one `{available, reserved, kitchen, served}` object); `AdminView.tsx:586` (per-waiter assigned count) |
| **C — full array, accepted** | render path genuinely renders every row | keep `(s) => s.tables`; the re-render is correct | `KitchenView.tsx:899, 1007` (Mesas tab); `AdminView.tsx:642` (Mesas tab) |

Rule C is not a concession. With patch-in-place, a table change re-renders the list that displays that table — which is the desired behaviour, not the defect. The defect was that a change to *one* table re-rendered *every* consumer because the whole array was replaced.

**Additional site not enumerated in the proposal**: `app/page.tsx:30` does `const { setTables } = useTableStore()` with **no selector**, which subscribes the root page component to *every* store change, including every `tables` write. Fix: `useTableStore((s) => s.setTables)`. Adding this to B-8's scope; it is one line and it is the widest-blast-radius subscription in the codebase.

### D7 — Shared `orders-changes` channel performs the `order_items` fetch once, before fan-out

**Choice**: mirror the `subscribeToTables` registry shape exactly — `Map` keyed by topic, callbacks in a `Set`, teardown when the set empties. The `order_items` enrichment moves **into the shared channel handler, before the fan-out loop**, so one event produces one `SELECT` and N callback invocations.

**Alternatives considered**: keep the fetch per-callback (would preserve the N+1 the change is removing); move the fetch into each consumer (would push a network call into three view components and re-create the amplification).

**Rationale**: the amplification is structural. Today `supabase.channel("orders-changes")` is called on **every** invocation (`realtime-service.ts:182-183`), so three mounted callers mean three channels, three deliveries per event, and three `SELECT * FROM order_items` round trips (`realtime-service.ts:197-200`). Per the exploration's F4 correction, **no callback is dropped** — each teardown closes over its own `channel` (`realtime-service.ts:231`) — so this is purely duplication, not data loss. `realtimeService.channels["orders"]` is stale bookkeeping: a second caller overwrites the first's slot (`:226`) and the first caller's `delete` (`:232`) removes a slot that no longer refers to it. Verified that nothing outside `realtime-service.ts` reads that slot, so the `Map` replaces it outright.

Two consequences this design must state, because they are real behaviour changes hidden inside a refactor:

1. **All N callbacks now receive the same payload object reference.** Today each caller had its own. Contract: **callbacks MUST treat the payload as read-only** and derive new objects rather than mutate. Verified none of the three current callbacks mutate — they read `payload.new`/`payload.old` and call `invalidateQueries` (`WaiterView.tsx:257-264`, `CashierView.tsx:235-238`, `AdminView.tsx:212-217`). B-9 replaces those with payload application, which is exactly where a mutation could be introduced, so the contract must reach `sdd-tasks`.
2. **A failed `order_items` fetch now affects all callers, not one.** Today the handler `return`s without invoking the callback when the select errors (`realtime-service.ts:202-204`) — the event is silently swallowed for that one caller. Under a shared channel that swallows it for all three. Design response: on fetch error, log via `lib/log` and **still fan out**, leaving `order_items` undefined rather than setting it to `[]`. Consumers must treat "`order_items` absent" as *unknown — do not overwrite the current items*, and never as *the order has no items*. Setting `[]` would render a paid order as empty. This deliberately replaces today's silent swallow, which is not safe to amplify threefold.

### D8 — Broadcast senders acquire a channel without touching the listener registry

**Choice**: extract the channel-acquisition half of `subscribeToPosEvents` into a module-private helper `getBroadcastChannel(channelKey)`. `subscribeToPosEvents` calls it and then does its registry insert plus `channel.on(...)`. `sendFactura` and `sendCommand` call **only** it, then `.send(...)` on the returned reference.

**Alternatives considered**: give the senders a `subscribeToPosEvents` call followed by an immediate unsubscribe — rejected, because the returned unsubscribe does not remove the `.on()` binding (see below), so it would fix the registry growth and leave the real leak.

**Rationale**: the current leak is two-fold, and only one half is the registry. Each `sendFactura` / `sendCommand` call (`realtime-service.ts:139, 162`) runs `subscribeToPosEvents` with a fresh no-op, which (i) adds a permanent entry to the `Set` in `broadcastListenerRegistry` (`:102-109`) and (ii) attaches another live `channel.on("broadcast", ...)` handler (`:112-114`). The second is the one with a runtime cost: every subsequent broadcast on `room_bills` / `room_commands` invokes every accumulated no-op. Growth is per invoice printed and per kitchen ticket sent, across a whole shift, never released.

Returning the channel directly also removes a latent failure mode: today `realtimeService.channels[channelKey].send(...)` (`:146, 164`) depends on the side effect of the preceding call having populated the slot, and would throw on `undefined` if that ever stopped holding.

**Recorded, not fixed here** (outside A-5/B-10's authorized scope): `subscribeToPosEvents`'s returned unsubscribe deletes only the registry entry and never removes the `.on()` binding — its own comment says so (`realtime-service.ts:128-131`). Consequently the registry is bookkeeping that does not gate delivery, and an "unsubscribed" handler keeps firing. Worth a follow-up change; flagged so a reviewer of S2 does not mistake it for something S2 introduced.

**[confirm at apply]** Whether `channel.on(...)` registered after `channel.subscribe()` binds correctly in `@supabase/supabase-js` is not verifiable from this repository's source. It affects `subscribeToPosEvents` only, whose shape this change preserves, so it is not a blocker for D8 — but it is worth a look while S2 is open.

### D9 — `TableManagementPanel` merges at the raw-row level, not the `Table` level

**Choice**: A-4 gives the panel a row-level merge, not the app-level `mergeTableList`.

**Alternatives considered**: migrate the panel onto the `Table` shape and the shared store so it reuses the same merge.

**Rationale**: the panel holds **raw database rows**, not the mapped `Table` type — `useState<any[]>` fed directly from `tableService.getAll()` with no mapping step (`TableManagementPanel.tsx:18, 38-39`), and it renders `table.waiter_id` (`:285`) and `table.updated_at` (`:304-305`), fields that `Table` does not carry under those names. Feeding it `Table` objects would break its render. Migrating it onto the shared shape is a larger change than A-4 authorizes and would enlarge S3, already the riskiest slice.

Implementation: `lib/realtime/table-merge.ts` exports a generic row merger over `{ id }`-bearing records, and `mergeTableList` is the `Table`-typed specialization. The panel calls the raw variant. Both share the event-dispatch and reference-stability logic, so the three cases in D10 are implemented once.

**Consequence**: after this change there are two table representations in the app — the `Table` shape owned by the store, and the panel's raw rows. That is a real, acknowledged residue of B-7's "exactly one owner" goal, scoped to one admin panel that no other component reads. Recorded under *Open Questions* as a follow-up.

### D10 — Behaviour table for the merge (the contract `sdd-tasks` must carry into tests)

Every row returns the **identical `prev` reference** unless marked "new array".

| Event | Condition | Result |
|---|---|---|
| `INSERT` | `new.id` present, id not in `prev` | new array, row appended |
| `INSERT` | `new.id` present, id already in `prev` | `prev` (idempotent — protects against echo and StrictMode double-delivery) |
| `INSERT` | `new.id` missing/null | `prev` |
| `UPDATE` | `new.id` present, id in `prev`, incoming not older | new array, that one row replaced; all other element references preserved |
| `UPDATE` | `new.id` present, id in `prev`, incoming strictly older | `prev` (out-of-order rejection — live for the first time, see D4) |
| `UPDATE` | `new.id` present, id **not** in `prev` | `prev` (D5 — dropped, not upserted) |
| `UPDATE` | `new.id` missing/null | `prev` |
| `DELETE` | `old.id` present, id in `prev` | new array with that row filtered out |
| `DELETE` | `old.id` present, id **not** in `prev` | `prev` (no allocation, so no re-render) |
| `DELETE` | `old.id` missing/null | `prev` |
| any other `eventType` | — | `prev` |

Timestamp comparison: `toTimestamp(value)` returns `0` for `null`, `undefined`, and unparseable values, and the comparison is `incomingTs >= existingTs`. Both defaults matter: `0 >= 0` is true, so rows that carry no `updated_at` (every row today, per D4) keep applying, and an unparseable timestamp cannot produce `NaN >= NaN === false` and silently swallow a live event.

## Data Flow

Before — three copies, one full refetch per event, whole-array writes fanning out:

    postgres_changes ──┬─→ TableGrid.mergeTable ──→ local useState  (correct, isolated)
                       │
                       └─→ WaiterView handler ──→ invalidateQueries(['tables'])
                                                       │
                                                       ↓
                                              full tableService.getAll()
                                                       │
                                        ┌──────────────┴──────────────┐
                                        ↓                             ↓
                                 WaiterView useState          useTableStore.setTables
                                                                      │  (whole array replaced)
                                        ┌──────────────┬──────────────┼──────────────┐
                                        ↓              ↓              ↓              ↓
                                  KitchenView     CashierView     AdminView   CompletedOrdersTable
                                     :89             :123           :127            :29

After — one owner, one patched row, narrowed projections:

    postgres_changes
          │
          ↓
    realtimeService.subscribeToTables   (shared channel, already correct)
          │
          ↓
    useTableStore.applyTableChange(change)
          │
          ↓
    mergeTableList(prev, change)  ── pure, returns prev by reference on no-op
          │
          ├── unchanged ──→ set() skipped via Object.is ──→ ZERO re-renders
          │
          └── changed ────→ one row's reference replaced; all others preserved
                                        │
                ┌───────────────────────┼───────────────────────┐
                ↓                       ↓                       ↓
        Rule A: getState()      Rule B: useShallow      Rule C: (s) => s.tables
        (no subscription)       (primitive projection)   (renders every row)

Shared `orders-changes` channel — the single enrichment point (D7):

    postgres_changes on orders
          │
          ↓
    shared handler ──→ SELECT order_items WHERE order_id = ?   ← exactly once per event
          │                    │
          │                    └── on error: log, fan out with order_items undefined
          ↓
    entry.callbacks.forEach(cb => cb(payload))   ← same payload object, read-only contract
          │
          ├─→ WaiterView.tsx:255
          ├─→ CashierView.tsx:234
          └─→ AdminView.tsx:221

Broadcast path to the external printer process (required by `openspec/config.yaml` `rules.design` — flows crossing web ↔ Supabase ↔ POS printer listener):

    CashierView / InvoicePrintView        Supabase Realtime            pos/app.py (Windows)
              │                                  │                            │
              │  sendFactura(...)                │                            │
              ├─ getBroadcastChannel("room_bills")                            │
              │    └─ channel exists? reuse : create + subscribe              │
              │       (NO registry insert, NO .on() binding)   ← D8           │
              │                                  │                            │
              ├─ channel.send({broadcast, "new_invoice", payload}) ──────────→ │
              │                                  │                            │
              │                                  │ ──── broadcast fan-out ───→ ├─ print invoice
              │                                  │                            │
    WaiterView │  sendCommand(...)               │                            │
              ├─ getBroadcastChannel("room_commands")                         │
              ├─ channel.send({broadcast, "new_command", payload}) ──────────→ ├─ print ticket

    Invariant: the number of listeners on room_bills / room_commands is a function of how many
    components SUBSCRIBE, never of how many sends occur. Today it grows once per send (F6).
    The Python listener's contract is unchanged — same channels, same event names, same payloads.

## Interfaces / Contracts

### `lib/realtime/table-merge.ts` (new, slice S1)

```ts
import type { Table } from "@/types"

/** A `public.tables` row as it arrives inside a postgres_changes payload. */
export interface TableRow {
  id?: string | null
  number?: number | null
  status?: string | null
  waiter_id?: string | null
  waiter_name?: string | null
  updated_at?: string | null
}

/**
 * Structural shape of a postgres_changes payload.
 * Declared locally rather than importing `RealtimePostgresChangesPayload` so the
 * module stays free of runtime and type dependencies on the Supabase client, and
 * so the single `as` cast lives at the call site instead of being scattered.
 */
export interface TableChange {
  eventType: string
  new?: TableRow | null
  old?: TableRow | null
}

/** Normalizes a raw row to the app-level `Table`. Returns null when `id` is absent. */
export function toTable(row: TableRow): Table | null

/**
 * Applies `change` to `prev`.
 *
 * INVARIANT: returns the IDENTICAL `prev` reference whenever the change is a
 * no-op. This is what suppresses the re-render — callers and the store depend
 * on reference identity, not on deep equality. See the D10 behaviour table.
 */
export function mergeTableList(prev: readonly Table[], change: TableChange): Table[]

/**
 * Raw-row variant for consumers that hold database rows rather than `Table`
 * (currently `TableManagementPanel` only — see D9). Same invariant.
 */
export function mergeRowList<T extends { id: string }>(
  prev: readonly T[],
  change: { eventType: string; new?: Record<string, unknown> | null; old?: Record<string, unknown> | null },
): T[]
```

`toTable` preserves the existing field mapping exactly (`TableGrid.tsx:98-104`) and adds `updated_at` per D4:

```ts
{
  id: row.id,
  number: row.number,
  status: row.status,
  waiter: row.waiter_id || undefined,
  waiter_name: row.waiter_name || undefined,
  updated_at: row.updated_at ? new Date(row.updated_at) : undefined,  // ← new (D4)
}
```

`updated_at` is normalized to `Date` to match the declared type (`types/index.ts:39`), which removes the `as unknown as string` cast at `TableGrid.tsx:120`.

### `store/useTableStore.ts` (modified, slice S3)

One added action. Everything else in the `TableState` interface is unchanged — the mutators, helpers, and `activeTable` all stay exactly as they are, which is the point of D1.

```ts
import { mergeTableList, type TableChange } from "@/lib/realtime/table-merge"

interface TableState {
  // ... all existing members unchanged ...
  applyTableChange: (change: TableChange) => void
}

applyTableChange: (change) =>
  set((state) => {
    const next = mergeTableList(state.tables, change)
    // Identity preserved on no-op → Object.is short-circuits in vanilla.mjs:6
    // → no listener notified → zero re-renders.
    return next === state.tables ? state : { tables: next }
  }),
```

**Purity and composition**: the store action is a thin adapter. All decision logic lives in `mergeTableList` and stays unit-testable without a store. The action's only job is translating "same array reference" into "same state object", which is the Zustand-specific half. This mirrors the convention the store already uses at `useTableStore.ts:61, 74, 96`.

**React Query cache-key impact** (required by `openspec/config.yaml` `rules.design`): no key is added, removed, or renamed. `['tables']` survives with an unchanged key and queryFn; what changes is that **no `postgres_changes` handler calls `invalidateQueries` on it any more**. `['orders']`, `['orders','cashier']`, and `['orders','admin']` keep their keys; B-9 replaces their per-event invalidation with payload application in slice S5.

### `lib/supabase/realtime-service.ts` (modified, slice S2)

```ts
type OrdersChannelEntry = { channel: RealtimeChannel; callbacks: Set<OrderCallback> }
const ordersChannels = new Map<string, OrdersChannelEntry>()

// Module-private. Acquires (or creates) a broadcast channel WITHOUT registering
// any listener — see D8.
const getBroadcastChannel = (channelKey: string): RealtimeChannel => { /* ... */ }
```

Public signatures are **unchanged**. `subscribeToOrders(callback: OrderCallback) => () => void` keeps its shape, so `WaiterView.tsx:255`, `CashierView.tsx:234`, and `AdminView.tsx:221` need no edit in S2. `sendFactura` and `sendCommand` keep their signatures. `subscribeToPosEvents` keeps its signature and its registry behaviour; it simply obtains its channel through `getBroadcastChannel`.

Teardown for `subscribeToOrders` uses `supabase.removeChannel(channel)`, preserving today's behaviour at `realtime-service.ts:231`. Noted but **not changed**: `subscribeToTables` tears down with `channel.unsubscribe()` (`:81`) instead, which leaves the channel attached to the client. The inconsistency is real; harmonizing it is not in A-3's scope and is recorded as a follow-up.

## File Changes

| File | Action | Slice | Description |
|---|---|---|---|
| `lib/realtime/table-merge.ts` | Create | S1 | Pure merge module: `toTable`, `mergeTableList`, `mergeRowList`. D3, D4, D5, D10. |
| `components/views/WaiterView.tsx` | Modify | S1 | Remove the remount `key` (`:1116`); replace `invalidateQueries` (`:240`) with `mergeTableList` application; `console.*` → `lib/log` (`:107, 116`) plus the missing `import { log }`. |
| `components/pos/TableGrid.tsx` | Modify | S1 | Delete the local `mergeTable` (`:94-129`); call `mergeTableList` (`:165`). |
| `lib/supabase/realtime-service.ts` | Modify | S2 | Shared `orders-changes` channel via `ordersChannels` Map (`:180-234`); single `order_items` fetch before fan-out; remove `channels["orders"]` bookkeeping; add `getBroadcastChannel`; strip the no-op listener from `sendFactura`/`sendCommand` (`:139, 162`). D7, D8. |
| `package.json` | Modify | ST | Add `vitest` devDependency; add `"test"` and `"test:watch"` scripts; remove the now-dead `"test:placeholder"`. |
| `vitest.config.ts` | Create | ST | Runner config with the React plugin and jsdom. D11 (revised). |
| `vitest.setup.ts` | Create | ST | Imports `@testing-library/jest-dom`. D11 (revised). |
| `components/pos/TableGrid.test.tsx` | Create | ST | F1 remount invariant under a changing selection prop. D11 (revised). |
| `lib/realtime/table-merge.test.ts` | Create | ST | Unit cases for the D10 behaviour table. |
| `openspec/config.yaml` | Modify | ST | Update the `testing` snapshot: `test_command`, `rules.apply.test_command`, `rules.verify.test_command`. `strict_tdd` stays `false`. |
| `store/useTableStore.ts` | Modify | S3 | Add `applyTableChange`. All existing members unchanged. D1. |
| `store/useTableStore.test.ts` | Create | S3 | Unit cases for `applyTableChange` state identity. |
| `components/pos/TableGrid.tsx` | Modify | S3 | Read from the store; delete the local `useState` (`:85`) and the self-fetch effect (`:132-173`). |
| `components/pos/TablesSection.tsx` | Modify | S3 | Delete the dead `tables` prop and `searchTerm`/`filterStatus`/`filteredTables` (`:7-37`). B-11. |
| `components/views/WaiterView.tsx` | Modify | S3 | Route realtime through `applyTableChange`; drop the local `tables` `useState` (`:64`) and the dual write (`:213-219`); demote `useQuery(['tables'])` to hydration. |
| `components/admin/tables/TableManagementPanel.tsx` | Modify | S3 | Replace `await loadTables()` (`:61`) with `mergeRowList`. D9. A-4. |
| `components/views/KitchenView.tsx` | Modify | S4, S5 | S4: apply D6 rules at `:89-93`. S5: remove the `setTables` full-array write (`:454`); apply order payloads. |
| `components/views/CashierView.tsx` | Modify | S4, S5 | S4: D6 rules at `:123`, `:411, 676, 815`. S5: replace `invalidateQueries(['orders','cashier'])` (`:238`). |
| `components/views/AdminView.tsx` | Modify | S4, S5 | S4: D6 rules at `:127-130`, `:559-571, 586`. S5: replace `invalidateQueries(['orders','admin'])` (`:217`). |
| `components/admin/CompletedOrdersTable.tsx` | Modify | S4 | D6 Rule A at `:29`/`:133`. |
| `app/page.tsx` | Modify | S4 | `useTableStore()` → `useTableStore((s) => s.setTables)` (`:30`). D6, newly enumerated. |
| `supabase/**` | **Unchanged** | — | No migration, policy, or RLS change. |

## Testing Strategy

### D11 — Vitest setup (slice ST): runner plus a React environment

**REVISED 2026-09-21 by explicit user decision.** This decision originally narrowed the proposal's C-12 wording to a pure-function runner with no React environment. The orchestrator surfaced that narrowing to the user together with this design's own statement that its largest unmitigated risk is that no automated test exercises a React render path. The user chose to restore the React environment. The original narrowing and its rationale are preserved below for the record; the restored shape is normative.

**Choice**: install `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@vitejs/plugin-react`. Set `test.environment: "jsdom"`, add a setup file, and configure `@/*`. This makes D6's fan-out containment and the F1 remount invariant testable by assertion rather than by the manual recipe alone. Slice ST returns to roughly 120–150 authored changed lines, still well under the 400-line budget. No other decision in this design changes.

**Superseded narrowing (kept for the record)**: install one devDependency, `vitest`, with a manual `@/*` alias and no React environment, on the grounds that every unit target C-12 names is a pure TypeScript function.

**Alternatives considered**: the proposal's C-12 wording, "install Vitest plus a React testing environment".

**Rationale for the revision**: the narrowing was internally consistent but left the net exactly where this design says the danger is. D6's fan-out containment and the F1 remount invariant are render-path behaviours; without a component environment they are verifiable only by two humans watching two browser tabs, on a change that deliberately rewrites four views. The user weighed that and restored the React environment.

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, ".") },   // mirrors tsconfig.json paths: { "@/*": ["./*"] }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],         // imports @testing-library/jest-dom
    include: ["lib/**/*.test.ts", "store/**/*.test.ts", "components/**/*.test.tsx"],
  },
})
```

**[confirm at apply]** `__dirname` availability in `vitest.config.ts`. `package.json` declares no `"type"` field, so the package is CommonJS and Vite's config loader is expected to bundle the TS config as CJS with `__dirname` available. If it is loaded as ESM instead, either switch to `fileURLToPath(new URL(".", import.meta.url))` or add `vite-tsconfig-paths` as a second devDependency and let it read `tsconfig.json` directly. The `vite-tsconfig-paths` route is more robust (it stays correct if `paths` changes) at the cost of one more dependency; the manual alias is preferred for minimalism.

`package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

`"test:placeholder": "echo 'No test runner configured yet' && exit 0"` is deleted — it becomes actively misleading once a real runner exists.

### Coverage plan

| Layer | What to test | Approach | Slice |
|---|---|---|---|
| Unit | `mergeTableList` — all 11 rows of the D10 table, asserting **reference identity** (`expect(result).toBe(prev)`) on every no-op row, not just deep equality | Pure function, no mocks, no environment | ST |
| Unit | `toTable` — `updated_at` is carried and normalized to `Date` (the D4 fix); `id`-less row returns `null` | Pure function | ST |
| Unit | `toTimestamp` — `null`, `undefined`, and unparseable input all yield `0`, so no live event is swallowed by `NaN` | Pure function | ST |
| Unit | `mergeRowList` — raw-row variant preserves `waiter_id`/`updated_at` untouched (D9) | Pure function | ST |
| Unit | `applyTableChange` — a no-op change leaves `getState().tables` reference-identical; an UPDATE replaces exactly one element and preserves all other element references | Vanilla store instance, no React | S3 |
| Component | `TableGrid` does not unmount across a selection change: assert a stable DOM node identity or a mount-counter ref while the parent's selection prop changes (the F1 invariant) | React Testing Library under jsdom | ST, asserted again in S3 |
| Component | A store patch for table X re-renders X's card and does not re-render a sibling card or an unrelated view's tables-derived list (the D6 fan-out invariant) | React Testing Library with a render-count probe | S4 |
| Integration | Realtime handler wiring — a simulated `postgres_changes` payload dispatched through the store produces exactly one state transition and no refetch | jsdom, with `realtimeService` stubbed | S5 |
| E2E | None automated | Not available — no Playwright | — |
| Manual | The two-tab recipe in `proposal.md` *Verification*, extended per slice | Two browser tabs at `http://localhost:3003`; network panel for the S2 `order_items` count; registry inspection for the A-5 leak check | every slice |

Per-slice gate, unchanged from the proposal: `npm run lint` clean or unchanged; `npx tsc --noEmit` reporting the **delta** against the ~484-error pre-existing baseline, never an absolute; `npm run build` exit 0; `npm test` from ST onward.

**Residual risk after the revision**: the render-path gap is now covered by assertion for the F1 remount invariant and the D6 fan-out invariant, which were the two largest holes. What remains uncovered is genuine multi-client behaviour — two browsers, one Supabase channel, real WebSocket delivery — which no jsdom test can reach and which no Playwright setup exists for. The two-tab manual recipe stays mandatory per slice for that reason; it is verifying cross-client delivery, not single-client rendering.

## Threat Matrix

**Not applicable.** This change introduces no routing, shell-command, subprocess, VCS/PR-automation, or executable-file-classification boundary. It is client-side TypeScript in `components/`, `lib/`, and `store/`, plus one config file and one test file.

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No file is classified, interpreted, or executed by path or extension. |
| Git repository selection | N/A | No `git` invocation; no repository or cwd is resolved at runtime. |
| Commit state | N/A | No index or worktree operation. |
| Push state | N/A | No ref or remote resolution. |
| PR commands | N/A | No PR automation or argument composition. |

Per the matrix rules, no task or RED test is manufactured for these rows.

**Process-integration note (not a matrix row).** The broadcast path does cross into an external process — `pos/app.py`, the Windows printer listener that consumes `room_bills` and `room_commands`. D8 changes only *who registers listeners on the sending side*; the channel names, event names, and payload shapes the Python listener consumes are untouched, so its contract is unchanged. The sequence diagram under *Data Flow* documents the flow as `openspec/config.yaml` `rules.design` requires. The listener is Windows-only and is not exercised by this environment, so the A-5 leak check in *Verification* is the only available evidence for this path.

## Migration / Rollout

No data migration. No feature flag. No schema, policy, or RLS state is involved, so every revert is complete — there is nothing to recover and no `supabase db reset` to run.

### Dependency order

    S1 ──┐                       S1 and S2 are mutually independent.
         │                       ST must land before S3.
    S2 ──┤                       S4 and S5 both require S3's owner.
         │
         ├──→ ST ──→ S3 ──┬──→ S4
         │                └──→ S5

| Slice | Content | Depends on | Ships alone | Rollback |
|---|---|---|---|---|
| **S1** | A-1, A-2, A-6 | — | Yes | `git revert` restores the `key` and the `invalidateQueries`: the flicker returns, nothing else regresses. Also reverts the D4 ordering-guard fix. |
| **S2** | A-3, A-5, B-10 | — | Yes | Independent of S1 and of the owner decision; revert restores duplicate channels and the listener leak. Touches only `realtime-service.ts`. |
| **ST** | C-12 | — (but must precede S3) | Yes | Revert removes the runner and the S1 tests. No production code is affected. |
| **S3** | B-7, A-4, B-11 | ST (for its tests) | Yes | **Highest risk.** Revert restores the three-copy model. See the ordering constraint below. |
| **S4** | B-8 | S3 | Yes | Revert restores the wide selectors; correctness is unaffected, only re-render breadth. |
| **S5** | B-9 | S3 | Yes | Revert restores per-event `invalidateQueries` in the order path. |

### Reverse-order constraint

S4 and S5 both read the owner S3 establishes. **A late revert of S3 requires reverting S5 and S4 first, in that order** — S5 → S4 → S3 — because S4's narrowed selectors and S5's payload application both assume `applyTableChange` exists and that the store is no longer whole-array-written. Reverting S3 alone would leave S4 and S5 compiling against a store action that no longer exists (a `tsc` failure, not a silent runtime break — which is the good case, but still a broken branch).

Operational guidance, carried from the proposal: **if S3 is suspect, hold S4 and S5** until S3 has been exercised in real service for at least one shift. The cost of holding is that the fan-out defect (F3) and the order-path invalidation stay live for another shift; the cost of not holding is a three-step ordered revert under pressure.

Emergency full rollback: revert all six merge commits in reverse order (S5 → S4 → S3 → ST → S2 → S1); the branch returns to commit `1cbd88b` behaviour with no residue.

### Chain target

All slices target `sdd/revision-completa-sistema/p6c-legacy-cleanup`, not `main`. `chain_strategy` (`stacked-to-main` vs `feature-branch-chain`) is **not collected yet** and is not assumed by this design; the orchestrator resolves it after `sdd-tasks`.

## Open Questions

- [x] **D11 narrowing — RESOLVED 2026-09-21.** The user rejected the narrowing and restored the React environment: slice ST installs `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@vitejs/plugin-react`, so the F1 remount invariant and the D6 fan-out invariant are covered by assertion. See the revised D11.
- [ ] **D4 changes behaviour in a slice the proposal describes as a pure move.** The out-of-order guard becomes live for the first time. Confirm this is wanted in S1 rather than deferred to S3.
- [ ] **D7's error-path change.** A failed `order_items` fetch currently swallows the event; this design fans out with `order_items` undefined and requires consumers to treat that as "unknown". Confirm, since it changes observable behaviour inside what reads as a refactor.
- [ ] **D6 Rule A/B/C classification for `AdminView`'s handler-path reads** is marked [confirm at apply] — each site must be classified as handler vs. render before a rule is applied. `sdd-tasks` should make this an explicit step rather than a blanket edit.
- [ ] **D9 leaves two table representations** (the `Table` shape in the store, raw rows in `TableManagementPanel`). This is a partial residue against B-7's "exactly one owner". Migrating the panel is a follow-up, deliberately not folded into S3.
- [ ] **`WaiterView` keeps a local `activeTable`** (`WaiterView.tsx:63`) independent of the store's `activeTable` (`useTableStore.ts:6`), which `KitchenView` uses (`:93`, `:789`). Two selection-state notions survive this change. Out of scope; recorded.
- [ ] **`subscribeToPosEvents`'s unsubscribe does not remove its `.on()` binding** (`realtime-service.ts:118-132`), so unsubscribed handlers keep firing. Outside A-5/B-10's scope; recorded as a follow-up so an S2 reviewer does not attribute it to S2.
- [ ] **`subscribeToTables` tears down with `channel.unsubscribe()` while `subscribeToOrders` will use `supabase.removeChannel()`** (`:81` vs `:231`). Harmonizing is out of A-3's scope; recorded.
- [ ] **F9 remains deferred** per D2, with its cost now measured at ~3 lines under O1 rather than left as a bare deferral. May be folded into S3 as an addendum at the orchestrator's discretion.
- [ ] **`package.json` pins `zustand`, `@tanstack/react-query`, and `immer` to `"latest"`.** Every API decision here was verified against the *installed* tree, so a future `pnpm install` could silently change the resolved versions out from under this design. Pinning is a hygiene follow-up, not in scope.
