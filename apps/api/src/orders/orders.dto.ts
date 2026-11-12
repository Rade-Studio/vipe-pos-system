import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { StaffRef } from '../audit/audit.dto';
import { OTHER_TEXT_ISSUE, requireOtherText, VOID_REASON_CODES, VOID_REASONS, voidReasonFields, type VoidReason } from '../audit/voids';
import { dateQuery } from '../common/validation';
import { normalizePhone } from '../delivery/phone';
import { OrderItemModifier } from '../catalog/modifiers.dto';
import { LegacyPaymentTransaction, Payment } from '../payments/payments.dto';

export const ORDER_STATUSES = ['active', 'kitchen', 'delivered', 'cancelled', 'paid'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_ITEM_STATUSES = ['kitchen', 'served'] as const;
export const ORDER_TYPES = ['dine_in', 'takeaway', 'delivery'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
/** The order types POST /orders creates; delivery goes through the delivery module (create_delivery_order). */
export const CREATE_ORDER_TYPES = ['dine_in', 'takeaway'] as const;
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
  /** F6 kitchen screen: only the orders with a live line of this station, each with only those lines. */
  stationId: z.guid().optional(),
});

const orderItemInputSchema = z.strictObject({
  dishId: z.guid(),
  quantity: z.number().int().min(1).max(999),
  /** Price the client showed (dish plus options); the server charges its own and answers 409 when they differ. */
  unitPrice: z.number().min(0).max(99_999_999.99).optional(),
  comments: z.string().max(500).nullable().optional(),
  /** F7: the chosen options; the rules are checked by the database (422 with a modifier_* code). */
  modifiers: z.array(z.strictObject({ optionId: z.guid() })).max(50).optional(),
});

/** A combo (S5): the promotion and one dish per group; each choice becomes its own order line. */
const comboLineSchema = z.strictObject({
  comboPromotionId: z.guid(),
  choices: z
    .array(
      z.strictObject({
        groupId: z.guid(),
        dishId: z.guid(),
        comments: z.string().max(500).nullable().optional(),
        modifiers: z.array(z.strictObject({ optionId: z.guid() })).max(50).optional(),
      }),
    )
    .min(1)
    .max(6),
});
export type ComboLineInput = z.infer<typeof comboLineSchema>;
/** At most this many combo lines per request (create, add-items and the preview). */
const MAX_COMBOS = 20;
const combosSchema = z.array(comboLineSchema).max(MAX_COMBOS);

/** items, or combos, or both; at most MAX_ITEMS lines once the combos are expanded. */
const linesShape = {
  items: z.array(orderItemInputSchema).max(MAX_ITEMS).optional(),
  combos: combosSchema.optional(),
};
const hasLines = (value: { items?: unknown[]; combos?: { choices: unknown[] }[] }) =>
  (value.items?.length ?? 0) + (value.combos?.length ?? 0) > 0 &&
  (value.items?.length ?? 0) + (value.combos ?? []).reduce((sum, combo) => sum + combo.choices.length, 0) <= MAX_ITEMS;
const LINES_ISSUE = { error: `Agrega al menos un producto o un combo (máximo ${MAX_ITEMS} líneas)` };

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

export const CUSTOMER_NAME_MESSAGE = 'El nombre del cliente debe tener entre 2 y 60 caracteres';
export const CUSTOMER_PHONE_MESSAGE = 'El teléfono debe tener entre 7 y 15 dígitos';
/** orders_customer_phone_check (0030): normalised with the delivery rule; blank or null is none. */
const customerPhoneSchema = z
  .string({ error: CUSTOMER_PHONE_MESSAGE })
  .max(100, { error: CUSTOMER_PHONE_MESSAGE })
  .transform((value, ctx) => {
    if (value.trim() === '') return null;
    const phone = normalizePhone(value);
    if (phone === null) {
      ctx.addIssue({ code: 'custom', message: CUSTOMER_PHONE_MESSAGE });
      return z.NEVER;
    }
    return phone;
  })
  .nullable();

