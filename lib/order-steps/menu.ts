import type { MenuTreeCategoryDto, MenuTreeDishDto } from "@/lib/api/catalog"

/** One tile of step 2; `id: null` is the dishes of the category without subcategory. */
export interface SubcategoryChoice {
  id: string | null
  name: string
  count: number
}

export const NO_SUBCATEGORY = "Sin subcategoría"

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * The subcategories that have dishes, in menu order, plus "Sin subcategoría"
 * when some dish of the category sits in none. An empty subcategory is not a
 * tile: it would lead to an empty screen.
 */
export function subcategoryChoices(category: MenuTreeCategoryDto): SubcategoryChoice[] {
  const counts = new Map<string, number>()
  for (const dish of category.dishes) {
    if (dish.subcategoryId) counts.set(dish.subcategoryId, (counts.get(dish.subcategoryId) ?? 0) + 1)
  }
  const choices: SubcategoryChoice[] = category.subcategories
    .filter((sub) => counts.has(sub.id))
    .map((sub) => ({ id: sub.id, name: sub.name, count: counts.get(sub.id) ?? 0 }))
  if (choices.length === 0) return choices
  const listed = new Set(choices.map((choice) => choice.id))
  const loose = category.dishes.filter((dish) => !dish.subcategoryId || !listed.has(dish.subcategoryId)).length
  return loose > 0 ? [...choices, { id: null, name: NO_SUBCATEGORY, count: loose }] : choices
}

/** "Sin subcategorías": no subcategory has dishes, so the picker goes straight to the dishes. */
export const skipsSubcategories = (category: MenuTreeCategoryDto) => subcategoryChoices(category).length === 0

/** The dishes of step 3 for the picked subcategory (or all of them when step 2 was skipped). */
export function dishesOf(
  category: MenuTreeCategoryDto,
  subcategoryId: string | null,
  skipped: boolean,
): MenuTreeDishDto[] {
  if (skipped) return category.dishes
  if (subcategoryId) return category.dishes.filter((dish) => dish.subcategoryId === subcategoryId)
  const listed = new Set(subcategoryChoices(category).map((choice) => choice.id))
  return category.dishes.filter((dish) => !dish.subcategoryId || !listed.has(dish.subcategoryId))
}

/** The second line of a category tile: where the tap leads. */
export function categoryMeta(category: MenuTreeCategoryDto): string {
  const choices = subcategoryChoices(category)
  return choices.length === 0
    ? `${plural(category.dishes.length, "plato", "platos")} · directo`
    : plural(choices.length, "subcategoría", "subcategorías")
}

export const dishCount = (count: number) => plural(count, "plato", "platos")

export const OTHERS_CATEGORY_ID = "__others__"

/**
 * The menu tree's active dishes without category (`uncategorized`, T20)
 * become a last "Otros" category (no subcategories, so step 2 is skipped),
 * priced and with their real availability.
 */
export function withUncategorized(
  categories: MenuTreeCategoryDto[],
  uncategorized: readonly MenuTreeDishDto[] | undefined,
): MenuTreeCategoryDto[] {
  if (!uncategorized || uncategorized.length === 0) return categories
  return [
    ...categories,
    {
      id: OTHERS_CATEGORY_ID,
      name: "Otros",
      description: null,
      icon: "utensils",
      active: true,
      sortOrder: Number.MAX_SAFE_INTEGER,
      color: "neutral",
      hasSubcategories: false,
      createdAt: null,
      updatedAt: null,
      subcategories: [],
      dishes: uncategorized.map((dish) => ({ ...dish, subcategoryId: null })),
    },
  ]
}
