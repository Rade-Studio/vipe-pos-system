import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8c (S3) — "Imprimir" queues the invoice through the API print queue
 * (`lib/api/print.sendFactura`), with the grouped lines the screen shows.
 */

const env = vi.hoisted(() => ({ sendFactura: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/api/print", () => ({ sendFactura: env.sendFactura }))
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
})
