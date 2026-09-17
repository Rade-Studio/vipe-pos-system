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

export const businessConfigService = {
  /**
   * Obtiene todas las configuraciones del negocio
   */
  async getAllConfig(): Promise<BusinessConfigValues> {
    try {
      const { data, error } = await supabase.from("business_config").select("key, value")

      if (error) {
        log.error("Error al obtener configuraciones:", { error: String(error) })
        throw error
      }

      // Convertir el array de registros a un objeto de configuración
      const config: BusinessConfigValues = {
        tax_percentage: 10,
        tip_percentage: 10,
        price_suggestion: 300,
        business_name: "Mi Restaurante",
        business_address: "Dirección del Restaurante",
        business_phone: "123-456-7890",
        business_nit: "123456789",
        inventory_control_enabled: false,
      }

      // Llenar el objeto con los valores de la base de datos
      if (data && data.length > 0) {
        data.forEach((item: BusinessConfigRecord) => {
          // Convertir valores según su tipo
          if (item.key === "tax_percentage" || item.key === "tip_percentage") {
            config[item.key] = Number.parseFloat(item.value)
          } else if (item.key === "inventory_control_enabled") {
            config[item.key] = item.value === "true"
          } else {
            config[item.key] = item.value
          }
        })
      }

      return config
    } catch (error) {
      log.error("Error en getAllConfig:", { error: String(error) })
      throw error
    }
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
   * Guarda múltiples valores de configuración
   */
  async saveMultipleConfig(config: Partial<BusinessConfigValues>): Promise<void> {
    try {
      // Guardar cada valor individualmente
      const promises = Object.entries(config).map(([key, value]) => this.saveConfigValue(key, value))

      await Promise.all(promises)
    } catch (error) {
      log.error("Error en saveMultipleConfig:", { error: String(error) })
      throw error
    }
  },

  /**
   * Inicializa la configuración con valores por defecto si no existen
   */
  async initializeDefaultConfig(): Promise<void> {
    try {
      const defaultConfig: BusinessConfigValues = {
        tax_percentage: 10,
        tip_percentage: 10,
        price_suggestion: 300,
        business_name: "Mi Restaurante",
        business_address: "Dirección del Restaurante",
        business_phone: "123-456-7890",
        business_nit: "123456789",
        inventory_control_enabled: false,
      }

      // Para cada valor por defecto, verificar si existe y crearlo si no
      for (const [key, value] of Object.entries(defaultConfig)) {
        const existingValue = await this.getConfigValue(key)
        if (existingValue === null) {
          await this.saveConfigValue(key, value)
        }
      }
    } catch (error) {
      log.error("Error al inicializar configuración por defecto:", { error: String(error) })
      throw error
    }
  },
}

export default businessConfigService
