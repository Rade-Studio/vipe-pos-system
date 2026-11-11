import type { Table, TableShape } from "@/types"

/**
 * Pure logic of the admin floor plan editor (T5, S4): snap to the grid, keep
 * a table inside its zone, keyboard nudges, a free spot for a new table and
 * the dirty rows of ONE `PUT /tables/layout`.
 *
 * Units follow `layout.ts`: `x, y` are the centre as fractions of the floor,
 * `w, h` fractions of the zone WIDTH (a zone stores no real size, so the
 * editor shows sizes as % of the zone width, never centimetres — S8).
 */

/** Snap step, as a fraction of the zone width (half a cell of the floor grid). */
export const GRID = 0.025
/** Shift + arrow moves this many grid steps. */
export const BIG_STEP = 4
export const MIN_SIZE = 0.03
export const MAX_SIZE = 0.9
export const MAX_SEATS = 20

/** Size of a table added from the palette, per shape. */
export const SHAPE_DEFAULTS: Record<TableShape, { w: number; h: number }> = {
  round: { w: 0.1, h: 0.1 },
  square: { w: 0.1, h: 0.1 },
  rect: { w: 0.18, h: 0.09 },
  bar: { w: 0.4, h: 0.075 },
}

export const SHAPE_LABELS: Record<TableShape, string> = {
  round: "Redonda",
  square: "Cuadrada",
  rect: "Rectangular",
  bar: "Barra",
}

/** The editable layout of a table: the body row of `PUT /tables/layout`. */
export interface LayoutRow {
  id: string
  zoneId: string | null
  x: number | null
  y: number | null
  w: number | null
  h: number | null
  shape: TableShape
  rotation: number
  seats: number | null
}

export type LayoutEdit = Partial<Pick<Table, "zoneId" | "x" | "y" | "w" | "h" | "shape" | "rotation" | "seats">>

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const snap = (value: number, step: number): number => round4(Math.round(value / step) * step)

const keepsSquare = (shape: TableShape | undefined): boolean => shape === "round" || shape === "square"

/** Half width and half height of a table, as fractions of the floor width / height. */
function halfBox(size: { w?: number; h?: number; shape?: TableShape }, aspect: number): { hw: number; hh: number } {
  const w = size.w ?? 0.1
  const h = keepsSquare(size.shape) ? w : (size.h ?? w)
  return { hw: w / 2, hh: (h * aspect) / 2 }
}

function clampCentre(x: number, y: number, half: { hw: number; hh: number }): { x: number; y: number } {
  return {
    x: round4(half.hw >= 0.5 ? 0.5 : clamp(x, half.hw, 1 - half.hw)),
    y: round4(half.hh >= 0.5 ? 0.5 : clamp(y, half.hh, 1 - half.hh)),
  }
}

/** The table centred at `x, y` (snapped by default), whole inside the zone. */
export function moveTo(table: Table, x: number, y: number, aspect: number, options: { snap?: boolean } = {}): Table {
  const snapped = options.snap === false ? { x, y } : { x: snap(x, GRID), y: snap(y, GRID * aspect) }
  return { ...table, ...clampCentre(snapped.x, snapped.y, halfBox(table, aspect)) }
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Arrow keys move one grid step (Shift: four); `null` for any other key. */
export function nudge(table: Table, key: string, big: boolean, aspect: number): Table | null {
  const arrow = ARROWS[key]
  if (!arrow) return null
  const step = GRID * (big ? BIG_STEP : 1)
  const x = (table.x ?? 0.5) + arrow[0] * step
  // A step on y is the same distance on the floor: GRID of the width.
  const y = (table.y ?? 0.5) + arrow[1] * step * aspect
  return moveTo(table, x, y, aspect, { snap: false })
}

const FREE_CELLS = 8

/**
 * Centre for a new table of `size`: the first cell of an 8×8 grid (as the API
 * auto-placement) whose box, moved inside the floor, overlaps no table; the
 * floor centre when the zone is full.
 */
export function freeSpot(tables: Table[], size: { w: number; h: number; shape?: TableShape }, aspect: number): { x: number; y: number } {
  const half = halfBox(size, aspect)
  const boxes = tables
    .filter((table) => typeof table.x === "number" && typeof table.y === "number")
    .map((table) => ({ x: table.x as number, y: table.y as number, ...halfBox(table, aspect) }))
  for (let row = 0; row < FREE_CELLS; row += 1) {
    for (let col = 0; col < FREE_CELLS; col += 1) {
      const spot = clampCentre((col + 0.5) / FREE_CELLS, (row + 0.5) / FREE_CELLS, half)
      const overlaps = boxes.some(
        (box) => Math.abs(box.x - spot.x) < box.hw + half.hw && Math.abs(box.y - spot.y) < box.hh + half.hh,
      )
      if (!overlaps) return spot
    }
  }
  return { x: 0.5, y: 0.5 }
}

export const nextTableNumber = (tables: Table[]): number => tables.reduce((max, table) => Math.max(max, table.number), 0) + 1

/**
 * An inspector edit: a new shape starts from its own default size (a bar's
 * size never leaks into a round table and back), sizes within MIN..MAX_SIZE,
 * round and square tables kept square, rotation 0..359, seats 0..20, and the
 * table moved back inside the zone when it grew.
 */
export function editTable(table: Table, edit: LayoutEdit, aspect: number): Table {
  const reshaped = edit.shape !== undefined && edit.shape !== (table.shape ?? "square")
  const next: Table = { ...table, ...(reshaped && edit.shape ? SHAPE_DEFAULTS[edit.shape] : {}), ...edit }
  if (edit.w !== undefined) next.w = round4(clamp(edit.w ?? 0.1, MIN_SIZE, MAX_SIZE))
  if (edit.h !== undefined) next.h = round4(clamp(edit.h ?? 0.1, MIN_SIZE, MAX_SIZE))
  if (keepsSquare(next.shape)) next.h = next.w
  if (edit.rotation !== undefined) next.rotation = ((Math.round(edit.rotation) % 360) + 360) % 360
  if (edit.seats !== undefined && edit.seats !== null) next.seats = clamp(Math.floor(edit.seats), 0, MAX_SEATS)
  if (typeof next.x === "number" && typeof next.y === "number") {
    Object.assign(next, clampCentre(next.x, next.y, halfBox(next, aspect)))
  }
  return next
}

export function toLayoutRow(table: Table): LayoutRow {
  return {
    id: table.id,
    zoneId: table.zoneId ?? null,
    x: table.x ?? null,
    y: table.y ?? null,
    w: table.w ?? null,
    h: table.h ?? null,
    shape: table.shape ?? "square",
    rotation: table.rotation ?? 0,
    seats: table.seats ?? null,
  }
}

/** The server tables with the unsaved edits on top. */
export function applyEdits(base: Table[], edits: Record<string, LayoutEdit>): Table[] {
  return base.map((table) => (edits[table.id] ? { ...table, ...edits[table.id] } : table))
}

const sameRow = (a: LayoutRow, b: LayoutRow): boolean =>
  (Object.keys(a) as (keyof LayoutRow)[]).every((key) => {
    const left = a[key]
    const right = b[key]
    return typeof left === "number" && typeof right === "number" ? Math.abs(left - right) < 1e-6 : left === right
  })

/** One full layout row per table whose layout differs from the server's. */
export function changedRows(base: Table[], draft: Table[]): LayoutRow[] {
  const byId = new Map(base.map((table) => [table.id, toLayoutRow(table)]))
  return draft
    .map(toLayoutRow)
    .filter((row) => {
      const original = byId.get(row.id)
      return !original || !sameRow(original, row)
    })
}
