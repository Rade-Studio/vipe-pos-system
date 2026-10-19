import { supabase } from "@/lib/supabase"
import { log } from "@/lib/log"
import {
  evaluateDishStock,
  evaluateStockWithUnreadableIngredients,
  type IngredientRow,
  type RecipeIngredientRow,
  type RecipeRow,
} from "@/lib/menu/stock"

// Validar si un string es un UUID válido
function isValidUUID(str: string) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(str)
}

// Normalizar un ID de plato para asegurar que sea un UUID válido
function normalizeDishId(id: string): string | null {
  if (!id) return null

  // Si el ID es demasiado largo (posiblemente concatenado), tomar solo los primeros 36 caracteres
  if (id.length > 36) {
    id = id.substring(0, 36)
  }

  return isValidUUID(id) ? id : null
}

const inventoryControlService = {
  /**
   * Verifica si un plato tiene suficiente stock de ingredientes
   * Versión simplificada que devuelve solo un booleano
   *
   * Ahora delega en la lectura por lotes de abajo: un solo plato son las mismas
   * tres lecturas que antes, pero el N+1 del grid desapareció (T6/S1).
   */
  async checkStockForDish(dishId: string): Promise<boolean> {
    try {
      const normalizedDishId = normalizeDishId(dishId)
      // Sin id utilizable no hay nada que verificar: disponible, como antes.
      if (!normalizedDishId) return true

      const stockStatus = await this.checkStockForDishes([normalizedDishId])
      return stockStatus.get(normalizedDishId) ?? true
    } catch (error) {
      log.error(`Error al verificar stock para plato ${dishId}:`, { error: String(error) })
      return true // En caso de error, asumimos que hay stock
    }
  },

  /**
   * Verifica el stock de varios platos con TRES lecturas en total (T6/S1).
   *
   * Antes el grid llamaba `checkStockForDish` una vez por plato y cada llamada
   * leía recetas, ingredientes de receta e ingredientes: ~3 x N peticiones por
   * categoría, con el grid entero en skeletons hasta que terminara la más lenta.
   * Ahora una lectura por tabla cubre la categoría o el menú completo.
   *
   * Devuelve un mapa `dishId -> disponible`. Una lectura de `recipes` fallida
   * deja todo disponible (no sabemos siquiera si los platos tienen receta);
   * una lectura de `recipe_ingredients` o `ingredients` fallida deja los platos
   * CON receta como no disponibles y los que no tienen receta como disponibles,
   * que es exactamente lo que respondía `checkDishStock`.
   */
  async checkStockForDishes(dishIds: string[]): Promise<Map<string, boolean>> {
    const ids = [...new Set(dishIds.map((id) => normalizeDishId(id)).filter((id): id is string => id !== null))]
    const allAvailable = () => new Map(ids.map((id) => [id, true]))
    const withoutIngredientRows = (recipes: RecipeRow[]) =>
      evaluateStockWithUnreadableIngredients(ids, recipes)

    if (ids.length === 0) {
      return new Map()
    }

    try {
      log.info(`Verificando stock de ${ids.length} platos en una sola lectura por tabla:`, {
        dishes: ids.length,
      })

      // 1) Recetas de los platos cargados
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("id, dish_id, yield_quantity")
        .in("dish_id", ids)

      if (recipesError) {
        log.error("Error al obtener recetas:", { recipesError: String(recipesError) })
        return allAvailable()
      }

      const recipeRows = (recipes || []) as RecipeRow[]
      if (recipeRows.length === 0) {
        return allAvailable()
      }

      // 2) Ingredientes de esas recetas
      const recipeIds = [...new Set(recipeRows.map((recipe) => recipe.id))]
      const { data: recipeIngredients, error: ingredientsError } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id, ingredient_id, quantity")
        .in("recipe_id", recipeIds)

      if (ingredientsError) {
        log.error("Error al obtener ingredientes de receta:", { ingredientsError: String(ingredientsError) })
        return withoutIngredientRows(recipeRows)
      }

      const recipeIngredientRows = (recipeIngredients || []) as RecipeIngredientRow[]
      if (recipeIngredientRows.length === 0) {
        return allAvailable()
      }

      // 3) Stock de esos ingredientes
      const ingredientIds = [...new Set(recipeIngredientRows.map((row) => row.ingredient_id))]
      const { data: ingredients, error: ingredientsDataError } = await supabase
        .from("ingredients")
        .select("id, name, stock, unit")
        .in("id", ingredientIds)

      if (ingredientsDataError) {
        log.error("Error al obtener datos de ingredientes:", {
          ingredientsDataError: String(ingredientsDataError),
        })
        return withoutIngredientRows(recipeRows)
      }

      return evaluateDishStock(ids, recipeRows, recipeIngredientRows, (ingredients || []) as IngredientRow[])
    } catch (error) {
      log.error(`Error al verificar el stock de ${ids.length} platos:`, { error: String(error) })
      return allAvailable()
    }
  },
}

export default inventoryControlService
