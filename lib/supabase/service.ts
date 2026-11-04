import type { Order, PaymentMethod } from "@/types"
import { orderTypeFromRow } from "@/lib/delivery/kitchen"
import { supabase as clientSupabase } from "./client"
import { log } from "@/lib/log"
import { getPaymentsByOrderIds } from "./payments-service"
import { invoicePaymentMethod } from "@/lib/payments/payment-list"

// Reutilizar el cliente de Supabase ya inicializado
export const supabase = clientSupabase

// Agregar esta función al archivo existente
export async function getOrdersByDate(date: Date): Promise<Order[]> {
  // Crear fechas para el inicio y fin del día
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  // Formatear fechas para la consulta
  const startDate = startOfDay.toISOString()
  const endDate = endOfDay.toISOString()

  try {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items(*)
      `)
      .eq("status", "paid")
      .gte("created_at", startDate)
      .lte("created_at", endDate)

    if (error) {
      throw error
    }

    // New ledger is the source of truth for payments taken since the
    // pay_order migration shipped. One batched read covers every order on
    // the day; orders without a new payment fall back to the legacy
    // payment_transactions read so historical bills keep their method
    // label.
    const orderIds = data.map((o: any) => o.id)
    const newPayments = await getPaymentsByOrderIds(orderIds).catch((err) => {
      log.error("Error al leer payments para órdenes:", { error: String(err) })
      return []
    })
    const newPaymentByOrderId = new Map(newPayments.map((p) => [p.orderId, p]))

    const orders = await Promise.all(
      data.map(async (order: any) => {
        let paymentMethod: PaymentMethod | "multiple" | string | undefined
        const newPayment = newPaymentByOrderId.get(order.id)

        if (newPayment) {
          paymentMethod = invoicePaymentMethod(newPayment)
        } else {
          const { data: payments, error: payError } = await supabase
            .from("payment_transactions")
            .select("method")
            .eq("order_id", order.id)

          if (payError) {
            log.error("Error al obtener métodos de pago:", { payError: String(payError) })
          }

          if (payments && payments.length > 0) {
            const unique = Array.from(new Set(payments.map((p) => p.method)))
            paymentMethod = unique.length > 1 ? "multiple" : (unique[0] as PaymentMethod)
          }
        }

        return {
          id: order.id,
          tableId: order.table_id,
          orderType: orderTypeFromRow(order),
          waiter: order.waiter_id,
          status: order.status,
          items: order.order_items || [],
          bill: {
            subtotal: order.subtotal || 0,
            tax: order.tax || 0,
            taxPercentage: order.tax_percentage || 0,
            tip: order.tip || 0,
            tipPercentage: order.tip_percentage || 0,
            total: order.total || 0,
          },
          subtotal: order.subtotal || 0,
          tax: order.tax || 0,
          taxPercentage: order.tax_percentage || 0,
          tip: order.tip || 0,
          tipPercentage: order.tip_percentage || 0,
          total: order.total || 0,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          paymentMethod,
          // Attach the ledger row so the admin reprint can render the
          // tender list without a second round-trip. Undefined for
          // orders that pre-date the new pay_order flow (those fall
          // back to the legacy `paymentMethod` label).
          ledgerPayment: newPayment,
        }
      })
    )

    return orders as unknown as Order[]
  } catch (error) {
    throw error
  }
}
