import { isLiveFor } from './schedule';
import type {
  BillDiscount,
  ComboChoice,
  ComboDiscount,
  ComboErrorCode,
  ComboValidation,
  EngineContext,
  EngineItem,
  EnginePromotion,
  ItemDiscount,
  OrderDiscounts,
} from './types';

/**
 * Pure order pricing (S1, S3–S6). Items keep the promotion fixed when they
 * were sent; only the bill discount is evaluated with `ctx.now`.
 */

type Promotions<C extends string> = ReadonlyMap<string, EnginePromotion<C>>;

const byAgeThenId = (a: EnginePromotion<string>, b: EnginePromotion<string>): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const byAddedThenId = (a: EngineItem, b: EngineItem): number =>
  a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Percentage rounds to whole pesos; fixed never exceeds the amount it applies to. */
export function amountOff(base: number, type: EnginePromotion<string>['discountType'], value: number | null): number {
  const v = value ?? 0;
  if (type === 'percentage') return Math.min(base, Math.round((base * v) / 100));
  if (type === 'fixed_amount') return Math.min(base, v);
  return 0;
}

const restUnitDiscount = (unitPrice: number, promotion: EnginePromotion<string>): number =>
  Math.min(unitPrice, Math.round((unitPrice * promotion.restDiscountPercent) / 100));

/** A dish matches if it is listed or is in a listed category/subcategory. */
export function matchesTargets(item: EngineItem, promotion: EnginePromotion<string>): boolean {
  const t = promotion.targets;
  return (
    t.dishIds.includes(item.dishId) ||
    (item.categoryId !== null && t.categoryIds.includes(item.categoryId)) ||
    (item.subcategoryId !== null && t.subcategoryIds.includes(item.subcategoryId))
  );
}

/** Per-unit saving used to rank product promotions (S3). */
export function unitSaving(unitPrice: number, promotion: EnginePromotion<string>): number {
  if (promotion.kind === 'product_discount') return amountOff(unitPrice, promotion.discountType, promotion.discountValue);
  if (promotion.kind === 'buy_x_pay_y') {
    const n = promotion.buyQuantity;
    return (unitPrice * (n - promotion.payQuantity) * promotion.restDiscountPercent) / (n * 100);
  }
  return 0;
}

/** The automatic product promotion an item qualifies for as it is sent, or null. */
export function selectPromotionForNewItem<C extends string>(
  item: EngineItem,
  promotions: readonly EnginePromotion<C>[],
  ctx: EngineContext<C>,
): string | null {
  if (item.comboId !== null) return null;
  let best: EnginePromotion<C> | null = null;
  let bestSaving = 0;
  for (const promotion of promotions) {
    if (promotion.kind !== 'product_discount' && promotion.kind !== 'buy_x_pay_y') continue;
    if (!isLiveFor(promotion, ctx.now, ctx.channel) || !matchesTargets(item, promotion)) continue;
    const saving = unitSaving(item.unitPrice, promotion);
    if (saving <= 0) continue;
    if (best === null || saving > bestSaving || (saving === bestSaving && byAgeThenId(promotion, best) < 0)) {
      best = promotion;
      bestSaving = saving;
    }
  }
  return best?.id ?? null;
}

function productDiscounts(promotion: EnginePromotion<string>, items: EngineItem[]): Map<string, number> {
  const amounts = new Map<string, number>();
  let unitsLeft = promotion.maxUsesPerOrder ?? Infinity;
  for (const item of [...items].sort(byAddedThenId)) {
    const units = Math.min(item.quantity, unitsLeft);
    if (units <= 0) break;
    unitsLeft -= units;
    amounts.set(item.id, units * amountOff(item.unitPrice, promotion.discountType, promotion.discountValue));
  }
  return amounts;
}

function buyXPayYDiscounts(promotion: EnginePromotion<string>, items: EngineItem[]): Map<string, number> {
  const units = [...items]
    .sort((a, b) => b.unitPrice - a.unitPrice || byAddedThenId(a, b))
    .flatMap((item) => Array.from({ length: item.quantity }, () => item));
  const n = promotion.buyQuantity;
  const free = n - promotion.payQuantity;
  const groups = Math.min(Math.floor(units.length / n), promotion.maxUsesPerOrder ?? Infinity);
  const amounts = new Map<string, number>();
  for (let g = 0; g < groups; g++) {
    // Sorted descending: the last N−M units of the group are the cheapest.
    for (const unit of units.slice(g * n + n - free, g * n + n)) {
      amounts.set(unit.id, (amounts.get(unit.id) ?? 0) + restUnitDiscount(unit.unitPrice, promotion));
    }
  }
  return amounts;
}

