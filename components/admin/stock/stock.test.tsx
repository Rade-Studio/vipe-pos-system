import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItem, InventoryLocation, Lot } from "@/lib/supabase/inventory/types"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    toast: vi.fn(),
    items: [] as unknown[],
    locations: [] as unknown[],
    movementsArgs: [] as unknown[],
    createItem: mutation(),
    updateItem: mutation(),
    adjustStock: mutation(),
    transferStock: mutation(),
    createCategory: mutation(),
    createLocation: mutation(),
    updateLocation: mutation(),
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => {
  const q = (data: unknown) => ({ data, isLoading: false })
  return {
    useInventoryItems: () => q(h.items),
    useInventoryItemsBy: () => q(h.items),
    useInventoryItem: () => q(undefined),
    useInventoryCategories: () => q([{ id: "c1", name: "Verduras", description: null }]),
    useSuppliers: () => q([{ id: "s1", name: "Proveedor Uno" }]),
    useInventoryLocations: () => q(h.locations),
    useItemLots: () => q([]),
    useInventoryMovements: (filters: unknown) => {
      h.movementsArgs.push(filters)
      return q({ rows: [], total: 0 })
    },
    useCreateItem: () => h.createItem,
    useUpdateItem: () => h.updateItem,
    useAdjustStock: () => h.adjustStock,
    useTransferStock: () => h.transferStock,
    useCreateCategory: () => h.createCategory,
    useCreateLocation: () => h.createLocation,
    useUpdateLocation: () => h.updateLocation,
  }
})

import { ItemFormSheet } from "./ItemFormSheet"
import { ItemsPage } from "./ItemsPage"
import { LocationsPage } from "./LocationsPage"
import { MovementsPage, buildMovementFilters } from "./MovementsPage"
import { StockActionDialog } from "./StockActionDialog"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const makeItem = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "i1",
  sku: "MP-0001",
  name: "Tomate",
  description: null,
  kind: "raw",
  unit: "kg",
  barcode: null,
  cost: 1000,
  stock: 10,
  minStock: 2,
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

const locations: InventoryLocation[] = [
  { id: "l1", name: "Bodega principal", code: "BP", isDefault: true, isActive: true },
  { id: "l2", name: "Cocina", code: "COC", isDefault: false, isActive: true },
]

beforeEach(() => {
  h.toast.mockClear()
  h.movementsArgs.length = 0
  h.locations = locations
  for (const m of [h.createItem, h.updateItem, h.adjustStock, h.transferStock, h.createCategory, h.createLocation, h.updateLocation]) {
    m.mutateAsync.mockReset().mockResolvedValue({})
  }
})

describe("ItemsPage", () => {
  beforeEach(() => {
    h.items = [
      makeItem({ id: "a", sku: "MP-0001", name: "Tomate", stock: 10 }),
      makeItem({ id: "b", sku: "MP-0002", name: "Cebolla", stock: 0 }),
      makeItem({ id: "c", sku: "PR-0001", name: "Salsa roja", kind: "prep", stock: 1, barcode: "7701" }),
    ]
  })

  const visibleNames = () => {
    const table = screen.getByRole("table")
    return ["Tomate", "Cebolla", "Salsa roja"].filter((n) => within(table).queryByText(n))
  }

  it("filters by stock status", () => {
    render(<ItemsPage description="" />)
    expect(visibleNames()).toEqual(["Tomate", "Cebolla", "Salsa roja"])
    fireEvent.change(screen.getByLabelText("Estado de stock"), { target: { value: "out" } })
    expect(visibleNames()).toEqual(["Cebolla"])
    fireEvent.change(screen.getByLabelText("Estado de stock"), { target: { value: "low" } })
    expect(visibleNames()).toEqual(["Salsa roja"])
  })

  it("searches by name, SKU and barcode", () => {
    render(<ItemsPage description="" />)
    const search = screen.getByLabelText("Buscar por nombre, SKU o código")
    fireEvent.change(search, { target: { value: "mp-0002" } })
    expect(visibleNames()).toEqual(["Cebolla"])
    fireEvent.change(search, { target: { value: "7701" } })
    expect(visibleNames()).toEqual(["Salsa roja"])
  })
})

