import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** T12 (S2) — the four Resumen widgets share ONE summary request and show its errors. */

const dashboard = vi.hoisted(() => ({ fetchDashboardSummary: vi.fn() }))
vi.mock("@/lib/api/dashboard", () => ({
  fetchDashboardSummary: (...args: [number]) => dashboard.fetchDashboardSummary(...args),
}))
vi.mock("@/hooks/inventory", () => ({ useInventoryItems: () => ({ data: [], isLoading: false }) }))
vi.mock("@/components/admin/SalesChart", () => ({ SalesChart: () => null }))
vi.mock("@/components/admin/PopularDishesChart", () => ({ PopularDishesChart: () => null }))
vi.mock("@/hooks/use-zones", () => ({
  useZones: () => ({
    data: [{ id: "z-1", name: "Salón principal", aspect: 1.6, sortOrder: 0, labels: [], active: true, createdAt: null, updatedAt: null }],
    isLoading: false,
  }),
}))

import { OverviewPage } from "./OverviewPage"
import { useTableStore } from "@/store/useTableStore"

function renderPage(onNavigate?: (sectionId: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OverviewPage description="" activeOrders={[]} onNavigate={onNavigate} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
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
    expect(within(card).getByRole("img", { name: "Mesa 2, En cocina, sin sillas" })).toBeInTheDocument()
    const legend = within(card).getByRole("list", { name: "Estados de las mesas" })
    expect(within(legend).getByText("Libre").parentElement).toHaveTextContent("Libre1")
    expect(within(legend).getByText("En cocina").parentElement).toHaveTextContent("En cocina1")

    fireEvent.click(within(card).getByRole("button", { name: "Editar plano" }))
    expect(onNavigate).toHaveBeenCalledWith("tables")
  })
})
