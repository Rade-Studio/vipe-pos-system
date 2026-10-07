/**
 * lib/realtime/order-merge.ts
 *
 * Pure merge/patch for `Order` lists driven by `postgres_changes` payloads
 * (slice S5, design D7, requirement R-2 consumer-side). The companion to
 * `lib/realtime/table-merge.ts`.
 *
 * IMPORTANT SHAPE NOTES
 * ---------------------
 * - This module speaks the application's `Order` shape (camelCase fields:
 *   `tableId`, `items`, etc.). Wire-shape payloads from `postgres_changes`
 *   use snake_case (`table_id`, `order_items`, etc.) — the snake_case→camelCase
 *   conversion lives one level up, at the call site (each view already has an
 *   inline `convertDBOrderToAppOrder` / `convertDbOrderToStoreOrder` for
 *   initial hydration). `wireRowToPartialOrder` is that one-level-up mapping,
 *   shared by every realtime patch so the delivery invariant
 *   (`orderType: orderTypeFromRow(row)`, odd/tasks/domicilios.md S13/S14) is
 *   applied once instead of per view. Putting the wire→app conversion inside
 *   the merge functions themselves would couple pure merge logic to
 *   React Query/SWR/Supabase and lose the "reference-stable on no-op"
 *   testability that the table sibling has.
 * - The exact reference-identity contract carries over: every no-op row in
 *   the D7 behaviour table returns the *identical* `prev` reference, so a
 *   Zustand `Object.is` short-circuit or React Query's `setQueryData`
 *   skip-suppression both produce zero downstream re-renders.
 *
 * INVARIANT (same as the table sibling)
 * --------------------------------------
 * - `mergeOrdersList(prev, payload)` returns the IDENTICAL `prev` reference
 *   unless `payload` actually changes the list.
 * - `payload.new` carrying `id` but no other Order fields (only status, only
 *   tableId, etc.) merges onto the existing row by id, preserving the
 *   untouched subtrees (e.g. an UPDATE carrying `status` keeps the same
 *   `items`, `bill`, `waiter` references).
 * - On error/retry duplicates (two INSERTs for the same `id`, two UPDATEs
 *   with the same content, etc.), the function returns `prev` unchanged.
 */
import { isDeliveryOrder, orderTypeFromRow, ordersForWaiter } from "@/lib/delivery/kitchen"
import type { Order } from "@/types"

/**
 * Structural shape of an `Order`-typed `postgres_changes` payload, after
 * snake_case→camelCase conversion at the call site. Only `id` and
 * `eventType` are required; everything else is optional so partial UPDATEs
 * (e.g. status-only changes the broadcast layer might produce) merge
 * cleanly without forcing callers to reconstruct a full Order.
 */
export interface OrderChange {
  eventType: "INSERT" | "UPDATE" | "DELETE" | string
  new?: Partial<Order> | null
  old?: Partial<Order> | null
}

/**
 * Behaviour table (D7, mirrors the D10 table sibling):
 *
 *   event      condition                              result
 *   ---------  ------------------------------------   ---------------------------
 *   INSERT     new.id present, id not in prev         new array, row appended
 *   INSERT     new.id present, id already in prev     prev (idempotent)
 *   INSERT     new.id absent/null                     prev
 *   UPDATE     new.id present, id in prev             new array, that one row
 *                                                       replaced (other refs preserved)
 *   UPDATE     new.id present, id not in prev         prev (dropped, not upserted)
 *   UPDATE     new.id absent/null                     prev
 *   DELETE     old.id present, id in prev             new array, row filtered out
 *   DELETE     old.id present, id not in prev         prev
 *   DELETE     old.id absent/null                     prev
 *   *          any other eventType                    prev
 */
export function mergeOrdersList(prev: readonly Order[], change: OrderChange): Order[] {
  const { eventType } = change

  if (eventType === "INSERT") {
    const newRow = change.new
    if (!newRow || newRow.id == null) return prev as Order[]
    if (prev.some((o) => o.id === newRow.id)) return prev as Order[]
    return [...prev, newRow as Order]
  }

  if (eventType === "UPDATE") {
    const newRow = change.new
    if (!newRow || newRow.id == null) return prev as Order[]
    const idx = prev.findIndex((o) => o.id === newRow.id)
    if (idx === -1) return prev as Order[]
    const merged: Order = { ...prev[idx], ...newRow, id: prev[idx].id }
    return [...prev.slice(0, idx), merged, ...prev.slice(idx + 1)]
  }

  if (eventType === "DELETE") {
    const oldRow = change.old
    if (!oldRow || oldRow.id == null) return prev as Order[]
    const idx = prev.findIndex((o) => o.id === oldRow.id)
    if (idx === -1) return prev as Order[]
    return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
  }

  return prev as Order[]
}

/**
 * Waiter-side patch (odd/tasks/domicilios.md S13, carried through the realtime
 * path): a delivery order NEVER belongs in a waiter's order list.
 *
 * `fetchOrders` filters hydration with `ordersForWaiter`; this applies the same
 * rule to the in-place cache patch, so an INSERT of a delivery row cannot paint
 * itself into the waiter's list. Reference stability is preserved: when the
 * merge is a no-op the identical `prev` reference comes back, and the delivery
 * filter only allocates when a delivery row is actually present — so ordinary
 * dine-in events still produce zero downstream re-renders (design D6/D7).
 */
export function mergeOrdersForWaiter(prev: readonly Order[], change: OrderChange): Order[] {
  const next = mergeOrdersList(prev, change)
  if (next === prev) return prev as Order[]
  return next.some((order) => isDeliveryOrder(order)) ? ordersForWaiter(next) : next
}

/**
 * Wire (`postgres_changes` snake_case) row → camelCase `Partial<Order>`.
 *
 * This is the ONE mapping every consumer's realtime patch goes through, so the
 * delivery invariant holds uniformly (odd/tasks/domicilios.md S14): a wire row
 * carries `order_type`, and an app `Order` missing `orderType` renders as
 * "Mesa ?" wherever a delivery order is listed (OrderCard, invoicePlaceLabel).
 * Returns null when the row lacks the minimum `id` + `status` shape the merge
 * needs; every other field is optional so a partial UPDATE merges cleanly.
 */
export function wireRowToPartialOrder(dbRow: unknown): Partial<Order> | null {
  if (dbRow === null || typeof dbRow !== "object") return null
  const row = dbRow as {
    id?: unknown
    table_id?: unknown
    status?: unknown
    waiter_id?: unknown
  }
  if (!row.id || !row.status) return null
  return {
    id: row.id as Order["id"],
    tableId: (row.table_id as Order["tableId"]) ?? "",
    // D7 read-only contract: the payload is shared by reference across every
    // consumer — read it, never mutate it.
    orderType: orderTypeFromRow(row),
    status: row.status as Order["status"],
    ...(row.waiter_id !== undefined ? { waiter: row.waiter_id as Order["waiter"] } : {}),
  }
}
