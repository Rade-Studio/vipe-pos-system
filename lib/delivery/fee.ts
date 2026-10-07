/**
 * Delivery fee + cash-change helpers.
 *
 * The delivery fee is a whole-COP-peso amount (no cents exist):
 * - `public.order_deliveries.delivery_fee` is `bigint >= 0`.
 * - `pay_order` adds the fee to `amount_due` (subtotal + tax + fee)
 *   when `order_type = 'delivery'`. No tax and no tip on the fee.
 *
 * `changeForHint` answers "how much change does the courier carry?".
 * `cashChangeFor` is what the customer hands over; the change is the
 * difference. It rejects a `cashChangeFor` below `total` (the
 * courier must not leave with negative change) and clamps exact
 * change to 0 so the operator form does not show "−$0".
 *
 * Mirrors `lib/payments/money.ts` style: integer-only, fail loud on
 * negative / non-integer / fractional values rather than rounding.
 */

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`${label} must be a finite integer; received: ${value}`)
  }
  if (value < 0) {
    throw new RangeError(`${label} must not be negative; received: ${value}`)
  }
  return value
}

/**
 * Parse a user-typed fee input. Strips surrounding whitespace, then
 * refuses anything that is not a non-negative whole-peso count.
 *
 * Throws RangeError (NOT PaymentIssue / DeliveryIssue) on bad input:
 * the helper is only ever called from form-submit time, where a
 * thrown error already drives the inline form message.
 */
export function parseFeeInput(text: string): number {
  if (typeof text !== 'string') {
    throw new RangeError(`parseFeeInput: input must be a string; received: ${typeof text}`)
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new RangeError('parseFeeInput: fee must be a non-empty value')
  }
  // Integer-only: refuse decimals, thousands separators, currency,
  // scientific notation that hides a fraction. `parseInt` would silently
  // accept "3000.5" as 3005, so we go through Number + Integer check.
  const num = Number(trimmed)
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new RangeError(`parseFeeInput: fee must be a non-negative integer; received: ${text}`)
  }
  return assertNonNegativeInteger(num, 'parseFeeInput: fee')
}

/**
 * Total amount the customer owes for a delivery order (the same
 * shape `pay_order` uses for `amount_due`): subtotal + tax +
 * delivery_fee. The fee is added without tax and without tip
 * (the migration COMMENT is the authority).
 */
export function deliveryTotal(subtotal: number, tax: number, fee: number): number {
  assertNonNegativeInteger(subtotal, 'deliveryTotal: subtotal')
  assertNonNegativeInteger(tax, 'deliveryTotal: tax')
  assertNonNegativeInteger(fee, 'deliveryTotal: deliveryFee')
  return subtotal + tax + fee
}

/**
 * The change the courier must carry for a cash-on-delivery order.
 *
 * `total` is the bill (subtotal + tax + delivery_fee);
 * `cashChangeFor` is the cash the customer hands over at the door.
 * Returns the positive difference when the customer overpays, 0 when
 * they hand over the exact amount, and throws when the input would
 * imply negative change (a programming error, not a real-world
 * scenario — the operator form prevents it).
 */
export function changeForHint(total: number, cashChangeFor: number): number {
  const safeTotal = assertNonNegativeInteger(total, 'changeForHint: total')
  const safeChangeFor = assertNonNegativeInteger(
    cashChangeFor,
    'changeForHint: cashChangeFor',
  )
  if (safeChangeFor < safeTotal) {
    throw new RangeError(
      `changeForHint: cashChangeFor (${safeChangeFor}) is below total (${safeTotal}); the courier would have to carry negative change`,
    )
  }
  return safeChangeFor - safeTotal
}