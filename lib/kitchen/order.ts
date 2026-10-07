/**
 * lib/kitchen/order.ts
 *
 * The kitchen's `orders` row -> `Order` mapping, lifted out of `KitchenView`
 * (T7) so the hydration read and the realtime batch read share ONE mapping
 * instead of two copies that can drift.
 *
 * Rules preserved from the view (and from odd/tasks/domicilios.md S13/S14):
 * only items in `kitchen` status reach the board, they are ordered oldest
 * first, an order with nothing left in the kitchen is not on the board at all,
 * and `orders.order_type` is carried so a delivery keeps its DOMICILIO banner
 * and heading instead of falling back to "Mesa ?".
 */
import { orderTypeFromRow } from "@/lib/delivery/kitchen"
import type { Order, OrderItem, OrderItemStatus, OrderStatus } from "@/types"
import type { Tables } from "@/types/supabase"

export type DbOrderRow = Tables<"orders"> & { order_items?: Tables<"order_items">[] | null }
type DbOrderItemRow = Tables<"order_items">

function kitchenItemsOf(dbOrder: DbOrderRow): DbOrderItemRow[] {
  const orderItems: DbOrderItemRow[] = Array.isArray(dbOrder.order_items) ? dbOrder.order_items : []
  return orderItems
    .filter((item) => item.status === "kitchen")
    .sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
      return aTime - bTime
    })
}

function toKitchenItem(item: DbOrderItemRow): OrderItem {
  return {
    id: String(item.id),
    name: item.name,
    price: item.price,
    quantity: item.quantity ?? 1,
    comments: item.comments ?? undefined,
    categoryId: "",
    image: "/placeholder.svg?height=50&width=50",
    status: (item.status ?? "kitchen") as OrderItemStatus,
    addedAt: item.created_at ? new Date(item.created_at) : undefined,
  }
}

/** One board order, or null when the order has nothing left for the kitchen. */
export function kitchenOrderFromRow(dbOrder: DbOrderRow): Order | null {
  const kitchenItems = kitchenItemsOf(dbOrder)
  if (kitchenItems.length === 0) return null

  return {
    id: dbOrder.id,
    tableId: dbOrder.table_id ?? "",
    orderType: orderTypeFromRow(dbOrder),
    items: kitchenItems.map(toKitchenItem),
    status: dbOrder.status as OrderStatus,
    bill: {
      subtotal: dbOrder.subtotal ?? 0,
      tax: dbOrder.tax ?? 0,
      taxPercentage: dbOrder.tax_percentage ?? 0,
      tip: dbOrder.tip ?? 0,
      tipPercentage: dbOrder.tip_percentage ?? 0,
      total: dbOrder.total ?? 0,
      totalDiscounts: dbOrder.total_discounts ?? 0,
    },
    waiter: dbOrder.waiter_id ?? "",
    createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
    isPartialOrder: dbOrder.is_partial_order ?? false,
    parentOrderId: dbOrder.parent_order_id ?? undefined,
  }
}

/** Every order on the board out of a `getByStatus("kitchen")` read. */
export function kitchenOrdersFromRows(rows: readonly DbOrderRow[]): Order[] {
  return rows
    .map(kitchenOrderFromRow)
    .filter((order): order is Order => order !== null)
}