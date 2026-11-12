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
  adminOrderRows,
  completedTotals,
  filterOrderRows,
  isLateOrder,
  minutesOpen,
  nextSort,
  ordersSummary,
  sortOrderRows,
  statusCounts,
  type AdminOrderRow,
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
/**
 * T28 (S2, S8) — the dense Órdenes table: rows built only from stored data,
 * search, status/type filters, sort, the late marker from the business-config
 * thresholds and the "Completadas hoy" totals.
 */
describe("T28 admin orders table", () => {
  const NOW = new Date("2026-11-06T13:12:00.000Z").getTime()
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000)
  const thresholds = { kitchenLateMinutes: 25, deliveryLateMinutes: 45 }
  const bill = (total: number, tip = 0) => ({ subtotal: 0, tax: 0, taxPercentage: 0, tip, tipPercentage: 0, total, totalDiscounts: 0 })

  function appOrder(partial: Partial<Order> & { id: string }): Order {
    return {
      tableId: "",
      items: [],
      status: "kitchen",
      bill: bill(0),
      waiter: "",
      createdAt: minutesAgo(0),
      ...partial,
    } as Order
  }

  const orders: Order[] = [
    appOrder({ id: "a", orderNumber: 128, tableId: "t8", waiter: "w1", status: "kitchen", createdAt: minutesAgo(18), bill: bill(130744) }),
    appOrder({ id: "b", orderNumber: 127, orderType: "delivery", waiter: "w2", status: "delivered", createdAt: minutesAgo(58), bill: bill(82620) }),
    appOrder({ id: "c", orderNumber: 125, tableId: "t12", waiter: "w1", status: "kitchen", createdAt: minutesAgo(31), bill: bill(314706) }),
    appOrder({ id: "d", orderNumber: 122, tableId: "t5", waiter: "w3", status: "active", createdAt: minutesAgo(2), bill: bill(50000) }),
  ]
  const tables: Record<string, { number: number; zoneId?: string }> = {
    t8: { number: 8, zoneId: "z1" },
    t12: { number: 12, zoneId: "z1" },
    t5: { number: 5, zoneId: "z2" },
  }
  const zones: Record<string, string> = { z1: "Salón principal", z2: "Terraza" }
  const waiters: Record<string, string> = { w1: "Andrés Felipe Osorio", w2: "Valentina Cardona" }
  const couriers: Record<string, string> = { k1: "Mateo Ríos" }
  const ctx = {
    nowMs: NOW,
    thresholds,
    tableOf: (id: string) => tables[id],
    zoneName: (id: string) => zones[id],
    waiterName: (id: string) => waiters[id],
    deliveryOf: (orderId: string) =>
      orderId === "b"
        ? { customerName: "Laura Gómez", addressLine: "Cra 43A #18-35", neighborhood: "El Poblado", courierId: "k1" }
        : undefined,
    courierName: (id: string) => couriers[id],
  }
  const rows = adminOrderRows(orders, ctx)
  const ids = (list: AdminOrderRow[]) => list.map((row) => row.id)
  const none = { query: "", status: "all", type: "all" } as const

  it("names each row from stored data only: table + zone, delivery customer + address + courier", () => {
    const [a, b, , d] = rows
    expect(a).toMatchObject({
      label: "#128",
      number: 128,
      place: "Mesa 8",
      placeDetail: "Salón principal",
      waiterName: "Andrés Felipe Osorio",
      minutes: 18,
      total: 130744,
    })
    expect(b).toMatchObject({
      label: "#127",
      isDelivery: true,
      place: "Laura Gómez",
      address: "Cra 43A #18-35, El Poblado",
      courierName: "Mateo Ríos",
    })
    // An unknown waiter stays unknown (no invented name).
    expect(d.waiterName).toBeNull()
    // A delivery without its delivery record is just "Domicilio"; no number shows the id prefix.
    const [bare] = adminOrderRows([appOrder({ id: "abcdef1234", orderType: "delivery" })], ctx)
    expect(bare).toMatchObject({ label: "#abcdef12", place: "Domicilio", placeDetail: null, address: null, courierName: null })
    // A table nobody can name keeps the previous "Mesa ?" fallback.
    const [noTable] = adminOrderRows([appOrder({ id: "x", tableId: "gone" })], ctx)
    expect(noTable.place).toBe("Mesa ?")
    // The table number the order carries (API join) names it when the store lacks the table.
    const [joined] = adminOrderRows([{ ...appOrder({ id: "y", tableId: "t99" }), tableName: 9 } as Order], ctx)
    expect(joined.place).toBe("Mesa 9")
  })

  it("names a takeaway row 'Para llevar · <nombre>', never a table (S8)", () => {
    const [row] = adminOrderRows([{ ...appOrder({ id: "t", orderType: "takeaway", customerName: "Laura" }), tableName: "N/A" } as Order], ctx)
    expect(row).toMatchObject({ place: "Para llevar · Laura", placeDetail: null, isDelivery: false })
    expect(row.haystack).toContain("laura")
  })

  it("minutesOpen floors the elapsed minutes and never goes negative", () => {
    expect(minutesOpen(minutesAgo(18), NOW)).toBe(18)
    expect(minutesOpen(new Date(NOW - 59_000), NOW)).toBe(0)
    expect(minutesOpen(new Date(NOW + 60_000), NOW)).toBe(0)
  })

  it("late marker: kitchen orders at kitchenLateMinutes, deliveries at deliveryLateMinutes, nothing else, nothing without config", () => {
    expect(isLateOrder({ status: "kitchen" }, 25, thresholds)).toBe(true)
    expect(isLateOrder({ status: "kitchen" }, 24, thresholds)).toBe(false)
    expect(isLateOrder({ status: "kitchen", orderType: "delivery" }, 44, thresholds)).toBe(false)
    expect(isLateOrder({ status: "delivered", orderType: "delivery" }, 45, thresholds)).toBe(true)
    // Dine-in orders outside the kitchen have no threshold: no marker.
    expect(isLateOrder({ status: "delivered" }, 300, thresholds)).toBe(false)
    expect(isLateOrder({ status: "active" }, 300, thresholds)).toBe(false)
    // Before the config loads there is no threshold to compare with.
    expect(isLateOrder({ status: "kitchen" }, 300, null)).toBe(false)
    expect(rows.map((row) => row.late)).toEqual([false, true, true, false])
    // Thresholds read from the config move the marker.
    const moved = adminOrderRows(orders, { ...ctx, thresholds: { kitchenLateMinutes: 15, deliveryLateMinutes: 60 } })
    expect(moved.map((row) => row.late)).toEqual([true, false, true, false])
  })

  it("search matches #number, table, zone, waiter, customer, address and courier, accent- and case-insensitive", () => {
    const search = (query: string) => ids(filterOrderRows(rows, { ...none, query }))
    expect(search("#128")).toEqual(["a"])
    expect(search("128")).toEqual(["a"])
    expect(search("mesa 12")).toEqual(["c"])
    expect(search("terraza")).toEqual(["d"])
    expect(search("andres")).toEqual(["a", "c"])
    expect(search("GOMEZ")).toEqual(["b"])
    expect(search("poblado")).toEqual(["b"])
    expect(search("mateo")).toEqual(["b"])
    expect(search("mesa 30")).toEqual([])
    expect(search("   ")).toEqual(["a", "b", "c", "d"])
  })

  it("filters by the real order status and by type, with counts per status", () => {
    expect(ids(filterOrderRows(rows, { ...none, status: "kitchen" }))).toEqual(["a", "c"])
    expect(ids(filterOrderRows(rows, { ...none, status: "active" }))).toEqual(["d"])
    expect(ids(filterOrderRows(rows, { ...none, type: "delivery" }))).toEqual(["b"])
    expect(ids(filterOrderRows(rows, { ...none, type: "table" }))).toEqual(["a", "c", "d"])
    expect(ids(filterOrderRows(rows, { query: "andres", status: "kitchen", type: "table" }))).toEqual(["a", "c"])
    expect(statusCounts(rows)).toEqual({ all: 4, active: 1, kitchen: 2, delivered: 1 })
  })

  it("sorts by Tiempo (oldest first by default), Orden and Total, and toggles the direction", () => {
    expect(ids(sortOrderRows(rows, { key: "minutes", direction: "desc" }))).toEqual(["b", "c", "a", "d"])
    expect(ids(sortOrderRows(rows, { key: "number", direction: "asc" }))).toEqual(["d", "c", "b", "a"])
    expect(ids(sortOrderRows(rows, { key: "total", direction: "desc" }))).toEqual(["c", "a", "b", "d"])
    // Sorting never mutates its input.
    expect(ids(rows)).toEqual(["a", "b", "c", "d"])
    expect(nextSort({ key: "minutes", direction: "desc" }, "minutes")).toEqual({ key: "minutes", direction: "asc" })
    expect(nextSort({ key: "minutes", direction: "desc" }, "number")).toEqual({ key: "number", direction: "asc" })
    expect(nextSort({ key: "number", direction: "asc" }, "total")).toEqual({ key: "total", direction: "desc" })
  })

  it("summarises the active orders for the header", () => {
    expect(ordersSummary(rows)).toBe("4 activas · 1 domicilio · la más antigua lleva 58 min")
    expect(ordersSummary(rows.slice(0, 1))).toBe("1 activa · 0 domicilios · la más antigua lleva 18 min")
    expect(ordersSummary([])).toBe("Sin órdenes abiertas ahora")
  })

  it("Completadas hoy totals: paid count, sales (sum of totals) and tips of the day's paid orders", () => {
    const paid = [
      appOrder({ id: "p1", status: "paid", bill: bill(110000, 10000) }),
      appOrder({ id: "p2", status: "paid", bill: bill(50000) }),
    ]
    expect(completedTotals(paid)).toEqual({ paid: 2, sales: 160000, tips: 10000 })
    expect(completedTotals([])).toEqual({ paid: 0, sales: 0, tips: 0 })
  })
})
