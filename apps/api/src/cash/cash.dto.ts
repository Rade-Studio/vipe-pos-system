import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { z } from 'zod';
import { dateQuery } from '../common/validation';
import { PAYMENT_METHOD_KINDS, type PaymentMethodKind } from '../payments/payments.dto';
import { CASH_TRANSACTION_TYPES, type CashTransactionReason, type CashTransactionType, ProfileRef } from '../registers/registers.dto';

/** GET /cash/report spans at most this many business days (from and to included). */
export const MAX_REPORT_DAYS = 366;
export const REPORT_GROUPS = ['day', 'week', 'month'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];
export const DAY_STATUSES = ['open', 'closed', 'empty'] as const;
export const VOID_KINDS = ['payment_void', 'order_cancellation', 'item_void'] as const;
export type VoidKind = (typeof VOID_KINDS)[number];
export const LEDGER_KINDS = ['opening', 'payment', 'cash_movement', 'payment_void', 'order_cancellation', 'close', 'validation'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const dayParamSchema = dateQuery;
export const reportQuerySchema = z.strictObject({
  from: dateQuery,
  to: dateQuery,
  group: z.enum(REPORT_GROUPS),
});

/** GET /cash/z?from&to: business days of the Zs, at most MAX_REPORT_DAYS. */
export const zListQuerySchema = z.strictObject({ from: dateQuery, to: dateQuery });
/** GET /cash/z/:number: a positive whole number. */
export const zNumberParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,8}$/, 'Expected a Z number')
  .transform(Number);

export const CASH_MESSAGES = {
  rangeTooLong: `El período no puede superar ${MAX_REPORT_DAYS} días.`,
  rangeInverted: 'La fecha inicial debe ser anterior o igual a la final.',
  dayOpen: 'Hay un turno abierto en este día: ciérralo antes de emitir el informe Z.',
  dayEmpty: 'No hay turnos de caja en este día: no hay nada que cerrar.',
} as const;

const TABLE_DESCRIPTION = 'Table number as text, "Domicilio" for a delivery order, null without table.';

export class CashMethodTotal {
  @ApiProperty({ format: 'uuid', description: 'payment_methods.id.' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) kind!: PaymentMethodKind;
  @ApiProperty({ description: 'Sum of the tenders (tips included), whole pesos.' }) total!: number;
  @ApiProperty({ description: 'Number of tenders.' }) count!: number;
}

/** One register (turno) of the business day, with its register_summary figures and its count. */
export class CashDayRegister {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['open', 'closed'] }) status!: 'open' | 'closed';
  @ApiProperty({ format: 'date-time' }) openedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: string | null;
  @ApiProperty({ type: ProfileRef, nullable: true }) openedBy!: ProfileRef | null;
  @ApiProperty({ type: ProfileRef, nullable: true }) closedBy!: ProfileRef | null;
  @ApiProperty({ type: ProfileRef, nullable: true }) validatedBy!: ProfileRef | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validatedAt!: string | null;
  @ApiProperty({ description: 'Fondo de caja.' }) initialCash!: number;
  @ApiProperty({ description: 'Ventas netas: amount due of the live payments, tips excluded.' }) salesNet!: number;
  @ApiProperty({ description: 'Live payments (tiquetes).' }) tickets!: number;
  @ApiProperty() tips!: number;
  @ApiProperty({ type: [CashMethodTotal], description: 'Every payment method of the catalog, in its order.' }) methods!: CashMethodTotal[];
  @ApiProperty() deposits!: number;
  @ApiProperty() withdrawals!: number;
  @ApiProperty() tipsPayout!: number;
  @ApiProperty({ description: 'Expected cash after the tips payout (expected_cash_after_tips).' }) expected!: number;
  @ApiProperty({ type: Number, nullable: true }) countedCash!: number | null;
  @ApiProperty({ type: Number, nullable: true }) cashDifference!: number | null;
  @ApiProperty({ type: String, nullable: true }) closeNote!: string | null;
}

export class CashDeliveries {
  @ApiProperty() count!: number;
  @ApiProperty({ description: 'Amount due of the delivery payments.' }) amount!: number;
}

export class CashDayTotals {
  @ApiProperty() salesNet!: number;
  @ApiProperty() tickets!: number;
  @ApiProperty({ description: 'round(salesNet / tickets); 0 without tickets.' }) avgTicket!: number;
  @ApiProperty({ description: 'Distinct tables of the paid dine-in orders.' }) tables!: number;
  @ApiProperty({ type: CashDeliveries }) deliveries!: CashDeliveries;
  @ApiProperty() tips!: number;
  @ApiProperty({ type: [CashMethodTotal] }) methods!: CashMethodTotal[];
  @ApiProperty() deposits!: number;
  @ApiProperty() withdrawals!: number;
  @ApiProperty({ description: 'Sum of the registers expected cash after tips.' }) expected!: number;
  @ApiProperty({ description: 'Sum of the stored counts (registers without a count add 0).' }) counted!: number;
  @ApiProperty({ description: 'Sum of cash_difference.' }) difference!: number;
}