/** The best live automatic bill discount on `base` (S4), or null. */
export function bestBillDiscount<C extends string>(base: number, promotions: Promotions<C>, ctx: EngineContext<C>): BillDiscount | null {
  let best: { promotion: EnginePromotion<C>; amount: number } | null = null;
  for (const promotion of promotions.values()) {
    if (promotion.kind !== 'bill_discount' || !isLiveFor(promotion, ctx.now, ctx.channel)) continue;
    if (base <= 0 || base < (promotion.minSubtotal ?? 0)) continue;
    let amount = amountOff(base, promotion.discountType, promotion.discountValue);
    if (promotion.maxDiscount !== null) amount = Math.min(amount, promotion.maxDiscount);
    if (amount <= 0) continue;
    if (best === null || amount > best.amount || (amount === best.amount && byAgeThenId(promotion, best.promotion) < 0)) {
      best = { promotion, amount };
    }
  }
  return best && { promotionId: best.promotion.id, label: best.promotion.name, amount: best.amount };
}

/** Every automatic discount of an order, recomputed from its live items. */
export function computeOrderDiscounts<C extends string>(
  items: readonly EngineItem[],
  promotionsById: Promotions<C>,
  ctx: EngineContext<C>,
): OrderDiscounts {
  const live = items.filter((item) => !item.voided);
  const grossSubtotal = live.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  const tagged = new Map<string, EngineItem[]>();
  const combos = new Map<string, EngineItem[]>();
  for (const item of live) {
    if (item.comboId !== null) {
      const bucket = combos.get(item.comboId);
      if (bucket) bucket.push(item);
      else combos.set(item.comboId, [item]);
    } else if (item.promotionId !== null) {
      const bucket = tagged.get(item.promotionId);
      if (bucket) bucket.push(item);
      else tagged.set(item.promotionId, [item]);
    }
  }

  const itemDiscounts: ItemDiscount[] = [];
  for (const [promotionId, group] of tagged) {
    const promotion = promotionsById.get(promotionId);
    if (!promotion) continue;
    const amounts =
      promotion.kind === 'product_discount'
        ? productDiscounts(promotion, group)
        : promotion.kind === 'buy_x_pay_y'
          ? buyXPayYDiscounts(promotion, group)
          : new Map<string, number>();
    for (const item of [...group].sort(byAddedThenId)) {
      const amount = amounts.get(item.id) ?? 0;
      if (amount > 0) itemDiscounts.push({ orderItemId: item.id, promotionId, label: promotion.name, amount });
    }
  }

  const comboDiscounts: ComboDiscount[] = [];
  for (const [comboId, components] of combos) {
    const sorted = [...components].sort(byAddedThenId);
    const promotionId = sorted.find((c) => c.promotionId !== null)?.promotionId;
    const promotion = promotionId ? promotionsById.get(promotionId) : undefined;
    if (!promotion || promotion.kind !== 'combo') continue;
    const sum = sorted.reduce((total, c) => total + c.unitPrice * c.quantity, 0);
    const amount = sum - promotion.comboPrice;
    if (amount > 0) {
      comboDiscounts.push({ comboId, orderItemId: sorted[0].id, promotionId: promotion.id, label: promotion.name, amount });
    }
  }

  const productDiscountTotal =
    itemDiscounts.reduce((sum, d) => sum + d.amount, 0) + comboDiscounts.reduce((sum, d) => sum + d.amount, 0);
  const billDiscount = bestBillDiscount(grossSubtotal - productDiscountTotal, promotionsById, ctx);
  return {
    itemDiscounts,
    comboDiscounts,
    billDiscount,
    grossSubtotal,
    productDiscountTotal,
    netSubtotal: grossSubtotal - productDiscountTotal - (billDiscount?.amount ?? 0),
  };
}

/** Validates a combo line: active now for the channel and exactly one valid choice per group. */
export function validateCombo<C extends string>(
  promotion: EnginePromotion<C>,
  choices: readonly ComboChoice[],
  ctx: EngineContext<C>,
): ComboValidation {
  if (promotion.kind !== 'combo' || !isLiveFor(promotion, ctx.now, ctx.channel)) {
    return { ok: false, errors: ['combo_inactive'] };
  }
  const errors = new Set<ComboErrorCode>();
  const seen = new Set<string>();
  for (const choice of choices) {
    const group = promotion.comboGroups.find((g) => g.id === choice.groupId);
    if (!group || !group.dishIds.includes(choice.dishId)) errors.add('combo_choice_invalid');
    if (seen.has(choice.groupId)) errors.add('combo_duplicate_group');
    seen.add(choice.groupId);
  }
  if (promotion.comboGroups.some((g) => !seen.has(g.id))) errors.add('combo_group_missing');
  const order: ComboErrorCode[] = ['combo_group_missing', 'combo_choice_invalid', 'combo_duplicate_group'];
  const found = order.filter((code) => errors.has(code));
  return found.length === 0 ? { ok: true } : { ok: false, errors: found };
}
