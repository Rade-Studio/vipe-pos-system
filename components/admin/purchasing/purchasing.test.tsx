import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItem, InventoryLocation, PurchaseOrder, Supplier } from "@/lib/supabase/inventory/types"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    toast: vi.fn(),
    items: [] as unknown[],
    suppliers: [] as unknown[],
    locations: [] as unknown[],
    orders: [] as unknown[],
    order: undefined as unknown,
    createPurchaseOrder: mutation(),
    updatePurchaseOrder: mutation(),
    setStatus: mutation(),
    setPayment: mutation(),
    deletePurchaseOrder: mutation(),
    addLine: mutation(),
    updateLine: mutation(),
    removeLine: mutation(),
    receive: mutation(),
    createSupplier: mutation(),
    updateSupplier: mutation(),
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => {
  const q = (data: unknown) => ({ data, isLoading: false })
  return {
    useInventoryItems: () => q(h.items),
    useSuppliers: () => q(h.suppliers),
    useInventoryLocations: () => q(h.locations),
    usePurchaseOrders: () => q(h.orders),
    usePurchaseOrder: (id: string | null) => q(id ? h.order : undefined),
    useCreatePurchaseOrder: () => h.createPurchaseOrder,
    useUpdatePurchaseOrder: () => h.updatePurchaseOrder,
    useSetPurchaseOrderStatus: () => h.setStatus,
    useSetPurchaseOrderPaymentStatus: () => h.setPayment,
    useDeletePurchaseOrder: () => h.deletePurchaseOrder,
    useAddPurchaseOrderLine: () => h.addLine,
    useUpdatePurchaseOrderLine: () => h.updateLine,
    useRemovePurchaseOrderLine: () => h.removeLine,
    useReceivePurchaseOrder: () => h.receive,
    useCreateSupplier: () => h.createSupplier,
    useUpdateSupplier: () => h.updateSupplier,
  }
})

import { PurchasesPage } from "./PurchasesPage"
import { ReceiveDialog } from "./ReceiveDialog"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}

const makeItem = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "i1",
  sku: "MP-0001",
  name: "Tomate",
  description: null,
  kind: "raw",
  unit: "kg",
  barcode: null,
  cost: 4000,
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

const supplier = (id: string, name: string): Supplier => ({
  id,
  name,
  taxId: null,
  contactName: null,
  phone: null,
  email: null,
  leadTimeDays: null,
  notes: null,
  isActive: true,
})

const locations: InventoryLocation[] = [
  { id: "l2", name: "Cocina", code: "COC", isDefault: false, isActive: true },
  { id: "l1", name: "Bodega principal", code: "BP", isDefault: true, isActive: true },
]

const milk = makeItem({ id: "milk", sku: "MP-0002", name: "Leche", unit: "l", cost: 3000, purchaseUnit: "caja", purchaseFactor: 12 })

const draftOrder = (patch: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: "po1",
  number: 7,
  supplierId: "s1",
  supplierName: "Lácteos",
  locationId: "l1",
  locationName: "Bodega principal",
  status: "draft",
  expectedOn: null,
  paymentStatus: "pending",
  notes: null,
  orderedAt: null,
  receivedAt: null,
  createdAt: "2026-10-19",
  lines: [
    { id: "L1", itemId: "milk", itemName: "Leche", sku: "MP-0002", unit: "l", quantity: 24, unitCost: 3000, receivedQuantity: 0, pendingQuantity: 24, total: 72000 },
  ],
  total: 72000,
  ...patch,
})

beforeEach(() => {
  h.toast.mockClear()
  h.items = []
  h.suppliers = [supplier("s1", "Lácteos"), supplier("s2", "Verduras SAS")]
  h.locations = locations
  h.orders = []
  h.order = undefined
  for (const m of [
    h.createPurchaseOrder,
    h.updatePurchaseOrder,
    h.setStatus,
    h.setPayment,
    h.deletePurchaseOrder,
    h.addLine,
    h.updateLine,
    h.removeLine,
    h.receive,
    h.createSupplier,
    h.updateSupplier,
  ]) {
    m.mutateAsync.mockReset().mockResolvedValue({})
  }
  h.createPurchaseOrder.mutateAsync.mockResolvedValue({ id: "new", number: 9 })
})

