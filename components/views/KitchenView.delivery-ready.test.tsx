import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T10 review B1 — the kitchen's "mark this delivery ready" path.
 *
 * `markDeliveryReady` read the `active-deliveries` cache BEFORE awaiting
 * `set_delivery_status` and wrote the merged list back from that snapshot. Any
 * `order_deliveries` push that landed while the RPC was in flight (another
 * delivery moving, another operator, a reconnect burst) was silently reverted
 * by that write, and nothing refetched afterwards, so the board stayed wrong
 * until the next unrelated event.
 *
 * The regression is driven through the real component: render the kitchen, mark
 * the single kitchen item of delivery A as delivered, and let the mocked RPC
 * move delivery B in the cache mid-flight (exactly what a realtime push does).
 * Both moves must survive.
 */

const harness = vi.hoisted(() => {
  type Handler = (payload: unknown) => void
  const recorded: Array<{
    name: string
    handlers: Array<{ table: string; handler: Handler }>
    subscribed: boolean
  }> = []

  const emit = (table: string, payload: unknown) => {
    for (const channel of recorded) {
      if (!channel.subscribed) continue
      for (const entry of channel.handlers) {
        if (entry.table === table) entry.handler(payload)
      }
    }
  }

  // `order_items.update(...).eq(...)` and `.in(...)`: thenable, no error.
  const updated = { error: null, then: (resolve: (v: unknown) => void) => resolve({ error: null }) }

  const supabase = {
    channel: (name: string) => {
      const record = { name, handlers: [] as Array<{ table: string; handler: Handler }>, subscribed: false }
      recorded.push(record)
      const api = {
        on: (_type: string, filter: { table: string }, handler: Handler) => {
          record.handlers.push({ table: filter.table, handler })
          return api
        },
        subscribe: () => {
          record.subscribed = true
          return api
        },
        __name: name,
      }
      return api
    },
    removeChannel: () => {},
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: () => updated, in: () => updated }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }

  return { recorded, emit, supabase }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: harness.supabase,
  createSupabaseClient: () => ({}),
}))

const getByStatus = vi.hoisted(() => vi.fn())
const getById = vi.hoisted(() => vi.fn())
const updateStatus = vi.hoisted(() => vi.fn())
const getAllTables = vi.hoisted(() => vi.fn())
const listActiveDeliveries = vi.hoisted(() => vi.fn())
const setDeliveryStatus = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/service", () => ({
  orderService: {
    getByStatus: (status: string | string[]) => getByStatus(status),
    getById: (id: string) => getById(id),
    updateStatus: (id: string, status: string) => updateStatus(id, status),
  },
  tableService: { getAll: () => getAllTables() },
  categoryService: { getAllActive: async () => [] },
}))

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, listActiveDeliveries, setDeliveryStatus }
})

vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: {
    subscribeToKitchen: () => () => {},
    subscribeToOrders: () => () => {},
    subscribeToTables: () => () => {},
    registerItems: vi.fn(),
    unregisterItem: vi.fn(),
    unregisterOrder: vi.fn(),
    markLocalItemChanges: vi.fn(),
    unmarkLocalItemChanges: vi.fn(),
    sendCommand: vi.fn(),
    sendFactura: vi.fn(),
  },
}))

vi.mock("@/components/layout/Header", () => ({
  Header: ({ title }: { title?: string }) => <h1>{title}</h1>,
}))

import { KitchenView } from "@/components/views/KitchenView"
import { activeDeliveriesQueryKey } from "@/hooks/use-active-deliveries"
import { useOrderStore } from "@/store/useOrderStore"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { parseOrderDeliveryRow } from "@/lib/delivery/parse"
import type { DeliveryOrderWithBill } from "@/lib/supabase/delivery-service"
import type { Profile } from "@/types"

function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "d-1",
    customer_id: "c-1",
    customer_name: "Ana Ruiz",
    customer_phone: "3101234567",
    address_line: "Calle 5 # 10-20",
    neighborhood: "Lacentro",
    address_reference: null,
    delivery_fee: 3000,
    payment_mode: "cash_on_delivery",
    cash_change_for: null,
    courier_id: null,
    delivery_status: "received",
    failure_reason: null,
    notes: null,
    dispatched_at: null,
    delivered_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: "2026-10-07T10:00:00.000Z",
    updated_at: "2026-10-07T10:00:00.000Z",
    ...overrides,
  }
}

function boardRow(overrides: Record<string, unknown> = {}) {
  return {
    delivery: parseOrderDeliveryRow(wireRow(overrides)),
    amountDue: 19_000,
    subtotal: 19_000,
    tax: 0,
    isPaid: false,
  }
}

