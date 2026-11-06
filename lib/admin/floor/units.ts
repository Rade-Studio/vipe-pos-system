import type { Table } from "@/types"
import { BIG_STEP, GRID, moveTo, snap } from "@/lib/floor/editor"

/**
 * Real sizes of the floor plan editor (T26, S8). A zone with `widthM` and
 * `depthM` shows table sizes and positions in cm and snaps to 10 cm; without
 * them the editor keeps the % of the zone width and the 2.5 % grid (T5).
 *
 * Units follow `lib/floor/layout.ts`: `x`, `w`, `h` are fractions of the zone
 * width, `y` a fraction of its depth (floor height).
 */

export interface ZoneUnits {
  aspect: number
  widthM?: number | null
  depthM?: number | null
}

/** Snap step on a zone with dimensions. */
export const SNAP_CM = 10

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0

export const hasDimensions = (zone: ZoneUnits): boolean => positive(zone.widthM) && positive(zone.depthM)

const widthCm = (zone: ZoneUnits): number => (zone.widthM ?? 0) * 100
const depthCm = (zone: ZoneUnits): number => (zone.depthM ?? 0) * 100

/** A fraction of the zone width (x, w, h) in whole cm. */
export const toCm = (fraction: number, zone: ZoneUnits): number => Math.round(fraction * widthCm(zone))
export const fromCm = (cm: number, zone: ZoneUnits): number => cm / widthCm(zone)
/** A fraction of the zone depth (y) in whole cm. */
export const yToCm = (fraction: number, zone: ZoneUnits): number => Math.round(fraction * depthCm(zone))
export const yFromCm = (cm: number, zone: ZoneUnits): number => cm / depthCm(zone)

/** Snap step as a fraction of the zone width: 10 cm, or GRID without dimensions. */
export const gridStep = (zone: ZoneUnits): number => (hasDimensions(zone) ? SNAP_CM / widthCm(zone) : GRID)

const percentText = (fraction: number): string => (Math.round(fraction * 1000) / 10).toLocaleString("es-CO")

const sizeOf = (table: Table): { w: number; h: number } => {
  const w = table.w ?? 0.1
  return { w, h: table.shape === "round" || table.shape === "square" ? w : (table.h ?? w) }
}

/** "120 × 80 cm" on a zone with dimensions, "7,5 × 5 % del ancho" without. */
export function sizeText(table: Table, zone: ZoneUnits): string {
  const { w, h } = sizeOf(table)
  return hasDimensions(zone) ? `${toCm(w, zone)} × ${toCm(h, zone)} cm` : `${percentText(w)} × ${percentText(h)} % del ancho`
}

/** The table centred at `x, y` snapped to the zone's step, whole inside the zone. */
export function moveSnapped(table: Table, x: number, y: number, zone: ZoneUnits): Table {
  const step = gridStep(zone)
  return moveTo(table, snap(x, step), snap(y, step * zone.aspect), zone.aspect, { snap: false })
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** Arrow keys move one step (Shift: four); `null` for any other key. */
export function nudgeBy(table: Table, key: string, big: boolean, zone: ZoneUnits): Table | null {
  const arrow = ARROWS[key]
  if (!arrow) return null
  const step = gridStep(zone) * (big ? BIG_STEP : 1)
  const x = (table.x ?? 0.5) + arrow[0] * step
  const y = (table.y ?? 0.5) + arrow[1] * step * zone.aspect
  return moveTo(table, x, y, zone.aspect, { snap: false })
}
