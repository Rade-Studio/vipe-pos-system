import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';
import { ConsumeOrderStockResult } from '../inventory/inventory.dto';
import { ComboLineRequest } from '../orders/orders.dto';
import { PrintJobCreated } from '../print/print.dto';
import { normalizePhone } from './phone';

export const DELIVERY_STATUSES = ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'failed', 'cancelled'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_ACTIONS = ['start_preparing', 'mark_ready', 'dispatch', 'deliver', 'fail', 'cancel'] as const;
export const PAYMENT_MODES = ['prepaid', 'cash_on_delivery'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

const PHONE_MESSAGE = 'Phone must have 7 to 15 digits';
/**
 * Rule for POST /delivery/orders: zod only checks the shape with generous
 * caps (TEXT_MAX, MAX_LINES) above the RPC limits; create_delivery_order
 * enforces the real limits (1..100 lines, quantity 1..999, fee >= 0, notes
 * <= 300, address lengths) so its message and SQLSTATE stay authoritative.
 */
const TEXT_MAX = 1000;
const MAX_LINES = 500;
const BY_RPC = 'validated by create_delivery_order';
/** Same caps as the orders' combos (orders.dto.ts comboLineSchema, MAX_COMBOS). */
const MAX_COMBOS = 20;
const MAX_COMBO_CHOICES = 6;
/**
 * A combo (S7): the promotion and one dish per group, the shape of POST
 * /orders' combos (orders.dto.ts comboLineSchema, not exported); each choice
 * becomes its own line.
 */
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
    .max(MAX_COMBO_CHOICES),
});

/** A phone normalised with the web's rule, or a 422. */
const toPhone = (value: string, ctx: z.RefinementCtx): string => {
  const normalized = normalizePhone(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: PHONE_MESSAGE });
    return z.NEVER;
  }
  return normalized;
};
const phone = z.string().max(100).transform(toPhone);
/** Courier phone: blank or null clears it, otherwise normalised. */
const optionalPhone = z
  .string()
  .max(100)
  .transform((value, ctx) => (value.trim() === '' ? null : toPhone(value, ctx)))
  .nullable();

export const customerQuerySchema = z.strictObject({ phone });

export const courierListQuerySchema = z.strictObject({ activeOnly: booleanQuery.optional() });

const courierName = z.string().trim().min(1).max(80);

export const createCourierSchema = z.strictObject({ name: courierName, phone: optionalPhone.optional() });

export const updateCourierSchema = z
  .strictObject({ name: courierName.optional(), phone: optionalPhone.optional(), isActive: z.boolean().optional() })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), 'Patch must not be empty');

/**
 * Body of POST /delivery/orders, the web's CreateDeliveryOrderInput. Only the
 * shape is checked here; every business rule (customer id xor phone, lengths,
 * ranges, tenant) is create_delivery_order's, so its message and SQLSTATE reach
 * the client. The one exception: the web dropped cashChangeFor client-side for
 * prepaid orders before mapping it to null, so the API refuses it instead of
 * silently discarding it.
 */
export const createDeliveryOrderSchema = z
  .strictObject({
    customer: z.strictObject({
      id: z.string().max(100).optional(),
      phone: z.string().max(100).optional(),
      name: z.string().max(TEXT_MAX).optional(),
    }),
    address: z.strictObject({
      id: z.string().max(100).optional(),
      addressLine: z.string().max(TEXT_MAX).optional(),
      neighborhood: z.string().max(TEXT_MAX).nullable().optional(),
      reference: z.string().max(TEXT_MAX).nullable().optional(),
      label: z.string().max(TEXT_MAX).nullable().optional(),
      save: z.boolean().optional(),
    }),
    items: z
      .array(
        z.strictObject({
          dishId: z.guid(),
          quantity: z.number().int(),
          comments: z.string().max(TEXT_MAX).nullable().optional(),
          modifiers: z.array(z.strictObject({ optionId: z.guid() })).max(50).optional(),
        }),
      )
      .max(MAX_LINES),
    combos: z.array(comboLineSchema).max(MAX_COMBOS).optional(),
    deliveryFee: z.number().int(),
    paymentMode: z.enum(PAYMENT_MODES),
    cashChangeFor: z.number().int().nullable().optional(),
    notes: z.string().max(TEXT_MAX).nullable().optional(),
    prepaidMethodId: z.guid().nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.paymentMode === 'prepaid' && input.cashChangeFor != null) {
      ctx.addIssue({ code: 'custom', path: ['cashChangeFor'], message: 'Must be null when paymentMode is prepaid' });
    }
  });
export type CreateDeliveryOrderInput = z.infer<typeof createDeliveryOrderSchema>;

