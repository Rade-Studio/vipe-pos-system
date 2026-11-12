import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryItem, InventoryLocation, InventoryTransfer, TransferStatus } from "@/lib/api/inventory/types"

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    toast: vi.fn(),
    items: [] as unknown[],
    locations: [] as unknown[],
    transfers: [] as unknown[],
    stock: new Map<string, Map<string, number>>(),
    create: mutation(),
    update: mutation(),
    send: mutation(),
    receive: mutation(),
    cancel: mutation(),
  }
})

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }))
vi.mock("@/hooks/inventory", () => ({
  useInventoryItems: () => ({ data: h.items, isLoading: false }),
  useInventoryLocations: () => ({ data: h.locations, isLoading: false }),
  useStockAtLocation: (ids: readonly string[], locationId: string) =>
    new Map(ids.map((id) => [id, h.stock.get(locationId)?.get(id) ?? 0])),
}))
vi.mock("@/hooks/admin/use-transfers", () => ({
  useTransfers: () => ({ data: h.transfers, isLoading: false }),
  useCreateTransfer: () => h.create,
  useUpdateTransfer: () => h.update,
  useSendTransfer: () => h.send,
  useReceiveTransfer: () => h.receive,
  useCancelTransfer: () => h.cancel,
}))

import { TransfersPage } from "./TransfersPage"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function () {}

const item = (id: string, name: string, cost: number, unit = "kg"): InventoryItem => ({
  id,
  sku: `MP-${id}`,
  name,
  description: null,
  kind: "raw",
  unit,
  barcode: null,
  cost,
  stock: 100,
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
})

const chicken = item("c", "Pechuga de pollo", 10000)
const lemon = item("l", "Limón", 2000)

const locations: InventoryLocation[] = [
  { id: "bp", name: "Bodega principal", code: "BP", isDefault: true, isActive: true },
  { id: "sn", name: "Sede Norte", code: "SN", isDefault: false, isActive: true },
]

const transfer = (number: number, status: TransferStatus, patch: Partial<InventoryTransfer> = {}): InventoryTransfer => ({
  id: `t${number}`,
  number,
  status,
  fromLocationId: "bp",
  fromLocationName: "Bodega principal",
  toLocationId: "sn",
  toLocationName: "Sede Norte",
  notes: null,
  createdBy: "u1",
  createdByName: "Mariana R.",
  sentBy: status === "draft" ? null : "u1",
  sentByName: status === "draft" ? null : "Mariana R.",
  sentAt: status === "draft" ? null : "2026-11-12T16:40:00Z",
  receivedBy: null,
  receivedByName: null,
  receivedAt: null,
  cancelledBy: null,
  cancelledByName: null,
  cancelledAt: null,
  createdAt: "2026-11-12T16:00:00Z",
  updatedAt: "2026-11-12T16:00:00Z",
  lines: [
    { id: `${number}-a`, itemId: "c", itemName: "Pechuga de pollo", sku: "MP-c", unit: "kg", requestedQuantity: 8, receivedQuantity: null, shortfallQuantity: null, shortfallReason: null },
    { id: `${number}-b`, itemId: "l", itemName: "Limón", sku: "MP-l", unit: "kg", requestedQuantity: 3, receivedQuantity: null, shortfallQuantity: null, shortfallReason: null },
  ],
  ...patch,
})

const table = () => screen.getByRole("table", { name: /Transferencias entre bodegas/ })
const row = (number: string) => within(table()).getByText(number).closest("tr") as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  h.items = [chicken, lemon]
  h.locations = locations
  h.stock = new Map([
    ["bp", new Map([["c", 18.4], ["l", 4]])],
    ["sn", new Map([["c", 3]])],
  ])
  h.transfers = [
    transfer(9, "draft"),
    transfer(8, "in_transit"),
    transfer(6, "received"),
    transfer(5, "received_short"),
    transfer(3, "cancelled"),
  ]
  for (const m of [h.create, h.update, h.send, h.receive, h.cancel]) m.mutateAsync.mockResolvedValue(transfer(10, "in_transit"))
})

