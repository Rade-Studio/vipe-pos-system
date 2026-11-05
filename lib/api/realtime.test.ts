/**
 * T8b (S3) — the realtime client over ONE socket.io connection to the API's
 * `/realtime` namespace, with these subscription contracts:
 *
 * - `pos_changes` payloads (`{eventType, new, old}`, enriched server-side with
 *   `order_items` and `waiter_name`) reach the table, order and kitchen
 *   subscribers, so `table-merge.ts` / `order-merge.ts` consume them unchanged;
 * - `resync` and every reconnect invalidate the order, table and delivery
 *   queries (the lost-notification window);
 * - an auth refresh reconnects the socket with the new cookie;
 * - the kitchen keeps its read budget: ONE order read per burst, zero for its
 *   own echoes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Handler = (...args: any[]) => void

const env = vi.hoisted(() => {
  const on = (registry: Map<string, Set<Handler>>) => (event: string, handler: Handler) => {
    if (!registry.has(event)) registry.set(event, new Set())
    registry.get(event)!.add(handler)
  }
  const fire = (registry: Map<string, Set<Handler>>, event: string, ...args: unknown[]) => {
    for (const handler of [...(registry.get(event) ?? [])]) handler(...args)
  }

  const socketHandlers = new Map<string, Set<Handler>>()
  const managerHandlers = new Map<string, Set<Handler>>()
  const socket = {
    connected: false,
    connects: 0,
    disconnects: 0,
    on(event: string, handler: Handler) {
      on(socketHandlers)(event, handler)
      return socket
    },
    off() {
      return socket
    },
    connect() {
      socket.connects += 1
      return socket
    },
    disconnect() {
      socket.disconnects += 1
      socket.connected = false
      return socket
    },
    removeAllListeners() {
      socketHandlers.clear()
      return socket
    },
    io: {
      on(event: string, handler: Handler) {
        on(managerHandlers)(event, handler)
      },
      off() {},
    },
  }

  return {
    socket,
    ioCalls: [] as unknown[][],
    /** Server -> client socket event. */
    serverEmit: (event: string, ...args: unknown[]) => fire(socketHandlers, event, ...args),
    /** Manager (transport) event such as `reconnect`. */
    managerEmit: (event: string, ...args: unknown[]) => fire(managerHandlers, event, ...args),
    invalidated: [] as unknown[],
    orderReads: [] as string[],
    orders: new Map<string, unknown>(),
    toasts: [] as unknown[],
    meCalls: 0,
    meFails: false,
    reset() {
      this.meCalls = 0
      this.meFails = false
      socketHandlers.clear()
      managerHandlers.clear()
      socket.connected = false
      socket.connects = 0
      socket.disconnects = 0
      this.ioCalls = []
      this.invalidated = []
      this.orderReads = []
      this.orders = new Map()
      this.toasts = []
    },
  }
})

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => {
    env.ioCalls.push(args)
    return env.socket
  },
}))

vi.mock("@/lib/api/client", () => ({
  api: {
    GET: async (path: string, init: { params: { path: { id: string } } }) => {
      if (path === "/api/auth/me") {
        env.meCalls += 1
        if (env.meFails) throw new Error("401")
        return { data: {} }
      }
      if (path !== "/api/orders/{id}") throw new Error(`unexpected GET ${path}`)
      const id = init.params.path.id
      env.orderReads.push(id)
      return { data: env.orders.get(id) }
    },
  },
  onSessionRefreshed: (listener: () => void) => {
    sessionListeners.add(listener)
    return () => sessionListeners.delete(listener)
  },
}))
const sessionListeners = vi.hoisted(() => new Set<() => void>())

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    invalidateQueries: (filter: { queryKey: unknown }) => {
      env.invalidated.push(filter.queryKey)
      return Promise.resolve()
    },
  },
}))

vi.mock("@/components/ui/use-toast", () => ({
  toast: (input: unknown) => {
    env.toasts.push(input)
  },
}))

