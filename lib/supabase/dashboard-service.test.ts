/**
 * T9 (S1/S2) — dashboard reads.
 *
 * The audit found the popular-dishes read pulled EVERY paid order_item ever
 * (`select(name, dish_id, quantity, orders!inner(status))` with no date filter
 * and no limit), and that `getDashboardStats` chained four reads one after the
 * other on every dashboard mount. The split reads below are the ones the admin
 * screen issues; the assertion that matters is the bound on popular dishes, so
 * the "every row ever" read can never come back unnoticed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { dashboardService } from "./dashboard-service"
import { POPULAR_DISHES_DAYS } from "@/lib/admin/dashboard"

type Call = { table: string; method: string; args: unknown[] }

const state = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const calls: Call[] = []
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
    chain.eq = record("eq")
    chain.gte = record("gte")
    chain.lte = record("lte")
    chain.order = record("order")
    chain.in = record("in")
    chain.limit = record("limit")
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

beforeEach(() => {
  state.calls.length = 0
  for (const key of Object.keys(state.results)) delete state.results[key]
})

const callTo = (table: string, method: string) =>
  state.calls.find((call) => call.table === table && call.method === method)

describe("getPopularDishes — bounded read", () => {
  it("never reads every paid item ever: it filters the embedded order by date", async () => {
    state.results.order_items = {
      data: [
        { name: "Bandeja", dish_id: "d-1", quantity: 2 },
        { name: "Jugo", dish_id: "d-2", quantity: 5 },
      ],
      error: null,
    }

    await dashboardService.getPopularDishes()

    const gte = callTo("order_items", "gte")
    expect(gte).toBeDefined()
    expect(gte!.args[0]).toBe("orders.created_at")
    expect(typeof gte!.args[1]).toBe("string")

    const since = new Date(gte!.args[1] as string)
    const expectedFrom = new Date()
    expectedFrom.setDate(expectedFrom.getDate() - POPULAR_DISHES_DAYS)
    expect(Math.abs(since.getTime() - expectedFrom.getTime())).toBeLessThan(60_000)
  })

  it("asks for the embedded order columns the bound filters on", async () => {
    await dashboardService.getPopularDishes(5, "2026-01-01T00:00:00.000Z")

    const select = callTo("order_items", "select")
    expect(String(select!.args[0])).toMatch(/orders!inner\([^)]*status/)
    expect(String(select!.args[0])).toMatch(/orders!inner\([^)]*created_at/)
    expect(callTo("order_items", "eq")!.args).toEqual(["orders.status", "paid"])
    expect(callTo("order_items", "gte")!.args).toEqual(["orders.created_at", "2026-01-01T00:00:00.000Z"])
  })

  it("still aggregates by dish name, sorts by quantity and honours the limit", async () => {
    state.results.order_items = {
      data: [
        { name: "Bandeja", dish_id: "d-1", quantity: 2 },
        { name: "Bandeja", dish_id: "d-1", quantity: 3 },
        { name: "Jugo", dish_id: "d-2", quantity: 9 },
        { name: "Café", dish_id: "d-3", quantity: 7 },
      ],
      error: null,
    }

    const dishes = await dashboardService.getPopularDishes(2)

    expect(dishes).toEqual([
      { id: "d-2", name: "Jugo", count: 9 },
      { id: "d-3", name: "Café", count: 7 },
    ])
  })

  it("returns an empty list (never throws) when the read fails", async () => {
    state.results.order_items = { data: null, error: new Error("boom") }

    await expect(dashboardService.getPopularDishes()).resolves.toEqual([])
  })
})

describe("getMonthSales", () => {
  it("sums the paid orders from the given boundary", async () => {
    state.results.orders = {
      data: [{ total: 100 }, { total: null }, { total: 50.5 }],
      error: null,
    }

    const sales = await dashboardService.getMonthSales("2026-01-01T00:00:00.000Z")

    expect(sales).toBe(150.5)
    expect(callTo("orders", "eq")!.args).toEqual(["status", "paid"])
    expect(callTo("orders", "gte")!.args).toEqual(["created_at", "2026-01-01T00:00:00.000Z"])
  })

  it("returns 0 when the read fails", async () => {
    state.results.orders = { data: null, error: new Error("boom") }

    await expect(dashboardService.getMonthSales("2026-01-01T00:00:00.000Z")).resolves.toBe(0)
  })
})

describe("countOrdersByStatus", () => {
  it("counts the rows of one status", async () => {
    state.results.orders = { data: [{ id: "o-1" }, { id: "o-2" }], error: null }

    await expect(dashboardService.countOrdersByStatus("kitchen")).resolves.toBe(2)
    expect(callTo("orders", "eq")!.args).toEqual(["status", "kitchen"])
  })

  it("returns 0 when the read fails", async () => {
    state.results.orders = { data: null, error: new Error("boom") }

    await expect(dashboardService.countOrdersByStatus("kitchen")).resolves.toBe(0)
  })
})

describe("getDailySales — still bounded by the requested window", () => {
  it("groups paid orders per day inside the window", async () => {
    state.results.orders = {
      data: [
        { created_at: "2026-01-14T10:00:00.000Z", total: 100 },
        { created_at: "2026-01-14T18:00:00.000Z", total: 50 },
        { created_at: "2026-01-15T09:00:00.000Z", total: 25 },
      ],
      error: null,
    }

    const series = await dashboardService.getDailySales(30)

    expect(series).toEqual([
      { date: "2026-01-14", amount: 150 },
      { date: "2026-01-15", amount: 25 },
    ])
    expect(callTo("orders", "gte")).toBeDefined()
    expect(callTo("orders", "eq")!.args).toEqual(["status", "paid"])
  })

  it("returns an empty series when the read fails", async () => {
    state.results.orders = { data: null, error: new Error("boom") }

    await expect(dashboardService.getDailySales()).resolves.toEqual([])
  })
})