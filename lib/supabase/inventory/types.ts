/**
 * Domain types of the inventory data-access layer (camelCase). Every numeric
 * is a JS number: the services normalize PostgREST numerics, which may arrive
 * as strings. Quantities are in the item's base unit (`unit`).
 */

export type { InventoryShortage } from "@/lib/inventory/errors"

export type ItemKind = "raw" | "prep"

export interface InventoryItem {
  id: string
  sku: string
  name: string
  description: string | null
  kind: ItemKind
  unit: string
  barcode: string | null
  cost: number
  stock: number
  minStock: number
  maxStock: number | null
  purchaseUnit: string | null
  purchaseFactor: number
  defaultSupplierId: string | null
  trackLots: boolean
  shelfLifeDays: number | null
  isActive: boolean
  categoryId: string | null
  categoryName: string | null
}

/** Editable item fields. `stock` is never written here: it moves through the RPCs. */
export interface InventoryItemInput {
  name: string
  unit: string
  kind?: ItemKind
  /** Omit or null to let the server assign MP-0001 / PR-0001. */
  sku?: string | null
  description?: string | null
  barcode?: string | null
  minStock?: number
  maxStock?: number | null
  purchaseUnit?: string | null
  purchaseFactor?: number
  defaultSupplierId?: string | null
  trackLots?: boolean
  shelfLifeDays?: number | null
  isActive?: boolean
  categoryId?: string | null
}

export interface CreatePreparationInput {
  name: string
  unit: string
  /** Not stored on the item: it is the formula's yield, passed to save_formula later. */
  yieldQuantity?: number
  categoryId?: string | null
}

export interface InventoryCategory {
  id: string
  name: string
  description: string | null
}

export interface InventoryLocation {
  id: string
  name: string
  code: string
  isDefault: boolean
  isActive: boolean
}

export interface InventoryLocationInput {
  name: string
  code: string
  isDefault?: boolean
  isActive?: boolean
}

export interface Supplier {
  id: string
  name: string
  taxId: string | null
  contactName: string | null
  phone: string | null
  email: string | null
  leadTimeDays: number | null
  notes: string | null
  isActive: boolean
}

export type SupplierInput = Omit<Supplier, "id" | "isActive"> & { isActive?: boolean }

export interface Lot {
  id: string
  itemId: string
  locationId: string
  locationName: string | null
  lotCode: string | null
  expiresOn: string | null
  quantity: number
  unitCost: number
  receivedAt: string
}

export type MovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "production_consume"
  | "production_output"
  | "adjustment"
  | "waste"
  | "transfer_out"
  | "transfer_in"
  | "count_adjustment"

export interface Movement {
  id: string
  itemId: string
  itemName: string | null
  sku: string | null
  unit: string | null
  locationId: string
  locationName: string | null
  lotId: string | null
  movementType: MovementType
  quantity: number
  unitCost: number
  totalCost: number
  reason: string | null
  notes: string | null
  referenceType: string | null
  referenceId: string | null
  createdBy: string | null
  createdAt: string
}

export interface MovementFilters {
  itemId?: string
  locationId?: string
  types?: MovementType[]
  /** Inclusive dates (YYYY-MM-DD). */
  from?: string
  to?: string
  /** 1-based. */
  page?: number
  pageSize?: number
}

export interface MovementPage {
  rows: Movement[]
  total: number
}

export type PurchaseOrderStatus = "draft" | "ordered" | "partially_received" | "received" | "cancelled"
export type PaymentStatus = "pending" | "paid"

export interface PurchaseOrderLine {
  id: string
  itemId: string
  itemName: string | null
  sku: string | null
  unit: string | null
  quantity: number
  unitCost: number
  receivedQuantity: number
  pendingQuantity: number
  total: number
}

export interface PurchaseOrder {
  id: string
  number: number
  supplierId: string
  supplierName: string | null
  locationId: string
  locationName: string | null
  status: PurchaseOrderStatus
  expectedOn: string | null
  paymentStatus: PaymentStatus
  notes: string | null
  orderedAt: string | null
  receivedAt: string | null
  createdAt: string
  lines: PurchaseOrderLine[]
  total: number
}

export interface PurchaseOrderFilters {
  status?: PurchaseOrderStatus[]
  supplierId?: string
}

export interface PurchaseOrderLineInput {
  itemId: string
  quantity: number
  unitCost: number
}

export interface CreatePurchaseOrderInput {
  supplierId: string
  locationId: string
  expectedOn?: string | null
  notes?: string | null
  lines: PurchaseOrderLineInput[]
}

export interface ReceiveLineInput {
  lineId: string
  quantity: number
  unitCost?: number
  lotCode?: string
  expiresOn?: string
}

