import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery, csvOf, dateQuery } from '../common/validation';

/**
 * Request schemas and response classes of /inventory. Every response class
 * mirrors, field by field, the type of the same name in the web's
 * `lib/supabase/inventory/types.ts` (quantities in the item's base unit).
 */

export const ITEM_KINDS = ['raw', 'prep'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const MOVEMENT_TYPES = [
  'opening', 'purchase', 'sale', 'production_consume', 'production_output', 'adjustment', 'waste', 'transfer_out',
  'transfer_in', 'count_adjustment',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const ADJUST_MOVEMENT_TYPES = ['opening', 'adjustment', 'waste'] as const;
export type AdjustMovementType = (typeof ADJUST_MOVEMENT_TYPES)[number];
export const PURCHASE_ORDER_STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export const PAYMENT_STATUSES = ['pending', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const COUNT_STATUSES = ['open', 'applied', 'cancelled'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export const TRANSFER_STATUSES = ['draft', 'in_transit', 'received', 'received_short', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const FORMULA_TARGET_TYPES = ['dish', 'prep'] as const;
export type FormulaTargetType = (typeof FORMULA_TARGET_TYPES)[number];

/** Movements page size when `pageSize` is omitted (the web's DEFAULT_MOVEMENTS_PAGE_SIZE). */
export const DEFAULT_MOVEMENTS_PAGE_SIZE = 50;
/** check_dishes_stock accepts at most 100 lines of 1..999 units. */
const MAX_STOCK_CHECK_ITEMS = 100;
const MAX_AVAILABILITY_DISHES = 500;
const MAX_DOCUMENT_LINES = 200;

const quantity = z.number().finite();
const positive = quantity.positive();
const money = z.number().finite().min(0);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const date = dateQuery;
/** `?page=2`: a positive integer. */
const intQuery = z.string().regex(/^\d+$/, 'Expected a positive integer').transform(Number);
/** A date (YYYY-MM-DD) or an ISO date-time, as the web passes them. */
const dateOrTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?)?$/,
    'Expected YYYY-MM-DD or an ISO date-time',
  )
  .refine((value) => dateQuery.safeParse(value.slice(0, 10)).success, 'Invalid date');

// ---- Items and categories ------------------------------------------------------

const itemFields = {
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(20),
  kind: z.enum(ITEM_KINDS).optional(),
  sku: nullableText(40),
  description: nullableText(2000),
  barcode: nullableText(100),
  minStock: quantity.min(0).optional(),
  maxStock: quantity.min(0).nullable().optional(),
  purchaseUnit: nullableText(20),
  purchaseFactor: positive.optional(),
  defaultSupplierId: z.guid().nullable().optional(),
  trackLots: z.boolean().optional(),
  shelfLifeDays: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
  categoryId: z.guid().nullable().optional(),
};

export const createItemSchema = z.strictObject({
  ...itemFields,
  /** inventory_adjust(opening) in the same transaction; no locationId = default location. */
  openingStock: z
    .strictObject({ locationId: z.guid().optional(), quantity: positive, unitCost: money.nullable().optional() })
    .optional(),
});

export const updateItemSchema = z.strictObject({
  ...itemFields,
  name: itemFields.name.optional(),
  unit: itemFields.unit.optional(),
});

export const createPreparationSchema = z.strictObject({
  name: itemFields.name,
  unit: itemFields.unit,
  /** Not stored on the item: the caller passes it to save_formula later. */
  yieldQuantity: positive.optional(),
  categoryId: z.guid().nullable().optional(),
});

export const itemListQuerySchema = z.strictObject({
  kind: z.enum(ITEM_KINDS).optional(),
  includeInactive: booleanQuery.optional(),
});

export const createCategorySchema = z.strictObject({ name: z.string().trim().min(1).max(100), description: nullableText(2000) });
export const updateCategorySchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: nullableText(2000),
});

export class InventoryItem {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ITEM_KINDS }) kind!: ItemKind;
  @ApiProperty() unit!: string;
  @ApiProperty({ type: String, nullable: true }) barcode!: string | null;
  @ApiProperty() cost!: number;
  @ApiProperty() stock!: number;
  @ApiProperty() minStock!: number;
  @ApiProperty({ type: Number, nullable: true }) maxStock!: number | null;
  @ApiProperty({ type: String, nullable: true }) purchaseUnit!: string | null;
  @ApiProperty() purchaseFactor!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) defaultSupplierId!: string | null;
  @ApiProperty() trackLots!: boolean;
  @ApiProperty({ type: Number, nullable: true }) shelfLifeDays!: number | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true }) categoryName!: string | null;
}

