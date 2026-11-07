/** T24 — the "Pagadas" tab rows, derived from GET /registers/:id/paid-orders. */
import { describe, expect, it } from "vitest"
import type { RegisterPaidOrder } from "@/lib/api/registers"
import { paidOrderRows } from "./paid-orders"

const paid = (over: Partial<RegisterPaidOrder> = {}): RegisterPaidOrder => ({
  orderId: "o-1",
  orderNumber: 128,
  orderType: "dine_in",
  tableNumber: 12,
  zoneName: "Terraza",
  waiter: { id: "w-1", name: "Carlos Pérez" },
  paymentId: "p-1",
  amountDue: 173_800,
  tip: 17_380,
  total: 191_180,
  paidAt: new Date(2026, 10, 6, 14, 5),
  tenders: [
    { methodCode: "card", methodName: "Tarjeta", methodKind: "electronic", amount: 100_000, reference: "4821" },
    { methodCode: "cash", methodName: "Efectivo", methodKind: "cash", amount: 91_180, reference: null },
  ],
  ...over,
})

describe("paidOrderRows", () => {
  it("lists newest first with folio, place, waiter, total, tip, methods and time", () => {
    const rows = paidOrderRows([
      paid({ paymentId: "p-old", paidAt: new Date(2026, 10, 6, 12, 0) }),
      paid(),
      paid({
        paymentId: "p-d",
        orderNumber: 130,
        orderType: "delivery",
        tableNumber: null,
        zoneName: null,
        waiter: null,
        tip: 0,
        paidAt: new Date(2026, 10, 6, 13, 0),
        tenders: [{ methodCode: "nequi", methodName: "Nequi", methodKind: "electronic", amount: 191_180, reference: null }],
      }),
    ])
    expect(rows.map((r) => r.key)).toEqual(["p-1", "p-d", "p-old"])
    expect(rows[0]).toEqual({
      key: "p-1",
      // F3: the order the payment belongs to (its void reopens it).
      orderId: "o-1",
      folio: "#128",
      place: "Mesa 12 · Terraza",
      waiterName: "Carlos Pérez",
      total: 191_180,
      tip: 17_380,
      methods: "Tarjeta · Ref. 4821 + Efectivo",
      time: "14:05",
    })
    expect(rows[1]).toMatchObject({ folio: "#130", place: "Domicilio", waiterName: null, tip: 0, methods: "Nequi" })
  })
})
