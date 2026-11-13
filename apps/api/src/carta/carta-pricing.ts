import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { type LineModifier, linePrice } from '../catalog/line-modifiers';
import { dishGroupsFromRows } from '../catalog/modifiers.service';
import type { PreviewItem } from '../promotions/engine';
import { OrderDiscountsService } from '../promotions/order-discounts.service';
import { type PromotionChannel, type RestaurantNow, type Rule, toRecord } from '../promotions/promotion-catalog.service';
import type { GuestPricing, GuestPricingLine } from './carta-delivery.dto';
import { CARTA_TABLE_MESSAGES } from './carta-table.dto';
import type { GuestMenuData } from './guest-menu-source';

export interface GuestPricingItem {
  dishId: string;
  quantity: number;
  optionIds?: string[];
}

const unavailable = () => new ConflictException(CARTA_TABLE_MESSAGES.dishUnavailable);
const optionsInvalid = () => new UnprocessableEntityException(CARTA_TABLE_MESSAGES.optionsInvalid);

/**
 * The options of a line checked like private.resolve_line_modifiers: active
 * options of the dish's active groups, each once, every group within
 * min..max. guest_menu_data only carries active groups and options.
 */
function lineModifiers(data: GuestMenuData, dishId: string, optionIds: readonly string[]): LineModifier[] {
  const groups = dishGroupsFromRows([dishId], data.modifierLinks).get(dishId) ?? [];
  if (new Set(optionIds).size !== optionIds.length) throw optionsInvalid();
  const chosen = optionIds.map((optionId) => {
    for (const group of groups) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) return { groupId: group.id, groupName: group.name, optionId, name: option.name, price: option.price };
    }
    throw optionsInvalid();
  });
  for (const group of groups) {
    const count = chosen.filter((m) => m.groupId === group.id).length;
    if (count < group.minSelect || count > (group.maxSelect ?? Number.MAX_SAFE_INTEGER)) throw optionsInvalid();
  }
  return chosen;
}

/**
 * round(base x percentage / 100) half away from zero, exact on the decimal
 * text of the percentage like the bill's numeric round
 * (private.recompute_order_bill, create_delivery_order).
 */
export function percentOf(base: number, percentage: string): number {
  const match = /^([+-]?)(\d*)\.?(\d*)$/.exec(percentage.trim());
  if (!match || `${match[2]}${match[3]}` === '') return Math.round((base * Number(percentage)) / 100);
  const scale = 10n ** BigInt(match[3].length);
  const numerator = BigInt(base) * BigInt(`${match[2]}${match[3]}`);
  const denominator = 100n * scale;
  const abs = numerator < 0n ? -numerator : numerator;
  const rounded = (2n * abs + denominator) / (2n * denominator);
  return Number((numerator < 0n) !== (match[1] === '-') ? -rounded : rounded);
}

/**
 * The tax percentage the guest total includes on `channel`. Only delivery
 * adds tax (L29: the cash prompt must match the confirmed delivery order),
 * read as create_delivery_order does (missing 0; null when it cannot cast,
 * then the preview has no tax because no such order can be created). Dine-in
 * and takeaway totals keep their previous meaning, the staff netSubtotal.
 */
export function channelTaxPercentage(
  channel: PromotionChannel,
  carta: { deliveryTaxPercentage: number | string | null },
): string | null {
  if (channel !== 'delivery') return null;
  return carta.deliveryTaxPercentage === null ? null : String(carta.deliveryTaxPercentage);
}

/**
 * The guest's totals for draft lines on `channel`, from the guest rows of
 * private.guest_menu_data: the steps of the staff POST /orders/pricing-preview
 * without an order (orders.service.ts priceLines and pricingPreview), on the
 * same engine calls — unit list price with options (linePrice), the automatic
 * promotion of each line (OrderDiscountsService.tag), then the line and bill
 * discounts (OrderDiscountsService.evaluate with no manual discounts). A
 * dish the carta does not sell now (unknown, paused or sold out) is 409, a
 * broken option rule 422. Tax is the bill's round(netSubtotal x
 * taxPercentage / 100); the delivery fee is added on delivery only, untaxed,
 * and no tip, as the confirmed delivery order's total.
 */
export function guestPricing(
  data: GuestMenuData,
  now: RestaurantNow,
  channel: PromotionChannel,
  items: readonly GuestPricingItem[],
  deliveryFee: number,
  taxPercentage: string | null,
): GuestPricing {
  const rules: Rule[] = data.promotions.map((row) => toRecord(row).rule);
  const ctx = { now: now.local, channel };
  const dishes = new Map(data.dishes.filter((dish) => dish.active).map((dish) => [dish.id, dish]));
  const at = now.instant.toISOString();
  const drafts = items.map((item, index): PreviewItem & { name: string } => {
    const dish = dishes.get(item.dishId);
    if (!dish || data.availability[item.dishId] === false) throw unavailable();
    const modifiers = lineModifiers(data, dish.id, item.optionIds ?? []);
    const unitPrice = linePrice(Number(dish.price), modifiers);
    const engineItem = {
      id: `new-${index}`,
      dishId: dish.id,
      categoryId: dish.categoryId,
      subcategoryId: dish.subcategoryId,
      unitPrice,
      quantity: item.quantity,
      promotionId: null,
      addedAt: '',
      voided: false,
      comboId: null,
    };
    return {
      ...engineItem,
      id: `draft-${index}`,
      optionsPrice: linePrice(0, modifiers),
      promotionId: OrderDiscountsService.tag(engineItem, rules, ctx).promotionId,
      addedAt: at,
      sent: false,
      name: dish.name,
    };
  });
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const { result } = OrderDiscountsService.evaluate(drafts, [], byId, ctx);
  const lines: GuestPricingLine[] = drafts.map((item) => ({
    dishId: item.dishId,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    promotionId: item.promotionId,
    promotionName: item.promotionId ? (byId.get(item.promotionId)?.name ?? null) : null,
    discounts: [
      ...result.itemDiscounts.filter((d) => d.orderItemId === item.id).map((d) => ({ kind: 'promotion_item', promotionId: d.promotionId, label: d.label, amount: d.amount })),
      ...result.comboDiscounts.filter((d) => d.orderItemId === item.id).map((d) => ({ kind: 'combo', promotionId: d.promotionId, label: d.label, amount: d.amount })),
    ],
  }));
  const bill = result.billDiscount;
  const totalDiscounts = Math.min(result.grossSubtotal, result.grossSubtotal - result.netSubtotal);
  const netSubtotal = result.grossSubtotal - totalDiscounts;
  const fee = channel === 'delivery' ? deliveryFee : 0;
  const tax = taxPercentage === null ? 0 : percentOf(netSubtotal, taxPercentage);
  return {
    channel,
    lines,
    billDiscount: bill ? { kind: 'promotion_bill', promotionId: bill.promotionId, label: bill.label, amount: bill.amount } : null,
    grossSubtotal: result.grossSubtotal,
    totalDiscounts,
    netSubtotal,
    taxPercentage: taxPercentage === null ? 0 : Number(taxPercentage),
    tax,
    deliveryFee: fee,
    total: netSubtotal + tax + fee,
  };
}
