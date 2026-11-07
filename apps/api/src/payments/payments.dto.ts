import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { StaffRef } from '../audit/audit.dto';
import { OTHER_TEXT_ISSUE, requireOtherText, VOID_REASON_CODES, VOID_REASONS, voidReasonFields, type VoidReason } from '../audit/voids';
import { guidListQuery } from '../common/validation';

export const PAYMENT_METHOD_KINDS = ['cash', 'electronic'] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];
/** pay_order accepts at most 20 tender lines, split_order 50 items. */
const MAX_TENDERS = 20;
const MAX_SPLIT_ITEMS = 50;
/** GET /payments accepts at most this many ids per filter. */
export const PAYMENT_FILTER_LIMIT = 500;
/** Whole COP pesos (bigint columns). */
const pesos = z.number().int().max(Number.MAX_SAFE_INTEGER);

// ---- Payment methods --------------------------------------------------------

/** The CHECK constraint allows 1..60 chars after trim. */
const methodName = z.string().trim().min(1).max(60);

export const createPaymentMethodSchema = z.strictObject({ name: methodName, kind: z.enum(PAYMENT_METHOD_KINDS) });

/** `code` is immutable (guard trigger) and `sortOrder` changes go through PUT /payments/methods/order. */
export const updatePaymentMethodSchema = z
  .strictObject({ name: methodName.optional(), isActive: z.boolean().optional() })
  .refine((patch) => patch.name !== undefined || patch.isActive !== undefined, 'At least one of name or isActive is required');

export const reorderPaymentMethodsSchema = z.strictObject({ ids: z.array(z.guid()).min(1).max(200) });

export class PaymentMethod {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Stable key derived from the name on create; immutable.' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS, description: 'Only cash gives change.' }) kind!: PaymentMethodKind;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class CreatePaymentMethodRequest {
  @ApiProperty({ minLength: 1, maxLength: 60 }) name!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) kind!: PaymentMethodKind;
}

export class UpdatePaymentMethodRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 }) name?: string;
  @ApiPropertyOptional() isActive?: boolean;
}

export class ReorderPaymentMethodsRequest {
  @ApiProperty({ type: [String], description: 'Every payment method id of the restaurant, once, in the new order.' })
  ids!: string[];
}

// ---- Payments (pay_order) ---------------------------------------------------

/** Tabs and line breaks become one space, then trim; payment_tenders.reference allows 1..60 chars. */
export const normalizeTenderReference = (value: string) => value.replace(/[\t\n\r\f\v]+/g, ' ').trim();
export const TENDER_REFERENCE_MAX = 60;
const tenderReference = z.string().transform(normalizeTenderReference).pipe(z.string().min(1).max(TENDER_REFERENCE_MAX));
/** 422 for a reference on a cash line (the RPC would store it). */
export const CASH_REFERENCE_MESSAGE = 'Una línea en efectivo no lleva referencia';

const tenderInputSchema = z.strictObject({
  paymentMethodId: z.guid(),
  amount: pesos.positive(),
  /** Cash handed over on a cash line; null (or omitted) on an electronic one. */
  cashReceived: pesos.positive().nullable().optional(),
  /** Manual card/transfer reference (non-cash lines only); null (or omitted) means none. */
  reference: tenderReference.nullable().optional(),
});

export const payOrderSchema = z.strictObject({
  orderId: z.guid(),
  cashRegisterId: z.guid(),
  tipAmount: pesos.min(0),
  tenders: z.array(tenderInputSchema).min(1).max(MAX_TENDERS),
  idempotencyKey: z.guid(),
});

/** `?orderIds=a,b` or `?cashRegisterIds=a,b`, exactly one; an empty value answers []. */
export const paymentListQuerySchema = z
  .strictObject({
    orderIds: guidListQuery(PAYMENT_FILTER_LIMIT).optional(),
    cashRegisterIds: guidListQuery(PAYMENT_FILTER_LIMIT).optional(),
  })
  .refine((query) => (query.orderIds === undefined) !== (query.cashRegisterIds === undefined), 'Send exactly one of orderIds or cashRegisterIds');

export class PayOrderTenderInput {
  @ApiProperty({ format: 'uuid' }) paymentMethodId!: string;
  @ApiProperty({ minimum: 1, description: 'Applied amount in whole pesos (capped for cash).' }) amount!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Cash handed over; required for cash, null for electronic.' })
  cashReceived?: number | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: TENDER_REFERENCE_MAX,
    description: `Card last digits, approval code or transfer reference, captured by hand. Non-cash lines only (422 \`${CASH_REFERENCE_MESSAGE}\`); tabs and line breaks become spaces, then trimmed to 1..${TENDER_REFERENCE_MAX} chars. Not echoed in the result; read it from the payment tenders.`,
  })
  reference?: string | null;
}

export class PayOrderRequest {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty({ minimum: 0 }) tipAmount!: number;
  @ApiProperty({ type: [PayOrderTenderInput], minItems: 1, maxItems: MAX_TENDERS }) tenders!: PayOrderTenderInput[];
  @ApiProperty({ format: 'uuid', description: 'Same key replays answer already_paid.' }) idempotencyKey!: string;
}

export class PayOrderTenderEcho {
  @ApiProperty() lineNo!: number;
  @ApiProperty() methodCode!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: Number, nullable: true }) cashReceived!: number | null;
}

