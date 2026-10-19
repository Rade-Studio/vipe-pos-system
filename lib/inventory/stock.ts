/**
 * Inventory math: stock levels, reorder suggestions, lot expiry and purchase
 * grouping. Quantities are in the item's base unit.
 */

export interface StockItem {
  stock: number
  min_stock: number
  max_stock: number | null
  purchase_factor: number | null
}

export function stockStatus(item: StockItem): "out" | "low" | "ok" | "over" {
  if (item.stock <= 0) return "out"
  if (item.stock <= item.min_stock) return "low"
  if (item.max_stock !== null && item.stock > item.max_stock) return "over"
  return "ok"
}

/** Suggested purchase in base units, rounded up to whole purchase units. */
export function reorderQuantity(item: StockItem): number {
  const status = stockStatus(item)
  if (status !== "out" && status !== "low") return 0
  const target = item.max_stock ?? item.min_stock * 2
  const need = target - Math.max(item.stock, 0)
  if (need <= 0) return 0
  const factor = item.purchase_factor
  return factor !== null && factor > 0 ? Math.ceil(need / factor) * factor : need
}

const MS_PER_DAY = 86_400_000

/** Calendar days from `today` (local date) to an ISO `YYYY-MM-DD` date. */
export function daysUntil(expiresOn: string, today: Date): number {
  const [year, month, day] = expiresOn.slice(0, 10).split("-").map(Number)
  // UTC midnights of both calendar dates avoid DST and timezone drift.
  const target = Date.UTC(year, month - 1, day)
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target - base) / MS_PER_DAY)
}

export function expiryStatus(
  expiresOn: string | null,
  today: Date,
  soonDays = 7,
): "none" | "expired" | "soon" | "ok" {
  if (!expiresOn) return "none"
  const days = daysUntil(expiresOn, today)
  if (days < 0) return "expired"
  if (days <= soonDays) return "soon"
  return "ok"
}

export function groupBySupplier<T extends { default_supplier_id: string | null }>(
  items: T[],
): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    const group = groups.get(item.default_supplier_id)
    if (group) group.push(item)
    else groups.set(item.default_supplier_id, [item])
  }
  return groups
}
