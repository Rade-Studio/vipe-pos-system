import { describe, expect, it } from "vitest"

import { applyBestPromotion, applyPromotionsToDishes, calculateDiscount } from "./promotions"
import type { Promotion } from "@/lib/supabase/promotion-service"

/**
 * T6 (S1) — `dishServiceWithPromotions` used to copy the promotion-matching
 * loop out of `getAllWithPromotions` into `getByCategoryWithPromotions`, twice,
 * and it read the WHOLE `promotion_dishes` table to match a handful of loaded
 * dishes. The matching rules move here so they are decided once, over an index
 * built from only the rows the caller asked for.
 */

const percentage = (id: string, name: string, value: number): Promotion => ({
  id,
  name,
  description: null,
  discount_type: "percentage",
  discount_value: value,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  active: true,
})

const fixed = (id: string, name: string, value: number): Promotion => ({
  id,
  name,
  description: null,
  discount_type: "fixed_amount",
  discount_value: value,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  active: true,
})

describe("calculateDiscount (T6/S1)", () => {
  it("rounds a percentage discount", () => {
    expect(calculateDiscount(9999, percentage("p-1", "10%", 10))).toBe(1000)
  })

  it("caps a fixed discount at the dish price", () => {
    expect(calculateDiscount(5000, fixed("p-2", "Fijo", 9000))).toBe(5000)
  })

  it("treats a null discount value as no discount", () => {
    expect(calculateDiscount(5000, { ...percentage("p-3", "Nula", 0), discount_value: null })).toBe(0)
  })
})

describe("applyBestPromotion (T6/S1)", () => {
  it("keeps the dish untouched when no promotion applies", () => {
    const dish = { id: "d-1", price: 12000 }
    const result = applyBestPromotion(dish, ["p-other"], [])
    expect(result).toEqual({ id: "d-1", price: 12000 })
    expect("promotionId" in result).toBe(false)
  })

  it("applies a percentage promotion and records the percentage", () => {
    const result = applyBestPromotion({ id: "d-1", price: 10000 }, ["p-10"], [percentage("p-10", "Lunch", 20)])
    expect(result).toMatchObject({
      originalPrice: 10000,
      price: 8000,
      discountAmount: 2000,
      discountPercentage: 20,
      promotionId: "p-10",
      promotionName: "Lunch",
    })
  })

  it("applies a fixed promotion with a null percentage", () => {
    const result = applyBestPromotion({ id: "d-1", price: 10000 }, ["p-f"], [fixed("p-f", "Combo", 3000)])
    expect(result).toMatchObject({
      originalPrice: 10000,
      price: 7000,
      discountAmount: 3000,
      discountPercentage: null,
      promotionName: "Combo",
    })
  })

  it("picks the promotion with the largest discount", () => {
    const result = applyBestPromotion(
      { id: "d-1", price: 10000 },
      ["p-small", "p-big"],
      [percentage("p-small", "5%", 5), percentage("p-big", "40%", 40)],
    )
    expect(result.promotionId).toBe("p-big")
    expect(result.price).toBe(6000)
  })

  it("keeps the first promotion on a tie", () => {
    const result = applyBestPromotion(
      { id: "d-1", price: 10000 },
      ["p-first", "p-second"],
      [percentage("p-first", "A", 20), percentage("p-second", "B", 20)],
    )
    expect(result.promotionId).toBe("p-first")
  })

  it("ignores a promotion id that is not active", () => {
    const result = applyBestPromotion({ id: "d-1", price: 10000 }, ["p-off"], [])
    expect(result.promotionId).toBeUndefined()
  })
})

describe("applyPromotionsToDishes (T6/S1)", () => {
  const dishes = [
    { id: "d-1", price: 10000 },
    { id: "d-2", price: 5000 },
    { id: "d-3", price: 8000 },
  ]

  it("discounts only the dishes named by the supplied rows", () => {
    const result = applyPromotionsToDishes(
      dishes,
      [{ dish_id: "d-1", promotion_id: "p-10" }],
      [percentage("p-10", "Lunch", 10)],
    )
    expect(result[0]).toMatchObject({ price: 9000, promotionId: "p-10" })
    expect(result[1]).toEqual({ id: "d-2", price: 5000 })
    expect(result[2]).toEqual({ id: "d-3", price: 8000 })
  })

  it("returns a new array without mutating the input", () => {
    const input = [{ id: "d-1", price: 10000 }]
    const result = applyPromotionsToDishes(input, [{ dish_id: "d-1", promotion_id: "p-10" }], [percentage("p-10", "L", 10)])
    expect(result).not.toBe(input)
    expect(input[0]).toEqual({ id: "d-1", price: 10000 })
  })

  it("keeps every other field of the dish row", () => {
    const result = applyPromotionsToDishes([{ id: "d-1", price: 10000, name: "Bandeja", active: true }], [], [])
    expect(result[0]).toMatchObject({ name: "Bandeja", active: true })
  })

  it("handles a dish appearing in two promotion rows", () => {
    const result = applyPromotionsToDishes(
      [{ id: "d-1", price: 10000 }],
      [
        { dish_id: "d-1", promotion_id: "p-10" },
        { dish_id: "d-1", promotion_id: "p-50" },
      ],
      [percentage("p-10", "10%", 10), percentage("p-50", "50%", 50)],
    )
    expect(result[0]).toMatchObject({ price: 5000, promotionId: "p-50" })
  })
})