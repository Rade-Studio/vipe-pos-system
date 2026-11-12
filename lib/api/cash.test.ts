import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** caja-cierres T3 (S5, S6, S7) — the admin's day, ledger and period come from the /cash endpoints; Validar turno posts once. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { emitZReport, fetchCashDay, fetchCashLedger, fetchCashReport, fetchZReport, fetchZReports, REPORT_MAX_DAYS, validateRegister } from "./cash"

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
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

  it("validates a closed shift with POST /registers/{id}/validate and returns the register", async () => {
    const register = { id: "r-1", validatedBy: { id: "p-1", name: "Mariana" }, validatedAt: "2026-11-11T13:00:00.000Z" }
    api.POST.mockResolvedValueOnce({ data: register })
    await expect(validateRegister("r-1")).resolves.toEqual(register)
    expect(api.POST).toHaveBeenCalledWith("/api/registers/{id}/validate", { params: { path: { id: "r-1" } } })
  })

  it("emits the day's Z with POST /cash/days/{date}/z and reads Zs by range and by number", async () => {
    const z = { number: 215, businessDay: "2026-11-10", emittedAt: "2026-11-11T04:12:00.000Z", emittedBy: null, snapshot: {} }
    api.POST.mockResolvedValueOnce({ data: z })
    await expect(emitZReport("2026-11-10")).resolves.toEqual(z)
    expect(api.POST).toHaveBeenCalledWith("/api/cash/days/{date}/z", { params: { path: { date: "2026-11-10" } } })

    const list = { from: "2026-11-01", to: "2026-11-30", items: [], gaps: [213] }
    api.GET.mockResolvedValueOnce({ data: list })
    await expect(fetchZReports({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual(list)
    expect(api.GET).toHaveBeenCalledWith("/api/cash/z", { params: { query: { from: "2026-11-01", to: "2026-11-30" } } })

    api.GET.mockResolvedValueOnce({ data: z })
    await expect(fetchZReport(215)).resolves.toEqual(z)
    expect(api.GET).toHaveBeenCalledWith("/api/cash/z/{number}", { params: { path: { number: 215 } } })
  })

  it("passes API errors through and rejects an empty response", async () => {
    api.POST.mockRejectedValueOnce(new ApiError(409, "Conflict", "La caja sigue abierta: ciérrala antes de validar el turno."))
    await expect(validateRegister("r-1")).rejects.toMatchObject({ status: 409 })
    api.GET.mockResolvedValueOnce({ data: undefined })
    await expect(fetchCashDay("2026-11-10")).rejects.toBeInstanceOf(ApiError)
  })
})