export class PayOrderResult {
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty({ enum: ['paid', 'already_paid'] }) status!: 'paid' | 'already_paid';
  @ApiProperty({ description: "status === 'already_paid'." }) alreadyPaid!: boolean;
  @ApiProperty() amountDue!: number;
  @ApiProperty() tipAmount!: number;
  @ApiProperty() totalCharged!: number;
  @ApiProperty() changeGiven!: number;
  @ApiProperty({ description: 'Warn only: the change exceeds the cash in the drawer.' }) drawerWarning!: boolean;
  @ApiProperty() drawerCashBefore!: number;
  @ApiProperty({ type: [PayOrderTenderEcho] }) tenders!: PayOrderTenderEcho[];
}

export class PaymentTender {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty() lineNo!: number;
  @ApiProperty({ format: 'uuid' }) paymentMethodId!: string;
  @ApiProperty({ description: 'Snapshot at payment time.' }) methodCode!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) methodKind!: PaymentMethodKind;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: Number, nullable: true }) cashReceived!: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Manual reference of a non-cash line; null when none.' })
  reference!: string | null;
}

export class Payment {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) cashierProfileId!: string | null;
  @ApiProperty() amountDue!: number;
  @ApiProperty() tipAmount!: number;
  @ApiProperty() totalCharged!: number;
  @ApiProperty() changeGiven!: number;
  @ApiProperty({ format: 'uuid' }) idempotencyKey!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [PaymentTender], description: 'By lineNo.' }) tenders!: PaymentTender[];
}

/** A row of the read-only legacy `payment_transactions` history (before pay_order). */
export class LegacyPaymentTransaction {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) tableId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) waiterId!: string | null;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: Number, nullable: true }) tipAmount!: number | null;
  @ApiProperty({ type: Number, nullable: true }) totalDiscounts!: number | null;
  @ApiProperty({ description: 'Free-text legacy method (cash, transfer, nequi, bancolombia).' }) method!: string;
  @ApiProperty({ type: Number, nullable: true }) cashReceived!: number | null;
  @ApiProperty({ type: Number, nullable: true }) cashChange!: number | null;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
}

// ---- Split / undo split -----------------------------------------------------

export const splitOrderSchema = z.strictObject({
  items: z
    .array(z.strictObject({ orderItemId: z.guid(), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(MAX_SPLIT_ITEMS),
});

export class SplitOrderItemInput {
  @ApiProperty({ format: 'uuid' }) orderItemId!: string;
  @ApiProperty({ minimum: 1 }) quantity!: number;
}

export class SplitOrderRequest {
  @ApiProperty({ type: [SplitOrderItemInput], minItems: 1, maxItems: MAX_SPLIT_ITEMS }) items!: SplitOrderItemInput[];
}

export class OrderBillSummary {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() subtotal!: number;
  @ApiProperty() tax!: number;
  @ApiProperty() tip!: number;
  @ApiProperty() total!: number;
}

export class SplitOrderResult {
  @ApiProperty({ format: 'uuid' }) childOrderId!: string;
  @ApiProperty({ type: OrderBillSummary }) parent!: OrderBillSummary;
  @ApiProperty({ type: OrderBillSummary }) child!: OrderBillSummary;
}

export class UndoSplitResult {
  @ApiProperty({ type: OrderBillSummary }) parent!: OrderBillSummary;
}

// ---- Payment void ------------------------------------------------------------

/** POST /payments/:id/void: always with a supervisor authorization (void_payment). */
export const voidPaymentSchema = z.strictObject(voidReasonFields).refine(requireOtherText, OTHER_TEXT_ISSUE);

export class VoidPaymentRequest {
  @ApiProperty({
    enum: VOID_REASON_CODES,
    description: `Fixed list: ${Object.entries(VOID_REASONS)
      .map(([code, label]) => `${code} (${label})`)
      .join(', ')}. other needs reasonText.`,
  })
  reason!: VoidReason;
  @ApiPropertyOptional({ type: String, nullable: true, minLength: 3, maxLength: 200 }) reasonText?: string | null;
  @ApiProperty({ format: 'uuid', description: 'POST /auth/authorize id for action void_payment (403 authorization_required without it).' })
  authorizationId!: string;
}

export class VoidedTender {
  @ApiProperty() lineNo!: number;
  @ApiProperty({ format: 'uuid' }) paymentMethodId!: string;
  @ApiProperty() methodCode!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) methodKind!: PaymentMethodKind;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: Number, nullable: true }) cashReceived!: number | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
}

/** A voided payment (public.payment_voids): it no longer counts in any total; the order is open again. */
export class PaymentVoid {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty() amountDue!: number;
  @ApiProperty() tipAmount!: number;
  @ApiProperty() totalCharged!: number;
  @ApiProperty() changeGiven!: number;
  @ApiProperty({ description: 'Method codes of the tender lines, comma-separated.' }) methods!: string;
  @ApiProperty({ type: [VoidedTender] }) tenders!: VoidedTender[];
  @ApiProperty({ format: 'date-time' }) paidAt!: string;
  @ApiProperty({ enum: VOID_REASON_CODES }) reason!: VoidReason;
  @ApiProperty() reasonLabel!: string;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ type: StaffRef }) voidedBy!: StaffRef;
  @ApiProperty({ type: StaffRef }) authorizedBy!: StaffRef;
  @ApiProperty() selfAuthorized!: boolean;
  @ApiProperty({ format: 'date-time' }) voidedAt!: string;
}