/** A delivery in the kitchen queue, with the single item that ends the flow. */
function kitchenOrderRow() {
  return {
    id: "d-1",
    table_id: null,
    order_type: "delivery",
    status: "kitchen",
    subtotal: 19_000,
    tax: 0,
    tax_percentage: 0,
    tip: 0,
    tip_percentage: 0,
    total: 19_000,
    total_discounts: 0,
    waiter_id: "w-1",
    created_at: "2026-10-07T10:00:00.000Z",
    is_partial_order: false,
    parent_order_id: null,
    order_items: [
      {
        id: "oi-1",
        name: "Bandeja paisa",
        price: 19_000,
        quantity: 1,
        comments: null,
        status: "kitchen",
        added_at: "2026-10-07T10:00:00.000Z",
      },
    ],
  }
}

const profile: Profile = { id: "kitchen-1", name: "Cocina", role: "kitchen", hasPassword: false }

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

function statusOf(cache: DeliveryOrderWithBill[], orderId: string): string | undefined {
  return cache.find((r) => r.delivery.orderId === orderId)?.delivery.status
}

beforeEach(() => {
  harness.recorded.length = 0
  getByStatus.mockReset()
  getById.mockReset()
  updateStatus.mockReset()
  getAllTables.mockReset()
  listActiveDeliveries.mockReset()
  setDeliveryStatus.mockReset()

  getByStatus.mockResolvedValue([kitchenOrderRow()])
  updateStatus.mockResolvedValue(undefined)
  getAllTables.mockResolvedValue([])
  listActiveDeliveries.mockResolvedValue([boardRow(), boardRow({ order_id: "d-2" })])

  useOrderStore.setState({ orders: [] })
  useTableStore.setState({ tables: [], activeTable: null })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter", hasPassword: false }] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("KitchenView — marking a delivery ready", () => {
  it("keeps the moves that landed while set_delivery_status was in flight", async () => {
    const client = makeClient()
    // Delivery A is in `preparing`, so `shouldMarkDeliveryReady` allows the
    // transition; B is a second delivery on the same board.
    listActiveDeliveries.mockResolvedValue([
      boardRow({ delivery_status: "preparing", updated_at: "2026-10-07T10:00:00.000Z" }),
      boardRow({ order_id: "d-2", updated_at: "2026-10-07T10:00:00.000Z" }),
    ])

    // Mid-flight: delivery B is dispatched by the operator (this is what the
    // `order_deliveries` push does to the same cache entry).
    setDeliveryStatus.mockImplementation(async (input: { orderId: string }) => {
      const cache = client.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      client.setQueryData(
        activeDeliveriesQueryKey,
        cache.map((row) =>
          row.delivery.orderId === "d-2"
            ? {
                ...row,
                delivery: parseOrderDeliveryRow(
                  wireRow({
                    order_id: "d-2",
                    delivery_status: "out_for_delivery",
                    courier_id: "k-1",
                    dispatched_at: "2026-10-07T10:06:00.000Z",
                    updated_at: "2026-10-07T10:06:00.000Z",
                  }),
                ),
              }
            : row,
        ),
      )
      return parseOrderDeliveryRow(
        wireRow({
          order_id: input.orderId,
          delivery_status: "ready",
          updated_at: "2026-10-07T10:06:00.000Z",
        }),
      )
    })

    render(
      <QueryClientProvider client={client}>
        <KitchenView profile={profile} onChangeProfile={() => {}} authRole="kitchen" />
      </QueryClientProvider>,
    )
    await screen.findByText("Bandeja paisa")

    fireEvent.click(screen.getAllByRole("button", { name: /Entregar/ })[0]!)

    await waitFor(() => expect(setDeliveryStatus).toHaveBeenCalledTimes(1))
    expect(setDeliveryStatus).toHaveBeenCalledWith({ orderId: "d-1", action: "mark_ready" })

    await waitFor(() => {
      const cache = client.getQueryData<DeliveryOrderWithBill[]>(activeDeliveriesQueryKey) ?? []
      expect(statusOf(cache, "d-1")).toBe("ready")
      expect(statusOf(cache, "d-2")).toBe("out_for_delivery")
    })
  })

  it("still re-reads the board when the cache does not know the delivery", async () => {
    const client = makeClient()
    listActiveDeliveries.mockResolvedValue([
      boardRow({ delivery_status: "preparing", updated_at: "2026-10-07T10:00:00.000Z" }),
    ])
    setDeliveryStatus.mockResolvedValue(
      parseOrderDeliveryRow(
        wireRow({ delivery_status: "ready", updated_at: "2026-10-07T10:06:00.000Z" }),
      ),
    )

    render(
      <QueryClientProvider client={client}>
        <KitchenView profile={profile} onChangeProfile={() => {}} authRole="kitchen" />
      </QueryClientProvider>,
    )
    await screen.findByText("Bandeja paisa")
    const callsAfterMount = listActiveDeliveries.mock.calls.length

    // Empty the cache the way a navigation/unmount would: the guard must not
    // fire a transition for a status it cannot see.
    client.setQueryData(activeDeliveriesQueryKey, [])
    fireEvent.click(screen.getAllByRole("button", { name: /Entregar/ })[0]!)

    await waitFor(() => expect(listActiveDeliveries.mock.calls.length).toBeGreaterThan(callsAfterMount))
    await waitFor(() => expect(setDeliveryStatus).toHaveBeenCalledTimes(1))
  })
})