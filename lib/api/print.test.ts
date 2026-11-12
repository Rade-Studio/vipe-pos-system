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

import { localIso, sendCommand, sendFactura, sendXReport, xReportFailure } from "./print"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import type { PrintableInvoice } from "@/types"

const ORDER = "0f0e0d0c-0000-4000-8000-000000000001"

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
  it("posts the order id and lines, never a client number or waiter (the API fills both)", async () => {
    await sendCommand({ orderId: ORDER, table: 4, items: [{ name: "Ajiaco", quantity: 2 }] })

    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/print/commands", {
      body: { orderId: ORDER, table: 4, items: [{ name: "Ajiaco", quantity: 2 }] },
    })
    expect(toast).not.toHaveBeenCalled()
  })

  it("keeps a delivery command's null table and delivery block", async () => {
    const delivery = { customerName: "Ana", phone: "3001", address: "Calle 2", paymentMode: "prepaid" as const, deliveryFee: 5000 }
    await sendCommand({ orderId: ORDER, table: null, items: [{ name: "Ajiaco", quantity: 1 }], delivery })

    expect(api.POST).toHaveBeenCalledWith("/api/print/commands", {
      body: { orderId: ORDER, table: null, items: [{ name: "Ajiaco", quantity: 1 }], delivery },
    })
  })

  it("shows the former failure toast when the API refuses, and never throws", async () => {
    api.POST.mockRejectedValue(new Error("422"))
    await expect(sendCommand({ orderId: ORDER, items: [] })).resolves.toBeUndefined()
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

  it("S8: sends the invoice's orderType and customerName when set, and adds no keys when absent", async () => {
    const takeaway = { invoiceNumber: "F-3", table: "—", orderType: "takeaway", customerName: "Ana" } as unknown as PrintableInvoice
    await sendFactura("F-3", takeaway, [])
    expect(api.POST.mock.calls[0]![1].body.invoice).toEqual({ invoiceNumber: "F-3", table: "—", orderType: "takeaway", customerName: "Ana" })

    const plain = { invoiceNumber: "F-4", table: 4 } as unknown as PrintableInvoice
    await sendFactura("F-4", plain, [])
    expect(JSON.stringify(api.POST.mock.calls[1]![1].body)).toBe('{"invoice":{"invoiceNumber":"F-4","table":4},"displayItems":[]}')
  })

  it("S14: sends the invoice's discounts and list-price subtotal in the print job", async () => {
    const invoice = {
      invoiceNumber: "F-2",
      items: [{ id: "i-1", name: "Mojito", price: 24000, quantity: 2, discounts: [{ label: "Happy hour 2x1", amount: 24000, orderItemId: "i-1" }] }],
      bill: { subtotal: 39000, grossSubtotal: 48000, totalDiscounts: 9000 },
      discounts: [{ label: "Cortesía", amount: 5000, orderItemId: null }],
    } as unknown as PrintableInvoice
    await sendFactura("F-2", invoice, invoice.items)

    const body = api.POST.mock.calls[0]![1].body
    expect(body.invoice.discounts).toEqual([{ label: "Cortesía", amount: 5000, orderItemId: null }])
    expect(body.invoice.bill.grossSubtotal).toBe(48000)
    expect(body.displayItems[0].discounts).toEqual([{ label: "Happy hour 2x1", amount: 24000, orderItemId: "i-1" }])
  })

  it("shows the former failure toast when the request fails", async () => {
    api.POST.mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(sendFactura("F-1", { invoiceNumber: "F-1" } as never, [])).resolves.toBeUndefined()
    expect(toast).toHaveBeenCalledWith(FAILURE_TOAST)
  })
})

describe("printing turned off (F6, S2)", () => {
  it("tells the user printing is off instead of the network error", async () => {
    const { ApiError } = await import("./errors")
    const off = new ApiError(409, "Conflict", "Este restaurante no usa impresoras", { code: "printing_disabled" })
    api.POST.mockRejectedValue(off)
    await expect(sendCommand({ orderId: ORDER, items: [{ name: "Ajiaco", quantity: 1 }] })).resolves.toBeUndefined()
    await expect(sendFactura("F-1", { invoiceNumber: "F-1" } as unknown as PrintableInvoice, [])).resolves.toBeUndefined()
    expect(toast).toHaveBeenCalledTimes(2)
    expect(toast).toHaveBeenCalledWith({
      title: "Impresión apagada",
      description: "Este restaurante no usa impresoras. Actívalas en Ajustes → Estaciones y rutas.",
    })
  })
})

describe("sendXReport (informe-x-termico S1)", () => {
  const summary = { totalSales: 1486200, methods: [], legacy: { byMethod: {} } } as unknown as RegisterSummary
  const job = {
    business: { name: "La Fonda", nit: "900", address: "Calle 1" },
    cashierName: "Camilo Henao",
    openedAt: new Date(2026, 10, 10, 7, 58),
    printedAt: new Date(2026, 10, 10, 13, 30, 5, 9),
    summary,
  }

  it("posts the summary untouched with the header and the times in the local wall time", async () => {
    await sendXReport({ ...job, tax: { type: "INC", rate: 8 } })
    expect(api.POST).toHaveBeenCalledWith("/api/print/x-reports", {
      body: {
        business: job.business,
        cashierName: "Camilo Henao",
        openedAt: localIso(job.openedAt),
        printedAt: localIso(job.printedAt),
        summary,
        tax: { type: "INC", rate: 8 },
      },
    })
    expect(api.POST.mock.calls[0]![1].body.summary).toBe(summary)
    expect(localIso(job.printedAt)).toMatch(/^2026-11-10T13:30:05\.009[+-]\d{2}:\d{2}$/)
    expect(toast).not.toHaveBeenCalled()
  })

  it("sends no tax key without a tax setting", async () => {
    await sendXReport(job)
    expect(Object.keys(api.POST.mock.calls[0]![1].body)).not.toContain("tax")
  })

  it("throws so the caller can offer the screen view, worded by xReportFailure", async () => {
    const { ApiError } = await import("./errors")
    api.POST.mockRejectedValue(new TypeError("Failed to fetch"))
    const error = await sendXReport(job).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(xReportFailure(error)).toBe("No se pudo enviar el Informe X a la impresora. Intente nuevamente o véalo en pantalla.")
    const off = new ApiError(409, "Conflict", "Este restaurante no usa impresoras", { code: "printing_disabled" })
    expect(xReportFailure(off)).toBe("Este restaurante no usa impresoras. Actívalas en Ajustes → Estaciones y rutas.")
    expect(toast).not.toHaveBeenCalled()
  })
})
