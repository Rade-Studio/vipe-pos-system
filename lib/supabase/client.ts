import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase.types"

// Valores de respaldo para desarrollo local
const FALLBACK_SUPABASE_URL = "https://xyzcompany.supabase.co"
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtaXpveGNxdXZ5YnR6d2hmcWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTk5MDcyMjcsImV4cCI6MjAxNTQ4MzIyN30.aYBnJfj0ykSPHPFRY9XuLwRXBcgbUYZjuhEZ_Fbirpg"

// Obtener las variables de entorno con fallback
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY

// Verificar si estamos usando valores de respaldo
if (supabaseUrl === FALLBACK_SUPABASE_URL || supabaseAnonKey === FALLBACK_SUPABASE_ANON_KEY) {
  console.warn(
    "⚠️ Usando valores de respaldo para Supabase. Para una funcionalidad completa, configura las variables de entorno NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  )
}

// Opciones para el cliente de Supabase
const supabaseOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
}

// Crear y exportar el cliente de Supabase
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, supabaseOptions)

// Función para obtener el cliente de Supabase (para compatibilidad con código existente)
export function createSupabaseClient() {
  return supabase
}