/**
 * dine_in needs its table; takeaway (S8) has no table and needs the customer's
 * name (the phone is optional). Delivery orders need their order_deliveries
 * row: they go through create_delivery_order (T11).
 */
export const createOrderSchema = z
  .strictObject({
    tableId: z.guid().optional(),
    waiterId: z.guid().optional(),
    orderType: z.enum(CREATE_ORDER_TYPES, { error: 'Only dine_in or takeaway orders; delivery orders are created by the delivery module' }).optional(),
    customerName: z.string({ error: CUSTOMER_NAME_MESSAGE }).optional(),
    customerPhone: customerPhoneSchema.optional(),
    ...linesShape,
    tipPercentage: z.number().min(0).max(100).optional(),
    force: z.boolean().optional(),
    ...orderDetails,
  })
  .refine(hasLines, LINES_ISSUE)
  .transform((value, ctx) => {
    const { customerName: rawName, ...rest } = value;
    if ((value.orderType ?? 'dine_in') === 'dine_in') {
      if (value.tableId === undefined) ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Elige la mesa del pedido' });
      if (rawName !== undefined || (value.customerPhone ?? null) !== null) {
        ctx.addIssue({ code: 'custom', path: ['customerName'], message: 'Solo un pedido para llevar lleva el nombre del cliente' });
      }
      return { ...rest, orderType: 'dine_in' as const, customerName: null, customerPhone: null };
    }
    if (value.tableId !== undefined) ctx.addIssue({ code: 'custom', path: ['tableId'], message: 'Un pedido para llevar no tiene mesa' });
    // orders_customer_name_check (0030): stored trimmed, 2..60 characters.
    const name = rawName?.trim() ?? '';
    if (name.length < 2 || name.length > 60) ctx.addIssue({ code: 'custom', path: ['customerName'], message: CUSTOMER_NAME_MESSAGE });
    return { ...rest, orderType: 'takeaway' as const, customerName: name, customerPhone: value.customerPhone ?? null };
  });

export const addOrderItemsSchema = z.strictObject({ ...linesShape, force: z.boolean().optional(), ...orderDetails }).refine(hasLines, LINES_ISSUE);

/** POST /orders/pricing-preview (S8): draft dish lines and combo lines, as if sent now; strict, like the send. */
const previewDishLineSchema = orderItemInputSchema.omit({ unitPrice: true, comments: true });
/** Units of a line of `orderId` the preview takes out (S1). */
const previewVoidSchema = z.strictObject({ orderItemId: z.guid(), quantity: z.number().int().min(1).max(999) });
export const PREVIEW_VOID_MESSAGES = {
  void_order_required: 'Para ver una anulación envía el pedido (orderId)',
  void_item_unknown: 'La línea a anular no es una línea vigente de este pedido',
  void_quantity_invalid: 'No se pueden anular más unidades de las que tiene la línea',
} as const;
export const pricingPreviewSchema = z.strictObject({
  channel: z.enum(ORDER_TYPES),
  orderId: z.guid().optional(),
  lines: z
    .array(z.union([previewDishLineSchema, comboLineSchema]))
    .max(MAX_ITEMS)
    .refine((lines) => lines.filter((line) => 'comboPromotionId' in line).length <= MAX_COMBOS, { error: `Máximo ${MAX_COMBOS} combos por consulta` }),
  voids: z
    .array(previewVoidSchema)
    .max(MAX_ITEMS)
    .refine((voids) => new Set(voids.map((v) => v.orderItemId)).size === voids.length, { error: 'Cada línea una sola vez' })
    .optional(),
});

/** PATCH /orders/:id: guests and/or notes of an open order; null (or a blank note) clears. */
export const updateOrderDetailsSchema = z
  .strictObject(orderDetails)
  .refine((value) => value.guests !== undefined || value.notes !== undefined, { error: 'Send guests or notes' });

/** Only kitchen -> delivered; paid goes through pay_order, cancellations through POST /orders/:id/cancel. */
export const updateOrderStatusSchema = z.strictObject({
  status: z.literal('delivered', { error: 'Only delivered can be set; paid goes through payments' }),
});