export class CashWaiterTips {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: "The order's waiter; null for orders without one." })
  waiterId!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() amount!: number;
}

export class CashVoidItem {
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ enum: VOID_KINDS }) kind!: VoidKind;
  @ApiProperty({ type: Number, nullable: true, description: 'orders.order_number.' }) orderNumber!: number | null;
  @ApiProperty({ type: String, nullable: true, description: TABLE_DESCRIPTION }) table!: string | null;
  @ApiProperty({ description: 'Payment amount due, order total or voided line amount.' }) amount!: number;
  @ApiProperty({ description: 'reason_code of the audited event.' }) reason!: string;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ description: 'Who voided or cancelled (name snapshot).' }) requestedBy!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Supervisor who authorized (name snapshot).' }) authorizedBy!: string | null;
}

export class CashDayVoids {
  @ApiProperty() count!: number;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: [CashVoidItem], description: 'Oldest first.' }) items!: CashVoidItem[];
}

export class CashPreviousDay {
  @ApiProperty({ example: '2026-11-03', description: 'Same weekday of the week before.' }) date!: string;
  @ApiProperty() salesNet!: number;
}

/** The Z emitted for a business day (S8). */
export class CashZRef {
  @ApiProperty({ example: 215 }) number!: number;
  @ApiProperty({ format: 'date-time' }) emittedAt!: string;
  @ApiProperty({ type: ProfileRef, nullable: true, description: 'The admin who emitted it; null when the profile was deleted.' })
  emittedBy!: ProfileRef | null;
}

export class CashDay {
  @ApiProperty({ example: '2026-11-10', description: 'Business day (S5).' }) date!: string;
  @ApiProperty({ enum: DAY_STATUSES, description: 'open when a register of the day is open, empty without registers.' })
  status!: (typeof DAY_STATUSES)[number];
  @ApiProperty({ type: [CashDayRegister], description: 'Oldest opening first.' }) registers!: CashDayRegister[];
  @ApiProperty({ type: CashDayTotals }) totals!: CashDayTotals;
  @ApiProperty({ type: [CashWaiterTips], description: 'Tips of the live payments by the order waiter, highest first.' })
  tipsByWaiter!: CashWaiterTips[];
  @ApiProperty({ type: CashDayVoids }) voids!: CashDayVoids;
  @ApiProperty({ type: CashPreviousDay }) previous!: CashPreviousDay;
  @ApiProperty({ type: CashZRef, nullable: true, description: 'The informe Z of the day; null until it is emitted.' }) z!: CashZRef | null;
}

export class CashTaxes {
  @ApiProperty({ example: 8, description: 'Configured taxPercentage at the emit.' }) rate!: number;
  @ApiProperty({ description: 'Base gravable: round(salesNet / (1 + rate / 100)); prices include the tax, tips never do.' }) base!: number;
  @ApiProperty({ description: 'salesNet - base.' }) tax!: number;
}

export class CashOrderRange {
  @ApiProperty({ type: Number, nullable: true, description: 'Lowest order_number of the paid orders; null without sales.' }) first!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Highest order_number of the paid orders.' }) last!: number | null;
}

export class CashMethodTips {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) kind!: PaymentMethodKind;
  @ApiProperty({ description: 'Tips of the live payments; a payment with several tenders splits its tip by tender amount.' }) amount!: number;
}

/** The day summary frozen at the emit, plus the fiscal details of the Z. */
export class CashZSnapshot extends OmitType(CashDay, ['z'] as const) {
  @ApiProperty({ type: CashTaxes }) taxes!: CashTaxes;
  @ApiProperty({ type: CashOrderRange }) orders!: CashOrderRange;
  @ApiProperty({ description: 'Sum of total_discounts of the paid orders.' }) discounts!: number;
  @ApiProperty({ type: [CashMethodTips], description: 'Catalog order, methods with tips only.' }) tipsByMethod!: CashMethodTips[];
}

export class CashZReport extends CashZRef {
  @ApiProperty({ example: '2026-11-10' }) businessDay!: string;
  @ApiProperty({ type: CashZSnapshot }) snapshot!: CashZSnapshot;
}

export class CashZListItem extends CashZRef {
  @ApiProperty({ example: '2026-11-10' }) businessDay!: string;
  @ApiProperty({ description: 'snapshot.totals.salesNet.' }) salesNet!: number;
  @ApiProperty({ description: 'snapshot.totals.difference (sobrante +, faltante -).' }) difference!: number;
}

