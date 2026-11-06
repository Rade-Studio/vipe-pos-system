import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2) — the four Resumen widgets share ONE summary request and show its errors. */

const dashboard = vi.hoisted(() => ({ fetchDashboardSummary: vi.fn() }))
vi.mock("@/lib/api/dashboard", () => ({
  fetchDashboardSummary: (...args: [number]) => dashboard.fetchDashboardSummary(...args),
}))
const adminOrders = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/lib/admin/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/orders")>()),
  fetchActiveAdminOrders: () => adminOrders.fetch(),
}))
vi.mock("@/hooks/inventory", () => ({ useInventoryItems: () => ({ data: [], isLoading: false }) }))
vi.mock("@/components/admin/SalesChart", () => ({ SalesChart: () => null }))
vi.mock("@/components/admin/PopularDishesChart", () => ({ PopularDishesChart: () => null }))
vi.mock("@/hooks/use-zones", () => ({
  useZones: () => ({
    data: [
      { id: "z-1", name: "Salón principal", aspect: 1.6, sortOrder: 0, labels: [], active: true, createdAt: null, updatedAt: null },
      { id: "z-2", name: "Terraza", aspect: 1.6, sortOrder: 1, labels: [], active: true, createdAt: null, updatedAt: null },
    ],
    isLoading: false,
  }),
}))

import { OverviewPage } from "./OverviewPage"
import { useTableStore } from "@/store/useTableStore"
import { takeEditorZone } from "@/lib/admin/floor/editor-zone"
import type { AdminOrder } from "@/lib/admin/orders"

function renderPage(onNavigate?: (sectionId: string) => void, activeOrders: AdminOrder[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OverviewPage description="" activeOrders={activeOrders} onNavigate={onNavigate} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  adminOrders.fetch.mockReset()
  adminOrders.fetch.mockResolvedValue([])
  dashboard.fetchDashboardSummary.mockReset()
  useTableStore.setState({ tables: [] })
})

