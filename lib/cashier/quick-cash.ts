/**
 * Quick "billetes rápidos" for the cash the customer hands over (T14).
 *
 * Pure UI convenience derived from the amount still owed: the remaining
 * rounded up to the next $1.000, $10.000, $50.000 and $100.000, without
 * duplicates, at most three. Nothing here is stored; the cashier still adds
 * the tender line through the existing payment draft.
 */
const STEPS = [1_000, 10_000, 50_000, 100_000] as const
const MAX_AMOUNTS = 3

export function quickCashAmounts(remaining: number): number[] {
  if (!Number.isFinite(remaining) || remaining <= 0) return []
  const amounts: number[] = []
  for (const step of STEPS) {
    const value = Math.ceil(remaining / step) * step
    if (!amounts.includes(value)) amounts.push(value)
    if (amounts.length === MAX_AMOUNTS) break
  }
  return amounts
}
