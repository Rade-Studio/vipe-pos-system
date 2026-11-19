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
import type { KitchenStatus, Order } from "@/types"

const addedAtMs = (item: Order["items"][number]) => item.addedAt?.getTime() ?? 0

export const isServedItem = (item: Order["items"][number]) => item.status !== "kitchen"

/** H-057 (S4): what a line shows, on the kitchen ticket and on the waiter's table. */
export type LineStage = KitchenStatus | "served"

/** Served (any non-kitchen status) wins; a kitchen line without a step is pending. */
export const lineStage = (item: Order["items"][number]): LineStage =>
  isServedItem(item) ? "served" : (item.kitchenStatus ?? "pending")

export const LINE_STAGE_LABEL: Record<LineStage, string> = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  served: "Servido",
}

/** The kitchen's next tap on a line: pending -> preparing -> ready; serving stays its own ✓. */
export const nextKitchenStatus = (step: KitchenStatus): KitchenStatus | null =>
  step === "pending" ? "preparing" : step === "preparing" ? "ready" : null

/** What is still to cook: the only items the board counts, serves and lists. */
export const pendingItems = (order: Order) => order.items.filter((item) => !isServedItem(item))

/** One board order, or null when the order has nothing left for the kitchen. */
export function kitchenOrderOf(order: Order): Order | null {
  // F3: a cancelled order and a fully voided (0-unit) line are off the board.
  if (order.status === "cancelled") return null
  const live = order.items.filter((item) => item.quantity > 0)
  if (!live.some((item) => !isServedItem(item))) return null
  const items = [...live].sort((a, b) => addedAtMs(a) - addedAtMs(b))
  return { ...order, items }
}

/** Every order on the board out of a `GET /orders?status=kitchen` read. */
export function kitchenOrdersOf(orders: readonly Order[]): Order[] {
  return orders.map(kitchenOrderOf).filter((order): order is Order => order !== null)
}