export class OpeningStockInput {
  @ApiPropertyOptional({ format: 'uuid', description: 'Omitted = the default location.' }) locationId?: string;
  @ApiProperty({ description: 'Greater than 0.' }) quantity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, description: 'Omitted or null = the item cost (no average-cost update).' })
  unitCost?: number | null;
}

export class InventoryItemInput {
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiPropertyOptional({ enum: ITEM_KINDS }) kind?: ItemKind;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Omit or null to let the server assign MP-0001 / PR-0001.' })
  sku?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) barcode?: string | null;
  @ApiPropertyOptional() minStock?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxStock?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) purchaseUnit?: string | null;
  @ApiPropertyOptional() purchaseFactor?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) defaultSupplierId?: string | null;
  @ApiPropertyOptional() trackLots?: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) shelfLifeDays?: number | null;
  @ApiPropertyOptional() isActive?: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
}

export class CreateItemRequest extends InventoryItemInput {
  @ApiPropertyOptional({ type: OpeningStockInput, description: 'inventory_adjust(opening) in the same transaction as the insert.' })
  openingStock?: OpeningStockInput;
}

export class UpdateItemRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() unit?: string;
  @ApiPropertyOptional({ enum: ITEM_KINDS }) kind?: ItemKind;
  @ApiPropertyOptional({ type: String, nullable: true }) sku?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) barcode?: string | null;
  @ApiPropertyOptional() minStock?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) maxStock?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) purchaseUnit?: string | null;
  @ApiPropertyOptional() purchaseFactor?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) defaultSupplierId?: string | null;
  @ApiPropertyOptional() trackLots?: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) shelfLifeDays?: number | null;
  @ApiPropertyOptional() isActive?: boolean;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
}

export class CreatePreparationInput {
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiPropertyOptional({ description: 'Not stored on the item: it is the formula yield, passed to save_formula later.' })
  yieldQuantity?: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) categoryId?: string | null;
}

export class InventoryCategory {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
}

export class CreateInventoryCategoryRequest {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
}

export class UpdateInventoryCategoryRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description?: string | null;
}

// ---- Locations and suppliers ---------------------------------------------------

export const createLocationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const updateLocationSchema = createLocationSchema.partial();

const supplierFields = {
  name: z.string().trim().min(1).max(200),
  taxId: nullableText(50),
  contactName: nullableText(200),
  phone: nullableText(50),
  email: nullableText(200),
  leadTimeDays: z.number().int().min(0).nullable().optional(),
  notes: nullableText(2000),
  isActive: z.boolean().optional(),
};
export const createSupplierSchema = z.strictObject(supplierFields);
export const updateSupplierSchema = z.strictObject({ ...supplierFields, name: supplierFields.name.optional() });

export class InventoryLocation {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() isActive!: boolean;
}

export class InventoryLocationInput {
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Trimmed and upper-cased; unique per restaurant.' }) code!: string;
  @ApiPropertyOptional() isDefault?: boolean;
  @ApiPropertyOptional() isActive?: boolean;
}

export class UpdateInventoryLocationRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() code?: string;
  @ApiPropertyOptional() isDefault?: boolean;
  @ApiPropertyOptional() isActive?: boolean;
}