import { REFUSED_HANDSHAKE_RETRY_MS, realtimeService } from "./realtime"
import { KITCHEN_EVENT_COALESCE_MS, LOCAL_CHANGE_TTL_MS } from "@/lib/kitchen/realtime"
import { mergeTableList } from "@/lib/realtime/table-merge"
import { mergeOrdersList, wireRowToPartialOrder } from "@/lib/realtime/order-merge"

/** Wait past the coalescing window, so a burst has been read and delivered. */
const flush = () => new Promise((resolve) => setTimeout(resolve, KITCHEN_EVENT_COALESCE_MS + 50))

const change = (table: string, eventType: string, row: Record<string, unknown>, old: Record<string, unknown> = {}) => ({
  schema: "public",
  table,
  commit_timestamp: "2026-11-04T12:00:00.000Z",
  eventType,
  new: row,
  old,
  errors: null,
})

const orderDto = (id: string, itemStatuses: Record<string, string> = {}) => ({
  id,
  tableId: "t-1",
  waiterId: "w-1",
  status: "kitchen",
  orderType: "dine_in",
  subtotal: 0,
  tax: 0,
  taxPercentage: 0,
  tip: 0,
  tipPercentage: 0,
  total: 0,
  totalDiscounts: 0,
  isPartialOrder: false,
  parentOrderId: null,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: null,
  items: Object.entries(itemStatuses).map(([itemId, status]) => ({
    id: itemId,
    orderId: id,
    dishId: "d-1",
    name: "Plato",
    price: 1000,
    quantity: 1,
    comments: null,
    status,
    addedAt: null,
    createdAt: null,
    updatedAt: null,
  })),
})

interface Batch {
  orderId: string
  order: { id: string; items: { id: string }[] }
  newItemIds: string[]
  servedItemIds: string[]
  isNewOrder: boolean
}

function subscribeKitchen() {
  const batches: Batch[] = []
  const deletes: unknown[] = []
  const status: boolean[] = []
  const unsubscribe = realtimeService.subscribeToKitchen(
    (payload) => deletes.push(payload),
    (batch) => batches.push(batch as unknown as Batch),
    (connected) => status.push(connected),
  )
  return { batches, deletes, status, unsubscribe }
}

beforeEach(() => {
  env.reset()
})

afterEach(() => {
  realtimeService.unsubscribeAll()
  sessionListeners.clear()
})

describe("one socket.io connection", () => {
  it("opens ONE connection to /realtime with the cookie for every subscriber", () => {
    const tables = realtimeService.subscribeToTables(() => {})
    const orders = realtimeService.subscribeToOrders(() => {})
    const kitchen = subscribeKitchen()

    expect(env.ioCalls).toEqual([
      ["/realtime", expect.objectContaining({ path: "/socket.io/", withCredentials: true, addTrailingSlash: true })],
    ])
    tables()
    orders()
    kitchen.unsubscribe()
  })

  it("disconnects when the last subscriber leaves", () => {
    const tables = realtimeService.subscribeToTables(() => {})
    const orders = realtimeService.subscribeToOrders(() => {})
    tables()
    expect(env.socket.disconnects).toBe(0)
    orders()
    expect(env.socket.disconnects).toBe(1)
  })
})

