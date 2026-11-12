import { ApiProperty } from '@nestjs/swagger';
import { dateQuery } from '../common/validation';
import { PAYMENT_METHOD_KINDS, type PaymentMethodKind } from '../payments/payments.dto';
import { ProfileRef } from '../registers/registers.dto';

export const DAY_STATUSES = ['open', 'closed', 'empty'] as const;
export const VOID_KINDS = ['payment_void', 'order_cancellation', 'item_void'] as const;
export type VoidKind = (typeof VOID_KINDS)[number];

export const dayParamSchema = dateQuery;

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
}
