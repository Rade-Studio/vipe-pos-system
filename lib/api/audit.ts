import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Cancellations and voids (F1, odd/tasks/fase3-operacion.md S1 a). Nothing is
 * deleted: every cancellation, item void and payment void is stored with its
 * reason, who did it and the supervisor whose PIN authorized it
 * (`authorizeSupervisor`, F2). The admin reads them with `GET /audit`.
 */

type Schemas = components["schemas"]
export type AuditEvent = Schemas["AuditEvent"]
export type AuditEventType = AuditEvent["eventType"]
export type VoidReasonCode = AuditEvent["reason"]

/** The fixed list of reasons the API accepts, with the label the screens show. "other" needs a text. */
export const VOID_REASONS: readonly { code: VoidReasonCode; label: string }[] = [
  { code: "waiter_error", label: "Error del mesero" },
  { code: "customer_left", label: "El cliente se fue" },
  { code: "dish_returned", label: "Plato devuelto" },
  { code: "duplicate_charge", label: "Cobro duplicado" },
  { code: "wrong_payment_method", label: "Método de pago equivocado" },
  { code: "other", label: "Otro" },
]

/** The stable codes of a refused cancellation or void; the body's `message` is the Spanish text to show. */
export const VOID_REFUSAL_CODES = [
  "authorization_required",
  "authorization_invalid",
  "self_authorization_not_allowed",
  "order_not_found",
  "payment_not_found",
  "item_not_found",
  "order_cancelled",
  "order_paid",
  "order_closed",
  "delivery_order",
  "delivery_not_cancellable",
  "payment_voided",
  "register_closed",
  "reason_invalid",
  "reason_text_required",
  "items_invalid",
  "void_quantity_exceeded",
  "split_has_voids",
] as const
export type VoidRefusalCode = (typeof VOID_REFUSAL_CODES)[number]

/** The code and Spanish message of a refused cancellation or void; null for any other error. */
export function voidRefusalOf(error: unknown): { code: VoidRefusalCode; message: string } | null {
  if (!(error instanceof ApiError)) return null
  const code = error.body.code
  return typeof code === "string" && (VOID_REFUSAL_CODES as readonly string[]).includes(code)
    ? { code: code as VoidRefusalCode, message: error.message }
    : null
}

export interface AuditFilter {
  /** YYYY-MM-DD, restaurant day, included. */
  from?: string
  to?: string
  types?: readonly AuditEventType[]
  actorId?: string
  authorizerId?: string
  selfAuthorized?: boolean
}

/** Admin: cancellations and voids, newest first (the API caps at 500). */
export async function getAuditEvents(filter: AuditFilter = {}): Promise<AuditEvent[]> {
  const query: Record<string, string> = {}
  if (filter.from) query.from = filter.from
  if (filter.to) query.to = filter.to
  if (filter.types?.length) query.type = filter.types.join(",")
  if (filter.actorId) query.actorId = filter.actorId
  if (filter.authorizerId) query.authorizerId = filter.authorizerId
  if (filter.selfAuthorized !== undefined) query.selfAuthorized = String(filter.selfAuthorized)
  const { data } = await api.GET("/api/audit", { params: { query } })
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}
