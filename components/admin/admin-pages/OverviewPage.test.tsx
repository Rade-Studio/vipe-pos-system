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

import { OverviewPage } from "./OverviewPage"

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OverviewPage description="" activeOrders={[]} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  dashboard.fetchDashboardSummary.mockReset()
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
})