describe("transfer list", () => {
  it("counts every status, filters by chip and shows the in-transit strip by destination", () => {
    render(<TransfersPage description="" />)
    const chips = screen.getByRole("group", { name: "Filtrar por estado" })
    expect(within(chips).getByRole("button", { name: "Todas 5" })).toHaveAttribute("aria-pressed", "true")
    for (const name of ["Borrador 1", "En tránsito 1", "Recibida 1", "Recibida con faltante 1", "Anulada 1"])
      expect(within(chips).getByRole("button", { name })).toBeInTheDocument()

    const strip = screen.getByRole("region", { name: "Stock en camino" })
    expect(strip).toHaveTextContent("En tránsito: 1 transferencia")
    expect(strip).toHaveTextContent(/Hacia Sede Norte · 1 transferencia · \$\s?86\.000/)

    expect(row("TR-0008")).toHaveTextContent(/Bodega principal.*Sede Norte/)
    expect(row("TR-0008")).toHaveTextContent("2 artículos")
    expect(row("TR-0008")).toHaveTextContent("Mariana R.")

    fireEvent.click(within(chips).getByRole("button", { name: "Recibida con faltante 1" }))
    expect(within(table()).queryByText("TR-0008")).not.toBeInTheDocument()
    expect(within(table()).getByText("TR-0005")).toBeInTheDocument()
    expect(screen.getByText("1 de 5 transferencias")).toBeInTheDocument()
  })

  it("offers Enviar for a draft, Recibir and Anular in transit and Ver otherwise, inside the row", async () => {
    render(<TransfersPage description="" />)
    expect(within(row("TR-0009")).getByRole("button", { name: "Enviar" })).toBeInTheDocument()
    expect(within(row("TR-0008")).getByRole("button", { name: "Recibir" })).toBeInTheDocument()
    expect(within(row("TR-0008")).getByRole("button", { name: "Anular" })).toBeInTheDocument()
    for (const n of ["TR-0006", "TR-0005", "TR-0003"]) expect(within(row(n)).getByRole("button", { name: `Ver ${n}` })).toBeInTheDocument()

    await act(async () => fireEvent.click(within(row("TR-0009")).getByRole("button", { name: "Enviar" })))
    expect(h.send.mutateAsync).toHaveBeenCalledWith("t9")
  })

  it("cancels after a confirmation that the stock returns to the origin", async () => {
    render(<TransfersPage description="" />)
    fireEvent.click(within(row("TR-0008")).getByRole("button", { name: "Anular" }))
    const dialog = await screen.findByRole("alertdialog", { name: "¿Anular TR-0008?" })
    expect(dialog).toHaveTextContent("vuelven a Bodega principal")
    expect(h.cancel.mutateAsync).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Anular y devolver el stock" })))
    expect(h.cancel.mutateAsync).toHaveBeenCalledWith("t8")
  })
})

describe("receive", () => {
  it("blocks more than was sent and requires a reason for a shortfall that goes to merma en tránsito", async () => {
    render(<TransfersPage description="" />)
    fireEvent.click(within(row("TR-0008")).getByRole("button", { name: "Recibir" }))
    const dialog = await screen.findByRole("dialog", { name: /Recibir TR-0008 en Sede Norte/ })
    const confirm = within(dialog).getByRole("button", { name: "Confirmar recepción" })
    const chickenIn = within(dialog).getByRole("textbox", { name: "Cantidad que llegó de Pechuga de pollo" })

    fireEvent.change(chickenIn, { target: { value: "9" } })
    expect(dialog).toHaveTextContent("No puede llegar más de lo enviado")
    expect(confirm).toBeDisabled()

    fireEvent.change(chickenIn, { target: { value: "7,5" } })
    expect(dialog).toHaveTextContent("merma en tránsito")
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText("Motivo del faltante de Pechuga de pollo"), { target: { value: "Se dañó en el camino" } })
    expect(confirm).toBeEnabled()

    await act(async () => fireEvent.click(confirm))
    expect(h.receive.mutateAsync).toHaveBeenCalledWith({
      id: "t8",
      lines: [
        { lineId: "8-a", receivedQuantity: 7.5, shortfallReason: "Se dañó en el camino" },
        { lineId: "8-b", receivedQuantity: 3 },
      ],
    })
  })
})

