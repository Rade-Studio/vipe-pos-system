/**
 * T7 (S1/S2, odd/tasks/cargas-por-perfil.md) — kitchen board behaviour.
 *
 * The audit found four kitchen defects: every realtime event cost two order
 * reads (one in the service, one in the view), the kitchen's own "served"
 * writes echoed back as more reads, the queue was rebuilt with
 * `setOrders([])` + one `addOrder` per order on every refresh (blank board),
 * and the mark-ready flow invalidated the deliveries query right after
 * reading it fresh.
 *
 * These tests pin the observable behaviour through the view's public surface:
 * requests issued, queue content, board content and toasts.
 *
 * T8b: the queue is `GET /orders?status=kitchen` and serving is
 * `POST /orders/:id/items/served` (the server delivers the order and serves
 * its table when the last kitchen item goes); the view never writes the
 * database directly.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Profile } from "@/types"

type Row = Record<string, unknown>
type Batch = {
  orderId: string
  order: unknown
  newItemIds: string[]
  servedItemIds: string[]
  isNewOrder: boolean
}

const env = vi.hoisted(() => {
  return {
    /** One entry per `GET /orders` call (its `status` query). */
    statusReads: [] as unknown[],
    /** Queue returned per status; a function lets a test change it over time. */
    kitchenRows: [] as Row[],
    /** When set, `getByStatus` waits on this promise. */
    pendingRead: null as null | { resolve: (rows: Row[]) => void; promise: Promise<Row[]> },
    orderUpdates: [] as { orderId: string; status: string }[],
    itemWrites: [] as { orderId: string; ids: string[] }[],
    failItemWrite: false,
    throwItemWrite: false,
    registerItems: [] as { orderId: string; itemIds: string[] }[],
    unregisterItem: [] as { orderId: string; itemId: string }[],
    unregisterOrder: [] as string[],
    markedLocal: [] as string[][],
    unmarkedLocal: [] as string[][],
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    onBatch: null as null | ((batch: Batch) => void),
    onDelete: null as null | ((payload: Row) => void),
    toasts: [] as { title: unknown; description: unknown }[],
    deliveries: [] as any[],
    listActiveDeliveriesCalls: 0,
    setDeliveryStatusCalls: [] as { orderId: string; action: string }[],
    /** Realtime state the subscription reports. */
    connected: true,
    /** `GET /api/config` answer; null makes the read fail. */
    config: null as null | Record<string, unknown>,
    configReads: 0,
    reset() {
      this.config = null
      this.configReads = 0
      this.statusReads = []
      this.kitchenRows = []
      this.pendingRead = null
      this.orderUpdates = []
      this.itemWrites = []
      this.failItemWrite = false
      this.throwItemWrite = false
      this.registerItems = []
      this.unregisterItem = []
      this.unregisterOrder = []
      this.markedLocal = []
      this.unmarkedLocal = []
      this.subscribeCalls = 0
      this.unsubscribeCalls = 0
      this.onBatch = null
      this.onDelete = null
      this.toasts = []
      this.deliveries = []
      this.listActiveDeliveriesCalls = 0
      this.setDeliveryStatusCalls = []
      this.connected = true
    },
  }
})

vi.mock("@/lib/api/client", async () => {
  const { ApiError } = await import("@/lib/api/errors")
  const route = async (method: string, path: string, init: any = {}) => {
    const id = init?.params?.path?.id
    switch (`${method} ${path}`) {
      case "GET /api/orders": {
        env.statusReads.push(init.params.query.status)
        if (env.pendingRead) {
          const rows = await env.pendingRead.promise
          env.pendingRead = null
          return { data: rows }
        }
        return { data: env.kitchenRows }
      }
      case "GET /api/config": {
        env.configReads += 1
        if (!env.config) throw new ApiError(500, "Internal Server Error", "config down")
        return { data: env.config }
      }
      case "POST /api/orders/{id}/items/served": {
        const ids: string[] = init.body.itemIds
        env.itemWrites.push({ orderId: id, ids })
        if (env.throwItemWrite) throw new Error("network down")
        if (env.failItemWrite) throw new ApiError(409, "Conflict", "Order is closed")
        // Like the server: the items are served and, with no kitchen item
        // left, the order is delivered.
        const order = env.kitchenRows.find((candidate) => candidate.id === id) as any
        const items = (order?.items ?? []).map((line: any) => (ids.includes(line.id) ? { ...line, status: "served" } : line))
        const status = items.some((line: any) => line.status === "kitchen") ? "kitchen" : "delivered"
        return { data: { ...order, items, status } }
      }
      case "PATCH /api/orders/{id}/status":
        env.orderUpdates.push({ orderId: id, status: init.body.status })
        return { data: { id } }
      default:
        throw new Error(`unexpected ${method} ${path}`)
    }
  }
  return {
    api: {
      GET: (path: string, init?: unknown) => route("GET", path, init),
      POST: (path: string, init?: unknown) => route("POST", path, init),
      PATCH: (path: string, init?: unknown) => route("PATCH", path, init),
    },
    onSessionRefreshed: () => () => {},
  }
})

vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    knownItems: {} as Record<string, Set<string>>,
    subscribeToKitchen: (
      onDelete: (payload: Row) => void,
      onBatch: (batch: Batch) => void,
      onStatus: (status: boolean) => void,
    ) => {
      env.subscribeCalls += 1
      env.onDelete = onDelete
      env.onBatch = onBatch
      onStatus(env.connected)
      return () => {
        env.unsubscribeCalls += 1
      }
    },
    registerItems: (orderId: string, itemIds: string[]) => {
      env.registerItems.push({ orderId, itemIds })
    },
    registerItem: () => {},
    unregisterItem: (orderId: string, itemId: string) => {
      env.unregisterItem.push({ orderId, itemId })
    },
    unregisterOrder: (orderId: string) => {
      env.unregisterOrder.push(orderId)
    },
    markLocalItemChanges: (itemIds: string[]) => {
      env.markedLocal.push(itemIds)
    },
    unmarkLocalItemChanges: (itemIds: string[]) => {
      env.unmarkedLocal.push(itemIds)
    },
  },
}))

vi.mock("@/hooks/use-active-deliveries", () => ({
  activeDeliveriesQueryKey: ["active-deliveries"],
  useActiveDeliveries: () => ({ data: env.deliveries }),
}))

vi.mock("@/lib/api/delivery", () => ({
  listActiveDeliveries: async () => {
    env.listActiveDeliveriesCalls += 1
    return env.deliveries
  },
  // Like the real RPC, it returns the moved delivery row.
  setDeliveryStatus: async (args: { orderId: string; action: string }) => {
    env.setDeliveryStatusCalls.push(args)
    const current = env.deliveries.find((d) => d.delivery.orderId === args.orderId)?.delivery
    return { ...current, orderId: args.orderId, status: "ready" }
  },
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (input: { title: unknown; description: unknown }) => {
      env.toasts.push(input)
    },
  }),
}))

vi.mock("@/lib/log", () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} },
}))

import { KitchenView } from "@/components/views/KitchenView"
import { toOrder } from "@/lib/api/orders"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"

const profile: Profile = {
  id: "k-1",
  name: "Cocina",
  role: "kitchen",
}

function item(id: string, status: "kitchen" | "served" = "kitchen", minute = 0) {
  return {
    id,
    orderId: "o-1",
    dishId: null,
    name: id.toUpperCase(),
    price: 100,
    quantity: 1,
    comments: null,
    status,
    addedAt: `2026-10-07T11:0${minute}:00.000Z`,
    createdAt: `2026-10-07T11:0${minute}:00.000Z`,
    updatedAt: `2026-10-07T11:0${minute}:00.000Z`,
  }
}

function row(
  id: string,
  options: { items?: Row[]; orderType?: "dine_in" | "takeaway" | "delivery"; tableId?: string | null; customerName?: string } = {},
): Row {
  return {
    id,
    tableId: options.tableId === undefined ? `table-${id}` : options.tableId,
    orderType: options.orderType ?? "dine_in",
    ...(options.customerName ? { customerName: options.customerName } : {}),
    waiterId: "w-1",
    status: "kitchen",
    subtotal: 100,
    tax: 0,
    taxPercentage: 0,
    tip: 0,
    tipPercentage: 0,
    total: 100,
    totalDiscounts: 0,
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: "2026-10-07T11:00:00.000Z",
    updatedAt: "2026-10-07T11:00:00.000Z",
    items: options.items ?? [item(`${id}-i-1`)],
  }
}

/** A realtime batch carries the order already mapped by the shared `toOrder`. */
const mapped = (r: Row) => toOrder(r as never)

function renderKitchen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <KitchenView profile={profile} onChangeProfile={() => {}} authRole="kitchen" />
    </QueryClientProvider>,
  )
  return { queryClient, view }
}

const ordersInStore = () => useOrderStore.getState().orders
const storeOrder = (id: string) => ordersInStore().find((order) => order.id === id)

beforeEach(() => {
  env.reset()
  useOrderStore.setState({ orders: [] })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter" }] })
  useTableStore.setState({
    tables: [
      { id: "table-o-1", number: 1, status: "kitchen" },
      { id: "table-o-2", number: 2, status: "kitchen" },
    ],
  })
})

