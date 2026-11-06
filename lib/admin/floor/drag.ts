import type { Table } from "@/types"
import { snap } from "@/lib/floor/editor"
import { gridStep, type ZoneUnits } from "./units"

/**
 * Drag math of the floor plan editor (T26). A mouse or pen drags at once; a
 * touch picks a table up after a long press, so a swipe or a pinch that
 * starts on a table still scrolls and zooms the page.
 */

export const LONG_PRESS_MS = 350
export const MOVE_TOLERANCE_PX = 8

export type PressIntent = "wait" | "drag" | "scroll"

export function pressIntent(pointerType: string, elapsedMs: number, movedPx: number): PressIntent {
  if (pointerType !== "touch") return "drag"
  if (elapsedMs >= LONG_PRESS_MS) return "drag"
  return movedPx > MOVE_TOLERANCE_PX ? "scroll" : "wait"
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

function half(table: Table, aspect: number): { hw: number; hh: number } {
  const w = table.w ?? 0.1
  const h = table.shape === "round" || table.shape === "square" ? w : (table.h ?? w)
  return { hw: w / 2, hh: (h * aspect) / 2 }
}

/**
 * New centres of `tables` (at their drag-start positions) when the table
 * `anchorId` is dragged by `dx, dy` (fractions of the floor): the anchor
 * snaps to the zone step, the rest keep their offsets, and the whole group
 * stops at the zone edge.
 */
export function groupMove(tables: Table[], anchorId: string, dx: number, dy: number, zone: ZoneUnits): { id: string; x: number; y: number }[] {
  const anchor = tables.find((table) => table.id === anchorId) ?? tables[0]
  if (!anchor) return []
  const step = gridStep(zone)
  const ax = anchor.x ?? 0.5
  const ay = anchor.y ?? 0.5
  let moveX = snap(ax + dx, step) - ax
  let moveY = snap(ay + dy, step * zone.aspect) - ay
  for (const table of tables) {
    const { hw, hh } = half(table, zone.aspect)
    const x = table.x ?? 0.5
    const y = table.y ?? 0.5
    moveX = Math.min(Math.max(moveX, hw - x), 1 - hw - x)
    moveY = Math.min(Math.max(moveY, hh - y), 1 - hh - y)
  }
  return tables.map((table) => ({ id: table.id, x: round4((table.x ?? 0.5) + moveX), y: round4((table.y ?? 0.5) + moveY) }))
}
