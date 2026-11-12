import { describe, expect, it } from "vitest"

import type { ProductionBatch } from "@/lib/api/inventory/types"
import type { FormulaItem, PrepFormula } from "./formula"
import {
  addDaysIso,
  businessDates,
  expiryFor,
  filterBatches,
  groupBatchesByDay,
  localIsoDate,
  parseBulkShortages,
  shortDayLabel,
  stockAtLocation,
  sumBatchesByItem,
  summarizeSheet,
  withStock,
} from "./production-sheet"

const item = (id: string, patch: Partial<FormulaItem> = {}): FormulaItem => ({
  id,
  name: id,
  kind: "raw",
  unit: "kg",
  cost: 1000,
  stock: 10,
  ...patch,
})

const itemsById = new Map<string, FormulaItem>([
  ["tomate", item("tomate", { name: "Tomate", stock: 10, cost: 2000 })],
  ["ajo", item("ajo", { name: "Ajo", unit: "g", stock: 500, cost: 20 })],
  ["cebolla", item("cebolla", { name: "Cebolla", stock: 3, cost: 3000 })],
])

// salsa: 2 l per batch of 1 kg tomate + 50 g ajo. pico: 1 kg per batch of 1 kg tomate + 0,5 kg cebolla.
const formulas: Record<string, PrepFormula> = {
  salsa: { yieldQuantity: 2, lines: [{ ingredientId: "tomate", quantity: 1 }, { ingredientId: "ajo", quantity: 50 }] },
  pico: { yieldQuantity: 1, lines: [{ ingredientId: "tomate", quantity: 1 }, { ingredientId: "cebolla", quantity: 0.5 }] },
}

describe("summarizeSheet", () => {
  it("gives each row its max, line cost and exceed flag, and ignores empty quantities", () => {
    const s = summarizeSheet({ salsa: 4, pico: 0 }, formulas, itemsById)
    expect(s.rows).toEqual([
      // salsa max: min(10/1, 500/50) batches × 2 = 20 l; cost per l (2000 + 1000) / 2 = 1500.
      { itemId: "salsa", quantity: 4, max: 20, exceeds: false, cost: 6000, unitCost: 1500 },
    ])
    expect(s.count).toBe(1)
    expect(s.totalCost).toBe(6000)
  })

  it("flags a row over its max and counts it as insufficient", () => {
    // pico max: min(10, 3/0,5 = 6) = 6 kg.
    const s = summarizeSheet({ pico: 7 }, formulas, itemsById)
    expect(s.rows[0]).toMatchObject({ itemId: "pico", max: 6, exceeds: true })
    expect(s.exceedCount).toBe(1)
    expect(s.insufficientIds).toEqual(["pico"])
  })

  it("nets the combined demand of rows that share an ingredient", () => {
    // salsa 12 l uses 6 kg tomate, pico 5 kg uses 5 kg: 11 > 10 although each row fits.
    const s = summarizeSheet({ salsa: 12, pico: 5 }, formulas, itemsById)
    expect(s.exceedCount).toBe(0)
    expect(s.netShortages).toEqual([
      { ingredientId: "tomate", name: "Tomate", unit: "kg", required: 11, available: 10, missing: 1, itemIds: ["salsa", "pico"] },
    ])
    expect(s.insufficientIds).toEqual(["salsa", "pico"])
  })

  it("lists the consumed ingredients by cost, highest first", () => {
    const s = summarizeSheet({ salsa: 4, pico: 2 }, formulas, itemsById)
    expect(s.ingredients.map((i) => [i.ingredientId, i.quantity, i.cost])).toEqual([
      ["tomate", 4, 8000],
      ["cebolla", 1, 3000],
      ["ajo", 100, 2000],
    ])
    expect(s.totalCost).toBe(13_000)
  })

  it("gives a preparation without formula a max of 0", () => {
    const s = summarizeSheet({ nada: 1 }, { nada: { yieldQuantity: 1, lines: [] } }, itemsById)
    expect(s.rows[0]).toMatchObject({ max: 0, exceeds: true, cost: 0 })
  })
})

describe("per-location stock", () => {
  it("sums the lots of one location and overrides the item stock", () => {
    const lots = [
      { locationId: "a", quantity: 2 },
      { locationId: "b", quantity: 5 },
      { locationId: "a", quantity: 1.5 },
    ]
    expect(stockAtLocation(lots, "a")).toBe(3.5)
    const scoped = withStock(itemsById, new Map([["tomate", 3]]))
    expect(scoped.get("tomate")?.stock).toBe(3)
    expect(scoped.get("ajo")?.stock).toBe(500)
    expect(itemsById.get("tomate")?.stock).toBe(10)
  })
})

