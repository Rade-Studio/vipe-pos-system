/**
 * T7 (S1) — the kitchen subscription is the only place an order read happens
 * per realtime event. Before this task a new order cost 1 read for the `orders`
 * INSERT, 1 read per item INSERT, and each of those reads was followed by the
 * same order being read again from the view handler (11 order reads for a
 * 5-item order, plus 2 more for each item the kitchen itself served).
 *
 * This suite pins the read budget per trigger against the real
 * `subscribeToKitchen` wiring with a fake Supabase client, and pins the echo
 * filter: an item the kitchen itself served must cost zero reads.
 *
 * The shared `orders-changes` contract used by WaiterView/CashierView/
 * AdminView is pinned at the end of the file — the kitchen work must not move
 * it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Handler = (payload: any) => void | Promise<void>

const env = vi.hoisted(() => {
  type FakeChannel = {
    name: string
    handlers: Handler[]
    subscribeCb?: (status: string) => void
    on: (type: string, filter: unknown, handler: Handler) => FakeChannel
    subscribe: (cb?: (status: string) => void) => FakeChannel
    unsubscribe: () => void
    send: () => Promise<string>
  }
  const channels = new Map<string, FakeChannel>()

  const createChannel = (name: string): FakeChannel => {
    const channel: FakeChannel = {
      name,
      handlers: [],
      on(_type: string, _filter: unknown, handler: Handler) {
        channel.handlers.push(handler)
        return channel
      },
      subscribe(cb?: (status: string) => void) {
        channel.subscribeCb = cb
        cb?.("SUBSCRIBED")
        return channel
      },
      unsubscribe: () => {},
      send: () => Promise.resolve("ok"),
    }
    channels.set(name, channel)
    return channel
  }

  const emit = async (channelName: string, payload: unknown) => {
    const channel = channels.get(channelName)
    if (!channel) throw new Error(`unknown channel ${channelName}`)
    await Promise.all(channel.handlers.map((handler) => handler(payload as never)))
  }

  const subscribeStatus = (channelName: string, status: string) => {
    const channel = channels.get(channelName)
    if (!channel) throw new Error(`unknown channel ${channelName}`)
    channel.subscribeCb?.(status)
  }

  return {
    channels,
    createChannel,
    emit,
    subscribeStatus,
    /** One entry per `orderService.getById` (the kitchen's order read). */
    orderReads: [] as string[],
    /** Rows the fake `orders` read resolves to, per order id. */
    orders: new Map<string, unknown>(),
    /** Every PostgREST table read issued through the client directly. */
    tableReads: [] as { table: string; eq: unknown[][] }[],
    itemRows: [] as unknown[],
    toasts: [] as { title: unknown }[],
    removedChannels: [] as string[],
    reset() {
      this.orderReads = []
      this.orders = new Map()
      this.tableReads = []
      this.itemRows = []
      this.toasts = []
      this.removedChannels = []
    },
  }
})

vi.mock("./client", () => ({
  supabase: {
    channel: (name: string) => env.createChannel(name),
    removeChannel: (channel: { name: string }) => {
      env.removedChannels.push(channel.name)
    },
    from: (table: string) => {
      const eq: unknown[][] = []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => {
        eq.push([column, value])
        return chain
      }
      chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        env.tableReads.push({ table, eq })
        return Promise.resolve({ data: env.itemRows, error: null }).then(resolve, reject)
      }
      return chain
    },
  },
}))

vi.mock("./service", () => ({
  orderService: {
    getById: async (id: string) => {
      env.orderReads.push(id)
      const order = env.orders.get(id)
      if (!order) return null
      return order
    },
  },
}))

vi.mock("@/components/ui/use-toast", () => ({
  toast: (input: { title: unknown }) => {
    env.toasts.push(input)
  },
}))

import { realtimeService } from "@/lib/supabase/realtime-service"
import { KITCHEN_EVENT_COALESCE_MS, LOCAL_CHANGE_TTL_MS } from "@/lib/kitchen/realtime"

interface Batch {
  orderId: string
  order: { id: string } | null
  newItemIds: string[]
  servedItemIds: string[]
  isNewOrder: boolean
}

/** Wait past the coalescing window, so a burst has been read and delivered. */
const flush = () => new Promise((resolve) => setTimeout(resolve, KITCHEN_EVENT_COALESCE_MS + 50))

const CHANNELS = {
  status: "public:kitchen-status",
  orders: "kitchen-orders-channel",
  newItems: "kitchen-new-items-channel",
  itemUpdates: "kitchen-item-updates-channel",
  orderDeletes: "kitchen-order-deletes-channel",
}

function subscribe() {
  const batches: Batch[] = []
  const deletes: unknown[] = []
  const status: boolean[] = []
  const unsubscribe = realtimeService.subscribeToKitchen(
    (payload) => deletes.push(payload),
    (batch) => batches.push(batch as Batch),
    (connected) => status.push(connected),
  )
  return { batches, deletes, status, unsubscribe }
}

beforeEach(() => {
  env.reset()
})

afterEach(() => {
  realtimeService.knownItems = {}
})