export class Supplier {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) taxId!: string | null;
  @ApiProperty({ type: String, nullable: true }) contactName!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: Number, nullable: true }) leadTimeDays!: number | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class SupplierInput {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) taxId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) contactName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) leadTimeDays?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiPropertyOptional() isActive?: boolean;
}

export class UpdateSupplierRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) taxId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) contactName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) leadTimeDays?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiPropertyOptional() isActive?: boolean;
}

// ---- Stock: lots, movements, adjust, transfer ------------------------------------

export const movementListQuerySchema = z.strictObject({
  itemId: z.guid().optional(),
  locationId: z.guid().optional(),
  types: csvOf(MOVEMENT_TYPES).optional(),
  from: dateOrTime.optional(),
  to: dateOrTime.optional(),
  page: intQuery.pipe(z.number().int().min(1)).optional(),
  pageSize: intQuery.pipe(z.number().int().min(1).max(500)).optional(),
});

export const adjustStockSchema = z.strictObject({
  itemId: z.guid(),
  locationId: z.guid(),
  movementType: z.enum(ADJUST_MOVEMENT_TYPES),
  quantity,
  unitCost: money.nullable().optional(),
  reason: nullableText(200),
  notes: nullableText(2000),
  lotId: z.guid().nullable().optional(),
  lotCode: nullableText(100),
  expiresOn: date.nullable().optional(),
});

export const transferStockSchema = z.strictObject({
  itemId: z.guid(),
  fromLocationId: z.guid(),
  toLocationId: z.guid(),
  quantity: positive,
  notes: nullableText(2000),
});

export class Lot {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) locationName!: string | null;
  @ApiProperty({ type: String, nullable: true }) lotCode!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) expiresOn!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitCost!: number;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
}

export class Movement {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, nullable: true }) itemName!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) locationName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) lotId!: string | null;
  @ApiProperty({ enum: MOVEMENT_TYPES }) movementType!: MovementType;
  @ApiProperty({ description: 'Signed.' }) quantity!: number;
  @ApiProperty() unitCost!: number;
  @ApiProperty() totalCost!: number;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, nullable: true }) referenceType!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) referenceId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) createdBy!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MovementPage {
  @ApiProperty({ type: [Movement], description: 'Newest first.' }) rows!: Movement[];
  @ApiProperty({ description: 'Exact count for the filters.' }) total!: number;
}

export class AdjustStockInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ enum: ADJUST_MOVEMENT_TYPES }) movementType!: AdjustMovementType;
  @ApiProperty({ description: 'Signed for adjustment, positive otherwise.' }) quantity!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) unitCost?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reason?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) lotId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) lotCode?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) expiresOn?: string | null;
}

export class AdjustStockResult {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ enum: ADJUST_MOVEMENT_TYPES }) movementType!: AdjustMovementType;
  @ApiProperty({ description: 'Signed.' }) quantity!: number;
  @ApiProperty({ description: 'Signed.' }) totalCost!: number;
  @ApiProperty() stock!: number;
}

export class TransferStockInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) fromLocationId!: string;
  @ApiProperty({ format: 'uuid' }) toLocationId!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
}

export class TransferStockResult {
  @ApiProperty({ format: 'uuid' }) transferId!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) fromLocationId!: string;
  @ApiProperty({ format: 'uuid' }) toLocationId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() totalCost!: number;
}

// ---- Purchase orders -------------------------------------------------------------

const purchaseLineSchema = z.strictObject({ itemId: z.guid(), quantity: positive, unitCost: money });

export const createPurchaseOrderSchema = z.strictObject({
  supplierId: z.guid(),
  locationId: z.guid(),
  expectedOn: date.nullable().optional(),
  notes: nullableText(2000),
  lines: z.array(purchaseLineSchema).max(MAX_DOCUMENT_LINES),
});

