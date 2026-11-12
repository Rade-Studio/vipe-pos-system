import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import {
  bestBillDiscount,
  computeOrderDiscounts,
  type EngineContext,
  type EngineItem,
  type OrderDiscounts,
  selectPromotionForNewItem,
} from './engine';
import { PromotionCatalog, type PromotionChannel, type RestaurantNow, type Rule } from './promotion-catalog.service';
import { fromSnapshot, toSnapshot } from './promotion-snapshot';

/** A line as the engine reads it, plus the rule it was sent with. */
export interface StoredItem extends EngineItem {
  snapshot: Rule | null;
}

interface ItemRow {
  id: string;
  dish_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  price: string | number;
  quantity: number;
  promotion_id: string | null;
  promotion_snapshot: unknown;
  added_at: string;
  status: string | null;
  combo_id: string | null;
}

/** A manual order_discounts row (S7): kept by every recompute. */
export interface ManualDiscount {
  id: string;
  orderItemId: string | null;
  promotionId: string | null;
  kind: 'manual_item' | 'manual_bill';
  label: string;
  amount: number;
  /** For a line row, the line quantity its amount is for (a partial void rescales it). */
  lineQuantity: number | null;
}

/**
 * The automatic discounts around the manual ones (S2, S7): a partial void
 * rescales a manual line row to the units left (round(amount · left /
 * lineQuantity)); a line never carries more than its value, nor a combo more
 * than its lines, so manual rows keep their amount up to that value and the
 * automatic line and combo discounts get what is left; the automatic bill
 * discount is evaluated on the gross subtotal minus every line discount,
 * automatic and manual; the manual bill rows, oldest first, keep their amount
 * up to the base left after all of them (0 means the row goes).
 */
export function withManualDiscounts(
  result: OrderDiscounts,
  items: readonly EngineItem[],
  manual: readonly ManualDiscount[],
  rules: ReadonlyMap<string, Rule>,
  ctx: EngineContext<PromotionChannel>,
): { result: OrderDiscounts; manual: ManualDiscount[] } {
  const live = items.filter((item) => !item.voided);
  const quantity = new Map(live.map((item) => [item.id, item.quantity]));
  const lineValue = new Map(live.map((item) => [item.id, item.unitPrice * item.quantity]));
  // A combo's lines share one capacity: the sum of their values.
  const group = new Map(live.map((item) => [item.id, item.comboId ?? item.id]));
  const groupValue = new Map<string, number>();
  for (const item of live) groupValue.set(group.get(item.id)!, (groupValue.get(group.get(item.id)!) ?? 0) + item.unitPrice * item.quantity);
  const usedLine = new Map<string, number>();
  const usedGroup = new Map<string, number>();
  const take = (lineId: string, wanted: number, perLine = true) => {
    const key = group.get(lineId)!;
    const lineLeft = perLine ? (lineValue.get(lineId) ?? 0) - (usedLine.get(lineId) ?? 0) : Infinity;
    const amount = Math.max(0, Math.min(wanted, lineLeft, (groupValue.get(key) ?? 0) - (usedGroup.get(key) ?? 0)));
    usedLine.set(lineId, (usedLine.get(lineId) ?? 0) + amount);
    usedGroup.set(key, (usedGroup.get(key) ?? 0) + amount);
    return amount;
  };

  const lines = manual.flatMap((row): ManualDiscount[] => {
    if (row.orderItemId === null) return [];
    const left = quantity.get(row.orderItemId);
    // A cancelled line's rows do not count (private.order_bill_base); keep them as they are.
    if (left === undefined) return [];
    const rescaled = row.lineQuantity !== null && left < row.lineQuantity ? Math.round((row.amount * left) / row.lineQuantity) : row.amount;
    return [{ ...row, amount: take(row.orderItemId, rescaled), lineQuantity: row.lineQuantity === null ? null : left }];
  });
  const itemDiscounts = result.itemDiscounts.flatMap((d) => {
    const amount = take(d.orderItemId, d.amount);
    return amount > 0 ? [{ ...d, amount }] : [];
  });
  const comboDiscounts = result.comboDiscounts.flatMap((d) => {
    const amount = group.has(d.orderItemId) ? take(d.orderItemId, d.amount, false) : d.amount;
    return amount > 0 ? [{ ...d, amount }] : [];
  });
  const manualLines = lines.reduce((sum, row) => sum + row.amount, 0);
  const productDiscountTotal = itemDiscounts.reduce((sum, d) => sum + d.amount, 0) + comboDiscounts.reduce((sum, d) => sum + d.amount, 0);
  const billDiscount = bestBillDiscount(result.grossSubtotal - productDiscountTotal - manualLines, rules, ctx);
  let billLeft = Math.max(0, result.grossSubtotal - productDiscountTotal - manualLines - (billDiscount?.amount ?? 0));
  const bills = manual.flatMap((row): ManualDiscount[] => {
    if (row.orderItemId !== null) return [];
    const amount = Math.min(row.amount, billLeft);
    billLeft -= amount;
    return [{ ...row, amount }];
  });
  const byLine = new Map(lines.map((row) => [row.id, row]));
  const byBill = new Map(bills.map((row) => [row.id, row]));
  const kept = manual.flatMap((row) => {
    const next = byLine.get(row.id) ?? byBill.get(row.id);
    return next ? [next] : [];
  });
  return {
    result: {
      ...result,
      itemDiscounts,
      comboDiscounts,
      billDiscount,
      productDiscountTotal,
      netSubtotal: result.grossSubtotal - productDiscountTotal - (billDiscount?.amount ?? 0),
    },
    manual: kept,
  };
}

