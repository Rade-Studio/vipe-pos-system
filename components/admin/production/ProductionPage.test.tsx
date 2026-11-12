import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InventoryError } from "@/lib/inventory/errors"
import type { InventoryItem, ProductionBatch } from "@/lib/api/inventory/types"

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  items: [] as unknown[],
  batches: [] as unknown[],
  yesterday: [] as unknown[],
  batchCalls: [] as unknown[],
  templates: [] as unknown[],
  locStock: null as Map<string, number> | null,
  produce: { mutateAsync: vi.fn(), isPending: false },
  bulk: { mutateAsync: vi.fn(), isPending: false },
  createTemplate: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", async (importOriginal) => {
  const actual = await importOriginal<object>()
  const q = (data: unknown) => ({ data, isLoading: false })
  return {
    ...actual,
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
          hogao: {
            recipeId: "r2",
            targetType: "prep",
            targetId: "hogao",
            yieldQuantity: 1,
            notes: null,
            lines: [
              { ingredientId: "tomate", quantity: 1 },
              { ingredientId: "cebolla", quantity: 0.5 },
            ],
          },
        },
      }),
    useProductionBatches: (options?: { from?: string; to?: string }) => {
      h.batchCalls.push(options)
      return q(options && options.from === "2026-11-11" && options.to === "2026-11-11" ? h.yesterday : h.batches)
    },
    useInventoryLocations: () =>
      q([
        { id: "loc2", name: "Cocina", code: "COC", isDefault: false, isActive: true },
        { id: "loc1", name: "Bodega principal", code: "BOD", isDefault: true, isActive: true },
      ]),
    useStaffMembers: () =>
      q([
        { id: "s1", fullName: "Luz Dary", role: "kitchen", active: true },
        { id: "s2", fullName: "Mesero Uno", role: "waiter", active: true },
        { id: "s3", fullName: "Ana Admin", role: "admin", active: true },
        { id: "s4", fullName: "Retirado", role: "kitchen", active: false },
      ]),
    useStockAtLocation: () => h.locStock,
    useProductionTemplates: () => q(h.templates),
    useProducePreparation: () => h.produce,
    useProducePreparations: () => h.bulk,
    useCreateProductionTemplate: () => h.createTemplate,
  }
})

import { ProductionShortageError } from "@/hooks/inventory/use-inventory-mutations"
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
    makeItem({ id: "salsa", sku: "PR-0001", name: "Salsa roja", kind: "prep", unit: "l", stock: 1, shelfLifeDays: 3 }),
    makeItem({ id: "pico", sku: "PR-0002", name: "Pico de gallo", kind: "prep", unit: "kg", stock: 0 }),
    makeItem({ id: "hogao", sku: "PR-0003", name: "Hogao", kind: "prep", unit: "kg", stock: 0.5, minStock: 2 }),
    makeItem({ id: "viejo", sku: "PR-0004", name: "Inactiva", kind: "prep", isActive: false }),
    makeItem({ id: "tomate", name: "Tomate", unit: "kg", stock: tomate, cost: 2000 }),
    makeItem({ id: "ajo", name: "Ajo", unit: "g", stock: 500, cost: 20 }),
    makeItem({ id: "cebolla", name: "Cebolla", unit: "kg", stock: 3, cost: 3000 }),
  ]
}

const batch = (patch: Partial<ProductionBatch>): ProductionBatch => ({
  id: "b1",
  itemId: "salsa",
  itemName: "Salsa roja",
  unit: "l",
  locationId: "loc1",
  locationName: "Bodega principal",
  lotId: "lot1",
  lotCode: "PB-20261112-070500",
  quantity: 2,
  unitCost: 1500,
  totalCost: 3000,
  expiresOn: "2026-11-14",
  notes: null,
  producedOn: "2026-11-12",
  producedBy: { id: "s1", name: "Luz Dary" },
  createdBy: null,
  createdAt: new Date(2026, 10, 12, 7, 5).toISOString(),
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 12, 9, 0))
  h.toast.mockReset()
  h.produce.mutateAsync.mockReset()
  h.bulk.mutateAsync.mockReset()
  h.createTemplate.mutateAsync.mockReset()
  h.batches = []
  h.yesterday = []
  h.batchCalls = []
  h.templates = []
  h.locStock = null
  setStock(10)
})