describe("purchase suggestion", () => {
  beforeEach(() => {
    h.items = [
      makeItem({ id: "a", name: "Leche", unit: "l", stock: 1, minStock: 6, maxStock: 30, cost: 3000, purchaseUnit: "caja", purchaseFactor: 12, defaultSupplierId: "s1" }),
      makeItem({ id: "b", name: "Tomate", stock: 0, minStock: 2, maxStock: 10, cost: 4000, defaultSupplierId: "s2" }),
      makeItem({ id: "c", name: "Sal", unit: "g", stock: 10, minStock: 100, cost: 2 }),
      makeItem({ id: "d", name: "Arroz", stock: 50, minStock: 2, defaultSupplierId: "s1" }),
    ]
  })

  it("groups items to reorder by default supplier, with a Sin proveedor group", () => {
    render(<PurchasesPage description="" />)
    const lacteos = screen.getByRole("region", { name: "Sugerencia Lácteos" })
    expect(within(lacteos).getByText("Leche")).toBeInTheDocument()
    expect(within(lacteos).queryByText("Arroz")).not.toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Sugerencia Verduras SAS" })).getByText("Tomate")).toBeInTheDocument()
    const none = screen.getByRole("region", { name: "Sugerencia Sin proveedor" })
    expect(within(none).getByText("Sal")).toBeInTheDocument()
    expect(within(none).getByRole("button", { name: "Elegir proveedor" })).toBeInTheDocument()
  })

  it("Crear borrador creates the draft with suggested base quantities and last cost", async () => {
    render(<PurchasesPage description="" />)
    const lacteos = screen.getByRole("region", { name: "Sugerencia Lácteos" })
    await act(async () => fireEvent.click(within(lacteos).getByRole("button", { name: "Crear borrador" })))
    // need = 30 − 1 = 29 l → rounded up to 3 cajas of 12 = 36 l
    expect(h.createPurchaseOrder.mutateAsync).toHaveBeenCalledWith({
      supplierId: "s1",
      locationId: "l1",
      expectedOn: null,
      notes: null,
      lines: [{ itemId: "a", quantity: 36, unitCost: 3000 }],
    })
  })
})

describe("order editor", () => {
  const typeAndEnter = async (text: string) => {
    const input = screen.getByRole("combobox", { name: "Agregar artículo" })
    input.focus()
    fireEvent.change(input, { target: { value: text } })
    await screen.findByRole("listbox")
    fireEvent.keyDown(input, { key: "Enter" })
  }

  beforeEach(() => {
    h.items = [milk]
  })

  it("preselects the default location, converts purchase units to base and saves the draft", async () => {
    render(<PurchasesPage description="" />)
    fireEvent.click(screen.getByRole("button", { name: /Nueva orden/ }))
    expect(screen.getByLabelText("Bodega de destino")).toHaveValue("l1")
    fireEvent.change(screen.getByLabelText("Proveedor", { selector: "#po-supplier" }), { target: { value: "s1" } })
    await typeAndEnter("leche")
    const quantity = await screen.findByRole("textbox", { name: "Cantidad Leche" })
    await waitFor(() => expect(quantity).toHaveFocus())
    expect(screen.getByText(/= 12/)).toBeInTheDocument()
    fireEvent.change(quantity, { target: { value: "2" } })
    const cost = screen.getByRole("spinbutton", { name: "Costo unitario Leche" })
    fireEvent.change(cost, { target: { value: "30000" } })
    fireEvent.blur(cost)
    expect(screen.getByLabelText("Total de la orden")).toHaveTextContent("60.000")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" })))
    expect(h.createPurchaseOrder.mutateAsync).toHaveBeenCalledWith({
      supplierId: "s1",
      locationId: "l1",
      expectedOn: null,
      notes: null,
      lines: [{ itemId: "milk", quantity: 24, unitCost: 2500 }],
    })
    expect(h.setStatus.mutateAsync).not.toHaveBeenCalled()
  })

  it("shows Spanish validation errors and does not save an incomplete draft", async () => {
    render(<PurchasesPage description="" />)
    fireEvent.click(screen.getByRole("button", { name: /Nueva orden/ }))
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" })))
    expect(screen.getByText("Selecciona un proveedor")).toBeInTheDocument()
    expect(screen.getByText("Agrega al menos un artículo")).toBeInTheDocument()
    expect(h.createPurchaseOrder.mutateAsync).not.toHaveBeenCalled()
  })

  it("Enviar saves an existing draft and sets the status to ordered", async () => {
    h.orders = [draftOrder()]
    h.order = draftOrder()
    render(<PurchasesPage description="" />)
    fireEvent.click(within(screen.getByRole("table")).getByText("Lácteos"))
    expect(await screen.findByRole("textbox", { name: "Cantidad Leche" })).toHaveValue("2")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enviar/ })))
    expect(h.updatePurchaseOrder.mutateAsync).toHaveBeenCalledWith({
      id: "po1",
      patch: { supplierId: "s1", locationId: "l1", expectedOn: null, notes: null },
    })
    expect(h.addLine.mutateAsync).not.toHaveBeenCalled()
    expect(h.setStatus.mutateAsync).toHaveBeenCalledWith({ id: "po1", status: "ordered" })
  })

  it("creates a supplier inline and selects it", async () => {
    h.createSupplier.mutateAsync.mockResolvedValue(supplier("s9", "Nuevo"))
    render(<PurchasesPage description="" />)
    fireEvent.click(screen.getByRole("button", { name: /Nueva orden/ }))
    fireEvent.change(screen.getByLabelText("Proveedor", { selector: "#po-supplier" }), { target: { value: "__new__" } })
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "Nuevo" } })
    h.suppliers = [...h.suppliers, supplier("s9", "Nuevo")]
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))
    expect(h.createSupplier.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "Nuevo" }))
    await waitFor(() => expect(screen.getByLabelText("Proveedor", { selector: "#po-supplier" })).toHaveValue("s9"))
  })
})

