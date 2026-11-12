import type { EngineItem, EnginePromotion, LocalClock, PreviewItem } from './types';

/** Shared spec builders; not part of the engine's public API. */

export const promo = (overrides: Partial<EnginePromotion>): EnginePromotion => ({
  id: 'p',
  name: 'Promo',
  kind: 'product_discount',
  mode: 'automatic',
  active: true,
  startDate: '2026-01-01',
  endDate: null,
  daysOfWeek: [],
  timeWindows: [],
  channels: [],
  maxUsesPerOrder: null,
  createdAt: '2026-01-01T00:00:00Z',
  discountType: null,
  discountValue: null,
  buyQuantity: 2,
  payQuantity: 1,
  restDiscountPercent: 100,
  comboPrice: 0,
  comboGroups: [],
  minSubtotal: null,
  maxDiscount: null,
  targets: { dishIds: [], categoryIds: [], subcategoryIds: [] },
  ...overrides,
});

export const happyHour = (overrides: Partial<EnginePromotion> = {}): EnginePromotion =>
  promo({
    id: 'hh',
    name: 'Happy hour 2x1',
    kind: 'buy_x_pay_y',
    timeWindows: [{ from: '17:00', to: '19:00' }],
    targets: { dishIds: [], categoryIds: ['cocteles'], subcategoryIds: [] },
    unitNoun: { one: 'cóctel', other: 'cócteles' },
    ...overrides,
  });

let seq = 0;
export const item = (overrides: Partial<EngineItem>): EngineItem => ({
  id: `i-${++seq}`,
  dishId: 'dish',
  categoryId: null,
  subcategoryId: null,
  unitPrice: 10000,
  quantity: 1,
  promotionId: null,
  addedAt: '2026-11-10T18:00:00Z',
  voided: false,
  comboId: null,
  ...overrides,
});

export const preview = (overrides: Partial<PreviewItem>): PreviewItem => ({ ...item(overrides), sent: false, ...overrides });

export const cocktail = (dishId: string, unitPrice: number, overrides: Partial<EngineItem> = {}): EngineItem =>
  item({ dishId, unitPrice, categoryId: 'cocteles', promotionId: 'hh', ...overrides });

/** Tuesday 2026-11-10 at HH:MM. */
export const at = (hhmm: string, date = '2026-11-10', isoDay = 2): LocalClock => {
  const [h, m] = hhmm.split(':').map(Number);
  return { isoDay, minutes: h * 60 + m, date };
};

export const byId = (...promotions: EnginePromotion[]): Map<string, EnginePromotion> =>
  new Map(promotions.map((p) => [p.id, p]));
