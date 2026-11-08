/**
 * The cashier queue (T14): one row per table with dine-in orders to charge,
 * and one per partial ("pago parcial") child. Derived from the views in
 * `orders.ts`; nothing here is fetched or stored.
 */
import type { CartItem, Order } from "@/types"
import type { ChipTone } from "@/components/cashier/cashier-ui"
import type { CashierOrder } from "./orders"

export type QueueKind = "table" | "partial"

export interface QueueEntry {
  /** Stable selection key: `table:<tableId>` or `partial:<orderId>`. */
  key: string
  kind: QueueKind
  tableId: string
  tableNumber: number | undefined
  /** "Mesa 12" or "Mesa 12 · Parcial". */
  label: string
  waiterName: string | undefined
  /** Zone of the table (T24), when the table is placed in one. */
  zoneName: string | undefined
  /** Per-restaurant folios of the listed orders, in list order (T24). */
  orderNumbers: number[]
  /** Guests captured on the orders; the largest when several (T24). */
  guests: number | undefined
  orders: Order[]
  /** The order the payment panel charges (the first order of the table, as before). */
  payOrder: Order
  total: number
  openedAt: Date
  status: { label: string; tone: ChipTone }
}

const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  active: { label: "Abierta", tone: "occupied" },
  kitchen: { label: "En cocina", tone: "kitchen" },
  delivered: { label: "Servida", tone: "served" },
}

/** The least advanced status of the table: one dish still cooking keeps it "En cocina". */
function tableStatus(orders: readonly Order[]): { label: string; tone: ChipTone } {
  if (orders.some((o) => o.status === "kitchen")) return STATUS.kitchen
  if (orders.some((o) => o.status === "active")) return STATUS.active
  return STATUS.delivered
}

function earliest(orders: readonly Order[]): Date {
  return orders.reduce<Date>((min, o) => (o.createdAt < min ? o.createdAt : min), orders[0]!.createdAt)
}

export interface QueueSources {
  byTable: Record<string, Order[]>
  partial: Order[]
  tableNumberById: Record<string, number>
  /** Zone name by table id; a table without zone is absent. */
  zoneNameByTableId?: Record<string, string>
  waiterName: (waiterId: string) => string | undefined
}

function captured(orders: readonly Order[]) {
  const orderNumbers = orders.flatMap((o) => (typeof o.orderNumber === "number" && o.orderNumber > 0 ? [o.orderNumber] : []))
  const guestCounts = orders.flatMap((o) => (typeof o.guests === "number" ? [o.guests] : []))
  return { orderNumbers, guests: guestCounts.length > 0 ? Math.max(...guestCounts) : undefined }
}

export function tableEntries({ byTable, tableNumberById, zoneNameByTableId = {}, waiterName }: QueueSources): QueueEntry[] {
  return Object.entries(byTable)
    .filter(([, orders]) => orders.length > 0)
    .map(([tableId, orders]) => {
      const tableNumber = tableNumberById[tableId]
      return {
        key: `table:${tableId}`,
        kind: "table" as const,
        tableId,
        tableNumber,
        label: `Mesa ${tableNumber ?? "?"}`,
        waiterName: (orders[0] as CashierOrder).waiterName ?? waiterName(orders[0]!.waiter),
        zoneName: zoneNameByTableId[tableId],
        ...captured(orders),
        orders,
        payOrder: orders[0]!,
        total: orders.reduce((sum, o) => sum + o.bill.total, 0),
        openedAt: earliest(orders),
        status: tableStatus(orders),
      }
    })
}

