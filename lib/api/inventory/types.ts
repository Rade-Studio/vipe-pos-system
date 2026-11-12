/**
 * Domain types of the inventory API (camelCase, T10). The objects the API
 * returns are the generated contract's DTOs; the request inputs keep the
 * shapes the screens build. Quantities are in the item's base unit (`unit`).
 * `Formula.unitCost` is the server cost per yield unit from the stored costs.
 */

import type { components } from "@/lib/api/schema"

type Schemas = components["schemas"]

export type { InventoryShortage } from "@/lib/inventory/errors"

export type ItemKind = Schemas["InventoryItem"]["kind"]

export type InventoryItem = Schemas["InventoryItem"]

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

/** Opening movement recorded with the new item, at the default location unless `locationId` is given. */
export interface OpeningStockInput {
  locationId?: string
  quantity: number
  /** null = the item's cost. */
  unitCost?: number | null
}

/** The item and its optional opening stock, created in one transaction. */
export interface CreateItemInput extends InventoryItemInput {
  openingStock?: OpeningStockInput
}

export interface CreatePreparationInput {
  name: string
  unit: string
  /** Not stored on the item: it is the formula's yield, passed to save_formula later. */
  yieldQuantity?: number
  categoryId?: string | null
}

export type InventoryCategory = Schemas["InventoryCategory"]

export type InventoryLocation = Schemas["InventoryLocation"]

export interface InventoryLocationInput {
  name: string
  code: string
  isDefault?: boolean
  isActive?: boolean
}

export type Supplier = Schemas["Supplier"]

export type SupplierInput = Omit<Supplier, "id" | "isActive"> & { isActive?: boolean }

export type Lot = Schemas["Lot"]

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

export type Movement = Schemas["Movement"]

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

export type MovementPage = Schemas["MovementPage"]

export type PurchaseOrderStatus = "draft" | "ordered" | "partially_received" | "received" | "cancelled"
export type PaymentStatus = "pending" | "paid"

export type PurchaseOrderLine = Schemas["PurchaseOrderLine"]

export type PurchaseOrder = Schemas["PurchaseOrder"]

export type TransferStatus = Schemas["InventoryTransfer"]["status"]

export type InventoryTransferLine = Schemas["InventoryTransferLine"]

export type InventoryTransfer = Schemas["InventoryTransfer"]

export interface TransferFilters {
  status?: TransferStatus[]
  /** Origin or destination. */
  locationId?: string
  /** YYYY-MM-DD, local days of the restaurant, inclusive. */
  from?: string
  to?: string
}

export interface TransferLineInput {
  itemId: string
  quantity: number
}

/** Header and full line set of a draft. */
export interface TransferInput {
  fromLocationId: string
  toLocationId: string
  notes?: string | null
  lines: TransferLineInput[]
}

export interface ReceiveTransferLineInput {
  lineId: string
  receivedQuantity: number
  /** Required when less than the requested quantity arrived. */
  shortfallReason?: string | null
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

/** A line to keep (`lineId`) or add (no `lineId`); lines left out are removed. */
export interface PurchaseOrderLineUpdate extends PurchaseOrderLineInput {
  lineId?: string
}

/** Header and full line set of a draft, saved in one transaction. */
export interface UpdatePurchaseOrderInput {
  supplierId: string
  locationId: string
  expectedOn?: string | null
  notes?: string | null
  lines: PurchaseOrderLineUpdate[]
}

export interface ReceiveLineInput {
  lineId: string
  quantity: number
  unitCost?: number
  lotCode?: string
  expiresOn?: string
}

export type CountStatus = "open" | "applied" | "cancelled"

export type CountLine = Schemas["CountLine"]

export type InventoryCount = Schemas["InventoryCount"]

export type InventoryCountDetail = Schemas["InventoryCountDetail"]

export type ProductionBatch = Schemas["ProductionBatch"]

export type FormulaTargetType = "dish" | "prep"

export type FormulaLine = Schemas["FormulaLine"]

export type Formula = Schemas["Formula"]

/** Every formula of the tenant, keyed by dish id and by prep item id. */
export type FormulaIndex = Schemas["FormulaIndex"]

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

export type AdjustStockResult = Schemas["AdjustStockResult"]

export interface TransferStockInput {
  itemId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  notes?: string | null
}

export type TransferStockResult = Schemas["TransferStockResult"]

export type SaveFormulaResult = Schemas["SaveFormulaResult"]

export type ReceivePurchaseResult = Schemas["ReceivePurchaseResult"]

export interface OpenCountInput {
  /** null = default location. */
  locationId?: string | null
  /** null = every active item. */
  itemIds?: string[] | null
  notes?: string | null
}

export type OpenCountResult = Schemas["OpenCountResult"]

export type ApplyCountResult = Schemas["ApplyCountResult"]

export interface ProducePreparationInput {
  itemId: string
  quantity: number
  locationId?: string | null
  lotCode?: string | null
  notes?: string | null
  /** Business date YYYY-MM-DD: today (default) or up to 7 days back. */
  producedOn?: string | null
  /** Staff profile responsible; omitted = the caller. */
  producedBy?: string | null
}

export type ProducePreparationResult = Schemas["ProducePreparationResult"]

export interface BulkProduceLine {
  itemId: string
  quantity: number
  lotCode?: string | null
}

/** A daily production report: every line or none (422 P0001 with the short lines). */
export interface BulkProduceInput {
  /** 1..100 lines, one per preparation. */
  lines: BulkProduceLine[]
  locationId?: string | null
  producedOn?: string | null
  producedBy?: string | null
  notes?: string | null
}

export type BulkProduceResult = Schemas["BulkProduceResult"]

/** One preparation that cannot be produced, with its short inputs at the combined demand of every line. */
export interface BulkProduceShortage {
  item_id: string
  name: string
  ingredients: { ingredient_id: string; name: string; unit: string; required: number; available: number; missing: number }[]
}

export interface BatchListOptions {
  itemId?: string
  limit?: number
  /** Inclusive bounds on producedOn, YYYY-MM-DD (at most 366 days apart). */
  from?: string
  to?: string
}

export type ProductionTemplateLine = Schemas["ProductionTemplateLine"]

export type ProductionTemplate = Schemas["ProductionTemplate"]

export interface ProductionTemplateInput {
  name: string
  lines: ProductionTemplateLine[]
}

export type ConsumeOrderStockResult = Schemas["ConsumeOrderStockResult"]

export type DishStockCheckItem = Schemas["DishStockCheckItem"]

export type DishStockCheckResult = Schemas["DishStockCheckResult"]

export type InventoryOverview = Schemas["InventoryOverview"]
