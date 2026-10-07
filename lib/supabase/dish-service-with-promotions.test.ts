import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T6 (S1) — `getByCategoryWithPromotions` runs on every category change and on
 * every remount of the waiter menu, and it read the WHOLE `promotion_dishes`
 * table to match the ~10 dishes of one category. The suite pins the request
 * shape (three reads, the third scoped to the loaded dishes) and keeps the
 * pricing behavior the menu relies on.
 */

type Request = {
  table: string
  select: string
  eq: [string, unknown][]
  in: [string, unknown][]
}

const state = vi.hoisted(() => {
  return {
    requests: [] as Request[],
    data: {} as Record<string, unknown[]>,
    errors: {} as Record<string, unknown>,
    reset() {
      this.requests = []
      this.data = {}
      this.errors = {}
    },
  }
})

vi.mock("./client", () => ({
  supabase: {
    from(table: string) {
      const request: Request = { table, select: "", eq: [], in: [] }
      const builder: Record<string, unknown> = {}
      const resolve = () =>
        Promise.resolve(
          state.errors[table]
            ? { data: null, error: state.errors[table] }
            : { data: applyFilters(state.data[table] ?? [], request), error: null },
        )
      builder.select = (cols: string) => {
        request.select = cols
        state.requests.push(request)
        return builder
      }
      builder.eq = (col: string, value: unknown) => {
        request.eq.push([col, value])
        return builder
      }
      builder.in = (col: string, value: unknown) => {
        request.in.push([col, value])
        return builder
      }
      builder.order = () => builder
      builder.lte = () => builder
      builder.gte = () => builder
      builder.single = () => resolve()
      builder.then = (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled as never, onRejected as never)
      return builder
    },
  },
}))

/** Mimics PostgREST's `.eq()`/`.in()` narrowing so the mock behaves like the server. */
function applyFilters(rows: unknown[], request: Request): unknown[] {
  const eqFiltered = request.eq.reduce(
    (acc, [column, value]) => acc.filter((row) => (row as Record<string, unknown>)[column] === value),
    rows,
  )
  return request.in.reduce((acc, [column, values]) => {
    const wanted = new Set(values as unknown[])
    return acc.filter((row) => wanted.has((row as Record<string, unknown>)[column]))
  }, eqFiltered)
}

import { dishServiceWithPromotions, calculateDiscount } from "./dish-service-with-promotions"

const dishes = [
  { id: "d-1", name: "Bandeja", price: 20000, category_id: "cat-1", image_url: "/b.png", active: true },
  { id: "d-2", name: "Sopa", price: 8000, category_id: "cat-1", image_url: null, active: true },
  { id: "d-9", name: "Otro", price: 100, category_id: "cat-2", image_url: null, active: true },
]

const promotions = [
  {
    id: "p-10",
    name: "Lunch",
    description: null,
    discount_type: "percentage",
    discount_value: 10,
    start_date: "2020-01-01",
    end_date: "2099-01-01",
    active: true,
  },
]

const promotionDishes = [
  { id: "pd-1", promotion_id: "p-10", dish_id: "d-1" },
  // A row for a dish outside the loaded category: the server must never be
  // asked for it, and the response must not reach the price calculation.
  { id: "pd-2", promotion_id: "p-10", dish_id: "d-9" },
]

const requestsFor = (table: string) => state.requests.filter((r) => r.table === table)

describe("dishServiceWithPromotions.getByCategoryWithPromotions — request shape (T6/S1)", () => {
  beforeEach(() => {
    state.reset()
    state.data = { dishes, promotions, promotion_dishes: promotionDishes }
  })

  it("asks for only the promotion_dishes of the loaded dishes", async () => {
    await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")

    const [request] = requestsFor("promotion_dishes")
    expect(request.in).toEqual([["dish_id", ["d-1", "d-2"]]])
    expect(request.select).toBe("dish_id, promotion_id")
  })

  it("keeps the request count at three (dishes, promotions, promotion_dishes)", async () => {
    await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")
    expect(state.requests.map((r) => r.table)).toEqual(["dishes", "promotions", "promotion_dishes"])
  })

  it("still filters the dishes by category and active", async () => {
    await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")
    const [request] = requestsFor("dishes")
    expect(request.eq).toEqual([
      ["category_id", "cat-1"],
      ["active", true],
    ])
  })

  it("skips the promotion_dishes read when the category has no dishes", async () => {
    state.data = { dishes: [], promotions, promotion_dishes: promotionDishes }
    const result = await dishServiceWithPromotions.getByCategoryWithPromotions("cat-empty")
    expect(result).toEqual([])
    expect(requestsFor("promotion_dishes")).toHaveLength(0)
  })
})

describe("dishServiceWithPromotions.getByCategoryWithPromotions — pricing (preserve)", () => {
  beforeEach(() => {
    state.reset()
    state.data = { dishes, promotions, promotion_dishes: promotionDishes }
  })

  it("applies the promotion of a loaded dish and leaves the others alone", async () => {
    const result = (await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")) as Record<string, unknown>[]
    expect(result[0]).toMatchObject({
      id: "d-1",
      originalPrice: 20000,
      price: 18000,
      discountAmount: 2000,
      discountPercentage: 10,
      promotionName: "Lunch",
    })
    expect(result[1]).toMatchObject({ id: "d-2", price: 8000 })
    expect(result[1].promotionId).toBeUndefined()
  })

  it("returns the raw dish fields the menu reads", async () => {
    const result = (await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")) as Record<string, unknown>[]
    expect(result[0]).toMatchObject({ name: "Bandeja", category_id: "cat-1", image_url: "/b.png" })
  })

  it("returns undiscounted dishes when the promotions read fails", async () => {
    state.errors = { promotions: { message: "boom" } }
    const result = (await dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")) as Record<string, unknown>[]
    expect(result[0].price).toBe(20000)
    expect(result[0].promotionId).toBeUndefined()
  })

  it("rethrows when the dishes read fails", async () => {
    state.errors = { dishes: { message: "boom" } }
    await expect(dishServiceWithPromotions.getByCategoryWithPromotions("cat-1")).rejects.toThrow()
  })

  it("keeps re-exporting calculateDiscount for its existing callers", () => {
    expect(calculateDiscount(10000, promotions[0] as never)).toBe(1000)
  })
})

describe("dishServiceWithPromotions.getAllWithPromotions — preserve", () => {
  beforeEach(() => {
    state.reset()
    state.data = { dishes, promotions, promotion_dishes: promotionDishes }
  })

  it("discounts every dish of the menu and reads each table once", async () => {
    const result = (await dishServiceWithPromotions.getAllWithPromotions()) as Record<string, unknown>[]
    expect(state.requests.map((r) => r.table)).toEqual(["dishes", "promotions", "promotion_dishes"])
    expect(result.find((d) => d.id === "d-1")).toMatchObject({ price: 18000, promotionId: "p-10" })
    expect(result.find((d) => d.id === "d-2")).toMatchObject({ price: 8000 })
  })
})