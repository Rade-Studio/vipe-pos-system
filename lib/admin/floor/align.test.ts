import { describe, expect, it } from "vitest"
import type { Table } from "@/types"
import { alignTables, distributeTables, tablesInRect } from "./align"

/** T26 — align and distribute the selected tables; rubber-band selection. */

const ASPECT = 2
const t = (id: string, x: number, y: number, w = 0.1, shape: Table["shape"] = "square"): Table => ({
  id,
  number: 1,
  status: "available",
  zoneId: "z",
  x,
  y,
  w,
  h: w,
  shape,
})
const xs = (tables: Table[]) => tables.map((table) => table.x)
const ys = (tables: Table[]) => tables.map((table) => table.y)

describe("alignTables", () => {
  const sel = [t("a", 0.2, 0.3), t("b", 0.5, 0.6, 0.2), t("c", 0.7, 0.5)]
  it("left / centre / right by the boxes' edges", () => {
    expect(xs(alignTables(sel, "left", ASPECT))).toEqual([0.2, 0.25, 0.2])
    expect(xs(alignTables(sel, "hcenter", ASPECT))).toEqual([0.45, 0.45, 0.45])
    expect(xs(alignTables(sel, "right", ASPECT))).toEqual([0.7, 0.65, 0.7])
  })
  it("top / middle / bottom (height = w × aspect of the floor)", () => {
    expect(ys(alignTables(sel, "top", ASPECT))).toEqual([0.3, 0.4, 0.3])
    expect(ys(alignTables(sel, "vmiddle", ASPECT))).toEqual([0.5, 0.5, 0.5])
    expect(ys(alignTables(sel, "bottom", ASPECT))).toEqual([0.7, 0.6, 0.7])
  })
  it("leaves a single table as it is", () => {
    const one = [t("a", 0.2, 0.3)]
    expect(alignTables(one, "left", ASPECT)).toEqual(one)
  })
})

describe("distributeTables", () => {
  it("spaces 3+ tables with equal gaps between the outer two", () => {
    const out = distributeTables([t("a", 0.1, 0.5), t("c", 0.9, 0.5), t("b", 0.3, 0.5, 0.2)], "h", ASPECT)
    const byId = Object.fromEntries(out.map((table) => [table.id, table.x]))
    expect(byId).toEqual({ a: 0.1, b: 0.5, c: 0.9 })
  })
  it("vertically too", () => {
    const out = distributeTables([t("a", 0.5, 0.1, 0.05), t("b", 0.5, 0.2, 0.05), t("c", 0.5, 0.9, 0.05)], "v", ASPECT)
    expect(out.find((table) => table.id === "b")?.y).toBeCloseTo(0.5)
  })
  it("needs three tables", () => {
    const two = [t("a", 0.1, 0.5), t("b", 0.3, 0.5)]
    expect(distributeTables(two, "h", ASPECT)).toEqual(two)
  })
})

describe("tablesInRect", () => {
  it("selects every table whose box touches the band, in any drag direction", () => {
    const tables = [t("a", 0.2, 0.3), t("b", 0.5, 0.5), t("c", 0.9, 0.9)]
    expect(tablesInRect(tables, { x1: 0.6, y1: 0.6, x2: 0.1, y2: 0.1 }, ASPECT)).toEqual(["a", "b"])
    expect(tablesInRect(tables, { x1: 0.3, y1: 0.7, x2: 0.35, y2: 0.75 }, ASPECT)).toEqual([])
  })
})
