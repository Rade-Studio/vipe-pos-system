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
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Profile } from "@/types"

type Row = Record<string, unknown>
type Batch = {
  orderId: string
  order: Row
  newItemIds: string[]
  servedItemIds: string[]
  isNewOrder: boolean
}

const env = vi.hoisted(() => {
  return {
    /** One entry per `orderService.getByStatus` call. */
    statusReads: [] as unknown[],
    /** Queue returned per status; a function lets a test change it over time. */
    kitchenRows: [] as Row[],
    /** When set, `getByStatus` waits on this promise. */
    pendingRead: null as null | { resolve: (rows: Row[]) => void; promise: Promise<Row[]> },
    orderUpdates: [] as { orderId: string; status: string }[],
    itemWrites: [] as { ids: string[]; values: Row }[],
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
    reset() {
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
    },
  }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: { signOut: async () => {} },
    from: (table: string) => {
      const state: { ids: string[]; values: Row } = { ids: [], values: {} }
      const chain: Record<string, unknown> = {}
      chain.update = (values: Row) => {
        state.values = values
        return chain
      }
      chain.eq = (_column: string, value: string) => {
        state.ids = [value]
        return chain
      }
      chain.in = (_column: string, values: string[]) => {
        state.ids = values
        return chain
      }
      chain.select = () => chain
      chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        env.itemWrites.push({ ids: state.ids, values: state.values })
        // A rejected write (transport failure), not the `{ error }` shape.
        if (env.throwItemWrite) {
          reject(new Error("network down"))
          return
        }
        const error = env.failItemWrite ? { message: "boom" } : null
        resolve({ error })
      }
      return chain
    },
  },
  createSupabaseClient: () => ({}),
}))

vi.mock("@/lib/supabase/service", () => ({
  orderService: {
    getByStatus: async (statuses: string | string[]) => {
      env.statusReads.push(statuses)
      if (env.pendingRead) {
        const rows = await env.pendingRead.promise
        env.pendingRead = null
        return rows
      }
      return env.kitchenRows
    },
    getById: async () => null,
    updateStatus: async (orderId: string, status: string) => {
      env.orderUpdates.push({ orderId, status })
      return { id: orderId }
    },
  },
  tableService: { getAll: async () => [] },
}))

