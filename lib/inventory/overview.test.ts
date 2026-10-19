import { describe, expect, it } from "vitest"

import type { InventoryItem } from "@/lib/supabase/inventory/types"
import { fillSeries, reorderRows, stockAlerts, topConsumedShares, wastePercent } from "./overview"

/**
 * T11 (S5) — shaping of the inventory dashboard data.
 */

const item = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "i",
  sku: "MP-0001",
  name: "Item",
  description: null,
  kind: "raw",
  unit: "g",
  barcode: null,
  cost: 1,
  stock: 10,
  minStock: 5,
  maxStock: null,
  purchaseUnit: null,
  purchaseFactor: 1,
  defaultSupplierId: null,
  trackLots: false,
  shelfLifeDays: null,
  isActive: true,
  categoryId: null,
  categoryName: null,
  ...patch,
})

describe("fillSeries", () => {
  it("returns one point per day ending today, filling missing days with zeros", () => {
    const today = new Date(2026, 9, 19)
    const result = fillSeries([{ date: "2026-10-18", inValue: 5, outValue: 2, wasteValue: 1 }], 3, today)
    expect(result).toEqual([
      { date: "2026-10-17", inValue: 0, outValue: 0, wasteValue: 0 },
      { date: "2026-10-18", inValue: 5, outValue: 2, wasteValue: 1 },
      { date: "2026-10-19", inValue: 0, outValue: 0, wasteValue: 0 },
    ])
  })

  it("crosses month boundaries and ignores points outside the range", () => {
    const today = new Date(2026, 10, 1)
    const result = fillSeries([{ date: "2026-09-01", inValue: 9, outValue: 9, wasteValue: 9 }], 2, today)
    expect(result.map((p) => p.date)).toEqual(["2026-10-31", "2026-11-01"])
    expect(result.every((p) => p.inValue === 0)).toBe(true)
  })
})

describe("wastePercent", () => {
  it("is waste over consumption as a percentage", () => {
    expect(wastePercent(25, 200)).toBe(12.5)
  })

  it("is null without consumption", () => {
    expect(wastePercent(10, 0)).toBeNull()
  })
})

describe("reorderRows", () => {
  it("lists only active items needing stock, out first, then the lowest stock/min ratio", () => {
    const rows = reorderRows([
      item({ id: "ok", stock: 50 }),
      item({ id: "low-mild", name: "B", stock: 4, minStock: 5 }),
      item({ id: "low-severe", name: "C", stock: 1, minStock: 5 }),
      item({ id: "out", name: "D", stock: 0, minStock: 5 }),
      item({ id: "inactive", stock: 0, isActive: false }),
    ])
    expect(rows.map((r) => r.item.id)).toEqual(["out", "low-severe", "low-mild"])
    expect(rows[0]).toMatchObject({ status: "out", suggested: 10 })
  })

  it("rounds the suggestion up to whole purchase units", () => {
    const [row] = reorderRows([item({ stock: 1, minStock: 5, maxStock: 20, purchaseUnit: "kg", purchaseFactor: 1000 })])
    expect(row.suggested).toBe(1000)
    expect(row.suggestedPurchaseUnits).toBe(1)
  })

  it("has no purchase units when the item has no purchase unit", () => {
    const [row] = reorderRows([item({ stock: 1 })])
    expect(row.suggestedPurchaseUnits).toBeNull()
  })
})

describe("stockAlerts", () => {
  it("counts out and low items and keeps the most urgent rows", () => {
    const result = stockAlerts(
      [item({ id: "a", stock: 0 }), item({ id: "b", stock: 2 }), item({ id: "c", stock: 3 }), item({ id: "d", stock: 50 })],
      2,
    )
    expect(result.outCount).toBe(1)
    expect(result.lowCount).toBe(2)
    expect(result.rows.map((r) => r.item.id)).toEqual(["a", "b"])
  })
})

describe("topConsumedShares", () => {
  it("sorts by value, keeps the limit and computes the share of the total", () => {
    const rows = topConsumedShares(
      [
        { itemId: "a", name: "A", unit: "g", quantity: 1, value: 25 },
        { itemId: "b", name: "B", unit: "g", quantity: 1, value: 75 },
        { itemId: "c", name: "C", unit: "g", quantity: 1, value: 0 },
      ],
      2,
    )
    expect(rows.map((r) => [r.itemId, r.share])).toEqual([
      ["b", 0.75],
      ["a", 0.25],
    ])
  })

  it("gives zero shares when nothing has value", () => {
    expect(topConsumedShares([{ itemId: "a", name: "A", unit: "g", quantity: 1, value: 0 }])[0].share).toBe(0)
  })
})
