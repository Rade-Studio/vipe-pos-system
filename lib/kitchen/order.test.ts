/**
 * T7, T8b — the kitchen board's projection of an `Order`: the hydration read
 * and the realtime batch read map the API order with the shared `toOrder`
 * (lib/api/orders.ts), then keep only what is left to cook.
 *
 * Delivery invariant (odd/tasks/domicilios.md S13/S14): a delivery order keeps
 * `orderType: 'delivery'` so the DOMICILIO banner and heading never fall back
 * to "Mesa ?", and an order with no kitchen items never reaches the queue.
 */
import { describe, expect, it } from "vitest"
import type { Order, OrderItem } from "@/types"
import { isServedItem, kitchenOrderOf, kitchenOrdersOf, pendingItems } from "./order"

function item(id: string, status: "kitchen" | "served", addedAt: string): OrderItem {
  return {
    id,
    name: `Item ${id}`,
    price: 100,
    quantity: 1,
    categoryId: "",
    image: "",
    status,
    addedAt: new Date(addedAt),
  }
}

function order(overrides: Partial<Order> = {}, items: OrderItem[] = []): Order {
  return {
    id: "o-1",
    tableId: "t-1",
    orderType: "dine_in",
    waiter: "w-1",
    status: "kitchen",
    bill: { subtotal: 100, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 100, totalDiscounts: 0 },
    createdAt: new Date("2026-10-07T11:00:00.000Z"),
    isPartialOrder: false,
    items,
    ...overrides,
  }
}

describe("kitchenOrderOf", () => {
  it("keeps served items on the ticket, marked served, every item oldest first (T23)", () => {
    const mapped = kitchenOrderOf(
      order({}, [
        item("i-2", "kitchen", "2026-10-07T11:02:00.000Z"),
        item("i-3", "served", "2026-10-07T11:00:30.000Z"),
        item("i-1", "kitchen", "2026-10-07T11:01:00.000Z"),
      ]),
    )

    expect(mapped?.items.map((i) => i.id)).toEqual(["i-3", "i-1", "i-2"])
    expect(mapped?.items.map(isServedItem)).toEqual([true, false, false])
    expect(mapped?.items[1].addedAt).toEqual(new Date("2026-10-07T11:01:00.000Z"))
  })

  it("counts pending work from the kitchen items only (T23)", () => {
    const mapped = kitchenOrderOf(
      order({}, [item("i-1", "served", "2026-10-07T11:01:00.000Z"), item("i-2", "kitchen", "2026-10-07T11:02:00.000Z")]),
    )

    expect(pendingItems(mapped!).map((i) => i.id)).toEqual(["i-2"])
  })

  it("returns null when no item is in the kitchen", () => {
    expect(kitchenOrderOf(order({}, [item("i-1", "served", "2026-10-07T11:01:00.000Z")]))).toBeNull()
    expect(kitchenOrderOf(order({}, []))).toBeNull()
  })

  it("keeps a delivery order a delivery (DOMICILIO banner, never 'Mesa ?')", () => {
    const mapped = kitchenOrderOf(
      order({ orderType: "delivery", tableId: "" }, [item("i-1", "kitchen", "2026-10-07T11:01:00.000Z")]),
    )

    expect(mapped?.orderType).toBe("delivery")
    expect(mapped?.tableId).toBe("")
  })

  it("keeps the bill, waiter and timestamps of the order", () => {
    const source = order({}, [item("i-1", "kitchen", "2026-10-07T11:01:00.000Z")])
    const mapped = kitchenOrderOf(source)

    expect(mapped).toEqual({ ...source, items: source.items })
    expect(mapped).not.toBe(source)
  })
})

describe("kitchenOrdersOf", () => {
  it("keeps the orders with something in the kitchen", () => {
    const mapped = kitchenOrdersOf([
      order({}, [item("i-1", "kitchen", "2026-10-07T11:01:00.000Z")]),
      order({ id: "o-2" }, [item("i-2", "served", "2026-10-07T11:02:00.000Z")]),
    ])

    expect(mapped.map((o) => o.id)).toEqual(["o-1"])
  })
})