afterEach(() => {
  vi.useRealTimers()
})

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim()
const openTab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }))
const qtyInput = (name: string) => screen.getByRole("textbox", { name: new RegExp(`^Cantidad producida de ${name}`) })
const typeQty = (name: string, value: string) => fireEvent.change(qtyInput(name), { target: { value } })
const prepRows = () =>
  within(screen.getByRole("table", { name: /^Preparaciones/ }))
    .getAllByRole("row")
    .slice(1)

describe("tabs", () => {
  it("shows three tabs and moves between them with the arrow keys", () => {
    render(<ProductionPage description="d" />)
    const tabs = screen.getAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual(["Preparaciones (3)", "Registrar producción del día", "Lotes"])
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" })
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(tabs[1]).toHaveFocus()
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[1].id)
    fireEvent.keyDown(tabs[1], { key: "End" })
    expect(tabs[2]).toHaveAttribute("aria-selected", "true")
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" })
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    expect(tabs[1]).toHaveAttribute("tabindex", "-1")
  })

  it("no longer renders the old cards nor the lots table on the first tab", () => {
    render(<ProductionPage description="d" />)
    expect(screen.queryByRole("listitem", { name: "Salsa roja" })).not.toBeInTheDocument()
    expect(screen.queryByText("Lotes recientes")).not.toBeInTheDocument()
  })
})

describe("Preparaciones", () => {
  it("sorts Agotadas and Bajas first, filters by chip and searches by code", () => {
    const onNavigate = vi.fn()
    render(<ProductionPage description="d" onNavigate={onNavigate} />)
    expect(prepRows().map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "Pico de galloPR-0002",
      "HogaoPR-0003",
      "Salsa rojaPR-0001",
    ])
    const chips = screen.getByRole("group", { name: "Filtrar preparaciones por estado" })
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Todas 3", "Agotadas 1", "Bajas 1", "OK 1"])
    fireEvent.click(within(chips).getByRole("button", { name: /Bajas/ }))
    expect(within(chips).getByRole("button", { name: /Bajas/ })).toHaveAttribute("aria-pressed", "true")
    expect(prepRows()).toHaveLength(1)
    fireEvent.click(within(chips).getByRole("button", { name: /Todas/ }))
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar preparación" }), { target: { value: "pr-0001" } })
    expect(prepRows()).toHaveLength(1)
    const salsa = prepRows()[0]
    // tomate 10 kg / 1, ajo 500 g / 50 → 10 batches × 2 l; cost per l (2000 + 1000) / 2.
    expect(within(salsa).getByText(/puedes producir 20 l/)).toBeInTheDocument()
    expect(within(salsa).getByText("$ 1.500", { exact: false })).toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar preparación" }), { target: { value: "pico" } })
    const pico = prepRows()[0]
    expect(within(pico).getByText("Sin fórmula")).toBeInTheDocument()
    expect(within(pico).getByText("Agotada")).toBeInTheDocument()
    fireEvent.click(within(pico).getByRole("button", { name: "Crear fórmula" }))
    expect(onNavigate).toHaveBeenCalledWith("formulas")
  })

  it("produces inline with ×3 and the default bodega, then toasts the lot", async () => {
    h.produce.mutateAsync.mockResolvedValue({ lotCode: "PB-1", expiresOn: "2026-11-15" })
    render(<ProductionPage description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Producir Salsa roja" }))
    const form = screen.getByRole("form", { name: "Producir Salsa roja" })
    fireEvent.click(within(form).getByRole("button", { name: "×3" }))
    expect(within(form).getByText(/Lote automático/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Producir 6 l" }))
    })
    expect(h.produce.mutateAsync).toHaveBeenCalledWith({ itemId: "salsa", quantity: 6, locationId: "loc1" })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("PB-1") }))
    expect(screen.queryByRole("form", { name: "Producir Salsa roja" })).not.toBeInTheDocument()
  })

  it("flags missing inputs and disables Producir", () => {
    setStock(1.5)
    render(<ProductionPage description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Producir Salsa roja" }))
    const form = screen.getByRole("form", { name: "Producir Salsa roja" })
    fireEvent.click(within(form).getByRole("button", { name: "×2" }))
    const table = within(form).getByRole("table", { name: "Requerimiento de insumos" })
    const tomato = within(table).getByText("Tomate").closest("tr") as HTMLElement
    expect(tomato).toHaveAttribute("data-missing", "true")
    expect(within(tomato).getByText("0,5 kg")).toBeInTheDocument()
    expect(within(form).getByText(/No hay stock suficiente/)).toBeInTheDocument()
    expect(within(form).getByRole("button", { name: /^Producir/ })).toBeDisabled()
  })

  it("renders the shortages returned by the server", async () => {
    h.produce.mutateAsync.mockRejectedValue(
      new InventoryError("P0001", "Stock insuficiente: Tomate (faltan 1 kg).", [
        { itemId: "tomate", name: "Tomate", unit: "kg", required: 2, available: 1, missing: 1 },
      ]),
    )
    render(<ProductionPage description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Producir Salsa roja" }))
    const form = screen.getByRole("form", { name: "Producir Salsa roja" })
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: /^Producir/ }))
    })
    const alert = within(form).getByRole("alert")
    expect(alert).toHaveTextContent("Stock insuficiente")
    expect(within(alert).getByText("Tomate: faltan 1 kg")).toBeInTheDocument()
  })
})

