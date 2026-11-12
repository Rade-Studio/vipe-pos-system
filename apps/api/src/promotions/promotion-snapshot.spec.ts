import { describe, expect, it } from 'vitest';
import { happyHour, promo } from './engine/test-fixtures';
import { fromSnapshot, toSnapshot } from './promotion-snapshot';

describe('promotion snapshot (order_items.promotion_snapshot)', () => {
  it('round-trips every engine field through JSON', () => {
    const rule = happyHour({ maxUsesPerOrder: 2, channels: ['dine_in'], daysOfWeek: [1, 5], endDate: '2026-12-31' });
    const stored = JSON.parse(JSON.stringify(toSnapshot(rule)));
    expect(fromSnapshot(stored)).toEqual({ ...rule, unitNoun: rule.unitNoun });
  });

  it('keeps combo groups and bill fields', () => {
    const combo = promo({ kind: 'combo', comboPrice: 24000, comboGroups: [{ id: 'g', name: 'Sopa', dishIds: ['a', 'b'] }] });
    expect(fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(combo))))).toEqual({ ...combo, unitNoun: null });
    const bill = promo({ kind: 'bill_discount', discountType: 'percentage', discountValue: 10, minSubtotal: 80000, maxDiscount: 15000 });
    expect(fromSnapshot(toSnapshot(bill))).toEqual({ ...bill, unitNoun: null });
  });

  it('drops keys that are not part of the rule', () => {
    const snapshot = toSnapshot({ ...promo({}), extra: 'x' } as never) as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('extra');
  });

  it('answers null for a missing or malformed snapshot', () => {
    expect(fromSnapshot(null)).toBeNull();
    expect(fromSnapshot('x')).toBeNull();
    expect(fromSnapshot({ id: 'p' })).toBeNull();
    expect(fromSnapshot({ ...toSnapshot(promo({})), kind: 'bogus' })).toBeNull();
  });
});
