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
import type { QueryClient } from "@tanstack/react-query"
import {
  fetchCategories as listCategories,
  fetchDishes as listDishes,
  fetchPromotions as listPromotions,
  type CategoryDto,
  type DishDto,
  type PromotionDto,
} from "@/lib/api/catalog"
import { listStaff, type StaffMember, type StaffRole } from "@/lib/api/staff"

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
 * The cache slots. Menu reads share the `catalog/menu` prefix, so `invalidateQueries({ queryKey: ["catalog", "menu"] })`
 * refreshes the whole family and nothing else.
 */
export const catalogKeys = {
  categories: ["catalog", "menu", "categories"] as const,
  dishes: ["catalog", "menu", "dishes"] as const,
  promotions: ["catalog", "menu", "promotions"] as const,
  staff: ["catalog", "staff"] as const,
}

/** The message an admin list shows when its read failed. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every category (active or not), ordered by name. */
export async function fetchCategories(): Promise<CategoryDto[]> {
  return listCategories()
}

/** Every dish at its list price, ordered by name. */
export async function fetchDishes(): Promise<DishDto[]> {
  return listDishes()
}

export async function fetchPromotions(): Promise<PromotionDto[]> {
  return listPromotions()
}

/**
 * After an admin catalog write: refresh the admin list that changed and every
 * menu the POS and delivery screens cache, so a new dish, a renamed category or
 * a promotion price shows there without a reload (T7b).
 */
export function invalidateCatalogReaders(queryClient: QueryClient, adminKey: readonly unknown[]) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: adminKey }),
    queryClient.invalidateQueries({ queryKey: ["menu"] }),
    queryClient.invalidateQueries({ queryKey: ["delivery-menu-categories"] }),
    queryClient.invalidateQueries({ queryKey: ["delivery-menu-dishes"] }),
  ])
}

/**
 * The members the Personal sub-tab manages, by name. `GET /staff` also lists
 * the admins, which are provisioned elsewhere and never shown here.
 */
export async function fetchStaff(): Promise<StaffMember[]> {
  const members = await listStaff()
  return members.filter((member) => (ADMIN_STAFF_ROLES as readonly string[]).includes(member.role))
}
