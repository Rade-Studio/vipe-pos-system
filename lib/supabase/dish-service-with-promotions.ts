import { Promotion } from "@/types/models"
import { supabase } from "./client"

// Función para calcular el descuento
export function calculateDiscount(price: number, promotion: Promotion): number {
  if (promotion.discount_type === "percentage") {
    return Math.round((price * promotion.discount_value) / 100)
  } else {
    return Math.min(price, promotion.discount_value) // El descuento no puede ser mayor que el precio
  }
}

// Extender el servicio de platos para incluir promociones
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
      return data || []
    } catch (error) {
      console.error("Error getting active promotions:", error)
      return []
    }
  },

  // Obtener todos los platos con sus promociones aplicadas
  getAllWithPromotions: async () => {
    try {
      // Obtener todos los platos
      const { data: dishes, error } = await supabase.from("dishes").select("*").order("name")

      if (error) throw error

      // Obtener todas las promociones activas
      const activePromotions = await dishServiceWithPromotions.getActivePromotions()

      // Obtener la relación entre promociones y platos
      const { data: promotionDishes, error: relError } = await supabase.from("promotion_dishes").select("*")

      if (relError) throw relError

      // Aplicar promociones a los platos
      const dishesWithPromotions = dishes.map((dish) => {
        // Buscar promociones aplicables a este plato
        const applicablePromotionIds = promotionDishes
          .filter((pd) => pd.dish_id === dish.id)
          .map((pd) => pd.promotion_id)

        // Encontrar la mejor promoción (la que ofrece mayor descuento)
        let bestPromotion = null
        let maxDiscount = 0

        for (const promotionId of applicablePromotionIds) {
          const promotion = activePromotions.find((p) => p.id === promotionId)
          if (promotion) {
            const discount = calculateDiscount(dish.price, promotion)
            if (discount > maxDiscount) {
              maxDiscount = discount
              bestPromotion = promotion
            }
          }
        }

        // Aplicar la mejor promoción si existe
        if (bestPromotion) {
          const discountAmount = calculateDiscount(dish.price, bestPromotion)
          return {
            ...dish,
            originalPrice: dish.price,
            price: dish.price - discountAmount,
            discountAmount,
            discountPercentage: bestPromotion.discount_type === "percentage" ? bestPromotion.discount_value : null,
            promotionId: bestPromotion.id,
            promotionName: bestPromotion.name,
          }
        }

        return dish
      })

      return dishesWithPromotions
    } catch (error) {
      console.error("Error getting dishes with promotions:", error)
      throw error
    }
  },

  // Obtener platos por categoría con promociones aplicadas
  getByCategoryWithPromotions: async (categoryId: string) => {
    try {
      // Obtener platos de la categoría
      const { data: dishes, error } = await supabase
        .from("dishes")
        .select("*")
        .eq("category_id", categoryId)
        .eq("active", true)
        .order("name")

      if (error) throw error

      // Obtener todas las promociones activas
      const activePromotions = await dishServiceWithPromotions.getActivePromotions()

      // Obtener la relación entre promociones y platos
      const { data: promotionDishes, error: relError } = await supabase.from("promotion_dishes").select("*")

      if (relError) throw relError

      // Aplicar promociones a los platos
      const dishesWithPromotions = dishes.map((dish) => {
        // Buscar promociones aplicables a este plato
        const applicablePromotionIds = promotionDishes
          .filter((pd) => pd.dish_id === dish.id)
          .map((pd) => pd.promotion_id)

        // Encontrar la mejor promoción (la que ofrece mayor descuento)
        let bestPromotion = null
        let maxDiscount = 0

        for (const promotionId of applicablePromotionIds) {
          const promotion = activePromotions.find((p) => p.id === promotionId)
          if (promotion) {
            const discount = calculateDiscount(dish.price, promotion)
            if (discount > maxDiscount) {
              maxDiscount = discount
              bestPromotion = promotion
            }
          }
        }

        // Aplicar la mejor promoción si existe
        if (bestPromotion) {
          const discountAmount = calculateDiscount(dish.price, bestPromotion)
          return {
            ...dish,
            originalPrice: dish.price,
            price: dish.price - discountAmount,
            discountAmount,
            discountPercentage: bestPromotion.discount_type === "percentage" ? bestPromotion.discount_value : null,
            promotionId: bestPromotion.id,
            promotionName: bestPromotion.name,
          }
        }

        return dish
      })

      return dishesWithPromotions
    } catch (error) {
      throw error
    }
  },
}