/** `action` is not an enum here: set_delivery_status answers an unknown one with 22023 and its message. */
export const setDeliveryStatusSchema = z.strictObject({
  action: z.string().min(1).max(40),
  courierId: z.guid().nullable().optional(),
  reason: z.string().max(TEXT_MAX).nullable().optional(),
  courierEta: z.iso.datetime({ offset: true }).nullable().optional(),
  courierLocation: z.string().max(TEXT_MAX).nullable().optional(),
});

export class Customer {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: '7..15 digits.' }) phone!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CustomerAddress {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ type: String, nullable: true }) label!: string | null;
  @ApiProperty() addressLine!: string;
  @ApiProperty({ type: String, nullable: true }) neighborhood!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

/** Address snapshot of a delivery (order_deliveries), not a registry row. */
export class DeliveryAddressSnapshot {
  @ApiProperty() addressLine!: string;
  @ApiProperty({ type: String, nullable: true }) neighborhood!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
}

export class CustomerHistory {
  @ApiProperty({ type: 'integer', description: 'Deliveries of the customer, cancelled ones excluded.' }) ordersCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Creation of the latest counted delivery.' })
  lastOrderAt!: string | null;
  @ApiProperty({ type: DeliveryAddressSnapshot, nullable: true, description: 'Address of the latest counted delivery.' })
  lastAddress!: DeliveryAddressSnapshot | null;
}

export class CustomerWithAddresses {
  @ApiProperty({ type: Customer }) customer!: Customer;
  @ApiProperty({ type: [CustomerAddress], description: 'Default address first.' }) addresses!: CustomerAddress[];
  @ApiProperty({ type: CustomerHistory }) history!: CustomerHistory;
}

export class Courier {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CreateCourierRequest {
  @ApiProperty({ minLength: 1, maxLength: 80, description: 'Trimmed.' }) name!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Normalised like the web; blank or null clears it.' })
  phone?: string | null;
}

export class UpdateCourierRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 }) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Blank or null clears it.' }) phone?: string | null;
  @ApiPropertyOptional() isActive?: boolean;
}

export class PrepaidMethod {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

/** The order_deliveries row in camelCase (lib/delivery/types.ts DeliveryOrder). */
export class DeliveryOrder {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ description: 'Per-restaurant order number (orders.order_number); shown as #D-0412.' }) orderNumber!: number;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() customerPhone!: string;
  @ApiProperty() addressLine!: string;
  @ApiProperty({ type: String, nullable: true }) neighborhood!: string | null;
  @ApiProperty({ type: String, nullable: true }) addressReference!: string | null;
  @ApiProperty({ description: 'Whole COP pesos.' }) deliveryFee!: number;
  @ApiProperty({ enum: PAYMENT_MODES }) paymentMode!: PaymentMode;
  @ApiProperty({ type: Number, nullable: true }) cashChangeFor!: number | null;
  @ApiProperty({ type: PrepaidMethod, nullable: true, description: 'Payment channel of a prepaid order; null when not captured.' })
  prepaidMethod!: PrepaidMethod | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) courierId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When the courier is expected back, typed at dispatch.' })
  courierEta!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Where the courier is, typed at dispatch.' }) courierLocation!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Courier back at the restaurant.' }) returnedAt!: string | null;
  @ApiProperty({ enum: DELIVERY_STATUSES }) status!: DeliveryStatus;
  @ApiProperty({ type: String, nullable: true }) failureReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dispatchedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deliveredAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) failedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) cancelledAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

class CreateDeliveryCustomer {
  @ApiPropertyOptional({ maxLength: 100, description: `Existing customer; uuid and exclusive with phone, ${BY_RPC}.` }) id?: string;
  @ApiPropertyOptional({ maxLength: 100, description: `Looked up or registered by phone; 7..15 digits ${BY_RPC} (not normalised).` })
  phone?: string;
  @ApiPropertyOptional({ maxLength: TEXT_MAX, description: `Required for a new customer (1..120 chars, ${BY_RPC}); renames an existing one when different.` })
  name?: string;
}

class CreateDeliveryAddress {
  @ApiPropertyOptional({ maxLength: 100, description: `Saved address of the customer; uuid and exclusive with addressLine, ${BY_RPC}.` })
  id?: string;
  @ApiPropertyOptional({ maxLength: TEXT_MAX, description: `Required without id; 1..200 chars ${BY_RPC}.` }) addressLine?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEXT_MAX, description: `<= 80 chars ${BY_RPC}.` })
  neighborhood?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEXT_MAX, description: `<= 200 chars ${BY_RPC}.` })
  reference?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEXT_MAX, description: `<= 40 chars ${BY_RPC}.` })
  label?: string | null;
  @ApiPropertyOptional({ description: 'Store the new address in customer_addresses (default false).' }) save?: boolean;
}

