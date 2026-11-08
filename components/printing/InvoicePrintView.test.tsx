import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8c (S3) — "Imprimir" queues the invoice through the API print queue
 * (`lib/api/print.sendFactura`), with the grouped lines the screen shows.
 */

const env = vi.hoisted(() => ({ sendFactura: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/api/print", () => ({ sendFactura: env.sendFactura }))
const printing = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => printing.enabled }))
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
})
