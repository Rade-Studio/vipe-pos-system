import { describe, expect, it } from "vitest"
import {
  BILL_VALUES,
  COIN_VALUES,
  cashDifference,
  closeNoteValid,
  countedTotal,
  denominationSubtotal,
  denominationsOf,
  differenceStatus,
} from "./denominations"

/** caja-cierres S3: the arqueo math of the close wizard. */
describe("denominations", () => {
  it("lists the Colombian bills and coins in display order", () => {
    expect(BILL_VALUES).toEqual([100000, 50000, 20000, 10000, 5000, 2000])
    expect(COIN_VALUES).toEqual([1000, 500, 200, 100, 50])
  })

  it("multiplies a row and ignores invalid quantities", () => {
    expect(denominationSubtotal(50000, 6)).toBe(300000)
    expect(denominationSubtotal(500, 0)).toBe(0)
    expect(denominationSubtotal(500, -2)).toBe(0)
    expect(denominationSubtotal(500, 1.5)).toBe(0)
  })

  it("adds every counted row (the brief's turno 1: $ 1.038.500)", () => {
    const counts = { 100000: 4, 50000: 8, 20000: 7, 10000: 6, 5000: 5, 2000: 4, 1000: 3, 500: 4, 200: 2, 100: 1, 50: 0 }
    expect(countedTotal(counts)).toBe(1038500)
    expect(countedTotal({})).toBe(0)
  })

  it("keeps only the rows with a quantity, in display order", () => {
    expect(denominationsOf({ 50: 3, 100000: 2, 500: 0 })).toEqual([
      { value: 100000, quantity: 2 },
      { value: 50, quantity: 3 },
    ])
    expect(denominationsOf({ 1000: 0 })).toEqual([])
  })

  it("computes counted − expected and labels it", () => {
    expect(cashDifference(1038500, 1042000)).toBe(-3500)
    expect(differenceStatus(0)).toEqual({ kind: "even", label: "Cuadra", tone: "ok", amount: 0 })
    expect(differenceStatus(2000)).toEqual({ kind: "over", label: "Sobrante", tone: "warning", amount: 2000 })
    expect(differenceStatus(-3500)).toEqual({ kind: "short", label: "Faltante", tone: "danger", amount: 3500 })
  })

  it("requires a 3–300 character trimmed note only when there is a difference", () => {
    expect(closeNoteValid("", 0)).toBe(true)
    expect(closeNoteValid(" ab ", -1)).toBe(false)
    expect(closeNoteValid("  abc ", -1)).toBe(true)
    expect(closeNoteValid("x".repeat(300), 5)).toBe(true)
    expect(closeNoteValid("x".repeat(301), 5)).toBe(false)
  })
})