describe("kitchen board requests", () => {
  it("reads the kitchen queue once on mount and registers its items", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]

    renderKitchen()

    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()
    expect(screen.getByText("O-2-I-1")).toBeInTheDocument()
    expect(env.statusReads).toEqual(["kitchen"])
    expect(env.registerItems).toEqual([
      { orderId: "o-1", itemIds: ["o-1-i-1"] },
      { orderId: "o-2", itemIds: ["o-2-i-1"] },
    ])
  })

  it("keeps the board on screen while a refresh read is pending", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    let resolveRead: (rows: Row[]) => void = () => {}
    env.pendingRead = {
      promise: new Promise<Row[]>((resolve) => {
        resolveRead = resolve
      }),
      resolve: (rows) => resolveRead(rows),
    }

    act(() => {
      screen.getByRole("button", { name: /Actualizar/i }).click()
    })

    // The queue never blanks while the new read is in flight (S2).
    expect(screen.getByText("O-1-I-1")).toBeInTheDocument()
    expect(screen.getByText("O-2-I-1")).toBeInTheDocument()
    expect(screen.queryByText("No hay órdenes pendientes en cocina")).toBeNull()

    await act(async () => {
      resolveRead([row("o-1"), row("o-2")])
    })

    await waitFor(() => expect(env.toasts.map((t) => t.title)).toContain("Órdenes actualizadas"))
    expect(screen.getByText("O-1-I-1")).toBeInTheDocument()
    expect(env.statusReads).toHaveLength(2)
  })

  it("keeps the identity of the orders a refresh returns unchanged", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()
    const before = ordersInStore()

    act(() => {
      screen.getByRole("button", { name: /Actualizar/i }).click()
    })
    await waitFor(() => expect(env.toasts.map((t) => t.title)).toContain("Órdenes actualizadas"))
    // Flush the hydration effect the new query data triggers.
    await act(async () => {})

    const after = ordersInStore()
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
  })

  it("empties the board when the refresh says the queue is empty", async () => {
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    env.kitchenRows = []
    act(() => {
      screen.getByRole("button", { name: /Actualizar/i }).click()
    })

    await waitFor(() => expect(screen.getByText("No hay órdenes pendientes en cocina")).toBeInTheDocument())
    expect(ordersInStore()).toEqual([])
  })

  it("re-reads the queue exactly once when the connection is re-established", async () => {
    env.kitchenRows = [row("o-1")]
    const { queryClient } = renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    const invalidate = vi.spyOn(queryClient, "invalidateQueries")

    act(() => {
      screen.getByRole("button", { name: /Conectado/i }).click()
    })

    await waitFor(() => expect(env.subscribeCalls).toBe(2))
    expect(env.unsubscribeCalls).toBe(1)
    // One read: the reconnect re-subscribes and invalidates the SAME query
    // instead of running a second, parallel one.
    await waitFor(() => expect(env.statusReads).toHaveLength(2))
    expect(
      invalidate.mock.calls.filter(
        ([arg]) => (arg as { queryKey?: unknown[] } | undefined)?.queryKey?.[1] === "kitchen",
      ),
    ).toHaveLength(1)
    expect(screen.getByText("O-1-I-1")).toBeInTheDocument()
  })
})

describe("kitchen board realtime batches", () => {
  it("applies a five-item burst as one card, one highlight and one toast, with no extra read", async () => {
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    const items = ["n-1", "n-2", "n-3", "n-4", "n-5"].map((id, index) => ({ ...item(id), name: `Nuevo ${index}` }))
    act(() => {
      env.onBatch?.({
        orderId: "o-9",
        order: mapped(row("o-9", { items })),
        newItemIds: items.map((i) => i.id as string),
        servedItemIds: [],
        isNewOrder: true,
      })
    })

    expect(storeOrder("o-9")?.items).toHaveLength(5)
    expect(screen.getByText("Nuevo 0")).toBeInTheDocument()
    // T23: "+n nuevos" comes from the persisted send time; five items sent
    // together are the order's first send, not additions.
    expect(screen.queryByText(/^\+\d+ nuevos$/)).toBeNull()
    expect(env.toasts.filter((t) => t.title === "¡Nueva orden!")).toHaveLength(1)
    expect(screen.getByText("¡Nuevas órdenes!")).toBeInTheDocument()
    expect(env.statusReads).toEqual(["kitchen"])
  })

  it("R3: shows an order the batch reports even when it carries no new items", async () => {
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    // A batch that lost the metadata of the superseded burst: the order is real
    // and has kitchen items, so it must reach the board, not wait for a refresh.
    act(() => {
      env.onBatch?.({
        orderId: "o-9",
        order: mapped(row("o-9", { items: [{ ...item("o-9-i-1"), name: "Combo" }] })),
        newItemIds: [],
        servedItemIds: [],
        isNewOrder: false,
      })
    })

    expect(storeOrder("o-9")?.items).toHaveLength(1)
    expect(screen.getByText("Combo")).toBeInTheDocument()
    expect(env.toasts.filter((t) => t.title === "¡Nueva orden!")).toHaveLength(1)
  })

  it("adds a new item to an order already on the queue without re-reading it", async () => {
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    act(() => {
      env.onBatch?.({
        orderId: "o-1",
        order: mapped(row("o-1", { items: [item("o-1-i-1"), { ...item("o-1-i-2", "kitchen", 5), name: "Postrezo" }] })),
        newItemIds: ["o-1-i-2"],
        servedItemIds: [],
        isNewOrder: false,
      })
    })

    expect(storeOrder("o-1")?.items.map((i) => i.name)).toEqual(["O-1-I-1", "Postrezo"])
    expect(screen.getByText("Postrezo")).toBeInTheDocument()
    expect(screen.getByText("+1 nuevos")).toBeInTheDocument()
    expect(env.toasts.filter((t) => t.title === "¡Nuevo producto en cocina!")).toHaveLength(1)
    expect(env.statusReads).toEqual(["kitchen"])
  })

  it("drops an order from the queue when nothing is left in the kitchen", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    act(() => {
      env.onBatch?.({
        orderId: "o-1",
        order: mapped(row("o-1", { items: [item("o-1-i-1", "served")] })),
        newItemIds: [],
        servedItemIds: ["o-1-i-1"],
        isNewOrder: false,
      })
    })

    expect(storeOrder("o-1")).toBeUndefined()
    expect(screen.queryByText("O-1-I-1")).toBeNull()
    expect(screen.getByText("O-2-I-1")).toBeInTheDocument()
  })

  it("removes an order deleted on the server", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    act(() => {
      env.onDelete?.({ eventType: "DELETE", old: { id: "o-1" } })
    })

    expect(storeOrder("o-1")).toBeUndefined()
    expect(screen.queryByText("O-1-I-1")).toBeNull()
  })
})

