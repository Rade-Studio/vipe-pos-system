import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { dateQuery } from '../common/validation';
import { LegacyPaymentTransaction, Payment } from '../payments/payments.dto';

export const ORDER_STATUSES = ['active', 'kitchen', 'delivered', 'cancelled', 'paid'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_ITEM_STATUSES = ['kitchen', 'served'] as const;
export const ORDER_TYPES = ['dine_in', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_INCLUDES = ['items', 'table', 'waiter'] as const;
/** GET /orders answers at most this many rows (no pagination today). */
export const ORDER_LIST_LIMIT = 500;
/** check_dishes_stock accepts at most 100 lines of 1..999 units. */
const MAX_ITEMS = 100;

/** `a,b,c` query value, each part one of `values`. */
const csvOf = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .transform((value) => value.split(',').map((part) => part.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

export const orderListQuerySchema = z.strictObject({
  status: csvOf(ORDER_STATUSES).optional(),
  include: csvOf(ORDER_INCLUDES).optional(),
});

const orderItemInputSchema = z.strictObject({
  dishId: z.guid(),
  quantity: z.number().int().min(1).max(999),
  /** Price the client showed; the server charges the catalog price and answers 409 when they differ. */
  unitPrice: z.number().min(0).max(99_999_999.99).optional(),
  comments: z.string().max(500).nullable().optional(),
});
const orderItemsSchema = z.array(orderItemInputSchema).min(1).max(MAX_ITEMS);

/** Same bounds as orders_guests_check (0014); null clears. */
const guestsSchema = z
  .number({ error: 'Los comensales deben ser un número entero entre 1 y 99' })
  .int({ error: 'Los comensales deben ser un número entero entre 1 y 99' })
  .min(1, { error: 'Los comensales deben ser un número entero entre 1 y 99' })
  .max(99, { error: 'Los comensales deben ser un número entero entre 1 y 99' })
  .nullable();
/** Same bounds as orders_notes_check (0014) after trim; a blank note is null. */
const notesSchema = z
  .string({ error: 'La nota del pedido debe tener entre 1 y 300 caracteres' })
  .trim()
  .max(300, { error: 'La nota del pedido debe tener entre 1 y 300 caracteres' })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();
/**
 * guests and notes on create, add-items and PATCH. order_number is assigned by
 * the 0014 trigger: the strict schemas refuse a client orderNumber with 422.
 */
const orderDetails = { guests: guestsSchema.optional(), notes: notesSchema.optional() };

/** Delivery orders need their order_deliveries row: they go through create_delivery_order (T11). */
export const createOrderSchema = z.strictObject({
  tableId: z.guid(),
  waiterId: z.guid().optional(),
  orderType: z.literal('dine_in', { error: 'Only dine_in orders; delivery orders are created by the delivery module' }).optional(),
  items: orderItemsSchema,
  tipPercentage: z.number().min(0).max(100).optional(),
  force: z.boolean().optional(),
  ...orderDetails,
});

export const addOrderItemsSchema = z.strictObject({ items: orderItemsSchema, force: z.boolean().optional(), ...orderDetails });

/** PATCH /orders/:id: guests and/or notes of an open order; null (or a blank note) clears. */
export const updateOrderDetailsSchema = z
  .strictObject(orderDetails)
  .refine((value) => value.guests !== undefined || value.notes !== undefined, { error: 'Send guests or notes' });

/** Only kitchen -> delivered; paid goes through pay_order, cancellations are not an API action yet. */
export const updateOrderStatusSchema = z.strictObject({
  status: z.literal('delivered', { error: 'Only delivered can be set; paid goes through payments' }),
});

/** GET /orders/completed?date=YYYY-MM-DD (the restaurant's day). */
export const completedOrdersQuerySchema = z.strictObject({ date: dateQuery });

export const serveOrderItemsSchema = z.strictObject({ itemIds: z.array(z.guid()).min(1).max(MAX_ITEMS) });

export class OrderItem {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) orderId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) dishId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Unit price charged.' }) price!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String, nullable: true }) comments!: string | null;
  @ApiProperty({ enum: ORDER_ITEM_STATUSES }) status!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) addedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class Order {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Per-restaurant order number assigned by the database (1, 2, ...); never set by the client.' })
  orderNumber!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 99, description: 'Guests at the table; null when not captured.' })
  guests!: number | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 300, description: 'Order-level note for the kitchen; null when none.' })
  notes!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) tableId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Waiter profile id.' }) waiterId!: string | null;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty({ enum: ORDER_TYPES }) orderType!: OrderType;
  @ApiProperty() subtotal!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() taxPercentage!: number;
  @ApiProperty() tip!: number;
  @ApiProperty() tipPercentage!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalDiscounts!: number;
  @ApiProperty() isPartialOrder!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentOrderId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiProperty({ type: [OrderItem], description: 'Always embedded, oldest first.' }) items!: OrderItem[];
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Only with include=table.' }) tableNumber?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Only with include=waiter.' }) waiterName?: string | null;
}

