/**
 * lib/print/renderKitchenOrder.ts
 *
 * Shared print-renderer data structure for kitchen commandas.
 * Mirrors `pos/print_renderer.py` so both the web preview
 * and the Python listener produce equivalent textual output.
 *
 * The renderer returns a data structure (PrintLine[]) that:
 *   - The web side (KitchenOrderPrintView) uses to build HTML for browser printing.
 *   - The Python side (pos/print_renderer.build_comanda_bytes) uses to build ESC/POS bytes.
 *
 * Manual verification: pass the same order payload to both renderers and
 * compare the resulting byte streams.
 */

import type { DeliveryPrintInfo } from '@/types'

export interface PrintLine {
  text: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface KitchenOrderRender {
  lines: PrintLine[]
  footer: PrintLine[]
}

/**
 * Render a kitchen comanda from an order payload.
 *
 * Mirrors `pos/print_renderer.render_kitchen_order(order)` in Python.
 */
export function renderKitchenOrder(order: {
  orderNumber?: string
  invoiceNumber?: string
  /** Absent / null for delivery orders. */
  table?: string | number | null
  waiter: string
  items: Array<{ name: string; quantity: number; comments?: string }>
  delivery?: DeliveryPrintInfo
}): KitchenOrderRender {
  const orderNumber = order.orderNumber ?? order.invoiceNumber ?? ''
  const delivery = order.delivery
  const tableDisplay = typeof order.table === 'number' ? `Mesa ${order.table}` : order.table
  const dateDisplay = new Date().toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const lines: PrintLine[] = delivery
    ? [
        { text: 'COMANDA — DOMICILIO', bold: true, align: 'center' },
        { text: `Fecha:  ${dateDisplay}`, bold: false, align: 'left' },
        { text: `Cliente: ${delivery.customerName || 'N/A'}`, bold: false, align: 'left' },
        { text: `Mesero: ${order.waiter}`, bold: false, align: 'left' },
        { text: '--------------------------------', bold: false, align: 'center' },
      ]
    : [
        { text: `COMANDA — ${tableDisplay}`, bold: true, align: 'center' },
        { text: `Fecha:  ${dateDisplay}`, bold: false, align: 'left' },
        { text: `Mesero: ${order.waiter}`, bold: false, align: 'left' },
        { text: '--------------------------------', bold: false, align: 'center' },
      ]

  for (const item of order.items) {
    const name = (item.name || '').toUpperCase()
    lines.push({
      text: `${name.padEnd(30)}${item.quantity}x`,
      bold: false,
      align: 'left',
    })
    if (item.comments?.trim()) {
      lines.push({ text: `  ${item.comments.trim()}`, bold: false, align: 'left' })
    }
  }

  const notes = delivery?.notes?.trim()
  if (notes) lines.push({ text: `NOTAS: ${notes}`, bold: false, align: 'left' })

  lines.push({ text: '--------------------------------', bold: false, align: 'center' })

  const footer: PrintLine[] = [{ text: 'VipePOS', bold: true, align: 'center' }]

  return { lines, footer }
}

/**
 * Render an invoice from its component parts.
 * Mirrors `pos/print_renderer.render_invoice(...)` in Python.
 */
export interface InvoiceRenderLine {
  text: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface InvoiceRender {
  lines: InvoiceRenderLine[]
}

export function formatCurrency(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function renderInvoice(params: {
  invoiceNumber: string
  invoice: {
    businessInfo: { name: string; nit: string; address: string; phone: string }
    bill: {
      subtotal: number
      tax: number
      taxPercentage: number
      tip: number
      tipPercentage: number
      total: number
      totalDiscounts: number
    }
    date?: string
    table?: string | number
    waiter?: string
    paymentMethod?: string
    cashReceived?: number
    cashChange?: number
    /**
     * Tender lines for the multi-method print path. When present and
     * non-empty, the ticket renders `FORMAS DE PAGO:` + one
     * `NAME  $amount` line per tender (plus `RECIBIDO` / `CAMBIO`
     * per cash line and a total `CAMBIO` line) instead of the
     * legacy single-label block. The legacy fields are still used
     * as a fallback so old invoices keep printing unchanged.
     */
    tenders?: Array<{
      methodCode: string
      methodName: string
      methodKind: 'cash' | 'electronic'
      amount: number
      cashReceived: number | null
    }>
    /** Total change across every cash line. New payload field. */
    change?: number
    /** Delivery block: prints customer / address / fee instead of MESA / MESERO. */
    delivery?: DeliveryPrintInfo
  }
  displayItems: Array<{
    name: string
    quantity: number
    price: number
    originalPrice?: number
    comments?: string
    promotionName?: string
  }>
}): InvoiceRender {
  const { invoice, displayItems } = params
  const business = invoice.businessInfo
  const bill = invoice.bill

  const dateStr = invoice.date
    ? new Date(invoice.date).toLocaleString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleString('es-CO')

  const tableDisplay =
    invoice.table != null
      ? typeof invoice.table === 'number'
        ? `Mesa ${invoice.table}`
        : invoice.table
      : 'N/A'

  const lines: InvoiceRenderLine[] = []

  // Header
  for (const text of [
    (business.name || 'RESTAURANTE').toUpperCase(),
    `NIT: ${business.nit || 'N/A'}`,
    business.address || 'N/A',
    `Tel: ${business.phone || 'N/A'}`,
    '--------------------------------',
  ]) {
    lines.push({ text, align: 'center' })
  }

  // Invoice info
  lines.push({ text: `FACTURA: ${params.invoiceNumber}`, align: 'left' })
  lines.push({ text: `FECHA: ${dateStr}`, align: 'left' })
  const delivery = invoice.delivery
  if (delivery) {
    lines.push({ text: `CLIENTE: ${delivery.customerName || 'N/A'}`, align: 'left' })
    lines.push({ text: `TEL: ${delivery.phone || 'N/A'}`, align: 'left' })
    lines.push({ text: `DIRECCION: ${delivery.address || 'N/A'}`, align: 'left' })
    if (delivery.paymentMode === 'cash_on_delivery' && (delivery.cashChangeFor ?? 0) > 0) {
      lines.push({ text: `CAMBIO PARA: ${formatCurrency(delivery.cashChangeFor!)}`, align: 'left' })
    }
  } else {
    lines.push({ text: `MESA: ${tableDisplay}`, align: 'left' })
    if (invoice.waiter) lines.push({ text: `MESERO: ${invoice.waiter}`, align: 'left' })
  }
  lines.push({ text: '--------------------------------', align: 'center' })

  // Items header
  lines.push({ text: 'CANT DESCRIPCION            IMPORTE', align: 'left' })

  // Items
  for (const item of displayItems) {
    const price = item.price * item.quantity
    lines.push({
      text: `${item.quantity.toString().padEnd(4)}${(item.name || '').slice(0, 20).padEnd(20)}${formatCurrency(price).padStart(10)}`,
      align: 'left',
    })
    if (item.comments) {
      lines.push({ text: `  (${item.comments})`, align: 'left' })
    }
  }

  lines.push({ text: '--------------------------------', align: 'center' })

  // Totals
  lines.push({ text: `SUBTOTAL: ${formatCurrency(bill.subtotal)}`, align: 'left' })
  lines.push({ text: `IVA: ${formatCurrency(bill.tax)}`, align: 'left' })
  if (bill.totalDiscounts > 0) {
    lines.push({
      text: `DESCUENTOS: -${formatCurrency(bill.totalDiscounts)}`,
      align: 'left',
    })
  }

  // The delivery fee is part of what pay_order charges, before the tip.
  const deliveryFee = delivery?.deliveryFee ?? 0
  if (delivery) lines.push({ text: `DOMICILIO: ${formatCurrency(deliveryFee)}`, align: 'left' })

  const subtotalNoTip = bill.subtotal + bill.tax + deliveryFee
  lines.push({ text: `TOTAL SIN PROPINA: ${formatCurrency(subtotalNoTip)}`, align: 'left' })
  lines.push({
    text: `PROPINA VOLUNTARIA (${bill.tipPercentage}%): ${formatCurrency(bill.tip)}`,
    align: 'left',
  })
  lines.push({ text: `TOTAL A PAGAR: ${formatCurrency(bill.total)}`, bold: true, align: 'left' })

  lines.push({ text: '--------------------------------', align: 'center' })

  // Payment method. The multi-tender path takes over when there is at
  // least one tender line; otherwise we fall back to the legacy
  // single-label block (so historical invoices reprint unchanged).
  const tenders = invoice.tenders ?? []
  if (tenders.length > 0) {
    lines.push({ text: 'FORMAS DE PAGO:', align: 'left' })
    // `invoice.change` is the authoritative total the new payload
    // carries (server-derived via `legacyInvoiceFields`). When it is
    // missing (e.g. a hand-built test fixture) we fall back to the
    // per-line change so the total stays correct.
    let totalChange = invoice.change ?? 0
    for (const t of tenders) {
      lines.push({
        text: `${(t.methodName || t.methodCode).toUpperCase()}  ${formatCurrency(t.amount).padStart(10)}`,
        align: 'left',
      })
      if (t.methodKind === 'cash' && t.cashReceived != null && t.cashReceived > t.amount) {
        const lineChange = t.cashReceived - t.amount
        lines.push({
          text: `  RECIBIDO ${formatCurrency(t.cashReceived).padStart(8)} / CAMBIO ${formatCurrency(lineChange).padStart(8)}`,
          align: 'left',
        })
        if (invoice.change == null) totalChange += lineChange
      }
    }
    if (totalChange > 0) {
      lines.push({
        text: `CAMBIO: ${formatCurrency(totalChange)}`,
        align: 'left',
      })
    }
  } else {
    const methodText = paymentMethodText(invoice.paymentMethod || 'N/A')
    lines.push({ text: `FORMA DE PAGO: ${methodText}`, align: 'left' })

    if (invoice.cashReceived && invoice.cashReceived > 0) {
      lines.push({
        text: `RECIBIDO: ${formatCurrency(invoice.cashReceived)}`,
        align: 'left',
      })
      lines.push({ text: `CAMBIO: ${formatCurrency(invoice.cashChange || 0)}`, align: 'left' })
    }
  }

  lines.push({ text: '--------------------------------', align: 'center' })

  // Footer
  for (const text of ['¡GRACIAS POR SU COMPRA!', 'VUELVA PRONTO']) {
    lines.push({ text, align: 'center' })
  }

  return { lines }
}

function paymentMethodText(method: string): string {
  const map: Record<string, string> = {
    cash: 'Efectivo',
    transfer: 'Transferencia',
    nequi: 'Nequi',
    bancolombia: 'Bancolombia App',
    multiple: 'MÚLTIPLES',
  }
  return map[method.toLowerCase()] ?? method
}
