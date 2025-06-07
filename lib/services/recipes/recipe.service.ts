import { supabase } from "@/lib/db/client"

export const recipeService = {
  getByDishId: async (dishId: string) => {
    const { data, error } = await supabase.from("recipes").select("*").eq("dish_id", dishId).single()

    if (error) {
      // Si no existe la receta, devolvemos null en lugar de lanzar un error
      if (error.code === "PGRST116") {
        return null
      }
      throw error
    }

    return data
  },

  create: async (recipe: { dishId: string }) => {
    const { data, error } = await supabase
      .from("recipes")
      .insert([
        {
          dish_id: recipe.dishId,
          created_at: new Date().toISOString(),
        },
      ])
      .select()

    if (error) throw error
    return data?.[0]
  },

  getRecipeIngredients: async (recipeId: string) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .select(`
        *,
        ingredients (name, unit)
      `)
      .eq("recipe_id", recipeId)

    if (error) throw error

    // Procesamos los datos para un formato más fácil de usar
    return (data || []).map((item) => ({
      id: item.id,
      recipeId: item.recipe_id,
      ingredientId: item.ingredient_id,
      quantity: item.quantity,
      createdAt: item.created_at,
      ingredient: item.ingredients
        ? {
            name: item.ingredients.name,
            unit: item.ingredients.unit,
          }
        : undefined,
    }))
  },

  addIngredientToRecipe: async (recipeIngredient: { recipeId: string; ingredientId: string; quantity: number }) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .insert([
        {
          recipe_id: recipeIngredient.recipeId,
          ingredient_id: recipeIngredient.ingredientId,
          quantity: recipeIngredient.quantity,
          created_at: new Date().toISOString(),
        },
      ])
      .select()

    if (error) throw error
    return data?.[0]
  },

  updateRecipeIngredient: async (id: string, updates: { quantity: number }) => {
    const { data, error } = await supabase
      .from("recipe_ingredients")
      .update({
        quantity: updates.quantity,
      })
      .eq("id", id)
      .select()

    if (error) throw error
    return data?.[0]
  },

  removeIngredientFromRecipe: async (recipeIngredientId: string) => {
    const { error } = await supabase.from("recipe_ingredients").delete().eq("id", recipeIngredientId)

    if (error) throw error
    return true
  },

  deleteRecipe: async (recipeId: string) => {
    // Primero eliminamos todos los ingredientes de la receta
    const { error: ingredientsError } = await supabase.from("recipe_ingredients").delete().eq("recipe_id", recipeId)

    if (ingredientsError) throw ingredientsError

    // Luego eliminamos la receta
    const { error } = await supabase.from("recipes").delete().eq("id", recipeId)

    if (error) throw error
    return true
  },
}

// Servicios para meseros (profiles con role = 'waiter')
export const waiterService = {
