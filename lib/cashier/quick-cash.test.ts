import { describe, expect, it } from "vitest"
import { quickCashAmounts } from "./quick-cash"

describe("quickCashAmounts (T14: billetes rápidos for the cash received)", () => {
  it("rounds the remaining up to the next thousand, ten thousand and fifty thousand", () => {
    expect(quickCashAmounts(51_180)).toEqual([52_000, 60_000, 100_000])
  })

  it("drops duplicates and keeps the next bill when a step lands on the same value", () => {
    expect(quickCashAmounts(47_600)).toEqual([48_000, 50_000, 100_000])
    expect(quickCashAmounts(50_000)).toEqual([50_000, 100_000])
  })

  it("offers nothing when nothing is owed", () => {
    expect(quickCashAmounts(0)).toEqual([])
    expect(quickCashAmounts(-10)).toEqual([])
    expect(quickCashAmounts(Number.NaN)).toEqual([])
  })

  it("never offers more than three amounts, all at least the remaining", () => {
    const amounts = quickCashAmounts(1_250)
    expect(amounts).toEqual([2_000, 10_000, 50_000])
    for (const value of amounts) expect(value).toBeGreaterThanOrEqual(1_250)
  })
})
