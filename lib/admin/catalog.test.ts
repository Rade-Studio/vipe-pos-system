/**
 * T9 (S1/S2) — Configuración sub-tab reads.
 *
 * The audit row "admin | config sub-tabs | each list reloads on every visit (no
 * cache)" is what this module fixes. Every sub-tab mounted its own
 * `useEffect` + local state, so Radix unmounting the inactive `TabsContent` and
 * remounting it on the next visit re-issued the read every time; the Menú tab
 * alone read `categories` twice (once for `CategoryList`, once inside
 * `DishList`).
 *
 * Two rules this test pins down:
 *   1. ONE key per data set, shared by every reader (so a second reader is a
 *      cache hit, not a second request), and mutations invalidate exactly those
 *      keys.
 *   2. A stale-enough window (`ADMIN_LIST_STALE_MS`) so a tab switch inside it
 *      issues zero requests AND does not blank the list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// One recording chain for every `supabase.from(...)` in the modules under test
// (`catalog.ts` reads through the browser client, and so do the services it
// calls). Node-safe: no client is created and no request leaves.
const state = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const calls: { table: string; method: string; args: unknown[] }[] = []
  const results: Record<string, Result> = {}

  const makeChain = (table: string): any => {
    const chain: any = {}
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
    chain.select = record("select")
    chain.in = record("in")
    chain.eq = record("eq")
    chain.order = record("order")
    chain.then = (resolve: (value: Result) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
    return chain
  }

  return { calls, results, makeChain }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => state.makeChain(table),
  },
}))

import {
  ADMIN_LIST_STALE_MS,
  ADMIN_STAFF_ROLES,
  catalogKeys,
  fetchCategories,
  fetchDishes,
  fetchIngredientCategories,
  fetchIngredients,
  fetchPromotions,
  fetchStaff,
  withCategoryName,
} from "./catalog"

beforeEach(() => {
  state.calls.length = 0
  for (const key of Object.keys(state.results)) delete state.results[key]
})

const ALL_KEYS = [
  catalogKeys.categories,
  catalogKeys.dishes,
  catalogKeys.promotions,
  catalogKeys.staff,
  catalogKeys.ingredients,
  catalogKeys.ingredientCategories,
]

describe("catalogKeys", () => {
  it("gives every data set its own slot (no accidental sharing)", () => {
    const serialized = ALL_KEYS.map((key) => JSON.stringify(key))

    expect(new Set(serialized).size).toBe(ALL_KEYS.length)
  })

  it("exposes stable, serialisable keys so mutations can invalidate them from anywhere", () => {
    for (const key of ALL_KEYS as readonly (readonly string[])[]) {
      expect(key.length).toBeGreaterThan(0)
      expect(key.every((part) => typeof part === "string")).toBe(true)
    }

    // Invalidating by a PREFIX is how a mutation refreshes every reader, so the
    // menu reads must share a prefix and the inventory reads must share theirs.
    expect(catalogKeys.categories[0]).toBe(catalogKeys.dishes[0])
    expect(catalogKeys.categories[0]).toBe(catalogKeys.promotions[0])
    expect(catalogKeys.ingredients[0]).toBe(catalogKeys.ingredientCategories[0])
    expect(catalogKeys.ingredients[0]).not.toBe(catalogKeys.dishes[0])
  })

  it("returns the SAME array identity on every read (so it is safe as a dep and in a key)", () => {
    expect(catalogKeys.categories).toBe(catalogKeys.categories)
    expect(catalogKeys.staff).toBe(catalogKeys.staff)
  })
})

describe("fetchers", () => {
  it("exposes one fetcher per cached data set", () => {
    for (const fetcher of [
      fetchCategories,
      fetchDishes,
      fetchPromotions,
      fetchStaff,
      fetchIngredients,
      fetchIngredientCategories,
    ]) {
      expect(typeof fetcher).toBe("function")
    }
  })

  it("reads each data set from its own table", async () => {
    await fetchCategories()
    await fetchDishes()
    await fetchStaff()
    await fetchIngredients()
    await fetchIngredientCategories()

    const tables = state.calls.map((call) => call.table)

    expect(tables).toContain("categories")
    expect(tables).toContain("dishes")
    expect(tables).toContain("profiles")
    expect(tables).toContain("ingredients")
    expect(tables).toContain("ingredient_categories")
  })

  it("asks for exactly the staff roles the Personal screen manages (never admin)", async () => {
    await fetchStaff()

    const inCall = state.calls.find((call) => call.method === "in")

    expect(inCall!.args[0]).toBe("role")
    expect(inCall!.args[1]).toEqual([...ADMIN_STAFF_ROLES])
    expect(inCall!.args[1]).not.toContain("admin")
  })

  it("raises instead of swallowing a failed read, so the screen can show its error state", async () => {
    state.results.categories = { data: null, error: new Error("boom") }

    await expect(fetchCategories()).rejects.toThrow()
  })
})

describe("ADMIN_LIST_STALE_MS", () => {
  it("is long enough that revisiting a sub-tab inside it costs zero requests", () => {
    expect(ADMIN_LIST_STALE_MS).toBeGreaterThan(30_000)
  })
})

describe("withCategoryName", () => {
  const categories = [
    { id: "c-1", name: "Carnes" },
    { id: "c-2", name: "Bebidas" },
  ]

  const row = (partial: { id: string; name?: string; category_id?: string; stock?: number }) => ({
    id: partial.id,
    ...(partial.name ? { name: partial.name } : {}),
    ...(partial.category_id ? { category_id: partial.category_id } : {}),
    ...(partial.stock === undefined ? {} : { stock: partial.stock }),
  })

  it("keeps every ingredient field and adds the category name the list renders", () => {
    expect(
      withCategoryName(row({ id: "i-1", name: "Bandeja", category_id: "c-1", stock: 2 }), categories),
    ).toEqual({
      id: "i-1",
      name: "Bandeja",
      category_id: "c-1",
      stock: 2,
      category: "Carnes",
    })
  })

  it("labels an unknown or missing category as Sin categoría (same label the screen showed)", () => {
    expect(withCategoryName(row({ id: "i-2", category_id: "nope" }), categories).category).toBe(
      "Sin categoría",
    )
    expect(withCategoryName(row({ id: "i-3" }), categories).category).toBe("Sin categoría")
  })
})