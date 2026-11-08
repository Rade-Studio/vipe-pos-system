import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { toast } from "@/components/ui/use-toast"
import type { CartItem, DeliveryPrintInfo, PrintableInvoice } from "@/types"

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
