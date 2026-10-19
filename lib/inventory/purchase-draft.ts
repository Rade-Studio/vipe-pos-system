/**
 * Purchase order draft editor state (odd/tasks/admin-dashboard-inventario.md, T8).
 * Lines keep quantity and unit cost in the item's BASE unit, as the server
 * does; the UI enters them in the purchase unit when the item defines one.
 */

import type {
  CreatePurchaseOrderInput,
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderLineInput,
} from "@/lib/supabase/inventory/types"

export interface DraftLine {
  key: string
  /** Server line id when the draft was loaded from an order. */
  lineId?: string
  itemId: string
  itemName: string
  sku: string
  unit: string
  purchaseUnit: string | null
  purchaseFactor: number
  trackLots: boolean
  /** Base units. */
  quantity: number
  /** Per base unit. */
  unitCost: number
}

export interface PurchaseDraft {
  supplierId: string
  locationId: string
  expectedOn: string
  notes: string
  lines: DraftLine[]
}

type DraftItem = Pick<InventoryItem, "id" | "name" | "sku" | "unit" | "cost" | "purchaseUnit" | "purchaseFactor" | "trackLots">

export type PurchaseDraftAction =
  | { type: "reset"; draft: PurchaseDraft }
  | { type: "setField"; field: "supplierId" | "locationId" | "expectedOn" | "notes"; value: string }
  /** Quantity and cost in base units; default one purchase unit at the item's last cost. */
  | { type: "addItem"; item: DraftItem; quantity?: number; unitCost?: number }
  | { type: "setEntryQuantity"; key: string; value: number }
  | { type: "setEntryCost"; key: string; value: number }
  | { type: "removeLine"; key: string }

const round = (value: number, places: number) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

let keySeq = 0
const nextKey = () => `line-${++keySeq}`

export const emptyDraft = (locationId: string): PurchaseDraft => ({
  supplierId: "",
  locationId,
  expectedOn: "",
  notes: "",
  lines: [],
})

/** Purchase-unit factor, 1 when the item has no purchase unit. */
const factorOf = (line: Pick<DraftLine, "purchaseUnit" | "purchaseFactor">) =>
  line.purchaseUnit && line.purchaseFactor > 0 ? line.purchaseFactor : 1

export const entryUnit = (line: DraftLine) => (line.purchaseUnit && line.purchaseFactor > 0 ? line.purchaseUnit : line.unit)
export const usesPurchaseUnit = (line: DraftLine) => factorOf(line) !== 1 || entryUnit(line) !== line.unit
export const lineEntryQuantity = (line: DraftLine) => round(line.quantity / factorOf(line), 4)
export const lineEntryCost = (line: DraftLine) => round(line.unitCost * factorOf(line), 2)
export const lineTotal = (line: DraftLine) => round(line.quantity * line.unitCost, 2)
export const draftTotal = (draft: PurchaseDraft) => round(draft.lines.reduce((sum, line) => sum + lineTotal(line), 0), 2)

function lineFromItem(item: DraftItem, quantity?: number, unitCost?: number): DraftLine {
  const line: DraftLine = {
    key: nextKey(),
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    unit: item.unit,
    purchaseUnit: item.purchaseUnit,
    purchaseFactor: item.purchaseFactor,
    trackLots: item.trackLots,
    quantity: 0,
    unitCost: unitCost ?? item.cost,
  }
  line.quantity = quantity ?? factorOf(line)
  return line
}

const mapLine = (draft: PurchaseDraft, key: string, fn: (line: DraftLine) => DraftLine): PurchaseDraft => ({
  ...draft,
  lines: draft.lines.map((line) => (line.key === key ? fn(line) : line)),
})

