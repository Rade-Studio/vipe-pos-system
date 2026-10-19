/**
 * Shaping of the inventory dashboard data (T11): daily series, waste share,
 * reorder rows by urgency and top consumed shares.
 */

import type { InventoryItem, InventoryOverview } from "@/lib/supabase/inventory/types"
import { reorderQuantity, stockStatus } from "./stock"

export type SeriesPoint = InventoryOverview["series"][number]
export type TopConsumed = InventoryOverview["topConsumed"][number]

const pad = (n: number) => String(n).padStart(2, "0")
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** One point per calendar day for the `days` days ending `today`; missing days are zeros. */
export function fillSeries(series: SeriesPoint[], days: number, today: Date = new Date()): SeriesPoint[] {
  const byDate = new Map(series.map((point) => [point.date.slice(0, 10), point]))
  const result: SeriesPoint[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset))
    const point = byDate.get(date)
    result.push({ date, inValue: point?.inValue ?? 0, outValue: point?.outValue ?? 0, wasteValue: point?.wasteValue ?? 0 })
  }
  return result
}

/** Waste as a percentage of consumption; null when nothing was consumed. */
export function wastePercent(wasteValue: number, consumptionValue: number): number | null {
  return consumptionValue > 0 ? (wasteValue / consumptionValue) * 100 : null
}

const toStockItem = (item: InventoryItem) => ({
  stock: item.stock,
  min_stock: item.minStock,
  max_stock: item.maxStock,
  purchase_factor: item.purchaseFactor,
})

export interface ReorderRow {
  item: InventoryItem
  status: "out" | "low"
  /** Suggested purchase in base units. */
  suggested: number
  /** The suggestion in purchase units, when the item has a purchase unit. */
  suggestedPurchaseUnits: number | null
}

/** Active items whose reorder suggestion is positive: agotados first, then the lowest stock/min ratio. */
export function reorderRows(items: InventoryItem[]): ReorderRow[] {
  const rows: (ReorderRow & { ratio: number })[] = []
  for (const item of items) {
    if (!item.isActive) continue
    const suggested = reorderQuantity(toStockItem(item))
    if (suggested <= 0) continue
    const status = stockStatus(toStockItem(item)) as "out" | "low"
    const factor = item.purchaseFactor
    rows.push({
      item,
      status,
      suggested,
      suggestedPurchaseUnits: item.purchaseUnit && factor > 0 ? suggested / factor : null,
      ratio: item.minStock > 0 ? item.stock / item.minStock : item.stock,
    })
  }
  rows.sort(
    (a, b) =>
      Number(b.status === "out") - Number(a.status === "out") || a.ratio - b.ratio || a.item.name.localeCompare(b.item.name),
  )
  return rows.map(({ ratio: _ratio, ...row }) => row)
}

/** Counts of agotados / bajo mínimo and the `limit` most urgent rows. */
export function stockAlerts(items: InventoryItem[], limit = 5) {
  const rows = reorderRows(items)
  return {
    outCount: rows.filter((row) => row.status === "out").length,
    lowCount: rows.filter((row) => row.status === "low").length,
    rows: rows.slice(0, limit),
  }
}

/** Top `limit` consumed items by value with their share (0–1) of the whole consumption. */
export function topConsumedShares(rows: TopConsumed[], limit = 10): (TopConsumed & { share: number })[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return [...rows]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row) => ({ ...row, share: total > 0 ? row.value / total : 0 }))
}
