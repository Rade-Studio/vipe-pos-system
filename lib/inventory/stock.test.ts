import { describe, expect, it } from "vitest"

import { daysUntil, expiryStatus, groupBySupplier, reorderQuantity, stockStatus, type StockItem } from "./stock"

/**
 * T5 (S5) — inventory math for stock levels, reorder suggestions, lot expiry
 * and purchase grouping.
 */

const stock = (overrides: Partial<StockItem> = {}): StockItem => ({
  stock: 10,
  min_stock: 5,
  max_stock: null,
  purchase_factor: null,
  ...overrides,
})

describe("stockStatus", () => {
  it.each([
    [stock({ stock: 0 }), "out"],
    [stock({ stock: -3 }), "out"],
    [stock({ stock: 5 }), "low"],
    [stock({ stock: 5.001 }), "ok"],
    [stock({ stock: 20, max_stock: 20 }), "ok"],
    [stock({ stock: 21, max_stock: 20 }), "over"],
    [stock({ stock: 1000 }), "ok"],
    [stock({ stock: 0, min_stock: 0 }), "out"],
  ])("%o is %s", (item, expected) => {
    expect(stockStatus(item)).toBe(expected)
  })
})

describe("reorderQuantity", () => {
  it("is 0 unless the item is out or low", () => {
    expect(reorderQuantity(stock({ stock: 6 }))).toBe(0)
    expect(reorderQuantity(stock({ stock: 30, max_stock: 20 }))).toBe(0)
  })

  it("targets max_stock, else twice min_stock, from non-negative stock", () => {
    expect(reorderQuantity(stock({ stock: 4, max_stock: 20 }))).toBe(16)
    expect(reorderQuantity(stock({ stock: 4 }))).toBe(6)
    expect(reorderQuantity(stock({ stock: -3 }))).toBe(10)
  })

  it("returns 0 when min_stock is 0 and there is no max_stock", () => {
    expect(reorderQuantity(stock({ stock: 0, min_stock: 0 }))).toBe(0)
  })

  it("rounds up to a multiple of purchase_factor", () => {
    expect(reorderQuantity(stock({ stock: 4, max_stock: 30, purchase_factor: 24 }))).toBe(48)
    expect(reorderQuantity(stock({ stock: 0, max_stock: 24, purchase_factor: 24 }))).toBe(24)
    expect(reorderQuantity(stock({ stock: 4, max_stock: 30, purchase_factor: 0 }))).toBe(26)
  })
})

describe("daysUntil", () => {
  const today = new Date(2026, 9, 19, 23, 30)

  it("counts local calendar days regardless of the time of day", () => {
    expect(daysUntil("2026-10-19", today)).toBe(0)
    expect(daysUntil("2026-10-26", today)).toBe(7)
    expect(daysUntil("2026-10-18", today)).toBe(-1)
    expect(daysUntil("2026-11-02", new Date(2026, 9, 19, 0, 5))).toBe(14)
  })
})

describe("expiryStatus", () => {
  const today = new Date(2026, 9, 19, 8)

  it.each([
    [null, "none"],
    ["2026-10-18", "expired"],
    ["2026-10-19", "soon"],
    ["2026-10-26", "soon"],
    ["2026-10-27", "ok"],
  ])("%s is %s", (expiresOn, expected) => {
    expect(expiryStatus(expiresOn, today)).toBe(expected)
  })

  it("honors a custom soonDays", () => {
    expect(expiryStatus("2026-10-22", today, 3)).toBe("soon")
    expect(expiryStatus("2026-10-23", today, 3)).toBe("ok")
  })
})

describe("groupBySupplier", () => {
  it("groups by default_supplier_id preserving input order", () => {
    const a = { id: "a", default_supplier_id: "s1" }
    const b = { id: "b", default_supplier_id: null }
    const c = { id: "c", default_supplier_id: "s1" }
    const d = { id: "d", default_supplier_id: "s2" }
    const groups = groupBySupplier([a, b, c, d])
    expect([...groups.keys()]).toEqual(["s1", null, "s2"])
    expect(groups.get("s1")).toEqual([a, c])
    expect(groups.get(null)).toEqual([b])
    expect(groups.get("s2")).toEqual([d])
  })
})
