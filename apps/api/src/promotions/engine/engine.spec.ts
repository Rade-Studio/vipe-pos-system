import { describe, expect, it } from 'vitest';
import { computeOrderDiscounts, selectPromotionForNewItem, validateCombo } from './engine';
import { at, byId, cocktail, happyHour, item, promo } from './test-fixtures';

const ctx = { now: at('18:00'), channel: 'dine_in' };

const burgerTuesday = promo({
  id: 'mh',
  name: 'Martes de hamburguesa',
  discountType: 'percentage',
  discountValue: 20,
  daysOfWeek: [2],
  targets: { dishIds: ['burger'], categoryIds: [], subcategoryIds: [] },
});

const menu = promo({
  id: 'menu',
  name: 'Menú ejecutivo',
  kind: 'combo',
  comboPrice: 24000,
  daysOfWeek: [1, 2, 3, 4, 5],
  timeWindows: [{ from: '12:00', to: '15:00' }],
  comboGroups: [
    { id: 'g-sopa', name: 'Sopa', dishIds: ['sopa', 'crema'] },
    { id: 'g-fuerte', name: 'Fuerte', dishIds: ['bandeja'] },
    { id: 'g-bebida', name: 'Bebida', dishIds: ['jugo'] },
  ],
});

const delivery10 = promo({
  id: 'dom',
  name: '10% domicilio (tope $15.000)',
  kind: 'bill_discount',
  discountType: 'percentage',
  discountValue: 10,
  channels: ['delivery'],
  minSubtotal: 80000,
  maxDiscount: 15000,
});
const deliveryCtx = { now: at('18:00'), channel: 'delivery' };

describe('selectPromotionForNewItem (S3)', () => {
  const mojito = item({ dishId: 'mojito', categoryId: 'cocteles', unitPrice: 24000 });

  it('tags an eligible item with the active promotion', () => {
    expect(selectPromotionForNewItem(mojito, [happyHour()], ctx)).toBe('hh');
  });

  it('matches by dish, category or subcategory', () => {
    const p = (targets: object) => promo({ id: 'x', discountType: 'fixed_amount', discountValue: 1000, targets: { dishIds: [], categoryIds: [], subcategoryIds: [], ...targets } });
    const it1 = item({ dishId: 'd', categoryId: 'c', subcategoryId: 's' });
    expect(selectPromotionForNewItem(it1, [p({ dishIds: ['d'] })], ctx)).toBe('x');
    expect(selectPromotionForNewItem(it1, [p({ categoryIds: ['c'] })], ctx)).toBe('x');
    expect(selectPromotionForNewItem(it1, [p({ subcategoryIds: ['s'] })], ctx)).toBe('x');
    expect(selectPromotionForNewItem(it1, [p({ dishIds: ['other'] })], ctx)).toBeNull();
  });

  it('gives no tag to an unsent item evaluated at 19:05', () => {
    expect(selectPromotionForNewItem(mojito, [happyHour()], { ...ctx, now: at('19:05') })).toBeNull();
  });

  it('ignores manual, bill, combo and other-channel promotions, and combo items', () => {
    const all = { categoryIds: ['cocteles'], dishIds: [], subcategoryIds: [] };
    expect(selectPromotionForNewItem(mojito, [happyHour({ mode: 'manual' })], ctx)).toBeNull();
    expect(selectPromotionForNewItem(mojito, [happyHour({ channels: ['delivery'] })], ctx)).toBeNull();
    expect(selectPromotionForNewItem(mojito, [promo({ kind: 'bill_discount', discountType: 'percentage', discountValue: 10, targets: all })], ctx)).toBeNull();
    expect(selectPromotionForNewItem({ ...mojito, comboId: 'c1' }, [happyHour()], ctx)).toBeNull();
  });

  it('picks the promotion that saves the customer the most', () => {
    const half = happyHour({ id: 'half', name: 'Segunda al 50%', restDiscountPercent: 50, createdAt: '2025-01-01T00:00:00Z' });
    const pct30 = promo({ id: 'p30', discountType: 'percentage', discountValue: 30, targets: { dishIds: ['mojito'], categoryIds: [], subcategoryIds: [] } });
    // 2x1 saves 12.000/unit, 30% saves 7.200, 50% second saves 6.000.
    expect(selectPromotionForNewItem(mojito, [half, pct30, happyHour()], ctx)).toBe('hh');
    expect(selectPromotionForNewItem(mojito, [half, pct30], ctx)).toBe('p30');
  });

  it('breaks ties by the oldest promotion, then id', () => {
    const a = promo({ id: 'b', createdAt: '2026-02-01T00:00:00Z', discountType: 'fixed_amount', discountValue: 5000, targets: { dishIds: ['mojito'], categoryIds: [], subcategoryIds: [] } });
    const older = { ...a, id: 'z', createdAt: '2026-01-01T00:00:00Z' };
    expect(selectPromotionForNewItem(mojito, [a, older], ctx)).toBe('z');
    expect(selectPromotionForNewItem(mojito, [{ ...a, id: 'c' }, a], ctx)).toBe('b');
  });

  it('never selects a promotion with no saving', () => {
    expect(selectPromotionForNewItem(mojito, [promo({ discountType: 'percentage', discountValue: 0, targets: { dishIds: ['mojito'], categoryIds: [], subcategoryIds: [] } })], ctx)).toBeNull();
  });
});

