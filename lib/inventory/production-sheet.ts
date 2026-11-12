/**
 * The daily production sheet (odd/tasks/produccion-diaria.md, S3–S5): per-row
 * max and cost, the netted demand of rows that share an ingredient, the
 * server's bulk shortages, and the batch history grouped by produced day.
 * Pure: the screen feeds it the formulas and the stock of the chosen bodega.
 */

import type { ProductionBatch } from "@/lib/api/inventory/types"
import { formulaCost, maxProducible, scaleLines, type FormulaItem, type PrepFormula } from "./formula"
import { daysUntil } from "./stock"

const round = (value: number) => Math.round(value * 10_000) / 10_000
/** Max shown to the user: never more than what fits. */
const floor3 = (value: number) => Math.floor(round(value) * 1000) / 1000

export interface SheetRow {
  itemId: string
  quantity: number
  max: number
  exceeds: boolean
  cost: number
  unitCost: number
}

export interface ConsumedIngredient {
  ingredientId: string
  name: string
  unit: string
  quantity: number
  cost: number
}

export interface NetShortage {
  ingredientId: string
  name: string
  unit: string
  required: number
  available: number
  missing: number
  /** Rows that consume it, in sheet order. */
  itemIds: string[]
}

export interface SheetSummary {
  /** Rows with a quantity > 0, in the order of `quantities`. */
  rows: SheetRow[]
  count: number
  totalCost: number
  /** Rows over their own max. */
  exceedCount: number
  /** Ingredients whose combined demand exceeds the stock. */
  netShortages: NetShortage[]
  /** Rows over their max or part of a net shortage. */
  insufficientIds: string[]
  /** Highest cost first. */
  ingredients: ConsumedIngredient[]
}

/** What one preparation can be produced from `itemsById` stock, rounded down to 3 decimals. */
export function rowMax(formula: PrepFormula | undefined, itemsById: Map<string, FormulaItem>): number {
  return formula ? floor3(maxProducible(formula, itemsById)) : 0
}

export function summarizeSheet(
  quantities: Record<string, number>,
  formulas: Record<string, PrepFormula | undefined>,
  itemsById: Map<string, FormulaItem>,
): SheetSummary {
  const rows: SheetRow[] = []
  const demand = new Map<string, { quantity: number; itemIds: string[] }>()

  for (const [itemId, quantity] of Object.entries(quantities)) {
    if (!(quantity > 0)) continue
    const formula = formulas[itemId]
    const max = rowMax(formula, itemsById)
    const yieldQuantity = formula?.yieldQuantity ?? 0
    const scaled = formula && yieldQuantity > 0 ? scaleLines(formula.lines, quantity / yieldQuantity) : []
    const cost = round(formulaCost(scaled, itemsById).total)
    rows.push({ itemId, quantity, max, exceeds: round(quantity) > max, cost, unitCost: round(cost / quantity) })
    for (const line of scaled) {
      const entry = demand.get(line.ingredientId) ?? { quantity: 0, itemIds: [] }
      entry.quantity += line.quantity
      if (!entry.itemIds.includes(itemId)) entry.itemIds.push(itemId)
      demand.set(line.ingredientId, entry)
    }
  }

  const ingredients: ConsumedIngredient[] = []
  const netShortages: NetShortage[] = []
  for (const [ingredientId, entry] of demand) {
    const item = itemsById.get(ingredientId)
    const required = round(entry.quantity)
    const available = Math.max(item?.stock ?? 0, 0)
    const name = item?.name ?? "Artículo desconocido"
    const unit = item?.unit ?? ""
    ingredients.push({ ingredientId, name, unit, quantity: required, cost: round((item?.cost ?? 0) * required) })
    if (required > available) {
      netShortages.push({ ingredientId, name, unit, required, available, missing: round(required - available), itemIds: entry.itemIds })
    }
  }
  ingredients.sort((a, b) => b.cost - a.cost)

  const short = new Set([...rows.filter((r) => r.exceeds).map((r) => r.itemId), ...netShortages.flatMap((s) => s.itemIds)])
  return {
    rows,
    count: rows.length,
    totalCost: round(rows.reduce((sum, row) => sum + row.cost, 0)),
    exceedCount: rows.filter((row) => row.exceeds).length,
    netShortages,
    insufficientIds: rows.map((row) => row.itemId).filter((id) => short.has(id)),
    ingredients,
  }
}

/** Stock of one location from an item's lots. */
export function stockAtLocation(lots: readonly { locationId: string; quantity: number }[], locationId: string): number {
  return round(lots.reduce((sum, lot) => (lot.locationId === locationId ? sum + lot.quantity : sum), 0))
}

