/**
 * Delivery realtime rules (T10, S1/S2), pure.
 *
 * BEFORE this module the delivery board's realtime contract was "invalidate
 * the whole `active-deliveries` query on every push":
 *
 *   - `orders` was subscribed with a bare `event: '*'` filter, so EVERY table
 *     order write in the restaurant (items added, item served, order status
 *     moved) refetched the whole delivery board. That is the "hasta en
 *     domicilio cada que elijo una mesa hay una carga de pantalla como si
 *     espabilara" report (S2): a table interaction reloaded the delivery
 *     screen even though nothing about it changed.
 *   - nothing coalesced a burst, so a payment / a status move that produced
 *     several pushes produced several refetches.
 *   - `order_deliveries` carries the FULL row (REPLICA IDENTITY FULL, see
 *     migration 20261007100000), so a lifecycle move could be merged instead
 *     of refetched — the board already had the bill half of the row and only
 *     the `delivery` half changes.
 *
 * This module owns the three decisions and nothing else:
 *   1. `isDeliveryOrderChange` — is an `orders` push about a delivery?
 *   2. `applyDeliveryRowPatch` / `applyDeliveryStatusPatch` — merge an
 *      `order_deliveries` row (from realtime or from the `set_delivery_status`
 *      RPC) into the board's rows, or say a refetch is still needed.
 *   3. `createDebouncedRefresher` — coalesce the refetches that remain.
 *
 * No Supabase, no React: the hook composes these.
 */

import { parseOrderDeliveryRow } from './parse'
import type { DeliveryOrder } from './types'

/**
 * How long a burst of realtime pushes is collected before the board refetches.
 * 150 ms is short enough that a change still lands "immediately" for the
 * operator and long enough to absorb the pushes one server action produces
 * (status move + the `orders` touch it triggers).
 */
export const DELIVERY_REALTIME_DEBOUNCE_MS = 150

/**
 * The board row shape (structurally `DeliveryOrderWithBill` from
 * `lib/supabase/delivery-service`, declared here so this module stays free of
 * any Supabase import).
 */
export interface DeliveryBoardRow {
  delivery: DeliveryOrder
  /** orders.total (subtotal + tax); the fee is rendered separately. */
  amountDue: number
  subtotal: number
  tax: number
  /** orders.status === 'paid'. */
  isPaid: boolean
}

/**
 * What the caller should do with an `order_deliveries` change:
 *   - `patched`       → replace the cached rows, no request.
 *   - `unchanged`     → the cache already shows this (the echo of a write this
 *                      client already applied): do nothing, no request.
 *   - `needs-refresh` → the row is not on the board (a delivery created while
 *                      it was open) or the payload was not a complete row:
 *                      read the board again.
 */
export type DeliveryMergeOutcome<T> =
  | { kind: 'patched'; rows: T[] }
  | { kind: 'unchanged' }
  | { kind: 'needs-refresh' }

/**
 * Does this `orders` push belong to the delivery board?
 *
 * `orders.order_type` is NOT NULL with a `dine_in` default, and the table has
 * REPLICA IDENTITY FULL, so INSERT/UPDATE payloads carry it. A DELETE payload
 * carries it on `old` instead. Anything we cannot classify as a delivery row is
 * ignored: over-refetching is exactly the defect this replaces, so an unknown
 * payload must not cost a request.
 */
export function isDeliveryOrderChange(payload: {
  eventType?: string
  new?: unknown
  old?: unknown
}): boolean {
  const next = payload?.new
  if (next !== null && typeof next === 'object') {
    const orderType = (next as { order_type?: unknown }).order_type
    if (orderType !== undefined) return orderType === 'delivery'
  }
  const previous = payload?.old
  if (previous !== null && typeof previous === 'object') {
    return (previous as { order_type?: unknown }).order_type === 'delivery'
  }
  return false
}

/** Field-by-field identity for two parsed `order_deliveries` rows. */
function sameDelivery(a: DeliveryOrder, b: DeliveryOrder): boolean {
  const keys = Object.keys(a) as Array<keyof DeliveryOrder>
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * Is the incoming row OLDER than the cached one?
 *
 * `order_deliveries.updated_at` is maintained by the `set_updated_at()` trigger
 * (migration 20261007100000), so it is the row's own version. Realtime pushes
 * can arrive out of order (two channels, a reconnect burst, a push overtaken by
 * an RPC echo), and a card that walked backwards would stay wrong until the
 * next unrelated event. Only a STRICTLY older row is dropped: an equal or
 * unparsable timestamp keeps the previous behaviour, where the rest of the row
 * decides.
 */
function isStale(cached: DeliveryOrder, incoming: DeliveryOrder): boolean {
  const cachedAt = Date.parse(cached.updatedAt)
  const incomingAt = Date.parse(incoming.updatedAt)
  if (Number.isNaN(cachedAt) || Number.isNaN(incomingAt)) return false
  return incomingAt < cachedAt
}

/**
 * Merge a parsed `order_deliveries` row into the board rows.
 *
 * Only the `delivery` half changes: `amountDue` / `subtotal` / `tax` /
 * `isPaid` come from the joined `orders` row, which the push does not carry,
 * so they are preserved by reference from the cached row.
 */
function mergeDelivery<T extends DeliveryBoardRow>(
  prev: readonly T[],
  delivery: DeliveryOrder,
): DeliveryMergeOutcome<T> {
  const index = prev.findIndex((row) => row.delivery.orderId === delivery.orderId)
  if (index === -1) return { kind: 'needs-refresh' }
  const current = prev[index]!
  // An older row (late push, stale RPC echo) must never move the card back.
  if (isStale(current.delivery, delivery)) return { kind: 'unchanged' }
  if (sameDelivery(current.delivery, delivery)) return { kind: 'unchanged' }
  const rows = [...prev]
  rows[index] = { ...current, delivery }
  return { kind: 'patched', rows }
}

/**
 * Apply the row the `set_delivery_status` RPC returned (already parsed into
 * the camelCase `DeliveryOrder` shape). This is what a card action uses right
 * after a successful write, so the board shows the new state without reading
 * the board again.
 */
export function applyDeliveryStatusPatch<T extends DeliveryBoardRow>(
  prev: readonly T[],
  delivery: DeliveryOrder,
): DeliveryMergeOutcome<T> {
  return mergeDelivery(prev, delivery)
}

/**
 * Apply a raw snake_case `order_deliveries` row from a `postgres_changes`
 * push. A payload that is not a complete row (partial UPDATE, DELETE, or a
 * parse failure) asks for a refetch rather than guessing.
 */
export function applyDeliveryRowPatch<T extends DeliveryBoardRow>(
  prev: readonly T[],
  raw: unknown,
): DeliveryMergeOutcome<T> {
  let delivery: DeliveryOrder
  try {
    delivery = parseOrderDeliveryRow(raw)
  } catch {
    return { kind: 'needs-refresh' }
  }
  return mergeDelivery(prev, delivery)
}

export interface DebouncedRefresher {
  (): void
  /** Drop the pending window and run the refetch now (used when unmounting). */
  cancel(): void
}

/**
 * Trailing-edge debounce: every push inside the window collapses into ONE
 * call, and a push that arrives after a call already ran starts a new window
 * (a later change is never swallowed).
 */
export function createDebouncedRefresher(
  refresh: () => void,
  waitMs: number,
): DebouncedRefresher {
  let timer: ReturnType<typeof setTimeout> | null = null

  const push = (() => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      refresh()
    }, waitMs)
  }) as DebouncedRefresher

  push.cancel = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
    refresh()
  }

  return push
}