/** A paid order with how it was paid: the pay_order payment, or the legacy rows before pay_order. */
export class CompletedOrder extends Order {
  @ApiProperty({ type: Payment, nullable: true, description: 'The payment with its tenders; null for orders paid before pay_order.' })
  payment!: Payment | null;
  @ApiProperty({ type: [LegacyPaymentTransaction], description: 'Legacy payment_transactions rows, only when payment is null.' })
  legacyTransactions!: LegacyPaymentTransaction[];
}

export class OrderItemInput {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ minimum: 1, maximum: 999 }) quantity!: number;
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Price the client showed. The server charges the catalog price (promotions applied, server clock); a different value answers 409 Price changed.',
  })
  unitPrice?: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) comments?: string | null;
}

export class CreateOrderRequest {
  @ApiProperty({ format: 'uuid' }) tableId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: "Defaults to the table's waiter, else the caller." })
  waiterId?: string;
  @ApiPropertyOptional({ enum: ['dine_in'], default: 'dine_in', description: 'Delivery orders are created by the delivery module.' })
  orderType?: 'dine_in';
  @ApiProperty({ type: [OrderItemInput], minItems: 1, maxItems: MAX_ITEMS }) items!: OrderItemInput[];
  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Defaults to the tip_percentage setting.' })
  tipPercentage?: number;
  @ApiPropertyOptional({ default: false, description: 'Send even when check_dishes_stock reports shortages.' })
  force?: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 99, description: 'Guests at the table.' })
  guests?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, description: 'Order note, trimmed; blank is null.' })
  notes?: string | null;
}

export class AddOrderItemsRequest {
  @ApiProperty({ type: [OrderItemInput], minItems: 1, maxItems: MAX_ITEMS }) items!: OrderItemInput[];
  @ApiPropertyOptional({ default: false }) force?: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 99, description: 'Sets guests; omitted keeps them.' })
  guests?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, description: 'Sets the order note; omitted keeps it.' })
  notes?: string | null;
}

export class UpdateOrderDetailsRequest {
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, maximum: 99, description: 'Guests at the table.' })
  guests?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300, description: 'Order note, trimmed; blank is null.' })
  notes?: string | null;
}

export class UpdateOrderStatusRequest {
  @ApiProperty({ enum: ['delivered'] }) status!: 'delivered';
}

export class ServeOrderItemsRequest {
  @ApiProperty({ type: [String], minItems: 1 }) itemIds!: string[];
}

export class StockShortage {
  @ApiProperty({ format: 'uuid' }) ingredientId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() required!: number;
  @ApiProperty() available!: number;
  @ApiProperty() missing!: number;
}

export class DishPrice {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ description: 'Current server price (promotions applied).' }) price!: number;
}

export class PriceChangedResponse {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty({ example: 'Conflict' }) error!: string;
  @ApiProperty({ example: 'Price changed' }) message!: string;
  @ApiProperty({ type: [DishPrice] }) prices!: DishPrice[];
}

export class TableHasOpenOrderResponse {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty({ example: 'Conflict' }) error!: string;
  @ApiProperty({ example: 'Table has an open order' }) message!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
}

export class StockShortageResponse {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty({ example: 'Conflict' }) error!: string;
  @ApiProperty({ example: 'Insufficient stock' }) message!: string;
  @ApiProperty({ type: [StockShortage] }) shortages!: StockShortage[];
}
