import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { queryClient } from "@/lib/queryClient"

/**
 * T9 (S1/S2) — the admin panel's two request-shaped behaviours.
 *
 * `ActiveOrdersGrid` is exported so the two invariants the audit flagged can be
 * pinned without the whole panel:
 *   - a REFRESH (isFetching, data already on screen) must not replace the grid
 *     with skeletons ("skeletons on refresh");
 *   - the "new order" pulse must be a function of the data and the clock, so a
 *     card that rendered inside the 30 s window stops pulsing instead of
 *     pulsing forever.
 */

type Call = { table: string; method: string; args: unknown[] }

const state = vi.hoisted(() => {
  const calls: Call[] = []
  const results: Record<string, { data: unknown; error: unknown }> = {}
  type OrderSubscriber = (payload: unknown) => void
  const realtime: { subscribeToOrders: OrderSubscriber | null } = { subscribeToOrders: null }
  /** T8b: the active orders and the delete go through the API client. */
  const apiCalls: { method: string; path: string; init?: any }[] = []
  const api = { orders: [] as unknown[], deleteError: null as unknown }

  const makeChain = (table: string): any => {
    const chain: any = {}
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args })
        return chain
      }
    for (const method of [
      "select",
      "in",
      "eq",
      "gte",
      "lte",
      "order",
      "limit",
      "not",
      "single",
      "maybeSingle",
    ]) {
      chain[method] = record(method)
    }
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
    return chain
  }

  return { calls, results, realtime, makeChain, apiCalls, api }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: (table: string) => state.makeChain(table) },
  createSupabaseClient: () => ({ from: (table: string) => state.makeChain(table) }),
}))

vi.mock("@/lib/api/client", () => ({
  api: {
    GET: async (path: string, init?: any) => {
      state.apiCalls.push({ method: "GET", path, init })
      if (path === "/api/orders") return { data: state.api.orders }
      throw new Error(`unexpected GET ${path}`)
    },
    DELETE: async (path: string, init?: any) => {
      state.apiCalls.push({ method: "DELETE", path, init })
      if (state.api.deleteError) throw state.api.deleteError
      return { data: undefined }
    },
  },
  onSessionRefreshed: () => () => {},
}))

vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToOrders: (cb: (payload: unknown) => void) => {
      state.realtime.subscribeToOrders = cb
      return () => {}
    },
    subscribeToTables: () => () => {},
  },
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

// The panel renders every other admin screen inside its tabs; they are covered
// by their own suites, so they are stubbed here to keep this one about the
// panel's own reads.
vi.mock("@/components/admin/tables/TableManagementPanel", () => ({ TableManagementPanel: () => null }))
vi.mock("@/components/admin/payment-methods/PaymentMethodsManager", () => ({
  PaymentMethodsManager: () => null,
}))
vi.mock("@/components/admin/couriers/CouriersManager", () => ({ CouriersManager: () => null }))
vi.mock("@/components/admin/couriers/DeliveryFeeSetting", () => ({ DeliveryFeeSetting: () => null }))
vi.mock("@/components/admin/menu/CategoryList", () => ({ CategoryList: () => null }))
vi.mock("@/components/admin/menu/DishList", () => ({ DishList: () => null }))
vi.mock("@/components/admin/promotions/PromotionList", () => ({ PromotionList: () => null }))
vi.mock("@/components/admin/staff/WaiterList", () => ({ WaiterList: () => null }))
vi.mock("@/components/admin/CompletedOrdersTable", () => ({ CompletedOrdersTable: () => null }))
vi.mock("@/components/admin/CashRegisterSummary", () => ({ CashRegisterSummary: () => null }))
vi.mock("@/components/admin/TransactionsByRegisterId", () => ({ TransactionsByRegisterId: () => null }))
vi.mock("@/components/cashier/RegisterHistoryTable", () => ({ RegisterHistoryTable: () => null }))
vi.mock("@/components/cashier/CashRegisterStatus", () => ({ CashRegisterStatus: () => null }))
// Recharts cannot measure a layout in jsdom; the dashboard charts are
// presentation only and have their own data contract.
vi.mock("@/components/admin/SalesChart", () => ({ SalesChart: () => null }))
vi.mock("@/components/admin/PopularDishesChart", () => ({ PopularDishesChart: () => null }))

import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { ActiveOrdersGrid, AdminView } from "./AdminView"
import type { Order } from "@/types"

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

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

/** Opens an admin section through its sidebar entry. */
async function openSection(id: string) {
  const entry = await screen.findByTestId(`nav-${id}`)
  await act(async () => {
    fireEvent.click(entry)
  })
}

