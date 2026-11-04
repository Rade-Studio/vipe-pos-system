import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T9 (S3, S4) — cash registers through the API: the server stamps every
 * timestamp, owns the restaurant-day bounds (`?date=` is the local calendar
 * day the user picked) and answers 409 `A register is already open`.
 */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  addCashTransaction,
  getAllRegisters,
  getCashTransactionsByRegisterId,
  getCashTransactionsByRegisters,
  getCurrentRegister,
  getOpenRegister,
  getRegistersByDate,
  getTransactionsByRegisterId,
  getTransactionsByRegisters,
  openRegister,
} from "./registers"
import { PaymentServiceError } from "./payments"

const registerDto = (overrides: Record<string, unknown> = {}) => ({
  id: "r-1",
  openingTimestamp: "2026-11-04T13:00:00.000Z",
  closingTimestamp: null,
  initialCash: 50000,
  finalCash: null,
  status: "open",
  createdAt: "2026-11-04T13:00:00.000Z",
  updatedAt: null,
  ...overrides,
})

const legacyDto = {
  id: "t-1",
  orderId: "o-1",
  tableId: null,
  waiterId: "w-1",
  amount: 10000,
  tipAmount: null,
  totalDiscounts: null,
  method: "cash",
  cashReceived: 20000,
  cashChange: 10000,
  timestamp: "2026-11-04T14:00:00.000Z",
  cashRegisterId: "r-1",
}

const cashDto = (id: string, timestamp: string, cashRegisterId = "r-1") => ({
  id,
  cashRegisterId,
  amount: 5000,
  type: "deposit",
  description: "",
  timestamp,
})

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
})

describe("openRegister", () => {
  it("POSTs only {initialCash}: the server stamps the opening", async () => {
    api.POST.mockResolvedValue({ data: registerDto() })
    const register = await openRegister(50000)
    expect(api.POST).toHaveBeenCalledWith("/api/registers/open", { body: { initialCash: 50000 } })
    expect(register).toMatchObject({
      id: "r-1",
      openingTimestamp: new Date("2026-11-04T13:00:00.000Z"),
      status: "open",
      transactions: [],
      cashTransactions: [],
    })
  })

  it("surfaces the API 409 message as a rejected PaymentServiceError", async () => {
    api.POST.mockRejectedValue(
      new ApiError(409, "Conflict", "A register is already open", { statusCode: 409, message: "A register is already open" }),
    )
    const error = await openRegister(1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaymentServiceError)
    expect(error).toMatchObject({ kind: "rejected", message: "A register is already open" })
  })
})

describe("current register", () => {
  it("answers null when the API sends null", async () => {
    api.GET.mockResolvedValue({ data: null })
    await expect(getCurrentRegister()).resolves.toBeNull()
    await expect(getOpenRegister()).resolves.toBeNull()
  })

  it("getCurrentRegister embeds both histories, mapped to the domain", async () => {
    api.GET.mockResolvedValue({
      data: registerDto({ transactions: [legacyDto], cashTransactions: [cashDto("c-1", "2026-11-04T15:00:00.000Z")] }),
    })
    const register = await getCurrentRegister()
    expect(api.GET).toHaveBeenCalledWith("/api/registers/current", {
      params: { query: { include: "transactions,cashTransactions" } },
    })
    expect(register?.transactions).toEqual([
      {
        id: "t-1",
        orderId: "o-1",
        tableId: "",
        waiterId: "w-1",
        amount: 10000,
        tipAmount: undefined,
        method: "cash",
        cashReceived: 20000,
        cashChange: 10000,
        timestamp: new Date("2026-11-04T14:00:00.000Z"),
        cash_register_id: "r-1",
      },
    ])
    expect(register?.cashTransactions).toEqual([
      {
        id: "c-1",
        amount: 5000,
        type: "deposit",
        description: "",
        timestamp: new Date("2026-11-04T15:00:00.000Z"),
        cash_register_id: "r-1",
      },
    ])
  })

  it("getOpenRegister is one request without embeds", async () => {
    api.GET.mockResolvedValue({ data: registerDto() })
    await getOpenRegister()
    expect(api.GET).toHaveBeenCalledTimes(1)
    expect(api.GET).toHaveBeenCalledWith("/api/registers/current")
  })
})

