/**
 * Rules of the "hoja por pasos" void flow (F3, design/anulaciones/01): what is
 * voided, the supervisor action and target the authorization is bound to
 * (POST /auth/authorize, L15 round 2), the reason check and the tiles of step 2.
 * Pure: the sheet in VoidFlow.tsx renders them.
 */
import type { SupervisorAction } from "@/lib/api/auth"
import type { VoidReasonCode } from "@/lib/api/audit"

export type VoidAction = "item" | "order" | "payment"

export interface VoidLine {
  id: string
  name: string
  /** Unit price. */
  price: number
  quantity: number
  comments?: string
}

export interface VoidPaymentOption {
  id: string
  /** "Tarjeta · Ref. 4822". */
  title: string
  /** "12:19 · Laura Gómez". */
  detail?: string
  amount: number
}

interface TargetBase {
  orderId: string
  /** "#128 · Mesa 8". */
  label: string
}

export type VoidTarget =
  | (TargetBase & { action: "item"; lines: VoidLine[]; lineId?: string })
  | (TargetBase & {
      action: "order"
      lines: VoidLine[]
      total: number
      /** A live payment on the order: the API asks for a supervisor even with no lines. */
      hasPayments?: boolean
    })
  | (TargetBase & { action: "payment"; payments: VoidPaymentOption[]; paymentId?: string })

export const SUPERVISOR_ACTION: Record<VoidAction, SupervisorAction> = {
  item: "void_item",
  order: "cancel_order",
  payment: "void_payment",
}

/** The authorization backs only this target: the order for a cancellation or item void, the payment for a payment void. */
export function authorizationTarget(
  target: VoidTarget,
  paymentId?: string,
): { targetType: "order" | "payment"; targetId: string } {
  if (target.action === "payment") return { targetType: "payment", targetId: paymentId ?? target.paymentId ?? "" }
  return { targetType: "order", targetId: target.orderId }
}

/** Same bounds as the API (reason_text_required): "Otro" needs 3 to 200 characters. */
export function reasonTextError(reason: VoidReasonCode | null, text: string): string | null {
  if (reason !== "other") return null
  const value = text.trim().replace(/\s+/g, " ")
  if (value.length === 0) return "Escribe el motivo para continuar."
  if (value.length < 3) return "Escribe al menos 3 letras."
  if (value.length > 200) return "Máximo 200 caracteres."
  return null
}

export function canContinue(input: {
  reason: VoidReasonCode | null
  reasonText: string
  quantity: number
  hasSubject: boolean
}): boolean {
  return input.hasSubject && input.quantity > 0 && input.reason !== null && reasonTextError(input.reason, input.reasonText) === null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "12:49" while the lock runs, else null. */
export function lockedUntilLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const until = new Date(iso)
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null
  return `${pad(until.getHours())}:${pad(until.getMinutes())}`
}

/** GET /staff/supervisors (F4): active admins and cashiers, by name. */
export interface Supervisor {
  id: string
  fullName: string
  role: "admin" | "cashier"
  hasPin: boolean
  pinLockedUntil: string | null
}

export interface SupervisorTile extends Supervisor {
  /** The person doing the void. */
  self: boolean
  /** Their own PIN is not accepted (allowSelfAuthorization off). */
  refused: boolean
}

/** Admins and cashiers; only those with a PIN can authorize (the sheet shows the rest disabled); the actor's own tile is refused unless the restaurant allows it. */
export function supervisorTiles(staff: readonly Supervisor[], actorId: string | undefined, allowSelf: boolean): SupervisorTile[] {
  return staff
    .filter((member) => member.role === "admin" || member.role === "cashier")
    .map((member) => {
      const self = member.id === actorId
      return { ...member, self, refused: self && !allowSelf }
    })
}

export const ROLE_LABEL: Record<Supervisor["role"], string> = { admin: "Admin", cashier: "Cajero" }

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : (parts[0]?.[1] ?? ""))).toUpperCase()
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
