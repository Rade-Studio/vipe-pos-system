/**
 * Layout decisions for the delivery dispatch console (T12): board
 * columns, grouping, courier load, the column counter of the wide
 * scroller, the new-order steps and the "N" shortcut guard. Pure, no
 * DOM or network.
 */

import type { DeliveryStatus } from './types'

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
