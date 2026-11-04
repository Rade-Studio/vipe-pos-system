import { describe, expect, it } from 'vitest';
import { toRegisterSummary } from '../registers/registers.mappers';
import { toPayment, toPayOrderResult } from './payments.mappers';

describe('strict money mappers', () => {
  it('throws naming a missing required field of a pay_order result', () => {
    expect(() => toPayOrderResult({ payment_id: 'p', status: 'paid', tenders: [] })).toThrow(/amount_due/);
  });

  it('throws naming a missing required field of a payment', () => {
    expect(() => toPayment({ id: 'p', order_id: 'o', cash_register_id: 'c', idempotency_key: 'k', created_at: '2026-01-01 00:00:00+00' })).toThrow(
      /amount_due/,
    );
  });

  it('throws naming a missing required field of register_summary', () => {
    expect(() => toRegisterSummary({ registers_count: 1, legacy: {} })).toThrow(/initial_cash/);
  });

  it('keeps nullable columns null', () => {
    const result = toPayOrderResult({
      payment_id: 'p', status: 'paid', amount_due: 1, tip_amount: 0, total_charged: 1, change_given: 0,
      drawer_warning: false, drawer_cash_before: 0, tenders: [{ line_no: 1, method_code: 'nequi', amount: 1, cash_received: null }],
    });
    expect(result.tenders[0].cashReceived).toBeNull();
  });
});
