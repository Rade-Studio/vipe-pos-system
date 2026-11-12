"use client"

import { AlertTriangle } from "lucide-react"
import type { AdminOrder } from "@/lib/admin/orders"
import { takeawayLabel } from "@/lib/cashier/queue"
import { OLD_ORDER_HOURS, elapsedLabel, isOldOrder } from "@/lib/floor/live"

interface StaleOrdersBannerProps {
  orders: readonly AdminOrder[]
  /** The page's ticking clock. */
  nowMs: number
}

const placeLabel = (order: AdminOrder) =>
  order.orderType === "delivery"
    ? "Domicilio"
    : order.orderType === "takeaway"
      ? takeawayLabel(order)
      : order.tableName
        ? `Mesa ${order.tableName}`
        : "Mesa sin número"

/** S3: the active orders open 12 h or more, oldest first; nothing when there are none. */
export function StaleOrdersBanner({ orders, nowMs }: StaleOrdersBannerProps) {
  const now = new Date(nowMs)
  const old = orders
    .filter((order) => isOldOrder(order.createdAt, now))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  if (old.length === 0) return null

  const title =
    old.length === 1
      ? `1 orden lleva abierta más de ${OLD_ORDER_HOURS} horas`
      : `${old.length} órdenes llevan abiertas más de ${OLD_ORDER_HOURS} horas`

  return (
    <section
      aria-label={title}
      className="mb-4 rounded-card border border-status-warning-line bg-status-warning-bg p-4 text-status-warning-fg"
    >
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {old.map((order) => (
          <li key={order.id} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{placeLabel(order)}</span>
            {order.waiterName && <span>· {order.waiterName}</span>}
            <span className="tabular-nums">· hace {elapsedLabel(order.createdAt, now)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">Cóbralas en caja o cancélalas desde su tarjeta.</p>
    </section>
  )
}