describe("kitchen board local writes", () => {
  it("keeps the order on the board with what the server still has in the kitchen", async () => {
    env.kitchenRows = [row("o-1", { items: [item("o-1-i-1", "kitchen", 0), { ...item("o-1-i-2", "kitchen", 1), name: "Bebida" }] })]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole("button", { name: /^Entregar \d/ })[0].click()
    })

    expect(env.itemWrites).toEqual([{ orderId: "o-1", ids: ["o-1-i-1"] }])
    // T23: the served line stays on the ticket, marked served.
    expect(storeOrder("o-1")?.items.map((line) => [line.id, line.status])).toEqual([
      ["o-1-i-1", "served"],
      ["o-1-i-2", "kitchen"],
    ])
    expect(screen.getByRole("button", { name: "Entregar toda (1)" })).toBeInTheDocument()
    expect(env.orderUpdates).toEqual([])
  })

  it("serves an item through the API, patches only that order and reads nothing", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()
    const untouched = storeOrder("o-1")

    const buttons = screen.getAllByRole("button", { name: /^Entregar \d/ })
    expect(buttons).toHaveLength(2)
    await act(async () => {
      buttons[1].click()
    })

    expect(env.itemWrites).toEqual([{ orderId: "o-2", ids: ["o-2-i-1"] }])
    // The write is announced as ours, so its echo costs no read.
    expect(env.markedLocal).toEqual([["o-2-i-1"]])
    expect(env.statusReads).toEqual(["kitchen"])
    // The served order is gone and the other one kept its identity.
    expect(storeOrder("o-2")).toBeUndefined()
    expect(storeOrder("o-1")).toBe(untouched)
    // The server delivered the order with its last item: no second write.
    expect(env.orderUpdates).toEqual([])
    expect(useTableStore.getState().tables.find((table) => table.id === "table-o-2")?.status).toBe("served")
    expect(screen.queryByText("O-2-I-1")).toBeNull()
  })

  it("unmarks the local change when the write fails, so a real change is not swallowed", async () => {
    env.kitchenRows = [row("o-1")]
    env.failItemWrite = true
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole("button", { name: /^Entregar \d/ })[0].click()
    })

    expect(env.markedLocal).toEqual([["o-1-i-1"]])
    expect(env.unmarkedLocal).toEqual([["o-1-i-1"]])
    // The failed write leaves the queue exactly as it was.
    expect(storeOrder("o-1")?.items).toHaveLength(1)
    expect(env.orderUpdates).toEqual([])
    expect(env.toasts.map((t) => t.title)).toContain("Error")
  })

  it("A3: unmarks the local change when the write throws, so a real change is not swallowed", async () => {
    env.kitchenRows = [row("o-1")]
    env.throwItemWrite = true
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole("button", { name: /^Entregar \d/ })[0].click()
    })

    expect(env.markedLocal).toEqual([["o-1-i-1"]])
    expect(env.unmarkedLocal).toEqual([["o-1-i-1"]])
    expect(storeOrder("o-1")?.items).toHaveLength(1)
    expect(env.orderUpdates).toEqual([])
    expect(env.toasts.map((t) => t.title)).toContain("Error")
  })

  it("A3: unmarks every item of the order when the bulk write throws", async () => {
    env.kitchenRows = [row("o-1", { items: [item("o-1-i-1", "kitchen", 0), { ...item("o-1-i-2"), name: "Bebida" }] })]
    env.throwItemWrite = true
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    act(() => {
      screen.getByRole("button", { name: /^Entregar toda/ }).click()
    })
    await act(async () => {
      const confirm = await screen.findByRole("button", { name: "Confirmar entrega" })
      confirm.click()
    })

    expect(env.markedLocal).toEqual([["o-1-i-1", "o-1-i-2"]])
    expect(env.unmarkedLocal).toEqual([["o-1-i-1", "o-1-i-2"]])
    expect(storeOrder("o-1")?.items).toHaveLength(2)
    expect(env.orderUpdates).toEqual([])
  })

  it("marks the whole order as served once, with one write per item", async () => {
    env.kitchenRows = [row("o-1", { items: [item("o-1-i-1", "kitchen", 0), { ...item("o-1-i-2"), name: "Bebida" }] })]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    // T13: one confirmation (the ticket rail's "¿Entregar toda la orden?"),
    // listing the items; the base asked twice (card, then view).
    act(() => {
      screen.getByRole("button", { name: /^Entregar toda/ }).click()
    })
    await act(async () => {
      const confirm = await screen.findByRole("button", { name: "Confirmar entrega" })
      confirm.click()
    })

    expect(env.itemWrites).toEqual([{ orderId: "o-1", ids: ["o-1-i-1", "o-1-i-2"] }])
    expect(env.markedLocal).toEqual([["o-1-i-1", "o-1-i-2"]])
    expect(storeOrder("o-1")).toBeUndefined()
    expect(env.orderUpdates).toEqual([])
  })

  it("keeps the delivery tag and marks the delivery ready without re-reading the deliveries", async () => {
    env.deliveries = [
      { delivery: { orderId: "d-1", status: "preparing", customerName: "Ana", fee: 3000 }, isPaid: false, order: { total: 100 } },
    ]
    env.kitchenRows = [
      row("d-1", { orderType: "delivery", tableId: null, items: [{ ...item("d-1-i-1"), name: "Combo" }] }),
    ]
    const { queryClient } = renderKitchen()

    expect(await screen.findByText("Combo")).toBeInTheDocument()
    // T13: the ticket tags it "Domicilio" and names the customer as its place.
    expect(screen.getByText("Domicilio")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Ana" })).toBeInTheDocument()
    // No "Mesa ?" / "Mesa N" heading for a delivery (domicilios S14).
    expect(screen.queryByText("Mesa ?")).toBeNull()
    expect(screen.queryByText(/^Mesa \d/)).toBeNull()

    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    await act(async () => {
      screen.getAllByRole("button", { name: /^Entregar \d/ })[0].click()
    })

    expect(env.setDeliveryStatusCalls).toEqual([{ orderId: "d-1", action: "mark_ready" }])
    // One fresh read decides the transition; the invalidate right after it used
    // to be a second read of the same rows.
    expect(env.listActiveDeliveriesCalls).toBe(1)
    expect(
      invalidate.mock.calls.filter(
        ([arg]) => (arg as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "active-deliveries",
      ),
    ).toHaveLength(0)
    // The delivery board still shows the new state, without another read.
    expect(queryClient.getQueryData<any[]>(["active-deliveries"])?.[0]?.delivery?.status).toBe("ready")
    expect(env.toasts.map((t) => t.description)).toContain(
      "Todos los productos fueron entregados y el domicilio quedó listo para despachar.",
    )
    expect(storeOrder("d-1")).toBeUndefined()
  })

  it("keeps serving a delivery whose status the operator already moved", async () => {
    env.deliveries = [
      { delivery: { orderId: "d-1", status: "out_for_delivery", customerName: "Ana", fee: 3000 }, isPaid: false, order: { total: 100 } },
    ]
    env.kitchenRows = [
      row("d-1", { orderType: "delivery", tableId: null, items: [{ ...item("d-1-i-1"), name: "Combo" }] }),
    ]
    renderKitchen()
    expect(await screen.findByText("Combo")).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole("button", { name: /^Entregar \d/ })[0].click()
    })

    expect(env.setDeliveryStatusCalls).toEqual([])
    expect(env.toasts.map((t) => t.description)).toContain("Todos los productos fueron entregados.")
  })
})

