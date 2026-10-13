/**
 * Card-level decisions for the operator board that are not part of
 * the delivery state machine: payment affordances and the failure
 * reason check. Pure, no Supabase or DOM.
 *
 * The server stays authoritative: `pay_order` admits cashier / admin /
 * delivery_operator, and `set_delivery_status` requires a trimmed
 * 1..200 character reason on `fail`.
 */

import type { DeliveryRole, DeliveryStatus, PaymentMode } from './types'

const FAILURE_REASON_MAX = 200

/**
 * "Registrar pago" shows for any unpaid order that is not cancelled
 * (prepaid orders before dispatch, cash on delivery once the courier
 * returns), and only for roles `pay_order` accepts.
 */
export function canRegisterPayment(input: {
  status: DeliveryStatus
  isPaid: boolean
  role: DeliveryRole
}): boolean {
  if (input.isPaid || input.status === 'cancelled') return false
  return input.role === 'delivery_operator' || input.role === 'admin' || input.role === 'cashier'
}

/** A prepaid order dispatched before its payment is recorded (warn-only). */
export function needsPrepaidWarning(input: { paymentMode: PaymentMode; isPaid: boolean }): boolean {
  return input.paymentMode === 'prepaid' && !input.isPaid
}

export type FailureReasonCheck =
  | { ok: true; reason: string }
  | { ok: false; message: string }

export function validateFailureReason(raw: string): FailureReasonCheck {
  const reason = raw.trim()
  if (reason.length === 0) return { ok: false, message: 'Escribe el motivo del fallo' }
  if (reason.length > FAILURE_REASON_MAX) {
    return { ok: false, message: `El motivo admite máximo ${FAILURE_REASON_MAX} caracteres` }
  }
  return { ok: true, reason }
}

/**
 * Spanish text for a `rejected` (P0001) set_delivery_status error. The
 * server messages are English and stable; unknown ones are shown as is.
 */
export function rejectionMessage(serverMessage: string): string {
  if (/already has a payment/.test(serverMessage)) {
    return 'No se puede cancelar: el pedido ya tiene un pago registrado'
  }
  if (/courier .* is not active/.test(serverMessage)) {
    return 'El domiciliario está inactivo. Elige otro.'
  }
  if (/is already in state|is not allowed from state/.test(serverMessage)) {
    return 'El domicilio ya cambió de estado. El tablero se actualizará.'
  }
  return serverMessage || 'La operación fue rechazada por el servidor'
}
