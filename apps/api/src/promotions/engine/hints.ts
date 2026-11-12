import { computeOrderDiscounts, matchesTargets } from './engine';
import { isLiveFor, scheduleState } from './schedule';
import type { EnginePromotion, HintContext, PreviewItem, PricingHint } from './types';

/** Hints for the pricing preview (S8). Exact strings are documented in hints.spec.ts. */

const WINDOW_ENDING_MINUTES = 10;

/** Whole pesos with dot thousands: 80000 → "$80.000". */
export function formatPesos(amount: number): string {
  return `$${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/** "2x1", "3x2" for the classic free rules, else the promotion name. */
export function buyXPayYLabel(promotion: EnginePromotion<string>): string {
  const { buyQuantity: n, payQuantity: m, restDiscountPercent: rest } = promotion;
  if (rest === 100 && ((n === 2 && m === 1) || (n === 3 && m === 2))) return `${n}x${m}`;
  return promotion.name;
}

export function pricingHints<C extends string>(
  items: readonly PreviewItem[],
  promotions: readonly EnginePromotion<C>[],
  ctx: HintContext<C>,
): PricingHint[] {
  const live = items.filter((item) => !item.voided);
  const hints: PricingHint[] = [];

  for (const promotion of promotions) {
    if (promotion.kind !== 'buy_x_pay_y' || !isLiveFor(promotion, ctx.now, ctx.channel)) continue;
    const units = live
      .filter((item) => item.comboId === null && item.promotionId === promotion.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const n = promotion.buyQuantity;
    const remainder = units % n;
    const capReached = promotion.maxUsesPerOrder !== null && Math.floor(units / n) >= promotion.maxUsesPerOrder;
    if (remainder === 0 || capReached) continue;
    const missing = n - remainder;
    const noun = missing === 1 ? (promotion.unitNoun?.one ?? 'unidad') : (promotion.unitNoun?.other ?? 'unidades');
    const verb = missing === 1 ? 'Falta' : 'Faltan';
    hints.push({
      kind: 'missing_units',
      promotionId: promotion.id,
      missing,
      message: `${verb} ${missing} ${noun} para otro ${buyXPayYLabel(promotion)}.`,
    });
  }

  for (const promotion of promotions) {
    if (promotion.kind !== 'product_discount' && promotion.kind !== 'buy_x_pay_y') continue;
    if (!isLiveFor(promotion, ctx.now, ctx.channel)) continue;
    const { endsAtMinutes } = scheduleState(promotion, ctx.now);
    if (endsAtMinutes === null) continue;
    const minutesLeft = endsAtMinutes - ctx.now.minutes;
    if (minutesLeft > WINDOW_ENDING_MINUTES) continue;
    const unsentEligible = live.some((item) => !item.sent && item.comboId === null && matchesTargets(item, promotion));
    if (unsentEligible) hints.push({ kind: 'window_ending', promotionId: promotion.id, minutesLeft });
  }

  if (live.length > 0) {
    const byId = new Map(promotions.map((p) => [p.id, p]));
    const { grossSubtotal, productDiscountTotal } = computeOrderDiscounts(live, byId, ctx);
    const base = grossSubtotal - productDiscountTotal;
    for (const promotion of promotions) {
      if (promotion.kind !== 'bill_discount' || promotion.minSubtotal === null) continue;
      if (!isLiveFor(promotion, ctx.now, ctx.channel) || base >= promotion.minSubtotal) continue;
      const missing = promotion.minSubtotal - base;
      const benefit =
        promotion.discountType === 'percentage'
          ? `el ${promotion.discountValue ?? 0}% de descuento`
          : `${formatPesos(promotion.discountValue ?? 0)} de descuento`;
      const prefix = ctx.channelLabel ? `${ctx.channelLabel}: faltan` : 'Faltan';
      hints.push({ kind: 'bill_minimum', promotionId: promotion.id, missing, message: `${prefix} ${formatPesos(missing)} para ${benefit}.` });
    }
  }

  return hints;
}
