import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T9 (S3, S4) — payments through the typed API client instead of Supabase:
 * request paths and bodies (camelCase; the server maps them onto the RPC
 * arguments) and the API error body -> `PaymentServiceError.kind` mapping the
 * cashier and admin toasts branch on.
 */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  PaymentServiceError,
  closeRegisterRpc,
  createPaymentMethod,
  getPaymentsByOrderIds,
  getRegisterSummary,
  listPaymentMethods,
  listRegisterPayments,
  payOrder,
  paymentErrorOf,
  reorderPaymentMethods,
  splitOrder,
  undoSplit,
  updatePaymentMethod,
} from "./payments"

const method = { id: "m-1", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 0 }

const summary = {
  registersCount: 1,
  initialCash: 50000,
  paymentsCount: 1,
  totalBilled: 10000,
  totalTips: 0,
  totalSales: 10000,
  totalChange: 0,
  methods: [],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 60000,
  tipsPayout: 0,
  expectedCashAfterTips: 60000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}

const apiError = (status: number, message: string, code?: string) =>
  new ApiError(status, "Error", message, code ? { statusCode: status, message, code } : { statusCode: status, message })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
})

describe("payment methods", () => {
  it("lists GET /api/payments/methods as the domain option", async () => {
    api.GET.mockResolvedValue({ data: [method] })
    await expect(listPaymentMethods()).resolves.toEqual([method])
    expect(api.GET).toHaveBeenCalledWith("/api/payments/methods")
  })

  it("creates with only {name, kind}: the server derives code and sortOrder", async () => {
    api.POST.mockResolvedValue({ data: method })
    await createPaymentMethod({ name: "  Efectivo ", kind: "cash" })
    expect(api.POST).toHaveBeenCalledWith("/api/payments/methods", { body: { name: "Efectivo", kind: "cash" } })
    expect(api.GET).not.toHaveBeenCalled()
  })

  it("patches name/isActive on /api/payments/methods/{id}", async () => {
    api.PATCH.mockResolvedValue({ data: method })
    await updatePaymentMethod("m-1", { isActive: false })
    expect(api.PATCH).toHaveBeenCalledWith("/api/payments/methods/{id}", {
      params: { path: { id: "m-1" } },
      body: { isActive: false },
    })
  })

  it("reorders with the whole ordered id list in one PUT", async () => {
    api.PUT.mockResolvedValue({ data: [] })
    await reorderPaymentMethods(["m-2", "m-1", "m-3"])
    expect(api.PUT).toHaveBeenCalledTimes(1)
    expect(api.PUT).toHaveBeenCalledWith("/api/payments/methods/order", { body: { ids: ["m-2", "m-1", "m-3"] } })
  })
})

describe("payOrder", () => {
  it("POSTs camelCase tenders, omitting cashReceived on electronic lines", async () => {
    const result = {
      paymentId: "p-1",
      status: "paid",
      alreadyPaid: false,
      amountDue: 30000,
      tipAmount: 1000,
      totalCharged: 31000,
      changeGiven: 9000,
      drawerWarning: false,
      drawerCashBefore: 100000,
      tenders: [],
    }
    api.POST.mockResolvedValue({ data: result })

    await expect(
      payOrder({
        orderId: "o-1",
        cashRegisterId: "r-1",
        tip: 1000,
        tenders: [
          { payment_method_id: "m-cash", amount: 11000, cash_received: 20000 },
          { payment_method_id: "m-nequi", amount: 20000, cash_received: null },
        ],
        idempotencyKey: "k-1",
      }),
    ).resolves.toEqual(result)

    expect(api.POST).toHaveBeenCalledWith("/api/payments", {
      body: {
        orderId: "o-1",
        cashRegisterId: "r-1",
        tipAmount: 1000,
        tenders: [
          { paymentMethodId: "m-cash", amount: 11000, cashReceived: 20000 },
          { paymentMethodId: "m-nequi", amount: 20000 },
        ],
        idempotencyKey: "k-1",
      },
    })
  })

  it("T18: sends a non-cash reference with tabs/newlines as spaces, trimmed; never on cash, never empty", async () => {
    api.POST.mockResolvedValue({ data: { status: "paid", alreadyPaid: false, drawerWarning: false, tenders: [] } })
    await payOrder({
      orderId: "o-1",
      cashRegisterId: "r-1",
      tip: 0,
      tenders: [
        { payment_method_id: "m-card", amount: 5000, cash_received: null, reference: "  Aprob\t4821\r\n77 " },
        { payment_method_id: "m-cash", amount: 3000, cash_received: 5000, reference: "123" },
        { payment_method_id: "m-nequi", amount: 2000, cash_received: null, reference: " \t\n " },
        { payment_method_id: "m-transfer", amount: 1000, cash_received: null, reference: null },
      ],
      idempotencyKey: "k-1",
    })
    expect(api.POST.mock.calls[0][1].body.tenders).toEqual([
      { paymentMethodId: "m-card", amount: 5000, reference: "Aprob 4821 77" },
      { paymentMethodId: "m-cash", amount: 3000, cashReceived: 5000 },
      { paymentMethodId: "m-nequi", amount: 2000 },
      { paymentMethodId: "m-transfer", amount: 1000 },
    ])
  })

  it("passes alreadyPaid and drawerWarning through", async () => {
    api.POST.mockResolvedValue({ data: { status: "already_paid", alreadyPaid: true, drawerWarning: true, tenders: [] } })
    const result = await payOrder({ orderId: "o", cashRegisterId: "r", tip: 0, tenders: [], idempotencyKey: "k" })
    expect(result.alreadyPaid).toBe(true)
    expect(result.drawerWarning).toBe(true)
  })
})

