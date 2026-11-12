import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * S13 (design/promociones/03 panel 2): the cashier's order detail shows each
 * line at list price with its discount lines, "Subtotal (precio de lista)",
 * one row per discount, base, tax and total, all from the server.
 */

const orders = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<object>()), ...orders }))
const catalog = vi.hoisted(() => ({ fetchPromotions: vi.fn() }))
vi.mock("@/lib/api/catalog", async (importOriginal) => ({ ...(await importOriginal<object>()), ...catalog }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => true }))
vi.mock("@/lib/api/config", () => ({
  CONFIG_QUERY_KEY: ["config"],
  fetchConfig: async () => ({ allowSelfAuthorization: false }),
}))
vi.mock("@/components/voids/supervisors", () => ({
  SUPERVISORS_QUERY_KEY: ["void-supervisors"],
  loadSupervisors: async () => [],
}))

import { OrderDetail } from "./OrderDetail"
import { toOrder } from "@/lib/api/orders"
import { toCashierOrder, type CashierOrder } from "@/lib/cashier/orders"
import { entryTotals, type QueueEntry } from "@/lib/cashier/queue"
import { mesa7, promo } from "@/lib/cashier/discount-fixtures"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"

const money = (amount: number) => formatCurrency(amount)
const off = (amount: number) => `−${formatCurrency(amount)}`

function renderDetail(order: CashierOrder = toCashierOrder(mesa7())) {
  const entry = {
    key: "table:t-7",
    kind: "table",
    tableId: "t-7",
    tableNumber: 7,
    label: "Mesa 7",
    waiterName: "Andrés",
    zoneName: "Salón",
    orderNumbers: [128],
    guests: 4,
    orders: [order],
    payOrder: order,
    total: order.bill.total,
    openedAt: new Date(2026, 10, 12, 17, 52),
    status: { label: "Abierta", tone: "occupied" },
  } as unknown as QueueEntry
  const items = order.items as unknown as CartItem[]
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <OrderDetail entry={entry} items={items} totals={entryTotals([order])} onReprint={() => {}} />
    </QueryClientProvider>,
  )
}

/** Text without spaces: Money splits its own nodes and formatCurrency uses a no-break space. */
const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")
const text = (node: HTMLElement) => squash(node.textContent)

beforeEach(() => {
  orders.getById.mockReset().mockResolvedValue(mesa7())
  catalog.fetchPromotions.mockReset().mockResolvedValue([promo({ id: "p-cortesia", mode: "manual_pin" })])
})

describe("OrderDetail — discounts (S13)", () => {
  it("shows each line at list price with its discount lines under it", async () => {
    renderDetail()
    const twoForOne = await screen.findByRole("listitem", { name: "Happy hour 2x1" })
    expect(text(twoForOne)).toBe(squash(`Happy hour 2x1 fijado 18:10 ${off(24000)}`))
    const courtesy = screen.getByRole("listitem", { name: "Cortesía de cumpleaños" })
    expect(text(courtesy)).toContain(squash(`Cortesía de cumpleaños Paula R. · PIN ${off(14000)}`))
    // The line stays at list price: 2 × $24.000.
    const mojitos = screen.getAllByRole("row").filter((row) => row.textContent?.startsWith("Mojito"))
    expect(within(mojitos[0]!).getAllByRole("cell").map(text).slice(1)).toEqual(["2", squash(money(24000)), squash(money(48000))])
  })

  it("totals: list subtotal, one row per discount, base, tax and total from the server", async () => {
    renderDetail()
    await screen.findByText("Subtotal (precio de lista)")
    const totals = screen.getByRole("list", { name: "Totales de la cuenta" })
    const rows = within(totals).getAllByRole("listitem").map(text)
    expect(rows).toEqual(
      [
        `Subtotal (precio de lista) ${money(141000)}`,
        `Happy hour 2x1 ${off(24000)}`,
        `Cortesía de cumpleaños ${off(14000)}`,
        `Base ${money(103000)}`,
        `Impuestos 8 % ${money(8240)}`,
        `Total de la cuenta ${money(111240)}`,
      ].map(squash),
    )
  })

  it("removes a manual discount through the sheet", async () => {
    renderDetail()
    fireEvent.click(await screen.findByRole("button", { name: "Quitar Cortesía de cumpleaños" }))
    expect(await screen.findByRole("heading", { name: "¿Quitar este descuento?" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Autorizar y quitar" })).toBeInTheDocument()
  })

  it("opens 'Agregar cortesía o descuento' with the manual promotions", async () => {
    renderDetail()
    await screen.findByRole("listitem", { name: "Happy hour 2x1" })
    fireEvent.click(screen.getByRole("button", { name: "Agregar cortesía o descuento" }))
    const group = await screen.findByRole("radiogroup", { name: "Qué se aplica" })
    await waitFor(() => expect(within(group).getByRole("radio", { name: /Cortesía de cumpleaños/ })).toBeInTheDocument())
    expect(within(group).getByRole("radio", { name: /Descuento manual/ })).toBeInTheDocument()
  })

  it("uses the discounts the cashier list already carries: no order read", async () => {
    renderDetail()
    await screen.findByRole("listitem", { name: "Happy hour 2x1" })
    expect(orders.getById).not.toHaveBeenCalled()
  })

  it("reads the order again when the list's discount records are stale", async () => {
    renderDetail(toOrder(mesa7()))
    await screen.findByRole("listitem", { name: "Happy hour 2x1" })
    expect(orders.getById).toHaveBeenCalledWith("o-1")
  })

  it("an automatic discount has no remove action", async () => {
    renderDetail()
    await screen.findByRole("listitem", { name: "Happy hour 2x1" })
    expect(screen.queryByRole("button", { name: "Quitar Happy hour 2x1" })).not.toBeInTheDocument()
  })
})