/** GET /orders/completed?date=YYYY-MM-DD (the restaurant's day). */
export const completedOrdersQuerySchema = z.strictObject({ date: dateQuery });

export const serveOrderItemsSchema = z.strictObject({ itemIds: z.array(z.guid()).min(1).max(MAX_ITEMS) });

/** POST /orders/:id/cancel and the body of DELETE /orders/:id. */
export const cancelOrderSchema = z.strictObject(voidReasonFields).refine(requireOtherText, OTHER_TEXT_ISSUE);

/** DELETE /orders/:id without a body: an order with nothing on it, cancelled with this reason. */
export const DELETE_DEFAULT_REASON = { reason: 'other', reasonText: 'Cancelada sin motivo indicado' } as const;

/** POST /orders/:id/items/void: units of live lines, each line once. */
export const voidOrderItemsSchema = z
  .strictObject({
    items: z
      .array(z.strictObject({ itemId: z.guid(), quantity: z.number().int().min(1).max(999) }))
      .min(1)
      .max(MAX_ITEMS)
      .refine((items) => new Set(items.map((item) => item.itemId)).size === items.length, { error: 'Each item once' }),
    ...voidReasonFields,
  })
  .refine(requireOtherText, OTHER_TEXT_ISSUE);

export const ORDER_DISCOUNT_KINDS = ['promotion_item', 'promotion_bill', 'combo', 'manual_item', 'manual_bill'] as const;

/** The label of a free manual discount (no promotion). */
export const FREE_DISCOUNT_LABEL = 'Descuento manual';
export const MANUAL_DISCOUNT_MESSAGES = {
  reason: 'Escribe el motivo (entre 3 y 200 caracteres)',
  invalid: 'Elige una promoción manual o un descuento libre (porcentaje de 1 a 100 o valor fijo en pesos)',
} as const;

/**
 * POST /orders/:id/discounts (S7): a manual or manual_pin promotion, or a free
 * discount, on a line (orderItemId) or on the order. authorizationId is the
 * apply_discount authorization of POST /auth/authorize for this order.
 */
export const addOrderDiscountSchema = z
  .strictObject({
    orderItemId: z.guid().optional(),
    promotionId: z.guid().optional(),
    discountType: z.enum(['percentage', 'fixed_amount']).optional(),
    discountValue: z.number().int().positive().max(100_000_000).optional(),
    reason: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(3).max(200)),
    authorizationId: z.guid().optional(),
  })
  .refine(
    (input) =>
      input.promotionId !== undefined
        ? input.discountType === undefined && input.discountValue === undefined
        : input.discountType !== undefined && input.discountValue !== undefined && (input.discountType !== 'percentage' || input.discountValue <= 100),
    { error: MANUAL_DISCOUNT_MESSAGES.invalid },
  );
export type AddOrderDiscountInput = z.infer<typeof addOrderDiscountSchema>;

export const removeOrderDiscountSchema = z.strictObject({ authorizationId: z.guid().optional() });

/** The body of a manual discount with machine codes: `discount_reason_invalid` for the reason, else `discount_invalid`. */
export function parseDiscountBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const reason = parsed.error.issues.some((issue) => issue.path[0] === 'reason');
  throw new UnprocessableEntityException({
    message: reason ? MANUAL_DISCOUNT_MESSAGES.reason : MANUAL_DISCOUNT_MESSAGES.invalid,
    code: reason ? 'discount_reason_invalid' : 'discount_invalid',
  });
}

export class AddOrderDiscountRequest {
  @ApiPropertyOptional({ format: 'uuid', description: 'A live line of the order; omitted = a discount on the order.' }) orderItemId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A promotion with mode manual (no PIN) or manual_pin: product_discount needs orderItemId, bill_discount must not have it. Without it, discountType and discountValue make a free discount.',
  })
  promotionId?: string;
  @ApiPropertyOptional({ enum: ['percentage', 'fixed_amount'] }) discountType?: 'percentage' | 'fixed_amount';
  @ApiPropertyOptional({ description: 'Percentage 1-100 or whole pesos.' }) discountValue?: number;
  @ApiProperty({ minLength: 3, maxLength: 200, description: 'Trimmed.' }) reason!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'POST /auth/authorize (action apply_discount, target this order; a void_item one is 403 authorization_invalid); required unless the promotion mode is manual.' })
  authorizationId?: string;
}