describe('computeOrderDiscounts: product_discount', () => {
  it('Martes de hamburguesa 20% on $29.000 → −$5.800', () => {
    const burger = item({ dishId: 'burger', unitPrice: 29000, promotionId: 'mh' });
    const result = computeOrderDiscounts([burger], byId(burgerTuesday), ctx);
    expect(result.itemDiscounts).toEqual([{ orderItemId: burger.id, promotionId: 'mh', label: 'Martes de hamburguesa', amount: 5800 }]);
    expect(result).toMatchObject({ grossSubtotal: 29000, productDiscountTotal: 5800, netSubtotal: 23200, billDiscount: null });
  });

  it('multiplies by quantity and rounds per unit', () => {
    const p = promo({ id: 'r', name: 'R', discountType: 'percentage', discountValue: 10 });
    const line = item({ unitPrice: 9999, quantity: 3, promotionId: 'r' });
    expect(computeOrderDiscounts([line], byId(p), ctx).itemDiscounts[0].amount).toBe(3000);
  });

  it('caps a fixed discount at the unit price', () => {
    const p = promo({ id: 'f', name: 'F', discountType: 'fixed_amount', discountValue: 9000 });
    expect(computeOrderDiscounts([item({ unitPrice: 5000, quantity: 2, promotionId: 'f' })], byId(p), ctx).itemDiscounts[0].amount).toBe(10000);
  });

  it('maxUsesPerOrder caps the discounted units in order of addition', () => {
    const p = { ...burgerTuesday, maxUsesPerOrder: 3 };
    const first = item({ dishId: 'burger', unitPrice: 29000, quantity: 2, promotionId: 'mh', addedAt: '2026-11-10T12:00:00Z' });
    const second = item({ dishId: 'burger', unitPrice: 29000, quantity: 2, promotionId: 'mh', addedAt: '2026-11-10T12:10:00Z' });
    const result = computeOrderDiscounts([second, first], byId(p), ctx);
    expect(result.itemDiscounts).toEqual([
      { orderItemId: first.id, promotionId: 'mh', label: 'Martes de hamburguesa', amount: 11600 },
      { orderItemId: second.id, promotionId: 'mh', label: 'Martes de hamburguesa', amount: 5800 },
    ]);
  });

  it('keeps the fixed tag even when the promotion is no longer active', () => {
    const burger = item({ dishId: 'burger', unitPrice: 29000, promotionId: 'mh' });
    const paused = { ...burgerTuesday, active: false };
    expect(computeOrderDiscounts([burger], byId(paused), { ...ctx, now: at('12:00', '2026-11-11', 3) }).productDiscountTotal).toBe(5800);
  });

  it('ignores voided items and unknown promotions', () => {
    const voided = item({ dishId: 'burger', unitPrice: 29000, promotionId: 'mh', voided: true });
    const unknown = item({ unitPrice: 1000, promotionId: 'nope' });
    expect(computeOrderDiscounts([voided, unknown], byId(burgerTuesday), ctx)).toMatchObject({ itemDiscounts: [], grossSubtotal: 1000, netSubtotal: 1000 });
  });
});

