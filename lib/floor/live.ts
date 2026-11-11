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

/** S3: an order open this long is flagged as old (floor chip, admin Órdenes banner). */
export const OLD_ORDER_HOURS = 12

/** "18 min", "1 h 05", "6 d 1 h" past 24 h: time since `since`, never negative; null without a date. */
export function elapsedLabel(since: Date | undefined, now: Date): string | null {
  if (!since || Number.isNaN(since.getTime())) return null
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)} d ${hours % 24} h`
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`
}

/** S3: open for OLD_ORDER_HOURS or more. */
export function isOldOrder(createdAt: Date | undefined, now: Date): boolean {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return false
  return now.getTime() - createdAt.getTime() >= OLD_ORDER_HOURS * 3_600_000
}

/** S3: the same flag read back from an `elapsedLabel` ("13 h 05", "1 d 0 h"), for views that only get the label. */
export function isOldElapsed(label: string | null | undefined): boolean {
  if (!label) return false
  if (/^\d+ d /.test(label)) return true
  const hours = /^(\d+) h /.exec(label)
  return hours !== null && Number(hours[1]) >= OLD_ORDER_HOURS
}