describe("register lists", () => {
  it("getRegistersByDate sends the LOCAL calendar day, no bounds", async () => {
    api.GET.mockResolvedValue({ data: [registerDto({ status: "closed", finalCash: 0 })] })
    const [register] = await getRegistersByDate(new Date(2026, 10, 4, 23, 30))
    expect(api.GET).toHaveBeenCalledWith("/api/registers", { params: { query: { date: "2026-11-04" } } })
    expect(register.finalCash).toBe(0)
  })

  it("getAllRegisters embeds both histories", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await getAllRegisters()
    expect(api.GET).toHaveBeenCalledWith("/api/registers", {
      params: { query: { include: "transactions,cashTransactions" } },
    })
  })
})

describe("cash movements", () => {
  it("addCashTransaction POSTs {amount, type, description} with no timestamp", async () => {
    api.POST.mockResolvedValue({ data: cashDto("c-1", "2026-11-04T15:00:00.000Z") })
    await addCashTransaction("r-1", 5000, "deposit", "Base")
    expect(api.POST).toHaveBeenCalledWith("/api/registers/{id}/cash-transactions", {
      params: { path: { id: "r-1" } },
      body: { amount: 5000, type: "deposit", description: "Base" },
    })
  })

  it("surfaces 409 Register is closed as rejected", async () => {
    api.POST.mockRejectedValue(new ApiError(409, "Conflict", "Register is closed", { statusCode: 409 }))
    await expect(addCashTransaction("r-1", 1, "withdrawal", "")).rejects.toMatchObject({
      kind: "rejected",
      message: "Register is closed",
    })
  })

  it("reads one register's cash movements", async () => {
    api.GET.mockResolvedValue({ data: [cashDto("c-1", "2026-11-04T15:00:00.000Z")] })
    const rows = await getCashTransactionsByRegisterId("r-1")
    expect(api.GET).toHaveBeenCalledWith("/api/registers/{id}/cash-transactions", { params: { path: { id: "r-1" } } })
    expect(rows.map((r) => r.id)).toEqual(["c-1"])
  })

  it("merges several registers newest first; [] without a request for no ids", async () => {
    api.GET.mockImplementation(async (_path: string, init: { params: { path: { id: string } } }) => ({
      data:
        init.params.path.id === "r-1"
          ? [cashDto("c-1", "2026-11-04T15:00:00.000Z")]
          : [cashDto("c-2", "2026-11-04T16:00:00.000Z", "r-2")],
    }))
    const rows = await getCashTransactionsByRegisters(["r-1", "r-2"])
    expect(rows.map((r) => r.id)).toEqual(["c-2", "c-1"])
    api.GET.mockClear()
    await expect(getCashTransactionsByRegisters([])).resolves.toEqual([])
    expect(api.GET).not.toHaveBeenCalled()
  })
})

describe("legacy payment_transactions", () => {
  it("reads one register's rows through include=transactions", async () => {
    api.GET.mockResolvedValue({ data: registerDto({ transactions: [legacyDto] }) })
    const rows = await getTransactionsByRegisterId("r-1")
    expect(api.GET).toHaveBeenCalledWith("/api/registers/{id}", {
      params: { path: { id: "r-1" }, query: { include: "transactions" } },
    })
    expect(rows.map((r) => r.id)).toEqual(["t-1"])
  })

  it("merges several registers; [] for no ids", async () => {
    api.GET.mockResolvedValue({ data: registerDto({ transactions: [legacyDto] }) })
    await expect(getTransactionsByRegisters(["r-1"])).resolves.toHaveLength(1)
    await expect(getTransactionsByRegisters([])).resolves.toEqual([])
  })
})
