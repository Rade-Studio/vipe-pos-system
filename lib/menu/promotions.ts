/**
 * Promotion matching for the waiter menu (T6/S1).
 *
 * `dishServiceWithPromotions` used to carry two copies of the same
 * match-the-best-promotion loop and read the whole `promotion_dishes` table to
 * decide the price of ~10 dishes. The rule lives here, is index-driven over the
 * rows the caller asked for, and is used by both service reads.
 */

import type { Promotion } from "@/lib/supabase/promotion-service"

/** One `promotion_dishes` row, already narrowed to the loaded dishes. */
export type PromotionDishRow = { dish_id: string; promotion_id: string }

export type DishWithPromotion = {
  id: string
  price: number
  originalPrice?: number
  discountAmount?: number
  discountPercentage?: number | null
  promotionId?: string
  promotionName?: string
}

/** Percentage discounts round to whole units; fixed discounts never exceed the price. */
export function calculateDiscount(price: number, promotion: Promotion): number {
  const value = promotion.discount_value ?? 0
  if (promotion.discount_type === "percentage") {
    return Math.round((price * value) / 100)
  }
  return Math.min(price, value)
}

/**
 * Returns the promotion giving the largest discount, or null when none of the
 * supplied promotions applies. Ties keep the first one, matching the previous
 * per-dish loop.
 */
export function bestPromotionForDish(
  price: number,
  promotionIds: readonly string[],
  promotions: readonly Promotion[],
): Promotion | null {
  const applicable = promotions.filter((promotion) => promotionIds.includes(promotion.id))
  let best: Promotion | null = null
  let maxDiscount = 0
  for (const promotion of applicable) {
    const discount = calculateDiscount(price, promotion)
    if (discount > maxDiscount) {
      maxDiscount = discount
      best = promotion
    }
  }
  return best
}

/**
 * Returns the dish with the best promotion applied. A dish with no applicable
 * promotion is returned untouched (no promotion fields added), exactly as
 * before, so the grid never renders a discount badge it did not earn.
 */
export function applyBestPromotion<T extends DishWithPromotion>(
  dish: T,
  promotionIds: readonly string[],
  promotions: readonly Promotion[],
): T & DishWithPromotion {
  const best = bestPromotionForDish(dish.price, promotionIds, promotions)
  if (!best) return dish

  const discountAmount = calculateDiscount(dish.price, best)
  return {
    ...dish,
    originalPrice: dish.price,
    price: dish.price - discountAmount,
    discountAmount,
    discountPercentage: best.discount_type === "percentage" ? best.discount_value : null,
    promotionId: best.id,
    promotionName: best.name,
  }
}

/** Applies promotions to a dish list, indexing the rows by dish id once. */
export function applyPromotionsToDishes<T extends DishWithPromotion>(
  dishes: readonly T[],
  promotionDishes: readonly PromotionDishRow[],
  promotions: readonly Promotion[],
): (T & DishWithPromotion)[] {
  const idsByDish = new Map<string, string[]>()
  for (const row of promotionDishes) {
    const bucket = idsByDish.get(row.dish_id)
    if (bucket) bucket.push(row.promotion_id)
    else idsByDish.set(row.dish_id, [row.promotion_id])
  }

  return dishes.map((dish) => applyBestPromotion(dish, idsByDish.get(dish.id) ?? [], promotions))
}