export function partialEntries({ partial, tableNumberById, zoneNameByTableId = {}, waiterName }: QueueSources): QueueEntry[] {
  return partial.map((order) => {
    const tableNumber = tableNumberById[order.tableId]
    return {
      key: `partial:${order.id}`,
      kind: "partial" as const,
      tableId: order.tableId,
      tableNumber,
      label: `Mesa ${tableNumber ?? "?"} · Parcial`,
      waiterName: (order as CashierOrder).waiterName ?? waiterName(order.waiter),
      zoneName: zoneNameByTableId[order.tableId],
      ...captured([order]),
      orders: [order],
      payOrder: order,
      total: order.bill.total,
      openedAt: order.createdAt,
      status: { label: "Parcial", tone: "warning" as const },
    }
  })
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

export const folio = (orderNumber: number) => `#${orderNumber}`

const guestsLabel = (guests: number) => (guests === 1 ? "1 persona" : `${guests} personas`)

/** Queue row line: "#128 · Terraza · Carlos Pérez · 4 personas · desde 13:46"; what was not captured is left out. */
export function entryMeta(entry: QueueEntry): string {
  return [
    ...entry.orderNumbers.slice(0, 1).map(folio),
    entry.zoneName,
    entry.waiterName,
    entry.guests !== undefined ? guestsLabel(entry.guests) : undefined,
    `desde ${clockTime(entry.openedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Detail header: eyebrow "Orden #128 · Terraza" and "Carlos Pérez · abierta 13:46 · 4 personas". */
export function entryHeader(entry: QueueEntry): { eyebrow: string; meta: string } {
  const folios = entry.orderNumbers.map(folio).join(", ")
  const head = entry.orders.length > 1 ? [`${entry.orders.length} órdenes`, folios || undefined] : [`Orden${folios ? ` ${folios}` : ""}`]
  return {
    eyebrow: [...head, entry.zoneName].filter(Boolean).join(" · "),
    meta: [entry.waiterName, `abierta ${clockTime(entry.openedAt)}`, entry.guests !== undefined ? guestsLabel(entry.guests) : undefined]
      .filter(Boolean)
      .join(" · "),
  }
}

/** Case- and accent-insensitive match on the table label, zone, waiter, folio or order id. */
export function matchesQueueSearch(entry: QueueEntry, query: string): boolean {
  const needle = fold(query.trim())
  if (!needle) return true
  const haystack = [
    entry.label,
    entry.zoneName ?? "",
    entry.waiterName ?? "",
    ...entry.orderNumbers.map(folio),
    ...entry.orders.map((o) => o.id),
  ].map(fold)
  return haystack.some((value) => value.includes(needle))
}

/** Items grouped by name + comments (the same grouping the cards used). */
/**
 * The identity of a bill line: name + comment, plus the sorted option ids
 * (F7), so two burgers with different options never merge.
 */
export function billLineKey(item: Pick<CartItem, "name" | "comments" | "modifiers">): string {
  const options = (item.modifiers ?? []).map((modifier) => modifier.optionId).sort()
  const key = `${item.name}-${item.comments || ""}`
  return options.length ? `${key}|${options.join(",")}` : key
}

export function groupItems(items: readonly CartItem[]): CartItem[] {
  const grouped: Record<string, CartItem> = {}
  for (const item of items) {
    const key = billLineKey(item)
    if (!grouped[key]) grouped[key] = { ...item }
    else grouped[key].quantity += item.quantity
  }
  return Object.values(grouped)
}

export interface QueueTotals {
  subtotal: number
  tax: number
  /** The tax rate when every order shares it; null when they differ. */
  taxPercentage: number | null
  tip: number
  total: number
}

export function entryTotals(orders: readonly Order[]): QueueTotals {
  const rates = new Set(orders.map((o) => o.bill.taxPercentage))
  return {
    subtotal: orders.reduce((s, o) => s + o.bill.subtotal, 0),
    tax: orders.reduce((s, o) => s + o.bill.tax, 0),
    taxPercentage: rates.size === 1 ? [...rates][0]! : null,
    tip: orders.reduce((s, o) => s + (o.bill.tip || 0), 0),
    total: orders.reduce((s, o) => s + o.bill.total, 0),
  }
}

export function clockTime(date: Date): string {
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
}
