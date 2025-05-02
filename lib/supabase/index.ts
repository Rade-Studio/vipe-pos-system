// Exportar el cliente
import { supabase, createSupabaseClient } from "./client"
export { supabase, createSupabaseClient }

// Exportar los servicios
import {
  ingredientService,
  categoryService,
  dishService,
  waiterService,
  ingredientCategoryService,
  recipeService,
  tableService,
  orderService,
} from "./service"

export {
  ingredientService,
  categoryService,
  dishService,
  waiterService,
  ingredientCategoryService,
  recipeService,
  tableService,
  orderService,
}

// Exportar el cliente por defecto para mantener compatibilidad
export default supabase