describe("split / undo split", () => {
  it("POSTs /api/orders/{id}/split with the items", async () => {
    api.POST.mockResolvedValue({ data: { childOrderId: "c-1" } })
    await splitOrder({ parentOrderId: "o-1", items: [{ orderItemId: "i-1", quantity: 2 }] })
    expect(api.POST).toHaveBeenCalledWith("/api/orders/{id}/split", {
      params: { path: { id: "o-1" } },
      body: { items: [{ orderItemId: "i-1", quantity: 2 }] },
    })
  })

  it("POSTs /api/orders/{id}/undo-split with the child id", async () => {
    api.POST.mockResolvedValue({ data: { parent: {} } })
    await undoSplit({ childOrderId: "c-1" })
    expect(api.POST).toHaveBeenCalledWith("/api/orders/{id}/undo-split", { params: { path: { id: "c-1" } } })
  })
})

describe("payments ledger reads", () => {
  it("lists by register ids, comma-separated; [] without a request for no ids", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listRegisterPayments(["r-1", "r-2"])
    expect(api.GET).toHaveBeenCalledWith("/api/payments", { params: { query: { cashRegisterIds: "r-1,r-2" } } })
    api.GET.mockClear()
    await expect(listRegisterPayments([])).resolves.toEqual([])
    expect(api.GET).not.toHaveBeenCalled()
  })

  it("lists by order ids", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await getPaymentsByOrderIds(["o-1"])
    expect(api.GET).toHaveBeenCalledWith("/api/payments", { params: { query: { orderIds: "o-1" } } })
    await expect(getPaymentsByOrderIds([])).resolves.toEqual([])
  })
})

describe("register summary and close", () => {
  it("reads GET /api/registers/summary?ids=", async () => {
    api.GET.mockResolvedValue({ data: summary })
    await expect(getRegisterSummary(["r-1", "r-2"])).resolves.toEqual(summary)
    expect(api.GET).toHaveBeenCalledWith("/api/registers/summary", { params: { query: { ids: "r-1,r-2" } } })
  })

  it("refuses an empty id list without a request", async () => {
    await expect(getRegisterSummary([])).rejects.toMatchObject({ kind: "invalid-input" })
    expect(api.GET).not.toHaveBeenCalled()
  })

  it("closes with POST /api/registers/{id}/close and keeps the server closingTimestamp", async () => {
    api.POST.mockResolvedValue({
      data: {
        status: "closed",
        cashRegisterId: "r-1",
        finalCash: 60000,
        closingTimestamp: "2026-11-04T23:10:00.000Z",
        summary,
      },
    })
    const result = await closeRegisterRpc("r-1")
    expect(api.POST).toHaveBeenCalledWith("/api/registers/{id}/close", { params: { path: { id: "r-1" } } })
    expect(result).toEqual({
      status: "closed",
      cashRegisterId: "r-1",
      finalCash: 60000,
      closingTimestamp: new Date("2026-11-04T23:10:00.000Z"),
      summary,
    })
  })
})

describe("error kind mapping", () => {
  it.each([
    ["42501", 403, "not-authorized"],
    ["P0002", 404, "not-found"],
    ["P0001", 422, "rejected"],
    ["23505", 409, "rejected"],
    ["22023", 422, "invalid-input"],
    ["23514", 422, "invalid-input"],
  ] as const)("code %s -> %s", async (code, status, kind) => {
    api.POST.mockRejectedValue(apiError(status, "server says", code))
    const error = await payOrder({ orderId: "o", cashRegisterId: "r", tip: 0, tenders: [], idempotencyKey: "k" }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(PaymentServiceError)
    expect(error).toMatchObject({ kind, message: "server says" })
  })

  it("a 422 without code (zod validation) is invalid-input", () => {
    expect(paymentErrorOf(apiError(422, "tenders: Too small"))).toMatchObject({
      kind: "invalid-input",
      message: "tenders: Too small",
    })
  })

  it("a 403 without code (role guard) is not-authorized", () => {
    expect(paymentErrorOf(apiError(403, "Forbidden"))).toMatchObject({ kind: "not-authorized" })
  })

  it("a 409 without code is rejected with the server message", () => {
    expect(paymentErrorOf(apiError(409, "Register is closed"))).toMatchObject({
      kind: "rejected",
      message: "Register is closed",
    })
  })

  it("anything else is unknown, keeping the cause", () => {
    const cause = apiError(500, "Internal Server Error")
    const error = paymentErrorOf(cause)
    expect(error).toMatchObject({ kind: "unknown" })
    expect(error.cause).toBe(cause)
    expect(paymentErrorOf(new TypeError("Failed to fetch"))).toMatchObject({ kind: "unknown" })
  })

  it("an unknown code on a 422 still follows the code (unknown)", () => {
    expect(paymentErrorOf(apiError(422, "x", "99999"))).toMatchObject({ kind: "unknown" })
  })
})