export type CountStatus = "open" | "applied" | "cancelled"

export interface CountLine {
  id: string
  itemId: string
  itemName: string | null
  sku: string | null
  unit: string | null
  expectedQuantity: number
  countedQuantity: number | null
  notes: string | null
}

export interface InventoryCount {
  id: string
  number: number
  locationId: string
  locationName: string | null
  status: CountStatus
  notes: string | null
  appliedAt: string | null
  createdAt: string
}

export interface InventoryCountDetail extends InventoryCount {
  lines: CountLine[]
}

export interface ProductionBatch {
  id: string
  itemId: string
  itemName: string | null
  unit: string | null
  locationId: string
  locationName: string | null
  lotId: string | null
  lotCode: string | null
  quantity: number
  unitCost: number
  totalCost: number
  expiresOn: string | null
  notes: string | null
  createdAt: string
}

export type FormulaTargetType = "dish" | "prep"

export interface FormulaLine {
  ingredientId: string
  quantity: number
}

export interface Formula {
  recipeId: string
  targetType: FormulaTargetType
  targetId: string
  yieldQuantity: number
  notes: string | null
  lines: FormulaLine[]
}

/** Every formula of the tenant, keyed by dish id and by prep item id. */
export interface FormulaIndex {
  byDish: Record<string, Formula>
  byPrep: Record<string, Formula>
}

export interface SaveFormulaInput {
  targetType: FormulaTargetType
  targetId: string
  yieldQuantity: number
  lines: FormulaLine[]
  notes?: string | null
}

// ---------------- RPC inputs / results ----------------

export type AdjustMovementType = "opening" | "adjustment" | "waste"

export interface AdjustStockInput {
  itemId: string
  locationId: string
  movementType: AdjustMovementType
  /** Signed for `adjustment`, positive otherwise. */
  quantity: number
  unitCost?: number | null
  reason?: string | null
  notes?: string | null
  lotId?: string | null
  lotCode?: string | null
  expiresOn?: string | null
}

export interface AdjustStockResult {
  itemId: string
  locationId: string
  movementType: AdjustMovementType
  quantity: number
  totalCost: number
  stock: number
}

export interface TransferStockInput {
  itemId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  notes?: string | null
}

export interface TransferStockResult {
  transferId: string
  itemId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  totalCost: number
}

export interface SaveFormulaResult {
  recipeId: string
  targetType: FormulaTargetType
  targetId: string
  yieldQuantity: number
  linesCount: number
  totalCost: number
  unitCost: number
}

export interface ReceivePurchaseResult {
  purchaseOrderId: string
  status: PurchaseOrderStatus
  receivedLines: number
  totalCost: number
}

export interface OpenCountInput {
  /** null = default location. */
  locationId?: string | null
  /** null = every active item. */
  itemIds?: string[] | null
  notes?: string | null
}

export interface OpenCountResult {
  countId: string
  number: number
  locationId: string
  status: CountStatus
  linesCount: number
}

export interface ApplyCountResult {
  countId: string
  status: CountStatus
  adjustedLines: number
  valueDelta: number
}

export interface ProducePreparationInput {
  itemId: string
  quantity: number
  locationId?: string | null
  lotCode?: string | null
  notes?: string | null
}

export interface ProducePreparationResult {
  batchId: string
  lotId: string
  lotCode: string
  itemId: string
  locationId: string
  quantity: number
  unitCost: number
  totalCost: number
  expiresOn: string | null
  consumed: Array<{ itemId: string; name: string; quantity: number; totalCost: number }>
}

export interface ConsumeOrderStockResult {
  orderId: string
  enabled: boolean
  consumedItems: number
  totalCost: number
  shortages: Array<{ itemId: string; name: string; unit: string; missing: number }>
}

export interface DishStockCheckItem {
  dishId: string
  quantity: number
}

export interface DishStockCheckResult {
  ok: boolean
  enabled: boolean
  shortages: Array<{ itemId: string; name: string; unit: string; required: number; available: number; missing: number }>
}

export interface InventoryOverview {
  days: number
  generatedAt: string
  kpis: {
    totalValue: number
    itemsCount: number
    activeItems: number
    lowStockCount: number
    outOfStockCount: number
    expiringSoonCount: number
    expiredCount: number
    wasteValue: number
    purchasesValue: number
    consumptionValue: number
    openPurchaseOrders: number
  }
  series: Array<{ date: string; inValue: number; outValue: number; wasteValue: number }>
  valueByCategory: Array<{ categoryId: string | null; categoryName: string | null; value: number }>
  topConsumed: Array<{ itemId: string; name: string; unit: string; quantity: number; value: number }>
}