describe("ReceiveDialog", () => {
  const order = draftOrder({
    status: "ordered",
    lines: [
      { id: "L1", itemId: "milk", itemName: "Leche", sku: "MP-0002", unit: "l", quantity: 24, unitCost: 3000, receivedQuantity: 0, pendingQuantity: 24, total: 72000 },
      { id: "L2", itemId: "cheese", itemName: "Queso", sku: "MP-0003", unit: "kg", quantity: 5, unitCost: 20000, receivedQuantity: 2, pendingQuantity: 3, total: 100000 },
      { id: "L3", itemId: "salt", itemName: "Sal", sku: "MP-0004", unit: "g", quantity: 100, unitCost: 2, receivedQuantity: 100, pendingQuantity: 0, total: 200 },
    ],
  })

  beforeEach(() => {
    h.items = [milk, makeItem({ id: "cheese", name: "Queso", trackLots: true })]
    h.receive.mutateAsync.mockResolvedValue({ purchaseOrderId: "po1", status: "partially_received", receivedLines: 1, totalCost: 1 })
  })

  it("lists pending lines only, with lot fields for lot-tracked items, and requires expiry", async () => {
    render(<ReceiveDialog order={order} onOpenChange={() => {}} />)
    expect(screen.queryByLabelText("Recibir Sal")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Recibir Queso")).toHaveValue("3")
    expect(screen.queryByLabelText("Lote Leche")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Lote Queso")).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" })))
    expect(screen.getByText("La fecha de vencimiento es obligatoria")).toBeInTheDocument()
    expect(h.receive.mutateAsync).not.toHaveBeenCalled()
  })

  it("sends only rows with quantity > 0, then shows the new status and toggles payment", async () => {
    render(<ReceiveDialog order={order} onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Recibir Leche"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("Lote Queso"), { target: { value: "Q-1" } })
    fireEvent.change(screen.getByLabelText("Vencimiento Queso"), { target: { value: "2026-11-30" } })
    fireEvent.change(screen.getByLabelText("Costo unitario Queso"), { target: { value: "21000" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" })))
    expect(h.receive.mutateAsync).toHaveBeenCalledWith({
      purchaseOrderId: "po1",
      lines: [{ lineId: "L2", quantity: 3, unitCost: 21000, lotCode: "Q-1", expiresOn: "2026-11-30" }],
    })
    expect(screen.getByText("Recibida parcial")).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Orden pagada" })))
    expect(h.setPayment.mutateAsync).toHaveBeenCalledWith({ id: "po1", paymentStatus: "paid" })
  })

  it("Recibir todo restores every pending quantity and rejects over-receipt", async () => {
    render(<ReceiveDialog order={order} onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText("Recibir Leche"), { target: { value: "30" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmar recepción" })))
    expect(screen.getByText("No puedes recibir más de lo pendiente")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Recibir todo" }))
    expect(screen.getByLabelText("Recibir Leche")).toHaveValue("24")
  })
})

describe("suppliers", () => {
  it("creates a supplier from the Proveedores view and deactivates another", async () => {
    render(<PurchasesPage description="" />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Proveedores" }))
    fireEvent.click(screen.getByRole("tab", { name: "Proveedores" }))
    const table = await screen.findByRole("table")
    expect(within(table).getByText("Verduras SAS")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Nuevo proveedor/ }))
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Carnes del Valle" } })
    fireEvent.change(screen.getByLabelText("NIT"), { target: { value: "900123" } })
    fireEvent.change(screen.getByLabelText("Plazo de entrega (días)"), { target: { value: "3" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar" })))
    expect(h.createSupplier.mutateAsync).toHaveBeenCalledWith({
      name: "Carnes del Valle",
      taxId: "900123",
      contactName: null,
      phone: null,
      email: null,
      leadTimeDays: 3,
      notes: null,
    })
    await act(async () => fireEvent.click(within(table).getAllByRole("button", { name: "Desactivar" })[0]))
    expect(h.updateSupplier.mutateAsync).toHaveBeenCalledWith({ id: "s1", input: { isActive: false } })
  })
})
