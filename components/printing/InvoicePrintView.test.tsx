import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8c (S3) — "Imprimir" queues the invoice through the API print queue
 * (`lib/api/print.sendFactura`), with the grouped lines the screen shows.
 */

const env = vi.hoisted(() => ({ sendFactura: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/api/print", () => ({ sendFactura: env.sendFactura }))
const printing = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => printing.enabled }))
const config = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@/lib/api/config", async (importOriginal) => ({ ...(await importOriginal<object>()), fetchConfig: config.fetch }))
vi.mock("@/utils/toast", () => ({ toast: { success: env.success, error: env.error } }))

import { InvoicePrintView } from "./InvoicePrintView"
import type { PrintableInvoice } from "@/types"
import { formatCurrency } from "@/utils/helpers"

const invoice = {
  invoiceNumber: "F-0001",
  date: new Date("2026-11-04T15:00:00.000Z"),
  businessInfo: { name: "VIPE Dev", address: "Calle 1", phone: "300", nit: "900" },
  items: [
    { id: "d-1", name: "Ajiaco", price: 28000, quantity: 1 },
    { id: "d-1", name: "Ajiaco", price: 28000, quantity: 1 },
  ],
  bill: { subtotal: 56000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 56000, totalDiscounts: 0 },
  waiter: "Mesero Dev",
  table: 4,
  paymentMethod: "cash",
} as unknown as PrintableInvoice

beforeEach(() => {
  printing.enabled = true
  env.sendFactura.mockReset()
  env.success.mockReset()
})

describe("InvoicePrintView", () => {
  it("sends the invoice to the print queue once per click", () => {
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)

    fireEvent.click(screen.getAllByRole("button", { name: /Imprimir/ })[0])

    expect(env.sendFactura).toHaveBeenCalledTimes(1)
    const [number, sent, lines] = env.sendFactura.mock.calls[0]
    expect(number).toBe("F-0001")
    expect(sent).toBe(invoice)
    expect(lines).toEqual([expect.objectContaining({ id: "d-1", name: "Ajiaco", quantity: 2 })])
    expect(env.success).toHaveBeenCalledWith("Imprimiendo factura...")
  })

  it("keeps the invoice on screen without any print action when the restaurant does not use printers (F6, S2)", () => {
    printing.enabled = false
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)

    expect(screen.getAllByText("F-0001").length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: /Imprimir/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Imprimir factura")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument()
    expect(env.sendFactura).not.toHaveBeenCalled()
  })

  it("labels a takeaway invoice 'Para llevar · <nombre>' without the Mesa: prefix (S8)", () => {
    render(<InvoicePrintView invoice={{ ...invoice, table: "Para llevar · Ana" }} open onOpenChange={() => {}} />)
    expect(screen.getByText("Para llevar · Ana")).toBeInTheDocument()
    expect(screen.queryByText("Mesa:")).not.toBeInTheDocument()
  })

  it("sends a takeaway invoice to the thermal ticket as PARA LLEVAR · <nombre>, without MESA: (S8)", () => {
    const { container } = render(<InvoicePrintView invoice={{ ...invoice, table: "Para llevar · Ana" }} open onOpenChange={() => {}} />)
    const ticket = container.ownerDocument.querySelector(".ticket")!
    expect(ticket.textContent).toContain("PARA LLEVAR · Ana")
    expect(ticket.textContent).not.toContain("MESA:")
  })

  it("keeps the Mesa: label on a table invoice", () => {
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)
    expect(screen.getByText("Mesa:")).toBeInTheDocument()
  })

  it("offers the three print actions when printing is on", () => {
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)
    expect(screen.getAllByRole("button", { name: /Imprimir/ }).length).toBeGreaterThanOrEqual(2)
  })

  it("keeps lines with different options apart, shows their prices and sends them with the options (F7)", () => {
    const ched = { groupId: "g-a", groupName: "Adiciones", optionId: "o-ched", name: "Queso cheddar", price: 3000 }
    const medio = { groupId: "g-t", groupName: "Término", optionId: "o-medio", name: "Medio", price: 0 }
    const burger = { id: "d-2", name: "Hamburguesa", quantity: 1 }
    const withOptions = {
      ...invoice,
      items: [
        { ...burger, price: 25000, modifiers: [medio, ched] },
        { ...burger, price: 25000, modifiers: [ched, medio] },
        { ...burger, price: 22000, modifiers: [medio] },
        { ...burger, price: 22000 },
      ],
    } as unknown as PrintableInvoice
    render(<InvoicePrintView invoice={withOptions} open onOpenChange={() => {}} />)

    const lists = screen.getAllByRole("list", { name: "Opciones" })
    expect(lists).toHaveLength(2)
    expect(within(lists[0]).getByText("+ Queso cheddar")).toBeInTheDocument()
    expect(lists[0].textContent).toContain(formatCurrency(3000))
    fireEvent.click(screen.getAllByRole("button", { name: /Imprimir/ })[0])
    const lines = env.sendFactura.mock.calls[0][2]
    expect(lines.map((l: { quantity: number; modifiers?: unknown[] }) => [l.quantity, l.modifiers?.length ?? 0])).toEqual([
      [2, 2],
      [1, 1],
      [1, 0],
    ])
  })

  it("still groups identical lines without options into one (F7 preserve)", () => {
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)
    expect(screen.queryByRole("list", { name: "Opciones" })).toBeNull()
  })

  it("labels the tax with the configured type (caja-cierres S9), INC by default", async () => {
    const taxed = { ...invoice, bill: { ...invoice.bill, tax: 4480, taxPercentage: 8 } } as unknown as PrintableInvoice
    const { unmount } = render(<InvoicePrintView invoice={taxed} open onOpenChange={() => {}} />)
    expect(screen.getByText("INC (8 %):")).toBeInTheDocument()
    expect(screen.queryByText(/^IVA \(/)).toBeNull()
    unmount()

    config.fetch.mockResolvedValue({ taxType: "IVA" })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InvoicePrintView invoice={taxed} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText("IVA (8 %):")).toBeInTheDocument()
  })
})

