import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T6 (S1) — `DishGrid` called `checkStockForDish(dish.id)` once per dish and
 * each call ran three sequential reads (recipes -> recipe_ingredients ->
 * ingredients): ~30 requests for one category of 10 dishes, blocking the whole
 * grid behind its slowest dish. `checkStockForDishes` reads the three tables
 * once for the whole category; this suite pins both the request count and the
 * availability contract the grid renders (a failed read means "available", the
 * pre-existing fallback, never "everything is Agotado").
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

vi.mock("@/lib/supabase", () => ({
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
      builder.single = () => resolve()
      builder.update = () => builder
      builder.insert = () => builder
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

import inventoryControlService from "./inventory-control-service"

const UUID_A = "11111111-1111-1111-1111-111111111111"
const UUID_B = "22222222-2222-2222-2222-222222222222"
const UUID_C = "33333333-3333-3333-3333-333333333333"
const UUID_D = "44444444-4444-4444-4444-444444444444"

const dishIds = [UUID_A, UUID_B, UUID_C, UUID_D]

const seed = () => {
  state.data = {
    recipes: [
      { id: "r-1", dish_id: UUID_A },
      { id: "r-2", dish_id: UUID_C },
    ],
    recipe_ingredients: [
      { recipe_id: "r-1", ingredient_id: "i-1", quantity: 2 },
      { recipe_id: "r-2", ingredient_id: "i-2", quantity: 9 },
    ],
    ingredients: [
      { id: "i-1", name: "Arroz", stock: 10, unit: "g" },
      { id: "i-2", name: "Pollo", stock: 1, unit: "u" },
    ],
  }
}

const requestsFor = (table: string) => state.requests.filter((r) => r.table === table)

describe("checkStockForDishes — batched read (T6/S1)", () => {
  beforeEach(() => {
    state.reset()
    seed()
  })

  it("reads recipes, recipe ingredients and ingredients exactly once for the whole category", async () => {
    await inventoryControlService.checkStockForDishes(dishIds)
    expect(state.requests.map((r) => r.table)).toEqual(["recipes", "recipe_ingredients", "ingredients"])
  })

  it("scopes each read to the ids of the previous step", async () => {
    await inventoryControlService.checkStockForDishes(dishIds)
    expect(requestsFor("recipes")[0].in).toEqual([["dish_id", dishIds]])
    expect(requestsFor("recipe_ingredients")[0].in).toEqual([["recipe_id", ["r-1", "r-2"]]])
    expect(requestsFor("ingredients")[0].in).toEqual([["id", ["i-1", "i-2"]]])
  })

  it("marks only the dish whose ingredients are short as unavailable", async () => {
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect(result.get(UUID_A)).toBe(true)
    expect(result.get(UUID_B)).toBe(true) // no recipe
    expect(result.get(UUID_C)).toBe(false) // 9 needed, 1 in stock
    expect(result.get(UUID_D)).toBe(true) // no recipe
  })

  it("de-duplicates repeated dish ids", async () => {
    const result = await inventoryControlService.checkStockForDishes([UUID_A, UUID_A, UUID_A])
    expect(result.size).toBe(1)
    expect(requestsFor("recipes")[0].in).toEqual([["dish_id", [UUID_A]]])
  })

  it("truncates a cart-concatenated id to its uuid, like the per-dish path did", async () => {
    const result = await inventoryControlService.checkStockForDishes([`${UUID_A}-extra`])
    expect(result.get(UUID_A)).toBe(true)
    expect(requestsFor("recipes")[0].in).toEqual([["dish_id", [UUID_A]]])
  })

  it("issues no request for ids that are not uuids", async () => {
    const result = await inventoryControlService.checkStockForDishes(["not-a-uuid"])
    expect(state.requests).toHaveLength(0)
    expect(result.size).toBe(0)
  })

  it("issues no request for an empty dish list", async () => {
    const result = await inventoryControlService.checkStockForDishes([])
    expect(state.requests).toHaveLength(0)
    expect(result.size).toBe(0)
  })

  it("stops after the recipes read when no dish has a recipe", async () => {
    state.data = { ...state.data, recipes: [] }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect(state.requests.map((r) => r.table)).toEqual(["recipes"])
    expect([...result.values()].every(Boolean)).toBe(true)
  })

  it("stops after recipe_ingredients when no recipe lists ingredients", async () => {
    state.data = { ...state.data, recipe_ingredients: [] }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect(state.requests.map((r) => r.table)).toEqual(["recipes", "recipe_ingredients"])
    expect([...result.values()].every(Boolean)).toBe(true)
  })

  it("falls back to available when a read fails, never to Agotado", async () => {
    state.errors = { recipes: { message: "boom" } }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect([...result.values()].every(Boolean)).toBe(true)
    expect(result.size).toBe(dishIds.length)
  })

  // T6 fix (verifier BLOCKER): these two reads failing is not "everything
  // available". `checkDishStock` answered hasRecipe: true / hasAllIngredients:
  // false, so a dish WITH a recipe was unavailable and one without a recipe was
  // available. The batched read has to keep that rule.
  it("marks dishes with a recipe unavailable when the recipe_ingredients read fails", async () => {
    state.errors = { recipe_ingredients: { message: "boom" } }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect(result.get(UUID_A)).toBe(false) // r-1
    expect(result.get(UUID_C)).toBe(false) // r-2
    expect(result.get(UUID_B)).toBe(true) // no recipe
    expect(result.get(UUID_D)).toBe(true) // no recipe
  })

  it("marks dishes with a recipe unavailable when the ingredients read fails", async () => {
    state.errors = { ingredients: { message: "boom" } }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect(result.get(UUID_A)).toBe(false) // r-1
    expect(result.get(UUID_C)).toBe(false) // r-2
    expect(result.get(UUID_B)).toBe(true) // no recipe
    expect(result.get(UUID_D)).toBe(true) // no recipe
  })

  it("keeps a failed recipes read on the old rule: everything available", async () => {
    state.errors = { recipes: { message: "boom" } }
    const result = await inventoryControlService.checkStockForDishes(dishIds)
    expect([...result.values()]).toEqual([true, true, true, true])
  })
})

describe("checkStockForDish — single dish through the batched path (preserve)", () => {
  beforeEach(() => {
    state.reset()
    seed()
  })

  it("returns true for a dish whose ingredients are covered", async () => {
    await expect(inventoryControlService.checkStockForDish(UUID_A)).resolves.toBe(true)
  })

  it("returns false for a dish whose ingredients are short", async () => {
    await expect(inventoryControlService.checkStockForDish(UUID_C)).resolves.toBe(false)
  })

  it("returns true for a dish without a recipe", async () => {
    await expect(inventoryControlService.checkStockForDish(UUID_B)).resolves.toBe(true)
  })

  it("returns true for an id that is not a uuid", async () => {
    await expect(inventoryControlService.checkStockForDish("not-a-uuid")).resolves.toBe(true)
    expect(state.requests).toHaveLength(0)
  })

  it("uses three reads for a single dish, the same as before", async () => {
    await inventoryControlService.checkStockForDish(UUID_A)
    expect(state.requests.map((r) => r.table)).toEqual(["recipes", "recipe_ingredients", "ingredients"])
  })

  // T6 fix (verifier BLOCKER): the single-dish API delegates to the batch, so
  // it must reproduce `checkDishStock`'s answer for a failed ingredient read.
  it("returns false for a dish with a recipe when the ingredients read fails", async () => {
    state.errors = { ingredients: { message: "boom" } }
    await expect(inventoryControlService.checkStockForDish(UUID_A)).resolves.toBe(false)
  })

  it("returns true for a dish without a recipe when the ingredients read fails", async () => {
    state.errors = { ingredients: { message: "boom" } }
    await expect(inventoryControlService.checkStockForDish(UUID_B)).resolves.toBe(true)
  })

  it("returns true for a dish with a recipe when the recipes read fails", async () => {
    state.errors = { recipes: { message: "boom" } }
    await expect(inventoryControlService.checkStockForDish(UUID_A)).resolves.toBe(true)
  })
})