# Delta for Realtime (P1) — sync fix for investigar-mesa-sync-realtime

## Purpose

Enable Supabase Realtime WAL replication for `tables`, `orders`, `order_items`; replace per-event full reload with client-side merge; eliminate UI flicker on refetch; ensure clean subscription teardown. Bundled: fix `subscribeToTables` double-call teardown bug.

## ADDED Requirements

### Requirement: R1-01 — Realtime Publication Enabled

The system MUST add `tables`, `orders`, and `order_items` to the `supabase_realtime` publication and set `REPLICA IDENTITY FULL` on each so `OLD` payloads carry all columns.

The system SHALL provide a migration `20250917090000_enable_realtime_publication.sql` that:
1. Runs `ALTER TABLE public.tables REPLICA IDENTITY FULL;`
2. Runs `ALTER TABLE public.orders REPLICA IDENTITY FULL;`
3. Runs `ALTER TABLE public.order_items REPLICA IDENTITY FULL;`
4. Runs `ALTER PUBLICATION supabase_realtime ADD TABLE public.tables, public.orders, public.order_items;`

#### Scenario: R1-01-S1 — Mesa status sync across two browsers

- GIVEN two browser sessions on different devices, both authenticated as the same restaurant tenant
- WHEN device A flips `tables.status` from `'free'` to `'occupied'` for table 5 via a REST UPDATE
- THEN device B receives the `postgres_changes` event and updates its local `tables` state within 500 ms
- AND the `TableGrid` component shows table 5 as occupied without a full blank-and-refill flicker

#### Scenario: R1-01-S2 — Order status change propagates to freeing a table

- GIVEN device A is on CashierView with order X assigned to table 5, status `'active'`
- WHEN device A calls `complete_payment(order_X, 'cash', 50000)` and the order transitions to `'paid'`
- THEN device B (WaiterView) receives the `orders` `UPDATE` event within 500 ms
- AND table 5 transitions from `'occupied'` to `'free'` in device B's TableGrid

#### Scenario: R1-01-S3 — Publication not set: no events fire

- GIVEN the `supabase_realtime` publication does NOT include `tables`
- WHEN any client updates `tables.status`
- THEN `postgres_changes` events do NOT fire for that table
- AND all subscribed clients continue to see stale data

### Requirement: R1-02 — Realtime Subscription Uses Merge, Not Full Reload

The system SHALL replace the per-event `loadTables()` call in `TableGrid.tsx` with a client-side state merge: patch the changed row from `payload.new`, keep the existing array, do not blank the grid.

The `realtime-service.ts` `subscribeToTables` function SHALL return a stable channel reference and merge incoming payloads into the shared `useTableStore` state without triggering a full re-query.

#### Scenario: R1-02-S1 — Merge updates a single row without re-query

- GIVEN `useTableStore` holds `[table1, table2, table3]`
- WHEN a `postgres_changes` UPDATE event arrives for `table2` with `{id: table2.id, status: 'occupied'}`
- THEN `useTableStore` state becomes `[table1, merged_table2, table3]`
- AND no `from("tables").select()` call is issued

#### Scenario: R1-02-S2 — Insert adds a row without full reload

- GIVEN `useTableStore` holds existing tables; a new table is created by admin
- WHEN the `postgres_changes` INSERT event arrives with the new row
- THEN the new row is appended to `useTableStore` state
- AND no `loadTables()` is called

### Requirement: R1-03 — No Flicker on Realtime Refetch

The system SHALL distinguish "first load" from "re-fetch": the first load MAY show a skeleton; subsequent realtime refetch events MUST NOT blank the visible grid.

`TableGrid.tsx` MUST NOT call `setLoading(true)` inside a `postgres_changes` event handler.

#### Scenario: R1-03-S1 — Flicker eliminated on realtime update

- GIVEN the user is looking at `TableGrid` with 12 visible table cards
- WHEN any table's status changes via a realtime event
- THEN the grid remains visible throughout the update
- AND only the affected card's visual state changes

### Requirement: R1-04 — Subscriptions Unsubscribe Cleanly

