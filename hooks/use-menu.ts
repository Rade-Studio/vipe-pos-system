"use client"

/**
 * Menu reads as React Query, keyed by category (T6/S1/S2).
 *
 * `MenuSection` used to own its loading flags and read categories, the dishes of
 * one category and the whole `promotion_dishes` table on every mount — and it was
 * remounted on every table selection. With the cache, a remount reads what is
 * already there (no skeletons, no request) and switching category keeps the
 * previous dishes on screen while the next ones load.
 *
 * The stock check is keyed by the exact set of dishes on screen, so one batched
 * read serves a whole category (see `checkStockForDishes`, `POST /inventory/dish-availability`).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { checkStockForDishes } from "@/lib/api/inventory"
import { fetchCategories, fetchDishes } from "@/lib/api/catalog"
import type { Category, Dish } from "@/types"

export const menuCategoriesKey = ["menu", "categories"] as const
export const menuDishesKey = (categoryId: string) => ["menu", "dishes", categoryId] as const
/** Order-independent, so the same dish set always hits the same cache entry. */
export const dishStockKey = (dishIds: readonly string[]) => ["menu", "stock", [...dishIds].sort()] as const

const DISH_PLACEHOLDER = "/placeholder.svg?height=80&width=80"

// The category icon is a Lucide name the selector resolves; `Category.icon` is
// typed as an element, as it was before the API.
export const fetchMenuCategories = async (): Promise<Category[]> =>
  (await fetchCategories({ active: true })) as unknown as Category[]

/**
 * Active dishes of a category with the promotion pricing the server applies
 * (T7b): `price` is the list price and the promotion fields (name, badge,
 * window end, `promoPrice`) come from the API (S8). Only the image placeholder is added for the grid.
 */
export const fetchMenuDishes = async (categoryId: string): Promise<Dish[]> => {
  const dishes = await fetchDishes({ categoryId, active: true, pricing: "promotions" })
  return dishes.map((dish) => ({
    ...dish,
    categoryId: dish.categoryId ?? "",
    image: dish.imageUrl || DISH_PLACEHOLDER,
  })) as unknown as Dish[]
}

export function useMenuCategories() {
  return useQuery<Category[]>({
    queryKey: menuCategoriesKey,
    queryFn: fetchMenuCategories,
  })
}

/**
 * Dishes of the selected category. `keepPreviousData` is what removes the
 * flicker on a category switch: the previous dishes stay mounted until the new
 * ones arrive, and `isPending` is only true on the very first load.
 */
export function useMenuDishes(categoryId: string | null) {
  return useQuery<Dish[]>({
    queryKey: menuDishesKey(categoryId ?? ""),
    queryFn: () => fetchMenuDishes(categoryId as string),
    enabled: Boolean(categoryId),
    placeholderData: keepPreviousData,
  })
}

/** One batched availability read for every dish on screen; none when disabled. */
export function useDishStockStatus(dishIds: readonly string[], enabled: boolean) {
  return useQuery<Map<string, boolean>>({
    queryKey: dishStockKey(dishIds),
    queryFn: () => checkStockForDishes([...dishIds]),
    enabled: enabled && dishIds.length > 0,
  })
}