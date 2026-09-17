import { supabase } from "./client"
import { log } from "@/lib/log"

export interface Promotion {
  id: string
  name: string
  description: string | null
  discount_type: "percentage" | "fixed_amount"
  discount_value: number | null
  start_date: string
  end_date: string
  active: boolean
  created_at?: string
  updated_at?: string
}

export const promotionService = {
  // Obtener todas las promociones
  getAllPromotions: async () => {
    try {
      const { data, error } = await supabase.from("promotions").select("*").order("created_at", { ascending: false })

      if (error) throw error
      return data || []
    } catch (error) {
      throw error
    }
  },

  // Obtener promociones activas
  getActivePromotions: async () => {
    try {
      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("active", true)
        .lte("start_date", new Date().toISOString())
        .gte("end_date", new Date().toISOString())

      if (error) throw error
      return data || []
    } catch (error) {
      throw error
    }
  },

  // Crear una nueva promoción
  createPromotion: async (promotion: Omit<Promotion, "id" | "created_at" | "updated_at">) => {
    try {
      const { data, error } = await supabase
        .from("promotions")
        .insert([
          {
            ...promotion,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        .select()

      if (error) throw error
      return data?.[0]
    } catch (error) {
      throw error
    }
  },

  // Actualizar una promoción existente
  updatePromotion: async (id: string, promotion: Partial<Omit<Promotion, "id" | "created_at">>) => {
    try {
      const { data, error } = await supabase
        .from("promotions")
        .update({
          ...promotion,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()

      if (error) throw error
      return data?.[0]
    } catch (error) {
      throw error
    }
  },

  // Eliminar una promoción
  deletePromotion: async (id: string) => {
    try {
      // Primero eliminar las relaciones con platos
      await supabase.from("promotion_dishes").delete().eq("promotion_id", id)

      // Luego eliminar la promoción
      const { error } = await supabase.from("promotions").delete().eq("id", id)

      if (error) throw error
      return true
    } catch (error) {
      throw error
    }
  },

  // Asignar platos a una promoción
  assignDishesToPromotion: async (promotionId: string, dishIds: string[]) => {
    try {
      // Primero eliminar asignaciones existentes
      await supabase.from("promotion_dishes").delete().eq("promotion_id", promotionId)

      // Si no hay platos para asignar, terminar
      if (dishIds.length === 0) return true

      // Crear nuevas asignaciones
      const promotionDishes = dishIds.map((dishId) => ({
        promotion_id: promotionId,
        dish_id: dishId,
      }))

      const { error } = await supabase.from("promotion_dishes").insert(promotionDishes)

      if (error) throw error
      return true
    } catch (error) {
      throw error
    }
  },

  // Obtener platos asignados a una promoción
  getPromotionDishes: async (promotionId: string) => {
    try {
      const { data, error } = await supabase
        .from("promotion_dishes")
        .select("dishes(*)")
        .eq("promotion_id", promotionId)

      if (error) throw error
      return data?.map((item) => item.dishes) || []
    } catch (error) {
      log.error("Error getting promotion dishes:", { error: String(error) })
      throw error
    }
  },

  // Eliminar platos de una promoción
  removePromotionDishes: async (promotionId: string, dishIds: string[]) => {
      // Primero eliminar asignaciones existentes
      await supabase.from("promotion_dishes").delete().eq("promotion_id", promotionId)

      // Si no hay platos para asignar, terminar
      if (dishIds.length === 0) return true

      // Crear nuevas asignaciones
      const promotionDishes = dishIds.map((dishId) => ({
          promotion_id: promotionId,
          dish_id: dishId,
      }))

      const { error } = await supabase.from("promotion_dishes").insert(promotionDishes)

      if (error) throw error
      return true
  },

  // Eliminar todos los platos de una promoción
  removeAllDishesFromPromotion: async (promotionId: string) => {
    try {
      const { error } = await supabase.from("promotion_dishes").delete().eq("promotion_id", promotionId)

      if (error) throw error
      return true
    } catch (error) {
      log.error("Error removing dishes from promotion:", { error: String(error) })
      throw error
    }
  },
}
