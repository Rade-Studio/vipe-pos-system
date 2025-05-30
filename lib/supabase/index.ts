// Exportar el cliente
import { supabase, createSupabaseClient } from "./client"
export { supabase, createSupabaseClient }

// Exportar los servicios
import {
  waiterService,
  recipeService,
  tableService,
  orderService,
} from "./service"

export {
  waiterService,
  recipeService,
  tableService,
  orderService,
}

// Exportar el cliente por defecto para mantener compatibilidad
export default supabase
