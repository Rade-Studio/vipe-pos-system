/**
 * T9 (S1) — the reads behind the Caja tab, in ONE cache slot per data set.
 *
 * Audit findings this module removes:
 *   - `CashRegisterSummary` kept a `useEffect` that called
 *     `refetchCashTransactions()` every time its inner "Movimientos de Efectivo"
 *     tab became active, on top of the `useQuery` that had already fetched the
 *     same key. `TransactionsByRegisterId` fetches that same key for the same
 *     register set, so opening Caja read the cash movements up to twice.
 *   - Both Caja sub-tabs loaded "registers of the selected date" on their own
 *     `useEffect` (`getRegistersByDate`), i.e. the same day read twice.
 *
 * Canonicalising both keys here is what makes the two readers share one slot,
 * so "fetch when the tab opens" (`enabled`) is enough — no refetch effect.
 */
import { localDayKey } from "./dates"

/**
 * Sorted copy of a register id set, so `[a, b]` and `[b, a]` are one slot.
 * Does not mutate its input.
 */
export function sortedRegisterIds(ids: readonly string[]): string[] {
  return [...ids].sort()
}

/** Cache slot for "the registers that ran on this local day". */
export function registersByDateQueryKey(date: Date | undefined): readonly string[] {
  return ["cash", "registers-by-date", localDayKey(date)]
}

/**
 * Cache slot for the cash movements of a register set (shared by both readers).
 *
 * The shape is unchanged from the key both panels already used:
 * `["cash-transactions-by-registers", <sorted ids>]`, so the two readers keep
 * hitting ONE slot.
 */
export function cashTransactionsQueryKey(
  registerIds: readonly string[],
): readonly (string | readonly string[])[] {
  return ["cash-transactions-by-registers", sortedRegisterIds(registerIds)]
}