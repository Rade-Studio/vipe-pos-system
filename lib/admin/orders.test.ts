/**
 * T9 (S1/S2) — admin active-orders logic.
 *
 * Before this module the logic lived inline in `AdminView`: the wire→app
 * mapper was written TWICE (the React Query `queryFn` and the hand-rolled
 * `loadActiveOrdersFromDB`), the store/DB merge rebuilt a brand new array on
 * every render (no memo, no reference stability), and `isNewOrder` was computed
 * from `new Date()` INSIDE the render of every card, so a card that rendered
 * once within 30 s of its creation kept the `animate-pulse-light` class forever.
 *
 * These are the pure pieces of that screen, extracted so the invariants the
 * audit asks for (S1: no duplicated reads; S2: no re-render/flicker churn;
 * odd/tasks/domicilios.md S14: a delivery order is labelled DOMICILIO) are
 * pinned by tests instead of by code reading.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// `fetchActiveAdminOrders` reads through the API client (T8b); the mock keeps
// the node suite offline and lets the test assert the ONE request it makes.
const api = vi.hoisted(() => ({ GET: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  ADMIN_ACTIVE_STATUSES,
  NEW_ORDER_PULSE_MS,
  adminOrdersQueryKey,
  adminOrderFromDto,
  countOrdersByStatus,
  countPaidOrdersOn,
  fetchActiveAdminOrders,
  gridOrdersFromStore,
  isNewOrderAt,
  mergeOrderLists,
  newOrderIdsAt,
  paidOrdersOn,
  withoutOrder,
} from "./orders"
import type { Order } from "@/types"

beforeEach(() => {
  api.GET.mockReset().mockResolvedValue({ data: [] })
})

/** An API order with the admin includes (table number, waiter name). */
function dto(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    tableId: "t-7",
    waiterId: "w-2",
    status: "kitchen",
    orderType: "dine_in",
    subtotal: 100,
    tax: 8,
    taxPercentage: 8,
    tip: 0,
    tipPercentage: 0,
    total: 108,
    totalDiscounts: 5,
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: null,
    items: [
      {
        id: "i-1",
        orderId: "o-1",
        dishId: "d-1",
        name: "Bandeja",
        price: 50,
        quantity: 2,
        comments: "sin cebolla",
        status: "kitchen",
        addedAt: null,
        createdAt: null,
        updatedAt: null,
      },
    ],
    tableNumber: 7,
    waiterName: "Ana",
    ...overrides,
  } as any
}

function order(partial: Partial<Order> & { id: string }): Order {
  return {
    tableId: "t-1",
    items: [],
    status: "kitchen",
    bill: {
      subtotal: 0,
      tax: 0,
      taxPercentage: 0,
      tip: 0,
      tipPercentage: 0,
      total: 0,
      totalDiscounts: 0,
    },
    waiter: "w-1",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    ...partial,
  } as Order
}

describe("adminOrdersQueryKey", () => {
  it("is the slot the realtime handler and the delete handler patch", () => {
    // The T5 realtime patch in AdminView writes to `['orders','admin']`; if this
    // key moved, every realtime event would land in a cache nobody renders.
    expect(adminOrdersQueryKey).toEqual(["orders", "admin"])
  })
})

describe("mergeOrderLists", () => {
  it("keeps the base order and appends only the ids the base does not have", () => {
    const base = [order({ id: "a" }), order({ id: "b" })]
    const db = [order({ id: "b" }), order({ id: "c" })]

    expect(mergeOrderLists(base, db).map((o) => o.id)).toEqual(["a", "b", "c"])
  })

  it("returns the IDENTICAL base reference when the extra list adds nothing (memo stability)", () => {
    const base = [order({ id: "a" })]
    const db = [order({ id: "a" })]
    const merged = mergeOrderLists(base, db)

    expect(merged).toBe(base)
  })

  it("tolerates empty inputs", () => {
    expect(mergeOrderLists([], [])).toEqual([])
    expect(mergeOrderLists([], [order({ id: "a" })]).map((o) => o.id)).toEqual(["a"])
    expect(mergeOrderLists([order({ id: "a" })], [])).toHaveLength(1)
  })
})

