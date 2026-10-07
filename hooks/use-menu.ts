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
 * read serves a whole category (see `inventoryControlService.checkStockForDishes`).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import inventoryControlService from "@/lib/supabase/inventory-control-service"
import { categoryService } from "@/lib/supabase/service"
import { dishServiceWithPromotions } from "@/lib/supabase/dish-service-with-promotions"
import type { Category, Dish } from "@/types"

export const menuCategoriesKey = ["menu", "categories"] as const
export const menuDishesKey = (categoryId: string) => ["menu", "dishes", categoryId] as const
/** Order-independent, so the same dish set always hits the same cache entry. */
export const dishStockKey = (dishIds: readonly string[]) => ["menu", "stock", [...dishIds].sort()] as const

export const fetchMenuCategories = async (): Promise<Category[]> => {
  const data = await categoryService.getAllActive()
  return data.map((category) => ({
    id: category.id,
    name: category.name,
    // Asumiendo que el icono se guarda como string
    icon: category.icon || null,
  })) as unknown as Category[]
}

export const fetchMenuDishes = async (categoryId: string): Promise<Dish[]> => {
  const data = await dishServiceWithPromotions.getByCategoryWithPromotions(categoryId)

  return data.map((dish: any) => ({
    id: dish.id,
    name: dish.name,
    price: dish.price,
    categoryId: dish.category_id ?? "",
    image: dish.image_url || "/placeholder.svg?height=80&width=80",
    // Añadir campos de promoción si existen
    originalPrice: dish.originalPrice ?? null,
    discountAmount: dish.discountAmount ?? null,
    discountPercentage: dish.discountPercentage ?? null,
    promotionId: dish.promotionId ?? null,
    promotionName: dish.promotionName ?? null,
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
    queryFn: () => inventoryControlService.checkStockForDishes([...dishIds]),
    enabled: enabled && dishIds.length > 0,
  })
}