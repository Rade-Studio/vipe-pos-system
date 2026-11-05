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

// T7b: categories, dishes and promotions come from the catalog API.
const catalogApi = vi.hoisted(() => ({
  fetchCategories: vi.fn(),
  fetchDishes: vi.fn(),
  fetchPromotions: vi.fn(),
}))
vi.mock("@/lib/api/catalog", () => catalogApi)

// T12: the staff list comes from `GET /api/staff`.
const staffApi = vi.hoisted(() => ({ listStaff: vi.fn() }))
vi.mock("@/lib/api/staff", () => staffApi)

import {
  ADMIN_LIST_STALE_MS,
  ADMIN_STAFF_ROLES,
  catalogKeys,
  fetchCategories,
  fetchDishes,
  fetchPromotions,
  fetchStaff,
  invalidateCatalogReaders,
} from "./catalog"

beforeEach(() => {
  for (const fn of Object.values(catalogApi)) fn.mockReset().mockResolvedValue([])
  state.calls.length = 0
  for (const key of Object.keys(state.results)) delete state.results[key]
})

const ALL_KEYS = [
  catalogKeys.categories,
  catalogKeys.dishes,
  catalogKeys.promotions,
  catalogKeys.staff,
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
    // menu reads must share a prefix.
    expect(catalogKeys.categories[0]).toBe(catalogKeys.dishes[0])
    expect(catalogKeys.categories[0]).toBe(catalogKeys.promotions[0])
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
    ]) {
      expect(typeof fetcher).toBe("function")
    }
  })

  it("reads the whole catalog through the API (no filter: the admin lists show inactive rows too)", async () => {
    await fetchCategories()
    await fetchDishes()
    await fetchPromotions()

    expect(catalogApi.fetchCategories).toHaveBeenCalledWith()
    expect(catalogApi.fetchDishes).toHaveBeenCalledWith()
    expect(catalogApi.fetchPromotions).toHaveBeenCalledWith()
    expect(state.calls).toEqual([])
  })

  it("reads the staff through the API, never from profiles", async () => {
    staffApi.listStaff.mockResolvedValue([])
    await fetchStaff()

    expect(staffApi.listStaff).toHaveBeenCalledWith()
    expect(state.calls).toEqual([])
  })

  it("keeps exactly the staff roles the Personal screen manages (never admin)", async () => {
    const roles = ["admin", ...ADMIN_STAFF_ROLES]
    staffApi.listStaff.mockResolvedValue(roles.map((role) => ({ id: role, role })))

    const staff = await fetchStaff()

    expect(staff.map((member) => member.role)).toEqual([...ADMIN_STAFF_ROLES])
    expect(ADMIN_STAFF_ROLES).not.toContain("admin")
  })

  it("raises instead of swallowing a failed read, so the screen can show its error state", async () => {
    catalogApi.fetchCategories.mockRejectedValue(new Error("boom"))

    await expect(fetchCategories()).rejects.toThrow("boom")
  })
})

describe("invalidateCatalogReaders", () => {
  it("refreshes the admin list and the POS and delivery menus", async () => {
    const invalidateQueries = vi.fn(async (_filters: { queryKey: unknown }) => undefined)

    await invalidateCatalogReaders({ invalidateQueries } as never, catalogKeys.dishes)

    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      catalogKeys.dishes,
      ["menu"],
      ["delivery-menu-categories"],
      ["delivery-menu-dishes"],
    ])
  })
})

describe("ADMIN_LIST_STALE_MS", () => {
  it("is long enough that revisiting a sub-tab inside it costs zero requests", () => {
    expect(ADMIN_LIST_STALE_MS).toBeGreaterThan(30_000)
  })
})
