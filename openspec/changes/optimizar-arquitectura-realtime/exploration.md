# Exploration: optimizar-arquitectura-realtime

Table-grid flicker root cause + app-wide realtime architecture audit.

- Change: `optimizar-arquitectura-realtime`
- Date: 2026-09-21
- Branch: `sdd/revision-completa-sistema/p6c-legacy-cleanup` (58 commits ahead of `main`, 0 behind — unmerged)
- Artifact store: hybrid (this file + Engram `sdd/optimizar-arquitectura-realtime/explore`)
- Evidence basis: static source reading via CodeGraph + direct file reads. The app was NOT run; nothing here was reproduced live.

## Problem

The POS table grid flickers whenever a realtime update arrives, most visibly when several waiters work the same floor plan. The open question was whether the realtime implementation is wrong, improvable, or should be replaced.

## Current State

The prior change `investigar-mesa-sync-realtime` fixed the infra layer: missing `supabase_realtime` publication, `wal_level=replica`, and one client bug (`subscribeToTables` dropping callbacks on double subscribe, R1-06). Events now arrive.

That fix is present and correct on this branch. `lib/supabase/realtime-service.ts:57-85` keys `tablesChannels` by role and holds callbacks in a `Set`, tearing the channel down only when the last caller unsubscribes. `components/pos/TableGrid.tsx` already merges the event payload (`mergeTable`, lines 94-129) instead of refetching, and gates its skeleton behind an `initialLoadDone` flag (lines 86-88, 193-212) so realtime events alone never blank the grid.

The flicker therefore is not a transport problem. It comes from client-side render and state defects introduced by this branch's P6a/P6b store-split and React Query migration.

## Root Causes

All findings below were re-verified by the orchestrator against on-disk source before this artifact was written.

### F1 — CONFIRMED (primary): `key` prop forces a full remount of the table grid

`components/views/WaiterView.tsx:1116`:

```tsx
key={`tables-section-${activeTable ?? 'none'}`}
```

The key changes whenever `activeTable` changes, so React unmounts and remounts the whole `TablesSection` -> `TableGrid` subtree. On mount `TableGrid.tsx:85-88` resets `tables=[]`, `loading=true`, `initialLoadDone=false`, then `TableGrid.tsx:134-158` refetches `tableService.getAll()` and paints the 12-card skeleton (`TableGrid.tsx:195-212`) before repopulating.

Two trigger paths:

- Direct: every waiter click that selects or deselects a table. Frequent, and independent of realtime.
- Realtime-driven: `WaiterView.tsx:243-246` calls `setActiveTable(null)` when a remote `UPDATE` frees the currently selected table (for example a cashier completing payment on it). That mutates `activeTable`, which mutates the key, which remounts the grid — at the exact moment a remote update arrives. This is the reported symptom.

### F2 — CONFIRMED: duplicate table-state pipelines, one refetching in full on every event

`WaiterView.tsx:231-252` subscribes to the same `tables-waiter` channel `TableGrid` already uses (both call `realtimeService.subscribeToTables` with the default `role="waiter"`, `realtime-service.ts:57`). Instead of applying `payload.new`, it calls `queryClient.invalidateQueries({ queryKey: ['tables'] })` (`WaiterView.tsx:240`) on every remote event, which re-runs `fetchTables()` (`WaiterView.tsx:104-119`, a full `tableService.getAll()`), which then writes both `setTables(tablesData)` and `useTableStore.getState().setTables(tablesData)` (`WaiterView.tsx:213-219`).

Three uncoordinated copies of "tables" are alive per WaiterView instance:

1. `TableGrid`'s local `useState` + merge — what is actually rendered, and correctly implemented.
2. `WaiterView`'s `useQuery(['tables'])` + local `tables` — used only for lookups (`WaiterView.tsx:374, 417, 602, 814, 1038, 1132`), refetched in full on every event.
3. The global `useTableStore` — consumed by other views.

`components/pos/TablesSection.tsx:7-37` accepts a `tables` prop and computes `filteredTables` / `searchTerm` / `filterStatus`, but never renders them or forwards them to `<TableGrid>` (`TablesSection.tsx:41-49`); `TableGridProps` (`TableGrid.tsx:17-26`) has no `tables` field. That prop and filter state are dead code left over from the abandoned data flow.

### F3 — CONFIRMED: whole-store write fans out to unrelated views

Because of F2, `useTableStore.getState().setTables(tablesData)` (`WaiterView.tsx:216`) replaces the entire array with fresh object references whenever any waiter changes any table. Every view selecting `(s) => s.tables` under Zustand's default reference equality re-renders its whole tables-derived UI on every such event:

