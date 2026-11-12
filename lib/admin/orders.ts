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
 *   - `fetchActiveAdminOrders` / `adminOrderFromDto`: the single read
 *     (`GET /orders` with the table and waiter names, T8b) over the shared
 *     `toOrder` mapper, which keeps the delivery label (odd/tasks/
 *     domicilios.md S14).
 *   - `mergeOrderLists`: the store + DB merge, now memoised and reference
 *     stable instead of rebuilt (with a `forEach` push) on every render.
 *   - `isNewOrderAt` / `newOrderIdsAt`: the pulse window evaluated against a
 *     timestamp the caller controls (the view passes its ticking clock), so it
 *     is a function of DATA, never of "when did this render happen".
 */
import { getByStatus, toOrder, type OrderDto } from "@/lib/api/orders"
import { takeawayLabel } from "@/lib/cashier/queue"
import type { LateThresholds } from "@/lib/api/settings"
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

/** API order (with `include=table,waiter`) to the app `Order` the grid renders. */
export function adminOrderFromDto(dto: OrderDto): AdminOrder {
  return {
    ...toOrder(dto),
    tableName: dto.tableNumber ?? "N/A",
    waiterName: dto.waiterName || "Desconocido",
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
  const rows = await getByStatus(ADMIN_ACTIVE_STATUSES, { include: ["table", "waiter"] })
  return rows.map(adminOrderFromDto)
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

// ---------------------------------------------------------------------------
// T28 (S2, S8): the dense Órdenes table. Every value of a row comes from the
// order, the shell stores (tables, waiters), the zones, the delivery board and
// the couriers; what none of them knows stays null and the UI says so.
// ---------------------------------------------------------------------------

/** The statuses the active table lists, in the order the filter chips show them. */
export type ActiveStatus = "active" | "kitchen" | "delivered"

export const ACTIVE_STATUS_ORDER: readonly ActiveStatus[] = ["active", "kitchen", "delivered"]

/** Labels shared with the cashier queue (`lib/cashier/queue.ts`) and the status tones of design/system.md. */
export const ACTIVE_STATUS_INFO: Record<ActiveStatus, { label: string; tone: "occupied" | "kitchen" | "served" }> = {
  active: { label: "Abierta", tone: "occupied" },
  kitchen: { label: "En cocina", tone: "kitchen" },
  delivered: { label: "Servida", tone: "served" },
}

export interface AdminOrderRow {
  id: string
  order: Order
  /** orders.order_number; null on a row that never carried it. */
  number: number | null
  /** "#128", or "#" + the id prefix when the order has no number. */
  label: string
  isDelivery: boolean
  /** "Mesa 8" / the delivery customer / "Domicilio" / "Para llevar · <nombre>". */
  place: string
  /** Zone of the table; null for a delivery or an unplaced table. */
  placeDetail: string | null
  /** Delivery address (line + neighbourhood). */
  address: string | null
  courierName: string | null
  waiterName: string | null
  minutes: number
  late: boolean
  total: number
  status: OrderStatus
  /** Normalised text the search matches against. */
  haystack: string
}

export interface AdminRowContext {
  nowMs: number
  /** business_config thresholds; null until the config is read (no marker then). */
  thresholds: LateThresholds | null
  tableOf: (tableId: string) => { number: number; zoneId?: string } | undefined
  zoneName: (zoneId: string) => string | undefined
  waiterName: (waiterId: string) => string | undefined
  deliveryOf: (
    orderId: string,
  ) => { customerName: string; addressLine: string; neighborhood: string | null; courierId: string | null } | undefined
  courierName: (courierId: string) => string | undefined
}

/** Lowercase without accents, so "andres" finds "Andrés". */
export function normalizeSearch(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/** Whole minutes since `createdAt` as of `nowMs`; a clock skew reads 0. */
export function minutesOpen(createdAt: Date | string | number, nowMs: number): number {
  const created = new Date(createdAt).getTime()
  if (Number.isNaN(created)) return 0
  return Math.max(0, Math.floor((nowMs - created) / 60_000))
}

/**
 * Late marker from business_config (T17): a delivery is late from
 * `deliveryLateMinutes`, a dine-in order in the kitchen from
 * `kitchenLateMinutes`. Any other order has no threshold, so no marker; and
 * without the config there is nothing to compare with.
 */
export function isLateOrder(
  order: Pick<Order, "status" | "orderType">,
  minutes: number,
  thresholds: LateThresholds | null,
): boolean {
  if (!thresholds) return false
  if (order.orderType === "delivery") return minutes >= thresholds.deliveryLateMinutes
  if (order.status === "kitchen") return minutes >= thresholds.kitchenLateMinutes
  return false
}

/** The rows of the active table, in the order given. */
export function adminOrderRows(orders: readonly Order[], ctx: AdminRowContext): AdminOrderRow[] {
  return orders.map((order) => {
    const carried = order as AdminOrder
    const isDelivery = order.orderType === "delivery"
    const number = typeof order.orderNumber === "number" ? order.orderNumber : null
    const label = number !== null ? `#${number}` : `#${order.id.slice(0, 8)}`
    const minutes = minutesOpen(order.createdAt, ctx.nowMs)

    let place: string
    let placeDetail: string | null = null
    let address: string | null = null
    let courierName: string | null = null
    if (isDelivery) {
      const delivery = ctx.deliveryOf(order.id)
      place = delivery?.customerName || "Domicilio"
      if (delivery) {
        address = [delivery.addressLine, delivery.neighborhood].filter(Boolean).join(", ") || null
        courierName = (delivery.courierId && ctx.courierName(delivery.courierId)) || null
      }
    } else if (order.orderType === "takeaway") {
      place = takeawayLabel(order)
    } else {
      const table = order.tableId ? ctx.tableOf(order.tableId) : undefined
      const tableNumber = table?.number ?? (typeof carried.tableName === "number" ? carried.tableName : null)
      place = tableNumber !== null ? `Mesa ${tableNumber}` : "Mesa ?"
      placeDetail = (table?.zoneId && ctx.zoneName(table.zoneId)) || null
    }

    const named = carried.waiterName && carried.waiterName !== "Desconocido" ? carried.waiterName : undefined
    const waiterName = (order.waiter && ctx.waiterName(order.waiter)) || named || null

    const haystack = normalizeSearch(
      [label, number ?? "", place, placeDetail, waiterName, address, courierName].filter(Boolean).join(" "),
    )

    return {
      id: order.id,
      order,
      number,
      label,
      isDelivery,
      place,
      placeDetail,
      address,
      courierName,
      waiterName,
      minutes,
      late: isLateOrder(order, minutes, ctx.thresholds),
      total: order.bill?.total ?? 0,
      status: order.status,
      haystack,
    }
  })
}

export type StatusFilter = "all" | ActiveStatus
export type TypeFilter = "all" | "table" | "takeaway" | "delivery"
export interface RowFilters {
  query: string
  status: StatusFilter
  type: TypeFilter
}

/**
 * Every search word must appear in the row. A number ("128", "#128") must be a
 * whole word, so "mesa 12" does not also find order #128; other words match
 * anywhere ("andres" finds "Andrés Felipe").
 */
function matchesWord(row: AdminOrderRow, tokens: readonly string[], word: string): boolean {
  const bare = word.replace(/^#/, "")
  if (/^\d+$/.test(bare)) return tokens.includes(bare)
  return row.haystack.includes(word)
}

export function filterOrderRows(rows: readonly AdminOrderRow[], filters: RowFilters): AdminOrderRow[] {
  const words = normalizeSearch(filters.query.trim()).split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    if (filters.status !== "all" && row.status !== filters.status) return false
    if (filters.type === "table" && (row.order.orderType ?? "dine_in") !== "dine_in") return false
    if (filters.type === "takeaway" && row.order.orderType !== "takeaway") return false
    if (filters.type === "delivery" && !row.isDelivery) return false
    if (words.length === 0) return true
    const tokens = row.haystack.split(/[\s,#]+/)
    return words.every((word) => matchesWord(row, tokens, word))
  })
}

/** Count per real status (plus `all`) for the filter chips. */
export function statusCounts(rows: readonly AdminOrderRow[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: rows.length, active: 0, kitchen: 0, delivered: 0 }
  for (const row of rows) {
    if (row.status in counts && row.status !== ("all" as string)) counts[row.status as ActiveStatus] += 1
  }
  return counts
}

export type SortKey = "number" | "minutes" | "total"
export interface RowSort {
  key: SortKey
  direction: "asc" | "desc"
}

/** Oldest first. */
export const DEFAULT_ROW_SORT: RowSort = { key: "minutes", direction: "desc" }

export function sortOrderRows(rows: readonly AdminOrderRow[], sort: RowSort): AdminOrderRow[] {
  const sign = sort.direction === "asc" ? 1 : -1
  const value = (row: AdminOrderRow) =>
    sort.key === "number" ? (row.number ?? 0) : sort.key === "total" ? row.total : row.minutes
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign)
}

/** Same column flips the direction; a new column starts ascending for Orden, descending otherwise. */
export function nextSort(current: RowSort, key: SortKey): RowSort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" }
  return { key, direction: key === "number" ? "asc" : "desc" }
}

/** "16 activas · 4 domicilios · la más antigua lleva 58 min". */
export function ordersSummary(rows: readonly AdminOrderRow[]): string {
  if (rows.length === 0) return "Sin órdenes abiertas ahora"
  const deliveries = rows.filter((row) => row.isDelivery).length
  const oldest = rows.reduce((max, row) => Math.max(max, row.minutes), 0)
  return [
    `${rows.length} ${rows.length === 1 ? "activa" : "activas"}`,
    `${deliveries} ${deliveries === 1 ? "domicilio" : "domicilios"}`,
    `la más antigua lleva ${oldest} min`,
  ].join(" · ")
}

/** "Completadas hoy": paid count, sales (sum of the totals) and tips of the day's paid orders. */
export function completedTotals(orders: readonly Order[]): { paid: number; sales: number; tips: number } {
  let sales = 0
  let tips = 0
  for (const order of orders) {
    sales += order.bill?.total ?? 0
    tips += order.bill?.tip ?? 0
  }
  return { paid: orders.length, sales, tips }
}