describe("ItemFormSheet", () => {
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const submit = async (name: string) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name }))
    })
  }

  it("creates the item and records the opening stock at the default location", async () => {
    h.createItem.mutateAsync.mockResolvedValue(makeItem({ id: "new", sku: "MP-0009" }))
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    fill("Nombre", "Queso")
    fill("Cantidad inicial", "5")
    fill("Costo inicial", "2500")
    await submit("Crear artículo")

    expect(h.createItem.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "Queso" }))
    expect(h.adjustStock.mutateAsync).toHaveBeenCalledWith({
      itemId: "new",
      locationId: "l1",
      movementType: "opening",
      quantity: 5,
      unitCost: 2500,
      reason: "Stock inicial",
    })
    expect(h.createItem.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(h.adjustStock.mutateAsync.mock.invocationCallOrder[0])
  })

  it("skips the opening movement when there is no initial stock", async () => {
    h.createItem.mutateAsync.mockResolvedValue(makeItem({ id: "new" }))
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    fill("Nombre", "Queso")
    fill("Cantidad inicial", "0")
    await submit("Crear artículo")
    expect(h.createItem.mutateAsync).toHaveBeenCalledTimes(1)
    expect(h.adjustStock.mutateAsync).not.toHaveBeenCalled()
  })

  it("does not save an invalid form", async () => {
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    await submit("Crear artículo")
    expect(screen.getByText("El nombre es obligatorio")).toBeInTheDocument()
    expect(h.createItem.mutateAsync).not.toHaveBeenCalled()
  })

  it("edit never sends stock or cost and records no movement", async () => {
    h.updateItem.mutateAsync.mockResolvedValue(makeItem({}))
    render(<ItemFormSheet open item={makeItem({ stock: 7, cost: 900 })} onOpenChange={() => {}} />)
    expect(screen.queryByLabelText("Cantidad inicial")).not.toBeInTheDocument()
    fill("Nombre", "Tomate chonto")
    await submit("Guardar cambios")

    const [{ id, input }] = h.updateItem.mutateAsync.mock.calls[0]
    expect(id).toBe("i1")
    expect(input.name).toBe("Tomate chonto")
    expect(input).not.toHaveProperty("stock")
    expect(input).not.toHaveProperty("cost")
    expect(h.adjustStock.mutateAsync).not.toHaveBeenCalled()
  })
})

describe("StockActionDialog", () => {
  const lots: Lot[] = [
    { id: "lot1", itemId: "i1", locationId: "l1", locationName: "Bodega principal", lotCode: null, expiresOn: null, quantity: 10, unitCost: 1000, receivedAt: "" },
  ]

  it("waste sends type 'waste' with a positive quantity and the chosen reason", async () => {
    render(<StockActionDialog action="waste" item={makeItem({})} lots={lots} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "500 g" } })
    fireEvent.click(screen.getByRole("button", { name: "Derrame" }))
    expect(screen.getByTestId("stock-preview")).toHaveTextContent("10 kg → 9,5 kg")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar" }))
    })
    expect(h.adjustStock.mutateAsync).toHaveBeenCalledWith({
      itemId: "i1",
      locationId: "l1",
      movementType: "waste",
      quantity: 0.5,
      reason: "Derrame",
    })
  })

  it("transfer requires different locations", async () => {
    render(<StockActionDialog action="transfer" item={makeItem({})} lots={lots} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: "2" } })
    fireEvent.change(screen.getByLabelText("Hacia"), { target: { value: "l1" } })
    expect(screen.getAllByText("Las bodegas de origen y destino deben ser distintas").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled()
    expect(h.transferStock.mutateAsync).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Hacia"), { target: { value: "l2" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar" }))
    })
    expect(h.transferStock.mutateAsync).toHaveBeenCalledWith({ itemId: "i1", fromLocationId: "l1", toLocationId: "l2", quantity: 2 })
  })
})

describe("MovementsPage", () => {
  it("builds the hook args from the filters", () => {
    h.items = [makeItem({})]
    render(<MovementsPage description="" />)
    expect(h.movementsArgs.at(-1)).toEqual({ page: 1, pageSize: 50 })
    fireEvent.change(screen.getByLabelText("Artículo"), { target: { value: "i1" } })
    fireEvent.change(screen.getByLabelText("Bodega"), { target: { value: "l2" } })
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } })
    expect(h.movementsArgs.at(-1)).toEqual({ itemId: "i1", locationId: "l2", from: "2026-10-01", page: 1, pageSize: 50 })
  })

  it("buildMovementFilters keeps the selected types", () => {
    expect(
      buildMovementFilters({ itemId: "", locationId: "", types: ["waste", "sale"], from: "", to: "2026-10-19", page: 3 }, 20),
    ).toEqual({ types: ["waste", "sale"], to: "2026-10-19", page: 3, pageSize: 20 })
  })
})

describe("LocationsPage", () => {
  it("marks a location as the default", async () => {
    render(<LocationsPage description="" />)
    await act(async () => {
      fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "Marcar como principal" }))
    })
    expect(h.updateLocation.mutateAsync).toHaveBeenCalledWith({ id: "l2", input: { isDefault: true } })
  })
})