export class RemoveOrderDiscountRequest {
  @ApiPropertyOptional({ format: 'uuid', description: 'Same rule as adding: required unless the promotion mode is manual.' }) authorizationId?: string;
}

/** One order_discounts row (S2, S8). */
export class OrderDiscount {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ORDER_DISCOUNT_KINDS }) kind!: (typeof ORDER_DISCOUNT_KINDS)[number];
  @ApiProperty({ enum: ['automatic', 'manual'] }) source!: 'automatic' | 'manual';
  @ApiProperty({ example: 'Happy hour 2x1', description: 'The promotion name when it was applied.' }) label!: string;
  @ApiProperty({ description: 'Whole pesos, > 0.' }) amount!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null for a free manual discount or a deleted promotion.' })
  promotionId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null for a bill discount; a combo discount sits on its first line.' })
  orderItemId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) comboId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Manual discounts only.' }) reason!: string | null;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'Manual discounts only.' }) authorizedBy!: StaffRef | null;
}

export class OrderItem {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) orderId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) dishId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Unit list price, options included; discounts are separate (discounts).' }) price!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String, nullable: true }) comments!: string | null;
  @ApiProperty({ enum: ORDER_ITEM_STATUSES }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Station the line was routed to when sent (F6); null without stations.' })
  stationId!: string | null;
  @ApiProperty({
    type: String,
    enum: ['dish', 'category', 'fallback'],
    nullable: true,
    description: 'dish: the dish exception; category: its default; fallback: no route, sent to the default station.',
  })
  stationSource!: 'dish' | 'category' | 'fallback' | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) addedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiProperty({ type: [OrderItemModifier], description: 'Options chosen on the line, in menu order; their prices are inside price (F7).' })
  modifiers!: OrderItemModifier[];
  @ApiProperty({ type: [OrderDiscount], description: 'Discounts on this line (a combo discount sits on the first line of the combo).' })
  discounts!: OrderDiscount[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The promotion fixed when the line was sent (or its combo).' })
  promotionId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Its name when the line was sent.' }) promotionName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Shared by the lines of one combo.' }) comboId!: string | null;
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
  @ApiProperty({ enum: ORDER_TYPES, description: 'takeaway (para llevar): no table, customerName set.' }) orderType!: OrderType;
  @ApiProperty({ type: String, nullable: true, maxLength: 60, description: 'takeaway only: who picks the order up; null otherwise.' })
  customerName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'takeaway only, optional: 7..15 digits; null otherwise.' }) customerPhone!: string | null;
  @ApiProperty({ description: 'Net base: grossSubtotal - totalDiscounts; tax, tip and total are computed on it.' }) subtotal!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() taxPercentage!: number;
  @ApiProperty() tip!: number;
  @ApiProperty() tipPercentage!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Sum of discounts (capped at grossSubtotal).' }) totalDiscounts!: number;
  @ApiProperty({ description: 'Sum of price x quantity at list price.' }) grossSubtotal!: number;
  @ApiProperty({ type: [OrderDiscount], description: 'Every discount of the order: line discounts in line order, then bill discounts.' })
  discounts!: OrderDiscount[];
  @ApiProperty() isPartialOrder!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentOrderId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiProperty({ type: [OrderItem], description: 'Always embedded, oldest first; fully voided lines (quantity 0) are left out.' }) items!: OrderItem[];
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

const REASON_DESCRIPTION = `Fixed list: ${Object.entries(VOID_REASONS)
  .map(([code, label]) => `${code} (${label})`)
  .join(', ')}. other needs reasonText.`;