/** A copy of `itemsById` whose stock is replaced where `stockById` knows it. */
export function withStock(itemsById: Map<string, FormulaItem>, stockById: Map<string, number>): Map<string, FormulaItem> {
  return new Map(
    [...itemsById].map(([id, item]) => [id, stockById.has(id) ? { ...item, stock: stockById.get(id) as number } : item]),
  )
}

export interface BulkShortageIngredient {
  ingredientId: string
  name: string
  unit: string
  required: number
  available: number
  missing: number
}

export interface BulkShortage {
  itemId: string
  name: string
  ingredients: BulkShortageIngredient[]
}

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** The 422 P0001 `details` of the bulk production (JSON text or array) as shortages per preparation. */
export function parseBulkShortages(details: unknown): BulkShortage[] {
  let parsed = details
  if (typeof details === "string") {
    try {
      parsed = JSON.parse(details)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { item_id?: unknown }).item_id === "string")
    .map((r) => ({
      itemId: r.item_id as string,
      name: typeof r.name === "string" ? r.name : "",
      ingredients: (Array.isArray(r.ingredients) ? r.ingredients : [])
        .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
        .map((g) => ({
          ingredientId: String(g.ingredient_id ?? ""),
          name: typeof g.name === "string" ? g.name : "",
          unit: typeof g.unit === "string" ? g.unit : "",
          required: num(g.required),
          available: num(g.available),
          missing: num(g.missing),
        })),
    }))
}

export interface BatchDay {
  day: string
  batches: ProductionBatch[]
  totalCost: number
}

/** By producedOn, newest day first; within a day newest registration first. */
export function groupBatchesByDay(batches: readonly ProductionBatch[]): BatchDay[] {
  const days = new Map<string, ProductionBatch[]>()
  for (const batch of batches) days.set(batch.producedOn, [...(days.get(batch.producedOn) ?? []), batch])
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({
      day,
      batches: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      totalCost: round(list.reduce((sum, b) => sum + b.totalCost, 0)),
    }))
}

/** Quantity produced per preparation ("Repetir producción de ayer"). */
export function sumBatchesByItem(batches: readonly ProductionBatch[]): Record<string, number> {
  const sums: Record<string, number> = {}
  for (const batch of batches) sums[batch.itemId] = round((sums[batch.itemId] ?? 0) + batch.quantity)
  return sums
}

/** "Vence pronto": expires today or within the next 3 days. */
export const SOON_DAYS = 3

export const expiresSoon = (batch: ProductionBatch, today: Date) => {
  if (!batch.expiresOn) return false
  const days = daysUntil(batch.expiresOn, today)
  return days >= 0 && days <= SOON_DAYS
}

export interface BatchFilters {
  query?: string
  itemId?: string
  expiringSoon?: boolean
  today: Date
}

export function filterBatches(batches: readonly ProductionBatch[], filters: BatchFilters): ProductionBatch[] {
  const text = (filters.query ?? "").trim().toLowerCase()
  return batches.filter(
    (b) =>
      (!filters.itemId || b.itemId === filters.itemId) &&
      (!filters.expiringSoon || expiresSoon(b, filters.today)) &&
      (!text || `${b.itemName ?? ""} ${b.lotCode ?? ""}`.toLowerCase().includes(text)),
  )
}

const pad = (n: number) => String(n).padStart(2, "0")

export const localIsoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const parseIso = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function addDaysIso(iso: string, days: number): string {
  const date = parseIso(iso)
  date.setDate(date.getDate() + days)
  return localIsoDate(date)
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** "jue 12 nov". */
export function dayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** "15 nov". */
export function shortDayLabel(iso: string): string {
  const date = parseIso(iso)
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** The business dates the server accepts: today and up to 7 days back. */
export const MAX_BACKDATE_DAYS = 7

export function businessDates(today: Date): { value: string; label: string }[] {
  const base = localIsoDate(today)
  return Array.from({ length: MAX_BACKDATE_DAYS + 1 }, (_, i) => {
    const value = addDaysIso(base, -i)
    const label = i === 0 ? `Hoy · ${dayLabel(value)}` : i === 1 ? `Ayer · ${dayLabel(value)} (reporte tardío)` : dayLabel(value)
    return { value, label }
  })
}

/** The lot's expiry: produced day + shelf life, as the server computes it. */
export function expiryFor(producedOn: string, shelfLifeDays: number | null): string | null {
  return shelfLifeDays === null || shelfLifeDays === undefined ? null : addDaysIso(producedOn, shelfLifeDays)
}
