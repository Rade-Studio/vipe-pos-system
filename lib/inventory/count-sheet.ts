/**
 * Row model of a physical count sheet (odd/tasks/admin-dashboard-inventario.md,
 * T10). Applying a count sets the location balance to the counted quantity, so
 * the difference is counted − expected; uncounted lines stay unchanged.
 */

import type { CountLine } from "@/lib/supabase/inventory/types"

export interface CountSheetRow {
  lineId: string
  itemId: string
  sku: string
  name: string
  unit: string
  expected: number
  counted: number | null
  unitCost: number
  /** null while the line is not counted. */
  difference: number | null
  differenceValue: number | null
}

export type CountRowFilter = "pending" | "diff" | "all"

const round = (value: number, digits: number) => {
  const f = 10 ** digits
  const rounded = Math.round(value * f) / f
  return rounded === 0 ? 0 : rounded
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

export function buildCountRows(lines: CountLine[], costById: Map<string, number>): CountSheetRow[] {
  return lines.map((line) => {
    const unitCost = costById.get(line.itemId) ?? 0
    const difference = line.countedQuantity === null ? null : round(line.countedQuantity - line.expectedQuantity, 3)
    return {
      lineId: line.id,
      itemId: line.itemId,
      sku: line.sku ?? "",
      name: line.itemName ?? "",
      unit: line.unit ?? "",
      expected: line.expectedQuantity,
      counted: line.countedQuantity,
      unitCost,
      difference,
      differenceValue: difference === null ? null : round(difference * unitCost, 2),
    }
  })
}

export function countProgress(rows: CountSheetRow[]): { counted: number; total: number; percent: number } {
  const counted = rows.filter((row) => row.counted !== null).length
  const total = rows.length
  return { counted, total, percent: total === 0 ? 0 : Math.round((counted / total) * 100) }
}

export function filterCountRows(rows: CountSheetRow[], filter: CountRowFilter, query: string): CountSheetRow[] {
  const needle = fold(query.trim())
  return rows.filter((row) => {
    if (filter === "pending" && row.counted !== null) return false
    if (filter === "diff" && (row.difference === null || row.difference === 0)) return false
    return !needle || fold(row.name).includes(needle) || fold(row.sku).includes(needle)
  })
}

export function countApplySummary(rows: CountSheetRow[]): {
  counted: number
  uncounted: number
  linesWithDifference: number
  valueDelta: number
} {
  const { counted, total } = countProgress(rows)
  const withDifference = rows.filter((row) => row.difference !== null && row.difference !== 0)
  return {
    counted,
    uncounted: total - counted,
    linesWithDifference: withDifference.length,
    valueDelta: round(withDifference.reduce((sum, row) => sum + (row.differenceValue ?? 0), 0), 2),
  }
}
