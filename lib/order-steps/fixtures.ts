import type { MenuTreeCategoryDto, MenuTreeDishDto } from "@/lib/api/catalog"

/** Menu tree builders for the step picker suites (waiter now, delivery in T11). */
export function menuDish(overrides: Partial<MenuTreeDishDto>): MenuTreeDishDto {
  return {
    id: "d-0",
    name: "Plato",
    description: null,
    price: 10000,
    categoryId: null,
    subcategoryId: null,
    imageUrl: null,
    active: true,
    allowComments: true,
    createdAt: null,
    updatedAt: null,
    available: true,
    ...overrides,
  }
}

export function menuCategory(
  overrides: Partial<Omit<MenuTreeCategoryDto, "subcategories">> & {
    subcategories?: { id: string; name: string }[]
  },
): MenuTreeCategoryDto {
  const { subcategories = [], dishes = [], ...rest } = overrides
  const id = rest.id ?? "c-0"
  return {
    id,
    name: "Categoría",
    description: null,
    icon: "utensils",
    active: true,
    sortOrder: 0,
    color: "neutral",
    hasSubcategories: subcategories.length > 0,
    createdAt: null,
    updatedAt: null,
    ...rest,
    subcategories: subcategories.map((sub, index) => ({
      id: sub.id,
      categoryId: id,
      name: sub.name,
      sortOrder: index,
      active: true,
      createdAt: null,
      updatedAt: null,
    })),
    dishes: dishes.map((dish) => ({ ...dish, categoryId: id })),
  }
}