- `components/views/KitchenView.tsx:89`
- `components/views/CashierView.tsx:123`
- `components/views/AdminView.tsx:127`
- `components/admin/CompletedOrdersTable.tsx:29`

This does not touch `TableGrid` (it does not read the store), but it is a genuine whole-store-write defect on other render trees, and a likely source of flicker reports from Kitchen, Cashier, and Admin screens.

### F4 — CONFIRMED (mechanism corrected during verification): `subscribeToOrders` creates duplicate channels per caller

`realtime-service.ts:180-234` calls `supabase.channel("orders-changes")` on **every invocation** and stores the result in the single slot `realtimeService.channels["orders"]` (line 228), overwriting the previous entry. Callers: `WaiterView.tsx:255`, `CashierView.tsx:234`, `AdminView.tsx:221`.

The exploration pass reported this as the R1-06 "silent callback drop" bug. That reading is wrong and is corrected here: each caller's teardown closes over its own `channel` reference (line 231), so no caller tears out another's channel. The real defects are:

- Duplicate subscriptions to the same topic when more than one caller is mounted (including React StrictMode's dev double-mount), so each event is delivered N times.
- Each delivery runs its own `SELECT * FROM order_items WHERE order_id = ...` (lines 194-204), so event amplification multiplies database round trips.
- `realtimeService.channels["orders"]` is a stale-bookkeeping leak: a second caller overwrites the first's entry, and the first caller's `delete` on teardown removes a slot that no longer refers to it.

Severity is lower than reported (no dropped updates), but the N+1 amplification is real.

### F5 — CONFIRMED: Admin table panel does a full reload per event

`components/admin/tables/TableManagementPanel.tsx:55-62` handles every realtime event with `await loadTables()`, and `loadTables` opens with `setLoading(true)` (line 36). This is the textbook "full refetch on every event with loading gating the render" flicker, on the Admin screen, independent of the waiter-side bug.

### F6 — CONFIRMED: unbounded listener leak in broadcast senders

`realtime-service.ts:136-177`: `sendFactura` and `sendCommand` call `subscribeToPosEvents(channelKey, eventName, () => {})` with a fresh no-op callback on every invocation (every invoice printed, every kitchen ticket sent) and never unsubscribe. Each send permanently adds a dead entry to the `Set` in `broadcastListenerRegistry` (`realtime-service.ts:102-109`). Unbounded growth across a shift. Not a flicker cause.

### F7 — SUSPECTED, harmless: no echo suppression in `TableGrid`

`WaiterView` suppresses its own echoes via `localChangesRef` (`WaiterView.tsx:234, 258`). `TableGrid`'s merge callback (`TableGrid.tsx:161-167`) has none, but it applies an idempotent merge of final state rather than an append, so no visible bounce is expected. Not verified live.

### F8 — Minor: raw console usage

`WaiterView.tsx:107, 116` use `console.log` / `console.error` instead of `lib/log.ts`, violating the prior change's R6-04.

### F9 — GAP: the R1 spec's polling fallback appears unimplemented

The R1 spec requires falling back to 30s polling when realtime is unavailable. No `refetchInterval` or equivalent was found in `TableGrid.tsx` or `WaiterView.tsx`. Not verified live.

## Realtime Subscription Inventory

| Channel(s) | Mechanism | Filter | Multi-caller safe | Callers | Notes |
|---|---|---|---|---|---|
| `tables-{role}` (role is always the `"waiter"` default; no caller passes another) | `postgres_changes` `*` on `public.tables` | none, client-side only | Yes — Map+Set (`realtime-service.ts:57-85`) | `TableGrid.tsx:161`, `WaiterView.tsx:231`, `TableManagementPanel.tsx:55` | Admin shares the waiter channel because nobody passes a role; the "role suffix prevents cross-role leakage" comment (`realtime-service.ts:40-42`) is aspirational |
| `orders-changes` | `postgres_changes` `*` on `public.orders`, plus an `order_items` select per event | none | No — duplicate channel per caller (F4) | `WaiterView.tsx:255`, `CashierView.tsx:234`, `AdminView.tsx:221` | Event amplification x N callers, each with its own DB round trip |
| `kitchen-status`, `kitchen-orders-channel`, `kitchen-new-items-channel`, `kitchen-item-updates-channel`, `kitchen-order-deletes-channel` | 5x `postgres_changes` on `orders` / `order_items`, each doing a full `orderService.getById` per event | `status=eq.kitchen` server-side on 2 of them | Single caller, N/A | `KitchenView` | Heavy per-event round trip by design; only one consumer |
| `room_bills`, `room_commands` | Broadcast | N/A | Leak, not drop (F6) | `sendFactura` / `InvoicePrintView`, `sendCommand` / `WaiterView`, `pos/app.py` | The Python printer listener touches only these two broadcast channels — no duplication with the web client's `postgres_changes` |

Infra, confirmed correct: the publication is scoped rather than `FOR ALL TABLES`, and `REPLICA IDENTITY FULL` is set on `tables` / `orders` / `order_items` (`supabase/01_realtime_bootstrap.sql`, `supabase/00_supabase_init.sql`, `supabase/migrations/20250917090000_enable_realtime_publication.sql`).

Documentation gap: the `2025091709{05,06,07,08,99}` migrations described in `investigar-mesa-sync-realtime/design.md` (restaurants table, RLS, payment RPCs, anon-grant hardening) were not found on disk. Only `20250917090000` exists from that series. Treat as a doc-vs-reality gap, not a confirmed regression.

## Mechanism Assessment

| Option | Verdict | Reasoning |
|---|---|---|
| Keep `postgres_changes`, fix the client | Recommended | Every confirmed defect (F1-F6) is a client render or state bug. Replacing the transport fixes none of them. |
| Broadcast / `broadcast_changes` trigger | Defer | Addresses RLS overhead and scale that have not been demonstrated at this app's size, and would partly redo the just-landed infra work. Revisit if RLS-per-subscriber cost is ever measured as a bottleneck. |
| Presence | Separate feature | Answers "who is editing table X", not the flicker. Out of scope. |
| Polling / `refetchInterval` | Not a replacement | Already beaten by `TableGrid`'s existing merge. Relevant only as the fallback F9 says is missing. |

**Verdict: fix in place. Do not replace the mechanism.**

Concrete client-side fixes:

1. Remove the `key` from `<TablesSection>` (`WaiterView.tsx:1116`). Expected to remove most of the reported flicker on its own.
2. Choose one owner for table state and delete the competing copies, or at minimum stop the `invalidateQueries` full refetch (`WaiterView.tsx:240`) and apply `payload.new` directly.
3. Make `subscribeToOrders` share one channel across callers, the way `subscribeToTables` already does.
4. Make `TableManagementPanel.tsx:55-62` merge instead of `await loadTables()`.
5. Stop leaking no-op listeners in `sendFactura` / `sendCommand`.
6. Replace raw console calls in `WaiterView.tsx:107, 116` with `lib/log.ts`.

## Approaches

### A1 — Surgical fix (client only)

Items 1-6 above, scoped to the files inventoried here.

- Pros: targets every confirmed root cause; no infra work; fits the 400-line review budget as one or two work-unit commits; verifiable with the two-tab recipe the prior change already documented.
- Cons: leaves the app's wider realtime patterns unharmonized (`subscribeToKitchen`'s 5-channel N+1 stays); requires a judgment call on which of the three table-state copies survives.
- Effort: low to medium.

