import { supabase } from "./client"
import { log } from "@/lib/log"
import { applyPromotionsToDishes, calculateDiscount, type DishWithPromotion, type PromotionDishRow } from "@/lib/menu/promotions"
import type { Promotion } from "./promotion-service"

// Re-exported: the discount rule now lives in lib/menu/promotions.ts, but the
// service stays the public entry point for existing callers.
export { calculateDiscount }

type DishRow = { id: string; price: number } & Record<string, unknown>
type PromotionAppliedDish = DishRow & Partial<DishWithPromotion>

/** Rows of `promotion_dishes` needed for the dishes already loaded. */
const promotionDishSelect = "dish_id, promotion_id"

// Extender el servicio de platos para incluir promociones
//
// Los dos lectores devuelven `any[]` como antes (los llamantes de la app —
// p.ej. el formulario de domicilio — convierten el resultado por su cuenta);
// la precisión de tipos vive en `applyPromotionsToDishes`.
export const dishServiceWithPromotions = {
  // Obtener todas las promociones activas
  getActivePromotions: async () => {
    try {
      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("active", true)
        .lte("start_date", new Date().toISOString())
        .gte("end_date", new Date().toISOString())

      if (error) throw error
      return (data || []) as unknown as Promotion[]
    } catch (error) {
      log.error("Error getting active promotions:", { error: String(error) })
      return []
    }
  },

  // Obtener todos los platos con sus promociones aplicadas
  getAllWithPromotions: async (): Promise<any[]> => {
    try {
      // Obtener todos los platos
      const { data: dishes, error } = await supabase.from("dishes").select("*").order("name")

      if (error) throw error

      // Obtener todas las promociones activas
      const activePromotions = await dishServiceWithPromotions.getActivePromotions()

      // La relación se lee una sola vez para todo el menú (T6/S1): antes cada
      // vista repetía el mismo bucle de coincidencia sobre la tabla completa.
      const { data: promotionDishes, error: relError } = await supabase
        .from("promotion_dishes")
        .select(promotionDishSelect)

      if (relError) throw relError

      return applyPromotionsToDishes(dishes as DishRow[], (promotionDishes || []) as PromotionDishRow[], activePromotions) as PromotionAppliedDish[]
    } catch (error) {
      log.error("Error getting dishes with promotions:", { error: String(error) })
      throw error
    }
  },

  // Obtener platos por categoría con promociones aplicadas
  getByCategoryWithPromotions: async (categoryId: string): Promise<any[]> => {
    try {
      // Obtener platos de la categoría
      const { data: dishes, error } = await supabase
        .from("dishes")
        .select("*")
        .eq("category_id", categoryId)
        .eq("active", true)
        .order("name")

      if (error) throw error

      const dishRows = (dishes || []) as DishRow[]
      if (dishRows.length === 0) {
        return dishRows
      }

      // Obtener todas las promociones activas
      const activePromotions = await dishServiceWithPromotions.getActivePromotions()

      // T6/S1: solo las relaciones de los platos cargados. Leer la tabla
      // entera para decidir el precio de una categoría pequeña era una
      // descarga redundante en cada cambio de categoría y en cada remount
      // del menú.
      const { data: promotionDishes, error: relError } = await supabase
        .from("promotion_dishes")
        .select(promotionDishSelect)
        .in(
          "dish_id",
          dishRows.map((dish) => dish.id),
        )

      if (relError) throw relError

      return applyPromotionsToDishes(dishRows, (promotionDishes || []) as PromotionDishRow[], activePromotions) as PromotionAppliedDish[]
    } catch (error) {
      throw error
    }
  },
}