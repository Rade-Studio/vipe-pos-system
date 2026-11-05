import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { csvOf, dateQuery, guidListQuery } from '../common/validation';
import { LegacyPaymentTransaction, PAYMENT_METHOD_KINDS, type PaymentMethodKind } from '../payments/payments.dto';

export const REGISTER_INCLUDES = ['transactions', 'cashTransactions'] as const;
export const CASH_TRANSACTION_TYPES = ['deposit', 'withdrawal'] as const;
export type CashTransactionType = (typeof CASH_TRANSACTION_TYPES)[number];
/** register_summary accepts at most 100 ids. */
const MAX_SUMMARY_IDS = 100;
/** numeric(10,2) columns. */
const money = z.number().max(99_999_999.99);

export const registerIncludeQuerySchema = z.strictObject({ include: csvOf(REGISTER_INCLUDES).optional() });
export const registerListQuerySchema = registerIncludeQuerySchema.extend({ date: dateQuery.optional() });
export const registerSummaryQuerySchema = z.strictObject({ ids: guidListQuery(MAX_SUMMARY_IDS).pipe(z.array(z.guid()).min(1)) });

/** No timestamps from the client: the server stamps opening and cash movements. */
export const openRegisterSchema = z.strictObject({ initialCash: money.min(0) });
export const createCashTransactionSchema = z.strictObject({
  amount: money.positive(),
  type: z.enum(CASH_TRANSACTION_TYPES),
  description: z.string().trim().max(500).nullable().optional(),
});

export class CashTransaction {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: CASH_TRANSACTION_TYPES }) type!: CashTransactionType;
  @ApiProperty({ description: 'Empty string when none was given.' }) description!: string;
  @ApiProperty({ format: 'date-time', description: 'Server clock.' }) timestamp!: string;
}

export class CashRegister {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time', description: 'Server clock.' }) openingTimestamp!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closingTimestamp!: string | null;
  @ApiProperty() initialCash!: number;
  @ApiProperty({ type: Number, nullable: true }) finalCash!: number | null;
  @ApiProperty({ enum: ['open', 'closed'] }) status!: 'open' | 'closed';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
  @ApiPropertyOptional({ type: [LegacyPaymentTransaction], description: 'Only with include=transactions; legacy payment_transactions, newest first.' })
  transactions?: LegacyPaymentTransaction[];
  @ApiPropertyOptional({ type: [CashTransaction], description: 'Only with include=cashTransactions; newest first.' })
  cashTransactions?: CashTransaction[];
}

export class OpenRegisterRequest {
  @ApiProperty({ minimum: 0 }) initialCash!: number;
}

export class CreateCashTransactionRequest {
  @ApiProperty({ minimum: 0.01 }) amount!: number;
  @ApiProperty({ enum: CASH_TRANSACTION_TYPES }) type!: CashTransactionType;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) description?: string | null;
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

export class CloseRegisterResult {
  @ApiProperty({ enum: ['closed', 'already_closed'] }) status!: 'closed' | 'already_closed';
  @ApiProperty({ format: 'uuid' }) cashRegisterId!: string;
  @ApiProperty({ description: 'expected_cash_after_tips at the close, from the database.' }) finalCash!: number;
  @ApiProperty({ format: 'date-time', description: 'Server clock of the close (the original one on a replay).' })
  closingTimestamp!: string;
  @ApiProperty({ type: RegisterSummary }) summary!: RegisterSummary;
}