export class CancelOrderRequest {
  @ApiProperty({ enum: VOID_REASON_CODES, description: REASON_DESCRIPTION }) reason!: VoidReason;
  @ApiPropertyOptional({ type: String, nullable: true, minLength: 3, maxLength: 200, description: 'Free text; required for other. Spaces collapsed and trimmed.' })
  reasonText?: string | null;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'POST /auth/authorize id for action cancel_order. Required when a table order has a live item or any payment, and when a delivery has a live payment (voided with it).',
  })
  authorizationId?: string;
}

export class VoidOrderItemInput {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ minimum: 1, maximum: 999, description: 'Units to void; at most what the line has.' }) quantity!: number;
}

export class VoidOrderItemsRequest {
  @ApiProperty({ type: [VoidOrderItemInput], minItems: 1, maxItems: MAX_ITEMS, description: 'Each line once.' }) items!: VoidOrderItemInput[];
  @ApiProperty({ enum: VOID_REASON_CODES, description: REASON_DESCRIPTION }) reason!: VoidReason;
  @ApiPropertyOptional({ type: String, nullable: true, minLength: 3, maxLength: 200 }) reasonText?: string | null;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'POST /auth/authorize id for action void_item. Required: every line the server holds was sent to the kitchen.',
  })
  authorizationId?: string;
}

/** Reason label of a delivery cancelled before the audit existed (0019): no reason or actor was recorded. */
export const LEGACY_CANCELLATION_LABEL = 'Sin motivo registrado (antes de la auditoría)';

/** How and by whom an order was cancelled (public.order_cancellations, or a legacy delivery). */
export class OrderCancellation {
  @ApiProperty({ enum: VOID_REASON_CODES, nullable: true, description: 'Null only for a legacy delivery.' }) reason!: VoidReason | null;
  @ApiProperty({ description: `Spanish label of the reason; "${LEGACY_CANCELLATION_LABEL}" for a legacy delivery.` }) reasonLabel!: string;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'Null only for a legacy delivery (no actor was recorded).' })
  cancelledBy!: StaffRef | null;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'Null when no authorization was needed (an order with nothing on it, an unpaid delivery).' })
  authorizedBy!: StaffRef | null;
  @ApiProperty() selfAuthorized!: boolean;
  @ApiProperty({ type: String, enum: ['active', 'kitchen', 'delivered', 'paid'], nullable: true, description: 'paid: a prepaid delivery; null for a legacy delivery.' })
  previousStatus!: string | null;
  @ApiProperty({ description: 'A delivery cancelled before cancellations were audited (no reason, actor or authorization recorded).' }) legacy!: boolean;
  @ApiProperty({ description: 'Bill at the moment of the cancellation (a delivery: total includes the delivery fee).' }) subtotal!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() tip!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Lines that had been sent to the kitchen (their stock stays consumed).' }) sentItems!: number;
  @ApiProperty({ format: 'date-time' }) cancelledAt!: string;
}

/** The delivery of a cancelled order. */
export class CancelledDelivery {
  @ApiProperty() customerName!: string;
  @ApiProperty() deliveryFee!: number;
}

/** A cancelled order with its lines as they were and the cancellation. */
export class CancelledOrder extends Order {
  @ApiProperty({ type: OrderCancellation }) cancellation!: OrderCancellation;
  @ApiProperty({ type: CancelledDelivery, nullable: true, description: 'Only for a delivery (orderType delivery).' }) delivery!: CancelledDelivery | null;
}

export class OrderItemModifierInput {
  @ApiProperty({ format: 'uuid' }) optionId!: string;
}

export class OrderItemInput {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ minimum: 1, maximum: 999 }) quantity!: number;
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Price the client showed: the dish LIST price plus the options (promotions are separate discounts). A different value answers 409 Price changed; with options the body also carries `lines` [{index, dishId, unitPrice}].',
  })
  unitPrice?: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) comments?: string | null;
  @ApiPropertyOptional({
    type: [OrderItemModifierInput],
    maxItems: 50,
    description:
      'Options of the line. Each once, offered by an active group of the dish, active; every active group between its min and max. 422 code modifier_invalid | modifier_inactive | modifier_duplicate | modifier_required | modifier_max.',
  })
  modifiers?: OrderItemModifierInput[];
}

