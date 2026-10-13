/**
 * T9 (S1) — the Configuración sub-tab reads, one cache slot per data set.
 *
 * Audit row: "admin | config sub-tabs | each list reloads on every visit (no
 * cache)". Radix unmounts an inactive `TabsContent`, so every sub-tab list
 * remounted — and re-read — each time the admin went back to it. The Menú tab
 * read `categories` TWICE on each visit (`CategoryList` and again inside
 * `DishList`), and the Dashboard's low-stock alert read the whole
 * `ingredients` table separately from the Inventario sub-tab.
 *
 * Rules this module encodes:
 *   - one exported key per data set, shared by every reader (a second reader is
 *     a cache hit, never a second request), grouped by prefix so a mutation can
 *     invalidate the family it affects;
 *   - a stale window (`ADMIN_LIST_STALE_MS`) long enough that revisiting a
 *     sub-tab inside it costs zero requests and, because the cached rows are
 *     still there, never blanks the list.
 */
import { supabase } from "@/lib/supabase/client"
import { ingredientCategoryService, ingredientService } from "@/lib/supabase/service"
import { promotionService, type Promotion } from "@/lib/supabase/promotion-service"
import type { StaffRole } from "@/lib/supabase/staff-service"

/** Roles the Personal sub-tab manages. Admin accounts are provisioned elsewhere. */
export const ADMIN_STAFF_ROLES: readonly StaffRole[] = [
  "waiter",
  "kitchen",
  "cashier",
  "delivery_operator",
]

/**
 * How long a config list read is fresh: a tab switch inside this window is a
 * cache hit and the table stays rendered (no skeletons).
 */
export const ADMIN_LIST_STALE_MS = 60_000

/**
 * The cache slots. Menu reads share the `catalog/menu` prefix, inventory reads
 * share `inventory`, so `invalidateQueries({ queryKey: ["catalog", "menu"] })`
 * refreshes the whole family and nothing else.
 */
export const catalogKeys = {
  categories: ["catalog", "menu", "categories"] as const,
  dishes: ["catalog", "menu", "dishes"] as const,
  promotions: ["catalog", "menu", "promotions"] as const,
  staff: ["catalog", "staff"] as const,
  ingredients: ["inventory", "ingredients"] as const,
  ingredientCategories: ["inventory", "ingredient-categories"] as const,
}

/** The message an admin list shows when its read failed. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function fetchCategories(): Promise<any[]> {
  const { data, error } = await supabase.from("categories").select("*").order("name")

  if (error) throw error
  return data || []
}

export async function fetchDishes(): Promise<any[]> {
  const { data, error } = await supabase.from("dishes").select("*").order("name")

  if (error) throw error
  return data || []
}

export async function fetchPromotions(): Promise<Promotion[]> {
  return (await promotionService.getAllPromotions()) as Promotion[]
}

export async function fetchStaff(): Promise<any[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .in("role", [...ADMIN_STAFF_ROLES])
    .order("full_name")

  if (error) throw error
  return data || []
}

export async function fetchIngredients(): Promise<any[]> {
  return (await ingredientService.getAll()) as any[]
}

export async function fetchIngredientCategories(): Promise<any[]> {
  return (await ingredientCategoryService.getAll()) as any[]
}

/**
 * The category NAME the inventory list renders next to every ingredient.
 *
 * Unchanged behaviour (same "Sin categoría" fallback the list showed), just
 * out of the component so it can be tested without a component.
 */
export function withCategoryName<T extends { category_id?: string | null }>(
  ingredient: T,
  categories: readonly { id: string; name: string }[],
): T & { category: string } {
  const category = categories.find((candidate) => candidate.id === ingredient.category_id)

  return { ...ingredient, category: category?.name || "Sin categoría" }
}