describe("parseBulkShortages", () => {
  const detail = [
    {
      item_id: "salsa",
      name: "Salsa roja",
      ingredients: [{ ingredient_id: "tomate", name: "Tomate", unit: "kg", required: 11, available: 10, missing: 1 }],
    },
  ]
  const expected = [
    {
      itemId: "salsa",
      name: "Salsa roja",
      ingredients: [{ ingredientId: "tomate", name: "Tomate", unit: "kg", required: 11, available: 10, missing: 1 }],
    },
  ]

  it("reads the JSON text and the array forms", () => {
    expect(parseBulkShortages(JSON.stringify(detail))).toEqual(expected)
    expect(parseBulkShortages(detail)).toEqual(expected)
  })

  it("returns an empty list for anything else", () => {
    expect(parseBulkShortages("no json")).toEqual([])
    expect(parseBulkShortages(undefined)).toEqual([])
    expect(parseBulkShortages(JSON.stringify([{ ingredient_id: "x", missing: 1 }]))).toEqual([])
  })
})

const batch = (patch: Partial<ProductionBatch>): ProductionBatch => ({
  id: "b",
  itemId: "salsa",
  itemName: "Salsa roja",
  unit: "l",
  locationId: "loc1",
  locationName: "Cocina",
  lotId: "lot",
  lotCode: "PB-1",
  quantity: 2,
  unitCost: 1500,
  totalCost: 3000,
  expiresOn: null,
  notes: null,
  producedOn: "2026-11-11",
  producedBy: { id: "s1", name: "Luz" },
  createdBy: null,
  createdAt: "2026-11-11T12:00:00Z",
  ...patch,
})

describe("batches", () => {
  const batches = [
    batch({ id: "b1", producedOn: "2026-11-11", createdAt: "2026-11-11T12:00:00Z", totalCost: 3000 }),
    batch({ id: "b2", producedOn: "2026-11-12", createdAt: "2026-11-12T13:00:00Z", totalCost: 1000, itemId: "pico", itemName: "Pico", lotCode: "PB-XY", expiresOn: "2026-11-14", quantity: 1 }),
    batch({ id: "b3", producedOn: "2026-11-11", createdAt: "2026-11-11T15:00:00Z", totalCost: 500, quantity: 1.5 }),
  ]

  it("groups by produced day, newest day and time first, with the day's cost", () => {
    const groups = groupBatchesByDay(batches)
    expect(groups.map((g) => [g.day, g.batches.map((b) => b.id), g.totalCost])).toEqual([
      ["2026-11-12", ["b2"], 1000],
      ["2026-11-11", ["b3", "b1"], 3500],
    ])
  })

  it("sums the quantities per preparation", () => {
    expect(sumBatchesByItem(batches)).toEqual({ salsa: 3.5, pico: 1 })
  })

  it("filters by text, preparation and expiring within 3 days", () => {
    const today = new Date(2026, 10, 12)
    expect(filterBatches(batches, { query: "xy", today }).map((b) => b.id)).toEqual(["b2"])
    expect(filterBatches(batches, { query: "salsa", today }).map((b) => b.id)).toEqual(["b1", "b3"])
    expect(filterBatches(batches, { itemId: "pico", today }).map((b) => b.id)).toEqual(["b2"])
    expect(filterBatches(batches, { expiringSoon: true, today }).map((b) => b.id)).toEqual(["b2"])
  })
})

describe("dates", () => {
  const today = new Date(2026, 10, 12, 9, 30)

  it("formats local ISO dates and adds days", () => {
    expect(localIsoDate(today)).toBe("2026-11-12")
    expect(addDaysIso("2026-11-12", -1)).toBe("2026-11-11")
    expect(addDaysIso("2026-11-30", 2)).toBe("2026-12-02")
  })

  it("offers today and the 7 previous days", () => {
    const dates = businessDates(today)
    expect(dates).toHaveLength(8)
    expect(dates[0]).toEqual({ value: "2026-11-12", label: "Hoy · jue 12 nov" })
    expect(dates[1]).toEqual({ value: "2026-11-11", label: "Ayer · mié 11 nov (reporte tardío)" })
    expect(dates[7]).toEqual({ value: "2026-11-05", label: "jue 5 nov" })
  })

  it("labels a day without the weekday", () => {
    expect(shortDayLabel("2026-11-15")).toBe("15 nov")
  })

  it("computes the expiry from the produced day", () => {
    expect(expiryFor("2026-11-11", 3)).toBe("2026-11-14")
    expect(expiryFor("2026-11-11", null)).toBeNull()
  })
})
