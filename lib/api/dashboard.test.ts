import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** T12 (S2) — the four overview widgets come from ONE server-side summary. */

const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { fetchDashboardSummary } from "./dashboard"

beforeEach(() => {
  api.GET.mockReset()
})

describe("fetchDashboardSummary", () => {
  it("asks GET /dashboard/summary once with the window", async () => {
    const summary = {
      monthSales: 120000,
      kitchenOrders: 2,
      dailySales: [{ date: "2026-11-04", amount: 120000 }],
      popularDishes: [{ id: "d-1", name: "Sopa", count: 3 }],
    }
    api.GET.mockResolvedValueOnce({ data: summary })

    await expect(fetchDashboardSummary(30)).resolves.toEqual(summary)
    expect(api.GET).toHaveBeenCalledTimes(1)
    expect(api.GET).toHaveBeenCalledWith("/api/dashboard/summary", { params: { query: { days: "30" } } })
  })

  it("rejects instead of returning silent zeros", async () => {
    api.GET.mockRejectedValueOnce(new ApiError(500, "Internal Server Error", "boom"))
    await expect(fetchDashboardSummary(30)).rejects.toBeInstanceOf(ApiError)
  })
})
