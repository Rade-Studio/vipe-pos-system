// Exportar el cliente
import { supabase, createSupabaseClient } from "./client"
export { supabase, createSupabaseClient }

// Exportar los servicios
import {
  categoryService,
  dishService,
  waiterService,
  tableService,
  orderService,
} from "./service"

export {
  categoryService,
  dishService,
  waiterService,
  tableService,
  orderService,
}

// Exportar el cliente por defecto para mantener compatibilidad
export default supabase
