# Realtime Channel Lifecycle Specification

## Purpose

Define how Supabase realtime channels are shared across callers, torn down, and used for one-way broadcast sends. One channel exists per topic regardless of how many callers subscribe to it; callbacks are held in a set and a channel is torn down only when its last caller unsubscribes; one realtime event produces one downstream round trip, not one per mounted view; and broadcast senders obtain a channel without registering a listener on it.

This is a NEW capability. `openspec/specs/` is currently empty because the prior change `investigar-mesa-sync-realtime` is unarchived, so there is no root spec to write a delta against.

## Supersession Notice

This spec **extends** `openspec/changes/investigar-mesa-sync-realtime/specs/p1-realtime.md` Requirement R1-02 ("Realtime Subscription Uses Merge, Not Full Reload") and Requirement R1-06 ("subscribeToTables Handles Multiple Concurrent Callers"): R1-06's shared-channel, callback-Set, reference-counted-teardown pattern already exists for `subscribeToTables`. This spec's **Requirement: One Channel Per Topic, Shared Across Callers** below extends that identical pattern to `subscribeToOrders`, which does not have it today (`lib/supabase/realtime-service.ts:180-234` opens a fresh `orders-changes` channel on every call and overwrites a single-slot bookkeeping entry). No requirement in the prior change is reversed by this spec; this spec closes a gap the prior change's audit trail did not cover for the orders topic.

## Requirements

### Requirement: One Channel Per Topic, Shared Across Callers

For a given realtime topic (for example, `orders-changes`), the system MUST maintain at most one underlying Supabase channel regardless of how many independent callers subscribe to that topic. Each caller's callback MUST be added to a set of callbacks associated with that topic's channel. The underlying channel MUST be torn down only when the last remaining caller for that topic unsubscribes; an individual caller's unsubscribe MUST remove only its own callback and MUST NOT affect other callers still subscribed to the same topic.

#### Scenario: Multiple callers share one channel

- GIVEN `WaiterView`, `CashierView`, and `AdminView` each call the orders-subscription function on mount
- WHEN all three are mounted concurrently
- THEN exactly one underlying Supabase channel exists for the `orders-changes` topic
- AND each of the three callbacks is registered against that single channel

#### Scenario: One caller unsubscribing does not affect the others

- GIVEN two callers are subscribed to the same topic and its channel is open
- WHEN the first caller unmounts and calls its teardown function
- THEN the second caller's callback continues to receive events
- AND the underlying channel remains open

#### Scenario: The channel is torn down only after the last caller unsubscribes

- GIVEN two callers are subscribed to the same topic
- WHEN both callers unmount and call their respective teardown functions, one after the other
- THEN the underlying Supabase channel is closed only after the second (last) teardown call
- AND no channel-bookkeeping entry for that topic remains after the last teardown

#### Scenario: Bookkeeping does not leak stale entries

- GIVEN a first caller has already subscribed to a topic and its channel entry is recorded
- WHEN a second caller subscribes to the same topic
- THEN the topic's channel-bookkeeping entry continues to reference the one live channel shared by both callers
- AND no second, independent bookkeeping entry is created for the same topic that could later be overwritten or orphaned

### Requirement: One Realtime Event Produces One Downstream Round Trip

For a given realtime topic that requires a follow-up read (for example, fetching `order_items` for a changed order), one incoming `postgres_changes` event MUST result in exactly one downstream round trip for that data, regardless of how many views or callbacks are subscribed to that topic. The result of that single round trip MUST be delivered to every subscribed callback; callbacks MUST NOT each independently re-fetch the same data for the same event.

#### Scenario: One order event yields one order_items query

- GIVEN `CashierView` and `AdminView` are both subscribed to the orders topic
- WHEN a single `postgres_changes` event fires for an order change
- THEN exactly one `order_items` read is issued for that event
- AND both `CashierView`'s and `AdminView`'s callbacks receive the resulting data

#### Scenario: Delivery multiplicity matches caller count, not channel count

- GIVEN N independent callers are subscribed to the same topic
- WHEN one realtime event fires
- THEN each of the N callers' callbacks is invoked exactly once for that event
- AND the underlying round trip for any data that event requires is performed exactly once, not N times

### Requirement: Broadcast Senders Obtain A Channel Without Registering A Listener

A function that only sends a one-way broadcast message (for example, sending an invoice or a kitchen command) MUST be able to obtain a channel reference to send on without registering a listener callback on that channel. Repeated calls to a broadcast-send function MUST NOT grow any listener registry.

#### Scenario: Sending does not register a listener

- GIVEN a broadcast-send function is called to send one message on a topic
- WHEN the send completes
- THEN no new entry is added to the broadcast-listener registry for that topic as a result of the send
- AND the channel used for sending remains usable for subsequent sends without accumulating listeners

#### Scenario: The broadcast registry does not grow with repeated sends

- GIVEN a broadcast-send function is called repeatedly in a single session (for example, once per printed invoice, or once per kitchen ticket)
- WHEN the registry of listeners for that topic is inspected after N sends
- THEN the registry's size for that topic is the same after N sends as it was after the first send (accounting only for genuine subscriber callbacks, not sender-side no-op callbacks)
- AND no sender-side no-op listener remains registered after the send that created it

## Verification Notes

These scenarios describe invariants over `lib/supabase/realtime-service.ts` and its callers. At the time each slice ships:

- Slices S2 (channel lifecycle) and S3/S5 (consumer unification) have no automated test runner available for S2, and are verified by `npm run lint`, `npx tsc --noEmit` (delta against the pre-existing baseline), `npm run build`, and the documented two-tab manual recipe extended per the proposal's *Verification* section — specifically: opening Cashier and Admin together and confirming one order event produces one update per view while inspecting the network panel for a single `order_items` request per event; and printing several invoices/kitchen tickets in one session and confirming the broadcast-listener registry's handler sets do not grow per send.
- No scenario in this spec assumes an automated test suite exists before slice ST. From slice ST onward, any pure logic this capability's implementation extracts (for example, a pure channel-registry helper, if the design phase introduces one) SHOULD carry unit test coverage; the channel-lifecycle behavior itself, being tied to live Supabase channels and the DOM/browser network panel, remains verified by the manual recipe rather than a unit test.
- No scenario in this spec asserts a measured performance number or timing figure.
