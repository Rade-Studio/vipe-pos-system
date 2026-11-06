import type { Table } from "@/types"
import { moveTo } from "@/lib/floor/editor"

/**
 * Align and distribute the selected tables, and the rubber-band selection
 * (T26; design/admin-floor-plan/01 "Alinear" / "Distribuir"). Boxes ignore
 * rotation: the edges are those of the unrotated tabletop.
 */

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom"
export type DistributeAxis = "h" | "v"

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

/** Half width and height, as fractions of the floor width / height. */
function half(table: Table, aspect: number): { hw: number; hh: number } {
  const w = table.w ?? 0.1
  const h = table.shape === "round" || table.shape === "square" ? w : (table.h ?? w)
  return { hw: w / 2, hh: (h * aspect) / 2 }
}

const at = (table: Table, x: number, y: number, aspect: number): Table => moveTo(table, round4(x), round4(y), aspect, { snap: false })
const cx = (table: Table): number => table.x ?? 0.5
const cy = (table: Table): number => table.y ?? 0.5

export function alignTables(tables: Table[], mode: AlignMode, aspect: number): Table[] {
  if (tables.length < 2) return tables
  const boxes = tables.map((table) => ({ table, ...half(table, aspect) }))
  const left = Math.min(...boxes.map((b) => cx(b.table) - b.hw))
  const right = Math.max(...boxes.map((b) => cx(b.table) + b.hw))
  const top = Math.min(...boxes.map((b) => cy(b.table) - b.hh))
  const bottom = Math.max(...boxes.map((b) => cy(b.table) + b.hh))
  return boxes.map(({ table, hw, hh }) => {
    const x = { left: left + hw, hcenter: (left + right) / 2, right: right - hw }[mode as "left"] ?? cx(table)
    const y = { top: top + hh, vmiddle: (top + bottom) / 2, bottom: bottom - hh }[mode as "top"] ?? cy(table)
    return at(table, x, y, aspect)
  })
}

/** Equal gaps between neighbours; the two outer tables stay. Needs three or more. */
export function distributeTables(tables: Table[], axis: DistributeAxis, aspect: number): Table[] {
  if (tables.length < 3) return tables
  const centre = axis === "h" ? cx : cy
  const size = (table: Table) => (axis === "h" ? half(table, aspect).hw : half(table, aspect).hh)
  const sorted = [...tables].sort((a, b) => centre(a) - centre(b))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = centre(last) + size(last) - (centre(first) - size(first))
  const used = sorted.reduce((sum, table) => sum + 2 * size(table), 0)
  const gap = (span - used) / (sorted.length - 1)
  let edge = centre(first) - size(first)
  return sorted.map((table) => {
    const c = edge + size(table)
    edge += 2 * size(table) + gap
    return axis === "h" ? at(table, c, cy(table), aspect) : at(table, cx(table), c, aspect)
  })
}

export interface Band {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Ids of the tables whose box touches the band (fractions of the floor). */
export function tablesInRect(tables: Table[], band: Band, aspect: number): string[] {
  const minX = Math.min(band.x1, band.x2)
  const maxX = Math.max(band.x1, band.x2)
  const minY = Math.min(band.y1, band.y2)
  const maxY = Math.max(band.y1, band.y2)
  return tables
    .filter((table) => {
      const { hw, hh } = half(table, aspect)
      return cx(table) + hw >= minX && cx(table) - hw <= maxX && cy(table) + hh >= minY && cy(table) - hh <= maxY
    })
    .map((table) => table.id)
}
