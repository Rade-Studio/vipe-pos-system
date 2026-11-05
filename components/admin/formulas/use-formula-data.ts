"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormulas, useInventoryItems } from "@/hooks/inventory"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchDishes } from "@/lib/admin/catalog"
import { formulaCost, type FormulaItem, type PrepFormula } from "@/lib/inventory/formula"
import type { FormulaIndex, InventoryItem } from "@/lib/api/inventory/types"

export interface DishRow {
  id: string
  name: string
  price: number
}

const EMPTY_INDEX: FormulaIndex = { byDish: {}, byPrep: {} }

/** Menu dishes, inventory items and every saved formula. */
export function useFormulaData() {
  const itemsQuery = useInventoryItems()
  const formulasQuery = useFormulas()
  const dishesQuery = useQuery({ queryKey: catalogKeys.dishes, queryFn: fetchDishes, staleTime: ADMIN_LIST_STALE_MS })

  const dishes = useMemo<DishRow[]>(
    () =>
      (dishesQuery.data ?? []).map((row: any) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        price: Number(row.price ?? 0),
      })),
    [dishesQuery.data],
  )

  return {
    items: (itemsQuery.data ?? []) as InventoryItem[],
    formulas: formulasQuery.data ?? EMPTY_INDEX,
    dishes,
    isLoading: itemsQuery.isLoading || formulasQuery.isLoading || dishesQuery.isLoading,
  }
}

export function prepFormulaMap(index: FormulaIndex): Map<string, PrepFormula> {
  return new Map(
    Object.values(index.byPrep).map((formula) => [
      formula.targetId,
      { yieldQuantity: formula.yieldQuantity, lines: formula.lines },
    ]),
  )
}

/**
 * Items keyed by id, costed for the editor. Every item keeps its stored
 * `cost` (for a preparation, the weighted average production and receipts
 * keep), which is what `save_formula` and the server `Formula.unitCost` use;
 * only the drafts open in the editor (`drafts`) are costed live, as a
 * preview, over their children (drafts first, then stored costs).
 */
export function costedItems(items: FormulaItem[], drafts: Map<string, PrepFormula>): Map<string, FormulaItem> {
  const base = new Map(items.map((item) => [item.id, item]))
  const result = new Map<string, FormulaItem>()
  const resolving = new Set<string>()

  const resolve = (id: string): FormulaItem | undefined => {
    const cached = result.get(id)
    if (cached) return cached
    const item = base.get(id)
    if (!item) return undefined
    const draft = item.kind === "prep" ? drafts.get(id) : undefined
    if (!draft || draft.lines.length === 0 || resolving.has(id)) {
      result.set(id, item)
      return item
    }
    resolving.add(id)
    const lineItems = new Map<string, FormulaItem>()
    for (const line of draft.lines) {
      const child = resolve(line.ingredientId)
      if (child) lineItems.set(child.id, child)
    }
    resolving.delete(id)
    const costed = { ...item, cost: formulaCost(draft.lines, lineItems, draft.yieldQuantity).perUnit }
    result.set(id, costed)
    return costed
  }

  for (const item of items) resolve(item.id)
  return result
}