describe("InvoicePrintView discounts (S14)", () => {
  const discounted = {
    ...invoice,
    items: [
      { id: "m-1", name: "Mojito", price: 24000, quantity: 1, discounts: [{ label: "Happy hour 2x1", amount: 12000 }] },
      { id: "m-1", name: "Mojito", price: 24000, quantity: 1, discounts: [{ label: "Happy hour 2x1", amount: 12000 }] },
      { id: "t-1", name: "Tres leches", price: 14000, quantity: 1 },
    ],
    discounts: [
      { label: "Happy hour 2x1", amount: 24000, orderItemId: "m-1" },
      { label: "Cortesía cumpleaños", amount: 14000, orderItemId: null },
    ],
    bill: { subtotal: 24000, grossSubtotal: 62000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 24000, totalDiscounts: 38000 },
  } as unknown as PrintableInvoice

  const row = (label: string) => screen.getByText(label).parentElement!

  it("prints each discount under its item, the bill discount after the items, Subtotal, Descuentos, Base and Hoy ahorraste", () => {
    render(<InvoicePrintView invoice={discounted} open onOpenChange={() => {}} />)

    const mojito = screen.getByText("Mojito").closest(".grid")!
    expect(within(mojito as HTMLElement).getByText("Happy hour 2x1").parentElement!.textContent).toBe(
      `Happy hour 2x1-${formatCurrency(24000)}`,
    )
    expect(row("Cortesía cumpleaños").textContent).toBe(`Cortesía cumpleaños-${formatCurrency(14000)}`)
    expect(row("Subtotal:").textContent).toContain(formatCurrency(62000))
    expect(row("Descuentos:").textContent).toContain(`-${formatCurrency(38000)}`)
    expect(row("Base:").textContent).toContain(formatCurrency(24000))
    expect(screen.getByText(/^Hoy ahorraste/).textContent).toBe(`Hoy ahorraste ${formatCurrency(38000)}`)
  })

  it("sends the grouped line with its summed discounts", () => {
    render(<InvoicePrintView invoice={discounted} open onOpenChange={() => {}} />)
    fireEvent.click(screen.getAllByRole("button", { name: /Imprimir/ })[0])
    expect(env.sendFactura.mock.calls[0][2][0]).toEqual(
      expect.objectContaining({ name: "Mojito", quantity: 2, discounts: [{ label: "Happy hour 2x1", amount: 24000 }] }),
    )
  })

  it("shows no discount rows and no Hoy ahorraste without discounts", () => {
    render(<InvoicePrintView invoice={invoice} open onOpenChange={() => {}} />)
    expect(row("Subtotal:").textContent).toContain(formatCurrency(56000))
    expect(screen.queryByText("Descuentos:")).toBeNull()
    expect(screen.queryByText("Base:")).toBeNull()
    expect(screen.queryByText(/Hoy ahorraste/)).toBeNull()
  })
})

describe("InvoicePrintView totals layout (S10)", () => {
  const row = (label: string) => screen.getByText(label).parentElement!

  it("shows an older invoice with only totalDiscounts in the previous layout: net Subtotal, IVA, then Descuentos", () => {
    const older = {
      ...invoice,
      bill: { subtotal: 50000, tax: 4000, taxPercentage: 8, tip: 0, tipPercentage: 0, total: 54000, totalDiscounts: 6000 },
    } as unknown as PrintableInvoice
    render(<InvoicePrintView invoice={older} open onOpenChange={() => {}} />)

    expect(row("Subtotal:").textContent).toBe(`Subtotal:${formatCurrency(50000)}`)
    expect(screen.queryByText("Base:")).toBeNull()
    expect(screen.queryByText(/Hoy ahorraste/)).toBeNull()
    const totals = row("Subtotal:").parentElement!
    const labels = Array.from(totals.children).map((el) => el.firstElementChild?.textContent)
    expect(labels.indexOf("Descuentos:")).toBeGreaterThan(labels.indexOf("IVA (8%):"))
    expect(within(totals).getByText("Descuentos:").parentElement!.textContent).toBe(`Descuentos:-${formatCurrency(6000)}`)
  })
})
