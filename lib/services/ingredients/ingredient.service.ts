import { supabase } from "@/lib/db/client"

export const ingredientService = {
  getAll: async () => {
    try {
      // Obtenemos los ingredientes con un join a las categorías
      const { data: ingredients, error: ingError } = await supabase
        .from("ingredients")
        .select(`
        *,
        ingredient_categories(id, name)
      `)
        .order("name")

      if (ingError) throw ingError

      // Procesamos los datos para un formato más fácil de usar
      return (ingredients || []).map((ingredient) => {
        return {
          ...ingredient,
          category: ingredient.ingredient_categories ? ingredient.ingredient_categories.name : "Sin categoría",
          // Mantenemos el category_id para edición
          category_id: ingredient.category_id,
        }
      })
    } catch (error) {
      console.error("Error en getAll de ingredientes:", error)
      throw error
    }
  },

  getById: async (id: string) => {
    try {
      // Obtenemos el ingrediente con un join a la categoría
      const { data: ingredient, error: ingError } = await supabase
        .from("ingredients")
        .select(`
        *,
        ingredient_categories(id, name)
      `)
        .eq("id", id)
        .single()

      if (ingError) throw ingError

      // Procesamos los datos para un formato más fácil de usar
      return {
        ...ingredient,
        category: ingredient.ingredient_categories ? ingredient.ingredient_categories.name : "Sin categoría",
        // Mantenemos el category_id para edición
        category_id: ingredient.category_id,
      }
    } catch (error) {
      console.error("Error en getById de ingredientes:", error)
      throw error
    }
  },

  create: async (ingredient: any) => {
    const { data, error } = await supabase.from("ingredients").insert([ingredient]).select()
    if (error) throw error
    return data?.[0]
  },

  update: async (id: string, ingredient: any) => {
    const { data, error } = await supabase.from("ingredients").update(ingredient).eq("id", id).select()
    if (error) throw error
    return data?.[0]
  },

  delete: async (id: string) => {
    const { error } = await supabase.from("ingredients").delete().eq("id", id)
    if (error) throw error
    return true
  },
}

// Servicio para categorías de ingredientes