beforeEach(() => {
  window.location.hash = ""
  queryClient.clear()
  state.calls.length = 0
  state.realtime.subscribeToOrders = null
  state.apiCalls.length = 0
  state.api.orders = []
  state.api.deleteError = null
  for (const key of Object.keys(state.results)) delete state.results[key]
  useOrderStore.setState({ orders: [] })
  useProfileStore.setState({ profiles: [] })
  useTableStore.setState({ tables: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ActiveOrdersGrid", () => {
  it("shows skeletons only before the first data arrives", () => {
    const { rerender } = render(
      wrap(<ActiveOrdersGrid orders={[]} isLoading onDelete={() => {}} onRefresh={() => {}} />),
    )

    expect(screen.getByTestId("admin-orders-skeleton")).toBeInTheDocument()

    rerender(
      wrap(<ActiveOrdersGrid orders={[order({ id: "o-1" })]} isLoading onDelete={() => {}} onRefresh={() => {}} />),
    )

    expect(screen.getByTestId("admin-order-o-1")).toBeInTheDocument()
  })

  it("keeps the cards on screen while a refresh is in flight (no blanking)", () => {
    render(
      wrap(
        <ActiveOrdersGrid
          orders={[order({ id: "o-1" }), order({ id: "o-2" })]}
          isLoading={false}
          onDelete={() => {}}
          onRefresh={() => {}}
        />,
      ),
    )

    // A refetch re-renders with the same list; the grid must not be replaced by
    // the first-load skeleton (the old `loadingActiveOrders ? skeletons : grid`).
    expect(screen.getByTestId("admin-order-o-1")).toBeInTheDocument()
    expect(screen.getByTestId("admin-order-o-2")).toBeInTheDocument()
  })

  it("pulse: a fresh order pulses, an old one does not, and the fresh one stops when the clock passes the window", () => {
    vi.useFakeTimers()
    const now = new Date("2026-01-01T12:00:00.000Z").getTime()
    vi.setSystemTime(now)

    const orders = [order({ id: "fresh", createdAt: new Date(now - 5_000) }), order({ id: "old" })]
    render(wrap(<ActiveOrdersGrid orders={orders} isLoading={false} onDelete={() => {}} onRefresh={() => {}} />))

    expect(screen.getByTestId("admin-order-fresh")).toHaveClass("animate-pulse-light")
    expect(screen.getByTestId("admin-order-old")).not.toHaveClass("animate-pulse-light")

    // Well past the 30 s window the pulsing card must stop pulsing. With the
    // old `new Date()`-per-render check this re-render would still pulse.
    act(() => {
      vi.setSystemTime(now + 60_000)
      vi.advanceTimersByTime(11_000)
    })

    expect(screen.getByTestId("admin-order-fresh")).not.toHaveClass("animate-pulse-light")
    expect(screen.getByTestId("admin-order-old")).not.toHaveClass("animate-pulse-light")
  })

  it("labels a delivery order as DOMICILIO, never Mesa ? (odd/tasks/domicilios.md S14)", () => {
    render(
      wrap(
        <ActiveOrdersGrid
          orders={[order({ id: "d-1", orderType: "delivery", tableId: "" })]}
          isLoading={false}
          onDelete={() => {}}
          onRefresh={() => {}}
        />,
      ),
    )

    expect(screen.getByTestId("admin-order-d-1")).toHaveTextContent("DOMICILIO")
    expect(screen.getByTestId("admin-order-d-1")).not.toHaveTextContent("Mesa ?")
  })

  it("offers the empty-state refresh when there is nothing to show", async () => {
    const onRefresh = vi.fn()
    render(wrap(<ActiveOrdersGrid orders={[]} isLoading={false} onDelete={() => {}} onRefresh={onRefresh} />))

    expect(screen.getByText("No hay órdenes activas en este momento")).toBeInTheDocument()
    await act(async () => {
      screen.getByRole("button", { name: /Verificar nuevamente/i }).click()
    })
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe("AdminView — requests issued while a tab is open", () => {
  const profile = { id: "p-1", name: "Admin", role: "admin" as const }

  function tableOf(state: Call[]) {
    return state.map((call) => `${call.table}.${call.method}`)
  }

  it("reads the dashboard only (four parallel reads + the low-stock alert), and nothing for the closed tabs", async () => {
    render(wrap(<AdminView profile={profile} onChangeProfile={() => {}} authRole="admin" />))

    await waitFor(() => expect(screen.getByText("Ventas del Mes")).toBeInTheDocument())

    // The dashboard's four reads.
    // Ventas del mes + Cocina: one `status` read each (Ventas del Mes and the
    // 30-day series both filter `paid`), and no `tables` / `profiles` read.
    const ordersReads = state.calls.filter(
      (call) => call.table === "orders" && call.method === "eq" && call.args[0] === "status",
    )
    expect(ordersReads.map((call) => call.args[1]).sort()).toEqual(["kitchen", "paid", "paid"])
    expect(tableOf(state.calls)).toContain("order_items.select")
    // The low-stock alert on the dashboard shares the ingredient read.
    expect(tableOf(state.calls)).toContain("ingredients.select")
    // Nothing for the tabs that are closed.
    expect(state.calls.some((call) => call.table === "categories")).toBe(false)
    expect(state.calls.some((call) => call.table === "profiles")).toBe(false)
    expect(state.calls.some((call) => call.table === "cash_registers")).toBe(false)
  })

  it("reads the active orders when the Órdenes tab is opened, and not before", async () => {
    render(wrap(<AdminView profile={profile} onChangeProfile={() => {}} authRole="admin" />))
    await waitFor(() => expect(screen.getByText("Ventas del Mes")).toBeInTheDocument())
    expect(state.apiCalls.some((call) => call.path === "/api/orders")).toBe(false)

    await openSection("orders")

    await waitFor(() => expect(state.apiCalls.some((call) => call.path === "/api/orders")).toBe(true))
    // ONE read of the active statuses, with the table and waiter names.
    const reads = state.apiCalls.filter((call) => call.path === "/api/orders")
    expect(reads).toHaveLength(1)
    expect(reads[0].init).toEqual({ params: { query: { status: "active,kitchen,delivered", include: "table,waiter" } } })
    expect(state.calls.some((call) => call.table === "orders" && call.method === "in")).toBe(false)
  })

  it("re-reads the active orders exactly once per refresh click", async () => {
    render(wrap(<AdminView profile={profile} onChangeProfile={() => {}} authRole="admin" />))
    await waitFor(() => expect(screen.getByText("Ventas del Mes")).toBeInTheDocument())

    await openSection("orders")
    await waitFor(() => expect(state.apiCalls.filter((call) => call.path === "/api/orders")).toHaveLength(1))

    await act(async () => {
      screen.getByRole("button", { name: /^Actualizar$/ }).click()
    })

    // One click = ONE request on the active statuses (no store `loadOrders` behind it).
    await waitFor(() => expect(state.apiCalls.filter((call) => call.path === "/api/orders")).toHaveLength(2))
    expect(state.apiCalls).toHaveLength(2)
    // The manual refresh still reports what it loaded.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Órdenes actualizadas" }),
    )
  })

  it("deletes through DELETE /orders/:id and leaves the table to the server", async () => {
    state.api.orders = [activeOrderDto("o-1")]
    render(wrap(<AdminView profile={profile} onChangeProfile={() => {}} authRole="admin" />))
    await openSection("orders")
    await deleteFromGrid()

    expect(state.apiCalls.filter((call) => call.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/orders/{id}", init: { params: { path: { id: "o-1" } } } },
    ])
    // No client-side table write: the API frees the table in the same transaction.
    expect(state.calls.some((call) => call.table === "tables")).toBe(false)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Orden eliminada" }))
    await waitFor(() => expect(screen.queryByTestId("admin-order-o-1")).toBeNull())
  })

  it("shows the API message when the delete is refused with 409", async () => {
    const { ApiError } = await import("@/lib/api/errors")
    state.api.orders = [activeOrderDto("o-1")]
    state.api.deleteError = new ApiError(409, "Conflict", "Order is paid")
    render(wrap(<AdminView profile={profile} onChangeProfile={() => {}} authRole="admin" />))
    await openSection("orders")
    await deleteFromGrid()

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", description: "Order is paid", variant: "destructive" }),
    )
    expect(screen.getByTestId("admin-order-o-1")).toBeInTheDocument()
  })
})

function activeOrderDto(id: string) {
  return {
    id,
    tableId: "t-1",
    waiterId: "w-1",
    status: "kitchen",
    orderType: "dine_in",
    subtotal: 100,
    tax: 0,
    taxPercentage: 0,
    tip: 0,
    tipPercentage: 0,
    total: 100,
    totalDiscounts: 0,
    isPartialOrder: false,
    parentOrderId: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: null,
    items: [],
    tableNumber: 1,
    waiterName: "Ana",
  }
}

/** "Cancelar Orden" on the card, then "Eliminar" in its confirmation. */
async function deleteFromGrid() {
  const cancel = await screen.findByRole("button", { name: /Cancelar Orden/ })
  await act(async () => {
    fireEvent.click(cancel)
  })
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar" }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
