"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormulas, useInventoryItems } from "@/hooks/inventory"
import { ADMIN_LIST_STALE_MS, catalogKeys, fetchDishes } from "@/lib/admin/catalog"
import { formulaCost, type FormulaItem, type PrepFormula } from "@/lib/inventory/formula"
import type { FormulaIndex, InventoryItem } from "@/lib/supabase/inventory/types"

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
 * Items keyed by id, with each preparation's cost replaced by its formula's
 * live cost per unit (raw materials keep their stored cost).
 */
export function costedItems(items: FormulaItem[], prepFormulas: Map<string, PrepFormula>): Map<string, FormulaItem> {
  const base = new Map(items.map((item) => [item.id, item]))
  const result = new Map<string, FormulaItem>()
  const resolving = new Set<string>()

  const resolve = (id: string): FormulaItem | undefined => {
    const cached = result.get(id)
    if (cached) return cached
    const item = base.get(id)
    if (!item) return undefined
    const formula = item.kind === "prep" ? prepFormulas.get(id) : undefined
    if (!formula || formula.lines.length === 0 || resolving.has(id)) {
      result.set(id, item)
      return item
    }
    resolving.add(id)
    const lineItems = new Map<string, FormulaItem>()
    for (const line of formula.lines) {
      const child = resolve(line.ingredientId)
      if (child) lineItems.set(child.id, child)
    }
    resolving.delete(id)
    const costed = { ...item, cost: formulaCost(formula.lines, lineItems, formula.yieldQuantity).perUnit }
    result.set(id, costed)
    return costed
  }

  for (const item of items) resolve(item.id)
  return result
}
