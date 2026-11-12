/**
 * lib/kitchen/ticket.ts
 *
 * Presentation rules of the kitchen ticket rail (rediseno-pos T13): how old a
 * ticket is, how that age is labelled, the rail order and the
 * Todas/Mesas/Domicilios filter. Pure: the view passes orders and a clock.
 */
import type { Order } from "@/types"
import { pendingItems } from "@/lib/kitchen/order"

export interface KitchenThresholds {
  riskFrom: number
  lateFrom: number
}

/** Server default of `kitchenLateMinutes` (T23): keeps the design's 15/25 rail. */
export const DEFAULT_KITCHEN_LATE_MINUTES = 25

/**
 * Thresholds from the business `kitchenLateMinutes`: "Atrasada" at it,
 * "En riesgo" from 60% of it (rounded). A missing or invalid value (not an
 * integer ≥ 1) uses the default.
 */
export function kitchenThresholds(lateMinutes?: number | null): KitchenThresholds {
  const late =
    typeof lateMinutes === "number" && Number.isInteger(lateMinutes) && lateMinutes >= 1
      ? lateMinutes
      : DEFAULT_KITCHEN_LATE_MINUTES
  return { riskFrom: Math.round(late * 0.6), lateFrom: late }
}

/** Design thresholds (design/kitchen-redesign/01-ticket-rail.html) = the default mapping. */
export const AT_RISK_FROM_MINUTES = kitchenThresholds().riskFrom
export const LATE_FROM_MINUTES = kitchenThresholds().lateFrom

export type TicketTone = "ok" | "risk" | "late"

export interface TicketAge {
  tone: TicketTone
  label: "A tiempo" | "En riesgo" | "Atrasada"
  minutes: number
}

export function ticketAge(elapsedMs: number, thresholds: KitchenThresholds = kitchenThresholds()): TicketAge {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000))
  if (minutes >= thresholds.lateFrom) return { tone: "late", label: "Atrasada", minutes }
  if (minutes >= thresholds.riskFrom) return { tone: "risk", label: "En riesgo", minutes }
  return { tone: "ok", label: "A tiempo", minutes }
}

/** "mm:ss"; minutes keep counting past the hour ("61:01"). */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

const sentTimes = (items: Order["items"]) =>
  items
    .map((item) => item.addedAt?.getTime())
    .filter((time): time is number => typeof time === "number" && Number.isFinite(time))

/** When the ticket reached the kitchen: its oldest kitchen item, else the order. */
export function ticketStartedAt(order: Order): number {
  const times = sentTimes(pendingItems(order))
  return times.length > 0 ? Math.min(...times) : order.createdAt.getTime()
}

/**
 * Lines of one send share their time only up to the API's 1 µs step per line,
 * which can cross a millisecond; anything within this window is the same send.
 */
export const SAME_SEND_WINDOW_MS = 1_000

/**
 * Which send each line came in (0 = the first): lines sorted by send time, a
 * new send starting when the gap to the previous line exceeds the window.
 */
export function sendIndexOf(order: Order): Map<string, number> {
  const timed = order.items
    .map((item) => ({ id: item.id, time: item.addedAt?.getTime() }))
    .filter((entry): entry is { id: string; time: number } => typeof entry.time === "number" && Number.isFinite(entry.time))
    .sort((a, b) => a.time - b.time)
  const index = new Map<string, number>()
  let send = 0
  timed.forEach((entry, position) => {
    if (position > 0 && entry.time - timed[position - 1].time > SAME_SEND_WINDOW_MS) send += 1
    index.set(entry.id, send)
  })
  return index
}

/**
 * "+n nuevos" (T23): the pending items sent after the order's first send,
 * from the persisted `addedAt` (the send time), so a reload keeps them.
 */
export function newItemIdsOf(order: Order): string[] {
  const times = sentTimes(order.items)
  if (times.length === 0) return []
  const firstSend = Math.min(...times)
  return pendingItems(order)
    .filter((item) => (item.addedAt?.getTime() ?? firstSend) > firstSend + SAME_SEND_WINDOW_MS)
    .map((item) => item.id)
}

export function oldestFirst(orders: readonly Order[]): Order[] {
  return [...orders].sort((a, b) => ticketStartedAt(a) - ticketStartedAt(b))
}

export type KindFilter = "all" | "dine_in" | "takeaway" | "delivery"

/** An order without a known type is a table order, as the readers that do not map it. */
const kindOf = (order: Order): Exclude<KindFilter, "all"> => order.orderType ?? "dine_in"

export function matchesKindFilter(order: Order, filter: KindFilter): boolean {
  return filter === "all" || kindOf(order) === filter
}

/** Takeaway (S8) has its own count: it is never a table. */
export function countByKind(orders: readonly Order[]): Record<KindFilter, number> {
  const count = (kind: Exclude<KindFilter, "all">) => orders.filter((order) => kindOf(order) === kind).length
  return { all: orders.length, dine_in: count("dine_in"), takeaway: count("takeaway"), delivery: count("delivery") }
}

/** S8: the heading of a takeaway ticket, as the printed comanda: "PARA LLEVAR · Ana". */
export function takeawayPlace(order: Pick<Order, "customerName">): string {
  const name = order.customerName?.trim()
  return name ? `PARA LLEVAR · ${name}` : "PARA LLEVAR"
}