describe("pos_changes dispatch", () => {
  it("hands a tables event to every table subscriber, ready for mergeTableList", () => {
    const seen: unknown[] = []
    const first = realtimeService.subscribeToTables((payload) => seen.push(payload))
    const second = realtimeService.subscribeToTables((payload) => seen.push(payload), "admin")

    const event = change("tables", "UPDATE", {
      id: "t-1",
      number: 4,
      status: "occupied",
      waiter_id: "w-1",
      waiter_name: "Ana",
      updated_at: "2026-11-04T12:00:00.000Z",
    })
    env.serverEmit("pos_changes", event)

    expect(seen).toEqual([event, event])
    const merged = mergeTableList([{ id: "t-1", number: 4, status: "available" }], event)
    expect(merged).toEqual([
      {
        id: "t-1",
        number: 4,
        status: "occupied",
        waiter: "w-1",
        waiter_name: "Ana",
        updated_at: new Date("2026-11-04T12:00:00.000Z"),
      },
    ])
    first()
    second()
  })

  it("hands an orders event (with its order_items) to every order subscriber, ready for mergeOrdersList", () => {
    const seen: unknown[] = []
    const first = realtimeService.subscribeToOrders((payload) => seen.push(payload))
    const second = realtimeService.subscribeToOrders((payload) => seen.push(payload))

    const event = change("orders", "UPDATE", {
      id: "o-1",
      table_id: "t-1",
      status: "delivered",
      order_items: [{ id: "i-1", status: "served" }],
    })
    env.serverEmit("pos_changes", event)

    expect(seen).toEqual([event, event])
    const merged = mergeOrdersList([{ id: "o-1", status: "kitchen" } as never], {
      eventType: "UPDATE",
      new: wireRowToPartialOrder(event.new),
    })
    expect(merged[0].status).toBe("delivered")
    first()
    // The remaining subscriber still receives events.
    env.serverEmit("pos_changes", change("orders", "DELETE", {}, { id: "o-1" }))
    expect(seen).toHaveLength(3)
    second()
  })

  it("does not hand order_items or tables events to order subscribers", () => {
    const seen: unknown[] = []
    const unsubscribe = realtimeService.subscribeToOrders((payload) => seen.push(payload))
    env.serverEmit("pos_changes", change("order_items", "INSERT", { id: "i-1", order_id: "o-1" }))
    env.serverEmit("pos_changes", change("tables", "UPDATE", { id: "t-1" }))
    env.serverEmit("pos_changes", change("order_deliveries", "UPDATE", { order_id: "o-1" }))
    expect(seen).toEqual([])
    unsubscribe()
  })
})

