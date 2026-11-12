import type { OrderDiscountDto } from "@/lib/api/orders"
import type { CashierBillSource } from "@/lib/cashier/orders"
import type { PrintDiscount } from "@/types"

/**
 * S14: the bill source plus the order's discount records and list-price
 * subtotal, so the invoice prints them; without them it prints as before.
 */
export type PaymentOrderSource = CashierBillSource & {
  discounts?: readonly OrderDiscountDto[]
  gross_subtotal?: number
  /** S8: the order's type and takeaway customer, copied onto the invoice. */
  order_type?: "dine_in" | "takeaway" | "delivery"
  customer_name?: string | null
}

/**
 * The order's discounts for the invoice (S2, S14), only when the records
 * match its bill (else none). PaymentPanel builds every invoice with it, so
 * the cashier's column and the delivery dialog print the same lines.
 */
export function invoiceDiscounts(order: PaymentOrderSource) {
  const discounts = order.discounts ?? []
  const total = order.total_discounts ?? 0
  if (discounts.length === 0 || discounts.reduce((sum, d) => sum + d.amount, 0) !== total) return null
  const print = (d: OrderDiscountDto): PrintDiscount => ({ label: d.label, amount: d.amount, orderItemId: d.orderItemId })
  return {
    bill: discounts.filter((d) => !d.orderItemId).map(print),
    byItem: (itemId: string) => discounts.filter((d) => d.orderItemId === itemId).map(print),
    grossSubtotal: order.gross_subtotal ?? order.subtotal + total,
  }
}
