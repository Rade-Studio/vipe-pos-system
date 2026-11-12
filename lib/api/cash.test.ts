import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** caja-cierres T3 (S5, S6) — the admin's business day and its ledger come from GET /cash/days/{date}[/ledger]. */

const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { fetchCashDay, fetchCashLedger, fetchCashReport, REPORT_MAX_DAYS } from "./cash"

beforeEach(() => {
  api.GET.mockReset()
})

describe("cash", () => {
  it("reads the business day summary with GET /cash/days/{date}", async () => {
    const day = { date: "2026-11-10", status: "closed", registers: [] }
    api.GET.mockResolvedValueOnce({ data: day })
    await expect(fetchCashDay("2026-11-10")).resolves.toEqual(day)
    expect(api.GET).toHaveBeenCalledWith("/api/cash/days/{date}", { params: { path: { date: "2026-11-10" } } })
  })

  it("reads the day ledger with GET /cash/days/{date}/ledger", async () => {
    const ledger = { date: "2026-11-10", entries: [{ kind: "opening", cashDelta: 200000, cashBalance: 200000 }] }
    api.GET.mockResolvedValueOnce({ data: ledger })
    await expect(fetchCashLedger("2026-11-10")).resolves.toEqual(ledger)
    expect(api.GET).toHaveBeenCalledWith("/api/cash/days/{date}/ledger", { params: { path: { date: "2026-11-10" } } })
  })

  it("reads the period report with from, to and group", async () => {
    const report = { from: "2026-11-01", to: "2026-11-30", group: "week", buckets: [] }
    api.GET.mockResolvedValueOnce({ data: report })
    await expect(fetchCashReport({ from: "2026-11-01", to: "2026-11-30", group: "week" })).resolves.toEqual(report)
    expect(api.GET).toHaveBeenCalledWith("/api/cash/report", {
      params: { query: { from: "2026-11-01", to: "2026-11-30", group: "week" } },
    })
    expect(REPORT_MAX_DAYS).toBe(366)
  })

  it("passes API errors through and rejects an empty response", async () => {
    api.GET.mockRejectedValueOnce(new ApiError(403, "Forbidden", "Forbidden"))
    await expect(fetchCashDay("2026-11-10")).rejects.toMatchObject({ status: 403 })
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(fetchCashDay("2026-11-10")).rejects.toBeInstanceOf(ApiError)
  })
})
