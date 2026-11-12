import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItem, InventoryLocation, Lot, Movement } from "@/lib/api/inventory/types"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    toast: vi.fn(),
    items: [] as unknown[],
    locations: [] as unknown[],
    movementsArgs: [] as unknown[],
    movementsPage: { rows: [], total: 0, totals: { count: 0, inValue: 0, outValue: 0 } } as unknown,
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
      return q(h.movementsPage)
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
  h.movementsPage = { rows: [], total: 0, totals: { count: 0, inValue: 0, outValue: 0 } }
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

  it("creates the item with its opening stock in one request (T10)", async () => {
    h.createItem.mutateAsync.mockResolvedValue(makeItem({ id: "new", sku: "MP-0009" }))
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    fill("Nombre", "Queso")
    fill("Cantidad inicial", "5")
    fill("Costo inicial", "2500")
    await submit("Crear artículo")

    expect(h.createItem.mutateAsync).toHaveBeenCalledTimes(1)
    expect(h.createItem.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Queso", openingStock: { quantity: 5, unitCost: 2500 } }),
    )
    expect(h.adjustStock.mutateAsync).not.toHaveBeenCalled()
  })

  it("sends a null opening cost when the cost is blank", async () => {
    h.createItem.mutateAsync.mockResolvedValue(makeItem({ id: "new" }))
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    fill("Nombre", "Queso")
    fill("Cantidad inicial", "5")
    await submit("Crear artículo")
    expect(h.createItem.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ openingStock: { quantity: 5, unitCost: null } }),
    )
    expect(h.adjustStock.mutateAsync).not.toHaveBeenCalled()
  })

  it("skips the opening movement when there is no initial stock", async () => {
    h.createItem.mutateAsync.mockResolvedValue(makeItem({ id: "new" }))
    render(<ItemFormSheet open item={null} onOpenChange={() => {}} />)
    fill("Nombre", "Queso")
    fill("Cantidad inicial", "0")
    await submit("Crear artículo")
    expect(h.createItem.mutateAsync).toHaveBeenCalledTimes(1)
    expect(h.createItem.mutateAsync.mock.calls[0][0]).not.toHaveProperty("openingStock")
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

  const move = (patch: Partial<Movement>): Movement => ({
    id: "m1",
    itemId: "i1",
    itemName: "Pechuga de pollo",
    sku: "MP-0004",
    unit: "kg",
    locationId: "l1",
    locationName: "Bodega principal",
    lotId: null,
    movementType: "purchase",
    quantity: 8,
    unitCost: 17750,
    totalCost: 142000,
    reason: null,
    notes: null,
    referenceType: null,
    referenceId: null,
    createdBy: "p1",
    createdByName: "Julián P.",
    documentKind: null,
    documentId: null,
    documentLabel: null,
    createdAt: new Date(2026, 10, 12, 16, 2).toISOString(),
    ...patch,
  })
  const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()

  describe("ledger", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date(2026, 10, 12, 18, 0))
      h.movementsPage = {
        rows: [
          move({
            id: "a", movementType: "purchase", referenceType: "purchase_order", referenceId: "po5",
            documentKind: "purchase_order", documentId: "po5", documentLabel: "OC-0005",
          }),
          move({
            id: "b", movementType: "waste", locationName: "Sede Norte", quantity: -1, totalCost: -17750, reason: "Bolsa rota",
            createdByName: "Mariana R.", referenceType: "inventory_transfer", referenceId: "t7",
            documentKind: "inventory_transfer", documentId: "t7", documentLabel: "TR-0007",
            createdAt: new Date(2026, 10, 12, 11, 10).toISOString(),
          }),
          move({
            id: "c", movementType: "adjustment", quantity: 1.5, totalCost: 6000, reason: "Bulto mal registrado", createdByName: null,
            createdAt: new Date(2026, 10, 11, 8, 30).toISOString(),
          }),
        ],
        total: 117,
        totals: { count: 117, inValue: 1250000, outValue: 480000 },
      }
    })
    afterEach(() => vi.useRealTimers())

    it("shows the totals of the whole filtered range on one line, not per page", () => {
      render(<MovementsPage description="" />)
      expect(screen.queryByText(/\(página\)/)).not.toBeInTheDocument()
      const line = screen.getByRole("status", { name: "Totales del rango" })
      expect(norm(line.textContent)).toBe(norm("117 movimientos · Entradas +$ 1.250.000 · Salidas −$ 480.000 · Neto +$ 770.000"))
    })

    it("groups rows by day with the time only, a type chip and the author", () => {
      render(<MovementsPage description="" />)
      const table = screen.getByRole("table", { name: /Movimientos agrupados por día/ })
      const groups = within(table).getAllByRole("rowgroup").slice(1)
      expect(groups.map((g) => norm(within(g).getAllByRole("row")[0].textContent))).toEqual([
        norm("Hoy · jue 12 nov2 movimientos · neto +$ 124.250"),
        norm("Ayer · mié 11 nov1 movimiento · neto +$ 6.000"),
      ])
      const waste = within(groups[0]).getAllByRole("row")[2]
      expect(within(waste).getAllByRole("cell").map((c) => norm(c.textContent))).toEqual([
        "11:10", "Pechuga de pollo MP-0004", "Merma", "Sede Norte", "−1 kg", "−$ 17.750", "Merma en tránsito · TR-0007",
        "Bolsa rota · Mariana R.",
      ])
      const manual = within(groups[1]).getAllByRole("row")[1]
      expect(within(manual).getAllByRole("cell").map((c) => norm(c.textContent)).slice(-2)).toEqual(["Manual", "Bulto mal registrado"])
    })

    it("filters by type chip and sends the group's types", () => {
      render(<MovementsPage description="" />)
      const chips = screen.getByRole("group", { name: "Tipo de movimiento" })
      expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual([
        "Todos", "Ventas", "Compras", "Producción", "Ajustes y conteos", "Mermas", "Traslados",
      ])
      fireEvent.click(within(chips).getByRole("button", { name: "Ajustes y conteos" }))
      expect(within(chips).getByRole("button", { name: "Ajustes y conteos" })).toHaveAttribute("aria-pressed", "true")
      expect(h.movementsArgs.at(-1)).toEqual({ types: ["adjustment", "count_adjustment", "opening"], page: 1, pageSize: 50 })
      fireEvent.click(within(chips).getByRole("button", { name: "Todos" }))
      expect(h.movementsArgs.at(-1)).toEqual({ page: 1, pageSize: 50 })
    })

    it("opens the source screen from the origin, transfers included", () => {
      const onNavigate = vi.fn()
      render(<MovementsPage description="" onNavigate={onNavigate} />)
      fireEvent.click(screen.getByRole("button", { name: "Abrir OC-0005" }))
      expect(onNavigate).toHaveBeenCalledWith("inventory/purchases")
      fireEvent.click(screen.getByRole("button", { name: /TR-0007/ }))
      expect(onNavigate).toHaveBeenCalledWith("inventory/transfers")
    })

    it("exports the listed rows with the origin and author columns", async () => {
      const created: Blob[] = []
      Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (created.push(b), "blob:x")), revokeObjectURL: vi.fn() })
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
      render(<MovementsPage description="" />)
      fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }))
      expect(click).toHaveBeenCalled()
      const text = await created[0].text()
      expect(text).toContain(";origen;motivo;usuario")
      expect(text).toContain("Merma en tránsito · TR-0007;Bolsa rota;Mariana R.")
      click.mockRestore()
    })
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
