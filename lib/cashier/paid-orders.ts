/**
 * The "Pagadas" queue tab (T24): the current register's paid orders as the
 * API returns them (GET /registers/:id/paid-orders), newest first.
 */
import type { RegisterPaidOrder } from "@/lib/api/registers"
import { clockTime, folio } from "./queue"

export interface PaidOrderRow {
  /** The payment id. */
  key: string
  orderId: string
  folio: string | null
  /** "Mesa 12 · Terraza" or "Domicilio". */
  place: string
  waiterName: string | null
  total: number
  tip: number
  /** "Tarjeta · Ref. 4821 + Efectivo". */
  methods: string
  time: string
}

export function paidOrderRows(rows: readonly RegisterPaidOrder[]): PaidOrderRow[] {
  return [...rows]
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
    .map((row) => ({
      key: row.paymentId,
      orderId: row.orderId,
      folio: row.orderNumber ? folio(row.orderNumber) : null,
      place:
        row.orderType === "delivery"
          ? "Domicilio"
          : [`Mesa ${row.tableNumber ?? "?"}`, row.zoneName].filter(Boolean).join(" · "),
      waiterName: row.waiter?.name ?? null,
      total: row.total,
      tip: row.tip,
      methods: row.tenders
        .map((t) => (t.methodKind !== "cash" && t.reference ? `${t.methodName} · Ref. ${t.reference}` : t.methodName))
        .join(" + "),
      time: clockTime(row.paidAt),
    }))
}
