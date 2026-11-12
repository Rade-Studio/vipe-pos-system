import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { toast } from "@/components/ui/use-toast"
import type { CartItem, DeliveryPrintInfo, PrintableInvoice } from "@/types"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import type { SlipBusiness } from "@/components/printing/slip-format"
import type { SlipTax } from "@/components/printing/tax-label"

/**
 * Printing through the API (T8c). Each call queues a durable print job that
 * the API sends to the restaurant's printing services (`pos/app.py`) after
 * commit; a printer that was offline picks it up when it reconnects.
 * Fire-and-forget like the former Supabase broadcasts: a failure shows the
 * same toast and never throws. With stations (F6) the API splits a command
 * into one job per station; a restaurant without printers (printingEnabled
 * off) answers 409 printing_disabled, shown as "Impresión apagada"; the
 * screens hide their print actions first (lib/api/printing).
 */

type Schemas = components["schemas"]

/** S2 (F6): a restaurant that turned printing off answers 409 printing_disabled. */
const isPrintingOff = (error: unknown) => error instanceof ApiError && error.status === 409 && error.body.code === "printing_disabled"

const notifyFailure = (error: unknown) => {
  if (isPrintingOff(error)) {
    toast({
      title: "Impresión apagada",
      description: "Este restaurante no usa impresoras. Actívalas en Ajustes → Estaciones y rutas.",
    })
    return
  }
  toast({
    title: "Error",
    description: "No se pudo enviar la factura a través de la red realtime. Intente nuevamente.",
    variant: "destructive",
  })
}

/** Invoice ticket. `invoiceNumber` is the invoice's own (`invoice.invoiceNumber`). */
export async function sendFactura(
  _invoiceNumber: string,
  invoice: PrintableInvoice,
  displayItems: CartItem[],
): Promise<void> {
  try {
    await api.POST("/api/print/invoices", {
      body: { invoice, displayItems } as unknown as Schemas["InvoicePrintRequest"],
    })
  } catch (error) {
    notifyFailure(error)
  }
}

/**
 * Kitchen command of an order. The API prints the order's number and the
 * sender's name (the PIN-identified person on a shared terminal), so the
 * client sends neither; the print job id is the payload's invoiceNumber.
 */
export type CommandRequest = {
  orderId: string
  items: unknown[]
  /** Null / absent for delivery orders; the order's table wins on the server. */
  table?: number | null
  delivery?: DeliveryPrintInfo
}

export async function sendCommand(command: CommandRequest): Promise<void> {
  try {
    await api.POST("/api/print/commands", { body: command as Schemas["CommandPrintRequest"] })
  } catch (error) {
    notifyFailure(error)
  }
}

/**
 * "Informe X" (informe-x-termico S1): the register summary exactly as
 * GET /registers/summary answered, the slip header and the times. The
 * printers print the times as written, so they go in the cashier's wall time
 * with its offset (`2026-11-10T07:58:00.000-05:00`).
 */
export type XReportJob = {
  business: SlipBusiness
  cashierName: string | null
  openedAt: Date
  printedAt: Date
  summary: RegisterSummary
  tax?: SlipTax
}

const two = (n: number) => String(Math.trunc(n)).padStart(2, "0")

/** ISO date-time in the local wall time with its offset, e.g. `2026-11-10T07:58:00.000-05:00`. */
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? "-" : "+"
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}` +
    `${sign}${two(abs / 60)}:${two(abs % 60)}`
  )
}

/** Why the Informe X did not reach the printer, for the cashier. */
export function xReportFailure(error: unknown): string {
  if (isPrintingOff(error)) return "Este restaurante no usa impresoras. Actívalas en Ajustes → Estaciones y rutas."
  return "No se pudo enviar el Informe X a la impresora. Intente nuevamente o véalo en pantalla."
}

/** Queues the Informe X on the restaurant's printers (Caja when it exists). Throws on failure; `xReportFailure` words it. */
export async function sendXReport({ business, cashierName, openedAt, printedAt, summary, tax }: XReportJob): Promise<void> {
  await api.POST("/api/print/x-reports", {
    body: {
      business,
      cashierName,
      openedAt: localIso(openedAt),
      printedAt: localIso(printedAt),
      summary,
      ...(tax ? { tax } : {}),
    } as Schemas["XReportPrintRequest"],
  })
}