describe("delivery subscription (T11)", () => {
  it("hands order_deliveries events and delivery orders events to delivery subscribers, nothing else", () => {
    const seen: unknown[] = []
    const unsubscribe = realtimeService.subscribeToDeliveries((payload) => seen.push(payload))

    const deliveryRow = change("order_deliveries", "UPDATE", { order_id: "o-1", delivery_status: "ready" })
    const deliveryOrder = change("orders", "UPDATE", { id: "o-1", order_type: "delivery" })
    const deletedDeliveryOrder = change("orders", "DELETE", {}, { id: "o-2", order_type: "delivery" })
    env.serverEmit("pos_changes", deliveryRow)
    env.serverEmit("pos_changes", deliveryOrder)
    env.serverEmit("pos_changes", deletedDeliveryOrder)
    env.serverEmit("pos_changes", change("orders", "UPDATE", { id: "o-3", order_type: "dine_in" }))
    env.serverEmit("pos_changes", change("order_items", "INSERT", { id: "i-1", order_id: "o-1" }))
    env.serverEmit("pos_changes", change("tables", "UPDATE", { id: "t-1" }))

    expect(seen).toEqual([deliveryRow, deliveryOrder, deletedDeliveryOrder])
    expect(env.ioCalls).toHaveLength(1)
    expect(realtimeService.getChannelsStatus().channels.map((c) => c.id)).toEqual(["deliveries"])

    unsubscribe()
    expect(env.socket.disconnects).toBe(1)
    env.serverEmit("pos_changes", deliveryRow)
    expect(seen).toHaveLength(3)
  })

  it("fans a delivery orders event out to orders, kitchen and delivery listeners exactly once each", () => {
    const orders: unknown[] = []
    const deliveries: unknown[] = []
    const stopOrders = realtimeService.subscribeToOrders((payload) => orders.push(payload))
    const stopDeliveries = realtimeService.subscribeToDeliveries((payload) => deliveries.push(payload))
    const kitchen = subscribeKitchen()

    const deliveryOrder = change("orders", "DELETE", {}, { id: "o-1", order_type: "delivery" })
    env.serverEmit("pos_changes", deliveryOrder)
    env.serverEmit("pos_changes", change("order_deliveries", "UPDATE", { order_id: "o-1" }))
    env.serverEmit("pos_changes", change("orders", "UPDATE", { id: "o-2", order_type: "dine_in" }))

    expect(orders.map((e: any) => [e.table, e.new.id ?? e.old.id])).toEqual([
      ["orders", "o-1"],
      ["orders", "o-2"],
    ])
    expect(kitchen.deletes).toEqual([deliveryOrder])
    expect(deliveries.map((e: any) => e.table)).toEqual(["orders", "order_deliveries"])

    stopOrders()
    kitchen.unsubscribe()
    expect(env.socket.disconnects).toBe(0)
    stopDeliveries()
    expect(env.socket.disconnects).toBe(1)
  })

  it("invalidates ['active-deliveries'] on resync and on a reconnect, not on the first connect", () => {
    const stop = realtimeService.subscribeToDeliveries(() => {})
    env.serverEmit("connect")
    expect(env.invalidated).toEqual([])
    env.serverEmit("disconnect", "transport close")
    env.serverEmit("connect")
    expect(env.invalidated).toContainEqual(["active-deliveries"])
    env.invalidated = []
    env.serverEmit("resync")
    expect(env.invalidated).toContainEqual(["active-deliveries"])
    stop()
  })

  it("shares the one connection with the other subscriptions", () => {
    const orders = realtimeService.subscribeToOrders(() => {})
    const deliveries = realtimeService.subscribeToDeliveries(() => {})
    expect(env.ioCalls).toHaveLength(1)
    orders()
    expect(env.socket.disconnects).toBe(0)
    deliveries()
    expect(env.socket.disconnects).toBe(1)
  })
})

describe("resync and reconnect", () => {
  const KEYS = [["orders"], ["orders", "kitchen"], ["tables"], ["active-deliveries"]]

  it("invalidates the order, kitchen, table and delivery queries on resync", () => {
    const unsubscribe = realtimeService.subscribeToOrders(() => {})
    env.serverEmit("resync")
    expect(env.invalidated).toEqual(KEYS)
    unsubscribe()
  })

  it("invalidates the same queries when the socket reconnects, not on the first connect", () => {
    const unsubscribe = realtimeService.subscribeToTables(() => {})
    env.serverEmit("connect")
    expect(env.invalidated).toEqual([])
    env.serverEmit("disconnect", "transport close")
    env.serverEmit("connect")
    expect(env.invalidated).toEqual(KEYS)
    unsubscribe()
  })

  it("reconnects the socket after an auth refresh, so the handshake carries the new cookie", () => {
    const unsubscribe = realtimeService.subscribeToTables(() => {})
    const connectsBefore = env.socket.connects
    for (const listener of sessionListeners) listener()
    expect(env.socket.disconnects).toBe(1)
    expect(env.socket.connects).toBe(connectsBefore + 1)
    unsubscribe()
  })

  it("reports the connection state to the kitchen and in getChannelsStatus", () => {
    const { status, unsubscribe } = subscribeKitchen()
    env.serverEmit("connect")
    env.serverEmit("disconnect", "transport close")
    expect(status).toEqual([true, false])
    expect(realtimeService.getChannelsStatus()).toMatchObject({ isConnected: false })
    env.serverEmit("connect")
    expect(realtimeService.getChannelsStatus()).toMatchObject({ isConnected: true, totalChannels: 1 })
    unsubscribe()
  })
})

