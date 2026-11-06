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
  getMenuDraft,
  getMenuPublication,
  type CategoryColor,
  type MenuPublicationDto,
  type MenuTreeDto,
  type CategoryDto,
  type DishDto,
  type PromotionDto,
} from "@/lib/api/catalog"
import { getAll as listSubcategories, type SubcategoryDto } from "@/lib/api/subcategories"
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
  subcategories: ["catalog", "menu", "subcategories"] as const,
  /** T27: the live structure the next publication serves, and the "n cambios sin publicar" status. */
  draft: ["catalog", "menu", "draft"] as const,
  publication: ["catalog", "menu", "publication"] as const,
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

/** Every subcategory (active or not), by category order, then sort order and name. */
export async function fetchSubcategories(): Promise<SubcategoryDto[]> {
  return listSubcategories({ includeInactive: true })
}

export async function fetchPromotions(): Promise<PromotionDto[]> {
  return listPromotions()
}

export async function fetchMenuDraft(): Promise<MenuTreeDto> {
  return getMenuDraft()
}

export async function fetchMenuPublication(): Promise<MenuPublicationDto> {
  return getMenuPublication()
}

/**
 * After an admin catalog write: refresh the admin list that changed and every
 * menu the POS and delivery screens cache, so a new dish, a renamed category or
 * a promotion price shows there without a reload (T7b).
 */
export function invalidateCatalogReaders(queryClient: QueryClient, adminKey: readonly unknown[]) {
  return Promise.all([queryClient.invalidateQueries({ queryKey: adminKey }), invalidateMenuReaders(queryClient)])
}

/**
 * The POS and delivery menus, plus the admin draft and its pending-change
 * count (T27): every structure write goes through here, so "n cambios sin
 * publicar" follows each edit. Alone, for a write whose admin list is already
 * up to date (a saved order).
 */
export function invalidateMenuReaders(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["menu"] }),
    queryClient.invalidateQueries({ queryKey: ["delivery-menu-categories"] }),
    queryClient.invalidateQueries({ queryKey: ["delivery-menu-dishes"] }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.draft }),
    queryClient.invalidateQueries({ queryKey: catalogKeys.publication }),
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

// ---- Menu tree editor (redesign T9) ------------------------------------------

/** The API's closed colour set, in the order the editor offers it. */
export const CATEGORY_COLORS: readonly { value: CategoryColor; label: string }[] = [
  { value: "neutral", label: "Neutro" },
  { value: "yellow", label: "Amarillo" },
  { value: "orange", label: "Naranja" },
  { value: "sky", label: "Cielo" },
  { value: "violet", label: "Violeta" },
  { value: "emerald", label: "Esmeralda" },
  { value: "rose", label: "Rosa" },
]

/** `items` with the entry at `from` moved to `to`; null when `to` is outside the list or equals `from`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return null
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export interface AdminSubcategoryNode {
  subcategory: SubcategoryDto
  dishes: DishDto[]
}

export interface AdminCategoryNode {
  category: CategoryDto
  /** Every subcategory of the category, inactive ones too, in menu order. */
  subcategories: AdminSubcategoryNode[]
  /** Dishes of the category outside any subcategory. */
  looseDishes: DishDto[]
  dishCount: number
  /** "Sin subcategorías", derived like the API's `hasSubcategories`: no dish of the category sits in one. */
  skipsSubcategoryStep: boolean
}

const byOrderThenName = <T extends { sortOrder: number; name: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es")

/**
 * Categories → subcategories → dishes, as the waiter steps through them; dishes
 * by sort order, then name (the API's dish order). Dishes without category are left out.
 */
export function buildAdminMenuTree(
  categories: readonly CategoryDto[],
  subcategories: readonly SubcategoryDto[],
  dishes: readonly DishDto[],
): AdminCategoryNode[] {
  return [...categories].sort(byOrderThenName).map((category) => {
    const own = dishes.filter((dish) => dish.categoryId === category.id).sort(byOrderThenName)
    const subs = subcategories.filter((s) => s.categoryId === category.id).sort(byOrderThenName)
    const subIds = new Set(subs.map((s) => s.id))
    return {
      category,
      subcategories: subs.map((subcategory) => ({
        subcategory,
        dishes: own.filter((dish) => dish.subcategoryId === subcategory.id),
      })),
      looseDishes: own.filter((dish) => !dish.subcategoryId || !subIds.has(dish.subcategoryId)),
      dishCount: own.length,
      skipsSubcategoryStep: !own.some((dish) => dish.subcategoryId),
    }
  })
}

/** "Unir platos en la categoría": the dishes to take out of their subcategory. */
export function planMergeIntoCategory(node: AdminCategoryNode): string[] {
  return node.subcategories.flatMap((s) => s.dishes.map((dish) => dish.id))
}

export const GENERAL_SUBCATEGORY = "General"

/** "Crear subcategoría General": reuse one of that name (names are unique per category, any case) and move the loose dishes into it. */
export function planGeneralSubcategory(node: AdminCategoryNode): { existingId: string | null; name: string; dishIds: string[] } {
  const existing = node.subcategories.find(
    (s) => s.subcategory.name.toLocaleLowerCase("es") === GENERAL_SUBCATEGORY.toLocaleLowerCase("es"),
  )
  return {
    existingId: existing?.subcategory.id ?? null,
    name: GENERAL_SUBCATEGORY,
    dishIds: node.looseDishes.map((dish) => dish.id),
  }
}

/** The editor nodes of `GET /catalog/menu/draft`: what the waiters get on the next publication. */
export function draftMenuTree(tree: MenuTreeDto): AdminCategoryNode[] {
  return buildAdminMenuTree(
    tree.categories,
    tree.categories.flatMap((category) => category.subcategories),
    tree.categories.flatMap((category) => category.dishes),
  )
}

// ---- Menu publication (redesign T27) -----------------------------------------

export const pendingChangesLabel = (n: number) => `${n} ${n === 1 ? "cambio" : "cambios"} sin publicar`

/** "hace 2 h": the age of a publication, never negative when the clocks drift. */
export function publishedAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return "hace un momento"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} d`
}

// ---- Quick notes (T27): the API's rules and Spanish messages ------------------

export const QUICK_NOTES_MAX = 12
export const QUICK_NOTE_MAX_LENGTH = 30
export const QUICK_NOTE_MESSAGES = {
  tooMany: "Máximo 12 notas rápidas",
  length: "Cada nota rápida debe tener entre 1 y 30 caracteres",
  duplicate: "Las notas rápidas no se pueden repetir",
} as const

/** `candidate` as the API stores it (trimmed, inner spaces collapsed), or why it cannot join `notes`. */
export function checkQuickNote(notes: readonly string[], candidate: string): { note: string } | { error: string } {
  const note = candidate.trim().replace(/\s+/g, " ")
  const length = [...note].length
  if (length < 1 || length > QUICK_NOTE_MAX_LENGTH) return { error: QUICK_NOTE_MESSAGES.length }
  if (notes.some((existing) => existing.toLowerCase() === note.toLowerCase())) return { error: QUICK_NOTE_MESSAGES.duplicate }
  if (notes.length >= QUICK_NOTES_MAX) return { error: QUICK_NOTE_MESSAGES.tooMany }
  return { note }
}

// ---- Tile name hint (T27, L19 e) ----------------------------------------------

/** Characters a category or subcategory name shows in two lines of a phone tile; a hint, not an API limit. */
export const TILE_NAME_LIMIT = 22

export function tileNameHint(name: string): { count: number; over: boolean } {
  const count = [...name.trim()].length
  return { count, over: count > TILE_NAME_LIMIT }
}