describe("OverviewPage", () => {
  it("reads the summary once for all four widgets", async () => {
    dashboard.fetchDashboardSummary.mockResolvedValue({
      monthSales: 0,
      kitchenOrders: 7,
      dailySales: [],
      popularDishes: [],
    })
    renderPage()
    expect(await screen.findByText("7")).toBeInTheDocument()
    expect(dashboard.fetchDashboardSummary).toHaveBeenCalledTimes(1)
    expect(dashboard.fetchDashboardSummary).toHaveBeenCalledWith(30)
  })

  it("shows an error state instead of silent zeros", async () => {
    dashboard.fetchDashboardSummary.mockRejectedValue(new Error("boom"))
    renderPage()
    await waitFor(() => expect(screen.getByText("No se pudo cargar el resumen")).toBeInTheDocument())
    expect(screen.queryByText("$0")).toBeNull()
  })

  it("retries after an error and clears the alert (item 11)", async () => {
    dashboard.fetchDashboardSummary
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ monthSales: 0, kitchenOrders: 4, dailySales: [], popularDishes: [] })
    renderPage()
    await screen.findByText("No se pudo cargar el resumen")
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByText("4")).toBeInTheDocument()
    expect(dashboard.fetchDashboardSummary).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it("ranks the most sold dishes with their counts, top first (T2)", async () => {
    dashboard.fetchDashboardSummary.mockResolvedValue({
      monthSales: 0,
      kitchenOrders: 0,
      dailySales: [],
      popularDishes: [
        { name: "Ajiaco", count: 231 },
        { name: "Bandeja paisa", count: 312 },
      ],
    })
    renderPage()
    const list = await screen.findByRole("list", { name: "Platos más vendidos" })
    const rows = within(list).getAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual(["Bandeja paisa312", "Ajiaco231"])
  })

  it("says so when no dish was sold yet (T2)", async () => {
    dashboard.fetchDashboardSummary.mockResolvedValue({
      monthSales: 0,
      kitchenOrders: 0,
      dailySales: [],
      popularDishes: [],
    })
    renderPage()
    expect(await screen.findByText("Todavía no hay ventas en los últimos 30 días.")).toBeInTheDocument()
  })

  it("shows the live room as a mini floor map with a status legend and an Editar plano link (T5)", async () => {
    dashboard.fetchDashboardSummary.mockResolvedValue({ monthSales: 0, kitchenOrders: 0, dailySales: [], popularDishes: [] })
    useTableStore.setState({
      tables: [
        { id: "t-1", number: 1, status: "available", zoneId: "z-1", x: 0.2, y: 0.3, w: 0.1, h: 0.1, shape: "round" },
        { id: "t-2", number: 2, status: "kitchen", zoneId: "z-1", x: 0.6, y: 0.3, w: 0.1, h: 0.1, shape: "square" },
      ],
    })
    const onNavigate = vi.fn()
    renderPage(onNavigate)

    const card = screen.getByRole("region", { name: "Sala en vivo" })
    expect(within(card).getByRole("tab", { name: /Salón principal/ })).toBeInTheDocument()
    expect(within(card).getByRole("button", { name: "Mesa 2, En cocina" })).toBeInTheDocument()
    const legend = within(card).getByRole("list", { name: "Estados de las mesas" })
    expect(within(legend).getByText("Libre").parentElement).toHaveTextContent("Libre1")
    expect(within(legend).getByText("En cocina").parentElement).toHaveTextContent("En cocina1")

    fireEvent.click(within(card).getByRole("button", { name: "Editar plano" }))
    expect(onNavigate).toHaveBeenCalledWith("tables")
  })

  describe("Sala en vivo (T26)", () => {
    const tables = [
      { id: "t-1", number: 1, status: "available" as const, zoneId: "z-1", x: 0.2, y: 0.3, w: 0.1, h: 0.1, shape: "round" as const },
      { id: "t-2", number: 2, status: "kitchen" as const, zoneId: "z-1", x: 0.6, y: 0.3, w: 0.1, h: 0.1, shape: "square" as const, waiter: "w-1" },
      { id: "t-3", number: 3, status: "available" as const, zoneId: "z-1", x: 0.8, y: 0.7, w: 0.1, h: 0.1, shape: "square" as const, isActive: false },
      { id: "t-9", number: 9, status: "available" as const, zoneId: "z-2", x: 0.5, y: 0.5, w: 0.1, h: 0.1, shape: "square" as const },
    ]
    const orders = [
      {
        id: "o-1",
        orderNumber: 41,
        tableId: "t-2",
        status: "kitchen",
        createdAt: new Date(Date.now() - 18 * 60_000 - 5_000),
        items: [],
        bill: { subtotal: 0, tax: 0, tip: 0, total: 0 },
        waiter: "w-1",
        waiterName: "Camila Montoya",
      },
    ] as unknown as AdminOrder[]

    beforeEach(() => {
      dashboard.fetchDashboardSummary.mockResolvedValue({ monthSales: 0, kitchenOrders: 0, dailySales: [], popularDishes: [] })
      useTableStore.setState({ tables })
      takeEditorZone()
    })

    it("draws the elapsed minutes and the waiter initials from the open order", () => {
      renderPage(undefined, orders)
      const card = screen.getByRole("region", { name: "Sala en vivo" })
      const busy = within(card).getByRole("button", { name: "Mesa 2, En cocina, 18 min, Camila Montoya" })
      expect(busy).toHaveTextContent("18 min")
      expect(busy).toHaveTextContent("CM")
      expect(within(card).getByRole("button", { name: "Mesa 1, Libre" })).not.toHaveTextContent("min")
      expect(within(card).getByRole("button", { name: "Mesa 3, Libre, inactiva" })).toBeInTheDocument()
      expect(within(card).getByRole("list", { name: "Esperando más tiempo" })).toHaveTextContent("Mesa 2")
    })

    it("selecting a table opens its details", () => {
      renderPage(undefined, orders)
      const card = screen.getByRole("region", { name: "Sala en vivo" })
      fireEvent.click(within(card).getByRole("button", { name: /^Mesa 2,/ }))
      const details = within(card).getByRole("region", { name: "Mesa 2" })
      expect(details).toHaveTextContent("En cocina")
      expect(details).toHaveTextContent("MeseroCamila Montoya")
      expect(details).toHaveTextContent("Tiempo18 min")
      expect(details).toHaveTextContent("Orden#41")
      fireEvent.click(within(card).getByRole("button", { name: /^Mesa 1,/ }))
      expect(within(card).getByRole("region", { name: "Mesa 1" })).toHaveTextContent("Sin orden abierta")
    })

    it("reads the active orders with their waiter: an unsent (active) order shows its minutes and its own waiter", async () => {
      adminOrders.fetch.mockResolvedValue([
        {
          id: "o-9",
          orderNumber: 7,
          tableId: "t-1",
          status: "active",
          createdAt: new Date(Date.now() - 6 * 60_000 - 5_000),
          items: [],
          bill: { subtotal: 0, tax: 0, tip: 0, total: 0 },
          waiter: "w-2",
          waiterName: "Laura Pérez",
        },
      ])
      useTableStore.setState({ tables: tables.map((t) => (t.id === "t-1" ? { ...t, status: "occupied" as const, waiter: "w-1", waiter_name: "Mesero Dev" } : t)) })
      renderPage(undefined, [])
      const card = screen.getByRole("region", { name: "Sala en vivo" })
      const busy = await within(card).findByRole("button", { name: "Mesa 1, Ocupada, 6 min, Laura Pérez" })
      expect(busy).toHaveTextContent("LP")
      expect(adminOrders.fetch).toHaveBeenCalledTimes(1)
    })

    it("falls back to the table's assigned waiter only when the order has none", async () => {
      adminOrders.fetch.mockResolvedValue([
        { ...orders[0], waiterName: "Desconocido" },
      ])
      useTableStore.setState({ tables: tables.map((t) => (t.id === "t-2" ? { ...t, waiter_name: "Mesero Dev" } : t)) })
      renderPage(undefined, [])
      const card = screen.getByRole("region", { name: "Sala en vivo" })
      expect(await within(card).findByRole("button", { name: "Mesa 2, En cocina, 18 min, Mesero Dev" })).toHaveTextContent("MD")
    })

    it("Editar plano opens the editor on the zone shown", () => {
      const onNavigate = vi.fn()
      renderPage(onNavigate, orders)
      const card = screen.getByRole("region", { name: "Sala en vivo" })
      fireEvent.click(within(card).getByRole("tab", { name: /Terraza/ }))
      fireEvent.click(within(card).getByRole("button", { name: "Editar plano" }))
      expect(onNavigate).toHaveBeenCalledWith("tables")
      expect(takeEditorZone()).toBe("z-2")
    })
  })
})
