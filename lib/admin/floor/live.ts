import type { Order, Table } from "@/types"
import { initials } from "@/lib/floor/layout"

/**
 * The admin overview "Sala en vivo" (T26, S8): per table, the minutes since
 * its open order was created and the waiter who holds it. Nothing invented:
 * a table without an open order shows neither.
 */

export interface LiveTableInfo {
  minutes: number
  waiterName: string | undefined
  initials: string | undefined
  orderNumber: number | undefined
}

const OPEN_STATUSES = new Set<Order["status"]>(["active", "kitchen", "delivered"])
/** `adminOrderFromDto` stands this in for a missing waiter name. */
const UNKNOWN_WAITER = "Desconocido"

export const elapsedMinutes = (createdAt: Date, now: Date): number =>
  Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000))

/** Oldest open order per table; split children ride on their parent. */
export function liveInfoByTable(orders: (Order & { waiterName?: string })[], now: Date): Map<string, LiveTableInfo> {
  const oldest = new Map<string, Order & { waiterName?: string }>()
  for (const order of orders) {
    if (!order.tableId || order.parentOrderId || !OPEN_STATUSES.has(order.status) || !order.createdAt) continue
    const current = oldest.get(order.tableId)
    if (!current || new Date(order.createdAt).getTime() < new Date(current.createdAt).getTime()) oldest.set(order.tableId, order)
  }
  const out = new Map<string, LiveTableInfo>()
  for (const [tableId, order] of oldest) {
    const name = order.waiterName && order.waiterName !== UNKNOWN_WAITER ? order.waiterName : undefined
    out.set(tableId, {
      minutes: elapsedMinutes(order.createdAt, now),
      waiterName: name,
      initials: name ? initials(name) : undefined,
      orderNumber: order.orderNumber,
    })
  }
  return out
}

/** Table ids waiting longest first. */
export const longestWaiting = (info: Map<string, LiveTableInfo>, count: number, among?: ReadonlySet<string>): string[] =>
  [...info.entries()]
    .filter(([id]) => !among || among.has(id))
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .slice(0, count)
    .map(([id]) => id)

/**
 * After a realtime merge: `lib/realtime/table-merge.ts` does not map
 * `is_active` yet (L34 b), so keep the flag the table had unless the row
 * carries it.
 */
export function keepActiveFlag(prev: readonly Table[], next: Table[], row: { id?: string; is_active?: unknown } | null | undefined): Table[] {
  return next.map((table) => {
    if (row?.id === table.id && typeof row.is_active === "boolean") return { ...table, isActive: row.is_active }
    if (table.isActive !== undefined) return table
    const before = prev.find((candidate) => candidate.id === table.id)
    return before?.isActive === undefined ? table : { ...table, isActive: before.isActive }
  })
}
