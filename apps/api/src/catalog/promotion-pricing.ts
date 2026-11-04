/**
 * Promotion pricing, ported from the web's lib/menu/promotions.ts (T7b): the
 * rules are unchanged, only the field names are camelCase. Pure; the caller
 * supplies the promotions active now and the promotion_dishes rows of the
 * dishes it loaded.
 */

export interface PricingPromotion {
  id: string;
  name: string;
  discountType: 'percentage' | 'fixed_amount';
  discountValue: number | null;
}

/** One `promotion_dishes` row, already narrowed to the loaded dishes. */
export interface PromotionDishRow {
  dishId: string;
  promotionId: string;
}

export interface DishWithPromotion {
  id: string;
  price: number;
  originalPrice?: number;
  discountAmount?: number;
  discountPercentage?: number | null;
  promotionId?: string;
  promotionName?: string;
}

/** Percentage discounts round to whole units; fixed discounts never exceed the price. */
export function calculateDiscount(price: number, promotion: PricingPromotion): number {
  const value = promotion.discountValue ?? 0;
  if (promotion.discountType === 'percentage') {
    return Math.round((price * value) / 100);
  }
  return Math.min(price, value);
}

/**
 * The promotion giving the largest discount, or null when none of the supplied
 * promotions applies. Ties keep the first one in `promotions` order.
 */
export function bestPromotionForDish(
  price: number,
  promotionIds: readonly string[],
  promotions: readonly PricingPromotion[],
): PricingPromotion | null {
  const applicable = promotions.filter((promotion) => promotionIds.includes(promotion.id));
  let best: PricingPromotion | null = null;
  let maxDiscount = 0;
  for (const promotion of applicable) {
    const discount = calculateDiscount(price, promotion);
    if (discount > maxDiscount) {
      maxDiscount = discount;
      best = promotion;
    }
  }
  return best;
}

/**
 * The dish with the best promotion applied. A dish with no applicable
 * promotion is returned untouched (no promotion fields added).
 */
export function applyBestPromotion<T extends DishWithPromotion>(
  dish: T,
  promotionIds: readonly string[],
  promotions: readonly PricingPromotion[],
): T & DishWithPromotion {
  const best = bestPromotionForDish(dish.price, promotionIds, promotions);
  if (!best) return dish;

  const discountAmount = calculateDiscount(dish.price, best);
  return {
    ...dish,
    originalPrice: dish.price,
    price: dish.price - discountAmount,
    discountAmount,
    discountPercentage: best.discountType === 'percentage' ? best.discountValue : null,
    promotionId: best.id,
    promotionName: best.name,
  };
}

/** Applies promotions to a dish list, indexing the rows by dish id once. */
export function applyPromotionsToDishes<T extends DishWithPromotion>(
  dishes: readonly T[],
  promotionDishes: readonly PromotionDishRow[],
  promotions: readonly PricingPromotion[],
): (T & DishWithPromotion)[] {
  const idsByDish = new Map<string, string[]>();
  for (const row of promotionDishes) {
    const bucket = idsByDish.get(row.dishId);
    if (bucket) bucket.push(row.promotionId);
    else idsByDish.set(row.dishId, [row.promotionId]);
  }

  return dishes.map((dish) => applyBestPromotion(dish, idsByDish.get(dish.id) ?? [], promotions));
}
