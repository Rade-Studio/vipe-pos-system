/**
 * The cashier queue (T14): one row per table with dine-in orders to charge,
 * and one per partial ("pago parcial") child. Derived from the views in
 * `orders.ts`; nothing here is fetched or stored.
 */
import type { CartItem, Order } from "@/types"
import type { ChipTone } from "@/components/cashier/cashier-ui"

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
  waiterName: (waiterId: string) => string | undefined
}

export function tableEntries({ byTable, tableNumberById, waiterName }: QueueSources): QueueEntry[] {
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
        waiterName: waiterName(orders[0]!.waiter),
        orders,
        payOrder: orders[0]!,
        total: orders.reduce((sum, o) => sum + o.bill.total, 0),
        openedAt: earliest(orders),
        status: tableStatus(orders),
      }
    })
}

export function partialEntries({ partial, tableNumberById, waiterName }: QueueSources): QueueEntry[] {
  return partial.map((order) => {
    const tableNumber = tableNumberById[order.tableId]
    return {
      key: `partial:${order.id}`,
      kind: "partial" as const,
      tableId: order.tableId,
      tableNumber,
      label: `Mesa ${tableNumber ?? "?"} · Parcial`,
      waiterName: waiterName(order.waiter),
      orders: [order],
      payOrder: order,
      total: order.bill.total,
      openedAt: order.createdAt,
      status: { label: "Parcial", tone: "warning" as const },
    }
  })
}

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

/** Case- and accent-insensitive match on the table label, the waiter or an order number. */
export function matchesQueueSearch(entry: QueueEntry, query: string): boolean {
  const needle = fold(query.trim())
  if (!needle) return true
  const haystack = [entry.label, entry.waiterName ?? "", ...entry.orders.map((o) => o.id)].map(fold)
  return haystack.some((value) => value.includes(needle))
}

/** Items grouped by name + comments (the same grouping the cards used). */
export function groupItems(items: readonly CartItem[]): CartItem[] {
  const grouped: Record<string, CartItem> = {}
  for (const item of items) {
    const key = `${item.name}-${item.comments || ""}`
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