describe("new transfer page", () => {
  const openNew = () => {
    render(<TransfersPage description="" />)
    fireEvent.click(screen.getByRole("button", { name: /Nueva transferencia/ }))
  }

  const addItem = async (text: string) => {
    const input = screen.getByRole("combobox", { name: "Agregar artículo" })
    input.focus()
    fireEvent.change(input, { target: { value: text } })
    await screen.findByRole("listbox")
    fireEvent.keyDown(input, { key: "Enter" })
  }

  it("is a page, not a modal: no overlay and an outside click keeps the progress", async () => {
    openNew()
    expect(screen.getByRole("heading", { name: "Nueva transferencia" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("table", { name: /Transferencias entre bodegas/ })).not.toBeInTheDocument()
    await addItem("pollo")
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(screen.getByRole("heading", { name: "Nueva transferencia" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Cantidad de Pechuga de pollo" })).toBeInTheDocument()
  })

  it("shows the origin stock, blocks quantities above it, fills Todo, swaps and sends", async () => {
    openNew()
    expect(screen.getByLabelText("Desde")).toHaveValue("bp")
    expect(screen.getByLabelText("Hacia")).toHaveValue("sn")
    await addItem("pollo")
    const line = screen.getByRole("textbox", { name: "Cantidad de Pechuga de pollo" }).closest("tr") as HTMLElement
    expect(line).toHaveTextContent("18,4 kg")
    const send = screen.getByRole("button", { name: /Enviar transferencia/ })

    fireEvent.change(within(line).getByRole("textbox"), { target: { value: "20" } })
    expect(line).toHaveTextContent("Máximo 18,4 kg en Bodega principal")
    expect(send).toBeDisabled()
    expect(screen.getByRole("region", { name: "Resumen de la transferencia" })).toHaveTextContent("1 línea supera el disponible")

    fireEvent.click(within(line).getByRole("button", { name: "Pasar todo el disponible de Pechuga de pollo" }))
    expect(within(line).getByRole("textbox")).toHaveValue("18,4")
    expect(send).toBeEnabled()
    expect(screen.getByRole("region", { name: "Resumen de la transferencia" })).toHaveTextContent(/1 artículo · \$\s?184\.000/)

    fireEvent.click(screen.getByRole("button", { name: "Intercambiar origen y destino" }))
    expect(screen.getByLabelText("Desde")).toHaveValue("sn")
    expect(line).toHaveTextContent("Máximo 3 kg en Sede Norte")
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Intercambiar origen y destino" }))

    await addItem("limón")
    fireEvent.click(screen.getByRole("button", { name: "Quitar Limón" }))
    expect(screen.queryByRole("textbox", { name: "Cantidad de Limón" })).not.toBeInTheDocument()

    await act(async () => fireEvent.click(send))
    expect(h.create.mutateAsync).toHaveBeenCalledWith({
      fromLocationId: "bp",
      toLocationId: "sn",
      notes: null,
      lines: [{ itemId: "c", quantity: 18.4 }],
    })
    expect(h.send.mutateAsync).toHaveBeenCalledWith("t10")
    await waitFor(() => expect(screen.getByRole("table", { name: /Transferencias entre bodegas/ })).toBeInTheDocument())
  })

  it("saves a draft without sending", async () => {
    openNew()
    await addItem("pollo")
    fireEvent.change(screen.getByRole("textbox", { name: "Cantidad de Pechuga de pollo" }), { target: { value: "2" } })
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" })))
    expect(h.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ itemId: "c", quantity: 2 }] }))
    expect(h.send.mutateAsync).not.toHaveBeenCalled()
  })

  it("asks before leaving with unsaved changes and leaves at once without them", async () => {
    openNew()
    fireEvent.click(screen.getByRole("button", { name: "Transferencias" }))
    expect(screen.getByRole("table", { name: /Transferencias entre bodegas/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Nueva transferencia/ }))
    await addItem("pollo")
    fireEvent.click(screen.getByRole("button", { name: "Transferencias" }))
    const confirm = await screen.findByRole("alertdialog", { name: "¿Salir de la transferencia?" })
    fireEvent.click(within(confirm).getByRole("button", { name: "Seguir editando" }))
    expect(screen.getByRole("textbox", { name: "Cantidad de Pechuga de pollo" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Transferencias" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Salir sin guardar" }))
    await waitFor(() => expect(screen.getByRole("table", { name: /Transferencias entre bodegas/ })).toBeInTheDocument())
  })
})
