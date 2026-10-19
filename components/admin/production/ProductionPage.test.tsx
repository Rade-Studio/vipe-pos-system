import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { InventoryError } from "@/lib/inventory/errors"
import type { InventoryItem } from "@/lib/supabase/inventory/types"

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  items: [] as unknown[],
  produce: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => {
  const q = (data: unknown) => ({ data, isLoading: false })
  return {
    useInventoryItems: () => q(h.items),
    useFormulas: () =>
      q({
        byDish: {},
        byPrep: {
          salsa: {
            recipeId: "r1",
            targetType: "prep",
            targetId: "salsa",
            yieldQuantity: 2,
            notes: null,
            lines: [
              { ingredientId: "tomate", quantity: 1 },
              { ingredientId: "ajo", quantity: 50 },
            ],
          },
        },
      }),
    useProductionBatches: () =>
      q([
        {
          id: "b1",
          itemId: "salsa",
          itemName: "Salsa roja",
          unit: "l",
          locationId: "loc1",
          locationName: "Bodega principal",
          lotId: "lot1",
          lotCode: "PR-0001-L1",
          quantity: 2,
          unitCost: 1500,
          totalCost: 3000,
          expiresOn: null,
          notes: null,
          createdAt: "2026-10-18T10:00:00Z",
        },
      ]),
    useInventoryLocations: () =>
      q([
        { id: "loc2", name: "Cocina", code: "COC", isDefault: false, isActive: true },
        { id: "loc1", name: "Bodega principal", code: "BOD", isDefault: true, isActive: true },
      ]),
    useProducePreparation: () => h.produce,
  }
})

import { ProductionPage } from "./ProductionPage"

const makeItem = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "x",
  sku: "MP-0001",
  name: "X",
  description: null,
  kind: "raw",
  unit: "kg",
  barcode: null,
  cost: 1000,
  stock: 10,
  minStock: 0,
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

const setStock = (tomate: number) => {
  h.items = [
    makeItem({ id: "salsa", sku: "PR-0001", name: "Salsa roja", kind: "prep", unit: "l", stock: 1 }),
    makeItem({ id: "pico", sku: "PR-0002", name: "Pico de gallo", kind: "prep", unit: "kg", stock: 0 }),
    makeItem({ id: "tomate", name: "Tomate", unit: "kg", stock: tomate, cost: 2000 }),
    makeItem({ id: "ajo", name: "Ajo", unit: "g", stock: 500, cost: 20 }),
  ]
}

const openProduce = () => {
  const card = screen.getByRole("listitem", { name: "Salsa roja" })
  fireEvent.click(within(card).getByRole("button", { name: "Producir" }))
}

beforeEach(() => {
  h.toast.mockReset()
  h.produce.mutateAsync.mockReset()
  setStock(10)
})

describe("ProductionPage", () => {
  it("lists preps with producible quantity and links preps without formula to Fórmulas", () => {
    const onNavigate = vi.fn()
    render(<ProductionPage description="d" onNavigate={onNavigate} />)
    const salsa = screen.getByRole("listitem", { name: "Salsa roja" })
    // tomate 10 kg / 1 per batch, ajo 500 g / 50 → 10 batches × 2 l.
    expect(within(salsa).getByText("20 l")).toBeInTheDocument()
    const pico = screen.getByRole("listitem", { name: "Pico de gallo" })
    expect(within(pico).getByText("Sin fórmula")).toBeInTheDocument()
    fireEvent.click(within(pico).getByRole("button", { name: "Crear fórmula" }))
    expect(onNavigate).toHaveBeenCalledWith("formulas")
    expect(screen.getAllByText("PR-0001-L1").length).toBeGreaterThan(0)
  })

  it("flags missing inputs in the requirement table and disables Producir", () => {
    setStock(1.5)
    render(<ProductionPage description="d" />)
    openProduce()
    fireEvent.click(screen.getByRole("button", { name: "×2 lotes" }))
    const table = screen.getByRole("table", { name: "Requerimiento de insumos" })
    const tomatoRow = within(table).getByText("Tomate").closest("tr") as HTMLElement
    expect(tomatoRow).toHaveAttribute("data-missing", "true")
    expect(within(tomatoRow).getByText("0,5 kg")).toBeInTheDocument()
    const garlicRow = within(table).getByText("Ajo").closest("tr") as HTMLElement
    expect(garlicRow).not.toHaveAttribute("data-missing")
    expect(screen.getByText(/No hay stock suficiente/)).toBeInTheDocument()
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Producir" })).toBeDisabled()
  })

  it("sends itemId, quantity and the default location, then toasts the lot", async () => {
    h.produce.mutateAsync.mockResolvedValue({ lotCode: "PR-0001-L2", expiresOn: "2026-10-25" })
    render(<ProductionPage description="d" />)
    openProduce()
    fireEvent.click(screen.getByRole("button", { name: "×3 lotes" }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Producir" }))
    })
    expect(h.produce.mutateAsync).toHaveBeenCalledWith({ itemId: "salsa", quantity: 6, locationId: "loc1" })
    expect(h.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("PR-0001-L2") }),
    )
  })

  it("renders the shortages returned by the server", async () => {
    h.produce.mutateAsync.mockRejectedValue(
      new InventoryError("P0001", "Stock insuficiente: Tomate (faltan 1 kg).", [
        { itemId: "tomate", name: "Tomate", unit: "kg", required: 2, available: 1, missing: 1 },
      ]),
    )
    render(<ProductionPage description="d" />)
    openProduce()
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Producir" }))
    })
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Stock insuficiente")
    expect(within(alert).getByText("Tomate: faltan 1 kg")).toBeInTheDocument()
  })
})
