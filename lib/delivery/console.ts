/**
 * Layout decisions for the delivery dispatch console (T12): board
 * columns, grouping, courier load, the column counter of the wide
 * scroller, the new-order steps and the "N" shortcut guard. Pure, no
 * DOM or network.
 */

import type { ClosedTodaySummary, CustomerHistory, DeliveryStatus } from './types'

/** Statuses that own a column on the board; delivered/cancelled go to "Cerrados hoy". */
export type BoardColumnStatus = Exclude<DeliveryStatus, 'delivered' | 'cancelled'>

export const BOARD_COLUMNS: ReadonlyArray<{ status: BoardColumnStatus; label: string }> = [
  { status: 'received', label: 'Recibido' },
  { status: 'preparing', label: 'En preparación' },
  { status: 'ready', label: 'Listo' },
  { status: 'out_for_delivery', label: 'En camino' },
  { status: 'failed', label: 'Fallido' },
]

/** Minimum width of a board column in the wide scroller. */
export const BOARD_COLUMN_MIN_PX = 288
export const BOARD_COLUMN_GAP_PX = 12
/** Container width from which the board is a column scroller instead of tabs. */
export const BOARD_WIDE_MIN_PX = 1200

interface StatusRow {
  delivery: { orderId: string; status: DeliveryStatus; courierId: string | null }
}

export type GroupedDeliveries<R> = Record<BoardColumnStatus | 'closed', R[]>

export function groupDeliveries<R extends StatusRow>(rows: ReadonlyArray<R>): GroupedDeliveries<R> {
  const result: GroupedDeliveries<R> = {
    received: [],
    preparing: [],
    ready: [],
    out_for_delivery: [],
    failed: [],
    closed: [],
  }
  for (const row of rows) {
    const status = row.delivery.status
    if (status === 'delivered' || status === 'cancelled') result.closed.push(row)
    else result[status].push(row)
  }
  return result
}

/** Deliveries currently on the road per courier id. */
export function courierLoad(rows: ReadonlyArray<StatusRow>): Map<string, number> {
  const load = new Map<string, number>()
  for (const { delivery } of rows) {
    if (delivery.status !== 'out_for_delivery' || delivery.courierId === null) continue
    load.set(delivery.courierId, (load.get(delivery.courierId) ?? 0) + 1)
  }
  return load
}

export interface ColumnRange {
  first: number
  last: number
}

/** 1-based range of the columns fully inside the scroller viewport. */
export function visibleColumnRange(input: {
  scrollLeft: number
  viewport: number
  column: number
  gap: number
  total: number
}): ColumnRange {
  const { scrollLeft, viewport, column, gap, total } = input
  if (total <= 0) return { first: 0, last: 0 }
  const step = column + gap
  let first = 0
  let last = 0
  for (let i = 0; i < total; i++) {
    const start = i * step
    const end = start + column
    if (start >= scrollLeft - 1 && end <= scrollLeft + viewport + 1) {
      if (first === 0) first = i + 1
      last = i + 1
    }
  }
  if (first === 0) {
    first = Math.min(total, Math.max(1, Math.floor(scrollLeft / step) + 1))
    last = first
  }
  return { first, last }
}

export function columnRangeLabel(range: ColumnRange, total: number): string {
  if (range.first === range.last) return `Columna ${range.first} de ${total}`
  return `Columnas ${range.first}–${range.last} de ${total}`
}

/** Short, human reference for an order: the first six characters of its real id. */
export function shortOrderRef(orderId: string): string {
  return `#${orderId.replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

/**
 * "#D-0412" from the order's per-restaurant number (T25); a row without one
 * (an old cache entry) keeps the short id.
 */
export function deliveryOrderRef(order: { orderId: string; orderNumber?: number | null }): string {
  const n = order.orderNumber
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return shortOrderRef(order.orderId)
  return `#D-${String(n).padStart(4, '0')}`
}

/** Share of `deliveryLateMinutes` from which a delivery is at risk (same rule as the kitchen). */
export const LATE_RISK_SHARE = 0.6

export type LateTone = 'late' | 'risk'