/** The full order: lines with `lineId` are kept (updated when changed), lines without are added, the rest removed. */
export const updatePurchaseOrderSchema = z.strictObject({
  ...createPurchaseOrderSchema.shape,
  lines: z.array(purchaseLineSchema.extend({ lineId: z.guid().optional() })).max(MAX_DOCUMENT_LINES),
});

export const purchaseOrderListQuerySchema = z.strictObject({
  status: csvOf(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: z.guid().optional(),
});

export const purchaseOrderStatusSchema = z.strictObject({ status: z.enum(['ordered', 'cancelled']) });
export const paymentStatusSchema = z.strictObject({ paymentStatus: z.enum(PAYMENT_STATUSES) });

export const receivePurchaseOrderSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        lineId: z.guid(),
        quantity: positive,
        unitCost: money.optional(),
        lotCode: text(100).optional(),
        expiresOn: date.optional(),
      }),
    )
    .min(1)
    .max(MAX_DOCUMENT_LINES),
  /** Applied after the receipt, in the same transaction. */
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});

export class PurchaseOrderLine {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, nullable: true }) itemName!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitCost!: number;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty({ description: 'max(0, quantity - receivedQuantity), 3 decimals.' }) pendingQuantity!: number;
  @ApiProperty({ description: 'quantity x unitCost rounded to cents.' }) total!: number;
}

export class PurchaseOrder {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ format: 'uuid' }) supplierId!: string;
  @ApiProperty({ type: String, nullable: true }) supplierName!: string | null;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) locationName!: string | null;
  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES }) status!: PurchaseOrderStatus;
  @ApiProperty({ type: String, format: 'date', nullable: true }) expectedOn!: string | null;
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus!: PaymentStatus;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) orderedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) receivedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [PurchaseOrderLine] }) lines!: PurchaseOrderLine[];
  @ApiProperty({ description: 'Sum of the line totals, rounded to cents.' }) total!: number;
}

export class PurchaseOrderLineInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitCost!: number;
}

export class CreatePurchaseOrderInput {
  @ApiProperty({ format: 'uuid' }) supplierId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) expectedOn?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiProperty({ type: [PurchaseOrderLineInput] }) lines!: PurchaseOrderLineInput[];
}

export class PurchaseOrderLineUpdate extends PurchaseOrderLineInput {
  @ApiPropertyOptional({ format: 'uuid', description: 'An existing line of this order; omitted = a new line.' }) lineId?: string;
}

export class UpdatePurchaseOrderRequest {
  @ApiProperty({ format: 'uuid' }) supplierId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) expectedOn?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiProperty({ type: [PurchaseOrderLineUpdate], description: 'The final set of lines; missing existing lines are removed.' })
  lines!: PurchaseOrderLineUpdate[];
}

export class PurchaseOrderStatusRequest {
  @ApiProperty({ enum: ['ordered', 'cancelled'] }) status!: 'ordered' | 'cancelled';
}

export class PaymentStatusRequest {
  @ApiProperty({ enum: PAYMENT_STATUSES }) paymentStatus!: PaymentStatus;
}

export class ReceiveLineInput {
  @ApiProperty({ format: 'uuid' }) lineId!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ description: 'Omitted = the line cost.' }) unitCost?: number;
  @ApiPropertyOptional() lotCode?: string;
  @ApiPropertyOptional({ format: 'date' }) expiresOn?: string;
}

export class ReceivePurchaseOrderRequest {
  @ApiProperty({ type: [ReceiveLineInput] }) lines!: ReceiveLineInput[];
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES, description: 'Set after the receipt in the same transaction.' })
  paymentStatus?: PaymentStatus;
}

export class ReceivePurchaseResult {
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty({ enum: PURCHASE_ORDER_STATUSES }) status!: PurchaseOrderStatus;
  @ApiProperty() receivedLines!: number;
  @ApiProperty() totalCost!: number;
}

// ---- Transfers -------------------------------------------------------------------

