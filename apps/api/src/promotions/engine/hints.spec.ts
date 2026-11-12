import { describe, expect, it } from 'vitest';
import { formatPesos, pricingHints } from './hints';
import { at, happyHour, preview, promo } from './test-fixtures';

/**
 * Exact hint strings (S8):
 * - missing_units: "Falta 1 {one} para otro {label}." / "Faltan {n} {other} para otro {label}."
 *   The noun is the promotion's `unitNoun` (e.g. cóctel/cócteles), else "unidad"/"unidades".
 *   The label is "2x1" (N=2, M=1, 100%), "3x2" (N=3, M=2, 100%), else the promotion name.
 * - bill_minimum: "{channelLabel}: faltan $X para el {p}% de descuento." for percentages,
 *   "{channelLabel}: faltan $X para $Y de descuento." for fixed amounts; without a channel
 *   label the message starts with "Faltan $X …". Pesos use dot thousands: "$80.000".
 */

const ctx = { now: at('18:00'), channel: 'dine_in' };
const mojito = (overrides = {}) => preview({ dishId: 'mojito', categoryId: 'cocteles', unitPrice: 24000, promotionId: 'hh', sent: true, ...overrides });

describe('formatPesos', () => {
  it('uses dot thousands', () => {
    expect(formatPesos(80000)).toBe('$80.000');
    expect(formatPesos(1234567)).toBe('$1.234.567');
    expect(formatPesos(500)).toBe('$500');
  });
});

describe('pricingHints: missing_units', () => {
  it('"Falta 1 cóctel para otro 2x1."', () => {
    expect(pricingHints([mojito({ quantity: 3 })], [happyHour()], ctx)).toEqual([
      { kind: 'missing_units', promotionId: 'hh', missing: 1, message: 'Falta 1 cóctel para otro 2x1.' },
    ]);
  });

  it('no hint when every group is complete', () => {
    expect(pricingHints([mojito({ quantity: 2 })], [happyHour()], ctx)).toEqual([]);
  });

  it('3x2 with the generic noun, and the name for other rules', () => {
    const p3 = happyHour({ buyQuantity: 3, payQuantity: 2, unitNoun: null });
    expect(pricingHints([mojito()], [p3], ctx)[0]).toMatchObject({ missing: 2, message: 'Faltan 2 unidades para otro 3x2.' });
    const p50 = happyHour({ name: 'Segunda unidad al 50%', restDiscountPercent: 50, unitNoun: null });
    expect(pricingHints([mojito()], [p50], ctx)[0]).toMatchObject({ missing: 1, message: 'Falta 1 unidad para otro Segunda unidad al 50%.' });
  });

  it('no hint when the promotion is not active now or its group cap is reached', () => {
    expect(pricingHints([mojito()], [happyHour()], { ...ctx, now: at('19:00') })).toEqual([]);
    expect(pricingHints([mojito({ quantity: 3 })], [happyHour({ maxUsesPerOrder: 1 })], ctx)).toEqual([]);
  });
});

describe('pricingHints: window_ending', () => {
  it('warns when ≤ 10 minutes are left and there are unsent eligible items', () => {
    const hints = pricingHints([mojito({ quantity: 2, sent: false })], [happyHour()], { ...ctx, now: at('18:50') });
    expect(hints).toEqual([{ kind: 'window_ending', promotionId: 'hh', minutesLeft: 10 }]);
  });

  it('does not warn with 11 minutes left or when everything is sent', () => {
    expect(pricingHints([mojito({ quantity: 2, sent: false })], [happyHour()], { ...ctx, now: at('18:49') })).toEqual([]);
    expect(pricingHints([mojito({ quantity: 2 })], [happyHour()], { ...ctx, now: at('18:55') })).toEqual([]);
  });
});

describe('pricingHints: bill_minimum', () => {
  const delivery10 = promo({ id: 'dom', name: '10% domicilio', kind: 'bill_discount', discountType: 'percentage', discountValue: 10, channels: ['delivery'], minSubtotal: 80000, maxDiscount: 15000 });
  const deliveryCtx = { now: at('18:00'), channel: 'delivery', channelLabel: 'Domicilio' };

  it('"Domicilio: faltan $X para el 10% de descuento."', () => {
    expect(pricingHints([preview({ unitPrice: 50000 })], [delivery10], deliveryCtx)).toEqual([
      { kind: 'bill_minimum', promotionId: 'dom', missing: 30000, message: 'Domicilio: faltan $30.000 para el 10% de descuento.' },
    ]);
  });

  it('no hint once the minimum is reached, on another channel or with an empty order', () => {
    expect(pricingHints([preview({ unitPrice: 80000 })], [delivery10], deliveryCtx)).toEqual([]);
    expect(pricingHints([preview({ unitPrice: 50000 })], [delivery10], { ...deliveryCtx, channel: 'dine_in' })).toEqual([]);
    expect(pricingHints([], [delivery10], deliveryCtx)).toEqual([]);
  });

  it('fixed amount and no channel label', () => {
    const fixed = { ...delivery10, discountType: 'fixed_amount' as const, discountValue: 5000 };
    expect(pricingHints([preview({ unitPrice: 50000 })], [fixed], { now: at('18:00'), channel: 'delivery' })[0]).toMatchObject({
      message: 'Faltan $30.000 para $5.000 de descuento.',
    });
  });
});
