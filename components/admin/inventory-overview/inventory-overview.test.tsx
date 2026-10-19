import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItem, InventoryOverview } from "@/lib/supabase/inventory/types"

const h = vi.hoisted(() => ({
  overview: undefined as unknown,
  items: [] as unknown[],
  overviewDays: [] as number[],
}))

vi.mock("@/hooks/inventory", () => ({
  useInventoryOverview: (days: number) => {
    h.overviewDays.push(days)
    return { data: h.overview, isLoading: false }
  },
  useInventoryItems: () => ({ data: h.items, isLoading: false }),
  useSuppliers: () => ({ data: [{ id: "s1", name: "Proveedor Uno" }], isLoading: false }),
}))
vi.mock("@/lib/supabase/client", () => ({ supabase: {}, createSupabaseClient: () => ({}) }))
vi.mock("@/lib/supabase/dashboard-service", () => ({
  dashboardService: {
    getMonthSales: vi.fn(async () => 0),
    countOrdersByStatus: vi.fn(async () => 0),
    getDailySales: vi.fn(async () => []),
    getPopularDishes: vi.fn(async () => []),
  },
}))
vi.mock("@/components/admin/SalesChart", () => ({ SalesChart: () => null }))
vi.mock("@/components/admin/PopularDishesChart", () => ({ PopularDishesChart: () => null }))

import { InventoryOverviewPage } from "./InventoryOverviewPage"
import { OverviewPage } from "@/components/admin/admin-pages/OverviewPage"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const makeItem = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "i",
  sku: "MP-0001",
  name: "Item",
  description: null,
  kind: "raw",
  unit: "g",
  barcode: null,
  cost: 1,
  stock: 100,
  minStock: 10,
  maxStock: null,
  purchaseUnit: null,
  purchaseFactor: 1,
  defaultSupplierId: null,
  trackLots: false,
  shelfLifeDays: null,
  isActive: true,
  categoryId: null,
  categoryName: null,
  ...patch,
})

const overview = (patch: Partial<InventoryOverview["kpis"]> = {}): InventoryOverview => ({
  days: 30,
  generatedAt: "2026-10-19T00:00:00Z",
  kpis: {
    totalValue: 1_500_000,
    itemsCount: 40,
    activeItems: 38,
    lowStockCount: 4,
    outOfStockCount: 2,
    expiringSoonCount: 3,
    expiredCount: 1,
    wasteValue: 25_000,
    purchasesValue: 400_000,
    consumptionValue: 200_000,
    openPurchaseOrders: 5,
    ...patch,
  },
  series: [],
  valueByCategory: [],
  topConsumed: [{ itemId: "t1", name: "Tomate", unit: "g", quantity: 5000, value: 30_000 }],
})

const renderUi = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

const statCard = (title: string) => screen.getByText(title).closest("div.rounded-lg") as HTMLElement

beforeEach(() => {
  h.overview = overview()
  h.items = []
  h.overviewDays = []
})

describe("InventoryOverviewPage", () => {
  it("renders the KPIs from the overview payload", () => {
    renderUi(<InventoryOverviewPage />)
    expect(within(statCard("Valor del inventario")).getByText(/1\.500\.000/)).toBeInTheDocument()
    expect(within(statCard("Artículos bajo mínimo")).getByText("4")).toBeInTheDocument()
    expect(within(statCard("Artículos bajo mínimo")).getByText("2 agotados")).toBeInTheDocument()
    expect(within(statCard("Por vencer")).getByText("3")).toBeInTheDocument()
    expect(within(statCard("Órdenes de compra abiertas")).getByText("5")).toBeInTheDocument()
    expect(within(statCard("Mermas del período")).getByText("12.5% del consumo")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Más consumidos" })).toHaveTextContent("Tomate")
  })

  it("re-queries the overview with the selected range", () => {
    renderUi(<InventoryOverviewPage />)
    expect(h.overviewDays.at(-1)).toBe(30)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "7 días" }))
    expect(h.overviewDays.at(-1)).toBe(7)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "90 días" }))
    expect(h.overviewDays.at(-1)).toBe(90)
  })

  it("lists only items needing stock and the action navigates to purchases", () => {
    h.items = [
      makeItem({ id: "a", name: "Arroz", stock: 0, defaultSupplierId: "s1" }),
      makeItem({ id: "b", name: "Bien surtido", stock: 500 }),
    ]
    const onNavigate = vi.fn()
    renderUi(<InventoryOverviewPage onNavigate={onNavigate} />)
    expect(screen.getAllByText("Arroz").length).toBeGreaterThan(0)
    expect(screen.queryByText("Bien surtido")).not.toBeInTheDocument()
    expect(screen.getAllByText("Proveedor Uno").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: /Crear órdenes de compra/ }))
    expect(onNavigate).toHaveBeenCalledWith("inventory/purchases")
  })

  it("shows empty states when the overview has no data", () => {
    h.overview = { ...overview(), topConsumed: [] }
    renderUi(<InventoryOverviewPage />)
    expect(screen.getByText("Sin movimientos")).toBeInTheDocument()
    expect(screen.getByText("Sin valor en inventario")).toBeInTheDocument()
    expect(screen.getByText("Sin consumo")).toBeInTheDocument()
    expect(screen.getByText("Todo en orden")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Crear órdenes de compra/ })).not.toBeInTheDocument()
  })
})

describe("OverviewPage inventory alerts", () => {
  it("shows the out / low counts, the urgent rows and navigates to the inventory overview", () => {
    h.items = [
      makeItem({ id: "a", name: "Arroz", stock: 0 }),
      makeItem({ id: "b", name: "Bananos", stock: 5 }),
      makeItem({ id: "c", name: "Cebolla", stock: 500 }),
    ]
    const onNavigate = vi.fn()
    renderUi(<OverviewPage description="" activeOrders={[]} onNavigate={onNavigate} />)
    expect(screen.getByText("1 agotados · 1 bajo mínimo")).toBeInTheDocument()
    expect(screen.getByText("Arroz")).toBeInTheDocument()
    expect(screen.getByText("Bananos")).toBeInTheDocument()
    expect(screen.queryByText("Cebolla")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver inventario" }))
    expect(onNavigate).toHaveBeenCalledWith("inventory/overview")
  })
})
