import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * H-057 (odd/tasks/qa-noviembre-2026.md T14, S4) — the kitchen marks each line
 * "En preparación" or "Listo" from the ticket rail; the ticket stays on the
 * board, and serving keeps its old path.
 */

const served = vi.hoisted(() => vi.fn())
const stepped = vi.hoisted(() => vi.fn())
const stepFails = vi.hoisted(() => ({ value: false }))
const toasts = vi.hoisted(() => [] as { title?: unknown; description?: unknown; variant?: unknown }[])
const listStations = vi.hoisted(() => vi.fn())

const line = (id: string, name: string, stationId: string | null) => ({
  id, orderId: "o-1", dishId: null, name, price: 1000, quantity: 1, comments: null, status: "kitchen",
  stationId, stationSource: stationId ? "category" : null, addedAt: "2026-10-07T10:00:00.000Z", createdAt: null, updatedAt: null,
})
const order = () => ({
  id: "o-1", orderNumber: 7, guests: null, notes: null, tableId: "t-8", orderType: "dine_in", status: "kitchen",
  subtotal: 3000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 3000, totalDiscounts: 0, waiterId: "w-1",
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), updatedAt: null, isPartialOrder: false, parentOrderId: null,
  items: [line("i-1", "Bandeja paisa", "k"), line("i-2", "Jugo de lulo", "b"), line("i-3", "Ajiaco", "k")],
})

vi.mock("@/lib/api/client", () => ({
  api: {
    GET: async (path: string) => {
      if (path === "/api/orders") return { data: [order()] }
      throw new Error(`unexpected GET ${path}`)
    },
    POST: async (path: string, init: { params: { path: { id: string } }; body: { itemIds: string[]; kitchenStatus?: string } }) => {
      if (path === "/api/orders/{id}/items/kitchen-status") {
        stepped(init.body.itemIds, init.body.kitchenStatus)
        if (stepFails.value) throw new Error("boom")
        const rest = order().items.map((item) =>
          init.body.itemIds.includes(item.id) ? { ...item, kitchenStatus: init.body.kitchenStatus } : item,
        )
        return { data: { ...order(), items: rest } }
      }
      served(init.body.itemIds)
      const rest = order().items.map((item) => (init.body.itemIds.includes(item.id) ? { ...item, status: "served" } : item))
      return { data: { ...order(), items: rest } }
    },
  },
  onSessionRefreshed: () => () => {},
}))
vi.mock("@/lib/api/stations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/stations")>()),
  listStations,
}))
vi.mock("@/lib/api/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/delivery")>()),
  listActiveDeliveries: async () => [],
}))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToKitchen: () => () => {},
    subscribeToOrders: () => () => {},
    subscribeToTables: () => () => {},
    subscribeToDeliveries: () => () => {},
    registerItems: vi.fn(),
    unregisterItem: vi.fn(),
    unregisterOrder: vi.fn(),
    markLocalItemChanges: vi.fn(),
    unmarkLocalItemChanges: vi.fn(),
  },
}))
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (input: { title?: unknown; description?: unknown }) => toasts.push(input) }),
}))
vi.mock("@/components/layout/Header", () => ({ Header: ({ title }: { title?: string }) => <h1>{title}</h1> }))

import { KitchenView } from "@/components/views/KitchenView"
import { KITCHEN_STATION_KEY } from "@/lib/kitchen/stations"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"

const st = (id: string, name: string, kind = "prep") => ({
  id, name, kind, color: "kitchen", sortOrder: 0, isDefault: id === "k", createdAt: "2026-11-07T11:00:00.000Z", updatedAt: "2026-11-07T11:00:00.000Z",
})

function renderKitchen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <KitchenView profile={{ id: "kitchen-1", name: "Cocina", role: "kitchen" }} onChangeProfile={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  served.mockReset()
  stepped.mockReset()
  stepFails.value = false
  toasts.length = 0
  listStations.mockReset().mockResolvedValue([])
  useOrderStore.setState({ orders: [] })
  useTableStore.setState({ tables: [{ id: "t-8", number: 8, status: "kitchen" } as never], activeTable: null })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter" }] })
})

describe("KitchenView — kitchen steps per line (H-057)", () => {
  it("Preparar then Listo update the line on the ticket, which stays on the board", async () => {
    renderKitchen()
    fireEvent.click(await screen.findByRole("button", { name: "Marcar en preparación 1 Ajiaco" }))
    await waitFor(() => expect(stepped).toHaveBeenCalledWith(["i-3"], "preparing"))
    const listo = await screen.findByRole("button", { name: "Marcar listo 1 Ajiaco" })
    expect(screen.getByText("En preparación")).toBeInTheDocument()
    fireEvent.click(listo)
    await waitFor(() => expect(stepped).toHaveBeenLastCalledWith(["i-3"], "ready"))
    await waitFor(() => expect(screen.queryByRole("button", { name: /Marcar .* Ajiaco/ })).not.toBeInTheDocument())
    expect(screen.getByText("Listo")).toBeInTheDocument()
    expect(screen.getByText("Bandeja paisa")).toBeInTheDocument()
    expect(useOrderStore.getState().orders.find((o) => o.id === "o-1")?.status).toBe("kitchen")
    expect(served).not.toHaveBeenCalled()
    // No toast for a step: the kitchen sees it on the ticket, nobody else is notified.
    expect(toasts).toEqual([])
  })

  it("a failed step says so and leaves the line pending", async () => {
    stepFails.value = true
    renderKitchen()
    fireEvent.click(await screen.findByRole("button", { name: "Marcar en preparación 1 Ajiaco" }))
    await waitFor(() =>
      expect(toasts).toEqual([
        { title: "Error", description: "No se pudo marcar el plato. Inténtalo de nuevo.", variant: "destructive" },
      ]),
    )
    expect(screen.getByRole("button", { name: "Marcar en preparación 1 Ajiaco" })).toBeInTheDocument()
  })

  it("the ✓ still serves one line through the old endpoint", async () => {
    renderKitchen()
    fireEvent.click(await screen.findByRole("button", { name: "Entregar 1 Ajiaco" }))
    await waitFor(() => expect(served).toHaveBeenCalledWith(["i-3"]))
    expect(stepped).not.toHaveBeenCalled()
  })
})
