/**
 * lib/kitchen/order.ts
 *
 * The kitchen board's projection of an `Order` (T7, T8b). Orders are mapped
 * once, by `toOrder` in lib/api/orders.ts; the hydration read and the realtime
 * batch read both project through here.
 *
 * Rules preserved from the view (and from odd/tasks/domicilios.md S13/S14):
 * only items in `kitchen` status reach the board, they are ordered oldest
 * first, an order with nothing left in the kitchen is not on the board at all,
 * and `orderType` is carried so a delivery keeps its DOMICILIO banner and
 * heading instead of falling back to "Mesa ?".
 */
import type { Order } from "@/types"

const addedAtMs = (item: Order["items"][number]) => item.addedAt?.getTime() ?? 0

/** One board order, or null when the order has nothing left for the kitchen. */
export function kitchenOrderOf(order: Order): Order | null {
  const items = order.items
    .filter((item) => item.status === "kitchen")
    .sort((a, b) => addedAtMs(a) - addedAtMs(b))
  if (items.length === 0) return null
  return { ...order, items }
}

/** Every order on the board out of a `GET /orders?status=kitchen` read. */
export function kitchenOrdersOf(orders: readonly Order[]): Order[] {
  return orders.map(kitchenOrderOf).filter((order): order is Order => order !== null)
}