describe("isNewOrderAt — pulse window (S2: cards must stop pulsing)", () => {
  const created = new Date("2026-01-01T10:00:00.000Z")

  it("is true inside the 30 s window", () => {
    expect(isNewOrderAt(created, created.getTime() + NEW_ORDER_PULSE_MS - 1)).toBe(true)
    expect(isNewOrderAt(created, created.getTime())).toBe(true)
  })

  it("is false at and after the window end (the old `new Date()`-per-render check never reached this)", () => {
    expect(isNewOrderAt(created, created.getTime() + NEW_ORDER_PULSE_MS)).toBe(false)
    expect(isNewOrderAt(created, created.getTime() + 10 * NEW_ORDER_PULSE_MS)).toBe(false)
  })

  it("accepts a string timestamp and refuses a missing/invalid one (never pulse, never crash)", () => {
    expect(isNewOrderAt("2026-01-01T10:00:00.000Z", Date.parse("2026-01-01T10:00:10.000Z"))).toBe(true)
    expect(isNewOrderAt(undefined, Date.now())).toBe(false)
    expect(isNewOrderAt("not-a-date", Date.now())).toBe(false)
  })

  it("honours an explicit window", () => {
    expect(isNewOrderAt(created, created.getTime() + 5_000, 1_000)).toBe(false)
    expect(isNewOrderAt(created, created.getTime() + 5_000, 60_000)).toBe(true)
  })
})

describe("newOrderIdsAt", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z")

  it("collects exactly the ids inside the window and leaves older orders out", () => {
    const ids = newOrderIdsAt(
      [
        order({ id: "fresh", createdAt: new Date(now - 5_000) }),
        order({ id: "old", createdAt: new Date(now - 5 * NEW_ORDER_PULSE_MS) }),
        order({ id: "edge", createdAt: new Date(now - NEW_ORDER_PULSE_MS) }),
      ],
      now,
    )

    expect([...ids].sort()).toEqual(["fresh"])
  })

  it("returns an empty set for an empty list", () => {
    expect(newOrderIdsAt([], now).size).toBe(0)
  })
})

describe("countOrdersByStatus / countPaidOrdersOn", () => {
  const list = [
    order({ id: "k", status: "kitchen" }),
    order({ id: "d", status: "delivered" }),
    order({ id: "p1", status: "paid", createdAt: new Date(2026, 0, 15, 9, 0) }),
    order({ id: "p2", status: "paid", createdAt: new Date(2026, 0, 14, 23, 0) }),
    order({ id: "p3", status: "paid", createdAt: new Date(2026, 0, 15, 23, 59) }),
  ]
  const startOfDay15 = new Date(2026, 0, 15).setHours(0, 0, 0, 0)

  it("counts each status the dashboard card shows", () => {
    expect(countOrdersByStatus(list, ["kitchen"])).toBe(1)
    expect(countOrdersByStatus(list, ["delivered"])).toBe(1)
    expect(countOrdersByStatus(list, ["kitchen", "delivered"])).toBe(2)
    expect(countOrdersByStatus([], ["paid"])).toBe(0)
  })

  it("lists the paid orders of one local day (the CompletedOrdersTable merge)", () => {
    expect(paidOrdersOn(list, startOfDay15).map((o) => o.id)).toEqual(["p1", "p3"])
  })

  it("counts the paid orders of one local day", () => {
    expect(countPaidOrdersOn(list, startOfDay15)).toBe(2)
    expect(countPaidOrdersOn(list, new Date(2026, 0, 14).setHours(0, 0, 0, 0))).toBe(1)
    expect(countPaidOrdersOn(list, new Date(2026, 0, 16).setHours(0, 0, 0, 0))).toBe(0)
  })
})

