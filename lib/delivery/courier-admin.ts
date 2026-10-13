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

import { normalizePhone } from './phone'
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

export function validateCourierInput(input: CourierInput): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  if (name.length === 0) {
    errors.push('El nombre es obligatorio')
  } else if (name.length > MAX_COURIER_NAME_LEN) {
    errors.push(`El nombre no puede tener más de ${MAX_COURIER_NAME_LEN} caracteres`)
  }
  if (input.phone.trim().length > 0 && normalizePhone(input.phone) === null) {
    errors.push('El teléfono debe tener entre 7 y 15 dígitos')
  }
  return errors
}

export function toCourierPayload(input: CourierInput): CourierPayload {
  const errors = validateCourierInput(input)
  if (errors.length > 0) {
    throw new Error(`toCourierPayload: ${errors.join('; ')}`)
  }
  return {
    name: input.name.trim(),
    phone: input.phone.trim().length === 0 ? null : normalizePhone(input.phone),
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

/**
 * TanStack-Query key for the suggested fee. The admin screen
 * (`components/admin/couriers/DeliveryFeeSetting.tsx`) reads the same value
 * under the SAME key and invalidates it after a save, so the new-delivery
 * dialog shows an admin edit without reading the row again — and the dialog
 * caches it between opens instead of re-reading on every one.
 */
export const DEFAULT_FEE_QUERY_KEY = ['businessConfig', DEFAULT_FEE_CONFIG_KEY] as const

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
  return { ok: true, value }
}

/**
 * TanStack-Query key prefix for the courier registry. The dispatch
 * dialog caches `['couriers', 'active']` and the admin screen
 * `['couriers', 'all']`; invalidating this prefix refreshes both.
 */
export const COURIERS_QUERY_KEY = ['couriers'] as const
