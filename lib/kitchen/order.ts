/**
 * lib/kitchen/order.ts
 *
 * The kitchen board's projection of an `Order` (T7, T8b). Orders are mapped
 * once, by `toOrder` in lib/api/orders.ts; the hydration read and the realtime
 * batch read both project through here.
 *
 * Rules preserved from the view (and from odd/tasks/domicilios.md S13/S14):
 * an order with nothing left in the kitchen is not on the board at all; the
 * items of an order on the board are kept oldest first, the served ones too
 * (rediseno-pos T23: they stay struck through as "Entregado"), and the pending
 * work is `pendingItems`,
 * and `orderType` is carried so a delivery keeps its DOMICILIO banner and
 * heading instead of falling back to "Mesa ?".
 */
import type { Order } from "@/types"

const addedAtMs = (item: Order["items"][number]) => item.addedAt?.getTime() ?? 0

export const isServedItem = (item: Order["items"][number]) => item.status !== "kitchen"

/** What is still to cook: the only items the board counts, serves and lists. */
export const pendingItems = (order: Order) => order.items.filter((item) => !isServedItem(item))

/** One board order, or null when the order has nothing left for the kitchen. */
export function kitchenOrderOf(order: Order): Order | null {
  if (!order.items.some((item) => !isServedItem(item))) return null
  const items = [...order.items].sort((a, b) => addedAtMs(a) - addedAtMs(b))
  return { ...order, items }
}

/** Every order on the board out of a `GET /orders?status=kitchen` read. */
export function kitchenOrdersOf(orders: readonly Order[]): Order[] {
  return orders.map(kitchenOrderOf).filter((order): order is Order => order !== null)
}