export function purchaseDraftReducer(draft: PurchaseDraft, action: PurchaseDraftAction): PurchaseDraft {
  switch (action.type) {
    case "reset":
      return action.draft
    case "setField":
      return { ...draft, [action.field]: action.value }
    case "addItem": {
      const existing = draft.lines.find((line) => line.itemId === action.item.id)
      if (existing) {
        const added = action.quantity ?? factorOf(existing)
        return mapLine(draft, existing.key, (line) => ({ ...line, quantity: round(line.quantity + added, 3) }))
      }
      return { ...draft, lines: [...draft.lines, lineFromItem(action.item, action.quantity, action.unitCost)] }
    }
    case "setEntryQuantity":
      return mapLine(draft, action.key, (line) => ({ ...line, quantity: round(action.value * factorOf(line), 3) }))
    case "setEntryCost":
      return mapLine(draft, action.key, (line) => ({ ...line, unitCost: round(action.value / factorOf(line), 4) }))
    case "removeLine":
      return { ...draft, lines: draft.lines.filter((line) => line.key !== action.key) }
  }
}

export interface DraftErrors {
  supplierId?: string
  locationId?: string
  lines?: string
  lineErrors: Record<string, string>
}

export function validateDraft(draft: PurchaseDraft): DraftErrors {
  const errors: DraftErrors = { lineErrors: {} }
  if (!draft.supplierId) errors.supplierId = "Selecciona un proveedor"
  if (!draft.locationId) errors.locationId = "Selecciona la bodega de destino"
  if (draft.lines.length === 0) errors.lines = "Agrega al menos un artículo"
  for (const line of draft.lines) {
    if (!(line.quantity > 0)) errors.lineErrors[line.key] = "La cantidad debe ser mayor que cero"
    else if (!(line.unitCost >= 0)) errors.lineErrors[line.key] = "El costo no puede ser negativo"
  }
  return errors
}

export const hasDraftErrors = (errors: DraftErrors) =>
  Boolean(errors.supplierId || errors.locationId || errors.lines || Object.keys(errors.lineErrors).length > 0)

const toLineInput = (line: DraftLine): PurchaseOrderLineInput => ({
  itemId: line.itemId,
  quantity: line.quantity,
  unitCost: line.unitCost,
})

export function toCreateInput(draft: PurchaseDraft): CreatePurchaseOrderInput {
  return {
    supplierId: draft.supplierId,
    locationId: draft.locationId,
    expectedOn: draft.expectedOn || null,
    notes: draft.notes.trim() || null,
    lines: draft.lines.map(toLineInput),
  }
}

/** Editable draft of an existing order; item metadata (purchase unit) comes from the catalog. */
export function draftFromOrder(order: PurchaseOrder, items: readonly InventoryItem[]): PurchaseDraft {
  const byId = new Map(items.map((item) => [item.id, item]))
  return {
    supplierId: order.supplierId,
    locationId: order.locationId,
    expectedOn: order.expectedOn ?? "",
    notes: order.notes ?? "",
    lines: order.lines.map((l) => {
      const item = byId.get(l.itemId)
      return {
        key: nextKey(),
        lineId: l.id,
        itemId: l.itemId,
        itemName: l.itemName ?? item?.name ?? "",
        sku: l.sku ?? item?.sku ?? "",
        unit: l.unit ?? item?.unit ?? "",
        purchaseUnit: item?.purchaseUnit ?? null,
        purchaseFactor: item?.purchaseFactor ?? 1,
        trackLots: item?.trackLots ?? false,
        quantity: l.quantity,
        unitCost: l.unitCost,
      }
    }),
  }
}

/** Line mutations that turn `order` into `draft`. */
export function diffDraftLines(order: PurchaseOrder, draft: PurchaseDraft) {
  const original = new Map(order.lines.map((l) => [l.id, l]))
  const kept = new Set<string>()
  const add: PurchaseOrderLineInput[] = []
  const update: { lineId: string; quantity: number; unitCost: number }[] = []
  for (const line of draft.lines) {
    const before = line.lineId ? original.get(line.lineId) : undefined
    if (!before || !line.lineId) {
      add.push(toLineInput(line))
      continue
    }
    kept.add(line.lineId)
    if (before.quantity !== line.quantity || before.unitCost !== line.unitCost) {
      update.push({ lineId: line.lineId, quantity: line.quantity, unitCost: line.unitCost })
    }
  }
  const remove = order.lines.filter((l) => !kept.has(l.id)).map((l) => l.id)
  return { add, update, remove }
}
