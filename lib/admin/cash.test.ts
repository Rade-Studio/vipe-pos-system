/**
 * T9 (S1/S2) — Caja reads.
 *
 * Two facts the audit found in the admin Caja tab:
 *   - `CashRegisterSummary` kept a `useEffect` that called
 *     `refetchCashTransactions()` whenever its inner "Movimientos de Efectivo"
 *     tab became active, on top of the `useQuery` that had already fetched the
 *     same key (and `TransactionsByRegisterId` fetches that SAME key for the
 *     SAME register set). One tab click, two reads of one cache slot.
 *   - Both Caja sub-tabs loaded "registers of the selected date" on their own
 *     (`getRegistersByDate`), so opening Caja read the same day twice.
 *
 * Canonicalising the keys here is what makes both readers hit one slot, and
 * `enabled`-style gating belongs at the call site.
 */
import { describe, expect, it } from "vitest"

import {
  cashTransactionsQueryKey,
  registersByDateQueryKey,
  sortedRegisterIds,
} from "./cash"

describe("registersByDateQueryKey", () => {
  const day = new Date(2026, 0, 15, 18, 30)

  it("is the same slot for two pickers on the same local day", () => {
    expect(registersByDateQueryKey(day)).toEqual(registersByDateQueryKey(new Date(2026, 0, 15, 3, 5)))
  })

  it("is a different slot for another day", () => {
    expect(registersByDateQueryKey(new Date(2026, 0, 15))).not.toBe(
      registersByDateQueryKey(new Date(2026, 0, 16)),
    )
  })

  it("keeps the key serialisable (invalidate/seed from anywhere)", () => {
    for (const part of registersByDateQueryKey(day)) {
      expect(typeof part).toBe("string")
    }
  })
})

describe("sortedRegisterIds", () => {
  it("canonicalises the set so [a,b] and [b,a] share a slot", () => {
    expect(sortedRegisterIds(["b", "a"])).toEqual(["a", "b"])
    expect(sortedRegisterIds(["a", "b"])).toEqual(["a", "b"])
  })

  it("does not mutate its input", () => {
    const ids = ["b", "a"]
    sortedRegisterIds(ids)

    expect(ids).toEqual(["b", "a"])
  })
})

describe("cashTransactionsQueryKey", () => {
  it("is the same slot for both Caja readers with the same register set", () => {
    // CashRegisterSummary: ["cash-transactions-by-registers", sortedRegisters]
    // TransactionsByRegisterId: identical shape. They must not drift apart.
    expect(cashTransactionsQueryKey(["r-2", "r-1"])).toEqual(cashTransactionsQueryKey(["r-1", "r-2"]))
  })

  it("is a different slot for another register set", () => {
    expect(cashTransactionsQueryKey(["r-1"])).not.toBe(cashTransactionsQueryKey(["r-1", "r-2"]))
  })

  it("keeps an empty set addressable (the queries disable instead of firing)", () => {
    expect(cashTransactionsQueryKey([])).toEqual(cashTransactionsQueryKey([]))
  })
})