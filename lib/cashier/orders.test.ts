/**
 * T8 (cargas-por-perfil S1/S2) — the cashier screen derives every list it
 * renders from ONE `getByStatus` result. These are the pure rules behind that:
 *
 *  - the statuses the single call asks for,
 *  - how that one list splits into the kitchen / delivered / partial / by-table
 *    views,
 *  - the status-move semantics a realtime UPDATE must produce (the order
 *    moves between views, and a paid order leaves every view),
 *  - the bill source the payment dialog receives from the view (so it stops
 *    refetching an order the cashier screen already holds).
 *
 * Delivery invariants (odd/tasks/domicilios.md S13/S14): a delivery order keeps
 * `orderType` and never lands in the by-table view — DeliveryPaymentsPanel stays
 * the place where the cashier charges deliveries.
 */
import { describe, expect, it } from "vitest"
import {
  CASHIER_ORDER_STATUSES,
  applyCashierOrderEvent,
  billSourceFromOrder,
  cashierOrdersQueryKey,
  deriveCashierViews,
  hasBillableItems,
  isCashierStatus,
  toCashierOrder,
} from "./orders"
import type { CashierOrderRow } from "./orders"
import type { Order } from "@/types"

const items = [
  { id: "oi-1", name: "Bandeja", price: 20_000, quantity: 2, comments: null },
]

const row = (over: Partial<CashierOrderRow> = {}): CashierOrderRow => ({
  id: "o-1",
  table_id: "t-1",
  order_type: "dine_in",
  status: "active",
  subtotal: 40_000,
  tax: 7_600,
  tax_percentage: 19,
  tip: 0,
  tip_percentage: 0,
  total: 47_600,
  total_discounts: 0,
  waiter_id: "w-1",
  created_at: "2026-10-07T12:00:00.000Z",
  is_partial_order: false,
  parent_order_id: null,
  order_items: items,
  ...over,
})

/** A loaded order, with app-level overrides applied on top of a wire row. */
const order = (over: Partial<Order> = {}): Order => ({ ...toCashierOrder(row()), ...over })

describe("cashierOrderStatuses (S1: one getByStatus call)", () => {
  it("asks for exactly the three statuses the cashier lists, in one call", () => {
    expect(CASHIER_ORDER_STATUSES).toEqual(["active", "kitchen", "delivered"])
  })

  it("recognizes only those statuses as cashier-visible", () => {
    expect(isCashierStatus("active")).toBe(true)
    expect(isCashierStatus("kitchen")).toBe(true)
    expect(isCashierStatus("delivered")).toBe(true)
    expect(isCashierStatus("paid")).toBe(false)
    expect(isCashierStatus("cancelled")).toBe(false)
    expect(isCashierStatus(undefined)).toBe(false)
  })

  it("owns one stable query key for the whole screen", () => {
    expect(cashierOrdersQueryKey).toEqual(["orders", "cashier"])
  })
})

describe("toCashierOrder (one converter for the load AND the realtime INSERT)", () => {
  it("maps the wire row into the app Order the views render", () => {
    const mapped = toCashierOrder(row())
    expect(mapped.id).toBe("o-1")
    expect(mapped.tableId).toBe("t-1")
    expect(mapped.status).toBe("active")
    expect(mapped.waiter).toBe("w-1")
    expect(mapped.bill).toEqual({
      subtotal: 40_000,
      tax: 7_600,
      taxPercentage: 19,
      tip: 0,
      tipPercentage: 0,
      total: 47_600,
      totalDiscounts: 0,
    })
    expect(mapped.items).toHaveLength(1)
    expect(mapped.items[0]).toMatchObject({ id: "oi-1", name: "Bandeja", price: 20_000, quantity: 2 })
    expect(mapped.createdAt).toBeInstanceOf(Date)
  })

  it("keeps the delivery flag (S14) and the partial flags", () => {
    const delivery = toCashierOrder(row({ table_id: null, order_type: "delivery" }))
    expect(delivery.orderType).toBe("delivery")
    expect(delivery.tableId).toBe("")

    const partial = toCashierOrder(row({ is_partial_order: true, parent_order_id: "o-0" }))
    expect(partial.isPartialOrder).toBe(true)
    expect(partial.parentOrderId).toBe("o-0")
  })
})

describe("deriveCashierViews (S1: one list → every view the screen renders)", () => {
  it("derives kitchen, delivered, partial and by-table from a single list", () => {
    const views = deriveCashierViews([
      order({ id: "o-active" }),
      order({ id: "o-kitchen", status: "kitchen" }),
      order({ id: "o-delivered", status: "delivered" }),
      order({ id: "o-partial", isPartialOrder: true }),
    ])

    expect(views.all).toHaveLength(4)
    expect(views.active.map((o) => o.id)).toEqual(["o-active", "o-partial"])
    expect(views.kitchen.map((o) => o.id)).toEqual(["o-kitchen"])
    expect(views.delivered.map((o) => o.id)).toEqual(["o-delivered"])
    expect(views.partial.map((o) => o.id)).toEqual(["o-partial"])
    expect(Object.keys(views.byTable).sort()).toEqual(["t-1"])
    expect(views.byTable["t-1"].map((o) => o.id).sort()).toEqual([
      "o-active",
      "o-delivered",
      "o-kitchen",
    ])
  })

  it("keeps a delivery order out of the by-table view (S14: DeliveryPaymentsPanel charges it)", () => {
    const views = deriveCashierViews([
      order({ id: "o-dine" }),
      order({ id: "o-delivery", orderType: "delivery", tableId: "" }),
    ])
    expect(views.byTable["t-1"].map((o) => o.id)).toEqual(["o-dine"])
    expect(Object.values(views.byTable).flat().some((o) => o.id === "o-delivery")).toBe(false)
    // …but it stays in the single list, so nothing is lost from the screen.
    expect(views.all.map((o) => o.id)).toEqual(["o-dine", "o-delivery"])
  })

  it("drops a status the cashier does not list (paid / cancelled) from every view", () => {
    const views = deriveCashierViews([
      order({ id: "o-open" }),
      order({ id: "o-paid", status: "paid" as never }),
    ])
    expect(views.all.map((o) => o.id)).toEqual(["o-open", "o-paid"])
    expect(Object.values(views.byTable).flat().map((o) => o.id)).toEqual(["o-open"])
    expect(views.active.map((o) => o.id)).toEqual(["o-open"])
    expect(views.kitchen).toEqual([])
    expect(views.delivered).toEqual([])
    expect(views.partial).toEqual([])
  })
})

