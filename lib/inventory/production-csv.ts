/**
 * CSV for the daily production (odd/tasks/produccion-diaria.md, S4–S5): the
 * import template every preparation is listed in, the reader of the filled
 * report (columns by header name, es-CO decimals) and the lots export. The
 * files use `;` and a BOM so Excel in Spanish opens them as columns.
 */

import type { ProductionBatch } from "@/lib/api/inventory/types"

export interface CsvPrep {
  id: string
  sku: string
  name: string
  unit: string
}

const BOM = "\uFEFF"
const SEP = ";"

function cell(value: string | number): string {
  const text = String(value)
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const toCsv = (rows: (string | number)[][]) => BOM + rows.map((row) => row.map(cell).join(SEP) + "\r\n").join("")

export const TEMPLATE_HEADER = ["codigo", "preparacion", "unidad", "cantidad"]

/** Every preparation by name, with an empty cantidad to fill. */
export function productionTemplateCsv(preps: readonly CsvPrep[]): string {
  const sorted = [...preps].sort((a, b) => a.name.localeCompare(b.name, "es"))
  return toCsv([TEMPLATE_HEADER, ...sorted.map((p) => [p.sku, p.name, p.unit, ""])])
}

/** "27,5", "1.250,5" and "1.250" (thousands) as es-CO; "2.5" as a plain decimal. NaN otherwise. */
export function parseCsvDecimal(raw: string): number {
  let text = raw.trim()
  if (!text) return Number.NaN
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "")
  return /^\d*\.?\d+$/.test(text) ? Number(text) : Number.NaN
}

/** One CSV line split on `sep`, honoring double quotes. */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') quoted = false
      else current += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      cells.push(current)
      current = ""
    } else current += ch
  }
  cells.push(current)
  return cells
}

const fold = (raw: string) =>
  raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()

export type ProductionCsvResult =
  | { ok: true; quantities: Record<string, number>; unknown: string[]; invalid: string[] }
  | { ok: false; error: string }

export const MISSING_HEADER_ERROR = "El archivo no tiene las columnas codigo y cantidad. Descarga la plantilla y úsala como base."

/**
 * Quantities per preparation id from a filled report. Rows with an empty
 * cantidad are skipped; unknown codes and unreadable quantities are reported
 * by code. Repeated codes add up.
 */
export function parseProductionCsv(text: string, preps: readonly CsvPrep[]): ProductionCsvResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) return { ok: false, error: MISSING_HEADER_ERROR }
  const first = lines[0]
  const sep = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ","
  const header = splitLine(first, sep).map(fold)
  const codeAt = header.indexOf("codigo")
  const qtyAt = header.indexOf("cantidad")
  if (codeAt < 0 || qtyAt < 0) return { ok: false, error: MISSING_HEADER_ERROR }

  const bySku = new Map(preps.map((p) => [fold(p.sku), p]))
  const quantities: Record<string, number> = {}
  const unknown: string[] = []
  const invalid: string[] = []
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep)
    const rawQty = (cells[qtyAt] ?? "").trim()
    if (!rawQty) continue
    const code = (cells[codeAt] ?? "").trim()
    const prep = bySku.get(fold(code))
    if (!prep) {
      unknown.push(code || "(sin código)")
      continue
    }
    const quantity = parseCsvDecimal(rawQty)
    if (!(quantity > 0)) {
      invalid.push(code)
      continue
    }
    quantities[prep.id] = Math.round(((quantities[prep.id] ?? 0) + quantity) * 10_000) / 10_000
  }
  return { ok: true, quantities, unknown, invalid }
}

const DECIMAL = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3, useGrouping: false })
const pad = (n: number) => String(n).padStart(2, "0")

/** Local "HH:MM" of an ISO timestamp. */
export const clockOf = (iso: string) => {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The listed lots ("Exportar CSV"). */
export function batchesCsv(batches: readonly ProductionBatch[]): string {
  return toCsv([
    ["fecha", "hora", "preparacion", "cantidad", "unidad", "lote", "vence", "bodega", "responsable", "costo_total"],
    ...batches.map((b) => [
      b.producedOn,
      clockOf(b.createdAt),
      b.itemName ?? "",
      DECIMAL.format(b.quantity),
      b.unit ?? "",
      b.lotCode ?? "",
      b.expiresOn ?? "",
      b.locationName ?? "",
      b.producedBy?.name ?? "",
      Math.round(b.totalCost),
    ]),
  ])
}
