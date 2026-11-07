import { fireEvent, render, screen } from "@testing-library/react"
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
})
