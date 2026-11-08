import type { Table } from "@/types"
import { ApiError, conflictMessage } from "@/lib/api/errors"

/**
 * Table reservations (odd/tasks/reservas-mesas.md T2, L4): the name is
 * trimmed, 1..80 characters; the arrival is an optional time of today, at
 * most 5 minutes ago (the API answers 422 `arrival_in_past` otherwise).
 */
export const NAME_MAX = 80
const PAST_GRACE_MS = 5 * 60_000

/** The browser's clock zone: the client has no restaurant timezone setting. */
const TIME = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" })

/** "8:30 p. m." (es-CO; Intl's non-breaking spaces become plain ones). */
export function arrivalLabel(iso: string): string {
  return TIME.format(new Date(iso)).replace(/[\u00a0\u202f]/g, " ")
}

/** "Reserva: Familia López · llega 8:30 p. m."; null when the table is not reserved. */
export function reservationLine(table: Pick<Table, "status" | "reservationName" | "reservationArrivalAt">): string | null {
  if (table.status !== "reserved") return null
  const name = `Reserva: ${table.reservationName ?? "Sin nombre"}`
  return table.reservationArrivalAt ? `${name} · llega ${arrivalLabel(table.reservationArrivalAt)}` : name
}

/** S1: only a free table (available, no open order) can be reserved. */
export function isFreeTable(table: Pick<Table, "status">, hasOpenOrder: boolean): boolean {
  return table.status === "available" && !hasOpenOrder
}

export type ReserveBody = { name: string; arrivalAt?: string }
export type ReservationCheck =
  | { ok: true; body: ReserveBody }
  | { ok: false; field: "name" | "time"; message: string }

/** The sheet's fields → the reserve body; `time` is an <input type="time"> value ("20:30" or ""). */
export function validateReservation(input: { name: string; time: string }, now: Date = new Date()): ReservationCheck {
  const name = input.name.trim()
  if (!name) return { ok: false, field: "name", message: "Escribe a nombre de quién" }
  if (name.length > NAME_MAX) return { ok: false, field: "name", message: `Máximo ${NAME_MAX} caracteres` }
  const match = /^(\d{2}):(\d{2})$/.exec(input.time)
  if (!match) return { ok: true, body: { name } }
  const at = new Date(now)
  at.setHours(Number(match[1]), Number(match[2]), 0, 0)
  if (at.getTime() < now.getTime() - PAST_GRACE_MS) return { ok: false, field: "time", message: "La hora ya pasó" }
  return { ok: true, body: { name, arrivalAt: at.toISOString() } }
}

/** The reserve API's errors in the sheet's words. */
export function reserveErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.body.code : undefined
  if (code === "table_not_available") return "Esta mesa ya no está libre"
  if (code === "arrival_in_past") return "La hora ya pasó"
  return conflictMessage(error, "No se pudo reservar la mesa. Intente nuevamente.")
}