describe("kitchen realtime read budget", () => {
  it("costs ONE order read for a new order with five items", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    await env.emit(CHANNELS.orders, {
      eventType: "INSERT",
      new: { id: "o-1", table_id: "t-1", status: "kitchen" },
      old: {},
    })
    for (const id of ["i-1", "i-2", "i-3", "i-4", "i-5"]) {
      await env.emit(CHANNELS.newItems, {
        eventType: "INSERT",
        new: { id, order_id: "o-1", status: "kitchen" },
        old: {},
      })
    }
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(env.tableReads).toEqual([])
    expect(batches).toHaveLength(1)
    expect(batches[0]).toMatchObject({
      orderId: "o-1",
      newItemIds: ["i-1", "i-2", "i-3", "i-4", "i-5"],
      servedItemIds: [],
      isNewOrder: true,
    })
    unsubscribe()
  })

  it("costs ONE order read when a waiter adds an item to an order already on the queue", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    realtimeService.registerItems("o-1", ["i-1"])
    const { batches, unsubscribe } = subscribe()

    await env.emit(CHANNELS.newItems, {
      eventType: "INSERT",
      new: { id: "i-2", order_id: "o-1", status: "kitchen" },
      old: {},
    })
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].newItemIds).toEqual(["i-2"])
    unsubscribe()
  })

  it("costs ONE order read when two items leave the kitchen at once", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-2", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].servedItemIds).toEqual(["i-1", "i-2"])
    unsubscribe()
  })

  it("costs ZERO reads for an item the kitchen itself served", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    realtimeService.markLocalItemChanges(["i-1", "i-2"])

    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-2", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await flush()

    expect(env.orderReads).toEqual([])
    expect(batches).toEqual([])
    unsubscribe()
  })

  it("does not swallow the next real change of an item the kitchen served", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    realtimeService.markLocalItemChanges(["i-1"])
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    // The waiter re-sends the same item to the kitchen: this one is real.
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "kitchen" },
      old: { status: "served" },
    })
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].newItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("A1: delivers a real served change whose mark never got an echo", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    // The kitchen served an item that another terminal had already served: no
    // kitchen->served echo ever arrives, so the mark would stay forever.
    realtimeService.markLocalItemChanges(["i-1"])
    await flush()
    expect(env.orderReads).toEqual([])

    // A real "served" change for that item later on must NOT be swallowed.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LOCAL_CHANGE_TTL_MS + 1)
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await flush()
    clock.mockRestore()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches).toHaveLength(1)
    expect(batches[0].servedItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("A1: forgets a stale mark as soon as the item is back in the kitchen", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    realtimeService.markLocalItemChanges(["i-1"])
    await flush()
    expect(env.orderReads).toEqual([])

    // The item re-enters the kitchen (the waiter sent it again): the pending
    // mark describes a change that is no longer pending.
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "kitchen" },
      old: { status: "served" },
    })
    await flush()
    expect(env.orderReads).toEqual(["o-1"])

    // So a real served change on this very item is still read and delivered.
    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await flush()

    expect(env.orderReads).toEqual(["o-1", "o-1"])
    expect(batches).toHaveLength(2)
    expect(batches[1].servedItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("A3: an unmarked local change no longer hides the next real change", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { batches, unsubscribe } = subscribe()

    realtimeService.markLocalItemChanges(["i-1"])
    realtimeService.unmarkLocalItemChanges(["i-1"])

    await env.emit(CHANNELS.itemUpdates, {
      eventType: "UPDATE",
      new: { id: "i-1", order_id: "o-1", status: "served" },
      old: { status: "kitchen" },
    })
    await flush()

    expect(env.orderReads).toEqual(["o-1"])
    expect(batches[0].servedItemIds).toEqual(["i-1"])
    unsubscribe()
  })

  it("keeps the order-delete event read-free", async () => {
    const { deletes, unsubscribe } = subscribe()

    await env.emit(CHANNELS.orderDeletes, {
      eventType: "DELETE",
      new: {},
      old: { id: "o-9" },
    })

    expect(env.orderReads).toEqual([])
    expect(deletes).toHaveLength(1)
    unsubscribe()
  })

  it("reports the connection state of the status channel", () => {
    const { status, unsubscribe } = subscribe()
    expect(status).toEqual([true])

    env.subscribeStatus(CHANNELS.status, "CHANNEL_ERROR")

    expect(status).toEqual([true, false])
    unsubscribe()
  })

  it("releases every kitchen channel on unsubscribe", () => {
    const { unsubscribe } = subscribe()

    unsubscribe()

    expect(env.removedChannels).toEqual([
      CHANNELS.status,
      CHANNELS.orders,
      CHANNELS.newItems,
      CHANNELS.itemUpdates,
      CHANNELS.orderDeletes,
    ])
  })

  it("does not read the order for events that arrive after unsubscribe", async () => {
    env.orders.set("o-1", { id: "o-1", table_id: "t-1", status: "kitchen", order_items: [] })
    const { unsubscribe } = subscribe()

    unsubscribe()
    await env.emit(CHANNELS.newItems, {
      eventType: "INSERT",
      new: { id: "i-9", order_id: "o-1", status: "kitchen" },
      old: {},
    })
    await flush()

    expect(env.orderReads).toEqual([])
  })
})

describe("shared realtime contracts used by the other views", () => {
  it("fans a shared orders-changes event out to every caller with ONE item read", async () => {
    env.itemRows = [{ id: "i-1", status: "kitchen" }]
    const seen: string[] = []

    const first = realtimeService.subscribeToOrders((payload) => seen.push(`first:${payload.new.id}`))
    const second = realtimeService.subscribeToOrders((payload) => seen.push(`second:${payload.new.id}`))

    await env.emit("orders-changes", {
      eventType: "UPDATE",
      new: { id: "o-1", status: "kitchen" },
      old: {},
    })

    expect(env.tableReads).toEqual([{ table: "order_items", eq: [["order_id", "o-1"]] }])
    expect(seen).toEqual(["first:o-1", "second:o-1"])

    first()
    // The channel stays alive for the remaining caller.
    env.itemRows = []
    await env.emit("orders-changes", {
      eventType: "UPDATE",
      new: { id: "o-2", status: "kitchen" },
      old: {},
    })
    expect(seen).toEqual(["first:o-1", "second:o-1", "second:o-2"])

    second()
    expect(env.removedChannels).toEqual(["orders-changes"])
  })
})