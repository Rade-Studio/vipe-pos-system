import { toIso } from '../common/validation';
import { numOrNull, req } from '../payments/payments.mappers';
import type {
  AdjustMovementType,
  AdjustStockResult,
  ApplyCountResult,
  ConsumeOrderStockResult,
  CountLine,
  CountStatus,
  DishStockCheckResult,
  Formula,
  InventoryCategory,
  InventoryCount,
  InventoryItem,
  InventoryLocation,
  InventoryOverview,
  Lot,
  Movement,
  MovementType,
  OpenCountResult,
  PaymentStatus,
  ProducePreparationResult,
  ProductionBatch,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  ReceivePurchaseResult,
  SaveFormulaResult,
  Supplier,
  TransferStockResult,
} from './inventory.dto';

type Json = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const time = (value: unknown) => toIso(text(value));
/** A nullable numeric the web read with `num` (null counts as 0), e.g. ingredients.cost. */
const zeroIfNull = (value: unknown) => (value === null || value === undefined ? 0 : req({ value }, 'value'));
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

/** Rounded to cents so float noise never reaches a total (purchases-service.ts). */
const money = (n: number) => Math.round(n * 100) / 100;

/** `to_jsonb(ingredients) || {category_name}`. */
export const toItem = (row: Json): InventoryItem => ({
  id: String(row.id),
  sku: String(row.sku),
  name: String(row.name),
  description: text(row.description),
  kind: row.kind === 'prep' ? 'prep' : 'raw',
  unit: String(row.unit),
  barcode: text(row.barcode),
  cost: zeroIfNull(row.cost),
  stock: req(row, 'stock'),
  minStock: req(row, 'min_stock'),
  maxStock: numOrNull(row.max_stock),
  purchaseUnit: text(row.purchase_unit),
  purchaseFactor: req(row, 'purchase_factor') || 1,
  defaultSupplierId: text(row.default_supplier_id),
  trackLots: row.track_lots === true,
  shelfLifeDays: numOrNull(row.shelf_life_days),
  isActive: row.is_active === true,
  categoryId: text(row.category_id),
  categoryName: text(row.category_name),
});

export const toCategory = (row: Json): InventoryCategory => ({
  id: String(row.id),
  name: String(row.name),
  description: text(row.description),
});

export const toLocation = (row: Json): InventoryLocation => ({
  id: String(row.id),
  name: String(row.name),
  code: String(row.code),
  isDefault: row.is_default === true,
  isActive: row.is_active === true,
});

export const toSupplier = (row: Json): Supplier => ({
  id: String(row.id),
  name: String(row.name),
  taxId: text(row.tax_id),
  contactName: text(row.contact_name),
  phone: text(row.phone),
  email: text(row.email),
  leadTimeDays: numOrNull(row.lead_time_days),
  notes: text(row.notes),
  isActive: row.is_active === true,
});

/** `to_jsonb(inventory_lots) || {location_name}`. */
export const toLot = (row: Json): Lot => ({
  id: String(row.id),
  itemId: String(row.ingredient_id),
  locationId: String(row.location_id),
  locationName: text(row.location_name),
  lotCode: text(row.lot_code),
  expiresOn: text(row.expires_on),
  quantity: req(row, 'quantity'),
  unitCost: req(row, 'unit_cost'),
  receivedAt: time(row.received_at)!,
});

/** `to_jsonb(inventory_movements) || {item_name, sku, unit, location_name}`. */
export const toMovement = (row: Json): Movement => ({
  id: String(row.id),
  itemId: String(row.ingredient_id),
  itemName: text(row.item_name),
  sku: text(row.sku),
  unit: text(row.unit),
  locationId: String(row.location_id),
  locationName: text(row.location_name),
  lotId: text(row.lot_id),
  movementType: row.movement_type as MovementType,
  quantity: req(row, 'quantity'),
  unitCost: req(row, 'unit_cost'),
  totalCost: req(row, 'total_cost'),
  reason: text(row.reason),
  notes: text(row.notes),
  referenceType: text(row.reference_type),
  referenceId: text(row.reference_id),
  createdBy: text(row.created_by),
  createdAt: time(row.created_at)!,
});

