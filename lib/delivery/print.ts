/**
 * Pure builder for the delivery print block.
 *
 * The invoice carries an optional `delivery` block (`DeliveryPrintInfo`) that the
 * TS renderer (lib/print/renderKitchenOrder.ts) and the Python listener
 * (pos/print_renderer.py) turn into the delivery ticket variant. Since
 * T11 the API builds the delivery kitchen command itself. No DOM.
 */

import type { DeliveryPrintInfo } from '@/types'
import { formatAddress } from './address'
import type { DeliveryOrder } from './types'

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
