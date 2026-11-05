import { toIso } from '../common/validation';
import type { PaymentMethodKind } from '../payments/payments.dto';
import { numOrNull, req, toLegacyTransaction } from '../payments/payments.mappers';
import type { CashRegister, CashTransaction, CashTransactionType, CloseRegisterResult, RegisterSummary } from './registers.dto';

type Json = Record<string, unknown>;

/** One row of RegistersService.select: the register and its optional embeds as jsonb (null when not requested). */
export interface RegisterRow {
  register: Json;
  transactions: Json[] | null;
  cash_transactions: Json[] | null;
}

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const time = (value: unknown) => toIso(text(value));

export const toCashTransaction = (row: Json): CashTransaction => ({
  id: String(row.id),
  cashRegisterId: String(row.cash_register_id),
  amount: req(row, 'amount'),
  type: row.type as CashTransactionType,
  description: text(row.description) ?? '',
  timestamp: time(row.timestamp)!,
});

export function toRegister(row: RegisterRow): CashRegister {
  const r = row.register;
  const register: CashRegister = {
    id: String(r.id),
    openingTimestamp: time(r.opening_timestamp)!,
    closingTimestamp: time(r.closing_timestamp),
    initialCash: req(r, 'initial_cash'),
    finalCash: numOrNull(r.final_cash),
    status: r.status as CashRegister['status'],
    createdAt: time(r.created_at),
    updatedAt: time(r.updated_at),
  };
  if (row.transactions) {
    register.transactions = row.transactions.map(toLegacyTransaction);
  }
  if (row.cash_transactions) {
    register.cashTransactions = row.cash_transactions.map(toCashTransaction);
  }
  return register;
}

/** register_summary jsonb (snake_case) in camelCase; methods keep the server order. */
export function toRegisterSummary(row: Json): RegisterSummary {
  const legacy = (row.legacy ?? {}) as Json;
  const byMethod = (legacy.by_method ?? {}) as Record<string, unknown>;
  return {
    registersCount: req(row, 'registers_count'),
    initialCash: req(row, 'initial_cash'),
    paymentsCount: req(row, 'payments_count'),
    totalBilled: req(row, 'total_billed'),
    totalTips: req(row, 'total_tips'),
    totalSales: req(row, 'total_sales'),
    totalChange: req(row, 'total_change'),
    methods: ((row.methods as Json[] | null) ?? []).map((method) => ({
      paymentMethodId: String(method.payment_method_id),
      code: String(method.code),
      name: String(method.name),
      kind: method.kind as PaymentMethodKind,
      sortOrder: req(method, 'sort_order'),
      isActive: method.is_active === true,
      total: req(method, 'total'),
      tendersCount: req(method, 'tenders_count'),
    })),
    cashDeposits: req(row, 'cash_deposits'),
    cashWithdrawals: req(row, 'cash_withdrawals'),
    expectedCash: req(row, 'expected_cash'),
    tipsPayout: req(row, 'tips_payout'),
    expectedCashAfterTips: req(row, 'expected_cash_after_tips'),
    legacy: {
      paymentsCount: req(legacy, 'payments_count'),
      total: req(legacy, 'total'),
      tips: req(legacy, 'tips'),
      change: req(legacy, 'change'),
      byMethod: Object.fromEntries(Object.keys(byMethod).map((method) => [method, req(byMethod, method)])),
    },
  };
}

/** close_register result; closingTimestamp comes from the RPC on a replay, else from the closed row. */
export const toCloseResult = (row: Json, closingTimestamp: string): CloseRegisterResult => ({
  status: row.status as CloseRegisterResult['status'],
  cashRegisterId: String(row.cash_register_id),
  finalCash: req(row, 'final_cash'),
  closingTimestamp,
  summary: toRegisterSummary(row.summary as Json),
});