describe('computeOrderDiscounts: buy_x_pay_y (S3, S6)', () => {
  it('Margarita $26.000 + Mojito $24.000 → Mojito −$24.000', () => {
    const margarita = cocktail('margarita', 26000);
    const mojito = cocktail('mojito', 24000);
    const result = computeOrderDiscounts([margarita, mojito], byId(happyHour()), ctx);
    expect(result.itemDiscounts).toEqual([{ orderItemId: mojito.id, promotionId: 'hh', label: 'Happy hour 2x1', amount: 24000 }]);
  });

  it('2 Mojito + 1 Margarita → −$24.000 total', () => {
    const mojitos = cocktail('mojito', 24000, { quantity: 2 });
    const margarita = cocktail('margarita', 26000);
    const result = computeOrderDiscounts([mojitos, margarita], byId(happyHour()), ctx);
    expect(result.itemDiscounts).toEqual([{ orderItemId: mojitos.id, promotionId: 'hh', label: 'Happy hour 2x1', amount: 24000 }]);
    expect(result.productDiscountTotal).toBe(24000);
  });

  it('voiding 1 of 2 Mojitos with a Margarita remaining keeps −$24.000 (S6)', () => {
    const mojito1 = cocktail('mojito', 24000, { addedAt: '2026-11-10T18:00:00Z' });
    const mojito2 = cocktail('mojito', 24000, { addedAt: '2026-11-10T18:00:01Z' });
    const margarita = cocktail('margarita', 26000);
    const fries = item({ unitPrice: 29000 });
    const before = computeOrderDiscounts([mojito1, mojito2, margarita, fries], byId(happyHour()), ctx);
    expect(before.netSubtotal).toBe(79000);
    const after = computeOrderDiscounts([mojito1, { ...mojito2, voided: true }, margarita, fries], byId(happyHour()), ctx);
    expect(after.productDiscountTotal).toBe(24000);
    expect(after.itemDiscounts).toEqual([{ orderItemId: mojito1.id, promotionId: 'hh', label: 'Happy hour 2x1', amount: 24000 }]);
    expect(after).toMatchObject({ grossSubtotal: 79000, netSubtotal: 55000 });
  });

  it('pools units across sends and groups the cheapest of each group of N', () => {
    // 3x2: units 30, 20, 10 | 5 → only the 10 is free.
    const p = happyHour({ id: '3x2', name: '3x2', buyQuantity: 3, payQuantity: 2 });
    const a = cocktail('a', 30000, { promotionId: '3x2' });
    const b = cocktail('b', 10000, { promotionId: '3x2', addedAt: '2026-11-10T18:30:00Z' });
    const c = cocktail('c', 20000, { promotionId: '3x2' });
    const d = cocktail('d', 5000, { promotionId: '3x2' });
    expect(computeOrderDiscounts([a, b, c, d], byId(p), ctx).itemDiscounts).toEqual([{ orderItemId: b.id, promotionId: '3x2', label: '3x2', amount: 10000 }]);
  });

  it('applies restDiscountPercent rounded per unit', () => {
    const p = happyHour({ restDiscountPercent: 50, name: 'Segunda al 50%' });
    const result = computeOrderDiscounts([cocktail('a', 24001), cocktail('b', 24001)], byId(p), ctx);
    expect(result.productDiscountTotal).toBe(12001);
  });

  it('maxUsesPerOrder caps the groups', () => {
    const p = happyHour({ maxUsesPerOrder: 1 });
    const line = cocktail('mojito', 24000, { quantity: 4 });
    expect(computeOrderDiscounts([line], byId(p), ctx).itemDiscounts).toEqual([{ orderItemId: line.id, promotionId: 'hh', label: 'Happy hour 2x1', amount: 24000 }]);
  });

  it('keeps the 2x1 for an item sent at 18:52 when evaluated at 19:05', () => {
    const sent = cocktail('mojito', 24000, { quantity: 2, addedAt: '2026-11-10T18:52:00Z' });
    expect(computeOrderDiscounts([sent], byId(happyHour()), { ...ctx, now: at('19:05') }).productDiscountTotal).toBe(24000);
  });
});