describe("Registrar producción del día", () => {
  it("shows the context, moves with Enter and ↓ and prices each row", () => {
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    expect(screen.getByText(/Hoy · jue 12 nov/).closest("p")).toHaveTextContent("Hoy · jue 12 nov · Tú · Bodega principal")
    expect(qtyInput("Pico de gallo")).toBeDisabled()
    typeQty("Hogao", "2")
    fireEvent.keyDown(qtyInput("Hogao"), { key: "Enter" })
    expect(qtyInput("Salsa roja")).toHaveFocus()
    fireEvent.keyDown(qtyInput("Salsa roja"), { key: "ArrowUp" })
    expect(qtyInput("Hogao")).toHaveFocus()
    fireEvent.keyDown(qtyInput("Hogao"), { key: "ArrowDown" })
    expect(qtyInput("Salsa roja")).toHaveFocus()
    typeQty("Salsa roja", "4")
    const row = qtyInput("Salsa roja").closest("tr") as HTMLElement
    expect(within(row).getByText("máx. 20 l")).toBeInTheDocument()
    expect(within(row).getByText("$ 6.000", { exact: false })).toBeInTheDocument()
    expect(within(row).getByText(/vence 15 nov/)).toBeInTheDocument()
    const footer = screen.getByRole("region", { name: "Resumen de la producción del día" })
    // hogao 2 kg: tomate 2 × 2000 + cebolla 1 × 3000 = 7000.
    expect(footer).toHaveTextContent("2 preparaciones · costo total $ 13.000")
  })

  it("uses the stock of the chosen bodega for the max", () => {
    h.locStock = new Map([["tomate", 3], ["ajo", 500], ["cebolla", 3]])
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    const row = qtyInput("Salsa roja").closest("tr") as HTMLElement
    expect(within(row).getByText("máx. 6 l")).toBeInTheDocument()
  })

  it("marks a row over its max and blocks registering", () => {
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    typeQty("Salsa roja", "25")
    expect(qtyInput("Salsa roja")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("No alcanzan los insumos: máx. 20 l.")).toBeInTheDocument()
    const footer = screen.getByRole("region", { name: "Resumen de la producción del día" })
    expect(footer).toHaveTextContent("1 con ingredientes insuficientes")
    fireEvent.click(within(footer).getByRole("button", { name: "Revisar y registrar" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Registrar 1 lote" })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Volver y corregir" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("warns about the netted demand of rows that share an ingredient", () => {
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    // salsa 12 l → 6 kg tomate, hogao 5 kg → 5 kg: 11 > 10.
    typeQty("Salsa roja", "12")
    typeQty("Hogao", "5")
    const footer = screen.getByRole("region", { name: "Resumen de la producción del día" })
    expect(footer).toHaveTextContent("2 con ingredientes insuficientes")
    fireEvent.click(within(footer).getByRole("button", { name: "Revisar y registrar" }))
    expect(within(screen.getByRole("dialog")).getByText(/Tomate: juntas necesitan 11 kg y hay 10 kg/)).toBeInTheDocument()
  })

  it("summarizes and registers every lot at once with the chosen date, responsable and bodega", async () => {
    h.bulk.mutateAsync.mockResolvedValue({ batches: [{}, {}], totalCost: 13000 })
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar" }))
    const responsable = screen.getByLabelText("Responsable")
    expect(within(responsable).getAllByRole("option").map((o) => o.textContent)).toEqual(["Tú (quien registra)", "Ana Admin", "Luz Dary"])
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-11" } })
    fireEvent.change(responsable, { target: { value: "s1" } })
    fireEvent.change(screen.getByLabelText("Bodega"), { target: { value: "loc2" } })
    expect(screen.getByText(/Ayer · mié 11 nov/, { selector: "b" }).closest("p")).toHaveTextContent("Ayer · mié 11 nov · Luz Dary · Cocina")
    typeQty("Salsa roja", "4")
    typeQty("Hogao", "2")
    fireEvent.click(screen.getByRole("button", { name: "Revisar y registrar" }))
    const dialog = screen.getByRole("dialog")
    const lots = within(dialog).getByRole("table", { name: "Lotes por crear" })
    expect(within(lots).getAllByRole("row")).toHaveLength(4)
    const ingredients = within(dialog).getByRole("table", { name: "Insumos que se descuentan" })
    expect(within(ingredients).getAllByRole("row")[1]).toHaveTextContent("Tomate")
    expect(dialog).toHaveTextContent("Costo total $ 13.000")
    expect(dialog).toHaveTextContent(/fecha de ayer/)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Registrar 2 lotes" }))
    })
    expect(h.bulk.mutateAsync).toHaveBeenCalledWith({
      lines: [
        { itemId: "hogao", quantity: 2 },
        { itemId: "salsa", quantity: 4 },
      ],
      locationId: "loc2",
      producedOn: "2026-11-11",
      producedBy: "s1",
    })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "2 lotes registrados" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(qtyInput("Salsa roja")).toHaveValue("")
  })

  it("shows the server shortages per preparation when the report is refused", async () => {
    h.bulk.mutateAsync.mockRejectedValue(
      new ProductionShortageError([
        {
          itemId: "salsa",
          name: "Salsa roja",
          ingredients: [{ ingredientId: "tomate", name: "Tomate", unit: "kg", required: 3, available: 1, missing: 2 }],
        },
      ]),
    )
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    typeQty("Salsa roja", "4")
    fireEvent.click(screen.getByRole("button", { name: "Revisar y registrar" }))
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar 1 lote" }))
    })
    const alert = within(screen.getByRole("dialog")).getByRole("alert")
    expect(alert).toHaveTextContent("no se registró ningún lote")
    expect(alert).toHaveTextContent("Salsa roja: faltan 2 kg de Tomate")
    // Nothing was saved: the sheet keeps the quantities (behind the modal).
    expect(screen.getByLabelText(/^Cantidad producida de Salsa roja/)).toHaveValue("4")
  })

  it("repeats yesterday's production summed per preparation", () => {
    h.yesterday = [
      batch({ id: "y1", itemId: "salsa", quantity: 2, producedOn: "2026-11-11" }),
      batch({ id: "y2", itemId: "salsa", quantity: 1.5, producedOn: "2026-11-11" }),
    ]
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    fireEvent.click(screen.getByRole("button", { name: "Llenar cantidades" }))
    fireEvent.click(screen.getByRole("button", { name: /Repetir producción de ayer/ }))
    expect(qtyInput("Salsa roja")).toHaveValue("3,5")
    expect(h.bulk.mutateAsync).not.toHaveBeenCalled()
    expect(h.batchCalls).toContainEqual({ from: "2026-11-11", to: "2026-11-11", limit: 500 })
  })

  it("applies a template and saves the current quantities as one", async () => {
    h.templates = [{ id: "t1", name: "Lunes", lines: [{ itemId: "hogao", quantity: 1.5 }], createdAt: "", updatedAt: "" }]
    h.createTemplate.mutateAsync
      .mockRejectedValueOnce(new InventoryError("23505", "Ya existe una plantilla con ese nombre"))
      .mockResolvedValueOnce({ id: "t2" })
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    fireEvent.click(screen.getByRole("button", { name: "Llenar cantidades" }))
    fireEvent.click(screen.getByRole("button", { name: /^Lunes/ }))
    expect(qtyInput("Hogao")).toHaveValue("1,5")
    typeQty("Salsa roja", "4")
    fireEvent.click(screen.getByRole("button", { name: "Llenar cantidades" }))
    fireEvent.click(screen.getByRole("button", { name: /Guardar como plantilla/ }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Nombre de la plantilla"), { target: { value: "Lunes" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar plantilla" }))
    })
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Ya existe una plantilla con ese nombre")
    fireEvent.change(within(dialog).getByLabelText("Nombre de la plantilla"), { target: { value: "Martes" } })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Guardar plantilla" }))
    })
    expect(h.createTemplate.mutateAsync).toHaveBeenLastCalledWith({
      name: "Martes",
      lines: [
        { itemId: "hogao", quantity: 1.5 },
        { itemId: "salsa", quantity: 4 },
      ],
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("imports a CSV report and downloads the template", async () => {
    const created: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return "blob:x"
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    render(<ProductionPage description="d" />)
    openTab(/Registrar/)
    fireEvent.click(screen.getByRole("button", { name: "Llenar cantidades" }))
    fireEvent.click(screen.getByRole("button", { name: /Importar desde reporte \(CSV\)/ }))
    expect(screen.getByText(/Descarga la plantilla/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Descargar plantilla (CSV)" }))
    expect(click).toHaveBeenCalled()
    const template = await created[0].text()
    // Blob.text() drops the BOM; production-csv.test.ts pins it.
    expect(template).toBe(
      "codigo;preparacion;unidad;cantidad\r\nPR-0003;Hogao;kg;\r\nPR-0002;Pico de gallo;kg;\r\nPR-0001;Salsa roja;l;\r\n",
    )
    const file = new File(["codigo;cantidad\nPR-0001;4,5\nPR-0003;\nPR-0099;2\n"], "reporte.csv", { type: "text/csv" })
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Elegir archivo CSV del reporte"), { target: { files: [file] } })
    })
    expect(qtyInput("Salsa roja")).toHaveValue("4,5")
    expect(qtyInput("Hogao")).toHaveValue("")
    expect(screen.getByRole("status")).toHaveTextContent("Se cargaron 1 cantidades del reporte · no reconocimos: PR-0099.")
    click.mockRestore()
  })
})

