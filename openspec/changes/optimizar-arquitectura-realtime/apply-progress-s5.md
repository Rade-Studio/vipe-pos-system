# S5 — Consumer unification (B-9)

Applies design D7: the `postgres_changes` payload object fanned out to N callbacks from the shared `orders-changes` channel (S2) is the same object reference for all of them. No consumer touched in this slice mutates `payload.new`, `payload.old`, or `order_items` — each derives new local state instead. Concretely, this slice replaces the per-event `queryClient.invalidateQueries({ queryKey: ['orders', *] })` calls inside `subscribeToOrders` callbacks (WaiterView, CashierView, AdminView, KitchenView) with direct payload application through `mergeOrdersList` (WaiterView, AdminView) or local-state mutation (CashierView, where the cache is a 5-derive object), and removes the two redundant invalidates inside `KitchenView` whose handlers already mutate `useOrderStore` via `addOrder`/`updateOrder`/`removeOrder`.

## Scope

Production files touched:
- `components/views/WaiterView.tsx` — `subscribeToOrders` callback now applies the payload through `mergeOrdersList` against `['orders']`.
- `components/views/CashierView.tsx` — `subscribeToOrders` callback now mutates the five local-state arrays (`activeOrders`/`kitchenOrders`/`deliveredOrders`/`partialOrders`/`ordersByTable`) directly, no `setQueryData` at all (the brief's "cache is a 5-derive object" rationale makes patching only the cache insufficient).
- `components/views/AdminView.tsx` — `handleOrderChange` now applies the payload through `mergeOrdersList` against `['orders', 'admin']`, preserving the existing side effects (toasts for INSERT/DELETE, `newOrdersCount` counter).
- `components/views/KitchenView.tsx` — two redundant `invalidateQueries` calls in `handleOrderUpdate` and `handleOrderItemUpdate` are removed (the `useOrderStore` mutations already on the next lines cover the same effect).

Test files:
- `lib/realtime/order-merge.test.ts` — fixture bug fixed (STEP 0; new `makeItem` helper + literal replacements).
- `components/views/order-apply.test.tsx` (NEW, 170 lines) — integration test for D7 consequence 2: a simulated payload produces exactly one `setQueryData`, zero `invalidateQueries`.

Specs / progress:
- `openspec/changes/optimizar-arquitectura-realtime/tasks.md` — S5.1–S5.7 ticked (`[x]`), S5.8 partial (`[~]`, manual recipe pending the user).
- This document (`apply-progress-s5.md`, NEW).

## D7 consequence restatement (S5.1)

The D7 read-only contract comment in `lib/supabase/realtime-service.ts:262-265` reads verbatim:

```
// D7 read-only contract: `payload` is the SAME object reference
// fanned out to every callback in `entry.callbacks`. Consumers
// MUST NOT mutate `payload.new`/`payload.old`/`order_items` —
// derive new local state instead.
```

Confirmed present. **Restatement for the S5 PR description** (the exact wording the task brief requires):

> The payload object fanned out to N callbacks is the same object reference for all of them. No consumer touched in this slice mutates `payload.new`, `payload.old`, or `order_items` — each derives new local state instead.

Verified by code review of S5.2–S5.5:
- `WaiterView.tsx:281-297` — `wireToAppOrder(payload.new)` and `payload.old?.id` only **read** the payload; the conversion result is a fresh object (no shared identity with `payload.new`); `queryClient.setQueryData(...)` writes a derived array into the cache.
- `CashierView.tsx:240-287` — every `(payload.new as any).id` / `.status` / `.table_id` / `.waiter_id` access is a read; the new `Order` constructed for INSERT is a fresh object; the UPDATE branch shallow-spreads `{ ...x, ...(payload.new as any) }` (a fresh merge object, never `payload.new` itself), and the DELETE branch filters without touching the payload.
- `AdminView.tsx:208-249` — same `wireToAppOrder` shape as WaiterView; payload is read-only, the conv object is fresh.
- `KitchenView.tsx:245, 322` — the two removed `invalidateQueries` calls didn't mutate the payload; nothing else in `handleOrderUpdate` / `handleOrderItemUpdate` mutates it either (`payload.new` and `payload.old` are only read).

## `wireToAppOrder` snippet (S5.2 / S5.4)

Defined at module scope in both `WaiterView.tsx` (line 60-69, just below `normalizeDishId`) and inline inside `handleOrderChange` in `AdminView.tsx:235-244` (kept local since the helper is only used once and the file already imports `mergeOrdersList`/`OrderChange` from the shared module):

```typescript
const wireToAppOrder = (dbRow: any): Partial<Order> | null => {
  if (!dbRow?.id || !dbRow.status) return null
  return {
    id: dbRow.id,
    tableId: dbRow.table_id ?? "",
    status: dbRow.status as OrderStatus,
    ...(dbRow.waiter_id !== undefined ? { waiter: dbRow.waiter_id } : {}),
  } as Partial<Order>
}
```

Used identically by both views:

```typescript
const conv: OrderChange = {
  eventType: payload.eventType,
  new: payload.new ? wireToAppOrder(payload.new) : null,
  old: (payload.old as any)?.id ? { id: (payload.old as any).id } : null,
}
queryClient.setQueryData<Order[]>(['orders' /* or ['orders','admin'] */], (prev: Order[] | undefined) =>
  prev ? mergeOrdersList(prev, conv) : prev,
)
```

Two notes on the `as any` casts (deviations from the literal brief snippet):

1. The brief's snippet writes `payload.old?.id` without a cast. The Supabase type `RealtimePostgresChangesPayload<any>` produces a union where `payload.old` is typed `{} | Partial<any>` depending on the eventType variant, and accessing `.id` on that union fails with `Property 'id' does not exist on type '{} | Partial<any>'`. The cast `(payload.old as any)?.id` (mirroring the existing `as any` pattern already used in `WaiterView.tsx:269` for the same access) is required to compile under `npx tsc --noEmit`. No runtime semantics change.
2. The `(prev: Order[] | undefined) =>` annotation on the updater is required because `setQueryData`'s default generic for the updater parameter infers to `unknown | undefined` in this codebase's TypeScript version, which then fails to satisfy `mergeOrdersList(prev: readonly Order[], ...)`. Explicitly typing the param preserves the brief's logic without an `as unknown` cast at the call site.

## STEP 0 — fixture bug fix

`lib/realtime/order-merge.test.ts` had two inline literal item arrays (`itemsRef` at the original line 87, `items` at the original line 110) that failed `npx tsc --noEmit` because `OrderItem` requires `image: string` and `status: OrderItemStatus`. Added a `makeItem(id, overrides)` helper above `makeOrder` returning the brief's literal shape, and replaced both literals with `makeItem("i-1")`. Also added `import type { OrderItem } from "@/types"` (the file previously imported only `Order`).

```typescript
function makeItem(id: string, overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id,
    name: `name-${id}`,
    price: 1,
    quantity: 1,
    categoryId: "",
    image: "",
    status: "kitchen" as const,
    ...overrides,
  }
}
```

Both `itemsRef = [makeItem("i-1")]` and `items = [makeItem("i-1")]` calls preserve the original reference-identity assertions (`expect(result[0].items).toBe(itemsRef)` and `toBe(items)`) because each `makeItem(...)` call returns a fresh array, the const binds to that one reference, and `mergeOrdersList`'s UPDATE-id-in-prev rule returns `{ ...prev[idx], ...newRow, id: prev[idx].id }` where `items` (from `prev[idx]`) is reference-preserved.

Verification: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **0** (was **2** before STEP 0). The 14 `order-merge.test.ts` tests pass alongside the 38 from prior slices.

## Deviations from the brief's literal snippets

1. **`as any` casts on `payload.old?.id` (S5.2, S5.4)** — see "wireToAppOrder snippet" above. Without the cast, tsc fails on `Property 'id' does not exist on type '{} | Partial<any>'`. No runtime change.
2. **`(prev: Order[] | undefined) =>` annotation on `setQueryData`'s updater (S5.2, S5.4)** — same justification. The brief's arrow `(prev) => prev ? mergeOrdersList(prev, conv) : prev` infers `prev: unknown | undefined`, which `mergeOrdersList(prev: readonly Order[], ...)` rejects. Explicitly typing the param keeps the brief's logic intact.
3. **`CashierView.tsx`: `import type React from "react"` added at the top** (S5.3) — the brief's snippet uses `React.Dispatch<React.SetStateAction<Order[]>>` for the `apply` helper's parameter. The original file did not import React as a type. Adding `import type React from "react"` is required for tsc, and is a no-op at runtime because `import type` is erased.
4. **`wireToAppOrder` placement: module scope in `WaiterView.tsx`, local in `AdminView.tsx`** (S5.2, S5.4). The brief says "near the realtime handler scope" without specifying module vs. closure. In `WaiterView.tsx` the helper is at module scope (line 60-69, just below the existing `normalizeDishId` module helper) since it's a pure function with no closure dependencies — keeps it out of the per-event allocation path. In `AdminView.tsx` it's defined inline inside `handleOrderChange` (one-shot use, helper is created on every event invocation) — same pattern the brief uses for the inline helper. Both compile and behave identically.
5. **`CashierView.tsx` UPDATE branch carries full `payload.new` shallow-merge** — the brief's snippet does `setter(prev => prev.map(x => x.id === id ? { ...x, ...(payload.new as any) } : x))`. This satisfies D7 consequence 2 because `items` / `bill` subtrees are preserved (spread copy of `x` first, then shallow overlay of the wire fields on top); the only case where `items` could be clobbered is if `payload.new` literally carries `items: ...`, which the broadcast does not send (it only sends `id`/`table_id`/`status`/`waiter_id` from the `orders` table; items are joined via the separate `order_items` SELECT in S2.3).
6. **`CashierView.tsx` INSERT branch does not populate `items`/`order_items`** — the brief's snippet gives the new order an empty `items: []`. CashierView renders order cards that fetch the items on demand (the current load path calls `orderService.getById(...)` for the full order), so the empty array is consistent with how the view already treats fresh inserts before the items SELECT resolves. Documented inline above the replacement.
7. **`KitchenView.tsx`: S5.5 replaces only the two specific invalidate calls**, not the full `setTables` whole-array replacement surface mentioned in `tasks.md` S5.5 (lines `:454, :680, :743, :788, :789`). The brief is explicit on scope — "remove the two `invalidateQueries` calls ... replace each with the comment ... Do NOT touch `KitchenView.tsx:538`". The `setTables` work was already completed by S3a/S3b; `grep -n "setTables(" components/views/KitchenView.tsx` returns matches only in the `loadInitialData` hydration path (out of S5 scope), and in narrow patch calls introduced by S3b. No `setTables(wholeArray)` pattern remains.

## S5.7 — grep verification (verbatim)

Command: `grep -rn "invalidateQueries" components/views/*.tsx`

```
components/views/AdminView.tsx:237:          // S5: replace the per-event invalidateQueries with a cache patch
components/views/CashierView.tsx:224:    queryClient.invalidateQueries({ queryKey: ['orders', 'cashier'] })
components/views/CashierView.tsx:247:      // S5: replace the per-event invalidateQueries with direct local-state
components/views/KitchenView.tsx:536:      await queryClient.invalidateQueries({ queryKey: ['orders', 'kitchen'] })
components/views/WaiterView.tsx:289:      // S5: payload-application replaces the per-event invalidateQueries.
components/views/order-apply.test.tsx:5: * `setQueryData` call, with zero `invalidateQueries` calls — proving that the
components/views/order-apply.test.tsx:42: * `['orders']` cache through `mergeOrdersList`. No `invalidateQueries` is
components/views/order-apply.test.tsx:65:describe("S5 — payload application replaces invalidateQueries (D7 consequence 2)", () => {
components/views/order-apply.test.tsx:86:    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
components/views/order-apply.test.tsx:117:    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
components/views/order-apply.test.tsx:145:    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")
```

Annotated:

| Match | Location | Inside realtime handler? | Status |
|---|---|---|---|
| `AdminView.tsx:237` | comment (S5 replacement marker) | n/a — comment only | expected |
| `CashierView.tsx:224` | `handleRefresh` (manual refresh button handler) | **no** — defined at line 219-225, invoked by the refresh button at line ~672 | **out of S5 scope**, per brief |
| `CashierView.tsx:247` | comment (S5 replacement marker) | n/a — comment only | expected |
| `KitchenView.tsx:536` | manual refresh handler at line ~531-537 (`handleRefresh`) | **no** — explicit manual button handler, brief said "Do NOT touch `KitchenView.tsx:538`" | **out of S5 scope** |
| `WaiterView.tsx:289` | comment (S5 replacement marker) | n/a — comment only | expected |
| `order-apply.test.tsx:5,42,65,86,117,145` | test file | n/a — `vi.spyOn` asserts the negative | expected (test asserts it is **not** called) |

**Zero `invalidateQueries` calls remain inside any `subscribeToOrders` / `postgres_changes` handler body.** Both remaining actual calls sit inside manual-refresh handlers invoked by user click, not by a realtime event — exactly as scoped.

## Verification (S5.8 — verbatim outputs)

### `npx tsc --noEmit 2>&1 | grep -c "error TS"`

```
0
```

(Was `2` before STEP 0 — both were `OrderItem` literal-assignment errors in `lib/realtime/order-merge.test.ts`. Now `0`.)

### `npm run lint`

Exit code: **0**

Warning count: **101** (matches the S3b / S4 baseline exactly — no new warnings introduced by this slice).

Error count: **0**.

### `npm run build`

Exit code: **0**.

```
Route (app)                                 Size  First Load JS
┌ ƒ /                                     617 kB         734 kB
└ ƒ /_not-found                            984 B         102 kB
+ First Load JS shared by all             101 kB
  ├ chunks/268-180fc423b75b7f77.js         46 kB
  ├ chunks/a69276e9-955eaec1d5f8c022.js  53.3 kB
  └ other shared chunks (total)          1.98 kB

ƒ  (Dynamic)  server-rendered on demand
```

(`next.config` sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` — green build does not by itself imply clean typecheck, so both were verified independently above.)

### `npm test`

```
 RUN  v5.0.1 /home/ahernand/projects/vipe-pos-system


 Test Files  7 passed (7)
      Tests  52 passed (52)
   Start at  16:40:16
   Duration  1.84s (environment 59%, import 12%, transform 12%, setup 11%, tests 6%)
```

- 49 pre-existing (S1+S2+S3a+S3b+S4 baseline)
- 3 new in `components/views/order-apply.test.tsx` (UPDATE, DELETE, INSERT scenarios — all green)
- All other test files unchanged and still green

## Line footprint

`git diff --stat` against the S4 tip (`e6a9510`), S5-relevant files only:

```
 components/views/AdminView.tsx                     | 27 ++++++++++--
 components/views/CashierView.tsx                   | 49 ++++++++++++++++++++--
 components/views/KitchenView.tsx                   |  6 +--
 components/views/WaiterView.tsx                    | 27 +++++++++++-
 openspec/changes/optimizar-arquitectura-realtime/tasks.md | 16 +++----
```

- **125 lines** of production + tasks.md changes (S5-relevant)
- **170 lines** new test file `components/views/order-apply.test.tsx`
- **+14 lines** new helper / import in `lib/realtime/order-merge.test.ts` (STEP 0)
- **Total authored: ~309 lines**, against the ~240-line forecast and the 400-line review budget — under budget, no `size:exception` needed.

The overage vs. forecast is concentrated in `CashierView.tsx` (+49 lines, vs. the brief's ~30-line inline replacement) because of the 5-state direct-mutation pattern required by the cache-derivation shape (`activeOrders` / `kitchenOrders` / `deliveredOrders` / `partialOrders` / `ordersByTable`) and the explicit D7 consequence 2 comment block the brief requested above the replacement.

## Files NOT touched (out of scope)

The following pre-existing files are in the working tree but were authored outside this slice's scope and are preserved untouched:

- `.atl/.skill-registry.cache.json`, `.atl/skill-registry.md`, `.gitignore` — pre-existing tooling state present before S5 started (not staged or modified by this slice).
- `.codegraph/`, `.env.local`, `.runtime/`, `docs/PRESENTACION-COMERCIAL.md`, `odd/` — untracked, unrelated.
- `lib/supabase/realtime-service.ts` — S2's contract comment at lines 262-265 is confirmed present and is the canonical anchor for S5.1's restatement. No edit needed in this file.
- `lib/realtime/order-merge.ts` — pre-existing building block authored by the orchestrator before this slice started. Untouched.
- `lib/realtime/table-merge.ts`, `lib/realtime/table-merge.test.ts`, `store/useTableStore.ts`, `store/useTableStore.test.ts`, `components/admin/tables/TableManagementPanel.tsx`, `components/pos/TableGrid.tsx`, `components/pos/TableGrid.test.tsx`, `components/admin/CompletedOrdersTable.tsx`, `components/views/table-fanout.test.tsx`, `app/page.tsx` — all S3a/S3b/S4 territory, untouched.

## Pending — S5.8's manual recipe (not verifiable by this agent)

S5.8's automated checks (lint, tsc, build, `npm test`) all pass, recorded above. Its manual half — **not run, not simulated, not ticked**:

1. Start the dev server, open three browser tabs: Waiter, Cashier, Admin, each signed in with an appropriate role.
2. In Waiter, place a new order (or flip an existing one's status).
3. In Cashier: confirm the order appears in the active/kitchen/delivered column as appropriate, no skeleton repaint, no flicker, and the "Órdenes Activas" → "Parciales" / "Por Mesa" groupings update.
4. In Admin: confirm the "Resumen" tab's counters update (`newOrdersCount` ticks up by 1 on INSERT), the "Órdenes Activas" tab's card list reflects the change, and the INSERT/DELETE toasts fire correctly.
5. Repeat with a rapid sequence of 2-3 order events to confirm no accumulated staleness and that DELETE also clears the row from the "Órdenes Activas" list.

The S5.6 integration test (`order-apply.test.tsx`) proves the payload-application pattern produces exactly one `setQueryData` and zero `invalidateQueries` for UPDATE, DELETE, and INSERT under jsdom with a stubbed `realtimeService`. It does not prove three real screens behave correctly under live multi-client Supabase Realtime traffic — that requires this manual recipe.

## Commits

`<pending orchestrator commit>`

## Status

S5.1–S5.7: **done**, all automated checks green. S5.8: automated half done; manual half pending human verification per the steps listed. `engram_write: pending` (the package's memory protocol is not in scope for this writer; the orchestrator owns the engram mirror after commit).