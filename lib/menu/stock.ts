/**
 * Pure availability decision for a whole menu at once (T6/S1).
 *
 * The waiter grid used to call `inventoryControlService.checkStockForDish` per
 * dish — three sequential reads each, so ~30 requests for one category — and
 * blocked the whole grid behind the slowest dish. `checkStockForDishes` now
 * reads `recipes`, `recipe_ingredients` and `ingredients` once and hands the
 * rows here, where availability is decided with no I/O.
 *
 * The rules are the ones `checkDishStock` applied per dish:
 *   - no recipe            -> available (nothing can be depleted)
 *   - recipe with no rows  -> available
 *   - every ingredient with enough stock -> available
 *   - any short or unknown ingredient -> unavailable
 */

export type RecipeRow = { id: string; dish_id: string }
export type RecipeIngredientRow = { recipe_id: string; ingredient_id: string; quantity: number }
export type IngredientRow = { id: string; name: string; stock: number; unit: string | null }

/**
 * Returns one boolean per requested dish id: true when the dish can be sold.
 * Ids without a recipe still get an entry, so the caller can distinguish
 * "available" from "not evaluated".
 */
export function evaluateDishStock(
  dishIds: readonly string[],
  recipes: readonly RecipeRow[],
  recipeIngredients: readonly RecipeIngredientRow[],
  ingredients: readonly IngredientRow[],
): Map<string, boolean> {
  const firstRecipeByDish = new Map<string, string>()
  for (const recipe of recipes) {
    if (!firstRecipeByDish.has(recipe.dish_id)) {
      firstRecipeByDish.set(recipe.dish_id, recipe.id)
    }
  }

  const ingredientsByRecipe = new Map<string, RecipeIngredientRow[]>()
  for (const row of recipeIngredients) {
    const bucket = ingredientsByRecipe.get(row.recipe_id)
    if (bucket) bucket.push(row)
    else ingredientsByRecipe.set(row.recipe_id, [row])
  }

  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))

  const result = new Map<string, boolean>()
  for (const dishId of dishIds) {
    const recipeId = firstRecipeByDish.get(dishId)
    if (recipeId === undefined) {
      result.set(dishId, true)
      continue
    }

    const rows = ingredientsByRecipe.get(recipeId) ?? []
    result.set(
      dishId,
      rows.every((row) => {
        const ingredient = ingredientById.get(row.ingredient_id)
        return ingredient !== undefined && ingredient.stock >= row.quantity
      }),
    )
  }

  return result
}

/**
 * Availability when the ingredient reads fail (T6 fix).
 *
 * The batched read replaced `checkDishStock`, which answered those failures
 * with `hasRecipe: true, hasAllIngredients: false`: a dish that HAS a recipe was
 * unavailable, one without a recipe was available. That rule is kept here — an
 * unreadable ingredient list is precisely the case where the grid must not claim
 * the dish can be sold. A failed `recipes` read is a different case (the service
 * does not even know whether the dishes have recipes) and stays "available".
 */
export function evaluateStockWithUnreadableIngredients(
  dishIds: readonly string[],
  recipes: readonly RecipeRow[],
): Map<string, boolean> {
  const dishesWithRecipe = new Set(recipes.map((recipe) => recipe.dish_id))
  return new Map(dishIds.map((dishId) => [dishId, !dishesWithRecipe.has(dishId)]))
}