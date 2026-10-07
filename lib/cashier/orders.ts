/**
 * lib/cashier/orders.ts
 *
 * Pure cashier order-list logic (tarea T8 de `odd/tasks/cargas-por-perfil.md`,
 * S1/S2). No Supabase, no React, no DOM: the view hands in rows and reads the
 * derived lists back out.
 *
 * What it replaces (all of it was inline in `CashierView`, duplicated three
 * times over):
 *
 *  - THREE `orderService.getByStatus([...])` calls (one per status) feeding
 *    THREE separate local arrays plus a `by-table` group, all of which had to
 *    be re-synced by hand after every refresh and after every realtime event.
 *    Now the screen issues ONE `getByStatus(CASHIER_ORDER_STATUSES)` call and
 *    every list it renders is DERIVED from that single array, so a status move
 *    re-buckets the row for free (no refetch, no second array to update).
 *
 *  - a wire-row converter duplicated between the initial load and the realtime
 *    INSERT path (`toCashierOrder`).
 *
 * Delivery invariants (odd/tasks/domicilios.md S13/S14) are preserved here, not
 * re-implemented: `orderTypeFromRow` keeps the delivery flag on every mapping
 * (so a domicilio is never labelled "Mesa ?") and `groupDineInOrdersByTable`
 * keeps tableless delivery rows OUT of the by-table cards — `DeliveryPaymentsPanel`
 * stays the place where the cashier charges deliveries.
 */
import { groupDineInOrdersByTable, orderTypeFromRow } from "@/lib/delivery/kitchen"
import { mergeOrdersList, wireRowToPartialOrder } from "@/lib/realtime/order-merge"
import type { Order, OrderBill } from "@/types"

/**
 * The statuses the cashier screen lists, asked for in ONE request. Kept as the
 * single source of truth for both the query and the derived views, so the two
 * can never drift into "a status the query asks for but no view renders".
 */
export const CASHIER_ORDER_STATUSES = ["active", "kitchen", "delivered"] as const

export type CashierOrderStatus = (typeof CASHIER_ORDER_STATUSES)[number]

/** One cache slot for the whole screen (load, refresh and realtime patch). */
export const cashierOrdersQueryKey = ["orders", "cashier"] as const

export function isCashierStatus(status: unknown): status is CashierOrderStatus {
  return typeof status === "string" && (CASHIER_ORDER_STATUSES as readonly string[]).includes(status)
}

/* --------------------------------------------------------------- wire rows */

export interface CashierOrderItemRow {
  id: string
  name: string
  price: number
  quantity: number
  comments?: string | null
}

/** The `orders` + embedded `order_items` shape both `getByStatus` and the
 *  realtime `postgres_changes` broadcast deliver. */
export interface CashierOrderRow {
  id: string
  table_id?: string | null
  order_type?: string | null
  status: string
  subtotal?: number | null
  tax?: number | null
  tax_percentage?: number | null
  tip?: number | null
  tip_percentage?: number | null
  total?: number | null
  total_discounts?: number | null
  waiter_id?: string | null
  created_at?: string | null
  is_partial_order?: boolean | null
  parent_order_id?: string | null
  order_items?: CashierOrderItemRow[] | null
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function readItems(rows: CashierOrderItemRow[] | null | undefined) {
  if (!Array.isArray(rows)) return []
  // Same fields the old inline converter produced (the views only read
  // name/price/quantity/comments); the cast keeps the runtime shape identical.
  return rows.map(
    (item) =>
      ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        comments: item.comments || undefined,
        categoryId: "",
      }) as unknown as Order["items"][number],
  )
}

function readBill(row: CashierOrderRow): OrderBill {
  return {
    subtotal: num(row.subtotal),
    tax: num(row.tax),
    taxPercentage: num(row.tax_percentage),
    tip: num(row.tip),
    tipPercentage: num(row.tip_percentage),
    total: num(row.total),
    totalDiscounts: num(row.total_discounts),
  }
}

/** Wire row → the app `Order` every cashier list renders. */
export function toCashierOrder(row: CashierOrderRow): Order {
  return {
    id: row.id,
    tableId: row.table_id ?? "",
    // S14: keep the delivery flag, otherwise a row with no table renders "Mesa ?".
    orderType: orderTypeFromRow(row),
    items: readItems(row.order_items),
    status: row.status as Order["status"],
    bill: readBill(row),
    waiter: row.waiter_id ?? "",
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    isPartialOrder: row.is_partial_order || false,
    parentOrderId: row.parent_order_id || undefined,
  }
}

/* ----------------------------------------------------------------- derives */

export interface CashierViews {
  /** Every order the screen loaded (one cache slot). */
  all: Order[]
  active: Order[]
  kitchen: Order[]
  delivered: Order[]
  /** Partial ("pago parcial") children, listed above the by-table cards. */
  partial: Order[]
  /** Dine-in orders grouped by table; delivery orders are excluded (S14). */
  byTable: Record<string, Order[]>
}

/**
 * Derive every rendered list from the single loaded array.
 *
 * Bucketing by STATUS (instead of by which request returned the row) is what
 * makes a realtime status change move the order between views: an `active` row
 * patched to `kitchen` leaves `active` and joins `kitchen` on the next render,
 * and a row patched to `paid` leaves every view — exactly what the refetch
 * would have produced, without the refetch.
 */
