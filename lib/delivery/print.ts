/**
 * Pure builders for the delivery print payloads.
 *
 * The kitchen command (broadcast on `room_commands`) and the invoice
 * both carry an optional `delivery` block (`DeliveryPrintInfo`) that the
 * TS renderer (lib/print/renderKitchenOrder.ts) and the Python listener
 * (pos/print_renderer.py) turn into the delivery ticket variant. No
 * Supabase, no DOM.
 */

import type { CommandPayload, DeliveryPrintInfo } from '@/types'
import { formatAddress } from './address'
import type { DeliveryOrder } from './types'

/** Waiter shown when the operator has no display name; the listener drops commands without one. */
const FALLBACK_WAITER = 'Domicilios'

/** Print block from the `order_deliveries` snapshot (the source of truth for the ticket). */
export function buildDeliveryPrintInfo(delivery: DeliveryOrder): DeliveryPrintInfo {
  const info: DeliveryPrintInfo = {
    customerName: delivery.customerName,
    phone: delivery.customerPhone,
    address: formatAddress({
      addressLine: delivery.addressLine,
      neighborhood: delivery.neighborhood,
      reference: delivery.addressReference,
    }),
    paymentMode: delivery.paymentMode,
    deliveryFee: delivery.deliveryFee,
  }
  const notes = delivery.notes?.trim()
  if (notes) info.notes = notes
  if (delivery.paymentMode === 'cash_on_delivery' && delivery.cashChangeFor != null) {
    info.cashChangeFor = delivery.cashChangeFor
  }
  return info
}

export interface KitchenCommandLine {
  name: string
  quantity: number
  comments?: string | null
}

/** Same 4-digit order number WaiterView puts on its kitchen commands. */
export function newKitchenOrderNumber(random: () => number = Math.random): string {
  return `${Math.floor(random() * 9000) + 1000}`
}

/** Kitchen command for a freshly created delivery order: no table, operator as waiter. */
export function buildDeliveryKitchenCommand(input: {
  delivery: DeliveryOrder
  lines: readonly KitchenCommandLine[]
  waiter: string
  invoiceNumber: string
}): CommandPayload {
  return {
    invoiceNumber: input.invoiceNumber,
    waiter: input.waiter.trim() || FALLBACK_WAITER,
    table: null,
    items: input.lines.map((line) => {
      const item: { name: string; quantity: number; comments?: string } = {
        name: line.name,
        quantity: line.quantity,
      }
      const comments = line.comments?.trim()
      if (comments) item.comments = comments
      return item
    }),
    delivery: buildDeliveryPrintInfo(input.delivery),
  }
}