export class ComboChoiceInput {
  @ApiProperty({ format: 'uuid' }) groupId!: string;
  @ApiProperty({ format: 'uuid', description: 'One of the dishes of the group.' }) dishId!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) comments?: string | null;
  @ApiPropertyOptional({ type: [OrderItemModifierInput], maxItems: 50, description: 'Same rules as a dish line.' }) modifiers?: OrderItemModifierInput[];
}

export class ComboLineRequest {
  @ApiProperty({ format: 'uuid', description: 'A combo promotion active now for the channel.' }) comboPromotionId!: string;
  @ApiProperty({ type: [ComboChoiceInput], minItems: 1, maxItems: 6, description: 'Exactly one per group. The options of a choice are charged on top of the combo price.' })
  choices!: ComboChoiceInput[];
}

const COMBOS_DESCRIPTION =
  'Each combo inserts one line per choice at list price (its options included), sharing a comboId, plus one combo discount: sum of the dish list prices WITHOUT options - comboPrice, so the options of a component are charged on top of the combo price. 422 code combo_unknown | combo_inactive | combo_group_missing | combo_choice_invalid | combo_duplicate_group; nothing is stored.';

export class CreateOrderRequest {
  @ApiPropertyOptional({ format: 'uuid', description: 'Required for dine_in; refused for takeaway.' }) tableId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: "Defaults to the table's waiter, else the caller." })
  waiterId?: string;
  @ApiPropertyOptional({ enum: CREATE_ORDER_TYPES, default: 'dine_in', description: 'Delivery orders are created by the delivery module.' })
  orderType?: 'dine_in' | 'takeaway';
  @ApiPropertyOptional({ minLength: 2, maxLength: 60, description: `takeaway only and required there, trimmed (${CUSTOMER_NAME_MESSAGE}).` })
  customerName?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, description: 'takeaway only, optional: normalised like the delivery phones (7..15 digits); blank is null.' })
  customerPhone?: string | null;
  @ApiPropertyOptional({ type: [OrderItemInput], maxItems: MAX_ITEMS, description: 'Dish lines; items and/or combos must bring at least one line.' })
  items?: OrderItemInput[];
  @ApiPropertyOptional({ type: [ComboLineRequest], maxItems: MAX_COMBOS, description: COMBOS_DESCRIPTION }) combos?: ComboLineRequest[];
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
  @ApiPropertyOptional({ type: [OrderItemInput], maxItems: MAX_ITEMS, description: 'Dish lines; items and/or combos must bring at least one line.' })
  items?: OrderItemInput[];
  @ApiPropertyOptional({ type: [ComboLineRequest], maxItems: MAX_COMBOS, description: COMBOS_DESCRIPTION }) combos?: ComboLineRequest[];
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
  @ApiProperty({ description: 'Current list price.' }) price!: number;
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

export class PreviewDishLine {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ minimum: 1, maximum: 999 }) quantity!: number;
  @ApiPropertyOptional({ type: [OrderItemModifierInput], maxItems: 50 }) modifiers?: OrderItemModifierInput[];
}

export class PreviewVoidInput {
  @ApiProperty({ format: 'uuid', description: 'A live line of orderId.' }) orderItemId!: string;
  @ApiProperty({ minimum: 1, maximum: 999, description: 'Units to take out; at most what the line has.' }) quantity!: number;
}

export class PricingPreviewRequest {
  @ApiProperty({ enum: ORDER_TYPES, description: 'Ignored when orderId is given: the order\'s own channel is used.' }) channel!: OrderType;
  @ApiPropertyOptional({ format: 'uuid', description: 'An open order whose lines (sent, with their fixed promotions) are priced with the draft.' })
  orderId?: string;
  @ApiProperty({
    description: `Draft lines: dish lines and combo lines ({comboPromotionId, choices}), at most ${MAX_COMBOS} combo lines (each 1-6 choices); unknown fields are 422.`,
    type: 'array',
    maxItems: MAX_ITEMS,
    items: { oneOf: [{ $ref: '#/components/schemas/PreviewDishLine' }, { $ref: '#/components/schemas/ComboLineRequest' }] },
  })
  lines!: (PreviewDishLine | ComboLineRequest)[];
  @ApiPropertyOptional({
    type: [PreviewVoidInput],
    maxItems: MAX_ITEMS,
    description:
      'Needs orderId (else 422 code void_order_required). The answer is the order as if these units were voided now with POST /orders/:id/items/void: a combo component voids its whole combo, the automatic discounts are recomputed and the manual line discounts rescaled to the units left. Each line once; a line that is not a live line of the order is 422 code void_item_unknown, more units than it has 422 code void_quantity_invalid. Nothing is written.',
  })
  voids?: PreviewVoidInput[];
}

