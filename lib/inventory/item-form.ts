/**
 * Item create/edit form model (odd/tasks/admin-dashboard-inventario.md, T7).
 * Values are kept as strings while editing; `toInput` builds the item patch,
 * which never carries stock or cost (those move through inventory_adjust).
 */

import type { InventoryItem, InventoryItemInput, ItemKind } from "@/lib/supabase/inventory/types"

export interface ItemFormValues {
  name: string
  kind: ItemKind
  categoryId: string | null
  unit: string
  sku: string
  barcode: string
  minStock: string
  maxStock: string
  defaultSupplierId: string | null
  purchaseUnit: string
  purchaseFactor: string
  trackLots: boolean
  shelfLifeDays: string
  isActive: boolean
  /** Create only: unit cost of the opening movement. */
  initialCost: string
  /** Create only: quantity of the opening movement at the default location. */
  initialStock: string
}

export type ItemFormErrors = Partial<Record<keyof ItemFormValues, string>>
export type ItemFormMode = "create" | "edit"

const SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/

export function emptyItemForm(): ItemFormValues {
  return {
    name: "",
    kind: "raw",
    categoryId: null,
    unit: "unidad",
    sku: "",
    barcode: "",
    minStock: "0",
    maxStock: "",
    defaultSupplierId: null,
    purchaseUnit: "",
    purchaseFactor: "1",
    trackLots: false,
    shelfLifeDays: "",
    isActive: true,
    initialCost: "",
    initialStock: "",
  }
}

const str = (value: number | null) => (value === null ? "" : String(value))

export function fromItem(item: InventoryItem): ItemFormValues {
  return {
    ...emptyItemForm(),
    name: item.name,
    kind: item.kind,
    categoryId: item.categoryId,
    unit: item.unit,
    sku: item.sku,
    barcode: item.barcode ?? "",
    minStock: str(item.minStock),
    maxStock: str(item.maxStock),
    defaultSupplierId: item.defaultSupplierId,
    purchaseUnit: item.purchaseUnit ?? "",
    purchaseFactor: str(item.purchaseFactor),
    trackLots: item.trackLots,
    shelfLifeDays: str(item.shelfLifeDays),
    isActive: item.isActive,
  }
}

/** `undefined` for blank, `NaN` for garbage; accepts a comma decimal separator. */
export function parseNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  return /^-?(\d+([.,]\d+)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN
}

const INVALID = "Ingresa un número válido"

function nonNegative(raw: string, negativeMessage: string): string | undefined {
  const value = parseNumber(raw)
  if (value === undefined) return undefined
  if (Number.isNaN(value)) return INVALID
  return value < 0 ? negativeMessage : undefined
}

export function validateItemForm(values: ItemFormValues, mode: ItemFormMode): ItemFormErrors {
  const errors: ItemFormErrors = {}
  if (!values.name.trim()) errors.name = "El nombre es obligatorio"
  if (!values.unit) errors.unit = "Selecciona una unidad"

  const sku = values.sku.trim().toUpperCase()
  if (sku && !SKU_RE.test(sku)) errors.sku = "SKU no válido: 2 a 32 caracteres, letras, números y guiones"

  const minError = nonNegative(values.minStock, "El mínimo no puede ser negativo")
  if (minError) errors.minStock = minError
  const maxError = nonNegative(values.maxStock, "El máximo no puede ser negativo")
  if (maxError) errors.maxStock = maxError
  else {
    const min = parseNumber(values.minStock) ?? 0
    const max = parseNumber(values.maxStock)
    if (!minError && max !== undefined && max < min) errors.maxStock = "El máximo debe ser mayor o igual al mínimo"
  }

  if (values.purchaseUnit) {
    const factor = parseNumber(values.purchaseFactor)
    if (factor === undefined || Number.isNaN(factor) || factor <= 0) errors.purchaseFactor = "El factor debe ser mayor que cero"
  }

  const days = parseNumber(values.shelfLifeDays)
  if (days !== undefined && (Number.isNaN(days) || !Number.isInteger(days) || days <= 0)) {
    errors.shelfLifeDays = "La vida útil debe ser un número entero de días mayor que cero"
  }

  if (mode === "create") {
    const stockError = nonNegative(values.initialStock, "El stock inicial no puede ser negativo")
    if (stockError) errors.initialStock = stockError
    const costError = nonNegative(values.initialCost, "El costo no puede ser negativo")
    if (costError) errors.initialCost = costError
  }
  return errors
}

export const hasErrors = (errors: ItemFormErrors) => Object.keys(errors).length > 0

const orNull = (raw: string) => raw.trim() || null

export function toInput(values: ItemFormValues): InventoryItemInput {
  const sku = values.sku.trim().toUpperCase()
  const factor = values.purchaseUnit ? parseNumber(values.purchaseFactor) ?? 1 : 1
  return {
    name: values.name.trim(),
    kind: values.kind,
    unit: values.unit,
    ...(sku ? { sku } : {}),
    barcode: orNull(values.barcode),
    categoryId: values.categoryId,
    minStock: parseNumber(values.minStock) ?? 0,
    maxStock: parseNumber(values.maxStock) ?? null,
    defaultSupplierId: values.defaultSupplierId,
    purchaseUnit: orNull(values.purchaseUnit),
    purchaseFactor: factor,
    trackLots: values.trackLots,
    shelfLifeDays: parseNumber(values.shelfLifeDays) ?? null,
    isActive: values.isActive,
  }
}

/** The opening movement to record after create, or null when there is no initial stock. */
export function toOpening(values: ItemFormValues): { quantity: number; unitCost: number | null } | null {
  const quantity = parseNumber(values.initialStock)
  if (quantity === undefined || Number.isNaN(quantity) || quantity <= 0) return null
  const cost = parseNumber(values.initialCost)
  return { quantity, unitCost: cost === undefined || Number.isNaN(cost) ? null : cost }
}

export function purchaseFactorHelper(values: ItemFormValues): string | null {
  if (!values.purchaseUnit) return null
  const factor = parseNumber(values.purchaseFactor)
  if (factor === undefined || Number.isNaN(factor) || factor <= 0) return null
  return `1 ${values.purchaseUnit} = ${factor} ${values.unit}`
}
