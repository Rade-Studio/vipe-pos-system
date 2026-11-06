import { describe, expect, it } from "vitest"
import type { Table } from "@/types"
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX, groupMove, pressIntent } from "./drag"

/** T26 — drag math: touch long-press pick-up and moving a selection together. */

describe("pressIntent", () => {
  it("a mouse or pen drags at once", () => {
    expect(pressIntent("mouse", 0, 0)).toBe("drag")
    expect(pressIntent("pen", 0, 30)).toBe("drag")
  })
  it("a touch waits for the long press, then picks the table up", () => {
    expect(pressIntent("touch", 100, 2)).toBe("wait")
    expect(pressIntent("touch", LONG_PRESS_MS, 4)).toBe("drag")
  })
  it("a touch that moves before the long press is a scroll or pinch", () => {
    expect(pressIntent("touch", 120, MOVE_TOLERANCE_PX + 1)).toBe("scroll")
  })
})

const t = (id: string, x: number, y: number): Table => ({ id, number: 1, status: "available", x, y, w: 0.1, h: 0.1, shape: "square" })
const ZONE = { aspect: 2, widthM: 10, depthM: 5 }

describe("groupMove", () => {
  it("moves every table by the dragged one's snapped delta (10 cm)", () => {
    const out = groupMove([t("a", 0.3, 0.5), t("b", 0.5, 0.5)], "a", 0.1032, 0, ZONE)
    expect(out).toEqual([
      { id: "a", x: 0.4, y: 0.5 },
      { id: "b", x: 0.6, y: 0.5 },
    ])
  })
  it("stops the whole group at the zone edge", () => {
    const out = groupMove([t("a", 0.3, 0.5), t("b", 0.8, 0.5)], "a", 0.5, 0, ZONE)
    expect(out.map((move) => move.x)).toEqual([0.45, 0.95])
  })
})
