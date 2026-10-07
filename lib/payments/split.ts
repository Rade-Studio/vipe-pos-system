/**
 * Pure selection helpers for the split-order flow.
 *
 * Two responsibilities, both consumed by the cashier UI before it ever
 * talks to the server:
 *
 *  - `pickSplitParent` chooses which order on the table is a valid
 *    parent for a new child (a partial order). The server's
 *    `split_order` RPC only accepts a parent that is non-partial and
 *    in active|kitchen|delivered, so the picker mirrors that exactly.
 *    When more than one non-partial candidate exists the picker
 *    returns `null` and the UI asks the cashier to disambiguate rather
 *    than guessing.
 *
 *  - `buildSplitItems` turns the cashier's checkbox + stepper state
 *    into the wire payload for `split_order`. It mirrors the server's
 *    checks so the cashier gets instant feedback instead of a SQL
 * round-trip: drops zero quantities, rejects unknown ids, refuses
 * quantities above the parent's available quantity, rejects moving
 * every line in full (the server says "pay the order instead" in that
 * case), and caps at 50 lines.
 *
 * No Supabase, no DOM, no zustand: this file is node-testable and
 * stays deterministic.
 */

export const SPLIT_MAX_LINES = 50

export interface ParentItem {
  id: string
  quantity: number
}

export interface ParentCandidate {
  id: string
  isPartialOrder: boolean
  status: string
}

export type SplitItemsError =
  | 'empty'
  | 'over-quantity'
  | 'unknown-item'
  | 'moves-everything'
  | 'too-many-lines'

export type SplitItemsResult =
  | { items: { order_item_id: string; quantity: number }[] }
  | { error: SplitItemsError }

const SPLITTABLE_STATUSES = new Set(['active', 'kitchen', 'delivered'])

/**
 * Return the unique non-partial order in active|kitchen|delivered.
 * Returns `null` when there is no candidate or when more than one
 * candidate exists (the cashier must pick one explicitly rather than
 * letting the UI guess).
 */
export function pickSplitParent(orders: ParentCandidate[]): string | null {
  let foundId: string | null = null
  for (const o of orders) {
    if (o.isPartialOrder) continue
    if (!SPLITTABLE_STATUSES.has(o.status)) continue
    if (foundId !== null) return null // a second candidate → ambiguous
    foundId = o.id
  }
  return foundId
}

/**
 * Convert the cashier's selection (`Record<itemId, qty>`) into the
 * server's wire payload. Returns a typed error string instead of
 * throwing so the UI can render the message inline.
 *
 * Errors are checked in a fixed order: empty / over-quantity /
 * unknown-item are unambiguous; `moves-everything` is checked last so
 * the cashier can fix a quantity instead of seeing the unhelpful
 * "pay the order instead" message when only one line is over-quantity.
 */
export function buildSplitItems(
  parentItems: ParentItem[],
  selection: Record<string, number>,
): SplitItemsResult {
  // Build a map once for O(1) lookups; preserves the parent's order.
  const byId = new Map<string, ParentItem>()
  for (const item of parentItems) byId.set(item.id, item)

  // Two-pass validation: first check shape errors (unknown ids,
  // over-quantity) before deciding emptiness, so the cashier sees the
  // real reason instead of a generic "empty".
  let overQtySeen = false
  for (const [id, requested] of Object.entries(selection)) {
    if (requested === 0) continue
    const parent = byId.get(id)
    if (!parent) continue // handled in the unknown-id pass below
    if (!Number.isInteger(requested) || requested < 0 || requested > parent.quantity) {
      overQtySeen = true
    }
  }

  for (const id of Object.keys(selection)) {
    if (!byId.has(id)) {
      return { error: 'unknown-item' }
    }
  }

  const lines: { order_item_id: string; quantity: number }[] = []
  for (const parent of parentItems) {
    const requested = selection[parent.id]
    if (requested === undefined || requested === 0) continue
    if (!Number.isInteger(requested) || requested < 0) continue
    if (requested > parent.quantity) continue
    lines.push({ order_item_id: parent.id, quantity: requested })
  }

  if (overQtySeen) return { error: 'over-quantity' }
  if (lines.length === 0) return { error: 'empty' }
  if (lines.length > SPLIT_MAX_LINES) return { error: 'too-many-lines' }

  // "moves-everything" means the child would carry every parent line
  // at full quantity, which the server rejects with "pay the order
  // instead". Two checks are needed: the line count must match the
  // parent (otherwise something is staying behind) AND every line
  // must be at the parent's available quantity.
  if (lines.length === parentItems.length) {
    const movesEverything = lines.every((line) => {
      const parent = byId.get(line.order_item_id)
      return parent !== undefined && line.quantity === parent.quantity
    })
    if (movesEverything) return { error: 'moves-everything' }
  }

  return { items: lines }
}