import { act, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// `InvoicePrintView` pulls `lib/supabase/realtime-service` (and the stores pull
// the `lib/supabase` barrel), both of which reach the browser client. Stub it at
// the lowest level so neither needs a configured environment.
vi.mock("@/lib/supabase/client", () => ({
  supabase: {},
  createSupabaseClient: () => ({}),
}))

const getOrdersByDate = vi.fn()
vi.mock("@/lib/supabase/service", () => ({
  getOrdersByDate: (...args: unknown[]) => getOrdersByDate(...args),
}))

const listPaymentMethods = vi.fn()
vi.mock("@/lib/supabase/payments-service", () => ({
  listPaymentMethods: (...args: unknown[]) => listPaymentMethods(...args),
}))

// The toast store renders nothing without a mounted <Toaster/>; the contract
// under test is "a failed read is reported", so assert the dispatch itself.
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => {
  const toast = Object.assign(toastMock, {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  })
  return { useToast: () => ({ toast }), toast }
})

import { QueryClientProvider } from "@tanstack/react-query"
import { queryClient } from "@/lib/queryClient"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"

/**
 * The app's SINGLE query client (`lib/queryClient`), so a remount really hits
 * the same cache the app shares — no test-only client, no false "no refetch".
 */
function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
}

function renderTable(ui: React.ReactElement) {
  return render(wrap(ui))
}

/**
 * T9 (S1/S2) — "Órdenes Completadas" by date.
 *
 * The table kept its rows in `useState` and re-read them from a `useEffect` on
 * `[selectedDate]`, so Radix unmounting the sub-tab (or a re-render with the
 * same date) re-ran the read every time the admin came back to it, and the
 * `isLoading` skeleton replaced the whole table while it did.
 */

const DAY = new Date(2026, 0, 15)

function paidOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-aaaa-4444-8888-000000000001",
    tableId: "t-1",
    waiter: "w-1",
    status: "paid",
    items: [{ id: "i-1", name: "Bandeja", price: 10, quantity: 1, categoryId: "", image: "", status: "served" }],
    bill: {
      subtotal: 10,
      tax: 1,
      taxPercentage: 10,
      tip: 0,
      tipPercentage: 0,
      total: 11,
      totalDiscounts: 0,
    },
    createdAt: new Date(2026, 0, 15, 12, 0),
    ...overrides,
  }
}

beforeEach(() => {
  getOrdersByDate.mockReset()
  listPaymentMethods.mockReset()
  getOrdersByDate.mockResolvedValue([paidOrder()])
  listPaymentMethods.mockResolvedValue([])
  queryClient.clear()
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter", hasPassword: false }] })
  useTableStore.setState({ tables: [{ id: "t-1", number: 3, status: "served" }] })
})

describe("CompletedOrdersTable — one read per date, shared with every revisit", () => {
  it("reads the selected day once and serves the revisit from cache (no second read, no blank)", async () => {
    const first = renderTable(<CompletedOrdersTable selectedDate={DAY} />)
    await waitFor(() => expect(screen.getByText("11111111")).toBeInTheDocument())
    expect(getOrdersByDate).toHaveBeenCalledTimes(1)

    // Radix unmounts the inactive sub-tab: coming back must not re-read.
    first.unmount()
    renderTable(<CompletedOrdersTable selectedDate={DAY} />)

    // Synchronously (no await): the rows are already on screen, so the table is
    // not replaced by skeletons on the way back in.
    expect(screen.getByText("11111111")).toBeInTheDocument()
    expect(getOrdersByDate).toHaveBeenCalledTimes(1)
  })

  it("reads once per distinct date, never once per mount", async () => {
    const { rerender: rawRerender } = renderTable(<CompletedOrdersTable selectedDate={DAY} />)
    const rerender = (ui: React.ReactElement) => rawRerender(wrap(ui))
    await waitFor(() => expect(screen.getByText("11111111")).toBeInTheDocument())

    getOrdersByDate.mockResolvedValue([paidOrder({ id: "22222222-bbbb-4444-8888-000000000002" })])
    rerender(<CompletedOrdersTable selectedDate={new Date(2026, 0, 16)} />)

    await waitFor(() => expect(screen.getByText("22222222")).toBeInTheDocument())
    expect(getOrdersByDate).toHaveBeenCalledTimes(2)
    expect(getOrdersByDate.mock.calls[1][0]).toEqual(new Date(2026, 0, 16))

    // Re-rendering with the SAME date (a parent re-render) issues nothing.
    rerender(<CompletedOrdersTable selectedDate={new Date(2026, 0, 16)} />)
    expect(getOrdersByDate).toHaveBeenCalledTimes(2)
  })

  it("re-reads the same day when the admin presses Actualizar", async () => {
    renderTable(<CompletedOrdersTable selectedDate={DAY} />)
    await waitFor(() => expect(screen.getByText("11111111")).toBeInTheDocument())

    await act(async () => {
      screen.getByRole("button", { name: /Actualizar/i }).click()
    })

    await waitFor(() => expect(getOrdersByDate).toHaveBeenCalledTimes(2))
  })

  it("keeps showing the previous day while a new date is loading (no blanking flash)", async () => {
    let resolveSecond: (orders: unknown[]) => void = () => {}
    getOrdersByDate.mockImplementation((date: Date) =>
      date.getDate() === 15
        ? Promise.resolve([paidOrder()])
        : new Promise<unknown[]>((resolve) => {
            resolveSecond = resolve
          }),
    )

    const { rerender: rawRerender } = renderTable(<CompletedOrdersTable selectedDate={DAY} />)
    const rerender = (ui: React.ReactElement) => rawRerender(wrap(ui))
    await waitFor(() => expect(screen.getByText("11111111")).toBeInTheDocument())

    rerender(<CompletedOrdersTable selectedDate={new Date(2026, 0, 16)} />)
    expect(screen.getByText("11111111")).toBeInTheDocument()

    await act(async () => {
      resolveSecond([paidOrder({ id: "33333333-cccc-4444-8888-000000000003" })])
    })
    await waitFor(() => expect(screen.getByText("33333333")).toBeInTheDocument())
  })

  it("reports a failed read instead of showing an empty table as if there were no orders", async () => {
    getOrdersByDate.mockRejectedValue(new Error("boom"))

    renderTable(<CompletedOrdersTable selectedDate={DAY} />)

    await waitFor(
      () =>
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Error",
            description: "No se pudieron cargar las órdenes de la base de datos",
            variant: "destructive",
          }),
        ),
      // The shared client retries twice before it reports the failure.
      { timeout: 8_000 },
    )
    // No skeleton left behind, and no phantom "no hay órdenes" claim.
    expect(screen.getByText(/No hay órdenes completadas para esta fecha/)).toBeInTheDocument()
  })

  it("still reprints a delivery order as DOMICILIO (odd/tasks/domicilios.md S14)", async () => {
    getOrdersByDate.mockResolvedValue([paidOrder({ orderType: "delivery", tableId: "" })])

    renderTable(<CompletedOrdersTable selectedDate={DAY} />)
    await waitFor(() => expect(screen.getByText("11111111")).toBeInTheDocument())

    await act(async () => {
      screen.getByRole("button", { name: /Factura/i }).click()
    })

    await waitFor(() => expect(screen.getByText("Mesa:")).toBeInTheDocument())
    expect(screen.getByText("Mesa:").nextElementSibling).toHaveTextContent("DOMICILIO")
  })
})