describe('computeOrderDiscounts: combo (S5)', () => {
  const components = (prices: number[]) =>
    prices.map((unitPrice, i) => item({ dishId: `d${i}`, unitPrice, comboId: 'c1', promotionId: 'menu', addedAt: `2026-11-10T12:00:0${i}Z` }));

  it('9.000 + 17.000 + 7.000 at 24.000 → −9.000 on the first component', () => {
    const lines = components([9000, 17000, 7000]);
    const result = computeOrderDiscounts(lines, byId(menu), ctx);
    expect(result.comboDiscounts).toEqual([{ comboId: 'c1', orderItemId: lines[0].id, promotionId: 'menu', label: 'Menú ejecutivo', amount: 9000 }]);
    expect(result.itemDiscounts).toEqual([]);
    expect(result).toMatchObject({ grossSubtotal: 33000, productDiscountTotal: 9000, netSubtotal: 24000 });
  });

  it('records no discount when the sum is ≤ comboPrice', () => {
    expect(computeOrderDiscounts(components([8000, 9000, 7000]), byId(menu), ctx).comboDiscounts).toEqual([]);
    expect(computeOrderDiscounts(components([5000, 9000, 7000]), byId(menu), ctx).comboDiscounts).toEqual([]);
  });

  it('charges the options on top: the discount uses the list prices without options', () => {
    const lines = components([9000, 20000, 7000]).map((l, i) => (i === 1 ? { ...l, optionsPrice: 3000 } : l));
    const result = computeOrderDiscounts(lines, byId(menu), ctx);
    expect(result.comboDiscounts.map((d) => d.amount)).toEqual([9000]);
    expect(result).toMatchObject({ grossSubtotal: 36000, netSubtotal: 27000 });
  });

  it('ignores a fully voided combo', () => {
    const lines = components([9000, 17000, 7000]).map((l) => ({ ...l, voided: true }));
    expect(computeOrderDiscounts(lines, byId(menu), ctx)).toMatchObject({ comboDiscounts: [], grossSubtotal: 0 });
  });
});

