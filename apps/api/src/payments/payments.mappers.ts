import { sql } from '@vipe/db';
import { reasonOf, staffRef } from '../audit/audit.mappers';
import { toIso } from '../common/validation';
import type {
  LegacyPaymentTransaction,
  OrderBillSummary,
  Payment,
  PaymentMethod,
  PaymentMethodKind,
  PaymentTender,
  PaymentVoid,
  PayOrderResult,
  SplitOrderResult,
  UndoSplitResult,
} from './payments.dto';

type Json = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const time = (value: unknown) => toIso(text(value));
/**
 * A required bigint or numeric field (JSON numbers through to_jsonb /
 * jsonb_build_object). A missing one is a contract break, not a zero: it throws
 * a plain Error, which the filter answers as 500.
 */
export function req(row: Json, field: string): number {
  const value = row[field];
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    throw new Error(`Database result is missing the required field ${field}`);
  }
  return Number(value);
}
/** Nullable columns only. */
export const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * One payment with its tender lines (by line_no) as jsonb, for a query whose
 * FROM has `public.payments p`. Shared by GET /payments and GET /orders/completed.
 */
export const paymentJson = sql`
  to_jsonb(p) || jsonb_build_object('tenders',
    coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.line_no)
                FROM public.payment_tenders t WHERE t.payment_id = p.id), '[]'::jsonb))`;

export const toPaymentMethod = (row: Json): PaymentMethod => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  kind: row.kind as PaymentMethodKind,
  isActive: row.is_active === true,
  sortOrder: req(row, 'sort_order'),
});

/** pay_order result (snake_case jsonb) in camelCase; alreadyPaid mirrors the status. */
export function toPayOrderResult(row: Json): PayOrderResult {
  const status = row.status as PayOrderResult['status'];
  return {
    paymentId: String(row.payment_id),
    status,
    alreadyPaid: status === 'already_paid',
    amountDue: req(row, 'amount_due'),
    tipAmount: req(row, 'tip_amount'),
    totalCharged: req(row, 'total_charged'),
    changeGiven: req(row, 'change_given'),
    drawerWarning: row.drawer_warning === true,
    drawerCashBefore: req(row, 'drawer_cash_before'),
    tenders: ((row.tenders as Json[] | null) ?? []).map((tender) => ({
      lineNo: req(tender, 'line_no'),
      methodCode: String(tender.method_code),
      amount: req(tender, 'amount'),
      cashReceived: numOrNull(tender.cash_received),
    })),
  };
}

const toTender = (row: Json): PaymentTender => ({
  id: String(row.id),
  paymentId: String(row.payment_id),
  lineNo: req(row, 'line_no'),
  paymentMethodId: String(row.payment_method_id),
  methodCode: String(row.method_code),
  methodKind: row.method_kind as PaymentMethodKind,
  amount: req(row, 'amount'),
  cashReceived: numOrNull(row.cash_received),
  reference: text(row.reference),
});

/** A `paymentJson` value. */
export const toPayment = (row: Json): Payment => ({
  id: String(row.id),
  orderId: String(row.order_id),
  cashRegisterId: String(row.cash_register_id),
  cashierProfileId: text(row.cashier_profile_id),
  amountDue: req(row, 'amount_due'),
  tipAmount: req(row, 'tip_amount'),
  totalCharged: req(row, 'total_charged'),
  changeGiven: req(row, 'change_given'),
  idempotencyKey: String(row.idempotency_key),
  createdAt: time(row.created_at)!,
  tenders: ((row.tenders as Json[] | null) ?? []).map(toTender),
});

export const toLegacyTransaction = (row: Json): LegacyPaymentTransaction => ({
  id: String(row.id),
  orderId: String(row.order_id),
  tableId: text(row.table_id),
  waiterId: text(row.waiter_id),
  amount: req(row, 'amount'),
  tipAmount: numOrNull(row.tip_amount),
  totalDiscounts: numOrNull(row.total_discounts),
  method: String(row.method),
  cashReceived: numOrNull(row.cash_received),
  cashChange: numOrNull(row.cash_change),
  timestamp: time(row.timestamp)!,
  cashRegisterId: String(row.cash_register_id),
});

const toBill = (row: Json): OrderBillSummary => ({
  orderId: String(row.order_id),
  subtotal: req(row, 'subtotal'),
  tax: req(row, 'tax'),
  tip: req(row, 'tip'),
  total: req(row, 'total'),
});

export const toSplitResult = (row: Json): SplitOrderResult => ({
  childOrderId: String(row.child_order_id),
  parent: toBill(row.parent as Json),
  child: toBill(row.child as Json),
});

export const toUndoSplitResult = (row: Json): UndoSplitResult => ({ parent: toBill(row.parent as Json) });

/** One public.payment_voids row (to_jsonb) with its tender snapshot. */
export const toPaymentVoid = (row: Json): PaymentVoid => ({
  id: String(row.id),
  paymentId: String(row.payment_id),
  orderId: String(row.order_id),
  cashRegisterId: String(row.cash_register_id),
  amountDue: req(row, 'amount_due'),
  tipAmount: req(row, 'tip_amount'),
  totalCharged: req(row, 'total_charged'),
  changeGiven: req(row, 'change_given'),
  methods: String(row.methods),
  tenders: ((row.tenders as Json[] | null) ?? []).map((t) => ({
    lineNo: req(t, 'line_no'),
    paymentMethodId: String(t.payment_method_id),
    methodCode: String(t.method_code),
    methodKind: t.method_kind as PaymentMethodKind,
    amount: req(t, 'amount'),
    cashReceived: numOrNull(t.cash_received),
    reference: text(t.reference),
  })),
  paidAt: time(row.paid_at)!,
  ...reasonOf(row),
  voidedBy: staffRef(row.voided_by, row.voided_by_name),
  authorizedBy: staffRef(row.authorized_by, row.authorized_by_name),
  selfAuthorized: row.self_authorized === true,
  voidedAt: time(row.voided_at)!,
});
