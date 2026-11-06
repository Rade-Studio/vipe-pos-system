"use client"

/**
 * The menu of the step picker (T10, S5) as React Query, keyed
 * `['menu', 'tree']`: categories → subcategories → dishes with promotion
 * prices and stock availability, the same for the waiter and delivery (T11).
 * The tree has no place for the active dishes without category, so they are
 * read from the dishes list (`['menu', 'uncategorized']`) and shown as a last
 * "Otros" category. Both keys sit under `['menu']`, so a price-changed reload
 * refreshes them.
 */

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { fetchDishes, getMenuTree, type MenuTreeCategoryDto, type MenuTreeDto } from "@/lib/api/catalog"
import { withUncategorized } from "@/lib/order-steps/menu"

export const MENU_TREE_KEY = ["menu", "tree"] as const
export const MENU_UNCATEGORIZED_KEY = ["menu", "uncategorized"] as const

/** `enabled: false` reads nothing (the waiter screen before "Agregar productos"). */
export function useMenuTree({ enabled = true }: { enabled?: boolean } = {}) {
  const tree = useQuery<MenuTreeDto>({
    queryKey: MENU_TREE_KEY,
    queryFn: () => getMenuTree(),
    enabled,
  })
  const loose = useQuery({
    queryKey: MENU_UNCATEGORIZED_KEY,
    enabled,
    queryFn: async () => (await fetchDishes({ active: true, pricing: "promotions" })).filter((dish) => !dish.categoryId),
  })

  const categories = useMemo<MenuTreeCategoryDto[] | undefined>(
    // The extra category is a bonus: a failed dishes read must not hide the tree.
    () => (tree.data ? withUncategorized(tree.data.categories, loose.data ?? []) : undefined),
    [tree.data, loose.data],
  )

  return {
    categories,
    isError: tree.isError,
    refetch: () => {
      void tree.refetch()
      void loose.refetch()
    },
  }
}
