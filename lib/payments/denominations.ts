/**
 * Arqueo math of the cashier's shift close (caja-cierres S3). Pure: no React,
 * no formatting. Amounts are whole Colombian pesos; the API checks the same
 * rules at close (422 count_mismatch, note_required).
 */

/** Bills, largest first, as the drawer is counted. */
export const BILL_VALUES = [100000, 50000, 20000, 10000, 5000, 2000] as const
/** Coins, largest first. */
export const COIN_VALUES = [1000, 500, 200, 100, 50] as const
/** Every value the API accepts, in display order. */
export const DENOMINATION_VALUES = [...BILL_VALUES, ...COIN_VALUES] as const

export type DenominationValue = (typeof DENOMINATION_VALUES)[number]
/** Quantity counted per value; a missing value counts as 0. */
export type DenominationCounts = Partial<Record<DenominationValue, number>>
export type DenominationRow = { value: DenominationValue; quantity: number }

const validQuantity = (quantity: number | undefined): number =>
  quantity !== undefined && Number.isInteger(quantity) && quantity > 0 ? quantity : 0

/** value × quantity; a negative or fractional quantity counts as 0. */
export function denominationSubtotal(value: number, quantity: number | undefined): number {
  return value * validQuantity(quantity)
}

/** Sum of every row. */
export function countedTotal(counts: DenominationCounts): number {
  return DENOMINATION_VALUES.reduce((sum, value) => sum + denominationSubtotal(value, counts[value]), 0)
}

/** The rows with a quantity, in display order: what the close sends as `denominations`. */
export function denominationsOf(counts: DenominationCounts): DenominationRow[] {
  return DENOMINATION_VALUES.filter((value) => validQuantity(counts[value]) > 0).map((value) => ({
    value,
    quantity: validQuantity(counts[value]),
  }))
}

/** counted − expected (expected = `expected_cash_after_tips`). */
export function cashDifference(counted: number, expected: number): number {
  return counted - expected
}

export type DifferenceStatus = {
  kind: "even" | "over" | "short"
  label: "Cuadra" | "Sobrante" | "Faltante"
  /** Status tone of design/system.md. */
  tone: "ok" | "warning" | "danger"
  /** Absolute difference. */
  amount: number
}

export function differenceStatus(difference: number): DifferenceStatus {
  if (difference === 0) return { kind: "even", label: "Cuadra", tone: "ok", amount: 0 }
  if (difference > 0) return { kind: "over", label: "Sobrante", tone: "warning", amount: difference }
  return { kind: "short", label: "Faltante", tone: "danger", amount: -difference }
}

export const CLOSE_NOTE_MIN = 3
export const CLOSE_NOTE_MAX = 300

/** A difference needs a trimmed note of 3–300 characters; an even count needs none. */
export function closeNoteValid(note: string, difference: number): boolean {
  if (difference === 0) return true
  const length = note.trim().length
  return length >= CLOSE_NOTE_MIN && length <= CLOSE_NOTE_MAX
}