### A2 — Full realtime architecture consolidation

A1 plus unifying all `postgres_changes` consumers onto the Zustand stores, deleting component-local realtime state everywhere, and normalizing the broadcast send pattern.

- Pros: removes the three-sources-of-truth smell permanently; prevents regressions of this class.
- Cons: much larger diff across Kitchen, Cashier, and Admin render paths; higher risk of unrelated regressions; needs chained PRs.
- Effort: high.

### A3 — Replace the mechanism

Not recommended. See the assessment table.

## Recommendation

A1. It addresses every confirmed root cause with file:line evidence, needs no new infrastructure, and lands within the review budget. A2's consolidation is worth doing later, as its own change, once the acute flicker is gone — bundling it now risks re-creating the single-giant-PR situation of `investigar-mesa-sync-realtime`.

## Risks

- The `key` in F1 may have been added to reset `TablesSection`'s `searchTerm` / `filterStatus` on selection, but that filter UI is dead code (never rendered), so the risk is likely moot. Confirm no other consumer depends on the remount side effect.
- Making `useTableStore` the single owner couples `TableGrid` to global state. No test or consumer was found assuming its current self-fetching behavior, but this was not exercised live.
- No finding was reproduced live; there is no running app in this environment and the repo has no test runner (`strict_tdd: false`). Use the two-tab manual recipe before closing.
- F4's amplification may already be multiplying order-event DB load today, independent of the flicker.
- If the RLS scope on disk differs from `investigar-mesa-sync-realtime/design.md`, the RLS-under-realtime throughput question needs re-evaluation.

## Open Questions

1. Scope: A1 only, or fold in A2's consolidation?
2. Is `TableManagementPanel`'s full-reload bug (F5, Admin) in this change or a follow-up?
3. Is the missing polling fallback (F9) in scope?
4. Single owner for table state: `useTableStore`, or React Query as the source with the Zustand table store dropped?

## Ready for Proposal

Yes, pending the user's answer on scope.