describe("status-move semantics (a realtime UPDATE moves the order between views)", () => {
  const list = [order({ id: "o-1" })]

  it("active → kitchen moves the row from the active bucket to the kitchen bucket", () => {
    const next = applyCashierOrderEvent(list, {
      eventType: "UPDATE",
      new: { id: "o-1", status: "kitchen" } as never,
    })
    const views = deriveCashierViews(next)
    expect(views.active).toEqual([])
    expect(views.kitchen.map((o) => o.id)).toEqual(["o-1"])
    expect(Object.values(views.byTable).flat().map((o) => o.id)).toEqual(["o-1"])
  })

  it("→ paid removes the row from every rendered view (no stale card)", () => {
    const next = applyCashierOrderEvent(list, {
      eventType: "UPDATE",
      new: { id: "o-1", status: "paid" } as never,
    })
    const views = deriveCashierViews(next)
    expect(views.active).toEqual([])
    expect(views.kitchen).toEqual([])
    expect(views.delivered).toEqual([])
    expect(views.partial).toEqual([])
    expect(views.byTable).toEqual({})
  })

  it("keeps items and bill by reference when the UPDATE carries neither", () => {
    const before = list[0]
    const next = applyCashierOrderEvent(list, {
      eventType: "UPDATE",
      new: { id: "o-1", status: "delivered", table_id: "t-1" } as never,
    })
    expect(next[0].items).toBe(before.items)
    expect(next[0].bill).toBe(before.bill)
    expect(next[0].status).toBe("delivered")
  })

  it("carries the items and the bill the wire row does send", () => {
    const next = applyCashierOrderEvent(list, {
      eventType: "UPDATE",
      new: {
        id: "o-1",
        status: "kitchen",
        subtotal: 50_000,
        tax: 9_500,
        tax_percentage: 19,
        tip: 0,
        tip_percentage: 0,
        total: 59_500,
        total_discounts: 0,
        order_items: [{ id: "oi-9", name: "Jugo", price: 5_000, quantity: 1, comments: null }],
      } as never,
    })
    expect(next[0].items.map((i) => i.name)).toEqual(["Jugo"])
    expect(next[0].bill.total).toBe(59_500)
  })

  it("INSERT with items paints the new card; INSERT without items changes nothing", () => {
    const withItems = applyCashierOrderEvent(list, { eventType: "INSERT", new: row({ id: "o-2" }) })
    expect(withItems.map((o) => o.id)).toEqual(["o-1", "o-2"])
    expect(Object.keys(deriveCashierViews(withItems).byTable)).toEqual(["t-1"])

    const before = list
    expect(applyCashierOrderEvent(before, { eventType: "INSERT", new: { id: "o-3", status: "active" } as never })).toBe(
      before,
    )
  })

  it("INSERT maps order_type so a realtime domicilio is never \"Mesa ?\" (S14)", () => {
    const next = applyCashierOrderEvent(list, {
      eventType: "INSERT",
      new: row({ id: "d-1", table_id: null, order_type: "delivery" }),
    })
    expect(next[1].orderType).toBe("delivery")
    expect(deriveCashierViews(next).byTable).toEqual(deriveCashierViews(list).byTable)
  })

  it("DELETE removes the row and a no-op event returns the identical list", () => {
    expect(applyCashierOrderEvent(list, { eventType: "DELETE", old: { id: "o-1" } as never })).toEqual([])
    expect(applyCashierOrderEvent(list, { eventType: "UPDATE", new: { id: "missing" } as never })).toBe(list)
    expect(applyCashierOrderEvent(list, { eventType: "WHATEVER", new: row({ id: "o-9" }) })).toBe(list)
  })
})

describe("billSourceFromOrder (S1: the dialog reuses the loaded order)", () => {
  it("maps the view order into the shape the payment dialog bills", () => {
    const source = billSourceFromOrder(order({ id: "o-7" }))
    expect(source.order_items).toHaveLength(1)
    expect(source.order_items[0]).toMatchObject({ id: "oi-1", name: "Bandeja", price: 20_000, quantity: 2 })
    expect(source.tax_percentage).toBe(19)
    expect(source.tip_percentage).toBe(0)
    expect(source.subtotal).toBe(40_000)
    expect(source.tax).toBe(7_600)
    expect(source.tip).toBe(0)
    expect(source.table_id).toBe("t-1")
    expect(source.waiter_id).toBe("w-1")
  })

  it("passes table_id as null for a delivery order (no table to print)", () => {
    expect(billSourceFromOrder(order({ orderType: "delivery", tableId: "" })).table_id).toBeNull()
  })

  it("only accepts a source that actually carries items", () => {
    expect(hasBillableItems(billSourceFromOrder(order()))).toBe(true)
    expect(hasBillableItems({ ...billSourceFromOrder(order()), order_items: [] })).toBe(false)
    expect(hasBillableItems(null)).toBe(false)
    expect(hasBillableItems(undefined)).toBe(false)
  })
})