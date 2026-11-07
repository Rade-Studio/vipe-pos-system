/**
 * Admin "Anulaciones" and "Canceladas" (F3, design/anulaciones/01): totals,
 * row text and CSV of the stored events (GET /audit) and of the cancelled
 * orders (GET /orders/cancelled). Only what the API stored is shown.
 */
import type { AuditEvent, AuditEventType } from "@/lib/api/audit"
import type { CancelledOrderDto } from "@/lib/api/orders"
import { localDayKey } from "./dates"

export const AUDIT_TYPE_LABEL: Record<AuditEventType, string> = {
  order_cancelled: "Orden cancelada",
  items_voided: "Plato anulado",
  payment_voided: "Pago anulado",
}

export interface AuditTotals {
  cancelled: { amount: number; count: number }
  items: { amount: number; units: number }
  payments: { amount: number; count: number }
  selfAuthorized: { amount: number; count: number }
}

type Json = Record<string, unknown>
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : [])
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0)

export function auditTotals(events: readonly AuditEvent[]): AuditTotals {
  const totals: AuditTotals = {
    cancelled: { amount: 0, count: 0 },
    items: { amount: 0, units: 0 },
    payments: { amount: 0, count: 0 },
    selfAuthorized: { amount: 0, count: 0 },
  }
  for (const event of events) {
    if (event.eventType === "order_cancelled") {
      totals.cancelled.amount += event.amount
      totals.cancelled.count += 1
    } else if (event.eventType === "items_voided") {
      totals.items.amount += event.amount
      totals.items.units += list(event.details.lines).reduce((sum, line) => sum + count(line.quantity), 0)
    } else {
      totals.payments.amount += event.amount
      totals.payments.count += 1
    }
    if (event.selfAuthorized) {
      totals.selfAuthorized.amount += event.amount
      totals.selfAuthorized.count += 1
    }
  }
  return totals
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "#128" and what was voided: "1× Bandeja paisa", "3 platos" or the payment methods. */
export function auditSubject(
  event: AuditEvent,
  methodName: (code: string) => string = (code) => code,
): { title: string; detail: string | null } {
  const title = event.orderNumber !== null ? `#${event.orderNumber}` : "Orden"
  if (event.eventType === "items_voided") {
    const lines = list(event.details.lines).map((line) => `${count(line.quantity)}× ${String(line.name ?? "")}`)
    return { title, detail: lines.length > 0 ? lines.join(", ") : null }
  }
  if (event.eventType === "order_cancelled") {
    return { title, detail: plural(list(event.details.items).length, "plato", "platos") }
  }
  const methods = event.details.methods
  const names = typeof methods === "string" ? methods.split(",").map((code) => methodName(code.trim())).filter(Boolean) : []
  return { title, detail: names.length > 0 ? names.join(" + ") : null }
}

export function auditReason(event: AuditEvent): string {
  if (event.reason === "other" && event.reasonText) return `Otro: «${event.reasonText}»`
  return event.reasonText ? `${event.reasonLabel}: «${event.reasonText}»` : event.reasonLabel
}

const pad = (n: number) => String(n).padStart(2, "0")
export const clock = (iso: string) => {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const CSV_HEADER = ["Fecha", "Hora", "Tipo", "Orden", "Detalle", "Motivo", "Pidió", "Autorizó", "Autoautorizada", "Monto"]

/** The listed events as CSV (local date and time, amount in pesos). */
export function auditCsv(events: readonly AuditEvent[], methodName?: (code: string) => string): string {
  const rows = events.map((event) => {
    const subject = auditSubject(event, methodName)
    return [
      localDayKey(new Date(event.createdAt)),
      clock(event.createdAt),
      AUDIT_TYPE_LABEL[event.eventType],
      subject.title,
      subject.detail ?? "",
      auditReason(event),
      event.actor.name,
      event.authorizedBy?.name ?? "",
      event.selfAuthorized ? "Sí" : "No",
      event.amount,
    ]
      .map(csvCell)
      .join(",")
  })
  return [CSV_HEADER.join(","), ...rows].join("\r\n")
}

/** Orders cancelled that day and the bill each had at that moment. */
export function cancelledTotals(orders: readonly CancelledOrderDto[]): { count: number; total: number } {
  return { count: orders.length, total: orders.reduce((sum, order) => sum + order.cancellation.total, 0) }
}