export function deriveCashierViews(orders: readonly Order[]): CashierViews {
  const all = orders as Order[]
  const active: Order[] = []
  const kitchen: Order[] = []
  const delivered: Order[] = []
  const partial: Order[] = []
  const visible: Order[] = []

  for (const order of all) {
    if (!isCashierStatus(order.status)) continue
    visible.push(order)
    if (order.isPartialOrder) partial.push(order)
    if (order.status === "active") active.push(order)
    else if (order.status === "kitchen") kitchen.push(order)
    else delivered.push(order)
  }

  return { all, active, kitchen, delivered, partial, byTable: groupDineInOrdersByTable(visible) }
}

/* --------------------------------------------------------- realtime patch */

export interface CashierWirePayload {
  eventType: string
  new?: unknown
  old?: unknown
}

/**
 * True when the wire row carries money worth merging. A freshly INSERTed order
 * can broadcast subtotal/tax/total as 0 before the server recomputes the bill;
 * merging that over a real bill would blank the card's total, so a row that
 * carries no positive money simply leaves `bill` untouched.
 */
function carriesMoney(row: Record<string, unknown>): boolean {
  return [row.subtotal, row.tax, row.tip, row.total].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  )
}

/**
 * Wire row → the patch merged onto a loaded order. Keys the broadcast did NOT
 * send are simply absent, so an UPDATE that only carries `status` keeps the
 * loaded `items` / `bill` BY REFERENCE (no card flicker, no re-bill).
 */
function cashierPatchFromRow(row: unknown): Partial<Order> | null {
  const base = wireRowToPartialOrder(row)
  if (!base) return null
  const source = row as Record<string, unknown>
  const patch: Partial<Order> = { ...base }
  // `wireRowToPartialOrder` defaults `tableId` to "" for a row that omits it,
  // which on the cashier screen would drop the card out of the by-table view.
  // Only carry the fields the broadcast actually sent (D7 consequence 2).
  if (!("table_id" in source)) delete patch.tableId
  const items = Array.isArray(source.order_items) ? readItems(source.order_items as CashierOrderItemRow[]) : null
  const bill = carriesMoney(source) ? readBill(source as unknown as CashierOrderRow) : null
  if (items && items.length > 0) patch.items = items
  if (bill) patch.bill = bill
  return patch
}

/**
 * Apply one `postgres_changes` order event to the loaded list.
 *
 * - INSERT with its items paints the new card (the shared channel attaches
 *   `order_items` before fan-out). An INSERT WITHOUT items is dropped rather
 *   than painted as an empty, zero-total card — the next load brings it in.
 * - UPDATE patches the row in place; the derived views re-bucket it.
 * - DELETE removes the row.
 * - Anything else (and any no-op) returns the IDENTICAL array reference, so a
 *   `setQueryData` on a no-op event notifies nobody.
 */
export function applyCashierOrderEvent(orders: readonly Order[], payload: CashierWirePayload): Order[] {
  const prev = orders as Order[]

  if (payload.eventType === "INSERT") {
    const row = payload.new as CashierOrderRow | null | undefined
    if (!row || !row.id || !row.status) return prev
    if (!Array.isArray(row.order_items) || row.order_items.length === 0) return prev
    return mergeOrdersList(prev, { eventType: "INSERT", new: toCashierOrder(row) })
  }

  if (payload.eventType === "UPDATE") {
    const patch = cashierPatchFromRow(payload.new)
    if (!patch) return prev
    return mergeOrdersList(prev, { eventType: "UPDATE", new: patch })
  }

  if (payload.eventType === "DELETE") {
    const id = (payload.old as { id?: unknown } | null | undefined)?.id
    if (typeof id !== "string" || id === "") return prev
    return mergeOrdersList(prev, { eventType: "DELETE", old: { id } })
  }

  return prev
}

/* -------------------------------------------------- payment dialog payload */

/**
 * The shape `PaymentMethodDialog` bills from. Structurally the `orders` row
 * it used to fetch with `getById`, so the dialog's maths is untouched.
 */
export interface CashierBillSource {
  order_items: Array<{
    id: string
    name: string
    price: number
    quantity: number
    comments?: string | null
  }>
  tax_percentage: number
  tip_percentage: number
  subtotal: number
  tax: number
  tip: number
  table_id: string | null
  waiter_id: string | null
}

/** The loaded app order → the dialog's bill source (no round trip). */
export function billSourceFromOrder(order: Order): CashierBillSource {
  const bill = order.bill
  const isDelivery = order.orderType === "delivery"
  return {
    order_items: (order.items ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments ?? null,
    })),
    tax_percentage: num(bill?.taxPercentage),
    tip_percentage: num(bill?.tipPercentage),
    subtotal: num(bill?.subtotal),
    tax: num(bill?.tax),
    tip: num(bill?.tip),
    // A delivery has no table to print (S14); keep `null`, never "Mesa ?".
    table_id: isDelivery ? null : order.tableId || null,
    waiter_id: order.waiter || null,
  }
}

/**
 * Whether a bill source is enough to charge without reading the order again.
 * A realtime INSERT stub (or a caller that passes nothing) has no items, so the
 * dialog still falls back to `orderService.getById` in that case.
 */
export function hasBillableItems(source: CashierBillSource | null | undefined): boolean {
  return !!source && Array.isArray(source.order_items) && source.order_items.length > 0
}