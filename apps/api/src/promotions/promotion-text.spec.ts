import { describe, expect, it } from 'vitest';
import { happyHour, promo } from './engine/test-fixtures';
import { promotionBadge, promotionSentence, type TargetNames } from './promotion-text';

const names: TargetNames = {
  dishes: new Map([
    ['burger', 'Hamburguesa clásica'],
    ['fries', 'Papas'],
  ]),
  categories: new Map([
    ['cocteles', 'Cócteles'],
    ['postres', 'Postres'],
    ['cervezas', 'Cervezas'],
  ]),
  subcategories: new Map([['hamburguesas', 'Hamburguesas']]),
};

const menu = promo({
  kind: 'combo',
  name: 'Menú ejecutivo',
  comboPrice: 24000,
  comboGroups: [
    { id: 'g1', name: 'Sopa del día', dishIds: ['s'] },
    { id: 'g2', name: 'Principio ejecutivo', dishIds: ['b'] },
    { id: 'g3', name: 'Jugo natural', dishIds: ['j'] },
  ],
});

describe('promotionSentence (02 artboard)', () => {
  it('a 2x1 on a category: the most economical goes free', () => {
    expect(promotionSentence(happyHour(), names)).toBe('Lleva 2 cócteles y paga 1; sale gratis el más económico.');
  });

  it('a 3x1 frees the two cheapest', () => {
    expect(promotionSentence(happyHour({ buyQuantity: 3, payQuantity: 1 }), names)).toBe(
      'Lleva 3 cócteles y paga 1; salen gratis los 2 más económicos.',
    );
  });

  it('second unit at 50%', () => {
    const beer = happyHour({ restDiscountPercent: 50, targets: { dishIds: [], categoryIds: ['cervezas'], subcategoryIds: [] } });
    expect(promotionSentence(beer, names)).toBe('Lleva 2 cervezas; la segunda al 50%.');
  });

  it('another partial rest discount', () => {
    expect(promotionSentence(happyHour({ buyQuantity: 3, payQuantity: 2, restDiscountPercent: 30 }), names)).toBe(
      'Lleva 3 cócteles; la más económica con 30% de descuento.',
    );
  });

  it('a percentage on a subcategory, a category, a dish or several targets', () => {
    const pct = (targets: Partial<{ dishIds: string[]; categoryIds: string[]; subcategoryIds: string[] }>) =>
      promo({ discountType: 'percentage', discountValue: 20, targets: { dishIds: [], categoryIds: [], subcategoryIds: [], ...targets } });
    expect(promotionSentence(pct({ subcategoryIds: ['hamburguesas'] }), names)).toBe('20% en la subcategoría Hamburguesas.');
    expect(promotionSentence(pct({ categoryIds: ['postres'] }), names)).toBe('20% en la categoría Postres.');
    expect(promotionSentence(pct({ dishIds: ['burger'] }), names)).toBe('20% en Hamburguesa clásica.');
    expect(promotionSentence(pct({ dishIds: ['burger', 'fries'] }), names)).toBe('20% en Hamburguesa clásica y Papas.');
    expect(promotionSentence(pct({ dishIds: ['burger'], categoryIds: ['postres', 'cocteles'] }), names)).toBe('20% en 3 productos o grupos.');
    expect(promotionSentence(pct({}), names)).toBe('20% de descuento.');
  });

  it('a fixed amount per unit', () => {
    const fixed = promo({ discountType: 'fixed_amount', discountValue: 3000, targets: { dishIds: [], categoryIds: ['postres'], subcategoryIds: [] } });
    expect(promotionSentence(fixed, names)).toBe('$3.000 menos por unidad en la categoría Postres.');
  });

  it('a combo lists one of each group and its price', () => {
    expect(promotionSentence(menu, names)).toBe('1 sopa del día + 1 principio ejecutivo + 1 jugo natural por $24.000.');
  });

  it('a bill discount with and without a minimum and a cap', () => {
    const bill = (overrides: Parameters<typeof promo>[0]) =>
      promo({ kind: 'bill_discount', discountType: 'percentage', discountValue: 10, ...overrides });
    expect(promotionSentence(bill({ maxDiscount: 15000 }), names)).toBe('10% sobre la cuenta, con tope de $15.000 por pedido.');
    expect(promotionSentence(bill({ minSubtotal: 80000, maxDiscount: 15000 }), names)).toBe('10% en cuentas desde $80.000, con tope de $15.000.');
    expect(promotionSentence(bill({ minSubtotal: 80000 }), names)).toBe('10% en cuentas desde $80.000.');
    expect(promotionSentence(bill({}), names)).toBe('10% sobre la cuenta.');
    expect(promotionSentence(bill({ discountType: 'fixed_amount', discountValue: 5000 }), names)).toBe('$5.000 menos sobre la cuenta.');
  });
});

describe('promotionBadge', () => {
  it('names the mechanic in a few characters', () => {
    expect(promotionBadge(happyHour())).toBe('2x1');
    expect(promotionBadge(happyHour({ buyQuantity: 3, payQuantity: 2 }))).toBe('3x2');
    expect(promotionBadge(happyHour({ restDiscountPercent: 50 }))).toBe('2º 50%');
    expect(promotionBadge(promo({ discountType: 'percentage', discountValue: 20 }))).toBe('20%');
    expect(promotionBadge(promo({ discountType: 'fixed_amount', discountValue: 3000 }))).toBe('-$3.000');
    expect(promotionBadge(menu)).toBe('Combo');
    expect(promotionBadge(promo({ kind: 'bill_discount', discountType: 'percentage', discountValue: 10 }))).toBe('10%');
  });
});
