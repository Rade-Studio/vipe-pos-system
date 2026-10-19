import { formulaCost, scaleLines, type FormulaItem } from "@/lib/inventory/formula"
import type { Formula, InventoryItem } from "@/lib/supabase/inventory/types"

export interface RequirementRow {
  itemId: string
  name: string
  unit: string
  needed: number
  available: number
  missing: number
}

export interface ProductionPlan {
  rows: RequirementRow[]
  totalCost: number
  unitCost: number
  hasMissing: boolean
}

export const toFormulaItem = (item: InventoryItem): FormulaItem => ({
  id: item.id,
  name: item.name,
  kind: item.kind,
  unit: item.unit,
  cost: item.cost,
  stock: item.stock,
})

const round = (value: number) => Math.round(value * 10_000) / 10_000

/** Inputs needed to produce `quantity` of a prep: the formula scaled by quantity / yield. */
export function productionPlan(formula: Formula, quantity: number, itemsById: Map<string, FormulaItem>): ProductionPlan {
  const factor = formula.yieldQuantity > 0 && quantity > 0 ? quantity / formula.yieldQuantity : 0
  const scaled = scaleLines(formula.lines, factor)
  const rows = scaled.map((line) => {
    const item = itemsById.get(line.ingredientId)
    const available = Math.max(item?.stock ?? 0, 0)
    const needed = round(line.quantity)
    return {
      itemId: line.ingredientId,
      name: item?.name ?? "Artículo desconocido",
      unit: item?.unit ?? "",
      needed,
      available,
      missing: round(Math.max(needed - available, 0)),
    }
  })
  const { total } = formulaCost(scaled, itemsById)
  return {
    rows,
    totalCost: total,
    unitCost: quantity > 0 ? total / quantity : 0,
    hasMissing: rows.some((row) => row.missing > 0),
  }
}
