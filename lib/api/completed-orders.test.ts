import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T9 (S3, S4) — the day's paid orders in ONE request (`GET /orders/completed`)
 * instead of the per-order `payment_transactions` reads: the method label
 * comes from the embedded payment, or from the legacy rows when the order
 * predates `pay_order`.
 */

const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { getOrdersByDate } from "./completed-orders"

const tender = (methodCode: string, lineNo: number) => ({
  id: `t-${lineNo}`,
  paymentId: "p-1",
  lineNo,
  paymentMethodId: `m-${methodCode}`,
  methodCode,
  methodKind: methodCode === "cash" ? "cash" : "electronic",
  amount: 1000,
  cashReceived: methodCode === "cash" ? 1000 : null,
})

const completed = (overrides: Record<string, unknown> = {}) => ({
  id: "o-1",
  tableId: "t-1",
  waiterId: "w-1",
  status: "paid",
  orderType: "dine_in",
  subtotal: 10000,
  tax: 800,
  taxPercentage: 8,
  tip: 1000,
  tipPercentage: 10,
  total: 11800,
  totalDiscounts: 0,
  isPartialOrder: false,
  parentOrderId: null,
  createdAt: "2026-11-04T15:00:00.000Z",
  updatedAt: null,
  items: [],
  payment: null,
  legacyTransactions: [],
  ...overrides,
})

const payment = (tenders: ReturnType<typeof tender>[]) => ({
  id: "p-1",
  orderId: "o-1",
  cashRegisterId: "r-1",
  cashierProfileId: null,
  amountDue: 11800,
  tipAmount: 0,
  totalCharged: 11800,
  changeGiven: 0,
  idempotencyKey: "k-1",
  createdAt: "2026-11-04T15:05:00.000Z",
  tenders,
})

const legacy = (method: string) => ({
  id: `l-${method}`,
  orderId: "o-1",
  tableId: null,
  waiterId: null,
  amount: 1,
  tipAmount: null,
  totalDiscounts: null,
  method,
  cashReceived: null,
  cashChange: null,
  timestamp: "2026-11-04T15:05:00.000Z",
  cashRegisterId: "r-1",
})

beforeEach(() => api.GET.mockReset())

describe("getOrdersByDate", () => {
  it("sends the LOCAL calendar day as ?date=", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await getOrdersByDate(new Date(2026, 10, 4, 23, 45))
    expect(api.GET).toHaveBeenCalledTimes(1)
    expect(api.GET).toHaveBeenCalledWith("/api/orders/completed", { params: { query: { date: "2026-11-04" } } })
  })

  it("maps through toOrder and attaches the ledger payment and its method label", async () => {
    const paid = payment([tender("nequi", 1)])
    api.GET.mockResolvedValue({ data: [completed({ payment: paid })] })
    const [order] = await getOrdersByDate(new Date(2026, 10, 4))
    expect(order).toMatchObject({
      id: "o-1",
      tableId: "t-1",
      waiter: "w-1",
      status: "paid",
      bill: { total: 11800 },
      createdAt: new Date("2026-11-04T15:00:00.000Z"),
      paymentMethod: "nequi",
      ledgerPayment: paid,
    })
  })

  it("falls back to the legacy rows: one method, or 'multiple'", async () => {
    api.GET.mockResolvedValue({
      data: [
        completed({ id: "o-1", legacyTransactions: [legacy("cash"), legacy("cash")] }),
        completed({ id: "o-2", legacyTransactions: [legacy("cash"), legacy("nequi")] }),
        completed({ id: "o-3" }),
      ],
    })
    const orders = await getOrdersByDate(new Date(2026, 10, 4))
    expect(orders.map((o) => o.paymentMethod)).toEqual(["cash", "multiple", undefined])
    expect(orders.every((o) => o.ledgerPayment === undefined)).toBe(true)
  })
})
