import type { Order } from "@/types"

/**
 * What the waiter map derives from the open orders it already reads (T22,
 * S8): the table record has no start time, the open order does.
 */

const OPEN = new Set<Order["status"]>(["active", "kitchen", "delivered"])

/** The oldest open order of each table. */
export function openOrdersByTable(orders: readonly Order[]): Map<string, Order> {
  const byTable = new Map<string, Order>()
  for (const order of orders) {
    if (!order.tableId || !OPEN.has(order.status)) continue
    const current = byTable.get(order.tableId)
    if (!current || order.createdAt.getTime() < current.createdAt.getTime()) byTable.set(order.tableId, order)
  }
  return byTable
}

/** "18 min", "1 h 05": time since `since`, never negative; null without a date. */
export function elapsedLabel(since: Date | undefined, now: Date): string | null {
  if (!since || Number.isNaN(since.getTime())) return null
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`
}
