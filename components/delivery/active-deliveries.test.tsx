import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T10 (S1/S2) — `useActiveDeliveries` is read by three consumers: the
 * delivery operator board (`DeliveryBoard`), the cashier panel
 * (`DeliveryPaymentsPanel`) and the kitchen screen (`KitchenView`).
 *
 * Before this task the hook built a FRESH channel per consumer, subscribed to
 * `orders` with no filter, and invalidated the whole `active-deliveries` query
 * on every push. In a live restaurant `orders` gets a write for every table
 * order, so each table interaction refetched the whole delivery board and each
 * consumer owned its own duplicate channel — the "the screen loads again"
 * symptom (S2) plus N× the realtime fan-out.
 *
 * These tests drive the hook through its public interface and count service
 * calls: the observable effect of a realtime push.
 */

type Handler = (payload: unknown) => void

const harness = vi.hoisted(() => {
  const recorded: Array<{
    name: string
    tables: string[]
    handlers: Array<{ table: string; handler: Handler }>
    subscribed: boolean
  }> = []
  const removed: string[] = []

  const emit = (table: string, payload: unknown) => {
    for (const channel of recorded) {
      if (!channel.subscribed) continue
      for (const entry of channel.handlers) {
        if (entry.table === table) entry.handler(payload)
      }
    }
  }

  const supabase = {
    channel: (name: string) => {
      const record = { name, tables: [] as string[], handlers: [] as Array<{ table: string; handler: Handler }>, subscribed: false }
      recorded.push(record)
      const api = {
        on: (_type: string, filter: { table: string }, handler: Handler) => {
          record.tables.push(filter.table)
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
    removeChannel: (channel: { __name?: string }) => {
      removed.push(channel.__name ?? "?")
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  }

  return { recorded, removed, emit, supabase }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: harness.supabase,
  createSupabaseClient: () => ({}),
}))

const listActiveDeliveries = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, listActiveDeliveries }
})

import { useActiveDeliveries } from "@/hooks/use-active-deliveries"
import { parseOrderDeliveryRow } from "@/lib/delivery/parse"
import type { DeliveryOrder } from "@/lib/delivery/types"

function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "d-1",
    customer_id: "c-1",
    customer_name: "Ana Ruiz",
    customer_phone: "3101234567",
    address_line: "Calle 5 # 10-20",
    neighborhood: "Lacentro",
    address_reference: "Timbre 2",
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

function delivery(overrides: Record<string, unknown> = {}): DeliveryOrder {
  return parseOrderDeliveryRow(wireRow(overrides))
}

function row(overrides: Record<string, unknown> = {}) {
  return { delivery: delivery(overrides), amountDue: 19_000, subtotal: 19_000, tax: 0, isPaid: false }
}

function Consumer({ label }: { label: string }) {
  const { data = [], isLoading } = useActiveDeliveries()
  if (isLoading) return <div data-testid={label}>loading</div>
  return (
    <div data-testid={label}>
      {data.map((r) => `${r.delivery.orderId}:${r.delivery.status}`).join(",") || "empty"}
    </div>
  )
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  })
}

function renderWith(client: QueryClient, ui: React.ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  harness.recorded.length = 0
  harness.removed.length = 0
  listActiveDeliveries.mockReset()
  listActiveDeliveries.mockResolvedValue([row()])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useActiveDeliveries — realtime fan-out", () => {
  it("opens ONE channel for every consumer (board + cashier panel + kitchen)", async () => {
    const client = makeClient()
    renderWith(
      client,
      <>
        <Consumer label="board" />
        <Consumer label="panel" />
        <Consumer label="kitchen" />
      </>,
    )

    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))

    expect(harness.recorded).toHaveLength(1)
    expect(harness.recorded[0]!.tables).toEqual(["order_deliveries", "orders"])
  })

  it("ignores `orders` pushes from table (dine-in) orders", async () => {
    const client = makeClient()
    renderWith(client, <Consumer label="board" />)
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    harness.emit("orders", { eventType: "UPDATE", new: { id: "o-1", order_type: "dine_in" } })
    await sleep(250)

    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)
  })

  it("coalesces a burst of delivery `orders` pushes into ONE refetch", async () => {
    const client = makeClient()
    renderWith(client, <Consumer label="board" />)
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    // Three pushes spread over ~80 ms: every one is a real change the board
    // must show, but they belong to the same burst.
    harness.emit("orders", { eventType: "UPDATE", new: { id: "d-1", order_type: "delivery" } })
    await sleep(40)
    harness.emit("orders", { eventType: "UPDATE", new: { id: "d-1", order_type: "delivery" } })
    await sleep(40)
    harness.emit("orders", { eventType: "UPDATE", new: { id: "d-1", order_type: "delivery" } })

    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(2))
    await sleep(250)
    expect(listActiveDeliveries).toHaveBeenCalledTimes(2)
  })

  it("merges an `order_deliveries` push into the cache without refetching", async () => {
    const client = makeClient()
    renderWith(client, <Consumer label="board" />)
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)

    harness.emit("order_deliveries", {
      eventType: "UPDATE",
      new: wireRow({ delivery_status: "preparing", updated_at: "2026-10-07T10:05:00.000Z" }),
    })

    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:preparing"))
    await sleep(250)
    expect(listActiveDeliveries).toHaveBeenCalledTimes(1)
  })

  it("refetches once when the push is a delivery the board has never seen", async () => {
    const client = makeClient()
    renderWith(client, <Consumer label="board" />)
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))

    harness.emit("order_deliveries", { eventType: "INSERT", new: wireRow({ order_id: "d-2" }) })

    await waitFor(() => expect(listActiveDeliveries).toHaveBeenCalledTimes(2))
    await sleep(250)
    expect(listActiveDeliveries).toHaveBeenCalledTimes(2)
  })

  it("tears the shared channel down when the last consumer unmounts", async () => {
    const client = makeClient()
    const view = renderWith(
      client,
      <>
        <Consumer label="board" />
        <Consumer label="panel" />
      </>,
    )
    await waitFor(() => expect(screen.getByTestId("board")).toHaveTextContent("d-1:received"))
    expect(harness.removed).toHaveLength(0)

    view.unmount()

    expect(harness.removed).toEqual([harness.recorded[0]!.name])
  })
})