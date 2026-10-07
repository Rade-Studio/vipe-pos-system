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
 *   initial hydration). Putting the wire→app conversion in this module would
 *   couple pure merge logic to React Query/SWR/Supabase and lose the
 *   "reference-stable on no-op" testability that the table sibling has.
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