interface ClockRow {
  createdAt: string
  status: DeliveryStatus
  dispatchedAt?: string | null
  failedAt?: string | null
  deliveredAt?: string | null
  cancelledAt?: string | null
}

/**
 * Where the card clock starts (T25, the design's one clock per card): the
 * kitchen phase (received, preparing, ready) from the order, the road from the
 * dispatch, a failure from failed_at and a closed one from its end. The
 * order time stands in for a missing state timestamp.
 */
export function stateClockStart(delivery: ClockRow): string {
  const at =
    delivery.status === 'out_for_delivery'
      ? delivery.dispatchedAt
      : delivery.status === 'failed'
        ? delivery.failedAt
        : delivery.status === 'delivered'
          ? delivery.deliveredAt
          : delivery.status === 'cancelled'
            ? delivery.cancelledAt
            : null
  return at ?? delivery.createdAt
}

/**
 * Late highlighting (T25): the card clock (`stateClockStart`) against the
 * restaurant's `deliveryLateMinutes`; at risk from 60 % of it (rounded up).
 * Closed deliveries are never late.
 */
export function lateTone(delivery: ClockRow, nowMs: number, lateMinutes: number): LateTone | null {
  if (delivery.status === 'delivered' || delivery.status === 'cancelled') return null
  const start = Date.parse(stateClockStart(delivery))
  if (!Number.isFinite(start) || !(lateMinutes > 0)) return null
  const minutes = Math.floor((nowMs - start) / 60_000)
  if (minutes >= lateMinutes) return 'late'
  if (minutes >= Math.ceil(lateMinutes * LATE_RISK_SHARE)) return 'risk'
  return null
}

/** Banner of a lost live connection: its age since the last signal, when known. */
export function lostConnectionText(ageMs: number | null): string {
  return ageMs === null ? 'Sin conexión en vivo.' : `Se perdió la conexión en vivo ${signalAgeLabel(ageMs)}.`
}

/** Age of the last live signal: "hace 2 s", "hace 1 min", "hace 1 h". */
export function signalAgeLabel(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000))
  if (seconds < 60) return `hace ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  return `hace ${Math.floor(minutes / 60)} h`
}

export interface CourierTrip {
  /** Deliveries out for delivery. */
  onRoad: number
  /** Latest ETA among the trips on the road. */
  eta: string | null
  /** Location of the trip dispatched last (or of the last finished trip). */
  location: string | null
  /** Delivered or failed trips whose courier has not returned yet. */
  toReturn: string[]
}

interface TripRow {
  delivery: {
    orderId: string
    status: DeliveryStatus
    courierId: string | null
    courierEta?: string | null
    courierLocation?: string | null
    returnedAt?: string | null
    dispatchedAt?: string | null
  }
}

/** Per courier: trips on the road (ETA, location) and finished trips still to return. */
export function courierTrips(rows: ReadonlyArray<TripRow>): Map<string, CourierTrip> {
  const trips = new Map<string, CourierTrip & { locationAt: string }>()
  for (const { delivery } of rows) {
    if (delivery.courierId === null) continue
    const onRoad = delivery.status === 'out_for_delivery'
    const toReturn = (delivery.status === 'delivered' || delivery.status === 'failed') && !delivery.returnedAt
    if (!onRoad && !toReturn) continue
    const trip = trips.get(delivery.courierId) ?? { onRoad: 0, eta: null, location: null, toReturn: [], locationAt: '' }
    if (onRoad) {
      trip.onRoad += 1
      const eta = delivery.courierEta ?? null
      if (eta !== null && (trip.eta === null || Date.parse(eta) > Date.parse(trip.eta))) trip.eta = eta
    } else {
      trip.toReturn.push(delivery.orderId)
    }
    const at = delivery.dispatchedAt ?? ''
    if (delivery.courierLocation && (trip.location === null || at >= trip.locationAt)) {
      trip.location = delivery.courierLocation
      trip.locationAt = at
    }
    trips.set(delivery.courierId, trip)
  }
  return new Map([...trips].map(([id, { locationAt: _at, ...trip }]) => [id, trip]))
}

/** "2 pedidos en ruta · vuelve 19:55 · Laureles", "De regreso · Belén" or "En el local". */
export function courierStatusLine(trip: CourierTrip | undefined, options: { timeZone?: string } = {}): string {
  if (!trip || (trip.onRoad === 0 && trip.toReturn.length === 0)) return 'En el local'
  const parts: string[] = []
  if (trip.onRoad > 0) {
    parts.push(`${trip.onRoad} ${trip.onRoad === 1 ? 'pedido' : 'pedidos'} en ruta`)
    if (trip.eta !== null && Number.isFinite(Date.parse(trip.eta))) {
      const time = new Intl.DateTimeFormat('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: options.timeZone,
      }).format(new Date(trip.eta))
      parts.push(`vuelve ${time}`)
    }
  } else {
    parts.push('De regreso')
  }
  if (trip.location) parts.push(trip.location)
  return parts.join(' · ')
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Cerrados hoy" split and average (GET /delivery/closed-today). */
export function closedTodayLine(summary: ClosedTodaySummary): { counts: string; average: string } {
  return {
    counts: [
      plural(summary.deliveredCount, 'entregado', 'entregados'),
      plural(summary.cancelledCount, 'cancelado', 'cancelados'),
      plural(summary.failedCount, 'fallido', 'fallidos'),
    ].join(' · '),
    average:
      summary.averageDeliveryMinutes === null
        ? 'Promedio de entrega: sin entregas despachadas'
        : `Promedio de entrega ${summary.averageDeliveryMinutes} min`,
  }
}

/** "14 pedidos · último hace 6 días" (whole days since the last delivery). */
export function customerHistoryLine(history: CustomerHistory, nowMs: number = Date.now()): string {
  if (history.ordersCount === 0) return 'Sin pedidos anteriores'
  const count = plural(history.ordersCount, 'pedido', 'pedidos')
  const last = history.lastOrderAt === null ? Number.NaN : Date.parse(history.lastOrderAt)
  if (!Number.isFinite(last)) return count
  const days = Math.max(0, Math.floor((nowMs - last) / 86_400_000))
  const when = days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`
  return `${count} · último ${when}`
}

