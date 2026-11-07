import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/**
 * T8b (S3, S4) — orders through the typed API client instead of Supabase:
 * request paths and bodies, the ONE `toOrder` mapper every screen shares, the
 * wire (realtime) adapter onto that mapper, and the 409 bodies the waiter
 * screen branches on.
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
  addItemsToOrder,
  cancelOrder,
  create,
  deleteOrder,
  getCancelledOrders,
  getById,
  getByStatus,
  orderConflictOf,
  orderDtoFromWire,
  serveItems,
  toOrder,
  updateDetails,
  updateStatus,
  voidOrderItems,
  type OrderDto,
} from "./orders"

function dto(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: "o-1",
    orderNumber: 42,
    guests: 4,
    notes: "sin picante",
    tableId: "t-1",
    waiterId: "w-1",
    status: "kitchen",
    orderType: "dine_in",
    subtotal: 20000,
    tax: 1600,
    taxPercentage: 8,
    tip: 2000,
    tipPercentage: 10,
    total: 23600,
    totalDiscounts: 500,
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: "2026-11-04T12:00:00.000Z",
    updatedAt: "2026-11-04T12:00:01.000Z",
    items: [
      {
        id: "i-1",
        orderId: "o-1",
        dishId: "d-1",
        name: "Bandeja",
        price: 10000,
        quantity: 2,
        comments: null,
        status: "kitchen",
        stationId: null,
        stationSource: null,
        addedAt: "2026-11-04T12:00:00.000Z",
        createdAt: "2026-11-04T12:00:00.000Z",
        updatedAt: null,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: [] })
})

describe("toOrder", () => {
  it("maps the DTO onto the domain Order with tableId, waiter, bill, createdAt as Date and items", () => {
    const order = toOrder(dto())
    expect(order).toEqual({
      id: "o-1",
      orderNumber: 42,
      guests: 4,
      notes: "sin picante",
      tableId: "t-1",
      orderType: "dine_in",
      status: "kitchen",
      waiter: "w-1",
      bill: {
        subtotal: 20000,
        tax: 1600,
        taxPercentage: 8,
        tip: 2000,
        tipPercentage: 10,
        total: 23600,
        totalDiscounts: 500,
      },
      createdAt: new Date("2026-11-04T12:00:00.000Z"),
      isPartialOrder: false,
      parentOrderId: undefined,
      items: [
        {
          id: "i-1",
          dishId: "d-1",
          name: "Bandeja",
          price: 10000,
          quantity: 2,
          comments: undefined,
          categoryId: "",
          image: "/placeholder.svg?height=50&width=50",
          status: "kitchen",
          addedAt: new Date("2026-11-04T12:00:00.000Z"),
        },
      ],
    })
    expect(order.createdAt).toBeInstanceOf(Date)
  })

  it("keeps the delivery flag and turns null table/waiter into empty strings", () => {
    const order = toOrder(dto({ orderType: "delivery", tableId: null, waiterId: null, parentOrderId: "o-0" }))
    expect(order.orderType).toBe("delivery")
    expect(order.tableId).toBe("")
    expect(order.waiter).toBe("")
    expect(order.parentOrderId).toBe("o-0")
  })

  it("turns null guests and notes into undefined", () => {
    const order = toOrder(dto({ guests: null, notes: null }))
    expect(order.guests).toBeUndefined()
    expect(order.notes).toBeUndefined()
    expect(order.orderNumber).toBe(42)
  })
})

describe("orderDtoFromWire", () => {
  it("adapts a pos_changes orders row with its order_items onto the DTO shape", () => {
    const wire = {
      id: "o-1",
      order_number: 42,
      guests: 4,
      notes: "sin picante",
      table_id: "t-1",
      waiter_id: "w-1",
      status: "kitchen",
      order_type: "dine_in",
      subtotal: 20000,
      tax: 1600,
      tax_percentage: 8,
      tip: 2000,
      tip_percentage: 10,
      total: 23600,
      total_discounts: 500,
      is_partial_order: false,
      parent_order_id: null,
      created_at: "2026-11-04T12:00:00.000Z",
      updated_at: "2026-11-04T12:00:01.000Z",
      order_items: [
        {
          id: "i-1",
          order_id: "o-1",
          dish_id: "d-1",
          name: "Bandeja",
          price: 10000,
          quantity: 2,
          comments: null,
          status: "kitchen",
          added_at: "2026-11-04T12:00:00.000Z",
          created_at: "2026-11-04T12:00:00.000Z",
          updated_at: null,
        },
      ],
    }
    expect(orderDtoFromWire(wire)).toEqual(dto())
    expect(orderDtoFromWire({ id: "o-1" })).toBeNull()
  })

  it("reads missing guests and notes as null and a missing order_number as 0", () => {
    const wire = orderDtoFromWire({ id: "o-1", status: "kitchen" })
    expect(wire).toMatchObject({ orderNumber: 0, guests: null, notes: null })
  })
})

describe("line stations (F6)", () => {
  it("carries the station of each line from the API and from a realtime row", () => {
    const item = { ...dto().items[0], stationId: "s-bar", stationSource: "category" as const }
    expect(toOrder(dto({ items: [item] })).items[0]).toMatchObject({ id: "i-1", stationId: "s-bar" })
    expect(toOrder(dto()).items[0]).toMatchObject({ stationId: undefined })
    const wire = orderDtoFromWire({ id: "o-1", status: "kitchen", order_items: [{ id: "i-1", station_id: "s-bar", station_source: "fallback" }] })
    expect(wire?.items[0]).toMatchObject({ stationId: "s-bar", stationSource: "fallback" })
    expect(orderDtoFromWire({ id: "o-1", status: "kitchen", order_items: [{ id: "i-2", station_source: "nope" }] })?.items[0])
      .toMatchObject({ stationId: null, stationSource: null })
  })

  it("asks the kitchen orders of one station", async () => {
    await getByStatus("kitchen", { stationId: "s-bar" })
    expect(api.GET).toHaveBeenCalledWith("/api/orders", { params: { query: { status: "kitchen", stationId: "s-bar" } } })
  })
})

describe("requests", () => {
  it("lists by status in ONE request with a comma-separated status", async () => {
    api.GET.mockResolvedValueOnce({ data: [dto()] })
    await expect(getByStatus(["active", "kitchen", "delivered"])).resolves.toEqual([dto()])
    expect(api.GET).toHaveBeenCalledWith("/api/orders", {
      params: { query: { status: "active,kitchen,delivered" } },
    })

    await getByStatus("kitchen", { include: ["table", "waiter"] })
    expect(api.GET).toHaveBeenLastCalledWith("/api/orders", {
      params: { query: { status: "kitchen", include: "table,waiter" } },
    })
  })

  it("reads one order by id", async () => {
    api.GET.mockResolvedValueOnce({ data: dto() })
    await expect(getById("o-1")).resolves.toEqual(dto())
    expect(api.GET).toHaveBeenCalledWith("/api/orders/{id}", { params: { path: { id: "o-1" } } })
  })

  it("creates a dine-in order with the table, the shown prices and no timestamps", async () => {
    api.POST.mockResolvedValueOnce({ data: dto() })
    const items = [{ dishId: "d-1", quantity: 2, unitPrice: 10000, comments: null }]
    await create({ tableId: "t-1", orderType: "dine_in", items })
    expect(api.POST).toHaveBeenCalledWith("/api/orders", {
      body: { tableId: "t-1", orderType: "dine_in", items },
    })

    api.POST.mockResolvedValueOnce({ data: dto() })
    await create({ tableId: "t-1", orderType: "dine_in", items, force: true })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders", {
      body: { tableId: "t-1", orderType: "dine_in", items, force: true },
    })
  })

  it("sends guests and notes on create and add-items only when given", async () => {
    api.POST.mockResolvedValue({ data: dto() })
    const items = [{ dishId: "d-1", quantity: 1 }]
    await create({ tableId: "t-1", items, guests: 4, notes: "sin picante" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders", {
      body: { tableId: "t-1", items, guests: 4, notes: "sin picante" },
    })
    await addItemsToOrder("o-1", items, { guests: 6, notes: null })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/items", {
      params: { path: { id: "o-1" } },
      body: { items, guests: 6, notes: null },
    })
    await addItemsToOrder("o-1", items, { force: true })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/items", {
      params: { path: { id: "o-1" } },
      body: { items, force: true },
    })
  })

  it("sets or clears guests and notes with PATCH /orders/:id", async () => {
    api.PATCH.mockResolvedValueOnce({ data: dto({ guests: null }) })
    await expect(updateDetails("o-1", { guests: null, notes: "cumpleaños" })).resolves.toEqual(dto({ guests: null }))
    expect(api.PATCH).toHaveBeenCalledWith("/api/orders/{id}", {
      params: { path: { id: "o-1" } },
      body: { guests: null, notes: "cumpleaños" },
    })
  })

  it("adds items, sets delivered, serves items and deletes through the order's path", async () => {
    api.POST.mockResolvedValue({ data: dto() })
    api.PATCH.mockResolvedValue({ data: dto({ status: "delivered" }) })
    api.DELETE.mockResolvedValue({ data: undefined })
    const items = [{ dishId: "d-1", quantity: 1, unitPrice: 10000, comments: "sin sal" }]

    await addItemsToOrder("o-1", items)
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/items", {
      params: { path: { id: "o-1" } },
      body: { items },
    })
    await addItemsToOrder("o-1", items, { force: true })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/items", {
      params: { path: { id: "o-1" } },
      body: { items, force: true },
    })

    await updateStatus("o-1", "delivered")
    expect(api.PATCH).toHaveBeenCalledWith("/api/orders/{id}/status", {
      params: { path: { id: "o-1" } },
      body: { status: "delivered" },
    })

    await serveItems("o-1", ["i-1", "i-2"])
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/items/served", {
      params: { path: { id: "o-1" } },
      body: { itemIds: ["i-1", "i-2"] },
    })

    await deleteOrder("o-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/orders/{id}", { params: { path: { id: "o-1" } } })
  })
})

describe("cancellations and voids (F1)", () => {
  beforeEach(() => {
    api.POST.mockReset()
    api.GET.mockReset()
    api.DELETE.mockReset()
  })

  it("cancels with POST /orders/:id/cancel, sending the reason and the supervisor authorization", async () => {
    const cancelled = { ...dto({ status: "cancelled" }), cancellation: { reason: "customer_left", total: 23600 } }
    api.POST.mockResolvedValueOnce({ data: cancelled })
    await expect(cancelOrder("o-1", { reason: "customer_left", authorizationId: "a-1" })).resolves.toEqual(cancelled)
    expect(api.POST).toHaveBeenCalledWith("/api/orders/{id}/cancel", {
      params: { path: { id: "o-1" } },
      body: { reason: "customer_left", authorizationId: "a-1" },
    })
    api.POST.mockResolvedValueOnce({ data: cancelled })
    await cancelOrder("o-1", { reason: "other", reasonText: "Mesa equivocada" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/orders/{id}/cancel", {
      params: { path: { id: "o-1" } },
      body: { reason: "other", reasonText: "Mesa equivocada" },
    })
  })

  it("voids units of lines with POST /orders/:id/items/void and returns the order", async () => {
    api.POST.mockResolvedValueOnce({ data: dto() })
    await expect(
      voidOrderItems("o-1", { items: [{ itemId: "i-1", quantity: 2 }], reason: "dish_returned", authorizationId: "a-2" }),
    ).resolves.toEqual(dto())
    expect(api.POST).toHaveBeenCalledWith("/api/orders/{id}/items/void", {
      params: { path: { id: "o-1" } },
      body: { items: [{ itemId: "i-1", quantity: 2 }], reason: "dish_returned", authorizationId: "a-2" },
    })
  })

  it("lists the day's cancelled orders for admin with GET /orders/cancelled", async () => {
    api.GET.mockResolvedValueOnce({ data: [] })
    await expect(getCancelledOrders("2026-11-07")).resolves.toEqual([])
    expect(api.GET).toHaveBeenCalledWith("/api/orders/cancelled", { params: { query: { date: "2026-11-07" } } })
  })

  it("DELETE carries the cancellation body when given (the old call shape is unchanged)", async () => {
    api.DELETE.mockResolvedValue({})
    await deleteOrder("o-1", { reason: "waiter_error", authorizationId: "a-3" })
    expect(api.DELETE).toHaveBeenLastCalledWith("/api/orders/{id}", {
      params: { path: { id: "o-1" } },
      body: { reason: "waiter_error", authorizationId: "a-3" },
    })
    await deleteOrder("o-1")
    expect(api.DELETE).toHaveBeenLastCalledWith("/api/orders/{id}", { params: { path: { id: "o-1" } } })
  })
})

describe("orderConflictOf", () => {
  const conflict = (body: Record<string, unknown>) =>
    new ApiError(409, "Conflict", String(body.message), { statusCode: 409, error: "Conflict", ...body })

  it("reads the shortage, price-changed and open-order bodies", () => {
    const shortages = [{ ingredientId: "g-1", name: "Arroz", unit: "g", required: 300, available: 100, missing: 200 }]
    expect(orderConflictOf(conflict({ message: "Insufficient stock", shortages }))).toEqual({
      kind: "shortage",
      shortages,
    })
    const prices = [{ dishId: "d-1", price: 12000 }]
    expect(orderConflictOf(conflict({ message: "Price changed", prices }))).toEqual({ kind: "priceChanged", prices })
    expect(orderConflictOf(conflict({ message: "Table has an open order", orderId: "o-9" }))).toEqual({
      kind: "openOrder",
      orderId: "o-9",
    })
  })

  it("is null for anything else", () => {
    expect(orderConflictOf(conflict({ message: "Order is closed" }))).toBeNull()
    expect(orderConflictOf(new ApiError(422, "Unprocessable Entity", "Unknown waiter"))).toBeNull()
    expect(orderConflictOf(new Error("boom"))).toBeNull()
  })
})
