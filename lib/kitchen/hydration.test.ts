/**
 * T7 (S1/S2) — kitchen hydration must replace the queue without blanking it:
 * unchanged orders keep their identity, changed ones are patched in place and
 * the new-item highlights survive a refresh.
 *
 * RED target: `lib/kitchen/hydration.ts` does not exist yet.
 */
import { describe, expect, it } from "vitest"
import type { Order } from "@/types"
import { addNewItems, mergeKitchenOrders, mergeNewItems, removeNewItems } from "./hydration"

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    tableId: `t-${id}`,
    orderType: "dine_in",
    items: [
      {
        id: `${id}-i-1`,
        name: "Bandeja",
        price: 100,
        quantity: 1,
        categoryId: "c-1",
        image: "/placeholder.svg",
        status: "kitchen",
        addedAt: new Date("2026-10-07T12:00:00.000Z"),
      },
    ],
    status: "kitchen",
    bill: {
      subtotal: 100,
      tax: 0,
      taxPercentage: 0,
      tip: 0,
      tipPercentage: 0,
      total: 100,
      totalDiscounts: 0,
    },
    waiter: "w-1",
    createdAt: new Date("2026-10-07T11:00:00.000Z"),
    ...overrides,
  }
}

/** Same content, different object graph: what a refetch hands back. */
function refetched(source: Order): Order {
  return JSON.parse(JSON.stringify(source), (key, value) =>
    key === "createdAt" || key === "addedAt" ? new Date(value) : value,
  ) as Order
}

describe("mergeKitchenOrders", () => {
  it("returns the identical previous array when nothing changed", () => {
    const prev = [order("o-1"), order("o-2")]
    const next = prev.map(refetched)

    expect(mergeKitchenOrders(prev, next)).toBe(prev)
  })

  it("keeps the identity of the orders that did not change", () => {
    const prev = [order("o-1"), order("o-2")]
    const next = [refetched(prev[0]), order("o-2", { status: "delivered" })]

    const merged = mergeKitchenOrders(prev, next)

    expect(merged).not.toBe(prev)
    expect(merged[0]).toBe(prev[0])
    expect(merged[1]).not.toBe(prev[1])
    expect(merged[1].status).toBe("delivered")
  })

  it("drops orders the kitchen no longer serves", () => {
    const prev = [order("o-1"), order("o-2")]
    const next = [refetched(prev[0])]

    const merged = mergeKitchenOrders(prev, next)

    expect(merged.map((o) => o.id)).toEqual(["o-1"])
    expect(merged[0]).toBe(prev[0])
  })

  it("appends an order the kitchen does not know yet", () => {
    const prev = [order("o-1")]
    const next = [refetched(prev[0]), order("o-2")]

    const merged = mergeKitchenOrders(prev, next)

    expect(merged.map((o) => o.id)).toEqual(["o-1", "o-2"])
    expect(merged[0]).toBe(prev[0])
    expect(merged[1]).toBe(next[1])
  })

  it("detects a changed item as a change", () => {
    const prev = [order("o-1")]
    const changed = refetched(prev[0])
    changed.items = changed.items.filter((item) => item.id !== "o-1-i-1")

    const merged = mergeKitchenOrders(prev, [changed])

    expect(merged).not.toBe(prev)
    expect(merged[0]).not.toBe(prev[0])
    expect(merged[0].items).toEqual([])
  })

  it("detects a changed bill total, item status and waiter as changes", () => {
    const prev = [order("o-1")]

    const billChanged = refetched(prev[0])
    billChanged.bill = { ...billChanged.bill, total: 250 }
    expect(mergeKitchenOrders(prev, [billChanged])).not.toBe(prev)

    const statusChanged = refetched(prev[0])
    statusChanged.items = statusChanged.items.map((item) => ({ ...item, status: "served" }))
    expect(mergeKitchenOrders(prev, [statusChanged])).not.toBe(prev)

    const waiterChanged = refetched(prev[0])
    waiterChanged.waiter = "w-2"
    expect(mergeKitchenOrders(prev, [waiterChanged])).not.toBe(prev)
  })

  it("reorders when the queue order changes", () => {
    const prev = [order("o-1"), order("o-2")]
    const next = [refetched(prev[1]), refetched(prev[0])]

    const merged = mergeKitchenOrders(prev, next)

    expect(merged).not.toBe(prev)
    expect(merged.map((o) => o.id)).toEqual(["o-2", "o-1"])
    expect(merged[0]).toBe(prev[1])
    expect(merged[1]).toBe(prev[0])
  })

  it("returns the identical previous array for an empty refetch that changed nothing", () => {
    const prev: Order[] = []
    expect(mergeKitchenOrders(prev, [])).toBe(prev)
  })
})

describe("new-item highlights", () => {
  it("keeps the highlights of orders that are still on the queue", () => {
    const prev = { "o-1": ["i-1"], "o-2": ["i-2"] }

    expect(mergeNewItems(prev, ["o-1", "o-2"])).toBe(prev)
  })

  it("drops the highlights of orders the refresh no longer returns", () => {
    const prev = { "o-1": ["i-1"], "o-2": ["i-2"] }

    const merged = mergeNewItems(prev, ["o-1"])

    expect(merged).toEqual({ "o-1": ["i-1"] })
  })

  it("adds newly arrived item ids once, without touching the other orders", () => {
    const prev = { "o-1": ["i-1"] }

    const merged = addNewItems(prev, "o-1", ["i-2", "i-3"])

    expect(merged).toEqual({ "o-1": ["i-1", "i-2", "i-3"] })
    expect(addNewItems(merged, "o-1", ["i-2"])).toBe(merged)
  })

  it("removes served item ids and the order entry when none are left", () => {
    expect(removeNewItems({ "o-1": ["i-1", "i-2"] }, "o-1", ["i-1"])).toEqual({ "o-1": ["i-2"] })
    expect(removeNewItems({ "o-1": ["i-1"] }, "o-1", ["i-1"])).toEqual({})

    const untouched = { "o-1": ["i-9"] }
    expect(removeNewItems(untouched, "o-1", ["i-1"])).toBe(untouched)
  })

  it("never mutates the previous highlight map", () => {
    const prev = { "o-1": ["i-1"] }
    const snapshot = { ...prev }

    mergeNewItems(prev, [])
    addNewItems(prev, "o-1", ["i-2"])
    removeNewItems(prev, "o-1", ["i-1"])

    expect(prev).toEqual(snapshot)
  })
})