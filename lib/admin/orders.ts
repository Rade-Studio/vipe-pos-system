/**
 * T9 (S1) — the ONE active-orders read of the admin panel, plus the pure list
 * logic the Órdenes tab renders.
 *
 * Before this module the same screen did the same work twice:
 *   - `useQuery(['orders','admin'])` (`fetchAdminOrders`) and
 *   - `loadActiveOrdersFromDB()`, which repeated the wire→app mapper verbatim
 *     and then called the store's `loadOrders()` (THREE more `getByStatus`
 *     reads: kitchen, delivered, active).
 * On top of that the "new order" pulse was computed as
 * `new Date().getTime() - new Date(order.createdAt).getTime() < 30000` inside
 * the render of every card, so the answer changed on every render and a card
 * that ever rendered inside the window kept `animate-pulse-light` forever.
 *
 * What lives here:
 *   - `fetchActiveAdminOrders` / `adminOrderFromRow`: the single read and the
 *     single mapper (`orderTypeFromRow` keeps the delivery label, odd/tasks/
 *     domicilios.md S14).
 *   - `mergeOrderLists`: the store + DB merge, now memoised and reference
 *     stable instead of rebuilt (with a `forEach` push) on every render.
 *   - `isNewOrderAt` / `newOrderIdsAt`: the pulse window evaluated against a
 *     timestamp the caller controls (the view passes its ticking clock), so it
 *     is a function of DATA, never of "when did this render happen".
 */
import { orderTypeFromRow } from "@/lib/delivery/kitchen"
import { supabase } from "@/lib/supabase/client"
import type { Order, OrderStatus } from "@/types"

/**
 * Cache slot the admin grid renders, the realtime handler patches
 * (`AdminView`) and the delete handler filters. Shared with the T5 realtime
 * patch, so the key is a single exported constant.
 */
export const adminOrdersQueryKey = ["orders", "admin"] as const

/** Exactly the statuses the admin grid lists. */
export const ADMIN_ACTIVE_STATUSES: readonly OrderStatus[] = ["active", "kitchen", "delivered"]

/** How long a freshly created order pulses. Unchanged from the original 30 s. */
export const NEW_ORDER_PULSE_MS = 30_000

/** The statuses the admin grid takes from the order store. */
const GRID_STORE_STATUSES: readonly OrderStatus[] = ["kitchen", "delivered", "paid"]

/** An admin order carries the joined table number / waiter name for the card. */
export type AdminOrder = Order & { tableName?: string | number; waiterName?: string }

/** Wire (`snake_case`) row → the app `Order` the grid renders. */
export function adminOrderFromRow(row: any): AdminOrder {
  return {
    id: row.id,
    tableId: row.table_id ?? "",
    orderType: orderTypeFromRow(row),
    waiter: row.waiter_id ?? "",
    status: row.status,
    items:
      (row.order_items || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        categoryId: "",
        image: "",
        comments: item.comments || "",
        status: item.status || "kitchen",
      })) || [],
    bill: {
      subtotal: row.subtotal || 0,
      tax: row.tax || 0,
      taxPercentage: row.tax_percentage || 0,
      tip: row.tip || 0,
      tipPercentage: row.tip_percentage || 0,
      total: row.total || 0,
      totalDiscounts: row.total_discounts ?? 0,
    },
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    tableName: row.tables?.number || "N/A",
    waiterName: row.profiles?.full_name || "Desconocido",
  }
}

/**
 * The single active-orders read of the admin panel.
 *
 * It replaces BOTH previous reads: the hand-rolled `loadActiveOrdersFromDB`
 * (a verbatim copy of this query) and the store's `loadOrders()` triple
 * `getByStatus` sweep.
 */
