import { supabase } from "@/lib/db/client"

export const ingredientCategoryService = {
  getAll: async () => {
    const { data, error } = await supabase.from("ingredient_categories").select("*").order("name")
    if (error) throw error
    return data || []
  },
}

// Servicio para categorías
