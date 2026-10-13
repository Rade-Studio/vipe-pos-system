/**
 * Pure helpers for the views that used to assume every order has a
 * table (kitchen, cashier, admin). Delivery orders have
 * `orders.order_type = 'delivery'` and `table_id NULL`; these helpers
 * decide how such an order is labelled, filtered and grouped.
 *
 * No Supabase, no DOM: the views pass in plain shapes.
 */

import type { OrderType } from '@/types'
import type { DeliveryStatus } from './types'

export interface PlaceOrder {
  orderType?: OrderType
  /** Number of the order's table, when the caller resolved it. */
  tableNumber?: number | null
}

export interface PlaceDelivery {
  customerName: string
}

/** Reads `orders.order_type` from a raw row; anything unknown is dine-in. */
export function orderTypeFromRow(row: unknown): OrderType {
  if (row === null || typeof row !== 'object') return 'dine_in'
  return (row as { order_type?: unknown }).order_type === 'delivery' ? 'delivery' : 'dine_in'
}

export function isDeliveryOrder(order: { orderType?: OrderType }): boolean {
  return order.orderType === 'delivery'
}

/** Waiter order lists: delivery orders belong to the delivery operator. */
export function ordersForWaiter<T extends { orderType?: OrderType }>(orders: readonly T[]): T[] {
  return orders.filter((order) => !isDeliveryOrder(order))
}

/** True when the order sits at a table the view may look up or update. */
export function hasTable(order: { orderType?: OrderType; tableId?: string | null }): boolean {
  return !isDeliveryOrder(order) && typeof order.tableId === 'string' && order.tableId !== ''
}

function customerName(delivery: PlaceDelivery | null | undefined): string | null {
  const name = delivery?.customerName.trim() ?? ''
  return name === '' ? null : name
}

/** Card heading: "Mesa N" or "DOMICILIO · <customer>". */
export function orderHeading(order: PlaceOrder, delivery?: PlaceDelivery | null): string {
  if (isDeliveryOrder(order)) {
    const name = customerName(delivery)
    return name === null ? 'DOMICILIO' : `DOMICILIO · ${name}`
  }
  return `Mesa ${order.tableNumber ?? '?'}`
}

/** Toast fragment: "la mesa N", "el domicilio de <customer>". */
export function orderPlaceText(order: PlaceOrder, delivery?: PlaceDelivery | null): string {
  if (isDeliveryOrder(order)) {
    const name = customerName(delivery)
    return name === null ? 'un domicilio' : `el domicilio de ${name}`
  }
  return order.tableNumber == null ? 'una mesa' : `la mesa ${order.tableNumber}`
}

/** Invoice reprint: "DOMICILIO" for a delivery, the table number otherwise. */
export function invoicePlaceLabel(
  order: { orderType?: OrderType },
  table?: { number: number } | null,
): string {
  if (isDeliveryOrder(order)) return 'DOMICILIO'
  return table?.number != null ? table.number.toString() : 'N/A'
}

/**
 * The kitchen moves a delivery to `ready` when it serves the last item,
 * but only while the delivery is still in its hands; an unknown status
 * is left alone so a replay never reaches the server.
 */
export function shouldMarkDeliveryReady(status: DeliveryStatus | null | undefined): boolean {
  return status === 'received' || status === 'preparing'
}

/** Kitchen filter: a table number, every delivery order, or nothing. */
export type PlaceFilter = number | 'delivery' | null

export function matchesPlaceFilter(order: PlaceOrder, filter: PlaceFilter): boolean {
  if (filter === null) return true
  if (filter === 'delivery') return isDeliveryOrder(order)
  return !isDeliveryOrder(order) && order.tableNumber === filter
}

/** Cashier table cards: dine-in, non-partial orders keyed by table id. */
export function groupDineInOrdersByTable<
  T extends { orderType?: OrderType; tableId?: string | null; isPartialOrder?: boolean },
>(orders: readonly T[]): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}
  for (const order of orders) {
    if (order.isPartialOrder || !hasTable(order)) continue
    const key = order.tableId as string
    ;(grouped[key] ??= []).push(order)
  }
  return grouped
}

/** Cashier delivery panel: rows still owing money (not paid, not cancelled). */
export function pendingDeliveryPayments<
  T extends { delivery: { status: DeliveryStatus }; isPaid: boolean },
>(rows: readonly T[]): T[] {
  return rows.filter((row) => !row.isPaid && row.delivery.status !== 'cancelled')
}

/**
 * Toast text once the kitchen served every item. A delivery is reported
 * ready only after the server accepted `mark_ready`; a skipped or failed
 * transition says nothing about the delivery state.
 */
export function servedOrderMessage(input: { delivery: boolean; deliveryReady: boolean }): string {
  if (!input.delivery) return 'Todos los productos fueron entregados y la mesa quedó servida.'
  return input.deliveryReady
    ? 'Todos los productos fueron entregados y el domicilio quedó listo para despachar.'
    : 'Todos los productos fueron entregados.'
}