export class CashZList {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: [CashZListItem], description: 'Zs whose business day is in the range, by number.' }) items!: CashZListItem[];
  @ApiProperty({ type: [Number], description: 'Numbers between the first and the last listed Z that no Z of the restaurant carries.' })
  gaps!: number[];
}

export class CashLedgerTender {
  @ApiProperty({ description: 'Method name.' }) method!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: PAYMENT_METHOD_KINDS }) kind!: PaymentMethodKind;
  @ApiProperty() amount!: number;
}

/**
 * One event of the day ledger. cashBalance runs per register: it starts at
 * the opening with the initial cash, adds the cash tenders of each payment
 * (a tender amount is already net of the change), adds deposits, subtracts
 * withdrawals and the cash tenders of a voided payment; cancellations, the
 * close and the validation move no cash. At the close it equals the expected
 * cash before the tips payout (expected_cash); `expected` on the close is
 * the expected cash after tips (final_cash), which the count is compared to.
 */
export class CashLedgerEntry {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Group key; null for a cancellation outside every register.' })
  registerId!: string | null;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ enum: LEDGER_KINDS }) kind!: LedgerKind;
  @ApiProperty() cashDelta!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Running cash of the register after this entry.' }) cashBalance!: number | null;
  @ApiPropertyOptional({ description: 'Fondo (opening), amount due (payment, payment_void), movement amount or order total.' })
  amount?: number;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true }) openedBy?: ProfileRef | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) orderNumber?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: TABLE_DESCRIPTION }) table?: string | null;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true }) waiter?: ProfileRef | null;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true, description: 'Who took the payment.' }) cashier?: ProfileRef | null;
  @ApiPropertyOptional({ type: [CashLedgerTender] }) tenders?: CashLedgerTender[];
  @ApiPropertyOptional() tip?: number;
  @ApiPropertyOptional({ description: 'Payment entries only: the payment was voided later (its payment_void entry takes the cash back).' })
  voided?: boolean;
  @ApiPropertyOptional() change?: number;
  @ApiPropertyOptional({ enum: CASH_TRANSACTION_TYPES }) type?: CashTransactionType;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Movement reason (cash_movement) or reason_code (voids).' })
  reason?: CashTransactionReason | string | null;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true }) createdBy?: ProfileRef | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reasonText?: string | null;
  @ApiPropertyOptional() requestedBy?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) authorizedBy?: string | null;
  @ApiPropertyOptional({ description: 'Expected cash after tips (final_cash).' }) expected?: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) counted?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) difference?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) note?: string | null;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true }) closedBy?: ProfileRef | null;
  @ApiPropertyOptional({ type: ProfileRef, nullable: true }) validatedBy?: ProfileRef | null;
}

export class CashLedger {
  @ApiProperty({ example: '2026-11-10' }) date!: string;
  @ApiProperty({ type: [CashLedgerEntry], description: 'Chronological; opening first and validation last on ties.' }) entries!: CashLedgerEntry[];
}

export class CashVoidTotals {
  @ApiProperty() count!: number;
  @ApiProperty() amount!: number;
}

export class CashPeriodBucket {
  @ApiProperty({ example: '2026-11-02', description: 'First business day of the bucket, clipped to the range.' }) start!: string;
  @ApiProperty({ example: '2026-11-08', description: 'Last business day of the bucket, clipped to the range.' }) end!: string;
  @ApiProperty() salesNet!: number;
  @ApiProperty() tickets!: number;
  @ApiProperty() avgTicket!: number;
  @ApiProperty() tips!: number;
  @ApiProperty({ type: [CashMethodTotal] }) methods!: CashMethodTotal[];
  @ApiProperty({ description: 'Sum of cash_difference of the registers.' }) difference!: number;
  @ApiProperty({ type: CashVoidTotals }) voids!: CashVoidTotals;
}

export class CashCashierDifference {
  @ApiProperty({ format: 'uuid' }) profileId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Registers opened by the profile.' }) shifts!: number;
  @ApiProperty({ description: 'Sum of cash_difference (sobrante +, faltante -).' }) difference!: number;
}

export class CashReport {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ enum: REPORT_GROUPS }) group!: ReportGroup;
  @ApiProperty({ type: [CashPeriodBucket], description: 'Every bucket of the range, empty ones included; weeks start on Monday.' })
  buckets!: CashPeriodBucket[];
  @ApiProperty({ type: CashPeriodBucket }) totals!: CashPeriodBucket;
  @ApiProperty({ type: CashPeriodBucket, description: 'The period of the same length right before `from`.' }) previous!: CashPeriodBucket;
  @ApiProperty({ type: [CashCashierDifference], description: 'By name.' }) byCashier!: CashCashierDifference[];
  @ApiProperty({ type: [CashWaiterTips] }) tipsByWaiter!: CashWaiterTips[];
}