describe("kitchen read budget", () => {
  it("costs ONE order read for a new order with five items", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    env.serverEmit("pos_changes", change("orders", "INSERT", { id: "o-1", table_id: "t-1", status: "kitchen" }))
    for (const id of ["i-1", "i-2", "i-3", "i-4", "i-5"]) {
      env.serverEmit("pos_changes", change("order_items", "INSERT", { id, order_id: "o-1", status: "kitchen" }))
    }
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({
      orderId: "o-1",
      order: { id: "o-1" },
      newItemIds: ["i-1", "i-2", "i-3", "i-4", "i-5"],
      servedItemIds: [],
      isNewOrder: true,
    })
    unsubscribe()
  })

  it("ignores an orders INSERT that does not reach the kitchen", async () => {
    const { batches, unsubscribe } = subscribeKitchen()
    env.serverEmit("pos_changes", change("orders", "INSERT", { id: "o-1", status: "active" }))
    await flush()
    expect(env.orderReads).toEqual([])
    expect(batches).toEqual([])
    unsubscribe()
  })

  it("costs ONE order read when a waiter adds an item to an order already on the queue", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    realtimeService.registerItems("o-1", ["i-1"])
    const { batches, unsubscribe } = subscribeKitchen()

    env.serverEmit("pos_changes", change("order_items", "INSERT", { id: "i-2", order_id: "o-1", status: "kitchen" }))
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].newItemIds).toEqual(["i-2"])
    unsubscribe()
  })

  it("costs ONE order read when two items leave the kitchen at once", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    for (const id of ["i-1", "i-2"]) {
      env.serverEmit(
        "pos_changes",
        change("order_items", "UPDATE", { id, order_id: "o-1", status: "served" }, { id, status: "kitchen" }),
      )
    }
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].servedItemIds).toEqual(["i-1", "i-2"])
    unsubscribe()
  })

  it("costs ZERO reads for an item the kitchen itself served", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    realtimeService.markLocalItemChanges(["i-1", "i-2"])
    for (const id of ["i-1", "i-2"]) {
      env.serverEmit(
        "pos_changes",
        change("order_items", "UPDATE", { id, order_id: "o-1", status: "served" }, { id, status: "kitchen" }),
      )
    }
    await flush()

    expect(env.orderReads).toEqual([])
    expect(batches).toEqual([])
    unsubscribe()
  })

  it("does not swallow the next real change of an item the kitchen served", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    realtimeService.markLocalItemChanges(["i-1"])
    env.serverEmit(
      "pos_changes",
      change("order_items", "UPDATE", { id: "i-1", order_id: "o-1", status: "served" }, { id: "i-1", status: "kitchen" }),
    )
    env.serverEmit(
      "pos_changes",
      change("order_items", "UPDATE", { id: "i-1", order_id: "o-1", status: "kitchen" }, { id: "i-1", status: "served" }),
    )
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].newItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("A1: delivers a real served change whose mark never got an echo", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    realtimeService.markLocalItemChanges(["i-1"])
    await flush()

    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LOCAL_CHANGE_TTL_MS + 1)
    env.serverEmit(
      "pos_changes",
      change("order_items", "UPDATE", { id: "i-1", order_id: "o-1", status: "served" }, { id: "i-1", status: "kitchen" }),
    )
    await flush()
    clock.mockRestore()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].servedItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("A3: an unmarked local change no longer hides the next real change", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { batches, unsubscribe } = subscribeKitchen()

    realtimeService.markLocalItemChanges(["i-1"])
    realtimeService.unmarkLocalItemChanges(["i-1"])
    env.serverEmit(
      "pos_changes",
      change("order_items", "UPDATE", { id: "i-1", order_id: "o-1", status: "served" }, { id: "i-1", status: "kitchen" }),
    )
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].servedItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("keeps the order-delete event read-free and forgets its items", async () => {
    realtimeService.registerItems("o-9", ["i-1"])
    const { deletes, unsubscribe } = subscribeKitchen()
    realtimeService.registerItems("o-9", ["i-1"])

    const event = change("orders", "DELETE", {}, { id: "o-9" })
    env.serverEmit("pos_changes", event)

    expect(env.orderReads).toEqual([])
    expect(deletes).toEqual([event])
    expect(realtimeService.isNewItem("o-9", "i-1")).toBe(true)
    unsubscribe()
  })

  it("tracks known items with the bookkeeping helpers", () => {
    realtimeService.registerItem("o-1", "i-1")
    realtimeService.registerItems("o-1", ["i-2", "i-3"])
    expect(realtimeService.isNewItem("o-1", "i-2")).toBe(false)
    realtimeService.unregisterItem("o-1", "i-2")
    expect(realtimeService.isNewItem("o-1", "i-2")).toBe(true)
    realtimeService.unregisterOrder("o-1")
    expect(realtimeService.isNewItem("o-1", "i-1")).toBe(true)
  })

  it("does not read the order for events that arrive after unsubscribe", async () => {
    env.orders.set("o-1", orderDto("o-1"))
    const { unsubscribe } = subscribeKitchen()
    unsubscribe()
    env.serverEmit("pos_changes", change("order_items", "INSERT", { id: "i-9", order_id: "o-1", status: "kitchen" }))
    await flush()
    expect(env.orderReads).toEqual([])
  })
})

