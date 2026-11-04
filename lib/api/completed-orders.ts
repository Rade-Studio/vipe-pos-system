import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { toOrder } from "./orders"
import { localDayKey } from "@/lib/admin/dates"
import { invoicePaymentMethod } from "@/lib/payments/payment-list"
import type { Order, PaymentMethod } from "@/types"

/**
 * The day's paid orders (T9) in ONE request: `GET /orders/completed?date=`
 * embeds each order's payment with its tenders or, for orders paid before
 * `pay_order`, the legacy `payment_transactions` rows. Replaces the per-order
 * reads of `lib/supabase/service.ts`.
 */

type CompletedOrderDto = components["schemas"]["CompletedOrder"]

function legacyMethod(rows: CompletedOrderDto["legacyTransactions"]): PaymentMethod | "multiple" | undefined {
  const methods = new Set(rows.map((row) => row.method))
  if (methods.size === 0) return undefined
  return methods.size > 1 ? "multiple" : ([...methods][0] as PaymentMethod)
}

function toCompletedOrder(dto: CompletedOrderDto): Order {
  const order = toOrder(dto)
  if (dto.payment) {
    return {
      ...order,
      paymentMethod: invoicePaymentMethod(dto.payment) as Order["paymentMethod"],
      ledgerPayment: dto.payment,
    }
  }
  return { ...order, paymentMethod: legacyMethod(dto.legacyTransactions) }
}

/** Paid orders created on that local calendar day (restaurant timezone on the server). */
export async function getOrdersByDate(date: Date): Promise<Order[]> {
  const { data } = await api.GET("/api/orders/completed", { params: { query: { date: localDayKey(date) } } })
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data.map(toCompletedOrder)
}