describe('computeOrderDiscounts: bill_discount (S4)', () => {
  it('10% on base $96.000 → −$9.600', () => {
    const result = computeOrderDiscounts([item({ unitPrice: 96000 })], byId(delivery10), deliveryCtx);
    expect(result.billDiscount).toEqual({ promotionId: 'dom', label: '10% domicilio (tope $15.000)', amount: 9600 });
    expect(result.netSubtotal).toBe(86400);
  });

  it('10% on base $103.000 → −$10.300, computed after product discounts', () => {
    const lines = [item({ unitPrice: 103000 }), cocktail('margarita', 26000), cocktail('mojito', 24000)];
    const result = computeOrderDiscounts(lines, byId(delivery10, happyHour()), deliveryCtx);
    // gross 153.000 − 2x1 24.000 = 129.000 → 12.900
    expect(result.billDiscount?.amount).toBe(12900);
    expect(computeOrderDiscounts([item({ unitPrice: 103000 })], byId(delivery10), deliveryCtx).billDiscount?.amount).toBe(10300);
  });

  it('caps at maxDiscount', () => {
    expect(computeOrderDiscounts([item({ unitPrice: 200000 })], byId(delivery10), deliveryCtx).billDiscount?.amount).toBe(15000);
  });

  it('applies nothing below the minimum, on another channel, or out of hours', () => {
    expect(computeOrderDiscounts([item({ unitPrice: 79999 })], byId(delivery10), deliveryCtx).billDiscount).toBeNull();
    expect(computeOrderDiscounts([item({ unitPrice: 80000 })], byId(delivery10), deliveryCtx).billDiscount?.amount).toBe(8000);
    expect(computeOrderDiscounts([item({ unitPrice: 96000 })], byId(delivery10), ctx).billDiscount).toBeNull();
    const lunch = { ...delivery10, timeWindows: [{ from: '12:00', to: '15:00' }] };
    expect(computeOrderDiscounts([item({ unitPrice: 96000 })], byId(lunch), deliveryCtx).billDiscount).toBeNull();
  });

  it('caps a fixed amount by the base, and picks the largest (tie oldest)', () => {
    const fixed = promo({ id: 'fx', name: 'Fijo', kind: 'bill_discount', discountType: 'fixed_amount', discountValue: 50000, createdAt: '2026-03-01T00:00:00Z' });
    expect(computeOrderDiscounts([item({ unitPrice: 30000 })], byId(fixed), ctx).billDiscount?.amount).toBe(30000);
    const small = promo({ id: 'sm', name: 'Small', kind: 'bill_discount', discountType: 'fixed_amount', discountValue: 1000 });
    const tie = { ...small, id: 'tie', createdAt: '2025-01-01T00:00:00Z' };
    expect(computeOrderDiscounts([item({ unitPrice: 100000 })], byId(small, fixed), ctx).billDiscount?.promotionId).toBe('fx');
    expect(computeOrderDiscounts([item({ unitPrice: 100000 })], byId(small, tie), ctx).billDiscount?.promotionId).toBe('tie');
  });
});

describe('validateCombo (S5)', () => {
  const lunch = { now: at('13:00'), channel: 'dine_in' };
  const valid = [
    { groupId: 'g-sopa', dishId: 'crema' },
    { groupId: 'g-fuerte', dishId: 'bandeja' },
    { groupId: 'g-bebida', dishId: 'jugo' },
  ];

  it('accepts one valid choice per group', () => {
    expect(validateCombo(menu, valid, lunch)).toEqual({ ok: true });
  });

  it('rejects an inactive combo or one that is not a combo', () => {
    expect(validateCombo(menu, valid, ctx)).toEqual({ ok: false, errors: ['combo_inactive'] });
    expect(validateCombo({ ...menu, kind: 'product_discount' }, valid, lunch)).toEqual({ ok: false, errors: ['combo_inactive'] });
  });

  it('rejects missing groups, invalid choices and duplicated groups', () => {
    expect(validateCombo(menu, valid.slice(0, 2), lunch)).toEqual({ ok: false, errors: ['combo_group_missing'] });
    expect(validateCombo(menu, [...valid.slice(0, 2), { groupId: 'g-bebida', dishId: 'sopa' }], lunch)).toEqual({ ok: false, errors: ['combo_choice_invalid'] });
    expect(validateCombo(menu, [...valid, { groupId: 'g-nope', dishId: 'jugo' }], lunch)).toEqual({ ok: false, errors: ['combo_choice_invalid'] });
    expect(validateCombo(menu, [...valid, { groupId: 'g-sopa', dishId: 'sopa' }], lunch)).toEqual({ ok: false, errors: ['combo_duplicate_group'] });
  });
});
