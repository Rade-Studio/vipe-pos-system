import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { csvOf, dateQuery, guidListQuery } from '../common/validation';
import { LegacyPaymentTransaction, PAYMENT_METHOD_KINDS, type PaymentMethodKind } from '../payments/payments.dto';

export const REGISTER_INCLUDES = ['transactions', 'cashTransactions'] as const;
export const CASH_TRANSACTION_TYPES = ['deposit', 'withdrawal'] as const;
export type CashTransactionType = (typeof CASH_TRANSACTION_TYPES)[number];
/** Why the cash moved (migration 0025); `other` requires a description. */
export const CASH_TRANSACTION_REASONS = ['change_fund', 'supplier', 'petty_cash', 'tips_payout', 'safe_deposit', 'other'] as const;
export type CashTransactionReason = (typeof CASH_TRANSACTION_REASONS)[number];
/** Colombian bills and coins, in pesos, accepted in the close count. */
export const DENOMINATION_VALUES = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50] as const;
/** register_summary accepts at most 100 ids. */
const MAX_SUMMARY_IDS = 100;
/** GET /registers/:id/paid-orders returns at most this many rows (default 100). */
export const PAID_ORDERS_MAX = 200;
export const PAID_ORDERS_DEFAULT = 100;
/** numeric(10,2) columns. */
const money = z.number().max(99_999_999.99);
/** Whole pesos in a numeric(10,2) column. */
const wholePesos = z.number().int().min(0).max(99_999_999);

export const registerIncludeQuerySchema = z.strictObject({ include: csvOf(REGISTER_INCLUDES).optional() });
export const registerListQuerySchema = registerIncludeQuerySchema.extend({ date: dateQuery.optional() });
export const registerSummaryQuerySchema = z.strictObject({ ids: guidListQuery(MAX_SUMMARY_IDS).pipe(z.array(z.guid()).min(1)) });

export const paidOrdersQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(PAID_ORDERS_MAX).optional(),
});
/**
 * No timestamps and no opener from the client: the server stamps the opening
 * and cash movements, and opened_by defaults to the caller's profile (an
 * `openedBy` field is an unknown field, 422).
 */
export const openRegisterSchema = z.strictObject({ initialCash: money.min(0) });
/**
 * Close body: `leaveOpenOrders: true` confirms that open orders pass to the
 * next register. `countedCash` is required while the register is open (the
 * service answers 422 counted_cash_required), `denominations` must add up to
 * it and `note` is required when the count differs from the expected cash.
 */
export const closeRegisterSchema = z.strictObject({
  leaveOpenOrders: z.boolean().optional(),
  countedCash: wholePesos.optional(),
  denominations: z
    .array(
      z.strictObject({
        value: z.union(DENOMINATION_VALUES.map((value) => z.literal(value))),
        quantity: z.number().int().min(0).max(100_000),
      }),
    )
    .max(DENOMINATION_VALUES.length * 2)
    .optional(),
  note: z.string().trim().min(3).max(300).nullable().optional(),
});
export type CloseRegisterInput = z.infer<typeof closeRegisterSchema>;
export const createCashTransactionSchema = z.strictObject({
  amount: money.positive(),
  type: z.enum(CASH_TRANSACTION_TYPES),
  reason: z.enum(CASH_TRANSACTION_REASONS),
  description: z.string().trim().max(500).nullable().optional(),
});

export class CashTransaction {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: CASH_TRANSACTION_TYPES }) type!: CashTransactionType;
  @ApiProperty({ description: 'Empty string when none was given.' }) description!: string;
  @ApiProperty({ format: 'date-time', description: 'Server clock.' }) timestamp!: string;
  @ApiProperty({ enum: CASH_TRANSACTION_REASONS, nullable: true, description: 'null for movements recorded before migration 0025.' })
  reason!: CashTransactionReason | null;
  @ApiProperty({
    type: () => ProfileRef,
    nullable: true,
    description: 'Who recorded it (the caller); null for movements before migration 0025 or a deleted profile.',
  })
  createdBy!: ProfileRef | null;
}

export class ProfileRef {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'profiles.full_name.' }) name!: string;
}

export class Denomination {
  @ApiProperty({ enum: DENOMINATION_VALUES, description: 'Bill or coin value in pesos.' }) value!: number;
  @ApiProperty({ minimum: 0 }) quantity!: number;
}

/** The count stored at the close (migration 0025); every field is null for registers closed before it, or still open. */
export class RegisterCount {
  @ApiProperty({ type: Number, nullable: true, description: 'Cash counted by the cashier (whole pesos).' }) countedCash!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'countedCash - finalCash (expected after tips).' }) cashDifference!: number | null;
  @ApiProperty({ type: String, nullable: true }) closeNote!: string | null;
  @ApiProperty({ type: [Denomination], nullable: true }) denominations!: Denomination[] | null;
  @ApiProperty({ type: ProfileRef, nullable: true, description: 'Who closed it (the caller).' }) closedBy!: ProfileRef | null;
}
export class CashRegister extends RegisterCount {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time', description: 'Server clock.' }) openingTimestamp!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closingTimestamp!: string | null;
  @ApiProperty() initialCash!: number;
  @ApiProperty({ type: Number, nullable: true }) finalCash!: number | null;
  @ApiProperty({ enum: ['open', 'closed'] }) status!: 'open' | 'closed';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiProperty({
    type: ProfileRef,
    nullable: true,
    description: "Who opened it: always the caller's profile at open; null for registers opened before migration 0014 or a deleted profile.",
  })
  openedBy!: ProfileRef | null;
  @ApiPropertyOptional({ type: [LegacyPaymentTransaction], description: 'Only with include=transactions; legacy payment_transactions, newest first.' })
  transactions?: LegacyPaymentTransaction[];
  @ApiPropertyOptional({ type: [CashTransaction], description: 'Only with include=cashTransactions; newest first.' })
  cashTransactions?: CashTransaction[];
}

