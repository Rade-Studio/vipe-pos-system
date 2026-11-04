/**
 * Strict parser for the `order_deliveries` realtime row.
 *
 * T11: the API answers camelCase DTOs, so only the realtime payload (a
 * snake_case row from the socket's `pos_changes`) is parsed here. The row
 * carries snake_case + bigint money + nullable timestamps; the UI consumes
 * camelCase + integer money. Every
 * helper in this module is strict: a missing field, a wrong type, a
 * non-integer money value or an out-of-enum status raises rather than
 * silently zeroing.
 *
 * Mirrors `lib/payments/payment-list.ts` and
 * `lib/payments/register-summary.ts`: same fail-fast validators,
 * same bigint-money discipline, same nullable-time semantics.
 */

import type { DeliveryOrder, PaymentMode } from './types'
import { DELIVERY_STATUSES } from './types'

// -----------------------------------------------------------
// Validators
// -----------------------------------------------------------

function fail(message: string): never {
  throw new Error(`parse: ${message}`)
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(`${field} must be a non-empty string`)
  }
  return value
}

function requireIntegerMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(`${field} must be a finite integer (whole COP pesos); got ${JSON.stringify(value)}`)
  }
  return value
}

function requireNonNegativeMoney(value: unknown, field: string): number {
  const n = requireIntegerMoney(value, field)
  if (n < 0) fail(`${field} must be >= 0; got ${n}`)
  return n
}

function optionalIntegerMoney(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null
  return requireIntegerMoney(value, field)
}

function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(`${field} must be an ISO-8601 string`)
  }
  return value
}

function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value === '') {
    fail(`${field} must be an ISO-8601 string or null`)
  }
  return value
}

function requireUuid(value: unknown, field: string): string {
  // The server-side CHECK and RPC casts already enforce UUID format
  // (P0002 / 22023 on bad uuids); the client only verifies the field
  // is present and non-empty so a payload with a key but a missing
  // string is a fail-fast error here, not a silent zero downstream.
  // This mirrors the payments-service convention (requireString for
  // id-shaped fields), and keeps the test fixtures readable.
  return requireString(value, field)
}

function requirePhone(value: unknown, field: string): string {
  const s = requireString(value, field)
  if (!/^[0-9]{7,15}$/.test(s)) {
    fail(`${field} must match ^[0-9]{7,15}$; got ${JSON.stringify(s)}`)
  }
  return s
}

function requirePaymentMode(value: unknown, field: string): PaymentMode {
  if (value !== 'prepaid' && value !== 'cash_on_delivery') {
    fail(`${field} must be "prepaid" | "cash_on_delivery"; got ${JSON.stringify(value)}`)
  }
  return value
}

function requireDeliveryStatus(value: unknown, field: string): DeliveryOrder['status'] {
  if (typeof value !== 'string' || !DELIVERY_STATUSES.includes(value as never)) {
    fail(`${field} must be one of ${DELIVERY_STATUSES.join(', ')}; got ${JSON.stringify(value)}`)
  }
  return value as DeliveryOrder['status']
}

// -----------------------------------------------------------
// parseOrderDeliveryRow
// -----------------------------------------------------------

/**
 * Parse one snake_case `order_deliveries` row. The CHECK constraint
 * keeps `cash_change_for` null for prepaid orders and `failure_reason`
 * null for non-failed rows; the parser accepts any nullable field
 * shape and trusts the server to have enforced the rest.
 */
export function parseOrderDeliveryRow(raw: unknown): DeliveryOrder {
  const obj = requireObject(raw, 'order_deliveries row')
  return {
    orderId: requireUuid(obj.order_id, 'order_id'),
    customerId: requireUuid(obj.customer_id, 'customer_id'),
    customerName: requireString(obj.customer_name, 'customer_name'),
    customerPhone: requirePhone(obj.customer_phone, 'customer_phone'),
    addressLine: requireString(obj.address_line, 'address_line'),
    neighborhood:
        typeof obj.neighborhood === 'string' && obj.neighborhood !== ''
          ? obj.neighborhood
          : null,
    addressReference:
        typeof obj.address_reference === 'string' && obj.address_reference !== ''
          ? obj.address_reference
          : null,
    deliveryFee: requireNonNegativeMoney(obj.delivery_fee, 'delivery_fee'),
    paymentMode: requirePaymentMode(obj.payment_mode, 'payment_mode'),
    cashChangeFor: optionalIntegerMoney(obj.cash_change_for, 'cash_change_for'),
    courierId:
        obj.courier_id === null || obj.courier_id === undefined
          ? null
          : requireUuid(obj.courier_id, 'courier_id'),
    status: requireDeliveryStatus(obj.delivery_status, 'delivery_status'),
    failureReason:
        typeof obj.failure_reason === 'string' && obj.failure_reason !== ''
          ? obj.failure_reason
          : null,
    notes:
        typeof obj.notes === 'string' && obj.notes !== '' ? obj.notes : null,
    dispatchedAt: optionalIsoDate(obj.dispatched_at, 'dispatched_at'),
    deliveredAt: optionalIsoDate(obj.delivered_at, 'delivered_at'),
    failedAt: optionalIsoDate(obj.failed_at, 'failed_at'),
    cancelledAt: optionalIsoDate(obj.cancelled_at, 'cancelled_at'),
    createdAt: requireIsoDate(obj.created_at, 'created_at'),
    updatedAt: requireIsoDate(obj.updated_at, 'updated_at'),
  }
}
