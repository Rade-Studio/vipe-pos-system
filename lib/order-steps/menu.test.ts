import { describe, expect, it } from "vitest"

import { menuCategory, menuDish } from "./fixtures"
import { categoryMeta, dishesOf, OTHERS_CATEGORY_ID, skipsSubcategories, subcategoryChoices, withUncategorized } from "./menu"

describe("menu tree helpers of the step picker (T10)", () => {
  const split = menuCategory({
    id: "c-1",
    name: "Platos fuertes",
    subcategories: [
      { id: "s-1", name: "Carnes" },
      { id: "s-2", name: "Típicos" },
      { id: "s-empty", name: "Vacía" },
    ],
    dishes: [
      menuDish({ id: "d-1", name: "Bandeja paisa", subcategoryId: "s-1" }),
      menuDish({ id: "d-2", name: "Ajiaco", subcategoryId: "s-2" }),
      menuDish({ id: "d-3", name: "Sopa del día", subcategoryId: null }),
    ],
  })
  const direct = menuCategory({
    id: "c-2",
    name: "Postres",
    dishes: [menuDish({ id: "d-4", name: "Arroz con leche" }), menuDish({ id: "d-5", name: "Flan" })],
  })

  it("offers the subcategories that have dishes, plus the dishes without one", () => {
    expect(subcategoryChoices(split)).toEqual([
      { id: "s-1", name: "Carnes", count: 1 },
      { id: "s-2", name: "Típicos", count: 1 },
      { id: null, name: "Sin subcategoría", count: 1 },
    ])
    expect(skipsSubcategories(split)).toBe(false)
  })

  it("skips step 2 when no subcategory has dishes", () => {
    expect(skipsSubcategories(direct)).toBe(true)
    expect(skipsSubcategories(menuCategory({ subcategories: [{ id: "s-x", name: "Vacía" }], dishes: [menuDish({})] }))).toBe(true)
  })

  it("lists the dishes of the picked level", () => {
    expect(dishesOf(split, "s-1", false).map((dish) => dish.id)).toEqual(["d-1"])
    expect(dishesOf(split, null, false).map((dish) => dish.id)).toEqual(["d-3"])
    expect(dishesOf(direct, null, true).map((dish) => dish.id)).toEqual(["d-4", "d-5"])
  })

  it("describes the category tile with what it leads to", () => {
    expect(categoryMeta(split)).toBe("3 subcategorías")
    expect(categoryMeta(direct)).toBe("2 platos · directo")
    expect(categoryMeta(menuCategory({ dishes: [menuDish({})] }))).toBe("1 plato · directo")
  })

  it("decides step 2 from the subcategories returned, not from the hasSubcategories flag", () => {
    // Only an inactive subcategory: the flag says true, the tree sends none.
    const flagOnly = menuCategory({ hasSubcategories: true, dishes: [menuDish({ id: "d-9" })] })
    expect(flagOnly.hasSubcategories).toBe(true)
    expect(skipsSubcategories(flagOnly)).toBe(true)
    expect(dishesOf(flagOnly, null, true).map((dish) => dish.id)).toEqual(["d-9"])
  })

  it("adds the active dishes without category as a last Otros category", () => {
    const loose = [
      { ...menuDish({ id: "d-6", name: "Propina voluntaria" }), available: undefined },
      { ...menuDish({ id: "d-7", name: "Plato de otra categoría", categoryId: "c-1" }), available: undefined },
      { ...menuDish({ id: "d-8", name: "Inactivo", active: false }), available: undefined },
    ]
    const merged = withUncategorized([split, direct], loose)
    expect(merged.map((category) => category.name)).toEqual(["Platos fuertes", "Postres", "Otros"])
    const others = merged[2]
    expect(others.id).toBe(OTHERS_CATEGORY_ID)
    expect(others.subcategories).toEqual([])
    expect(others.dishes.map((dish) => [dish.id, dish.available])).toEqual([["d-6", true]])
    expect(skipsSubcategories(others)).toBe(true)

    expect(withUncategorized([split], [])).toEqual([split])
    expect(withUncategorized([split], loose.slice(1))).toEqual([split])
  })
})
