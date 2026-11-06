import type { Table, TableShape, TableStatus } from "@/types"

/**
 * Pure geometry and wording of the 2.5D floor map (T6, S4), shared by the
 * waiter map, the admin editor (T5) and the admin overview mini map
 * (design/system.md "Table (mesa) component — 2.5D floor map").
 *
 * A table's `x, y` (0-1) is its centre as a fraction of the zone floor; `w`
 * and `h` are fractions of the zone WIDTH, so on a floor of `aspect` (width /
 * height) the height in percent of the floor height is `h * aspect`.
 */

/** The zone fields the floor needs (the API `Zone` satisfies it). */
export interface FloorZone {
  id: string
  name: string
  aspect: number
  labels: { text: string; side: "top" | "right" | "bottom" | "left" }[]
}

/** Status tokens family (`--status-<tone>-*`) and the words the floor prints. */
export const TABLE_STATUS: Record<TableStatus, { label: string; tone: "free" | "reserved" | "occupied" | "kitchen" | "served" }> = {
  available: { label: "Libre", tone: "free" },
  reserved: { label: "Reservada", tone: "reserved" },
  occupied: { label: "Ocupada", tone: "occupied" },
  kitchen: { label: "En cocina", tone: "kitchen" },
  served: { label: "Servida", tone: "served" },
}

export const statusLabel = (status: TableStatus): string => TABLE_STATUS[status]?.label ?? status

const isFraction = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value)

/** On a known zone with all four coordinates; anything else goes to "Sin ubicar". */
export function isPlaced(table: Table, zoneIds: ReadonlySet<string>): boolean {
  return (
    !!table.zoneId &&
    zoneIds.has(table.zoneId) &&
    isFraction(table.x) &&
    isFraction(table.y) &&
    isFraction(table.w) &&
    isFraction(table.h)
  )
}

const percent = (fraction: number): string => `${Math.round(fraction * 100_000) / 1000}%`

/** Round and square tables stay square: their height follows `w`. */
const keepsSquare = (shape: TableShape | undefined): boolean => shape === "round" || shape === "square"

/** Box of a placed table on its floor, as CSS percentages of the floor. */
export function tableBox(table: Table, aspect: number): { left: string; top: string; width: string; height: string } {
  const w = table.w ?? 0.1
  const h = keepsSquare(table.shape) ? w : (table.h ?? w)
  return {
    left: percent(table.x ?? 0.5),
    top: percent(table.y ?? 0.5),
    width: percent(w),
    height: percent(h * aspect),
  }
}

/** Chairs to draw: `seats` when positive, none for null/0. */
export const chairCount = (seats: number | undefined | null): number =>
  typeof seats === "number" && seats > 0 ? Math.min(Math.floor(seats), 20) : 0

/**
 * Chair centres around the tabletop box, as CSS `left` / `top` (`--cs` is the
 * chair size). Round: evenly on a circle; bar: one row under the counter;
 * square with 4: one per side; otherwise split across the two long sides.
 */
export function chairPositions(shape: TableShape | undefined, seats: number | undefined | null): { left: string; top: string }[] {
  const n = chairCount(seats)
  if (n === 0) return []
  const out: { left: string; top: string }[] = []
  if (shape === "round") {
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2
      const c = Math.cos(angle).toFixed(3)
      const s = Math.sin(angle).toFixed(3)
      out.push({
        left: `calc(50% + ${c} * (50% + var(--cs) * 0.62))`,
        top: `calc(50% + ${s} * (50% + var(--cs) * 0.62))`,
      })
    }
    return out
  }
  if (shape === "bar") {
    for (let i = 0; i < n; i += 1) out.push({ left: `${((i + 1) / (n + 1)) * 100}%`, top: "calc(100% + var(--cs) * 0.75)" })
    return out
  }
  if (shape === "square" && n === 4) {
    return [
      { left: "50%", top: "calc(var(--cs) * -0.62)" },
      { left: "50%", top: "calc(100% + var(--cs) * 0.62)" },
      { left: "calc(var(--cs) * -0.62)", top: "50%" },
      { left: "calc(100% + var(--cs) * 0.62)", top: "50%" },
    ]
  }
  const side = Math.ceil(n / 2)
  for (let i = 0; i < n; i += 1) {
    const top = i < side
    const k = top ? i : i - side
    const count = top ? side : n - side
    out.push({
      left: `${((k + 1) / (count + 1)) * 100}%`,
      top: top ? "calc(var(--cs) * -0.62)" : "calc(100% + var(--cs) * 0.62)",
    })
  }
  return out
}

export const seatsText = (seats: number | undefined | null): string => {
  const n = chairCount(seats)
  return n === 0 ? "sin sillas" : `${n} ${n === 1 ? "silla" : "sillas"}`
}

export function initials(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/** "Mesa 4, En cocina, 4 sillas, Carolina Ruiz". */
export function tableAccessibleName(table: Table, waiterName?: string): string {
  return [`Mesa ${table.number}`, statusLabel(table.status), seatsText(table.seats), waiterName].filter(Boolean).join(", ")
}
