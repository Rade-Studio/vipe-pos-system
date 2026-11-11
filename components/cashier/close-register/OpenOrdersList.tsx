"use client"

import { Button } from "@/components/ui/button"
import type { VoidTarget } from "@/components/voids/flow"
import type { OrderDto } from "@/lib/api/orders"
import { formatCurrency } from "@/utils/helpers"

/** Statuses of an order that is neither paid nor cancelled (the API's close gate counts the same). */
export const OPEN_ORDER_STATUSES = ["active", "kitchen", "delivered"] as const

/** "hace 35 min", "hace 2 h 5 min", "hace 6 d 1 h". */
export function openOrderAge(createdAt: string | null, now: number): string {
  if (!createdAt) return ""
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000))
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `hace ${hours} h ${minutes % 60} min` : `hace ${hours} h`
  return hours % 24 ? `hace ${Math.floor(hours / 24)} d ${hours % 24} h` : `hace ${Math.floor(hours / 24)} d`
}

export const openOrderPlace = (order: OrderDto): string =>
  order.orderType === "delivery" ? "Domicilio" : order.tableNumber != null ? `Mesa ${order.tableNumber}` : "Sin mesa"

export const leaveOpenOrdersLabel = (count: number): string =>
  count === 1
    ? "Dejar 1 orden abierta para la siguiente caja"
    : `Dejar ${count} órdenes abiertas para la siguiente caja`

/** The audited cancel of VoidFlow for one open order; deliveries go through the delivery cancel. */
export function cancelTarget(order: OrderDto): VoidTarget {
  return {
    action: "order",
    orderId: order.id,
    label: `#${order.orderNumber} · ${openOrderPlace(order)}`,
    lines: order.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments ?? undefined,
      ...(item.modifiers?.length ? { modifiers: item.modifiers } : {}),
    })),
    total: order.total,
    ...(order.orderType === "delivery" ? { delivery: true as const } : {}),
  }
}

export function OpenOrdersList({
  orders,
  now,
  onCancel,
}: {
  orders: OrderDto[]
  now: number
  onCancel: (order: OrderDto) => void
}) {
  return (
    <ul aria-label="Órdenes abiertas" className="divide-y rounded-md border text-sm">
      {orders.map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-3 p-2">
          <div className="min-w-0">
            <p className="font-medium">
              {openOrderPlace(order)} · {formatCurrency(order.total)}
            </p>
            <p className="text-xs text-muted-foreground">
              {order.waiterName ?? "Sin mesero"} · {openOrderAge(order.createdAt, now)}
            </p>
          </div>
          <Button type="button" variant="outline" className="min-h-[44px] flex-none" onClick={() => onCancel(order)}>
            Cancelar orden
          </Button>
        </li>
      ))}
    </ul>
  )
}
