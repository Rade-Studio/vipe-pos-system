import { supabase } from "@/lib/supabase"
import { log } from "@/lib/log"

// Tipo para los valores de configuración
export type BusinessConfigValues = {
  tax_percentage: number
  tip_percentage: number
  price_suggestion: number
  business_name: string
  business_address: string
  business_phone: string
  business_nit: string
  inventory_control_enabled: boolean
  [key: string]: string | number | boolean
}

// Tipo para un registro individual de configuración
export type BusinessConfigRecord = {
  id: string
  key: string
  value: string
  created_at?: string
  updated_at?: string
}

/**
 * Defaults applied when a key is absent, and the only keys `loadConfig` seeds.
 * Exported so the shell/store tests pin the same values the service writes.
 */
export const DEFAULT_CONFIG = {
  tax_percentage: 10,
  tip_percentage: 10,
  price_suggestion: 300,
  business_name: "Mi Restaurante",
  business_address: "Dirección del Restaurante",
  business_phone: "123-456-7890",
  business_nit: "123456789",
  inventory_control_enabled: false,
} satisfies BusinessConfigValues

const NUMERIC_KEYS = new Set(["tax_percentage", "tip_percentage", "price_suggestion"])

/**
 * The subset of `DEFAULT_CONFIG` that is NOT already stored.
 *
 * The old `initializeDefaultConfig` asked `getConfigValue(key)` once per key,
 * i.e. 8 sequential reads on EVERY startup for every role, and then tried to
 * insert each missing key — which every non-admin role has been rejected from
 * since `business_config_insert_policy` requires
 * `private.current_app_role() = 'admin'`
 * (supabase/migrations/20261005150000_tenant_scope_remaining_tables.sql).
 */
export function missingConfigKeys(presentKeys: Iterable<string>): Partial<BusinessConfigValues> {
  const present = new Set(presentKeys)
  const missing: Partial<BusinessConfigValues> = {}
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    if (!present.has(key)) missing[key as keyof BusinessConfigValues] = value
  }
  return missing
}

function configFromRows(rows: Pick<BusinessConfigRecord, "key" | "value">[]): BusinessConfigValues {
  const config: BusinessConfigValues = { ...DEFAULT_CONFIG }

  for (const item of rows) {
    if (NUMERIC_KEYS.has(item.key)) {
      config[item.key] = Number.parseFloat(item.value)
    } else if (item.key === "inventory_control_enabled") {
      config[item.key] = item.value === "true"
    } else {
      config[item.key] = item.value
    }
  }

  return config
}

export const businessConfigService = {
  /**
   * One `business_config` read: every key the tenant has stored.
   */
  async getAllConfigRows(): Promise<BusinessConfigRecord[]> {
    const { data, error } = await supabase.from("business_config").select("key, value")

    if (error) {
      log.error("Error al obtener configuraciones:", { error: String(error) })
      throw error
    }

    return (data ?? []) as BusinessConfigRecord[]
  },

  /**
   * Obtiene todas las configuraciones del negocio
   */
  async getAllConfig(): Promise<BusinessConfigValues> {
    try {
      return configFromRows(await this.getAllConfigRows())
    } catch (error) {
      log.error("Error en getAllConfig:", { error: String(error) })
      throw error
    }
  },

  /**
   * The startup read: ONE query for the whole config, optionally seeding the
   * keys that are genuinely missing.
   *
   * `canWrite: false` for every role except admin — the INSERT would be
   * rejected by RLS anyway, and a rejected insert used to abort the whole
   * load, leaving the store on its built-in defaults instead of the tenant's
   * stored tax/tip/business values.
   */
  async loadConfig({ canWrite = true }: { canWrite?: boolean } = {}): Promise<BusinessConfigValues> {
    const rows = await this.getAllConfigRows()
    const missing = missingConfigKeys(rows.map((row) => row.key))

    if (canWrite && Object.keys(missing).length > 0) {
      try {
        await this.insertConfigValues(missing)
      } catch (error) {
        // A failed seed must not cost the tenant its stored config values.
        log.error("Error al inicializar configuración por defecto:", { error: String(error) })
      }
    }

    return configFromRows(rows)
  },

  /**
   * Obtiene un valor de configuración específico
   */
  async getConfigValue(key: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.from("business_config").select("value").eq("key", key).single()

      if (error) {
        if (error.code === "PGRST116") {
          // No se encontró el registro
          return null
        }
        log.error(`Error al obtener configuración para ${key}:`, { error: String(error) })
        throw error
      }

      return data?.value || null
    } catch (error) {
      log.error(`Error en getConfigValue para ${key}:`, { error: String(error) })
      return null
    }
  },

  /**
   * Guarda un valor de configuración
   */
  async saveConfigValue(key: string, value: string | number | boolean): Promise<void> {
    try {
      // Convertir a string si es un número o booleano
      const stringValue =
        typeof value === "boolean" ? value.toString() : typeof value === "number" ? value.toString() : value

      // Verificar si la clave ya existe
      const { data } = await supabase.from("business_config").select("id").eq("key", key).single()

      if (data) {
        // Actualizar el valor existente
        const { error } = await supabase
          .from("business_config")
          .update({ value: stringValue, updated_at: new Date().toISOString() })
          .eq("key", key)

        if (error) {
          log.error(`Error al actualizar configuración para ${key}:`, { error: String(error) })
          throw error
        }
      } else {
        // Insertar un nuevo valor
        const { error } = await supabase.from("business_config").insert({ key, value: stringValue })

        if (error) {
          log.error(`Error al insertar configuración para ${key}:`, { error: String(error) })
          throw error
        }
      }
    } catch (error) {
      log.error(`Error en saveConfigValue para ${key}:`, { error: String(error) })
      throw error
    }
  },

  /**
   * Inserts several keys in ONE write. Only ever called with keys that
   * `missingConfigKeys` proved absent, so there is no select-then-update.
   */
  async insertConfigValues(values: Partial<BusinessConfigValues>): Promise<void> {
    const rows = Object.entries(values).map(([key, value]) => ({
      key,
      value: typeof value === "boolean" ? value.toString() : String(value),
    }))

    if (rows.length === 0) return

    try {
      const { error } = await supabase.from("business_config").insert(rows)

      if (error) {
        log.error(`Error al insertar configuración (${rows.length} claves):`, { error: String(error) })
        throw error
      }
    } catch (error) {
      log.error("Error en insertConfigValues:", { error: String(error) })
      throw error
    }
  },

  /**
   * Guarda múltiples valores de configuración
   */
  async saveMultipleConfig(config: Partial<BusinessConfigValues>): Promise<void> {
    try {
      // Guardar cada valor individualmente
      const promises = Object.entries(config).map(([key, value]) =>
        this.saveConfigValue(key, value as string | number | boolean),
      )

      await Promise.all(promises)
    } catch (error) {
      log.error("Error en saveMultipleConfig:", { error: String(error) })
      throw error
    }
  },

  /**
   * Inicializa la configuración con valores por defecto si no existen
   *
   * Removed in `cargas-por-perfil` T5: it cost 8 sequential reads on every
   * startup and then attempted 8 INSERTs no non-admin role is allowed to make.
   * `loadConfig({ canWrite })` does both from a single read and only inserts
   * the keys that are actually absent.
   */
}

export default businessConfigService
