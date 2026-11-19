import type { components } from "@/lib/api/schema"

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): the DIAN data of an
 * invoice. The server stores a snapshot on each payment when it assigns the
 * number (`invoiceFiscal`), so a reprint prints the data in force when the
 * order was charged. These helpers turn it into the printed lines
 * (`PrintableInvoice.fiscalLines`, read by the screen, `renderInvoice`,
 * pos/print_renderer.py and desktop/core) and the cashier's warnings.
 */
export type InvoiceFiscal = components["schemas"]["InvoiceFiscal"]
export type TaxRegime = NonNullable<InvoiceFiscal["taxRegime"]>
export type InvoiceWarning = components["schemas"]["PayOrderResult"]["invoiceWarnings"][number]

/** What an open order's bill shows instead of a number: the payment assigns it. */
export const UNASSIGNED_INVOICE_NUMBER = "Se asigna al cobrar"

/** Ajustes labels of each regime. */
export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  responsable_iva: "Responsable de IVA",
  no_responsable_iva: "No responsable de IVA",
  regimen_simple: "Régimen Simple de Tributación",
}

/** YYYY-MM-DD as DD/MM/YYYY. */
export const dayLabel = (iso: string) => iso.split("-").reverse().join("/")

/** The printed DIAN lines (at most 32 characters each for a usual resolution); none without a snapshot. */
export function fiscalLines(fiscal: InvoiceFiscal | null | undefined): string[] {
  if (!fiscal) return []
  const lines: string[] = []
  if (fiscal.taxRegime) lines.push(TAX_REGIME_LABELS[fiscal.taxRegime].toUpperCase())
  if (fiscal.resolution) lines.push(`RES. DIAN No. ${fiscal.resolution}`)
  if (fiscal.validFrom && fiscal.validTo) lines.push(`DEL ${dayLabel(fiscal.validFrom)} AL ${dayLabel(fiscal.validTo)}`)
  else if (fiscal.validTo) lines.push(`VIGENTE HASTA ${dayLabel(fiscal.validTo)}`)
  else if (fiscal.validFrom) lines.push(`VIGENTE DESDE ${dayLabel(fiscal.validFrom)}`)
  if (fiscal.rangeTo !== null) lines.push(`NUMERACIÓN ${fiscal.prefix}-${fiscal.rangeFrom} AL ${fiscal.prefix}-${fiscal.rangeTo}`)
  return lines
}

/** The cashier's notice for each warning of a payment (the payment is registered either way). */
export function invoiceWarningMessages(
  warnings: readonly InvoiceWarning[] | undefined,
  fiscal: InvoiceFiscal | null | undefined,
  invoiceNumber: string | null | undefined,
): string[] {
  if (!warnings?.length || !fiscal) return []
  const end = `${fiscal.prefix}-${fiscal.rangeTo ?? ""}`
  const validTo = fiscal.validTo ? dayLabel(fiscal.validTo) : ""
  return warnings.map((warning) => {
    switch (warning) {
      case "range_ending":
        return `Quedan pocos números de factura autorizados (hasta ${end}). Pide a la DIAN una nueva resolución.`
      case "range_exceeded":
        return `La factura ${invoiceNumber ?? ""} supera el rango autorizado por la DIAN (hasta ${end}). Actualiza la resolución en Ajustes.`
      case "resolution_expiring":
        return `La resolución DIAN vence el ${validTo}. Renuévala a tiempo.`
      case "resolution_expired":
        return `La resolución DIAN venció el ${validTo}. Actualízala en Ajustes.`
    }
  })
}
