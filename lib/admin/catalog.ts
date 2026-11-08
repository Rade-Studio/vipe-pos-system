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
  fetchModifierGroups as listModifierGroups,
  fetchPromotions as listPromotions,
  getMenuDraft,
  getMenuPublication,
  type CategoryColor,
  type MenuPublicationDto,
  type MenuTreeDto,
  type CategoryDto,
  type DishDto,
  type ModifierGroupDto,
  type PromotionDto,
} from "@/lib/api/catalog"
import { getAll as listSubcategories, type SubcategoryDto } from "@/lib/api/subcategories"
import { formatCurrency } from "@/utils/helpers"
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
  /** F7: reusable modifier groups, inactive ones too. */
  modifierGroups: ["catalog", "menu", "modifier-groups"] as const,
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

/** Every modifier group with its options, inactive ones too (admin). */
export async function fetchAdminModifierGroups(): Promise<ModifierGroupDto[]> {
  return listModifierGroups({ includeInactive: true })
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

// ---- Modifier groups (F7): the API's rules and Spanish messages --------------

export const MODIFIER_SELECT_MAX = 50
export const MODIFIER_GROUP_MESSAGES = {
  name: "Escribe el nombre del grupo",
  required: "Un grupo obligatorio pide al menos una opción y uno opcional ninguna",
  minMax: "El máximo debe ser mayor o igual al mínimo",
  optionName: "Cada opción necesita un nombre",
  optionPrice: "El precio de una opción es un número entero de 0 o más",
  ingredient: "El ingrediente y su cantidad van juntos",
} as const

export interface ModifierRules {
  required: boolean
  minSelect: number
  /** null: no limit. */
  maxSelect: number | null
}

/** An option as the editor holds it: price and quantity as typed, "" for no ingredient. */
export interface ModifierOptionDraft {
  name: string
  price: string
  ingredientId: string
  ingredientQty: string
}

/** The rule chip: "Obligatorio · elige 1", "Opcional · hasta 3", "Opcional · sin límite". */
export function modifierRuleText({ required, minSelect, maxSelect }: ModifierRules): string {
  if (!required) return maxSelect === null ? "Opcional · sin límite" : `Opcional · hasta ${maxSelect}`
  if (maxSelect === null) return `Obligatorio · ${minSelect} o más`
  return maxSelect === minSelect ? `Obligatorio · elige ${minSelect}` : `Obligatorio · de ${minSelect} a ${maxSelect}`
}

const parseQty = (value: string) => Number(value.trim().replace(",", "."))

/** Why the API would refuse the group, in its words; empty when it can be saved. */
export function checkModifierGroup(group: ModifierRules & { name: string; options: readonly ModifierOptionDraft[] }): string[] {
  const errors: string[] = []
  if (!group.name.trim()) errors.push(MODIFIER_GROUP_MESSAGES.name)
  if (group.required !== group.minSelect >= 1) errors.push(MODIFIER_GROUP_MESSAGES.required)
  if (group.maxSelect !== null && group.maxSelect < group.minSelect) errors.push(MODIFIER_GROUP_MESSAGES.minMax)
  const options = group.options
  if (options.some((o) => !o.name.trim())) errors.push(MODIFIER_GROUP_MESSAGES.optionName)
  if (options.some((o) => !/^\d+$/.test(o.price.trim()))) errors.push(MODIFIER_GROUP_MESSAGES.optionPrice)
  const halfIngredient = (o: ModifierOptionDraft) => {
    const qty = o.ingredientQty.trim()
    if (!o.ingredientId) return qty !== ""
    return !(parseQty(qty) > 0)
  }
  if (options.some(halfIngredient)) errors.push(MODIFIER_GROUP_MESSAGES.ingredient)
  return errors
}

/** `ingredientQty` as the API takes it: "0,25" → 0.25, null without an ingredient. */
export function optionIngredientQty(option: ModifierOptionDraft): number | null {
  return option.ingredientId ? parseQty(option.ingredientQty) : null
}

/** The dishes that offer the group ("Se usa en N platos"); the dish list carries its active groups. */
export function dishesUsingGroup(dishes: readonly DishDto[], groupId: string): DishDto[] {
  return dishes.filter((dish) => (dish.modifierGroups ?? []).some((group) => group.id === groupId))
}

/** "$0 a +$3.000" for the options of a group. */
export function modifierPriceRange(options: readonly { price: number }[]): string {
  if (options.length === 0) return "Sin opciones"
  const top = Math.max(...options.map((o) => o.price))
  return top > 0 ? `${formatCurrency(Math.min(...options.map((o) => o.price)))} a +${formatCurrency(top)}` : `Todas ${formatCurrency(0)}`
}

// ---- Tile name hint (T27, L19 e) ----------------------------------------------

/** Characters a category or subcategory name shows in two lines of a phone tile; a hint, not an API limit. */
export const TILE_NAME_LIMIT = 22

export function tileNameHint(name: string): { count: number; over: boolean } {
  const count = [...name.trim()].length
  return { count, over: count > TILE_NAME_LIMIT }
}