const transferLineSchema = z.strictObject({ itemId: z.guid(), quantity: positive });

/** Create and full-draft save: the final header and lines. */
export const transferSchema = z
  .strictObject({
    fromLocationId: z.guid(),
    toLocationId: z.guid(),
    notes: nullableText(2000),
    lines: z.array(transferLineSchema).min(1).max(MAX_DOCUMENT_LINES),
  })
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    message: 'Origin and destination must be two different locations',
    path: ['toLocationId'],
  })
  .refine((value) => new Set(value.lines.map((line) => line.itemId)).size === value.lines.length, {
    message: 'Each item appears once per transfer',
    path: ['lines'],
  });

export const transferListQuerySchema = z.strictObject({
  status: csvOf(TRANSFER_STATUSES).optional(),
  /** Origin or destination. */
  locationId: z.guid().optional(),
  from: date.optional(),
  to: date.optional(),
});

export const receiveTransferSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        lineId: z.guid(),
        receivedQuantity: quantity.min(0),
        shortfallReason: nullableText(200),
      }),
    )
    .min(1)
    .max(MAX_DOCUMENT_LINES),
});

export class InventoryTransferLine {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, nullable: true }) itemName!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ description: 'Sent as is.' }) requestedQuantity!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null until received.' }) receivedQuantity!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'requested - received, written off as merma en tránsito; null until received.' })
  shortfallQuantity!: number | null;
  @ApiProperty({ type: String, nullable: true }) shortfallReason!: string | null;
}

export class InventoryTransfer {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ enum: TRANSFER_STATUSES }) status!: TransferStatus;
  @ApiProperty({ format: 'uuid' }) fromLocationId!: string;
  @ApiProperty({ type: String, nullable: true }) fromLocationName!: string | null;
  @ApiProperty({ format: 'uuid' }) toLocationId!: string;
  @ApiProperty({ type: String, nullable: true }) toLocationName!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) createdBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) createdByName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) sentBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) sentByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) receivedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) receivedByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) receivedAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) cancelledBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelledByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [InventoryTransferLine], description: 'By item name.' }) lines!: InventoryTransferLine[];
}

export class TransferLineInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ description: '> 0, at most the positive stock of the origin.' }) quantity!: number;
}

export class TransferInput {
  @ApiProperty({ format: 'uuid' }) fromLocationId!: string;
  @ApiProperty({ format: 'uuid', description: 'Another active location of the restaurant.' }) toLocationId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiProperty({ type: [TransferLineInput], description: '1..200, one per item.' }) lines!: TransferLineInput[];
}

export class ReceiveTransferLineInput {
  @ApiProperty({ format: 'uuid' }) lineId!: string;
  @ApiProperty({ description: '0..requestedQuantity.' }) receivedQuantity!: number;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Required when receivedQuantity < requestedQuantity.' })
  shortfallReason?: string | null;
}

export class ReceiveTransferRequest {
  @ApiProperty({ type: [ReceiveTransferLineInput], description: 'Every line of the transfer, once.' })
  lines!: ReceiveTransferLineInput[];
}

// ---- Production ------------------------------------------------------------------

/** A from/to range on production_batches.produced_on spans at most this many days. */
export const MAX_BATCH_RANGE_DAYS = 366;
/** produce_preparations accepts at most 100 lines; a template holds as many. */
const MAX_PRODUCTION_LINES = 100;
const DAY_MS = 86_400_000;

export const batchListQuerySchema = z
  .strictObject({
    itemId: z.guid().optional(),
    limit: intQuery.pipe(z.number().int().min(1).max(500)).optional(),
    /** Inclusive bounds on produced_on (YYYY-MM-DD). */
    from: date.optional(),
    to: date.optional(),
  })
  .superRefine((query, ctx) => {
    if (!query.from || !query.to) return;
    const days = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS;
    if (days < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
    else if (days >= MAX_BATCH_RANGE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `The range spans at most ${MAX_BATCH_RANGE_DAYS} days` });
    }
  });

