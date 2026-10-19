import { describe, expect, it } from "vitest"

import type { CountLine } from "@/lib/supabase/inventory/types"
import { buildCountRows, countApplySummary, countProgress, filterCountRows } from "./count-sheet"

const line = (patch: Partial<CountLine>): CountLine => ({
  id: "l1",
  itemId: "i1",
  itemName: "Tomate",
  sku: "MP-0001",
  unit: "kg",
  expectedQuantity: 10,
  countedQuantity: null,
  notes: null,
  ...patch,
})

const lines = [
  line({ id: "l1", itemId: "i1", itemName: "Tomate", sku: "MP-0001", expectedQuantity: 10, countedQuantity: 8 }),
  line({ id: "l2", itemId: "i2", itemName: "Cebolla", sku: "MP-0002", expectedQuantity: 5, countedQuantity: 5 }),
  line({ id: "l3", itemId: "i3", itemName: "Salsa roja", sku: "PR-0001", unit: "l", expectedQuantity: 2, countedQuantity: null }),
  line({ id: "l4", itemId: "i4", itemName: "Ajo", sku: "MP-0003", unit: "g", expectedQuantity: 100, countedQuantity: 150 }),
]
const costs = new Map([
  ["i1", 2000],
  ["i2", 1500],
  ["i3", 8000],
  ["i4", 20],
])

describe("buildCountRows", () => {
  it("computes difference (counted − expected) and its value at the item cost", () => {
    const rows = buildCountRows(lines, costs)
    expect(rows.map((r) => [r.lineId, r.difference, r.differenceValue])).toEqual([
      ["l1", -2, -4000],
      ["l2", 0, 0],
      ["l3", null, null],
      ["l4", 50, 1000],
    ])
    expect(rows[0]).toMatchObject({ itemId: "i1", sku: "MP-0001", name: "Tomate", unit: "kg", expected: 10, counted: 8, unitCost: 2000 })
  })

  it("uses cost 0 for unknown items and rounds float noise", () => {
    const [row] = buildCountRows([line({ itemId: "x", expectedQuantity: 0.3, countedQuantity: 0.1 + 0.2 })], new Map())
    expect(row.unitCost).toBe(0)
    expect(row.difference).toBe(0)
    expect(row.differenceValue).toBe(0)
  })
})

describe("countProgress", () => {
  it("counts lines with a counted quantity", () => {
    expect(countProgress(buildCountRows(lines, costs))).toEqual({ counted: 3, total: 4, percent: 75 })
  })

  it("is 0 % for an empty count", () => {
    expect(countProgress([])).toEqual({ counted: 0, total: 0, percent: 0 })
  })
})

describe("filterCountRows", () => {
  const rows = buildCountRows(lines, costs)
  const ids = (r: { lineId: string }[]) => r.map((x) => x.lineId)

  it("pending keeps uncounted lines", () => {
    expect(ids(filterCountRows(rows, "pending", ""))).toEqual(["l3"])
  })

  it("diff keeps counted lines whose difference is not zero", () => {
    expect(ids(filterCountRows(rows, "diff", ""))).toEqual(["l1", "l4"])
  })

  it("all keeps every line, and the query matches name or SKU ignoring case and accents", () => {
    expect(ids(filterCountRows(rows, "all", ""))).toEqual(["l1", "l2", "l3", "l4"])
    expect(ids(filterCountRows(rows, "all", "pr-0001"))).toEqual(["l3"])
    expect(ids(filterCountRows(rows, "all", "CEBÓLLA"))).toEqual(["l2"])
  })
})

describe("countApplySummary", () => {
  it("sums lines with difference and the value delta, and reports uncounted lines", () => {
    expect(countApplySummary(buildCountRows(lines, costs))).toEqual({
      counted: 3,
      uncounted: 1,
      linesWithDifference: 2,
      valueDelta: -3000,
    })
  })
})
