"use client"

/**
 * The menu of the step picker (T10, S5) as React Query, keyed
 * `['menu', 'tree']`: categories → subcategories → dishes with promotion
 * prices and stock availability, the same for the waiter and delivery (T11).
 * The tree's active dishes without category (`uncategorized`, T20) are shown
 * as a last "Otros" category with their real availability. The key sits under
 * `['menu']`, so a price-changed reload refreshes it.
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { getMenuTree, type MenuTreeCategoryDto, type MenuTreeDto } from "@/lib/api/catalog"
import { withUncategorized } from "@/lib/order-steps/menu"

export const MENU_TREE_KEY = ["menu", "tree"] as const

/** `enabled: false` reads nothing (the waiter screen before "Agregar productos"). */
export function useMenuTree({ enabled = true }: { enabled?: boolean } = {}) {
  const tree = useQuery<MenuTreeDto>({
    queryKey: MENU_TREE_KEY,
    queryFn: () => getMenuTree(),
    enabled,
  })

  const categories = useMemo<MenuTreeCategoryDto[] | undefined>(
    () => (tree.data ? withUncategorized(tree.data.categories, tree.data.uncategorized) : undefined),
    [tree.data],
  )

  return {
    categories,
    isError: tree.isError,
    refetch: () => {
      void tree.refetch()
    },
  }
}
