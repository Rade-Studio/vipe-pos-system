/**
 * lib/kitchen/ticket.ts
 *
 * Presentation rules of the kitchen ticket rail (rediseno-pos T13): how old a
 * ticket is, how that age is labelled, the rail order and the
 * Todas/Mesas/Domicilios filter. Pure: the view passes orders and a clock.
 */
import type { Order } from "@/types"

/** Design thresholds (design/kitchen-redesign/01-ticket-rail.html). */
export const AT_RISK_FROM_MINUTES = 15
export const LATE_FROM_MINUTES = 25

export type TicketTone = "ok" | "risk" | "late"

export interface TicketAge {
  tone: TicketTone
  label: "A tiempo" | "En riesgo" | "Atrasada"
  minutes: number
}

export function ticketAge(elapsedMs: number): TicketAge {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000))
  if (minutes >= LATE_FROM_MINUTES) return { tone: "late", label: "Atrasada", minutes }
  if (minutes >= AT_RISK_FROM_MINUTES) return { tone: "risk", label: "En riesgo", minutes }
  return { tone: "ok", label: "A tiempo", minutes }
}

/** "mm:ss"; minutes keep counting past the hour ("61:01"). */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

/** When the ticket reached the kitchen: its oldest kitchen item, else the order. */
export function ticketStartedAt(order: Order): number {
  const times = order.items
    .map((item) => item.addedAt?.getTime())
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time))
  return times.length > 0 ? Math.min(...times) : order.createdAt.getTime()
}

export function oldestFirst(orders: readonly Order[]): Order[] {
  return [...orders].sort((a, b) => ticketStartedAt(a) - ticketStartedAt(b))
}

export type KindFilter = "all" | "dine_in" | "delivery"

const isDelivery = (order: Order) => order.orderType === "delivery"

export function matchesKindFilter(order: Order, filter: KindFilter): boolean {
  if (filter === "all") return true
  return filter === "delivery" ? isDelivery(order) : !isDelivery(order)
}

export function countByKind(orders: readonly Order[]): Record<KindFilter, number> {
  const delivery = orders.filter(isDelivery).length
  return { all: orders.length, dine_in: orders.length - delivery, delivery }
}