class CreateDeliveryItemModifier {
  @ApiProperty({ format: 'uuid' }) optionId!: string;
}

class CreateDeliveryItem {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ type: 'integer', description: `Integer; 1..999 ${BY_RPC}.` }) quantity!: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEXT_MAX }) comments?: string | null;
  @ApiPropertyOptional({
    type: [CreateDeliveryItemModifier],
    maxItems: 50,
    description:
      'Options of the line (F7): priced and checked like table orders; 422 code modifier_invalid | modifier_inactive | modifier_duplicate | modifier_required | modifier_max.',
  })
  modifiers?: CreateDeliveryItemModifier[];
}

export class CreateDeliveryOrderRequest {
  @ApiProperty({ type: CreateDeliveryCustomer }) customer!: CreateDeliveryCustomer;
  @ApiProperty({ type: CreateDeliveryAddress }) address!: CreateDeliveryAddress;
  @ApiProperty({
    type: [CreateDeliveryItem],
    maxItems: MAX_LINES,
    description: `1..100 lines together with the combo choices ${BY_RPC}; may be empty when combos are sent.`,
  })
  items!: CreateDeliveryItem[];
  @ApiPropertyOptional({
    type: [ComboLineRequest],
    maxItems: MAX_COMBOS,
    description:
      'Combos live now for the delivery channel. Each combo inserts one line per choice at list price (its options included), sharing a comboId, plus one combo discount: sum of the dish list prices WITHOUT options - comboPrice, so the options of a component are charged on top. 422 code combo_unknown | combo_inactive | combo_group_missing | combo_choice_invalid | combo_duplicate_group; nothing is stored.',
  })
  combos?: ComboLineRequest[];
  @ApiProperty({ type: 'integer', description: `Whole COP pesos; >= 0 ${BY_RPC}.` }) deliveryFee!: number;
  @ApiProperty({ enum: PAYMENT_MODES }) paymentMode!: PaymentMode;
  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    description: `Only for cash_on_delivery (a value on prepaid is a 422 from the API); >= 0 ${BY_RPC}.`,
  })
  cashChangeFor?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: TEXT_MAX, description: `<= 300 chars ${BY_RPC}.` }) notes?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: `Payment channel of a prepaid order: an active payment method of the restaurant, ${BY_RPC}.`,
  })
  prepaidMethodId?: string | null;
}

export class CreateDeliveryOrderResult {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ format: 'uuid' }) customerId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Only when a new address was saved.' })
  addressId!: string | null;
  @ApiProperty({ type: DeliveryOrder }) delivery!: DeliveryOrder;
  @ApiProperty({ type: ConsumeOrderStockResult, description: 'consume_order_stock of the new order; shortages do not undo it.' })
  consumption!: ConsumeOrderStockResult;
  @ApiProperty({
    type: PrintJobCreated,
    nullable: true,
    description: 'Kitchen command job (the first one with stations); its id is the command invoiceNumber. null when the restaurant does not use printers.',
  })
  printJob!: PrintJobCreated | null;
}

export class SetDeliveryStatusRequest {
  @ApiProperty({ enum: DELIVERY_ACTIONS }) action!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Required for dispatch.' }) courierId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Required for fail (1..200 chars).' }) reason?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Only with dispatch: when the courier is expected back, after now and within 6 hours (validated by set_delivery_status).',
  })
  courierEta?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_MAX,
    description: 'Only with dispatch: where the courier is, trimmed 1..60 chars (validated by set_delivery_status).',
  })
  courierLocation?: string | null;
}

/** GET /delivery/closed-today: the board's terminal deliveries of the restaurant day. */
export class ClosedTodaySummary {
  @ApiProperty({ type: 'integer', description: 'Delivered deliveries updated today.' }) deliveredCount!: number;
  @ApiProperty({ type: 'integer', description: 'Cancelled deliveries updated today.' }) cancelledCount!: number;
  @ApiProperty({ type: 'integer', description: 'Deliveries currently failed that failed today.' }) failedCount!: number;
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: 'Average dispatched_at → delivered_at of the delivered ones, rounded minutes; null without any.',
  })
  averageDeliveryMinutes!: number | null;
}

/** One row of the operator board (DeliveryOrderWithBill). */
export class DeliveryOrderWithBill {
  @ApiProperty({ type: DeliveryOrder }) delivery!: DeliveryOrder;
  @ApiProperty({ description: 'subtotal + tax (no delivery fee, no tip).' }) amountDue!: number;
  @ApiProperty() subtotal!: number;
  @ApiProperty() tax!: number;
  @ApiProperty({ description: 'orders.status = paid.' }) isPaid!: boolean;
}