/** Orders whose discounts are history: never recomputed. */
const CLOSED = ['paid', 'cancelled'];

/**
 * The automatic discounts of an order (S3–S6): every call runs inside the
 * request transaction (UnitOfWork) of the write that changed the items, after
 * the order row was locked by that write. Sent lines keep the rule of their
 * snapshot; only the bill discount reads the live promotions, with the server
 * clock in the restaurant timezone and the order's channel.
 */
@Injectable()
export class OrderDiscountsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: PromotionCatalog,
  ) {}

  /** The lines of an order in the engine shape (cancelled lines come as voided). */
  async items(orderId: string): Promise<StoredItem[]> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT oi.id, oi.dish_id, d.category_id, d.subcategory_id, oi.price, oi.quantity, oi.promotion_id,
             oi.promotion_snapshot, to_jsonb(oi.added_at) #>> '{}' AS added_at, oi.status, oi.combo_id
        FROM public.order_items oi
        LEFT JOIN public.dishes d ON d.id = oi.dish_id
       WHERE oi.order_id = ${orderId}
       ORDER BY oi.added_at, oi.created_at, oi.id`);
    return (rows as unknown as ItemRow[]).map((row) => ({
      id: row.id,
      dishId: row.dish_id ?? '',
      categoryId: row.category_id,
      subcategoryId: row.subcategory_id,
      unitPrice: Number(row.price),
      quantity: Number(row.quantity),
      promotionId: row.promotion_id,
      addedAt: new Date(row.added_at).toISOString(),
      voided: row.status === 'cancelled' || Number(row.quantity) === 0,
      comboId: row.combo_id,
      snapshot: fromSnapshot<PromotionChannel>(row.promotion_snapshot),
    }));
  }

  /**
   * The rules a computation needs: each line's snapshot (the oldest one of a
   * promotion wins if it changed between sends) plus every live bill discount.
   */
  async rulesFor(items: readonly StoredItem[], live?: readonly Rule[]): Promise<Map<string, Rule>> {
    const rules = new Map<string, Rule>();
    for (const item of items) {
      if (item.promotionId && item.snapshot && !rules.has(item.promotionId)) rules.set(item.promotionId, item.snapshot);
    }
    for (const rule of live ?? (await this.catalog.rules())) {
      if (rule.kind === 'bill_discount' && !rules.has(rule.id)) rules.set(rule.id, rule);
    }
    return rules;
  }

  /** The automatic product promotion of a line being sent now, with its snapshot. */
  static tag(item: EngineItem, rules: readonly Rule[], ctx: EngineContext<PromotionChannel>): { promotionId: string | null; snapshot: Record<string, unknown> | null } {
    const promotionId = selectPromotionForNewItem(item, rules, ctx);
    const rule = promotionId ? rules.find((r) => r.id === promotionId) : undefined;
    return { promotionId: rule?.id ?? null, snapshot: rule ? toSnapshot(rule) : null };
  }

  /**
   * Tags lines inserted without a promotion (create_delivery_order): each gets
   * the promotion it qualifies for now on the order's channel, and its snapshot.
   */
  async tagUntagged(orderId: string, itemIds: readonly string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const channel = await this.channel(orderId);
    if (!channel) return;
    const now = await this.catalog.now();
    const rules = await this.catalog.rules();
    const ctx = { now: now.local, channel };
    const wanted = new Set(itemIds);
    const updates = (await this.items(orderId))
      .filter((item) => wanted.has(item.id) && item.promotionId === null && item.comboId === null && !item.voided)
      .map((item) => ({ id: item.id, ...OrderDiscountsService.tag(item, rules, ctx) }))
      .filter((u) => u.promotionId !== null);
    if (updates.length === 0) return;
    await this.uow.db.execute(sql`
      UPDATE public.order_items oi
         SET promotion_id = x.promotion_id, promotion_snapshot = x.snapshot, updated_at = now()
        FROM jsonb_to_recordset(${JSON.stringify(updates.map((u) => ({ id: u.id, promotion_id: u.promotionId, snapshot: u.snapshot })))}::jsonb)
               AS x(id uuid, promotion_id uuid, snapshot jsonb)
       WHERE oi.id = x.id AND oi.order_id = ${orderId}`);
  }

  /**
   * Replaces the order's automatic order_discounts with a fresh computation
   * and recomputes the bill. Manual rows are kept (S7), rescaled or lowered
   * when a void left their line or the bill worth less (withManualDiscounts). Paid and cancelled orders
   * are left as they are.
   */
  async recompute(orderId: string, now?: RestaurantNow): Promise<OrderDiscounts | null> {
    const channel = await this.channel(orderId);
    if (!channel) return null;
    const clock = now ?? (await this.catalog.now());
    const items = await this.items(orderId);
    const rules = await this.rulesFor(items);
    const ctx = { now: clock.local, channel };
    const manual = await this.manual(orderId);
    const { result, manual: kept } = withManualDiscounts(computeOrderDiscounts(items, rules, ctx), items, manual, rules, ctx);
    const lowered = kept.filter((row) => {
      const before = manual.find((m) => m.id === row.id);
      return row.amount !== before?.amount || row.lineQuantity !== before?.lineQuantity;
    });
    if (lowered.some((row) => row.amount <= 0)) {
      await this.uow.db.execute(sql`
        DELETE FROM public.order_discounts WHERE order_id = ${orderId} AND id = ANY(${sql.param(lowered.filter((r) => r.amount <= 0).map((r) => r.id))}::uuid[])`);
    }
    for (const row of lowered.filter((r) => r.amount > 0)) {
      await this.uow.db.execute(sql`
        UPDATE public.order_discounts SET amount = ${row.amount}, line_quantity = ${row.lineQuantity} WHERE id = ${row.id} AND order_id = ${orderId}`);
    }
    await this.uow.db.execute(sql`DELETE FROM public.order_discounts WHERE order_id = ${orderId} AND source = 'automatic'`);
    const rows = [
      ...result.itemDiscounts.map((d) => ({ order_item_id: d.orderItemId, promotion_id: d.promotionId, kind: 'promotion_item', label: d.label, amount: d.amount, combo_id: null })),
      ...result.comboDiscounts.map((d) => ({ order_item_id: d.orderItemId, promotion_id: d.promotionId, kind: 'combo', label: d.label, amount: d.amount, combo_id: d.comboId })),
      ...(result.billDiscount
        ? [{ order_item_id: null, promotion_id: result.billDiscount.promotionId, kind: 'promotion_bill', label: result.billDiscount.label, amount: result.billDiscount.amount, combo_id: null }]
        : []),
    ];
    if (rows.length > 0) {
      // A promotion deleted since the line was sent keeps its label; its id is gone (order_discounts_promotion_id_fkey).
      await this.uow.db.execute(sql`
        INSERT INTO public.order_discounts (order_id, order_item_id, promotion_id, kind, source, label, amount, combo_id, requires_authorization)
        SELECT ${orderId}::uuid, x.order_item_id, p.id, x.kind, 'automatic', left(x.label, 255), x.amount, x.combo_id, false
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
                 AS x(order_item_id uuid, promotion_id uuid, kind text, label text, amount numeric, combo_id uuid)
          LEFT JOIN public.promotions p ON p.id = x.promotion_id`);
    }
    await this.uow.db.execute(sql`SELECT private.recompute_caller_order_bill(${orderId}::uuid)`);
    return result;
  }

  /** The manual discounts of an order, oldest first. */
  async manual(orderId: string): Promise<ManualDiscount[]> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT id, order_item_id, promotion_id, kind, label, amount, line_quantity FROM public.order_discounts
       WHERE order_id = ${orderId} AND source = 'manual'
       ORDER BY created_at, id`);
    return (rows as { id: string; order_item_id: string | null; promotion_id: string | null; kind: ManualDiscount['kind']; label: string; amount: string | number; line_quantity: number | null }[]).map((row) => ({
      id: row.id,
      orderItemId: row.order_item_id,
      promotionId: row.promotion_id,
      kind: row.kind,
      label: row.label,
      amount: Number(row.amount),
      lineQuantity: row.line_quantity === null ? null : Number(row.line_quantity),
    }));
  }

  /** The order's channel, or null when it is closed or not visible. */
  private async channel(orderId: string): Promise<PromotionChannel | null> {
    const { rows } = await this.uow.db.execute(sql`SELECT status, order_type FROM public.orders WHERE id = ${orderId}`);
    const order = rows[0] as { status: string; order_type: string | null } | undefined;
    if (!order || CLOSED.includes(order.status)) return null;
    return (order.order_type ?? 'dine_in') as PromotionChannel;
  }
}