/** Business date and responsible person; the RPC checks today..7 days back and an active staff profile. */
const productionContext = {
  producedOn: date.nullable().optional(),
  producedBy: z.guid().nullable().optional(),
};

export const producePreparationSchema = z.strictObject({
  itemId: z.guid(),
  quantity: positive,
  locationId: z.guid().nullable().optional(),
  lotCode: nullableText(100),
  notes: nullableText(2000),
  ...productionContext,
});

const uniqueItems = (lines: { itemId: string }[]) => new Set(lines.map((line) => line.itemId)).size === lines.length;

export const bulkProduceSchema = z.strictObject({
  lines: z
    .array(z.strictObject({ itemId: z.guid(), quantity: positive, lotCode: nullableText(100) }))
    .min(1)
    .max(MAX_PRODUCTION_LINES)
    .refine(uniqueItems, 'Each itemId may appear once'),
  locationId: z.guid().nullable().optional(),
  notes: nullableText(2000),
  ...productionContext,
});

const templateLines = z
  .array(z.strictObject({ itemId: z.guid(), quantity: positive }))
  .min(1)
  .max(MAX_PRODUCTION_LINES)
  .refine(uniqueItems, 'Each itemId may appear once');

export const createProductionTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  lines: templateLines,
});

export const updateProductionTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  lines: templateLines.optional(),
});

export class StaffRef {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class ProductionBatch {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, nullable: true }) itemName!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) locationName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) lotId!: string | null;
  @ApiProperty({ type: String, nullable: true }) lotCode!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitCost!: number;
  @ApiProperty() totalCost!: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) expiresOn!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ format: 'date', description: 'Business date of the production.' }) producedOn!: string;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'Responsible staff member; null once the profile is deleted.' })
  producedBy!: StaffRef | null;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'Who registered it.' }) createdBy!: StaffRef | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ProducePreparationInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Omitted = the default location.' })
  locationId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Omitted = PB-YYYYMMDD-HH24MISS.' }) lotCode?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
  @ApiPropertyOptional({
    type: String, format: 'date', nullable: true,
    description: 'Business date (YYYY-MM-DD): today (default, restaurant timezone) or up to 7 days back. Drives expiresOn and the lot code.',
  })
  producedOn?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Active staff profile; omitted = the caller.' })
  producedBy?: string | null;
}

export class ConsumedInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() totalCost!: number;
}

export class ProducePreparationResult {
  @ApiProperty({ format: 'uuid' }) batchId!: string;
  @ApiProperty({ format: 'uuid' }) lotId!: string;
  @ApiProperty() lotCode!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitCost!: number;
  @ApiProperty() totalCost!: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) expiresOn!: string | null;
  @ApiProperty({ type: [ConsumedInput] }) consumed!: ConsumedInput[];
}

export class BulkProduceLineInput {
  @ApiProperty({ format: 'uuid', description: 'Unique within the request.' }) itemId!: string;
  @ApiProperty({ description: 'Greater than 0.' }) quantity!: number;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Omitted = PB-<producedOn YYYYMMDD>-HH24MISS.' })
  lotCode?: string | null;
}

export class BulkProduceInput {
  @ApiProperty({ type: [BulkProduceLineInput], description: '1..100 lines.' }) lines!: BulkProduceLineInput[];
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Omitted = the default location.' })
  locationId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, description: 'Today (default) or up to 7 days back.' })
  producedOn?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Active staff profile; omitted = the caller.' })
  producedBy?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
}

export class BulkProduceResult {
  @ApiProperty({ type: [ProducePreparationResult], description: 'One per line, in request order.' })
  batches!: ProducePreparationResult[];
  @ApiProperty() totalCost!: number;
}

export class ProductionTemplateLine {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() quantity!: number;
}

