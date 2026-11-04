// Exportar el cliente
import { supabase, createSupabaseClient } from "./client"
export { supabase, createSupabaseClient }

// Orders, tables and waiters moved to the API (lib/api/orders.ts, lib/api/tables.ts).

// Exportar el cliente por defecto para mantener compatibilidad
export default supabase