type AddressText = { addressLine: string; neighborhood: string | null; reference: string | null }

const sameText = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLocaleLowerCase('es') === (b ?? '').trim().toLocaleLowerCase('es')

/** The saved address equal to the customer's last one, or null. */
export function matchSavedAddress(
  last: AddressText,
  saved: ReadonlyArray<AddressText & { id: string }>,
): string | null {
  const found = saved.find(
    (a) =>
      sameText(a.addressLine, last.addressLine) &&
      sameText(a.neighborhood, last.neighborhood) &&
      sameText(a.reference, last.reference),
  )
  return found?.id ?? null
}

export type OrderStepId = 'customer' | 'address' | 'products' | 'payment' | 'confirm'

export const ORDER_STEPS: ReadonlyArray<{ id: OrderStepId; label: string; title: string }> = [
  { id: 'customer', label: 'Cliente', title: '¿Quién pide?' },
  { id: 'address', label: 'Dirección', title: '¿A dónde va?' },
  { id: 'products', label: 'Productos', title: '¿Qué pide?' },
  { id: 'payment', label: 'Pago', title: '¿Cómo paga?' },
  { id: 'confirm', label: 'Confirmar', title: 'Confirmar domicilio' },
]

/** Step that edits a `validateDraft` issue field. */
export function stepForField(field: string): OrderStepId {
  switch (field) {
    case 'phone':
    case 'customerName':
      return 'customer'
    case 'address':
      return 'address'
    case 'items':
      return 'products'
    case 'fee':
    case 'cashChangeFor':
      return 'payment'
    default:
      return 'confirm'
  }
}

/** True when a keydown is the plain "N" shortcut and not typing into a field. */
export function isShortcutTarget(event: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target: EventTarget | null
}): boolean {
  if (event.key !== 'n' && event.key !== 'N') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const target = event.target as HTMLElement | null
  if (!target) return true
  if (target.isContentEditable) return false
  const tag = target.tagName
  return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT'
}
