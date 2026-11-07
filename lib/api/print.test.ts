import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8c (S1, S3) — invoices and kitchen commands go to the API print queue
 * (`POST /api/print/*`), which forwards them to the restaurant's printing
 * services only. Same signatures and failure toasts as the former Supabase
 * broadcasts; the command's random number is replaced by the job id.
 */

const api = vi.hoisted(() => ({ POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast }))

import { sendCommand, sendFactura } from "./print"
import type { CommandPayload, PrintableInvoice } from "@/types"

const FAILURE_TOAST = {
  title: "Error",
  description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
  variant: "destructive",
}

beforeEach(() => {
  api.POST.mockReset().mockResolvedValue({ data: { id: "job-1", kind: "command", createdAt: "2026-11-04T12:00:00.000Z" } })
  toast.mockReset()
})

describe("sendCommand", () => {
  it("posts the command without the client number", async () => {
    const command: CommandPayload = { invoiceNumber: "1234", table: 4, waiter: "Ana", items: [{ name: "Ajiaco", quantity: 2 }] }
    await sendCommand(command)

    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/print/commands", {
      body: { table: 4, waiter: "Ana", items: [{ name: "Ajiaco", quantity: 2 }] },
    })
    expect(toast).not.toHaveBeenCalled()
  })

  it("keeps a delivery command's null table and delivery block", async () => {
    const delivery = { customerName: "Ana", phone: "3001", address: "Calle 2", paymentMode: "prepaid" as const, deliveryFee: 5000 }
    await sendCommand({ invoiceNumber: "9", table: null, waiter: "Domicilios", items: [{ name: "Ajiaco", quantity: 1 }], delivery })

    expect(api.POST).toHaveBeenCalledWith("/api/print/commands", {
      body: { table: null, waiter: "Domicilios", items: [{ name: "Ajiaco", quantity: 1 }], delivery },
    })
  })

  it("shows the former failure toast when the API refuses, and never throws", async () => {
    api.POST.mockRejectedValue(new Error("422"))
    await expect(sendCommand({ invoiceNumber: "1", waiter: "Ana", items: [] })).resolves.toBeUndefined()
    expect(toast).toHaveBeenCalledWith(FAILURE_TOAST)
  })
})

describe("sendFactura", () => {
  it("posts the invoice and its display lines", async () => {
    const invoice = { invoiceNumber: "F-1", table: 4 } as unknown as PrintableInvoice
    const lines = [{ id: "d-1", name: "Ajiaco", price: 28000, quantity: 1 }] as never[]
    await sendFactura("F-1", invoice, lines)

    expect(api.POST).toHaveBeenCalledWith("/api/print/invoices", { body: { invoice, displayItems: lines } })
    expect(toast).not.toHaveBeenCalled()
  })

  it("shows the former failure toast when the request fails", async () => {
    api.POST.mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(sendFactura("F-1", { invoiceNumber: "F-1" } as never, [])).resolves.toBeUndefined()
    expect(toast).toHaveBeenCalledWith(FAILURE_TOAST)
  })
})

describe("printing turned off (F6, S2)", () => {
  it("stays silent when the restaurant does not use printers", async () => {
    const { ApiError } = await import("./errors")
    const off = new ApiError(409, "Conflict", "Este restaurante no usa impresoras", { code: "printing_disabled" })
    api.POST.mockRejectedValue(off)
    await expect(sendCommand({ invoiceNumber: "1", waiter: "Ana", items: [{ name: "Ajiaco", quantity: 1 }] })).resolves.toBeUndefined()
    await expect(sendFactura("F-1", { invoiceNumber: "F-1" } as unknown as PrintableInvoice, [])).resolves.toBeUndefined()
    expect(toast).not.toHaveBeenCalled()
  })
})