export class PreviewDiscount {
  @ApiProperty({ enum: ORDER_DISCOUNT_KINDS, description: 'manual_item and manual_bill are the order\'s stored manual discounts.' })
  kind!: (typeof ORDER_DISCOUNT_KINDS)[number];
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null for a free manual discount.' }) promotionId!: string | null;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

export class PreviewLine {
  @ApiProperty({ description: 'false for a draft line.' }) sent!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The order line; null for a draft.' }) orderItemId!: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Index in `lines` of the draft (a combo line expands into one line per choice); null when sent.' })
  draftIndex!: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) dishId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Unit list price, options included.' }) unitPrice!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Fixed when sent; for a draft, the promotion it would be sent with now.' })
  promotionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) promotionName!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Shared by the lines of a combo; drafts get a temporary `draft-combo-N`.' })
  comboId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) addedAt!: string | null;
  @ApiProperty({ type: [PreviewDiscount] }) discounts!: PreviewDiscount[];
}

export class PricingHintDto {
  @ApiProperty({ enum: ['missing_units', 'window_ending', 'bill_minimum'] }) kind!: 'missing_units' | 'window_ending' | 'bill_minimum';
  @ApiProperty({ format: 'uuid' }) promotionId!: string;
  @ApiProperty({ example: 'Falta 1 unidad para otro 2x1.' }) message!: string;
  @ApiPropertyOptional({ description: 'missing_units: units; bill_minimum: pesos.' }) missing?: number;
  @ApiPropertyOptional({ description: 'window_ending: minutes until the window ends (<= 10).' }) minutesLeft?: number;
}

export class PricingPreview {
  @ApiProperty({ enum: ORDER_TYPES, description: 'The order\'s channel with orderId, else the body channel.' }) channel!: OrderType;
  @ApiProperty({ format: 'date-time' }) now!: string;
  @ApiProperty({ type: [PreviewLine], description: 'Sent lines first (oldest first), then the drafts in order.' }) lines!: PreviewLine[];
  @ApiProperty({ type: PreviewDiscount, nullable: true }) billDiscount!: PreviewDiscount | null;
  @ApiProperty({ type: [PreviewDiscount], description: 'The order\'s manual discounts on the bill (manual_bill).' }) manualDiscounts!: PreviewDiscount[];
  @ApiProperty() grossSubtotal!: number;
  @ApiProperty({ description: 'Automatic line, combo and bill discounts plus the order\'s manual discounts (capped at grossSubtotal).' }) totalDiscounts!: number;
  @ApiProperty({ description: 'grossSubtotal - totalDiscounts: the base tax and tip are computed on (Order.subtotal).' }) netSubtotal!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'With orderId: round(netSubtotal x the order\'s taxPercentage / 100), as the bill; null without an order.' })
  tax!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'With orderId: the suggested tip on netSubtotal with the order\'s tipPercentage; null without an order.' })
  tip!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'With orderId: netSubtotal + tax + tip, exactly Order.total after the same change (private.recompute_order_bill; no delivery fee); null without an order.',
  })
  total!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'With orderId: the delivery fee of a delivery order (0 for dine_in), outside total as in Order; pay_order charges netSubtotal + tax + deliveryFee plus the tip given. Null without an order, or for a delivery the caller cannot read (a waiter).',
  })
  deliveryFee!: number | null;
  @ApiProperty({ type: [PricingHintDto] }) hints!: PricingHintDto[];
}
