import { describe, expect, it } from "vitest"

import { evaluateDishStock, evaluateStockWithUnreadableIngredients, type RecipeRow, type RecipeIngredientRow, type IngredientRow } from "./stock"

/**
 * T6 (S1) — the waiter grid used to call
 * `inventoryControlService.checkStockForDish(dish.id)` once per dish, and each
 * of those calls issued three sequential reads (recipes -> recipe_ingredients
 * -> ingredients). The replacement reads the three tables once per menu/category
 * and decides availability here, in pure code, so this file pins the decision
 * rules that `checkDishStock` used to implement one dish at a time.
 */

const recipes: RecipeRow[] = [
  { id: "r-with-ingredients", dish_id: "d-1" },
  { id: "r-empty", dish_id: "d-2" },
  { id: "r-missing-ingredient", dish_id: "d-3" },
  { id: "r-short", dish_id: "d-4" },
]

const recipeIngredients: RecipeIngredientRow[] = [
  { recipe_id: "r-with-ingredients", ingredient_id: "i-1", quantity: 2 },
  { recipe_id: "r-empty", ingredient_id: "i-1", quantity: 0 },
  { recipe_id: "r-missing-ingredient", ingredient_id: "i-ghost", quantity: 1 },
  { recipe_id: "r-short", ingredient_id: "i-1", quantity: 5 },
]

const ingredients: IngredientRow[] = [{ id: "i-1", name: "Arroz", stock: 10, unit: "g" }]

const DISH_IDS = ["d-1", "d-2", "d-3", "d-4", "d-no-recipe"]

describe("evaluateDishStock — batched availability decision (T6/S1)", () => {
  it("marks a dish available when every ingredient covers its recipe quantity", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, ingredients)
    expect(result.get("d-1")).toBe(true)
  })

  it("marks a dish available when it has no recipe (nothing to deplete)", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, ingredients)
    expect(result.get("d-no-recipe")).toBe(true)
  })

  it("marks a dish available when its recipe has no ingredients", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, ingredients)
    expect(result.get("d-2")).toBe(true)
  })

  it("marks a dish unavailable when stock is below the required quantity", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, [
      { id: "i-1", name: "Arroz", stock: 4, unit: "g" },
    ])
    expect(result.get("d-4")).toBe(false)
  })

  it("marks a dish unavailable when a recipe ingredient has no ingredient row", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, ingredients)
    expect(result.get("d-3")).toBe(false)
  })

  it("answers every requested dish id exactly once", () => {
    const result = evaluateDishStock(DISH_IDS, recipes, recipeIngredients, ingredients)
    expect([...result.keys()].sort()).toEqual([...DISH_IDS].sort())
    expect(result.size).toBe(DISH_IDS.length)
  })

  it("uses the first recipe of a dish with several recipes", () => {
    const result = evaluateDishStock(
      ["d-many"],
      [
        { id: "r-second", dish_id: "d-many" },
        { id: "r-first", dish_id: "d-many" },
      ],
      [{ recipe_id: "r-first", ingredient_id: "i-1", quantity: 1 }],
      ingredients,
    )
    expect(result.get("d-many")).toBe(true)
  })

  it("returns an empty map for no dishes", () => {
    expect(evaluateDishStock([], recipes, recipeIngredients, ingredients).size).toBe(0)
  })
})

/**
 * T6 fix (verifier BLOCKER): when the `recipe_ingredients` or `ingredients` read
 * fails, the rule must be the one `checkDishStock` applied before the batched
 * read replaced it — `hasRecipe: true, hasAllIngredients: false`, i.e. a dish
 * that HAS a recipe is unavailable and one without a recipe is available. It is
 * not "everything available": an unreadable ingredient list is exactly the case
 * where the waiter must not be told the dish can be sold.
 */
describe("evaluateStockWithUnreadableIngredients (T6 fix)", () => {
  it("marks a dish with a recipe as unavailable", () => {
    const result = evaluateStockWithUnreadableIngredients(["d-1", "d-no-recipe"], recipes)
    expect(result.get("d-1")).toBe(false)
  })

  it("keeps a dish without a recipe available", () => {
    const result = evaluateStockWithUnreadableIngredients(["d-1", "d-no-recipe"], recipes)
    expect(result.get("d-no-recipe")).toBe(true)
  })

  it("answers every requested dish id exactly once", () => {
    const ids = ["d-1", "d-2", "d-3", "d-4", "d-no-recipe"]
    const result = evaluateStockWithUnreadableIngredients(ids, recipes)
    expect(result.size).toBe(ids.length)
    expect(result.get("d-2")).toBe(false) // has a recipe
    expect(result.get("d-3")).toBe(false)
    expect(result.get("d-4")).toBe(false)
  })

  it("marks every dish available when the recipes read produced nothing", () => {
    const result = evaluateStockWithUnreadableIngredients(["d-1", "d-no-recipe"], [])
    expect([...result.values()]).toEqual([true, true])
  })

  it("returns an empty map for no dishes", () => {
    expect(evaluateStockWithUnreadableIngredients([], recipes).size).toBe(0)
  })
})