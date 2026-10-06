/**
 * `invoice-tenders` — pure adapter between the multi-tender payment
 * domain and the printable invoice shape.
 *
 * No Supabase, no React, no DOM. The invoice needs the display name
 * for each tender line, but the server's `pay_order` echo only carries
 * the method `code` (no `id` is round-tripped) and the ledger's
 * `PaymentRow` only carries the method `id` (the snapshot's `code`
 * is preserved but may be stale if the tenant renamed the method).
 * Both helpers look the name up in the active catalog; when the
 * catalog has no row, the snapshot/code is used as the display name
 * and the kind is taken from the tender snapshot (so a cash tender
 * without a catalog row is still rendered as cash).
 *
 * `legacyInvoiceFields` keeps the single-label block on
 * `PrintableInvoice.paymentMethod` correct for the OLD Python
 * listener: "multiple" when more than one distinct method was used,
 * the code otherwise; `cashReceived` is the sum of every cash line's
 * `cashReceived` (with `null` defaulting to `amount`), and
 * `cashChange` is the total change across all cash lines. Empty
 * tenders fall back to safe defaults so a legacy listener never
 * crashes.
 */

import type { PaymentMethodKind, PayOrderResult } from './types'
import type { PaymentRow } from './payment-list'

/**
 * One row of the printable invoice's payment block. Carries the
 * display name resolved from the catalog and the cash snapshot
 * needed to print "Recibido" / "Cambio" on the ticket.
 */
export interface InvoiceTender {
  methodCode: string
  methodName: string
  methodKind: PaymentMethodKind
  amount: number
  /** `null` for electronic lines; the cash the customer handed over for cash lines. */
  cashReceived: number | null
}

/**
 * Minimum catalog shape the helpers need. Matches the public
 * `PaymentMethodOption` from `./types`; declared structurally here so
 * the file stays free of UI-only fields.
 */
export interface InvoiceTenderCatalogLike {
  id: string
  code: string
  name: string
  kind: PaymentMethodKind
}

/**
 * Build the invoice tenders from a `payOrder` result + the active
 * catalog. The echo only carries the `methodCode`, so the catalog is
 * matched by code (not by id). When the catalog has no row for the
 * code, the code itself is the display name and the line is treated
 * as `electronic` (the safe default — claiming "cash" for an unknown
 * code would be a lie about whether the listener needs to print
 * "Recibido" / "Cambio").
 */
export function invoiceTendersFromPayOrder(
  result: PayOrderResult,
  catalog: readonly InvoiceTenderCatalogLike[],
): InvoiceTender[] {
  return result.tenders.map((t) => {
    const row = catalog.find((c) => c.code === t.methodCode)
    return {
      methodCode: t.methodCode,
      methodName: row?.name ?? t.methodCode,
      methodKind: row?.kind ?? (t.cashReceived !== null ? 'cash' : 'electronic'),
      amount: t.amount,
      cashReceived: t.cashReceived,
    }
  })
}

/**
 * Build the invoice tenders from a ledger `PaymentRow` + the active
 * catalog (optional). Match is by `id`. When the catalog has no row
 * (renamed or deleted), the snapshot's `methodCode` is the display
 * name and the snapshot's `methodKind` is the kind — the ledger
 * freezes the snapshot at payment time, so it can never go stale.
 */
export function invoiceTendersFromPayment(
  payment: PaymentRow,
  catalog?: readonly InvoiceTenderCatalogLike[],
): InvoiceTender[] {
  return payment.tenders.map((t) => {
    const row = catalog?.find((c) => c.id === t.paymentMethodId)
    return {
      methodCode: t.methodCode,
      methodName: row?.name ?? t.methodCode,
      methodKind: row?.kind ?? t.methodKind,
      amount: t.amount,
      cashReceived: t.cashReceived,
    }
  })
}

/**
 * Shape the legacy `PrintableInvoice.paymentMethod` / `cashReceived` /
 * `cashChange` fields take. The old Python listener reads those
 * three fields and renders a single label; we keep them correct so
 * existing installations keep working while the new payload
 * (tenders + change) ships additively.
 */
export interface LegacyInvoiceFields {
  /**
   * `"multiple"` when more than one distinct method was used, the
   * method's `code` otherwise. Defaults to `"cash"` for empty input
   * so the listener never has to handle `undefined`.
   */
  paymentMethod: string
  /**
   * Sum of every cash line's `cashReceived` (with `null` defaulting
   * to the line's `amount`). `null` when no cash was tendered.
   */
  cashReceived: number | null
  /** Total change across every cash line. `0` when nothing was returned. */
  cashChange: number
}

/**
 * Derive the legacy `PrintableInvoice` fields from the new
 * `InvoiceTender[]`. `cashChange` is the sum of
 * `(cashReceived ?? amount) - amount` per cash line, which collapses
 * to the sum of `cashReceived - amount` for the common case and to
 * `0` for any line with a missing `cashReceived`.
 */
export function legacyInvoiceFields(tenders: readonly InvoiceTender[]): LegacyInvoiceFields {
  if (tenders.length === 0) {
    return { paymentMethod: 'cash', cashReceived: null, cashChange: 0 }
  }
  const distinct = new Set(tenders.map((t) => t.methodCode))
  const paymentMethod = distinct.size > 1 ? 'multiple' : tenders[0]!.methodCode
  const cashLines = tenders.filter((t) => t.methodKind === 'cash')
  const cashReceived =
    cashLines.length > 0
      ? cashLines.reduce((sum, t) => sum + (t.cashReceived ?? t.amount), 0)
      : null
  const cashChange = cashLines.reduce(
    (sum, t) => sum + ((t.cashReceived ?? t.amount) - t.amount),
    0,
  )
  return { paymentMethod, cashReceived, cashChange }
}
