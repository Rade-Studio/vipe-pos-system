/**
 * Movements ledger helpers (odd/tasks/inventario-rediseno.md, S4): the type
 * chips, the source document of a row, the day groups and the CSV export.
 */

import type { Movement, MovementType } from "@/lib/api/inventory/types"
import { clockOf } from "./production-csv"
import { localIsoDate } from "./production-sheet"

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: "Saldo inicial",
  purchase: "Compra",
  sale: "Venta",
  production_consume: "Consumo producción",
  production_output: "Producción",
  adjustment: "Ajuste",
  waste: "Merma",
  transfer_out: "Traslado salida",
  transfer_in: "Traslado entrada",
  count_adjustment: "Ajuste por conteo",
}

export type MovementGroupId = "sale" | "purchase" | "production" | "adjustment" | "waste" | "transfer"

/** The type chips; "Ajustes y conteos" also holds the opening balances. */
export const MOVEMENT_GROUPS: { id: MovementGroupId; label: string; types: MovementType[] }[] = [
  { id: "sale", label: "Ventas", types: ["sale"] },
  { id: "purchase", label: "Compras", types: ["purchase"] },
  { id: "production", label: "Producción", types: ["production_consume", "production_output"] },
  { id: "adjustment", label: "Ajustes y conteos", types: ["adjustment", "count_adjustment", "opening"] },
  { id: "waste", label: "Mermas", types: ["waste"] },
  { id: "transfer", label: "Traslados", types: ["transfer_out", "transfer_in"] },
]

export const groupOfType = (type: MovementType): MovementGroupId =>
  MOVEMENT_GROUPS.find((g) => g.types.includes(type))!.id

/** The origin shown on a row; a transfer's waste is the shortfall written off at the destination. */
export function documentText(m: Movement): string | null {
  if (!m.documentLabel) return null
  return m.movementType === "waste" && m.documentKind === "inventory_transfer" ? `Merma en tránsito · ${m.documentLabel}` : m.documentLabel
}

const SECTION: Record<NonNullable<Movement["documentKind"]>, string> = {
  order: "orders",
  purchase_order: "inventory/purchases",
  inventory_count: "inventory/counts",
  production_batch: "inventory/production",
  inventory_transfer: "inventory/transfers",
}

/** Admin section that lists the document; the caller checks that the section exists. */
export const documentSection = (kind: Movement["documentKind"]) => (kind ? SECTION[kind] : null)

export interface MovementDay {
  day: string
  rows: Movement[]
  net: number
}

/** By local day in server order (newest first), with the day's signed value. */
export function groupMovementsByDay(rows: readonly Movement[]): MovementDay[] {
  const days: MovementDay[] = []
  for (const m of rows) {
    const day = localIsoDate(new Date(m.createdAt))
    let group = days.at(-1)
    if (group?.day !== day) days.push((group = { day, rows: [], net: 0 }))
    group.rows.push(m)
    group.net = Math.round((group.net + m.totalCost) * 100) / 100
  }
  return days
}

const DECIMAL = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3, useGrouping: false })
const cell = (value: string | number) => {
  const text = String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** The listed movements ("Exportar CSV"), `;` and a BOM like the lots export. */
export function movementsCsv(rows: readonly Movement[]): string {
  const lines = [
    ["fecha", "hora", "sku", "articulo", "bodega", "tipo", "cantidad", "unidad", "costo_unitario", "costo_total", "origen", "motivo", "usuario"],
    ...rows.map((m) => [
      localIsoDate(new Date(m.createdAt)),
      clockOf(m.createdAt),
      m.sku ?? "",
      m.itemName ?? "",
      m.locationName ?? "",
      MOVEMENT_LABEL[m.movementType],
      DECIMAL.format(m.quantity),
      m.unit ?? "",
      m.unitCost,
      Math.round(m.totalCost),
      documentText(m) ?? "",
      m.reason ?? "",
      m.createdByName ?? "",
    ]),
  ]
  return "\uFEFF" + lines.map((row) => row.map(cell).join(";") + "\r\n").join("")
}
