/**
 * Tests for `lib/realtime/order-merge.ts` — slice S5.
 *
 * Covers the D7 behaviour table using the same convention as
 * `lib/realtime/table-merge.test.ts`: every no-op row asserts reference
 * identity (`expect(result).toBe(prev)`), not deep equality, because
 * reference identity is the load-bearing property that Zustand and React
 * Query rely on.
 */
import { describe, expect, test } from "vitest"
import type { Order, OrderItem } from "@/types"
import { mergeOrdersList } from "./order-merge"

// Minimal OrderItem factory. `image` is required by the `OrderItem` type, and
// `status` is `OrderItemStatus = "kitchen" | "served"` — defaults to "kitchen"
// because that's the most common kitchen-path state in slice S5 scenarios.
function makeItem(id: string, overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id,
    name: `name-${id}`,
    price: 1,
    quantity: 1,
    categoryId: "",
    image: "",
    status: "kitchen" as const,
    ...overrides,
  }
}

function makeOrder(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    tableId: `t-${id}`,
    items: [],
    status: "active",
    bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
    waiter: "",
    createdAt: new Date(0),
    ...overrides,
  }
}

describe("mergeOrdersList — D7 behaviour table", () => {
  describe("INSERT", () => {
    test("new id not in prev → new array, row appended", () => {
      const prev = [makeOrder("o-1"), makeOrder("o-2")]
      const result = mergeOrdersList(prev, {
        eventType: "INSERT",
        new: makeOrder("o-3", { status: "kitchen" }),
      })
      expect(result).not.toBe(prev)
      expect(result).toHaveLength(3)
      expect(result[2].id).toBe("o-3")
    })

    test("new id already in prev → prev (idempotent against echo + StrictMode double-delivery)", () => {
      const prev = [makeOrder("o-1"), makeOrder("o-2")]
      const result = mergeOrdersList(prev, {
        eventType: "INSERT",
        new: makeOrder("o-1", { status: "cancelled" }),
      })
      expect(result).toBe(prev)
    })

    test("new id missing → prev", () => {
      const prev = [makeOrder("o-1")]
      const result = mergeOrdersList(prev, { eventType: "INSERT", new: { status: "kitchen" } })
      expect(result).toBe(prev)
    })
  })

  describe("UPDATE", () => {
    test("new id in prev, status-only patch → that one row replaced, other refs preserved", () => {
      const prev = [makeOrder("o-1"), makeOrder("o-2"), makeOrder("o-3")]
      const result = mergeOrdersList(prev, {
        eventType: "UPDATE",
        new: { id: "o-2", status: "delivered" },
      })
      expect(result).not.toBe(prev)
      expect(result[1]).not.toBe(prev[1])
      expect(result[1].status).toBe("delivered")
      expect(result[1].id).toBe("o-2")
      // Every untouched row keeps its identity:
      expect(result[0]).toBe(prev[0])
      expect(result[2]).toBe(prev[2])
    })

    test("new id not in prev → prev (dropped, not upserted — D5 parity)", () => {
      const prev = [makeOrder("o-1")]
      const result = mergeOrdersList(prev, {
        eventType: "UPDATE",
        new: { id: "missing", status: "delivered" },
      })
      expect(result).toBe(prev)
    })

    test("new id missing → prev", () => {
      const prev = [makeOrder("o-1")]
      const result = mergeOrdersList(prev, { eventType: "UPDATE", new: { status: "delivered" } })
      expect(result).toBe(prev)
    })

    test("UPDATE carrying only status preserves items and bill references", () => {
      // D7 consequence 2 (the contract carried over from the table sibling):
      // partial updates merge without replacing the untouched subtrees wholesale.
      const itemsRef = [makeItem("i-1")]
      const billRef = { subtotal: 10, tax: 1, taxPercentage: 10, tip: 0, tipPercentage: 0, total: 11, totalDiscounts: 0 }
      const prev = [makeOrder("o-1", { items: itemsRef, bill: billRef })]
      const result = mergeOrdersList(prev, {
        eventType: "UPDATE",
        new: { id: "o-1", status: "delivered" },
      })
      expect(result[0].items).toBe(itemsRef)
      expect(result[0].bill).toBe(billRef)
    })
  })

  describe("DELETE", () => {
    test("old id in prev → row filtered out", () => {
      const prev = [makeOrder("o-1"), makeOrder("o-2"), makeOrder("o-3")]
      const result = mergeOrdersList(prev, { eventType: "DELETE", old: { id: "o-2" } })
      expect(result).not.toBe(prev)
      expect(result).toHaveLength(2)
      expect(result.find((o) => o.id === "o-2")).toBeUndefined()
      // Surrounding refs preserved:
      expect(result[0]).toBe(prev[0])
      expect(result[1]).toBe(prev[2])
    })

    test("old id not in prev → prev (no allocation, so no re-render)", () => {
      const prev = [makeOrder("o-1")]
      const result = mergeOrdersList(prev, { eventType: "DELETE", old: { id: "missing" } })
      expect(result).toBe(prev)
    })

    test("old id missing → prev", () => {
      const prev = [makeOrder("o-1")]
      const result = mergeOrdersList(prev, { eventType: "DELETE", old: {} })
      expect(result).toBe(prev)
    })
  })

  test("unknown eventType → prev", () => {
    const prev = [makeOrder("o-1")]
    const result = mergeOrdersList(prev, {
      eventType: "MYSTERY",
      new: { id: "o-1", status: "delivered" },
    })
    expect(result).toBe(prev)
  })
})

describe("mergeOrdersList — invariant", () => {
  test("empty prev + INSERT with id → new array of length 1", () => {
    const result = mergeOrdersList([], { eventType: "INSERT", new: makeOrder("o-1") })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("o-1")
  })

  test("empty prev + INSERT without id → prev (= empty array, no allocation triggered)", () => {
    const prev: Order[] = []
    const result = mergeOrdersList(prev, { eventType: "INSERT", new: {} })
    expect(result).toBe(prev)
  })

  test("UPDATE that changes only one field still preserves untouched Order subtrees (item identity)", () => {
    const items = [makeItem("i-1")]
    const prev = [makeOrder("o-1", { items })]
    const result = mergeOrdersList(prev, { eventType: "UPDATE", new: { id: "o-1", waiter: "alice" } })
    expect(result[0].items).toBe(items)
    expect(result[0].waiter).toBe("alice")
  })
})
