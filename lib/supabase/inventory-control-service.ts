import { supabase } from "@/lib/supabase"
import type { CartItem } from "@/types"

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

export type IngredientStock = {
  id: string
  name: string
  current_stock: number
  unit: string
  required_quantity: number
  sufficient: boolean
}

export type DishStockStatus = {
  dishId: string
  dishName: string // Añadido nombre del plato para mejor identificación
  hasRecipe: boolean
  hasAllIngredients: boolean
  missingIngredients: IngredientStock[]
}

const inventoryControlService = {
  /**
   * Verifica si un plato tiene suficiente stock de ingredientes
   * Esta función mantiene la compatibilidad con el código existente
   */
  async checkDishStock(dishId: string, dishName = ""): Promise<DishStockStatus> {
    try {
      // Normalizar el ID del plato
      const normalizedDishId = normalizeDishId(dishId)
      if (!normalizedDishId) {
        console.warn(`ID de plato inválido: ${dishId}, se omitirá la verificación de stock`)
        return {
          dishId,
          dishName,
          hasRecipe: false,
          hasAllIngredients: true,
          missingIngredients: [],
        }
      }

      console.log(`Verificando stock para plato: ${normalizedDishId} (${dishName})`)

      // Primero, obtener la receta asociada al plato
      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("id")
        .eq("dish_id", normalizedDishId)

      if (recipeError) {
        console.error(`Error al obtener recetas para plato ${normalizedDishId}:`, recipeError)
        return {
          dishId: normalizedDishId,
          dishName,
          hasRecipe: false,
          hasAllIngredients: true,
          missingIngredients: [],
        }
      }

      if (!recipes || recipes.length === 0) {
        console.log(`No se encontraron recetas para el plato ${normalizedDishId} (${dishName})`)
        return {
          dishId: normalizedDishId,
          dishName,
          hasRecipe: false,
          hasAllIngredients: true,
          missingIngredients: [],
        }
      }

      // Usar la primera receta encontrada
      const recipe = recipes[0]
      console.log(
        `Receta encontrada para plato ${normalizedDishId} (${dishName}), ID de receta: ${recipe.id} (${recipes.length} recetas totales)`,
      )

      // Ahora, obtener los ingredientes de la receta
      const { data: recipeIngredients, error: ingredientsError } = await supabase
        .from("recipe_ingredients")
        .select("ingredient_id, quantity")
        .eq("recipe_id", recipe.id)

      if (ingredientsError) {
        console.error(`Error al obtener ingredientes para receta ${recipe.id}:`, ingredientsError)
        return {
          dishId: normalizedDishId,
          dishName,
          hasRecipe: true,
          hasAllIngredients: false,
          missingIngredients: [],
        }
      }

      // Si no hay ingredientes, retornar que tiene receta pero no ingredientes
      if (!recipeIngredients || recipeIngredients.length === 0) {
        console.log(`La receta ${recipe.id} no tiene ingredientes`)
        return {
          dishId: normalizedDishId,
          dishName,
          hasRecipe: true,
          hasAllIngredients: true,
          missingIngredients: [],
        }
      }

      console.log(`Ingredientes encontrados para receta ${recipe.id}: ${recipeIngredients.length}`)

      // Obtener los ingredientes necesarios
      const ingredientIds = recipeIngredients.map((item) => item.ingredient_id)
      const { data: ingredients, error: ingredientsDataError } = await supabase
        .from("ingredients")
        .select("id, name, stock, unit")
        .in("id", ingredientIds)

      if (ingredientsDataError) {
        console.error(`Error al obtener datos de ingredientes:`, ingredientsDataError)
        return {
          dishId: normalizedDishId,
          dishName,
          hasRecipe: true,
          hasAllIngredients: false,
          missingIngredients: [],
        }
      }

      // Verificar si hay suficiente stock para cada ingrediente
      const missingIngredients: IngredientStock[] = []
      for (const recipeIngredient of recipeIngredients) {
        const ingredient = ingredients?.find((ing) => ing.id === recipeIngredient.ingredient_id)
        if (!ingredient) {
          missingIngredients.push({
            id: recipeIngredient.ingredient_id,
            name: "Ingrediente no encontrado",
            current_stock: 0,
            unit: "",
            required_quantity: recipeIngredient.quantity,
            sufficient: false,
          })
          continue
        }

        const sufficient = ingredient.stock >= recipeIngredient.quantity
        if (!sufficient) {
          missingIngredients.push({
            id: ingredient.id,
            name: ingredient.name,
            current_stock: ingredient.stock,
            unit: ingredient.unit || "",
            required_quantity: recipeIngredient.quantity,
            sufficient: false,
          })
        }
      }

      return {
        dishId: normalizedDishId,
        dishName,
        hasRecipe: true,
        hasAllIngredients: missingIngredients.length === 0,
        missingIngredients,
      }
    } catch (error) {
      console.error(`Error al verificar stock del plato ${dishId} (${dishName}):`, error)
      return {
        dishId,
        dishName,
        hasRecipe: false,
        hasAllIngredients: false,
        missingIngredients: [],
      }
    }
  },

  /**
   * Verifica si un plato tiene suficiente stock de ingredientes
   * Versión simplificada que devuelve solo un booleano
   */
  async checkStockForDish(dishId: string): Promise<boolean> {
    try {
      const status = await this.checkDishStock(dishId)
      return !status.hasRecipe || status.hasAllIngredients
    } catch (error) {
      console.error(`Error al verificar stock para plato ${dishId}:`, error)
      return true // En caso de error, asumimos que hay stock
    }
  },

  /**
   * Verifica el stock de todos los platos en un pedido
   * Versión mejorada que considera la cantidad de cada plato
   */
  async checkOrderStock(items: CartItem[]): Promise<{
    hasStock: boolean
    dishesWithoutStock: { id: string; name: string }[]
    stockDetails: DishStockStatus[]
    missingIngredients: { name: string; required: number; available: number; unit: string }[]
  }> {
    try {
      // Filtrar solo los IDs válidos
      const validItems = items.filter((item) => {
        const normalizedId = normalizeDishId(item.id)
        return normalizedId !== null
      })

      // Usar los IDs completos de los platos
      const uniqueDishIds = [...new Set(validItems.map((item) => item.id))]

      // Verificar el stock de cada plato
      const stockStatusPromises = uniqueDishIds.map((dishId) => {
        const item = validItems.find((i) => i.id === dishId)
        return this.checkDishStock(dishId, item?.name || "")
      })

      const stockStatuses = await Promise.all(stockStatusPromises)

      // Calcular la cantidad total de ingredientes necesarios considerando la cantidad de cada plato
      const ingredientTotals: Record<
        string,
        {
          required: number
          available: number
          name: string
          unit: string
        }
      > = {}

      // Para cada plato en el pedido
      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i]
        const normalizedDishId = normalizeDishId(item.id)
        if (!normalizedDishId) continue

        // Encontrar el status de stock para este plato
        const stockStatus = stockStatuses.find((status) => status.dishId === normalizedDishId)
        if (!stockStatus || !stockStatus.hasRecipe) continue

        // Obtener la receta del plato
        const { data: recipes } = await supabase.from("recipes").select("id").eq("dish_id", normalizedDishId)

        if (!recipes || recipes.length === 0) continue
        const recipeId = recipes[0].id

        // Obtener los ingredientes de la receta
        const { data: recipeIngredients } = await supabase
          .from("recipe_ingredients")
          .select("ingredient_id, quantity")
          .eq("recipe_id", recipeId)

        if (!recipeIngredients || recipeIngredients.length === 0) continue

        // Obtener los datos de los ingredientes
        const ingredientIds = recipeIngredients.map((ri) => ri.ingredient_id)
        const { data: ingredients } = await supabase
          .from("ingredients")
          .select("id, name, stock, unit")
          .in("id", ingredientIds)

        if (!ingredients) continue

        // Calcular la cantidad total necesaria de cada ingrediente
        for (const recipeIngredient of recipeIngredients) {
          const ingredient = ingredients.find((ing) => ing.id === recipeIngredient.ingredient_id)
          if (!ingredient) continue

          // Cantidad necesaria para este plato (considerando la cantidad pedida)
          const requiredQuantity = recipeIngredient.quantity * item.quantity

          // Actualizar el total de este ingrediente
          if (!ingredientTotals[ingredient.id]) {
            ingredientTotals[ingredient.id] = {
              required: 0,
              available: ingredient.stock,
              name: ingredient.name,
              unit: ingredient.unit || "",
            }
          }
          ingredientTotals[ingredient.id].required += requiredQuantity
        }
      }

      // Identificar ingredientes que no tienen suficiente stock
      const missingIngredients = Object.values(ingredientTotals)
        .filter((ing) => ing.required > ing.available)
        .map((ing) => ({
          name: ing.name,
          required: ing.required,
          available: ing.available,
          unit: ing.unit,
        }))

      // Identificar platos sin stock suficiente
      const dishesWithoutStock = stockStatuses
        .filter((status) => status.hasRecipe && !status.hasAllIngredients)
        .map((status) => ({
          id: status.dishId,
          name:
            status.dishName ||
            validItems.find((item) => normalizeDishId(item.id) === status.dishId)?.name ||
            "Plato desconocido",
        }))

      return {
        hasStock: missingIngredients.length === 0,
        dishesWithoutStock,
        stockDetails: stockStatuses,
        missingIngredients,
      }
    } catch (error) {
      console.error("Error al verificar stock del pedido:", error)
      throw error
    }
  },

  /**
   * Reduce el stock de ingredientes basado en los items de un pedido
   */
  async reduceStock(items: CartItem[], orderId: string): Promise<void> {
    try {
      console.log("Iniciando reducción de stock para la orden:", orderId)
      console.log("Items a procesar:", items.length)

      // Verificar primero si hay suficiente stock
      const stockCheck = await this.checkOrderStock(items)
      if (!stockCheck.hasStock) {
        throw new Error("No hay suficiente stock para completar esta orden")
      }

      // Filtrar solo los items con IDs válidos
      const validItems = items.filter((item) => {
        const normalizedId = normalizeDishId(item.id)
        return normalizedId !== null
      })

      // Para cada item en el pedido
      for (const item of validItems) {
        const normalizedDishId = normalizeDishId(item.id)
        if (!normalizedDishId) continue

        console.log(`Procesando item: ${item.name} (ID: ${normalizedDishId}), cantidad: ${item.quantity}`)

        // Obtener la receta del plato
        const { data: recipes, error: recipeError } = await supabase
          .from("recipes")
          .select("id")
          .eq("dish_id", normalizedDishId)

        if (recipeError) {
          console.error(`Error al obtener recetas para plato ${normalizedDishId}:`, recipeError)
          continue
        }

        // Si no hay recetas, continuar con el siguiente item
        if (!recipes || recipes.length === 0) {
          console.log(`No se encontraron recetas para el plato ${item.name} (ID: ${normalizedDishId})`)
          continue
        }

        // Usar la primera receta encontrada (o podríamos procesar todas si es necesario)
        const recipe = recipes[0]
        console.log(
          `Receta encontrada para ${item.name}, ID de receta: ${recipe.id} (${recipes.length} recetas totales)`,
        )

        // Obtener los ingredientes de la receta
        const { data: recipeIngredients, error: ingredientsError } = await supabase
          .from("recipe_ingredients")
          .select("ingredient_id, quantity")
          .eq("recipe_id", recipe.id)

        if (ingredientsError) {
          console.error(`Error al obtener ingredientes para receta ${recipe.id}:`, ingredientsError)
          continue
        }

        // Si no hay ingredientes, continuar con el siguiente item
        if (!recipeIngredients || recipeIngredients.length === 0) {
          console.log(`La receta para ${item.name} no tiene ingredientes`)
          continue
        }

        console.log(`Ingredientes encontrados para ${item.name}: ${recipeIngredients.length}`)

        // Obtener los ingredientes necesarios
        const ingredientIds = recipeIngredients.map((recipeItem) => recipeItem.ingredient_id)
        const { data: ingredients, error: ingredientsDataError } = await supabase
          .from("ingredients")
          .select("id, name, stock, cost")
          .in("id", ingredientIds)

        if (ingredientsDataError) {
          console.error(`Error al obtener datos de ingredientes:`, ingredientsDataError)
          continue
        }

        // Para cada ingrediente en la receta, reducir el stock
        for (const recipeIngredient of recipeIngredients) {
          const ingredient = ingredients?.find((ing) => ing.id === recipeIngredient.ingredient_id)
          if (!ingredient) {
            console.error(`Ingrediente no encontrado: ${recipeIngredient.ingredient_id}`)
            continue
          }

          // Calcular la cantidad a reducir (cantidad del ingrediente * cantidad del item)
          const quantityToReduce = recipeIngredient.quantity * item.quantity

          console.log(`Reduciendo ${quantityToReduce} unidades del ingrediente ${ingredient.name}`)

          try {
            // Calcular el nuevo stock
            const newStock = Math.max(0, ingredient.stock - quantityToReduce)

            console.log(`Stock actual de ${ingredient.name}: ${ingredient.stock}, nuevo stock: ${newStock}`)

            // Actualizar el stock del ingrediente
            const { error: updateError } = await supabase
              .from("ingredients")
              .update({ stock: newStock })
              .eq("id", recipeIngredient.ingredient_id)

            if (updateError) {
              console.error(`Error al actualizar stock del ingrediente ${recipeIngredient.ingredient_id}:`, updateError)
              continue
            }

            // Registrar la transacción de ingrediente
            const { error: transactionError } = await supabase.from("ingredient_transactions").insert({
              ingredient_id: recipeIngredient.ingredient_id,
              quantity: quantityToReduce,
              total_cost: quantityToReduce * (ingredient.cost || 0),
              unit_cost: ingredient.cost || 0,
              transaction_type: "salida",
              payment_status: "pagado",
              notes: `Orden #${orderId} - ${item.name} (${item.quantity}x)`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })

            if (transactionError) {
              console.error(
                `Error al crear transacción de ingrediente ${recipeIngredient.ingredient_id}:`,
                transactionError,
              )
            }
          } catch (error) {
            console.error(`Error al procesar ingrediente ${recipeIngredient.ingredient_id}:`, error)
          }
        }
      }

      console.log("Reducción de stock completada para la orden:", orderId)
    } catch (error) {
      console.error("Error al reducir stock:", error)
      throw error
    }
  },

  /**
   * Verifica y actualiza el stock para todos los platos en el menú
   * Útil para actualizar el estado de "agotado" de los platos
   */
  async updateAllDishesStockStatus(): Promise<Map<string, boolean>> {
    try {
      // Obtener todos los platos activos
      const { data: dishes, error } = await supabase.from("dishes").select("id, name").eq("active", true)

      if (error) {
        console.error("Error al obtener platos:", error)
        throw error
      }

      // Mapa para almacenar el estado de stock de cada plato
      const stockStatusMap = new Map<string, boolean>()

      // Verificar el stock de cada plato
      for (const dish of dishes) {
        const stockStatus = await this.checkDishStock(dish.id, dish.name)

        // Un plato está disponible si:
        // 1. No tiene receta, o
        // 2. Tiene receta pero no tiene ingredientes, o
        // 3. Tiene receta con ingredientes y todos tienen suficiente stock
        const isAvailable = !stockStatus.hasRecipe || (stockStatus.hasRecipe && stockStatus.hasAllIngredients)

        stockStatusMap.set(dish.id, isAvailable)
      }

      return stockStatusMap
    } catch (error) {
      console.error("Error al actualizar estado de stock de platos:", error)
      throw error
    }
  },
}

export default inventoryControlService
