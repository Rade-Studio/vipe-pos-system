import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F6 (S1 c, S2) — the kitchen screen of one station: "Todas / Cocina /
 * Barra…" filters the tickets to the lines routed to that station, the choice
 * is remembered on this device, and "Entregar toda" serves only that
 * station's lines.
 */

const served = vi.hoisted(() => vi.fn())
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
    POST: async (path: string, init: { params: { path: { id: string } }; body: { itemIds: string[] } }) => {
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
  listStations.mockReset().mockResolvedValue([st("k", "Cocina"), st("b", "Barra"), st("c", "Caja", "cashier")])
  useOrderStore.setState({ orders: [] })
  useTableStore.setState({ tables: [{ id: "t-8", number: 8, status: "kitchen" } as never], activeTable: null })
  useProfileStore.setState({ profiles: [{ id: "w-1", name: "Ana", role: "waiter" }] })
})

describe("KitchenView — station filter", () => {
  it("lists Todas and the prep stations, and filters the tickets to one station", async () => {
    renderKitchen()
    const group = await screen.findByRole("group", { name: "Estación" })
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Todas", "Cocina", "Barra"])
    expect(await screen.findByText("Jugo de lulo")).toBeInTheDocument()
    expect(screen.getByText("Bandeja paisa")).toBeInTheDocument()
    fireEvent.click(within(group).getByRole("button", { name: "Barra" }))
    expect(within(group).getByRole("button", { name: "Barra" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText("Bandeja paisa")).not.toBeInTheDocument()
    expect(screen.getByText("Jugo de lulo")).toBeInTheDocument()
    expect(window.localStorage.getItem(KITCHEN_STATION_KEY)).toBe("b")
  })

  it("opens on the station remembered on this device and serves only its lines", async () => {
    window.localStorage.setItem(KITCHEN_STATION_KEY, "k")
    renderKitchen()
    const group = await screen.findByRole("group", { name: "Estación" })
    await waitFor(() => expect(within(group).getByRole("button", { name: "Cocina" })).toHaveAttribute("aria-pressed", "true"))
    expect(await screen.findByText("Bandeja paisa")).toBeInTheDocument()
    expect(screen.queryByText("Jugo de lulo")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Entregar toda/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar entrega" }))
    await waitFor(() => expect(served).toHaveBeenCalledWith(["i-1", "i-3"]))
  })

  it("shows no station selector while the restaurant has no stations", async () => {
    listStations.mockResolvedValue([])
    window.localStorage.setItem(KITCHEN_STATION_KEY, "gone")
    renderKitchen()
    expect(await screen.findByText("Jugo de lulo")).toBeInTheDocument()
    expect(screen.getByText("Bandeja paisa")).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Estación" })).not.toBeInTheDocument()
  })
})