export class ProductionTemplate {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [ProductionTemplateLine] }) lines!: ProductionTemplateLine[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ProductionTemplateInput {
  @ApiProperty({ description: 'Trimmed, 1..80, unique per restaurant ignoring case (409).' }) name!: string;
  @ApiProperty({ type: [ProductionTemplateLine], description: '1..100 active preparations of the restaurant (422 otherwise), unique itemId.' })
  lines!: ProductionTemplateLine[];
}

export class UpdateProductionTemplateRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ type: [ProductionTemplateLine] }) lines?: ProductionTemplateLine[];
}

// ---- Counts ----------------------------------------------------------------------

export const openCountSchema = z.strictObject({
  locationId: z.guid().nullable().optional(),
  itemIds: z.array(z.guid()).max(5000).nullable().optional(),
  notes: nullableText(2000),
});

export const countLineSchema = z.strictObject({ countedQuantity: quantity.min(0).nullable() });

export class InventoryCount {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ type: String, nullable: true }) locationName!: string | null;
  @ApiProperty({ enum: COUNT_STATUSES }) status!: CountStatus;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) appliedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CountLine {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, nullable: true }) itemName!: string | null;
  @ApiProperty({ type: String, nullable: true }) sku!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty() expectedQuantity!: number;
  @ApiProperty({ type: Number, nullable: true }) countedQuantity!: number | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
}

export class InventoryCountDetail extends InventoryCount {
  @ApiProperty({ type: [CountLine], description: 'By item name (es).' }) lines!: CountLine[];
}

export class OpenCountInput {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'null = default location.' })
  locationId?: string | null;
  @ApiPropertyOptional({ type: [String], nullable: true, description: 'null = every active item.' }) itemIds?: string[] | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
}

export class OpenCountResult {
  @ApiProperty({ format: 'uuid' }) countId!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty({ enum: COUNT_STATUSES }) status!: CountStatus;
  @ApiProperty() linesCount!: number;
}

export class SetCountedQuantityRequest {
  @ApiProperty({ type: Number, nullable: true, description: 'null clears the line (not counted yet).' })
  countedQuantity!: number | null;
}

export class ApplyCountResult {
  @ApiProperty({ format: 'uuid' }) countId!: string;
  @ApiProperty({ enum: COUNT_STATUSES }) status!: CountStatus;
  @ApiProperty() adjustedLines!: number;
  @ApiProperty() valueDelta!: number;
}

// ---- Formulas --------------------------------------------------------------------

export const saveFormulaSchema = z.strictObject({
  targetType: z.enum(FORMULA_TARGET_TYPES),
  targetId: z.guid(),
  yieldQuantity: quantity,
  lines: z.array(z.strictObject({ ingredientId: z.guid(), quantity })).max(MAX_DOCUMENT_LINES),
  notes: nullableText(2000),
});

export class FormulaLine {
  @ApiProperty({ format: 'uuid' }) ingredientId!: string;
  @ApiProperty() quantity!: number;
}

export class Formula {
  @ApiProperty({ format: 'uuid' }) recipeId!: string;
  @ApiProperty({ enum: FORMULA_TARGET_TYPES }) targetType!: FormulaTargetType;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() yieldQuantity!: number;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [FormulaLine] }) lines!: FormulaLine[];
  @ApiProperty({
    description: "Cost per yielded unit at the current ingredients.cost, as save_formula computes it: round(sum(quantity x cost) / yieldQuantity, 4).",
  })
  unitCost!: number;
}

export class FormulaIndex {
  @ApiProperty({ type: 'object', additionalProperties: { $ref: '#/components/schemas/Formula' }, description: 'By dish id.' })
  byDish!: Record<string, Formula>;
  @ApiProperty({ type: 'object', additionalProperties: { $ref: '#/components/schemas/Formula' }, description: 'By prep item id.' })
  byPrep!: Record<string, Formula>;
}