export class OpenRegisterRequest {
  @ApiProperty({ minimum: 0 }) initialCash!: number;
}

export class CloseRegisterRequest {
  @ApiPropertyOptional({ description: 'Close even though the restaurant has open orders; they stay open for the next register.' })
  leaveOpenOrders?: boolean;
  @ApiPropertyOptional({
    minimum: 0,
    description: 'Cash counted (whole pesos); required while the register is open (422 counted_cash_required). Ignored on an already closed register.',
  })
  countedCash?: number;
  @ApiPropertyOptional({ type: [Denomination], description: 'Count by bill and coin; the sum must equal countedCash (422 count_mismatch).' })
  denominations?: Denomination[];
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 3,
    maxLength: 300,
    description: 'Trimmed; required when countedCash differs from the expected cash after tips (422 note_required).',
  })
  note?: string | null;
}

export class CreateCashTransactionRequest {
  @ApiProperty({ minimum: 0.01 }) amount!: number;
  @ApiProperty({ enum: CASH_TRANSACTION_TYPES }) type!: CashTransactionType;
  @ApiProperty({ enum: CASH_TRANSACTION_REASONS }) reason!: CashTransactionReason;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Required (not blank) when reason is other (422 description_required).',
  })
  description?: string | null;
}

export class RegisterMethodSummary {
  @ApiProperty({ format: 'uuid' }) paymentMethodId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) kind!: PaymentMethodKind;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() total!: number;
  @ApiProperty() tendersCount!: number;
}

export class RegisterLegacySummary {
  @ApiProperty() paymentsCount!: number;
  @ApiProperty() total!: number;
  @ApiProperty() tips!: number;
  @ApiProperty() change!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' }, description: 'Legacy total per free-text method.' })
  byMethod!: Record<string, number>;
}

/** register_summary in camelCase; every number is computed by the database. */
export class RegisterSummary {
  @ApiProperty() registersCount!: number;
  @ApiProperty() initialCash!: number;
  @ApiProperty() paymentsCount!: number;
  @ApiProperty() totalBilled!: number;
  @ApiProperty() totalTips!: number;
  @ApiProperty() totalSales!: number;
  @ApiProperty() totalChange!: number;
  @ApiProperty({ type: [RegisterMethodSummary] }) methods!: RegisterMethodSummary[];
  @ApiProperty() cashDeposits!: number;
  @ApiProperty() cashWithdrawals!: number;
  @ApiProperty() expectedCash!: number;
  @ApiProperty() tipsPayout!: number;
  @ApiProperty() expectedCashAfterTips!: number;
  @ApiProperty({ type: RegisterLegacySummary }) legacy!: RegisterLegacySummary;
}

export class CloseRegisterResult extends RegisterCount {
  @ApiProperty({ enum: ['closed', 'already_closed'] }) status!: 'closed' | 'already_closed';
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty({ description: 'expected_cash_after_tips at the close, from the database.' }) finalCash!: number;
  @ApiProperty({ format: 'date-time', description: 'Server clock of the close (the original one on a replay).' })
  closingTimestamp!: string;
  @ApiProperty({ type: RegisterSummary }) summary!: RegisterSummary;
}
export class PaidOrderTender {
  @ApiProperty({ description: 'Snapshot at payment time.' }) methodCode!: string;
  @ApiProperty({ description: 'Current catalog name of the method.' }) methodName!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) methodKind!: PaymentMethodKind;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
}
/** One pay_order payment of the register with its order context (legacy payment_transactions are not listed). */
export class RegisterPaidOrder {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Per-restaurant order number.' }) orderNumber!: number | null;
  @ApiProperty({ enum: ['dine_in', 'delivery'] }) orderType!: 'dine_in' | 'delivery';
  @ApiProperty({ type: Number, nullable: true }) tableNumber!: number | null;
  @ApiProperty({ type: String, nullable: true }) zoneName!: string | null;
  @ApiProperty({ type: ProfileRef, nullable: true, description: "The order's waiter." }) waiter!: ProfileRef | null;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty({ description: 'amount_due of the payment.' }) amountDue!: number;
  @ApiProperty() tip!: number;
  @ApiProperty({ description: 'total_charged (amount due + tip).' }) total!: number;
  @ApiProperty({ format: 'date-time', description: 'Payment time.' }) paidAt!: string;
  @ApiProperty({ type: [PaidOrderTender], description: 'By line number.' }) tenders!: PaidOrderTender[];
}
