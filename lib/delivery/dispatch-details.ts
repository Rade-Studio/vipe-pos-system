/**
 * Dispatch console details (T19, S8): the courier ETA and location the
 * operator types at dispatch (no courier GPS exists) and the courier return.
 *
 * The server is authoritative (set_delivery_status: ETA after now and within
 * 6 hours, location trimmed 1..60; return_courier: delivered or failed, once);
 * these pure helpers keep the form from sending what it would refuse.
 */

import type { DeliveryOrder } from './types'

/** set_delivery_status refuses an ETA more than 6 hours ahead. */
export const MAX_COURIER_ETA_MINUTES = 6 * 60
export const COURIER_LOCATION_MAX = 60

/** "Vuelve en n min" → the ISO instant sent as `courierEta`. Whole minutes 1..360. */
export function courierEtaIn(minutes: number, now: Date = new Date()): string {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_COURIER_ETA_MINUTES) {
    throw new RangeError(`courierEtaIn: minutes must be a whole number from 1 to ${MAX_COURIER_ETA_MINUTES}; received: ${minutes}`)
  }
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

/** The typed location trimmed; blank is "not captured" (null). Over 60 characters throws. */
export function normalizeCourierLocation(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return null
  if (trimmed.length > COURIER_LOCATION_MAX) {
    throw new RangeError(`normalizeCourierLocation: at most ${COURIER_LOCATION_MAX} characters; received: ${trimmed.length}`)
  }
  return trimmed
}

/** May the operator record the courier back? Delivered or failed, not yet returned. */
export function canReturnCourier(delivery: Pick<DeliveryOrder, 'status' | 'returnedAt'>): boolean {
  return (delivery.status === 'delivered' || delivery.status === 'failed') && !delivery.returnedAt
}

export type CourierEtaResult = { ok: true; eta: string | null } | { ok: false; error: string }

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * The dispatch dialog's "Vuelve a las" time (T25): the next instant at that
 * local time of day, accepted when it lies after now and within 6 hours (the
 * server's window). Blank is "not captured".
 */
export function courierEtaAt(time: string, now: Date = new Date()): CourierEtaResult {
  const text = time.trim()
  if (text === '') return { ok: true, eta: null }
  const match = TIME_OF_DAY.exec(text)
  if (!match) return { ok: false, error: 'Escribe la hora como 19:55.' }
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]))
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  if (at.getTime() - now.getTime() > MAX_COURIER_ETA_MINUTES * 60_000) {
    return { ok: false, error: 'Elige una hora dentro de las próximas 6 horas.' }
  }
  return { ok: true, eta: at.toISOString() }
}
