import { api } from "./client"
import type { components } from "./schema"
import { toast } from "@/components/ui/use-toast"
import type { CartItem, CommandPayload, PrintableInvoice } from "@/types"

/**
 * Printing through the API (T8c). Each call queues a durable print job that
 * the API sends to the restaurant's printing services (`pos/app.py`) after
 * commit; a printer that was offline picks it up when it reconnects.
 * Fire-and-forget like the former Supabase broadcasts: a failure shows the
 * same toast and never throws.
 */

type Schemas = components["schemas"]

const notifyFailure = () => {
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
  } catch {
    notifyFailure()
  }
}

/** Kitchen command. The client number is not sent: the print job id replaces it. */
export async function sendCommand(command: CommandPayload): Promise<void> {
  const body: Omit<CommandPayload, "invoiceNumber"> & { invoiceNumber?: string } = { ...command }
  delete body.invoiceNumber
  try {
    await api.POST("/api/print/commands", { body: body as Schemas["CommandPrintRequest"] })
  } catch {
    notifyFailure()
  }
}