describe("refused handshake", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it("probes the session once per refusal and re-arms after a successful connect", async () => {
    env.meFails = true
    const unsubscribe = realtimeService.subscribeToTables(() => {})
    env.serverEmit("connect_error", new Error("unauthorized"))
    env.serverEmit("connect_error", new Error("unauthorized"))
    await settle()
    expect(env.meCalls).toBe(1)

    env.serverEmit("connect")
    env.serverEmit("connect_error", new Error("unauthorized"))
    await settle()
    expect(env.meCalls).toBe(2)
    unsubscribe()
  })

  it("reconnects once after a short backoff when the session is fine", async () => {
    vi.useFakeTimers()
    try {
      const unsubscribe = realtimeService.subscribeToTables(() => {})
      const before = env.socket.connects
      env.serverEmit("connect_error", new Error("unauthorized"))
      await vi.advanceTimersByTimeAsync(0)
      expect(env.socket.connects).toBe(before)
      await vi.advanceTimersByTimeAsync(REFUSED_HANDSHAKE_RETRY_MS)
      expect(env.socket.connects).toBe(before + 1)
      await vi.advanceTimersByTimeAsync(REFUSED_HANDSHAKE_RETRY_MS * 5)
      expect(env.socket.connects).toBe(before + 1)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not reconnect when the session probe fails", async () => {
    vi.useFakeTimers()
    try {
      env.meFails = true
      const unsubscribe = realtimeService.subscribeToTables(() => {})
      const before = env.socket.connects
      env.serverEmit("connect_error", new Error("unauthorized"))
      await vi.advanceTimersByTimeAsync(REFUSED_HANDSHAKE_RETRY_MS * 2)
      expect(env.socket.connects).toBe(before)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("unsubscribeAll", () => {
  it("disconnects, drops the refresh listener, the listeners and knownItems; a later subscribe opens a new socket", () => {
    const seen: unknown[] = []
    realtimeService.subscribeToTables((payload) => seen.push(payload))
    realtimeService.registerItems("o-1", ["i-1"])
    expect(sessionListeners.size).toBe(1)

    realtimeService.unsubscribeAll()

    expect(env.socket.disconnects).toBe(1)
    expect(sessionListeners.size).toBe(0)
    expect(realtimeService.knownItems).toEqual({})
    env.serverEmit("pos_changes", change("tables", "UPDATE", { id: "t-1" }))
    expect(seen).toEqual([])

    const unsubscribe = realtimeService.subscribeToTables(() => {})
    expect(env.ioCalls).toHaveLength(2)
    unsubscribe()
  })
})
