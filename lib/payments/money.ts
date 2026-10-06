/**
 * Money helpers for the payment domain.
 *
 * Amounts are whole Colombian pesos (COP): no cents exist, so a fractional
 * value can only be the result of a parsing or arithmetic bug.
 */

/**
 * Returns `amount` when it is a whole, non-negative peso count.
 *
 * @throws RangeError when the value is not finite, is negative, or has a
 * fractional part.
 */
export function assertWholePesos(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Amount must be a finite number, received: ${amount}`);
  }

  if (!Number.isInteger(amount)) {
    throw new RangeError(`Amount must be whole pesos, received: ${amount}`);
  }

  if (amount < 0) {
    throw new RangeError(`Amount must not be negative, received: ${amount}`);
  }

  return amount;
}