export const toAdjustResult = (row: Json): AdjustStockResult => ({
  itemId: String(row.ingredient_id),
  locationId: String(row.location_id),
  movementType: row.movement_type as AdjustMovementType,
  quantity: req(row, 'quantity'),
  totalCost: req(row, 'total_cost'),
  stock: req(row, 'stock'),
});

export const toTransferResult = (row: Json): TransferStockResult => ({
  transferId: String(row.transfer_id),
  itemId: String(row.ingredient_id),
  fromLocationId: String(row.from_location_id),
  toLocationId: String(row.to_location_id),
  quantity: req(row, 'quantity'),
  totalCost: req(row, 'total_cost'),
});

/** Totals and pendingQuantity computed exactly as purchases-service.ts mapLine did. */
const toPurchaseLine = (row: Json): PurchaseOrderLine => {
  const quantity = req(row, 'quantity');
  const unitCost = req(row, 'unit_cost');
  const receivedQuantity = req(row, 'received_quantity');
  return {
    id: String(row.id),
    itemId: String(row.ingredient_id),
    itemName: text(row.item_name),
    sku: text(row.sku),
    unit: text(row.unit),
    quantity,
    unitCost,
    receivedQuantity,
    pendingQuantity: Math.max(0, Math.round((quantity - receivedQuantity) * 1000) / 1000),
    total: money(quantity * unitCost),
  };
};

/** `to_jsonb(purchase_orders) || {supplier_name, location_name, lines}`. */
export const toPurchaseOrder = (row: Json): PurchaseOrder => {
  const lines = list(row.lines).map(toPurchaseLine);
  return {
    id: String(row.id),
    number: req(row, 'number'),
    supplierId: String(row.supplier_id),
    supplierName: text(row.supplier_name),
    locationId: String(row.location_id),
    locationName: text(row.location_name),
    status: row.status as PurchaseOrderStatus,
    expectedOn: text(row.expected_on),
    paymentStatus: row.payment_status as PaymentStatus,
    notes: text(row.notes),
    orderedAt: time(row.ordered_at),
    receivedAt: time(row.received_at),
    createdAt: time(row.created_at)!,
    lines,
    total: money(lines.reduce((sum, line) => sum + line.total, 0)),
  };
};

export const toReceiveResult = (row: Json): ReceivePurchaseResult => ({
  purchaseOrderId: String(row.purchase_order_id),
  status: row.status as PurchaseOrderStatus,
  receivedLines: req(row, 'received_lines'),
  totalCost: req(row, 'total_cost'),
});

/** `to_jsonb(production_batches) || {item_name, unit, location_name, lot_code}`. */
export const toBatch = (row: Json): ProductionBatch => ({
  id: String(row.id),
  itemId: String(row.ingredient_id),
  itemName: text(row.item_name),
  unit: text(row.unit),
  locationId: String(row.location_id),
  locationName: text(row.location_name),
  lotId: text(row.lot_id),
  lotCode: text(row.lot_code),
  quantity: req(row, 'quantity'),
  unitCost: req(row, 'unit_cost'),
  totalCost: req(row, 'total_cost'),
  expiresOn: text(row.expires_on),
  notes: text(row.notes),
  createdAt: time(row.created_at)!,
});

export const toProduceResult = (row: Json): ProducePreparationResult => ({
  batchId: String(row.batch_id),
  lotId: String(row.lot_id),
  lotCode: String(row.lot_code),
  itemId: String(row.ingredient_id),
  locationId: String(row.location_id),
  quantity: req(row, 'quantity'),
  unitCost: req(row, 'unit_cost'),
  totalCost: req(row, 'total_cost'),
  expiresOn: text(row.expires_on),
  consumed: list(row.consumed).map((c) => ({
    itemId: String(c.ingredient_id),
    name: String(c.name),
    quantity: req(c, 'quantity'),
    totalCost: req(c, 'total_cost'),
  })),
});

/** `to_jsonb(inventory_counts) || {location_name}`. */
export const toCount = (row: Json): InventoryCount => ({
  id: String(row.id),
  number: req(row, 'number'),
  locationId: String(row.location_id),
  locationName: text(row.location_name),
  status: row.status as CountStatus,
  notes: text(row.notes),
  appliedAt: time(row.applied_at),
  createdAt: time(row.created_at)!,
});

