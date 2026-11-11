import { describe, expect, it } from "vitest"

import type { Table } from "@/types"
import {
  GRID,
  applyEdits,
  changedRows,
  editTable,
  freeSpot,
  moveTo,
  nextTableNumber,
  nudge,
  snap,
} from "./editor"

/**
 * T5 (S4) — pure logic of the admin floor plan editor: snap to the grid, keep
 * a table inside its zone, keyboard nudges, a free spot for a new table and
 * the dirty rows that go in ONE `PUT /tables/layout`.
 */

const table = (extra: Partial<Table> = {}): Table => ({
  id: "t-1",
  number: 1,
  status: "available",
  zoneId: "z-1",
  x: 0.5,
  y: 0.5,
  w: 0.1,
  h: 0.1,
  shape: "square",
  rotation: 0,
  ...extra,
})

describe("snap", () => {
  it("rounds to the nearest step", () => {
    expect(snap(0.512, 0.025)).toBeCloseTo(0.5)
    expect(snap(0.513, 0.025)).toBeCloseTo(0.525)
  })
})

describe("moveTo", () => {
  it("snaps x to the grid and y to the grid scaled by the aspect", () => {
    // aspect 2: the grid step on y is 0.05 of the floor height.
    const moved = moveTo(table(), 0.311, 0.43, 2)
    expect(moved.x).toBeCloseTo(0.3)
    expect(moved.y).toBeCloseTo(0.45)
  })

  it("keeps the whole table inside the zone", () => {
    // w 0.1 -> half 0.05 of the width; height 0.1 * 1.6 = 0.16 -> half 0.08.
    const moved = moveTo(table(), -1, 2, 1.6)
    expect(moved.x).toBeCloseTo(0.05)
    expect(moved.y).toBeCloseTo(0.92)
  })

  it("can move without snapping", () => {
    expect(moveTo(table(), 0.311, 0.43, 2, { snap: false }).x).toBeCloseTo(0.311)
  })
})

describe("nudge", () => {
  it("moves one grid step per arrow and four with Shift, inside the zone", () => {
    expect(nudge(table(), "ArrowRight", false, 1.6)?.x).toBeCloseTo(0.5 + GRID)
    expect(nudge(table(), "ArrowLeft", true, 1.6)?.x).toBeCloseTo(0.5 - 4 * GRID)
    expect(nudge(table(), "ArrowDown", false, 1)?.y).toBeCloseTo(0.5 + GRID)
    expect(nudge(table({ y: 0.08 }), "ArrowUp", true, 1.6)?.y).toBeCloseTo(0.08)
  })

  it("ignores other keys", () => {
    expect(nudge(table(), "Enter", false, 1.6)).toBeNull()
  })
})

describe("freeSpot", () => {
  it("returns the first cell whose box does not overlap a table", () => {
    // First cell of an 8x8 grid, moved inside the floor (height 0.16 -> y >= 0.08).
    const spot = freeSpot([], { w: 0.1, h: 0.1 }, 1.6)
    expect(spot.x).toBeCloseTo(0.0625)
    expect(spot.y).toBeCloseTo(0.08)
    const next = freeSpot([table(spot)], { w: 0.1, h: 0.1 }, 1.6)
    expect(next).not.toEqual(spot)
    expect(next.x).toBeGreaterThan(0.1)
  })

  it("falls back to the centre when the zone is full", () => {
    const full = [table({ x: 0.5, y: 0.5, w: 0.9, h: 0.9, shape: "rect" })]
    expect(freeSpot(full, { w: 0.1, h: 0.1 }, 1)).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe("nextTableNumber", () => {
  it("is one above the highest number", () => {
    expect(nextTableNumber([table({ number: 3 }), table({ number: 9 })])).toBe(10)
    expect(nextTableNumber([])).toBe(1)
  })
})

describe("editTable", () => {
  it("keeps round and square tables square and clamps the size and seats", () => {
    const round = editTable(table({ shape: "rect", w: 0.2, h: 0.1 }), { shape: "round" }, 1.6)
    expect(round.h).toBe(round.w)
    expect(editTable(table(), { w: 5 }, 1.6).w).toBeLessThanOrEqual(0.9)
    expect(editTable(table(), { seats: 40 }, 1.6).seats).toBe(20)
    expect(editTable(table(), { seats: -1 }, 1.6).seats).toBe(0)
  })

  it("gives a new shape its own default size, so sizes never leak between shapes", () => {
    const bar = editTable(table({ shape: "bar", w: 0.3, h: 0.05 }), { shape: "round" }, 1.6)
    expect(bar).toMatchObject({ shape: "round", w: 0.1, h: 0.1 })
    const back = editTable(bar, { shape: "bar" }, 1.6)
    expect(back).toMatchObject({ shape: "bar", w: 0.4, h: 0.075 })
    expect(editTable(back, { shape: "rect" }, 1.6)).toMatchObject({ w: 0.18, h: 0.09 })
    // Picking the shape it already has keeps the size.
    expect(editTable(back, { shape: "bar" }, 1.6)).toMatchObject({ w: 0.4, h: 0.075 })
    // A size edit alone keeps the shape and the other side.
    expect(editTable(back, { w: 0.5 }, 1.6)).toMatchObject({ shape: "bar", w: 0.5, h: 0.075 })
  })

  it("normalises the rotation to 0..359", () => {
    expect(editTable(table(), { rotation: 370 }, 1.6).rotation).toBe(10)
    expect(editTable(table(), { rotation: -90 }, 1.6).rotation).toBe(270)
  })

  it("moves a table back inside when it grows", () => {
    const grown = editTable(table({ x: 0.95, shape: "rect" }), { w: 0.3 }, 1.6)
    expect(grown.x).toBeCloseTo(0.85)
  })
})

describe("dirty rows", () => {
  it("lists only the changed tables, as full layout rows", () => {
    const base = [table(), table({ id: "t-2", number: 2, x: 0.2, seats: 4 })]
    const draft = applyEdits(base, { "t-2": { x: 0.3 }, "t-1": { x: 0.5 } })
    expect(changedRows(base, draft)).toEqual([
      { id: "t-2", zoneId: "z-1", x: 0.3, y: 0.5, w: 0.1, h: 0.1, shape: "square", rotation: 0, seats: 4 },
    ])
  })

  it("sends null for absent coordinates and seats", () => {
    const base = [{ id: "t-3", number: 3, status: "available" } as Table]
    const draft = applyEdits(base, { "t-3": { shape: "round" } })
    expect(changedRows(base, draft)).toEqual([
      { id: "t-3", zoneId: null, x: null, y: null, w: null, h: null, shape: "round", rotation: 0, seats: null },
    ])
  })
})