export async function fetchActiveAdminOrders(): Promise<AdminOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      *,
      order_items(*),
      tables(number),
      profiles(full_name)
    `)
    .in("status", [...ADMIN_ACTIVE_STATUSES])
    .order("created_at", { ascending: false })

  if (error) throw error

  return (data || []).map((row: any) => adminOrderFromRow(row))
}

/**
 * Merge two order lists by id, `base` first.
 *
 * Returns the IDENTICAL `base` reference when `extra` adds nothing, so a
 * `useMemo` downstream never invalidates on a realtime no-op (same contract as
 * `lib/realtime/order-merge.ts`).
 */
export function mergeOrderLists<T extends Order>(base: readonly T[], extra: readonly T[]): T[] {
  if (extra.length === 0) return base as T[]

  const present = new Set(base.map((order) => order.id))
  const missing = extra.filter((order) => {
    if (present.has(order.id)) return false
    present.add(order.id)
    return true
  })

  if (missing.length === 0) return base as T[]
  return [...base, ...missing]
}

/**
 * The store orders the admin grid listed before the query existed: kitchen,
 * delivered and paid. `useOrderStore` for the admin is the startup snapshot the
 * shell loaded (`lib/shell/startup-loads.ts`), so this filter keeps the grid on
 * exactly the rows it showed before, and the query fills in the rest.
 */
export function gridOrdersFromStore(orders: readonly Order[]): Order[] {
  return orders.filter((order) =>
    (GRID_STORE_STATUSES as readonly OrderStatus[]).includes(order.status),
  )
}

/** Drop one order by id, reference-stable when it was not there. */
export function withoutOrder<T extends Order>(list: readonly T[], id: string): T[] {
  const index = list.findIndex((order) => order.id === id)
  if (index === -1) return list as T[]
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

/**
 * Is this order inside the pulse window as of `nowMs`?
 *
 * The caller owns `nowMs` (the view's clock), so the answer is a function of
 * the data plus that clock — never of the render itself.
 */
export function isNewOrderAt(
  createdAt: Date | string | number | null | undefined,
  nowMs: number,
  windowMs: number = NEW_ORDER_PULSE_MS,
): boolean {
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt as any).getTime()
  if (Number.isNaN(created)) return false

  const age = nowMs - created
  // A clock skew that puts the order in the future must not pulse forever
  // either: only a non-negative age inside the window counts.
  if (age < 0) return false
  return age < windowMs
}

/** Ids of the orders inside the pulse window at `nowMs`. */
export function newOrderIdsAt(
  orders: readonly Order[],
  nowMs: number,
  windowMs: number = NEW_ORDER_PULSE_MS,
): Set<string> {
  const ids = new Set<string>()
  for (const order of orders) {
    if (isNewOrderAt(order.createdAt, nowMs, windowMs)) ids.add(order.id)
  }
  return ids
}

/** How many orders sit in each of the given statuses. */
export function countOrdersByStatus(
  orders: readonly Order[],
  statuses: readonly OrderStatus[],
): number {
  let count = 0
  for (const order of orders) {
    if (statuses.includes(order.status)) count += 1
  }
  return count
}

/**
 * The paid orders created on the local day that starts at `dayStartMs`.
 *
 * Two readers: the dashboard's "Completadas hoy" counter and the Órdenes
 * Completadas table (which merges its day's query with the paid orders the
 * order store already holds). `dayStartMs` comes from
 * `startOfLocalDayMs(new Date())`, so the answer is a function of the data,
 * not of when a render happened.
 */
export function paidOrdersOn(orders: readonly Order[], dayStartMs: number): Order[] {
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000
  const paid: Order[] = []
  for (const order of orders) {
    if (order.status !== "paid") continue
    const createdAt = new Date(order.createdAt).getTime()
    if (Number.isNaN(createdAt)) continue
    if (createdAt >= dayStartMs && createdAt < dayEndMs) paid.push(order)
  }
  return paid
}

/** How many paid orders belong to the local day that starts at `dayStartMs`. */
export function countPaidOrdersOn(orders: readonly Order[], dayStartMs: number): number {
  return paidOrdersOn(orders, dayStartMs).length
}