export class SaveFormulaInput {
  @ApiProperty({ enum: FORMULA_TARGET_TYPES }) targetType!: FormulaTargetType;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() yieldQuantity!: number;
  @ApiProperty({ type: [FormulaLine] }) lines!: FormulaLine[];
  @ApiPropertyOptional({ type: String, nullable: true }) notes?: string | null;
}

export class SaveFormulaResult {
  @ApiProperty({ format: 'uuid' }) recipeId!: string;
  @ApiProperty({ enum: FORMULA_TARGET_TYPES }) targetType!: FormulaTargetType;
  @ApiProperty({ format: 'uuid' }) targetId!: string;
  @ApiProperty() yieldQuantity!: number;
  @ApiProperty() linesCount!: number;
  @ApiProperty() totalCost!: number;
  @ApiProperty() unitCost!: number;
}

// ---- Overview --------------------------------------------------------------------

export const overviewQuerySchema = z.strictObject({ days: intQuery.optional() });

export class OverviewKpis {
  @ApiProperty() totalValue!: number;
  @ApiProperty() itemsCount!: number;
  @ApiProperty() activeItems!: number;
  @ApiProperty() lowStockCount!: number;
  @ApiProperty() outOfStockCount!: number;
  @ApiProperty() expiringSoonCount!: number;
  @ApiProperty() expiredCount!: number;
  @ApiProperty() wasteValue!: number;
  @ApiProperty() purchasesValue!: number;
  @ApiProperty() consumptionValue!: number;
  @ApiProperty() openPurchaseOrders!: number;
}

export class OverviewSeriesPoint {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty() inValue!: number;
  @ApiProperty() outValue!: number;
  @ApiProperty() wasteValue!: number;
}

export class OverviewCategoryValue {
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true }) categoryName!: string | null;
  @ApiProperty() value!: number;
}

export class OverviewTopConsumed {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() value!: number;
}

export class InventoryOverview {
  @ApiProperty() days!: number;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: OverviewKpis }) kpis!: OverviewKpis;
  @ApiProperty({ type: [OverviewSeriesPoint] }) series!: OverviewSeriesPoint[];
  @ApiProperty({ type: [OverviewCategoryValue] }) valueByCategory!: OverviewCategoryValue[];
  @ApiProperty({ type: [OverviewTopConsumed] }) topConsumed!: OverviewTopConsumed[];
}

// ---- Sales: stock check, consumption, availability ---------------------------------

export const checkStockSchema = z.strictObject({
  items: z
    .array(z.strictObject({ dishId: z.guid(), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(MAX_STOCK_CHECK_ITEMS),
});
export const consumeOrderSchema = z.strictObject({ orderId: z.guid() });
export const dishAvailabilitySchema = z.strictObject({ dishIds: z.array(z.guid()).max(MAX_AVAILABILITY_DISHES) });

export class DishStockCheckItem {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ minimum: 1, maximum: 999 }) quantity!: number;
}

export class CheckStockRequest {
  @ApiProperty({ type: [DishStockCheckItem], minItems: 1, maxItems: MAX_STOCK_CHECK_ITEMS }) items!: DishStockCheckItem[];
}

export class StockCheckShortage {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() required!: number;
  @ApiProperty() available!: number;
  @ApiProperty() missing!: number;
}

export class DishStockCheckResult {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ description: 'false when inventory control is off (then ok and no shortages).' }) enabled!: boolean;
  @ApiProperty({ type: [StockCheckShortage] }) shortages!: StockCheckShortage[];
}

export class ConsumeOrderRequest {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
}

export class ConsumeShortage {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() missing!: number;
}

export class ConsumeOrderStockResult {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() consumedItems!: number;
  @ApiProperty() totalCost!: number;
  @ApiProperty({ type: [ConsumeShortage] }) shortages!: ConsumeShortage[];
}

export class DishAvailabilityRequest {
  @ApiProperty({ type: [String], maxItems: MAX_AVAILABILITY_DISHES }) dishIds!: string[];
}