describe("Lotes", () => {
  it("groups the last 7 days by produced day, filters and exports", async () => {
    h.batches = [
      batch({ id: "b1", producedOn: "2026-11-12", lotCode: "PB-HOY", expiresOn: "2026-11-14", totalCost: 3000 }),
      batch({
        id: "b2",
        itemId: "hogao",
        itemName: "Hogao",
        unit: "kg",
        producedOn: "2026-11-11",
        lotCode: "PB-AYER",
        expiresOn: "2026-11-30",
        totalCost: 1000,
        quantity: 1.5,
        createdAt: new Date(2026, 10, 11, 16, 20).toISOString(),
      }),
    ]
    const created: Blob[] = []
    Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (created.push(b), "blob:x")), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    render(<ProductionPage description="d" />)
    openTab(/Lotes/)
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-05")
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-12")
    expect(h.batchCalls).toContainEqual({ from: "2026-11-05", to: "2026-11-12", limit: 500 })
    const table = screen.getByRole("table", { name: /Lotes agrupados por día/ })
    const groups = within(table).getAllByRole("rowgroup").slice(1)
    expect(groups.map((g) => norm(within(g).getAllByRole("row")[0].textContent))).toEqual([
      "Hoy · jue 12 nov1 lote · $ 3.000",
      "Ayer · mié 11 nov1 lote · $ 1.000",
    ])
    const hogao = within(groups[1]).getAllByRole("row")[1]
    expect(within(hogao).getAllByRole("cell").map((c) => norm(c.textContent))).toEqual([
      "16:20",
      "Hogao",
      "1,5 kg",
      "PB-AYER",
      expect.stringContaining("2026-11-30"),
      "Luz Dary",
      "$ 1.000",
    ])
    fireEvent.click(screen.getByRole("button", { name: /Vence pronto/ }))
    expect(within(table).queryByText("PB-AYER")).not.toBeInTheDocument()
    expect(within(table).getByText("PB-HOY")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Vence pronto/ }))
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar lote o preparación" }), { target: { value: "ayer" } })
    expect(within(table).queryByText("PB-HOY")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }))
    const text = await created[0].text()
    expect(text.split("\r\n")).toHaveLength(3)
    expect(text).toContain("PB-AYER")
    fireEvent.change(screen.getByLabelText("Preparación"), { target: { value: "salsa" } })
    expect(h.batchCalls).toContainEqual({ from: "2026-11-05", to: "2026-11-12", limit: 500, itemId: "salsa" })
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2025-01-01" } })
    expect(screen.getByText("El rango no puede superar 366 días.")).toBeInTheDocument()
    click.mockRestore()
  })
})