vi.mock("@/lib/supabase/realtime-service", () => ({
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
      onStatus(true)
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

vi.mock("@/lib/supabase/delivery-service", () => ({
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
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"

const profile: Profile = {
  id: "k-1",
  name: "Cocina",
  role: "kitchen",
  hasPassword: false,
}

function item(id: string, status: "kitchen" | "served" = "kitchen", minute = 0) {
  return {
    id,
    order_id: "o-1",
    dish_id: null,
    name: id.toUpperCase(),
    price: 100,
    quantity: 1,
    comments: null,
    status,
    created_at: `2026-10-07T11:0${minute}:00.000Z`,
    updated_at: `2026-10-07T11:0${minute}:00.000Z`,
  }
}

function row(id: string, options: { items?: Row[]; orderType?: "dine_in" | "delivery"; tableId?: string | null } = {}): Row {
  return {
    id,
    table_id: options.tableId === undefined ? `table-${id}` : options.tableId,
    order_type: options.orderType ?? "dine_in",
    waiter_id: "w-1",
    status: "kitchen",
    subtotal: 100,
    tax: 0,
    tax_percentage: 0,
    tip: 0,
    tip_percentage: 0,
    total: 100,
    total_discounts: 0,
    is_partial_order: false,
    parent_order_id: null,
    created_at: "2026-10-07T11:00:00.000Z",
    updated_at: "2026-10-07T11:00:00.000Z",
    order_items: options.items ?? [item(`${id}-i-1`)],
  }
}

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
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter", hasPassword: false }] })
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
        order: row("o-9", { items }),
        newItemIds: items.map((i) => i.id as string),
        servedItemIds: [],
        isNewOrder: true,
      })
    })

    expect(storeOrder("o-9")?.items).toHaveLength(5)
    expect(screen.getByText("Nuevo 0")).toBeInTheDocument()
    expect(screen.getAllByText("¡Nuevos productos agregados!")).toHaveLength(1)
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
        order: row("o-9", { items: [{ ...item("o-9-i-1"), name: "Combo" }] }),
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
        order: row("o-1", { items: [item("o-1-i-1"), { ...item("o-1-i-2"), name: "Postrezo" }] }),
        newItemIds: ["o-1-i-2"],
        servedItemIds: [],
        isNewOrder: false,
      })
    })

    expect(storeOrder("o-1")?.items.map((i) => i.name)).toEqual(["O-1-I-1", "Postrezo"])
    expect(screen.getByText("Postrezo")).toBeInTheDocument()
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
        order: row("o-1", { items: [item("o-1-i-1", "served")] }),
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
  it("serves an item with one write, patches only that order and reads nothing", async () => {
    env.kitchenRows = [row("o-1"), row("o-2")]
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()
    const untouched = storeOrder("o-1")

    const buttons = screen.getAllByRole("button", { name: "Entregar" })
    expect(buttons).toHaveLength(2)
    await act(async () => {
      buttons[1].click()
    })

    expect(env.itemWrites).toHaveLength(1)
    expect(env.itemWrites[0].ids).toEqual(["o-2-i-1"])
    expect(env.itemWrites[0].values.status).toBe("served")
    // The write is announced as ours, so its echo costs no read.
    expect(env.markedLocal).toEqual([["o-2-i-1"]])
    expect(env.statusReads).toEqual(["kitchen"])
    // The served order is gone and the other one kept its identity.
    expect(storeOrder("o-2")).toBeUndefined()
    expect(storeOrder("o-1")).toBe(untouched)
    expect(env.orderUpdates).toEqual([{ orderId: "o-2", status: "delivered" }])
    expect(screen.queryByText("O-2-I-1")).toBeNull()
  })

  it("unmarks the local change when the write fails, so a real change is not swallowed", async () => {
    env.kitchenRows = [row("o-1")]
    env.failItemWrite = true
    renderKitchen()
    expect(await screen.findByText("O-1-I-1")).toBeInTheDocument()

    await act(async () => {
      screen.getAllByRole("button", { name: "Entregar" })[0].click()
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
      screen.getAllByRole("button", { name: "Entregar" })[0].click()
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
      screen.getByRole("button", { name: /Entregar Orden Completa/i }).click()
    })
    await act(async () => {
      const deliverAll = await screen.findByRole("button", { name: /Entregar Todo/i })
      deliverAll.click()
    })
    await act(async () => {
      const confirm = await screen.findByRole("button", { name: /^Confirmar$/i })
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

    // OrderCard confirms first ("Entregar Todo"), the view confirms the batch
    // ("Confirmar"): two confirmation steps, as on the base.
    act(() => {
      screen.getByRole("button", { name: /Entregar Orden Completa/i }).click()
    })
    await act(async () => {
      const deliverAll = await screen.findByRole("button", { name: /Entregar Todo/i })
      deliverAll.click()
    })
    await act(async () => {
      const confirm = await screen.findByRole("button", { name: /^Confirmar$/i })
      confirm.click()
    })

    expect(env.itemWrites).toHaveLength(1)
    expect(env.itemWrites[0].ids).toEqual(["o-1-i-1", "o-1-i-2"])
    expect(env.itemWrites[0].values.status).toBe("served")
    expect(env.markedLocal).toEqual([["o-1-i-1", "o-1-i-2"]])
    expect(storeOrder("o-1")).toBeUndefined()
  })

  it("keeps the DOMICILIO banner and marks the delivery ready without re-reading the deliveries", async () => {
    env.deliveries = [
      { delivery: { orderId: "d-1", status: "preparing", customerName: "Ana", fee: 3000 }, isPaid: false, order: { total: 100 } },
    ]
    env.kitchenRows = [
      row("d-1", { orderType: "delivery", tableId: null, items: [{ ...item("d-1-i-1"), name: "Combo" }] }),
    ]
    const { queryClient } = renderKitchen()

    expect(await screen.findByText("Combo")).toBeInTheDocument()
    expect(screen.getByText("DOMICILIO")).toBeInTheDocument()
    expect(screen.getByText("DOMICILIO · Ana")).toBeInTheDocument()
    // No "Mesa ?" / "Mesa N" heading for a delivery (domicilios S14).
    expect(screen.queryByText("Mesa ?")).toBeNull()
    expect(screen.queryByText(/^Mesa \d/)).toBeNull()

    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    await act(async () => {
      screen.getAllByRole("button", { name: "Entregar" })[0].click()
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
      screen.getAllByRole("button", { name: "Entregar" })[0].click()
    })

    expect(env.setDeliveryStatusCalls).toEqual([])
    expect(env.toasts.map((t) => t.description)).toContain("Todos los productos fueron entregados.")
  })
})