`subscribeToPosEvents` in `realtime-service.ts` MUST return an unsubscribe function that removes the specific broadcast listener without calling `unsubscribeAll()`.

Each `postgres_changes` subscription created by `subscribeToTables`, `subscribeToOrders`, and `subscribeToKitchen` MUST be tracked by channel name and MUST be removable individually.

#### Scenario: R1-04-S1 — Unsubscribe removes only the target listener

- GIVEN `subscribeToPosEvents('room_bills', handlerA)` and `subscribeToPosEvents('room_commands', handlerB)` are both registered
- WHEN the `room_bills` unsubscribe is called
- THEN `room_commands` continues to receive events
- AND `handlerA` is no longer called on new broadcasts

#### Scenario: R1-04-S2 — Channel leak prevented on role switch

- GIVEN a waiter switches role from WaiterView to AdminView
- WHEN the WaiterView component unmounts and calls its subscription cleanup
- THEN the Supabase websocket channel for `tables-changes` is closed
- AND no orphaned channel remains open

### Requirement: R1-05 — Two-Tab Realtime Verification

After the PR is merged and the stack is up with a fresh volume, the realtime fix MUST be verifiable by two concurrent browser sessions without any manual refresh.

#### Scenario: R1-05-S1 — Two-tab table flip propagates within 500 ms

- GIVEN browser tab A is logged in as `tester@restaurant.com` (waiter role) at `http://localhost:3003`
- AND browser tab B is logged in as the same user at `http://localhost:3003`
- WHEN tab A flips table 5 status to `'occupied'` via the UI
- THEN tab B's `TableGrid` updates to show table 5 as occupied within 500 ms
- AND no manual refresh is performed in tab B

### Requirement: R1-06 — subscribeToTables Handles Multiple Concurrent Callers

When `WaiterView` AND `TableGrid` both call `realtimeService.subscribeToTables(callback)` on mount, both callbacks MUST be registered and receive events independently. The second call MUST NOT drop its callback.

`realtime-service.ts` MUST store callbacks in a Map keyed by channel name (e.g. `tables-changes`) so that multiple callers can register. The returned teardown function MUST remove only the specific callback passed in, not the entire channel.

#### Scenario: R1-06-S1 — Both callers receive events after double subscribe

- GIVEN `WaiterView` calls `subscribeToTables(handlerA)` returning `teardownA`
- AND `TableGrid` calls `subscribeToTables(handlerB)` returning `teardownB`
- WHEN a `postgres_changes` UPDATE event for table 3 arrives
- THEN both `handlerA` and `handlerB` are called with the event
- AND calling `teardownA()` removes only `handlerA`
- AND `handlerB` continues to receive subsequent events

#### Scenario: R1-06-S2 — Teardown of one caller does not silence the other

- GIVEN both `WaiterView` and `TableGrid` are subscribed to `tables-changes`
- WHEN `WaiterView` unmounts and calls `teardownA()`
- THEN `TableGrid`'s `handlerB` still receives `postgres_changes` events
- AND the underlying Supabase channel is closed only when the last caller teardown is called

## NON-FUNCTIONAL REQUIREMENTS

| Aspect | Requirement |
|--------|-------------|
| Latency | Mesa status change visible on peer device within 500 ms (Supabase Free Realtime SLA) |
| Bundle size | `realtime-service.ts` merge logic adds ≤ 30 lines; no new runtime dependencies |
| Fallback | If realtime is unavailable, components fall back to polling every 30 s without crashing |
| RLS interaction | After P2 lands, `postgres_changes` payloads are filtered by RLS — anonymous clients receive empty payloads |

## MIGRATION / ROLLBACK

**Migration**: `supabase db reset` (infra-foundation sets up the DB; migrations apply on reset)
- `supabase/migrations/20250917090000_enable_realtime_publication.sql`

**Rollback**:
```sql
ALTER PUBLICATION supabase_realtime DROP TABLE public.tables, public.orders, public.order_items;
```

## OUT OF SCOPE

- RLS policy design (P2)
- Multi-tenant `restaurant_id` FK (P2)
- Payment atomicity (P3)
- React Query migration (P6)
- Zustand store split (P6)