describe("kitchen ticket rail (rediseno-pos T13)", () => {
  const delivery = (orderId: string, extra: Record<string, unknown> = {}) => ({
    delivery: { orderId, status: "preparing", customerName: "Carolina Gómez", addressLine: "Cra. 43A #18-95", notes: null, fee: 0, ...extra },
    isPaid: false,
    order: { total: 100 },
  })

  it("renders one ticket per order, oldest first, with place tag, order number, waiter and age", async () => {
    env.kitchenRows = [
      row("o-2", { items: [item("o-2-i-1", "kitchen", 5)] }),
      row("o-1", { items: [item("o-1-i-1", "kitchen", 1)] }),
    ]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    const tickets = screen.getAllByRole("article")
    expect(tickets).toHaveLength(2)
    expect(within(tickets[0]).getByRole("heading", { name: "Mesa 1" })).toBeInTheDocument()
    expect(within(tickets[1]).getByRole("heading", { name: "Mesa 2" })).toBeInTheDocument()
    expect(within(tickets[0]).getByText("Mesa", { selector: "span" })).toBeInTheDocument()
    expect(within(tickets[0]).getByText(/Orden #o-1/)).toBeInTheDocument()
    expect(within(tickets[0]).getByText("Ana")).toBeInTheDocument()
    // The fixtures are from 2026-10-07: long past the late threshold.
    expect(within(tickets[0]).getByText("Atrasada")).toBeInTheDocument()
    expect(within(tickets[0]).getByRole("timer").textContent).toMatch(/^\d{2,}:\d{2}$/)
    expect(within(tickets[0]).getByRole("button", { name: "Entregar toda (1)" })).toBeInTheDocument()
  })

  it("shows a delivery with the customer as place, its address and its comment", async () => {
    env.deliveries = [delivery("d-1", { notes: "Alérgica al maní" })]
    env.kitchenRows = [row("d-1", { orderType: "delivery", tableId: null, items: [{ ...item("d-1-i-1"), name: "Combo" }] })]
    renderKitchen()
    expect(await screen.findByText("Combo")).toBeInTheDocument()

    const ticket = screen.getByRole("article")
    expect(within(ticket).getByRole("heading", { name: "Carolina Gómez" })).toBeInTheDocument()
    expect(within(ticket).getByText("Domicilio")).toBeInTheDocument()
    expect(within(ticket).getByText(/Cra\. 43A #18-95/)).toBeInTheDocument()
    expect(within(ticket).getByText("Alérgica al maní")).toBeInTheDocument()
    expect(within(ticket).getByRole("button", { name: "Listo para domicilio (1)" })).toBeInTheDocument()
  })

  it("shows only the ticket rail: no tables tab and no table grid", async () => {
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.queryByRole("tablist")).toBeNull()
    expect(screen.queryByText("Distribución de Mesas")).toBeNull()
    expect(screen.getByRole("button", { name: "Mesas 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Actualizar/ })).toBeInTheDocument()
  })

  it("filters Todas / Mesas / Domicilios with counts", async () => {
    env.deliveries = [delivery("d-1")]
    env.kitchenRows = [
      row("o-1"),
      row("d-1", { orderType: "delivery", tableId: null, items: [{ ...item("d-1-i-1"), name: "Combo" }] }),
    ]
    renderKitchen()
    expect(await screen.findByText("Combo")).toBeInTheDocument()

    expect(screen.getByRole("button", { name: "Todas 2" })).toHaveAttribute("aria-pressed", "true")
    act(() => screen.getByRole("button", { name: "Mesas 1" }).click())
    expect(screen.getByRole("button", { name: "Mesas 1" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText("Combo")).toBeNull()
    expect(screen.getByText("O-1-I-1")).toBeInTheDocument()

    act(() => screen.getByRole("button", { name: "Domicilios 1" }).click())
    expect(screen.queryByText("O-1-I-1")).toBeNull()
    expect(screen.getByText("Combo")).toBeInTheDocument()
  })

  it("shows a takeaway order as PARA LLEVAR · <nombre> and filters it under Para llevar, never under Mesas (S8)", async () => {
    env.kitchenRows = [
      row("o-1"),
      row("p-1", { orderType: "takeaway", tableId: null, customerName: "Ana", items: [{ ...item("p-1-i-1"), name: "Hamburguesa" }] }),
    ]
    renderKitchen()
    expect(await screen.findByText("Hamburguesa")).toBeInTheDocument()

    const ticket = screen.getByRole("article", { name: /^PARA LLEVAR · Ana,/ })
    expect(within(ticket).getByRole("heading", { name: "PARA LLEVAR · Ana" })).toBeInTheDocument()
    expect(within(ticket).getByText("Para llevar", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mesas 1" })).toBeInTheDocument()
    act(() => screen.getByRole("button", { name: "Para llevar 1" }).click())
    expect(screen.queryByText("O-1-I-1")).toBeNull()
    expect(screen.getByText("Hamburguesa")).toBeInTheDocument()
    act(() => screen.getByRole("button", { name: "Mesas 1" }).click())
    expect(screen.queryByText("Hamburguesa")).toBeNull()
  })

  it("confirms the whole order once, listing its items, with the existing bulk write", async () => {
    env.kitchenRows = [row("o-1", { items: [item("o-1-i-1", "kitchen", 0), { ...item("o-1-i-2"), name: "Bebida" }] })]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    act(() => screen.getByRole("button", { name: "Entregar toda (2)" }).click())
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("¿Entregar toda la orden?")).toBeInTheDocument()
    expect(within(dialog).getByText("Bebida")).toBeInTheDocument()
    await act(async () => within(dialog).getByRole("button", { name: "Confirmar entrega" }).click())

    expect(env.itemWrites).toEqual([{ orderId: "o-1", ids: ["o-1-i-1", "o-1-i-2"] }])
    expect(storeOrder("o-1")).toBeUndefined()
  })

  it("shows the offline banner from the real realtime state and reconnects from it", async () => {
    env.connected = false
    env.kitchenRows = [row("o-1")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    expect(screen.getByRole("alert")).toHaveTextContent("Sin conexión en tiempo real.")
    expect(screen.getByRole("button", { name: /Desconectado/ })).toBeInTheDocument()
    act(() => within(screen.getByRole("alert")).getByRole("button", { name: "Reconectar" }).click())
    await waitFor(() => expect(env.subscribeCalls).toBe(2))
  })

  it("shows a loading skeleton until the first read and then the empty state", async () => {
    let resolve: (rows: Row[]) => void = () => {}
    env.pendingRead = { resolve: (rows) => resolve(rows), promise: new Promise<Row[]>((r) => (resolve = r)) }
    renderKitchen()

    expect(await screen.findByTestId("kitchen-loading")).toBeInTheDocument()
    expect(screen.queryByText("No hay órdenes pendientes en cocina")).toBeNull()
    await act(async () => resolve([]))
    expect(await screen.findByText("No hay órdenes pendientes en cocina")).toBeInTheDocument()
    expect(screen.queryByTestId("kitchen-loading")).toBeNull()
  })
})

describe("kitchen ticket real data (rediseno-pos T23)", () => {
  // One clock reading per test, so rows of the same send share their time exactly.
  let clock = Date.now()
  beforeEach(() => {
    clock = Date.now()
  })
  const minutesAgo = (minutes: number) => new Date(clock - minutes * 60_000).toISOString()
  const recent = (id: string, minutes: number, status: "kitchen" | "served" = "kitchen") => ({
    ...item(id, status),
    addedAt: minutesAgo(minutes),
  })

  it("shows the real order number, the order note and the guests in the header", async () => {
    env.kitchenRows = [{ ...row("o-1"), orderNumber: 128, guests: 4, notes: "Cumpleaños: traer el postre con vela" }]
    renderKitchen()
    const ticket = await screen.findByRole("article")

    expect(within(ticket).getByText(/Orden #128/)).toBeInTheDocument()
    expect(within(ticket).queryByText(/#o-1/)).toBeNull()
    expect(within(ticket).getByText(/4 personas/)).toBeInTheDocument()
    expect(within(ticket).getByText("Cumpleaños: traer el postre con vela")).toBeInTheDocument()
    expect(within(ticket).getByText("Comentario:")).toBeInTheDocument()
  })

  it("shows no guests and no note when the order has none, and 1 persona in the singular", async () => {
    env.kitchenRows = [{ ...row("o-1"), orderNumber: 7, guests: 1, notes: null }, { ...row("o-2"), orderNumber: 8, guests: null }]
    renderKitchen()
    await screen.findByText("O-1-I-1")
    const [first, second] = screen.getAllByRole("article")

    expect(within(first).getByText(/1 persona\b/)).toBeInTheDocument()
    expect(within(first).queryByText("Comentario:")).toBeNull()
    expect(within(second).queryByText(/persona/)).toBeNull()
    expect(within(second).getByText(/Orden #8/)).toBeInTheDocument()
  })

  it("keeps a delivery's customer heading and Domicilio tag next to its number", async () => {
    env.deliveries = [
      { delivery: { orderId: "d-1", status: "preparing", customerName: "Carolina Gómez", addressLine: "Cra. 43A", notes: null, fee: 0 }, isPaid: false, order: { total: 100 } },
    ]
    env.kitchenRows = [{ ...row("d-1", { orderType: "delivery", tableId: null }), orderNumber: 131 }]
    renderKitchen()
    const ticket = await screen.findByRole("article")

    expect(within(ticket).getByRole("heading", { name: "Carolina Gómez" })).toBeInTheDocument()
    expect(within(ticket).getByText("Domicilio")).toBeInTheDocument()
    expect(within(ticket).getByText(/Orden #131/)).toBeInTheDocument()
  })

  it("keeps served lines struck through as Entregado without counting them as pending", async () => {
    env.kitchenRows = [
      row("o-1", { items: [{ ...item("o-1-i-1", "served"), name: "Limonada" }, { ...item("o-1-i-2"), name: "Bandeja" }] }),
    ]
    renderKitchen()
    const ticket = await screen.findByRole("article")

    const served = within(ticket).getByText("Limonada")
    expect(served.closest("li")).toHaveTextContent("Entregado")
    expect(served).toHaveClass("line-through")
    expect(within(ticket).queryByRole("button", { name: /Entregar 1 Limonada/ })).toBeNull()
    expect(within(ticket).getByRole("button", { name: "Entregar 1 Bandeja" })).toBeInTheDocument()
    expect(within(ticket).getByRole("button", { name: "Entregar toda (1)" })).toBeInTheDocument()

    act(() => within(ticket).getByRole("button", { name: "Entregar toda (1)" }).click())
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByText("Limonada")).toBeNull()
    await act(async () => within(dialog).getByRole("button", { name: "Confirmar entrega" }).click())
    expect(env.itemWrites).toEqual([{ orderId: "o-1", ids: ["o-1-i-2"] }])
    expect(storeOrder("o-1")).toBeUndefined()
  })

  it("counts +n nuevos from the persisted send time, so it survives a remount", async () => {
    env.kitchenRows = [
      row("o-1", { items: [recent("o-1-i-1", 20, "served"), recent("o-1-i-2", 20), recent("o-1-i-3", 3), recent("o-1-i-4", 3)] }),
    ]
    const first = renderKitchen()
    const ticket = await screen.findByRole("article")
    expect(within(ticket).getByText("+2 nuevos")).toBeInTheDocument()
    expect(within(ticket).getAllByText("Nuevo")).toHaveLength(2)

    first.view.unmount()
    useOrderStore.setState({ orders: [] })
    renderKitchen()
    expect(await screen.findByText("+2 nuevos")).toBeInTheDocument()
  })

  it("counts +n nuevos as the new lines the cook sees, each carrying Nuevo (same dish in one later batch is one line)", async () => {
    env.kitchenRows = [
      row("o-1", {
        items: [
          { ...recent("o-1-i-1", 20), name: "Bandeja" },
          { ...recent("o-1-i-2", 4), name: "Empanadas" },
          { ...recent("o-1-i-3", 4), name: "Empanadas" },
          { ...recent("o-1-i-4", 4), name: "Arroz" },
        ],
      }),
    ]
    renderKitchen()
    const ticket = await screen.findByRole("article")

    expect(within(ticket).getByText("+2 nuevos")).toBeInTheDocument()
    const chips = within(ticket).getAllByText("Nuevo")
    expect(chips).toHaveLength(2)
    expect(chips.map((chip) => chip.closest("li")?.textContent)).toEqual([
      expect.stringContaining("Empanadas"),
      expect.stringContaining("Arroz"),
    ])
    expect(within(ticket).getByText("Bandeja").closest("li")).not.toHaveTextContent("Nuevo")
  })

  it("shows one line for the same dish sent together even when its rows straddle a millisecond", async () => {
    const at = (ms: number) => new Date(clock - 4 * 60_000 + ms).toISOString()
    env.kitchenRows = [
      row("o-1", {
        items: [
          { ...recent("o-1-i-1", 20), name: "Bandeja" },
          { ...item("o-1-i-2"), name: "Empanadas", addedAt: at(0) },
          { ...item("o-1-i-3"), name: "Empanadas", addedAt: at(1) },
        ],
      }),
    ]
    renderKitchen()
    const ticket = await screen.findByRole("article")
    expect(within(ticket).getByText("+1 nuevos")).toBeInTheDocument()
    expect(within(ticket).getAllByText("Empanadas")).toHaveLength(1)
  })

  it("reads kitchenLateMinutes once per session: at risk from 60% of it, late at it", async () => {
    env.config = { kitchenLateMinutes: 20, deliveryLateMinutes: 45 }
    env.kitchenRows = [row("o-1", { items: [recent("o-1-i-1", 13)] }), row("o-2", { items: [recent("o-2-i-1", 21)] })]
    renderKitchen()
    await waitFor(() => expect(screen.getAllByText("En riesgo")).toHaveLength(1))
    // Oldest first: o-2 (21 min) is late, o-1 (13 min) is at risk.
    const [late, risk] = screen.getAllByRole("article")
    expect(within(late).getByText("Atrasada")).toBeInTheDocument()
    expect(within(risk).getByText("En riesgo")).toBeInTheDocument()
    expect(screen.getByText("0–11 min")).toBeInTheDocument()
    expect(screen.getByText("12–19 min")).toBeInTheDocument()
    expect(screen.getByText("20+ min")).toBeInTheDocument()

    await act(async () => screen.getByRole("button", { name: "Actualizar" }).click())
    expect(env.configReads).toBe(1)
  })

  it("falls back to the 25-minute default when the config read fails", async () => {
    env.config = null
    env.kitchenRows = [row("o-1", { items: [recent("o-1-i-1", 13)] }), row("o-2", { items: [recent("o-2-i-1", 16)] })]
    renderKitchen()
    await screen.findAllByRole("article")
    await waitFor(() => expect(env.configReads).toBe(1))
    const [older, newer] = screen.getAllByRole("article")
    expect(within(older).getByText("En riesgo")).toBeInTheDocument()
    expect(within(newer).getByText("A tiempo")).toBeInTheDocument()
    expect(screen.getByText("0–14 min")).toBeInTheDocument()
    expect(screen.getByText("25+ min")).toBeInTheDocument()
  })
})
