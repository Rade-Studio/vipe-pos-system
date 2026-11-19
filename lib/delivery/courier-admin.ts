/**
 * Pure helpers for the admin couriers screen.
 *
 * No React, no Supabase, no DOM. The rules mirror the server CHECKs on
 * public.couriers (name trimmed 1..80, phone NULL or `^[0-9]{7,15}$`)
 * so the dialog can refuse a bad row before the round-trip, and the
 * service reuses the same payload builder for INSERT and UPDATE.
 *
 *   - `validateCourierInput({name, phone})` -> Spanish error list
 *       (empty when the input is valid). A blank phone is allowed.
 *   - `toCourierPayload({name, phone})`     -> `{name, phone}` wire
 *       shape: trimmed name, normalized phone or null. Throws on input
 *       that does not validate.
 *   - `findActivePhoneDuplicate(phone, couriers, excludeId?)` -> the
 *       active courier that already uses the phone, or null. The
 *       schema does not make the phone unique, so the UI only warns.
 *   - `parseDefaultFeeInput(raw)` -> the suggested delivery fee typed
 *       by the admin as whole pesos (thousands dots allowed), or a
 *       Spanish error. Stored in business_config under
 *       `DEFAULT_FEE_CONFIG_KEY`.
 */

import { formatCurrency } from '@/utils/helpers'
import { DELIVERY_FEE_MAX } from './order-draft'
import { COLOMBIAN_PHONE_ERROR, normalizeColombianPhone, normalizePhone } from './phone'
import type { Courier } from './types'

export const MAX_COURIER_NAME_LEN = 80

export interface CourierInput {
  name: string
  phone: string
}

export interface CourierPayload {
  name: string
  phone: string | null
}

/**
 * `previousPhone`: the courier's stored phone when editing. Keeping it
 * unchanged is allowed even when it predates the Colombian rule (H-038).
 */
export function validateCourierInput(input: CourierInput, previousPhone?: string | null): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  if (name.length === 0) {
    errors.push('El nombre es obligatorio')
  } else if (name.length > MAX_COURIER_NAME_LEN) {
    errors.push(`El nombre no puede tener más de ${MAX_COURIER_NAME_LEN} caracteres`)
  }
  const phone = input.phone.trim()
  const unchanged = previousPhone != null && phone.length > 0 && normalizePhone(phone) === previousPhone
  if (phone.length > 0 && !unchanged && normalizeColombianPhone(phone) === null) {
    errors.push(COLOMBIAN_PHONE_ERROR)
  }
  return errors
}

export function toCourierPayload(input: CourierInput, previousPhone?: string | null): CourierPayload {
  const errors = validateCourierInput(input, previousPhone)
  if (errors.length > 0) {
    throw new Error(`toCourierPayload: ${errors.join('; ')}`)
  }
  return {
    name: input.name.trim(),
    phone: input.phone.trim().length === 0 ? null : (normalizeColombianPhone(input.phone) ?? normalizePhone(input.phone)),
  }
}

export function findActivePhoneDuplicate(
  phone: string,
  couriers: readonly Courier[],
  excludeId?: string,
): Courier | null {
  const normalized = normalizePhone(phone)
  if (normalized === null) return null
  return (
    couriers.find(
      (c) => c.isActive && c.id !== excludeId && c.phone === normalized,
    ) ?? null
  )
}

/** business_config key the new-delivery dialog reads the suggested fee from. */
export const DEFAULT_FEE_CONFIG_KEY = 'delivery_default_fee'

export type DefaultFeeParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

const FEE_INPUT_RE = /^\d{1,3}(\.\d{3})+$|^\d+$/

export function parseDefaultFeeInput(raw: string): DefaultFeeParseResult {
  const error = 'Ingresa un valor entero en pesos, mayor o igual a 0'
  const trimmed = raw.trim()
  if (!FEE_INPUT_RE.test(trimmed)) return { ok: false, error }
  const value = Number(trimmed.replace(/\./g, ''))
  if (!Number.isSafeInteger(value)) return { ok: false, error }
  if (value > DELIVERY_FEE_MAX) return { ok: false, error: `El domicilio no puede superar ${formatCurrency(DELIVERY_FEE_MAX)}` }
  return { ok: true, value }
}

/**
 * TanStack-Query key prefix for the courier registry. The dispatch
 * dialog caches `['couriers', 'active']` and the admin screen
 * `['couriers', 'all']`; invalidating this prefix refreshes both.
 */
export const COURIERS_QUERY_KEY = ['couriers'] as const