describe("fetchActiveAdminOrders", () => {
  it("is ONE request for exactly the statuses the grid lists, with the table and waiter names", async () => {
    await fetchActiveAdminOrders()

    expect(api.GET).toHaveBeenCalledTimes(1)
    expect(api.GET).toHaveBeenCalledWith("/api/orders", {
      params: { query: { status: "active,kitchen,delivered", include: "table,waiter" } },
    })
  })

  it("maps the rows it reads through the shared mapper", async () => {
    api.GET.mockResolvedValueOnce({ data: [dto({ id: "d-1", tableId: null, orderType: "delivery", tableNumber: null })] })

    const orders = await fetchActiveAdminOrders()

    expect(orders).toHaveLength(1)
    expect(orders[0].orderType).toBe("delivery")
    expect(orders[0].items[0].name).toBe("Bandeja")
  })

  it("raises on a failed read so the screen can keep the previous rows and report it", async () => {
    api.GET.mockRejectedValueOnce(new Error("boom"))

    await expect(fetchActiveAdminOrders()).rejects.toThrow()
  })
})

describe("gridOrdersFromStore", () => {
  it("keeps exactly the statuses the admin grid listed before the query existed", () => {
    const store = [
      order({ id: "k", status: "kitchen" }),
      order({ id: "d", status: "delivered" }),
      order({ id: "p", status: "paid" }),
      order({ id: "a", status: "active" }),
      order({ id: "c", status: "cancelled" }),
    ]

    expect(gridOrdersFromStore(store).map((o) => o.id)).toEqual(["k", "d", "p"])
  })

  it("is empty for an empty store", () => {
    expect(gridOrdersFromStore([])).toEqual([])
  })
})

describe("withoutOrder", () => {
  it("drops the deleted order and is reference-stable when it was not there", () => {
    const list = [order({ id: "a" }), order({ id: "b" })]

    expect(withoutOrder(list, "a").map((o) => o.id)).toEqual(["b"])
    expect(withoutOrder(list, "zz")).toBe(list)
  })
})

describe("adminOrderFromDto", () => {
  it("maps one API order into the app Order shape used by the grid", () => {
    const mapped = adminOrderFromDto(dto())

    expect(mapped.id).toBe("o-1")
    expect(mapped.tableId).toBe("t-7")
    expect(mapped.tableName).toBe(7)
    expect(mapped.waiterName).toBe("Ana")
    expect(mapped.items).toHaveLength(1)
    expect(mapped.items[0]).toMatchObject({
      id: "i-1",
      name: "Bandeja",
      price: 50,
      quantity: 2,
      categoryId: "",
      comments: "sin cebolla",
      status: "kitchen",
    })
    expect(mapped.bill).toEqual({
      subtotal: 100,
      tax: 8,
      taxPercentage: 8,
      tip: 0,
      tipPercentage: 0,
      total: 108,
      totalDiscounts: 5,
    })
    expect(mapped.createdAt).toBeInstanceOf(Date)
  })

  it("carries orderType so a delivery order is labelled DOMICILIO, never Mesa ? (domicilios S14)", () => {
    expect(adminOrderFromDto(dto({ tableId: null, orderType: "delivery" })).orderType).toBe("delivery")
    expect(adminOrderFromDto(dto()).orderType).toBe("dine_in")
  })

  it("falls back to N/A / Desconocido for an order without table or waiter", () => {
    const mapped = adminOrderFromDto(dto({ tableId: null, waiterId: null, tableNumber: null, waiterName: null, items: [] }))

    expect(mapped.tableName).toBe("N/A")
    expect(mapped.waiterName).toBe("Desconocido")
    expect(mapped.items).toEqual([])
    expect(mapped.waiter).toBe("")
  })

  it("asks for exactly the statuses the admin grid lists", () => {
    expect([...ADMIN_ACTIVE_STATUSES]).toEqual(["active", "kitchen", "delivered"])
  })
})