/** `to_jsonb(inventory_count_lines) || {item_name, sku, unit}`. */
export const toCountLine = (row: Json): CountLine => ({
  id: String(row.id),
  itemId: String(row.ingredient_id),
  itemName: text(row.item_name),
  sku: text(row.sku),
  unit: text(row.unit),
  expectedQuantity: req(row, 'expected_quantity'),
  countedQuantity: numOrNull(row.counted_quantity),
  notes: text(row.notes),
});

export const toOpenCountResult = (row: Json): OpenCountResult => ({
  countId: String(row.count_id),
  number: req(row, 'number'),
  locationId: String(row.location_id),
  status: row.status as CountStatus,
  linesCount: req(row, 'lines_count'),
});

export const toApplyCountResult = (row: Json): ApplyCountResult => ({
  countId: String(row.count_id),
  status: row.status as CountStatus,
  adjustedLines: req(row, 'adjusted_lines'),
  valueDelta: req(row, 'value_delta'),
});

/** `{id, dish_id, ingredient_id, yield_quantity, notes, lines, unit_cost}` of one recipe. */
export const toFormula = (row: Json): Formula => ({
  recipeId: String(row.id),
  targetType: row.dish_id ? 'dish' : 'prep',
  targetId: String(row.dish_id ?? row.ingredient_id),
  yieldQuantity: req(row, 'yield_quantity') || 1,
  notes: text(row.notes),
  lines: list(row.lines).map((line) => ({ ingredientId: String(line.ingredient_id), quantity: req(line, 'quantity') })),
  unitCost: req(row, 'unit_cost'),
});

export const toSaveFormulaResult = (row: Json): SaveFormulaResult => ({
  recipeId: String(row.recipe_id),
  targetType: row.target_type as SaveFormulaResult['targetType'],
  targetId: String(row.target_id),
  yieldQuantity: req(row, 'yield_quantity'),
  linesCount: req(row, 'lines_count'),
  totalCost: req(row, 'total_cost'),
  unitCost: req(row, 'unit_cost'),
});

export function toOverview(row: Json): InventoryOverview {
  const k = (row.kpis ?? {}) as Json;
  return {
    days: req(row, 'days'),
    generatedAt: time(row.generated_at)!,
    kpis: {
      totalValue: req(k, 'total_value'),
      itemsCount: req(k, 'items_count'),
      activeItems: req(k, 'active_items'),
      lowStockCount: req(k, 'low_stock_count'),
      outOfStockCount: req(k, 'out_of_stock_count'),
      expiringSoonCount: req(k, 'expiring_soon_count'),
      expiredCount: req(k, 'expired_count'),
      wasteValue: req(k, 'waste_value'),
      purchasesValue: req(k, 'purchases_value'),
      consumptionValue: req(k, 'consumption_value'),
      openPurchaseOrders: req(k, 'open_purchase_orders'),
    },
    series: list(row.series).map((s) => ({
      date: String(s.date),
      inValue: req(s, 'in_value'),
      outValue: req(s, 'out_value'),
      wasteValue: req(s, 'waste_value'),
    })),
    valueByCategory: list(row.value_by_category).map((c) => ({
      categoryId: text(c.category_id),
      categoryName: text(c.category_name),
      value: req(c, 'value'),
    })),
    topConsumed: list(row.top_consumed).map((t) => ({
      itemId: String(t.ingredient_id),
      name: String(t.name),
      unit: String(t.unit),
      quantity: req(t, 'quantity'),
      value: req(t, 'value'),
    })),
  };
}

export const toCheckStockResult = (row: Json): DishStockCheckResult => ({
  ok: row.ok === true,
  enabled: row.enabled === true,
  shortages: list(row.shortages).map((s) => ({
    itemId: String(s.ingredient_id),
    name: String(s.name),
    unit: String(s.unit),
    required: req(s, 'required'),
    available: req(s, 'available'),
    missing: req(s, 'missing'),
  })),
});

export const toConsumeResult = (row: Json): ConsumeOrderStockResult => ({
  orderId: String(row.order_id),
  enabled: row.enabled === true,
  consumedItems: req(row, 'consumed_items'),
  totalCost: req(row, 'total_cost'),
  shortages: list(row.shortages).map((s) => ({
    itemId: String(s.ingredient_id),
    name: String(s.name),
    unit: String(s.unit),
    missing: req(s, 'missing'),
  })),
});
