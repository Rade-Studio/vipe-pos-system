import { describe, expect, it } from "vitest"
import type { Table } from "@/types"
import { GRID } from "@/lib/floor/editor"
import { fromCm, gridStep, hasDimensions, moveSnapped, nudgeBy, sizeText, toCm, yFromCm, yToCm } from "./units"

/** T26 (S8) — real sizes from the zone's widthM × depthM; % of the width without them. */

const SALON = { aspect: 1.6, widthM: 16, depthM: 10 }
const NO_SIZE = { aspect: 1.6, widthM: null, depthM: null }
const table = (extra: Partial<Table> = {}): Table => ({ id: "t", number: 1, status: "available", x: 0.5, y: 0.5, w: 0.075, h: 0.05, shape: "rect", ...extra })

describe("zone units", () => {
  it("has dimensions only with both positive metres", () => {
    expect(hasDimensions(SALON)).toBe(true)
    expect(hasDimensions(NO_SIZE)).toBe(false)
    expect(hasDimensions({ aspect: 1, widthM: 4, depthM: null })).toBe(false)
  })

  it("converts fractions of the width to cm and back", () => {
    expect(toCm(0.075, SALON)).toBe(120)
    expect(fromCm(120, SALON)).toBeCloseTo(0.075)
    expect(yToCm(0.5, SALON)).toBe(500)
    expect(yFromCm(250, SALON)).toBeCloseTo(0.25)
  })

  it('reads a size as "120 × 80 cm" with dimensions and in % without', () => {
    expect(sizeText(table(), SALON)).toBe("120 × 80 cm")
    expect(sizeText(table({ shape: "round", w: 0.05, h: 0.2 }), SALON)).toBe("80 × 80 cm")
    expect(sizeText(table(), NO_SIZE)).toBe("7,5 × 5 % del ancho")
  })

  it("snaps to 10 cm with dimensions and to the 2.5 % grid without", () => {
    expect(gridStep(SALON)).toBeCloseTo(0.1 / 16)
    expect(gridStep(NO_SIZE)).toBe(GRID)
    const moved = moveSnapped(table(), 0.5031, 0.5049, SALON)
    expect(toCm(moved.x ?? 0, SALON)).toBe(800)
    expect(yToCm(moved.y ?? 0, SALON)).toBe(500)
    const keep = moveSnapped(table(), 0.5031, 0.5049, NO_SIZE)
    expect(keep.x).toBe(0.5)
  })

  it("keeps a snapped table inside the zone", () => {
    expect(moveSnapped(table(), 1.2, -1, SALON)).toMatchObject({ x: 0.9625, y: 0.04 })
  })

  it("nudges by 10 cm (Shift: 40 cm) with dimensions", () => {
    const right = nudgeBy(table(), "ArrowRight", false, SALON)
    expect(toCm(right?.x ?? 0, SALON)).toBe(810)
    const down = nudgeBy(table(), "ArrowDown", true, SALON)
    expect(yToCm(down?.y ?? 0, SALON)).toBe(540)
    expect(nudgeBy(table(), "Enter", false, SALON)).toBeNull()
  })
})
