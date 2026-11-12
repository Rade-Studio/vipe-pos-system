import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { VoidsService } from '../audit/voids.service';
import type { Dish } from '../catalog/catalog.dto';
import { DishesService } from '../catalog/dishes.service';
import { linePrice, resolveLineModifiers } from '../catalog/line-modifiers';
import { UnitOfWork } from '../db/unit-of-work';
import { paymentJson } from '../payments/payments.mappers';
import { computeOrderDiscounts, type EngineContext, type PreviewItem, pricingHints, validateCombo } from '../promotions/engine';
import { OrderDiscountsService, withManualDiscounts } from '../promotions/order-discounts.service';
import { CHANNEL_LABELS, PromotionCatalog, type PromotionChannel, type RestaurantNow, type Rule } from '../promotions/promotion-catalog.service';
import { toSnapshot } from '../promotions/promotion-snapshot';
import { clockText } from '../promotions/promotion-text';
import { ConfigService } from '../settings/config.service';
import {
  type addOrderItemsSchema,
  type ComboLineInput,
  type cancelOrderSchema,
  type CancelledOrder,
  type CompletedOrder,
  type createOrderSchema,
  DELETE_DEFAULT_REASON,
  type Order,
  ORDER_LIST_LIMIT,
  type OrderStatus,
  type OrderType,
  type PreviewLine,
  type PricingPreview,
  type pricingPreviewSchema,
  type StockShortage,
  type updateOrderDetailsSchema,
  type voidOrderItemsSchema,
} from './orders.dto';
import {
  type CancelledOrderRow,
  type CompletedOrderRow,
  type OrderRow,
  toCancelledOrder,
  toCompletedOrder,
  toOrder,
  toShortage,
} from './orders.mappers';

type ItemInput = NonNullable<z.infer<typeof createOrderSchema>['items']>[number];
/** A line ready to insert: list price (options included), the promotion fixed now and, for a combo choice, its combo. */
interface PricedLine {
  dishId: string;
  dish: Dish;
  quantity: number;
  price: number;
  comments: string | null;
  optionIds: string[];
  promotionId: string | null;
  snapshot: Record<string, unknown> | null;
  comboId: string | null;
}
/** What priceItems needs to tag lines: the promotions and the restaurant clock on the order's channel. */
interface PricingContext {
  now: RestaurantNow;
  rules: Rule[];
  ctx: EngineContext<PromotionChannel>;
}
type OrderDetails = z.infer<typeof updateOrderDetailsSchema>;
type CancelInput = z.infer<typeof cancelOrderSchema>;
/** Live lines: a fully voided line (quantity 0, status cancelled) is history, not part of the order. */
const LIVE_ITEMS = sql`oi.status IS DISTINCT FROM 'cancelled'`;
/** One order_discounts row `od` with its authorizer's name (`ap` joined on authorized_by). */
const DISCOUNT_JSON = sql`to_jsonb(od) || jsonb_build_object('authorized_by_name', ap.full_name)`;
/** A line as the API reads it: the order_items row plus its option snapshot (F7), in menu order, and its discounts. */
const ITEM_JSON = sql`(to_jsonb(oi) - 'promotion_snapshot') || jsonb_build_object('modifiers', coalesce((
  SELECT jsonb_agg(jsonb_build_object('group_id', m.group_id, 'group_name', m.group_name, 'option_id', m.option_id,
                                      'option_name', m.option_name, 'price', m.price) ORDER BY m.sort_order)
    FROM public.order_item_modifiers m WHERE m.order_item_id = oi.id), '[]'::jsonb),
  'promotion_name', oi.promotion_snapshot ->> 'name',
  'discounts', coalesce((
  SELECT jsonb_agg(${DISCOUNT_JSON} ORDER BY od.created_at, od.id)
    FROM public.order_discounts od LEFT JOIN public.profiles ap ON ap.id = od.authorized_by
   WHERE od.order_item_id = oi.id), '[]'::jsonb))`;
/** The discounts of order `o` whose line (if any) is not cancelled: line discounts in line order, then bill discounts. */
const ORDER_DISCOUNTS = sql`coalesce((
  SELECT jsonb_agg(${DISCOUNT_JSON} ORDER BY (od.order_item_id IS NULL), li.added_at, li.created_at, od.created_at, od.id)
    FROM public.order_discounts od
    LEFT JOIN public.order_items li ON li.id = od.order_item_id
    LEFT JOIN public.profiles ap ON ap.id = od.authorized_by
   WHERE od.order_id = o.id AND (od.order_item_id IS NULL OR li.status IS DISTINCT FROM 'cancelled')), '[]'::jsonb)`;
/** Order statuses that keep a table busy. */
const OPEN_STATUSES = ['active', 'kitchen', 'delivered'];
/** Roles a profile must have to own an order or a table. */
const WAITER_ROLES = ['waiter', 'admin'];
/** A combo choice is one unit. */
const COMBO_QUANTITY = 1;

export interface OrderListFilter {
  statuses?: OrderStatus[];
  withTable?: boolean;
  withWaiter?: boolean;
  stationId?: string;
}

/**
 * Orders of the caller's restaurant. Every method runs inside the request
 * transaction (UnitOfWork), so a write is all or nothing; RLS scopes every
 * statement. Lines are stored at list price; the automatic discounts come
 * from the promotion engine (OrderDiscountsService, after every item change)
 * and the bill from private.recompute_order_bill (through
 * private.recompute_caller_order_bill), the same base pay_order trusts.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly dishes: DishesService,
    private readonly voids: VoidsService,
    private readonly promotions: PromotionCatalog,
    private readonly discounts: OrderDiscountsService,
  ) {}

  async list(filter: OrderListFilter): Promise<Order[]> {
    const conditions: SQL[] = [];
    if (filter.statuses?.length) {
      conditions.push(sql`o.status = ANY(${sql.param(filter.statuses)}::text[])`);
    }
    // F6: the kitchen screen of one station sees only its lines.
    const items = filter.stationId ? sql`${LIVE_ITEMS} AND oi.station_id = ${filter.stationId}::uuid` : LIVE_ITEMS;
    if (filter.stationId) {
      conditions.push(sql`EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND ${items})`);
    }
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
    const rows = await this.select(where, sql`ORDER BY o.created_at DESC, o.id LIMIT ${ORDER_LIST_LIMIT}`, items);
    return rows.map((row) => toOrder(row, filter));
  }

  async get(id: string, filter: OrderListFilter = {}): Promise<Order> {
    const [row] = await this.select(sql`WHERE o.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Order not found');
    }
    return toOrder(row, filter);
  }

  /**
   * GET /orders/completed: paid orders created on `date` in the restaurant's
   * timezone, each with its pay_order payment and tenders or, for orders paid
   * before pay_order, its legacy payment_transactions rows. One query (the web
   * read one payment_transactions request per order).
   */
  async completed(date: string): Promise<CompletedOrder[]> {
    const rows = await this.rows<CompletedOrderRow>(sql`
      SELECT to_jsonb(o) AS "order",
             NULL AS table_number,
             NULL AS waiter_name,
             coalesce((SELECT jsonb_agg(${ITEM_JSON} ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${LIVE_ITEMS}), '[]'::jsonb) AS items,
             ${ORDER_DISCOUNTS} AS discounts,
             (SELECT ${paymentJson} FROM public.payments p WHERE p.order_id = o.id) AS payment,
             CASE WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = o.id) THEN '[]'::jsonb
                  ELSE coalesce((SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.timestamp, pt.id)
                                   FROM public.payment_transactions pt WHERE pt.order_id = o.id), '[]'::jsonb)
             END AS legacy_transactions
        FROM public.orders o
        JOIN public.restaurants r ON r.id = o.restaurant_id
       WHERE o.status = 'paid'
         AND o.created_at >= (${date}::date::timestamp AT TIME ZONE r.timezone)
         AND o.created_at < ((${date}::date + 1)::timestamp AT TIME ZONE r.timezone)
       ORDER BY o.created_at DESC, o.id`);
    return rows.map(toCompletedOrder);
  }

  /**
   * POST /orders: order and items in kitchen, the bill from the database,
   * the stock check (409 with the shortages unless `force`), the stock
   * consumption and the table in kitchen, all in the request transaction.
   */
  async create(input: z.infer<typeof createOrderSchema>, callerProfileId: string): Promise<Order> {
    const table = await this.lockTable(input.tableId);
    const [open] = await this.rows<{ id: string }>(sql`
      SELECT id FROM public.orders
       WHERE table_id = ${table.id} AND status = ANY(${sql.param(OPEN_STATUSES)}::text[])
       ORDER BY created_at LIMIT 1`);
    if (open) {
      throw new ConflictException({ message: 'Table has an open order', orderId: open.id });
    }
    const waiterId = input.waiterId ?? table.waiter_id ?? callerProfileId;
    if (input.waiterId) {
      await this.assertProfile(input.waiterId);
    }
    const pricing = await this.pricingContext('dine_in');
    const lines = await this.priceLines(input.items ?? [], input.combos ?? [], pricing);
    if (!input.force) {
      await this.assertStock(lines);
    }
    const settings = await this.config.get();
    const [order] = await this.rows<{ id: string }>(sql`
      INSERT INTO public.orders
        (table_id, waiter_id, status, order_type, subtotal, tax, tax_percentage, tip, tip_percentage, total, guests, notes)
      VALUES
        (${table.id}, ${waiterId}, 'kitchen', 'dine_in', 0, 0, ${settings.taxPercentage}, 0,
         ${input.tipPercentage ?? settings.tipPercentage}, 0, ${input.guests ?? null}, ${input.notes ?? null})
      RETURNING id`).catch((error: unknown) => {
      // 0015 trigger orders_table_active: no new order on an inactive table.
      if (isInactiveTableError(error)) {
        throw new ConflictException('La mesa está inactiva');
      }
      throw error;
    });
    await this.insertItems(order.id, lines);
    await this.afterItems(order.id, pricing.now);
    // The waiter who sends the first order keeps the table (WaiterView assigned it client-side).
    await this.uow.db.execute(sql`
      UPDATE public.tables
         SET status = 'kitchen', waiter_id = coalesce(waiter_id, ${waiterId}), updated_at = now()
       WHERE id = ${table.id}`);
    return this.get(order.id);
  }

  /** POST /orders/:id/items: same checks; the order and its table go back to kitchen. */
  async addItems(id: string, input: z.infer<typeof addOrderItemsSchema>): Promise<Order> {
    const order = await this.lockOrder(id);
    if (order.status === 'paid' || order.status === 'cancelled') {
      throw new ConflictException('Order is closed');
    }
    const pricing = await this.pricingContext(order.order_type ?? 'dine_in');
    const lines = await this.priceLines(input.items ?? [], input.combos ?? [], pricing);
    if (!input.force) {
      await this.assertStock(lines);
    }
    await this.insertItems(id, lines);
    await this.afterItems(id, pricing.now);
    await this.uow.db.execute(sql`UPDATE public.orders SET status = 'kitchen', updated_at = now() WHERE id = ${id}`);
    await this.setDetails(id, input);
    await this.setTableStatus(order.table_id, 'kitchen');
    return this.get(id);
  }

  /** PATCH /orders/:id: guests and/or notes of an open order (active, kitchen or delivered). */
  async updateDetails(id: string, input: OrderDetails): Promise<Order> {
    const order = await this.lockOrder(id);
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new ConflictException('Order is closed');
    }
    await this.setDetails(id, input);
    return this.get(id);
  }

  /** Writes only the given keys; null clears. */
  private async setDetails(id: string, input: OrderDetails): Promise<void> {
    const sets: SQL[] = [];
    if (input.guests !== undefined) {
      sets.push(sql`guests = ${input.guests}`);
    }
    if (input.notes !== undefined) {
      sets.push(sql`notes = ${input.notes}`);
    }
    if (sets.length > 0) {
      await this.uow.db.execute(sql`UPDATE public.orders SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}`);
    }
  }

  /** PATCH /orders/:id/status: only kitchen -> delivered; the table becomes served. */
  async markDelivered(id: string): Promise<Order> {
    const order = await this.lockOrder(id);
    if (order.status !== 'kitchen') {
      throw new ConflictException('Order is not in kitchen');
    }
    await this.deliver(id, order.table_id);
    return this.get(id);
  }

  /**
   * POST /orders/:id/items/served: the items become served; when no kitchen
   * item remains, the order becomes delivered and its table served.
   */
  async serveItems(id: string, itemIds: string[]): Promise<Order> {
    const order = await this.lockOrder(id);
    if (order.status === 'paid' || order.status === 'cancelled') {
      throw new ConflictException('Order is closed');
    }
    const unique = [...new Set(itemIds)];
    const found = await this.rows<{ id: string }>(sql`
      SELECT id FROM public.order_items WHERE order_id = ${id} AND id = ANY(${sql.param(unique)}::uuid[])`);
    if (found.length !== unique.length) {
      throw new UnprocessableEntityException('Unknown item');
    }
    await this.uow.db.execute(sql`
      UPDATE public.order_items SET status = 'served', updated_at = now()
       WHERE order_id = ${id} AND id = ANY(${sql.param(unique)}::uuid[]) AND status = 'kitchen'`);
    const [pending] = await this.rows(sql`
      SELECT 1 FROM public.order_items WHERE order_id = ${id} AND status = 'kitchen' LIMIT 1`);
    if (!pending && order.status === 'kitchen') {
      await this.deliver(id, order.table_id);
    }
    return this.get(id);
  }

  /**
   * POST /orders/:id/cancel: public.cancel_order. Never deletes: the order
   * becomes cancelled with its reason, actor, supervisor and bill, and the
   * table is freed when no other open order remains. Needs the supervisor
   * authorization (cancel_order) when the order has a live line or any payment.
   * An admin may cancel a delivery here too (same function, delivery rules:
   * reason always, supervisor only when paid); cashiers and waiters get
   * delivery_order. Domicilios uses POST /delivery/orders/:id/cancel.
   */
  async cancel(id: string, input: CancelInput): Promise<CancelledOrder> {
    await this.voids.run(
      'cancel_order',
      input.authorizationId,
      sql`SELECT public.cancel_order(${id}::uuid, ${input.reason}, ${input.reasonText ?? null}, ${input.authorizationId ?? null}::uuid) AS result`,
    );
    const [row] = await this.cancelledRows(sql`o.id = ${id}`);
    return toCancelledOrder(row);
  }

  /**
   * DELETE /orders/:id: kept for old callers, now the audited cancellation.
   * Without a body it cancels only an order with nothing on it (reason
   * DELETE_DEFAULT_REASON); an order with a live line or a payment answers
   * 403 authorization_required unless the body brings the reason and the
   * authorization, exactly as POST /orders/:id/cancel.
   */
  async remove(id: string, input: CancelInput | undefined): Promise<void> {
    await this.cancel(id, input ?? DELETE_DEFAULT_REASON);
  }

  /**
   * POST /orders/:id/items/void: public.void_order_items. Each line loses the
   * voided units (0 = cancelled, left out of `items`), the bill is
   * recomputed, and a kitchen order with no kitchen line left is delivered.
   * Stock is not given back (a sent dish was prepared; the void records it).
   */
  async voidItems(id: string, input: z.infer<typeof voidOrderItemsSchema>): Promise<Order> {
    const items = await this.withWholeCombos(id, input.items);
    await this.voids.run(
      'void_item',
      input.authorizationId,
      sql`SELECT public.void_order_items(${id}::uuid, ${JSON.stringify(items)}::jsonb, ${input.reason},
                                        ${input.reasonText ?? null}, ${input.authorizationId ?? null}::uuid) AS result`,
    );
    // S6: the remaining lines regroup (buy_x_pay_y) and the bill discount is evaluated again.
    await this.discounts.recompute(id);
    return this.get(id);
  }

  /**
   * S5: voiding any line of a combo voids every live line of that combo, whole.
   * Lines outside combos keep the requested units.
   */
  private async withWholeCombos(orderId: string, requested: { itemId: string; quantity: number }[]) {
    const ids = requested.map((item) => item.itemId);
    const combos = await this.rows<{ id: string; quantity: number }>(sql`
      SELECT oi.id, oi.quantity FROM public.order_items oi
       WHERE oi.order_id = ${orderId} AND ${LIVE_ITEMS} AND oi.combo_id IN (
         SELECT c.combo_id FROM public.order_items c
          WHERE c.order_id = ${orderId} AND c.id = ANY(${sql.param(ids)}::uuid[]) AND c.combo_id IS NOT NULL)`);
    const whole = new Map(combos.map((row) => [row.id, Number(row.quantity)]));
    const lines = requested.map((item) => ({ order_item_id: item.itemId, quantity: whole.get(item.itemId) ?? item.quantity }));
    for (const [itemId, quantity] of whole) {
      if (!ids.includes(itemId)) lines.push({ order_item_id: itemId, quantity });
    }
    return lines;
  }

  /**
   * POST /orders/pricing-preview (S8): the order's lines (with the promotions
   * they were sent with) plus the draft lines tagged as if sent now, their
   * discounts, the bill discount, totals and hints. Writes nothing.
   */
  async pricingPreview(input: z.infer<typeof pricingPreviewSchema>): Promise<PricingPreview> {
    const pricing = await this.pricingContext(input.channel);
    const existing = input.orderId ? await this.previewOrderItems(input.orderId) : [];
    const dishLines = input.lines.flatMap((line, index) => ('dishId' in line ? [{ line, index }] : []));
    const comboLines = input.lines.flatMap((line, index) => ('comboPromotionId' in line ? [{ line, index }] : []));
    const priced = await this.priceLines(
      dishLines.map(({ line }) => ({ dishId: line.dishId, quantity: line.quantity, modifiers: line.modifiers })),
      comboLines.map(({ line }) => line),
      pricing,
      { draftCombos: true },
    );
    const draftIndexes = [
      ...dishLines.map(({ index }) => index),
      ...comboLines.flatMap(({ line, index }) => line.choices.map(() => index)),
    ];
    const at = pricing.now.instant.toISOString();
    const drafts: (PreviewItem & { draftIndex: number; name: string })[] = priced.map((line, i) => ({
      id: `draft-${i}`,
      dishId: line.dishId,
      categoryId: line.dish.categoryId,
      subcategoryId: line.dish.subcategoryId,
      unitPrice: line.price,
      quantity: line.quantity,
      promotionId: line.promotionId,
      addedAt: at,
      voided: false,
      comboId: line.comboId,
      sent: false,
      draftIndex: draftIndexes[i],
      name: line.dish.name,
    }));
    const sent = existing.filter((item) => !item.voided);
    const all: PreviewItem[] = [...sent, ...drafts];
    const rules = await this.discounts.rulesFor(existing, pricing.rules);
    for (const rule of pricing.rules) {
      if (!rules.has(rule.id)) rules.set(rule.id, rule);
    }
    // S7: the order's manual discounts count too, and the automatic ones get what they leave.
    const manual = input.orderId ? await this.discounts.manual(input.orderId) : [];
    const { result, manual: kept } = withManualDiscounts(computeOrderDiscounts(all, rules, pricing.ctx), all, manual, rules, pricing.ctx);
    const manualJson = (d: (typeof kept)[number]) => ({ kind: d.kind, promotionId: d.promotionId, label: d.label, amount: d.amount });
    const lineDiscounts = (itemId: string): PreviewLine['discounts'] => [
      ...kept.filter((d) => d.orderItemId === itemId).map(manualJson),
      ...result.itemDiscounts.filter((d) => d.orderItemId === itemId).map((d) => ({ kind: 'promotion_item' as const, promotionId: d.promotionId, label: d.label, amount: d.amount })),
      ...result.comboDiscounts.filter((d) => d.orderItemId === itemId).map((d) => ({ kind: 'combo' as const, promotionId: d.promotionId, label: d.label, amount: d.amount })),
    ];
    const lines: PreviewLine[] = [
      ...sent.map((item) => ({
        sent: true,
        orderItemId: item.id,
        draftIndex: null,
        dishId: item.dishId || null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        promotionId: item.promotionId,
        promotionName: item.snapshot?.name ?? null,
        comboId: item.comboId,
        addedAt: item.addedAt,
        discounts: lineDiscounts(item.id),
      })),
      ...drafts.map((item) => ({
        sent: false,
        orderItemId: null,
        draftIndex: item.draftIndex,
        dishId: item.dishId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        promotionId: item.promotionId,
        promotionName: item.promotionId ? (rules.get(item.promotionId)?.name ?? null) : null,
        comboId: item.comboId,
        addedAt: null,
        discounts: lineDiscounts(item.id),
      })),
    ];
    const hints = pricingHints(all, pricing.rules, { ...pricing.ctx, channelLabel: CHANNEL_LABELS[input.channel] }).map((hint) =>
      hint.kind === 'window_ending'
        ? { ...hint, message: `Envía antes de las ${clockText(pricing.now.local.minutes + hint.minutesLeft)}.` }
        : hint,
    );
    const bill = result.billDiscount;
    const totalDiscounts = Math.min(result.grossSubtotal, result.grossSubtotal - result.netSubtotal + kept.reduce((sum, d) => sum + d.amount, 0));
    return {
      channel: input.channel,
      now: at,
      lines,
      billDiscount: bill ? { kind: 'promotion_bill', promotionId: bill.promotionId, label: bill.label, amount: bill.amount } : null,
      manualDiscounts: kept.filter((d) => d.orderItemId === null).map(manualJson),
      grossSubtotal: result.grossSubtotal,
      totalDiscounts,
      netSubtotal: result.grossSubtotal - totalDiscounts,
      hints,
    };
  }

  /** The lines of an order for the preview, with their names; 404 when the caller cannot see it. */
  private async previewOrderItems(orderId: string) {
    const [order] = await this.rows(sql`SELECT 1 FROM public.orders WHERE id = ${orderId}`);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const names = new Map(
      (await this.rows<{ id: string; name: string }>(sql`SELECT id, name FROM public.order_items WHERE order_id = ${orderId}`)).map((row) => [row.id, row.name]),
    );
    return (await this.discounts.items(orderId)).map((item) => ({ ...item, sent: true, name: names.get(item.id) ?? '' }));
  }

  /**
   * GET /orders/cancelled?date=: orders cancelled that day (restaurant timezone), newest first, with their amounts.
   * Deliveries cancelled before 0019 (delivery_status cancelled, no order_cancellations row) are read as they
   * are: `legacy`, no reason and no actor, the bill of the order plus its fee, at cancelled_at.
   */
  async cancelledOn(date: string): Promise<CancelledOrder[]> {
    const rows = await this.cancelledRows(sql`
      c.cancelled_at >= (${date}::date::timestamp AT TIME ZONE r.timezone)
      AND c.cancelled_at < ((${date}::date + 1)::timestamp AT TIME ZONE r.timezone)`);
    return rows.map(toCancelledOrder);
  }

  private cancelledRows(where: SQL): Promise<CancelledOrderRow[]> {
    return this.rows<CancelledOrderRow>(sql`
      SELECT to_jsonb(o) AS "order",
             t.number AS table_number,
             p.full_name AS waiter_name,
             coalesce((SELECT jsonb_agg(${ITEM_JSON} ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${LIVE_ITEMS}), '[]'::jsonb) AS items,
             ${ORDER_DISCOUNTS} AS discounts,
             c.cancellation,
             CASE WHEN d.order_id IS NOT NULL
                  THEN jsonb_build_object('customer_name', d.customer_name, 'delivery_fee', d.delivery_fee) END AS delivery
        FROM (SELECT x.order_id, x.restaurant_id, x.cancelled_at, to_jsonb(x) AS cancellation
                FROM public.order_cancellations x
              UNION ALL
              SELECT od.order_id, od.restaurant_id, coalesce(od.cancelled_at, od.updated_at),
                     jsonb_build_object('legacy', true, 'self_authorized', false,
                                        'subtotal', lo.subtotal, 'tax', lo.tax, 'tip', lo.tip,
                                        'total', lo.subtotal + lo.tax + lo.tip + od.delivery_fee,
                                        'sent_items', (SELECT count(*) FROM public.order_items li WHERE li.order_id = od.order_id AND li.quantity > 0
                                                         AND li.status IS DISTINCT FROM 'cancelled'),
                                        'cancelled_at', coalesce(od.cancelled_at, od.updated_at))
                FROM public.order_deliveries od
                JOIN public.orders lo ON lo.id = od.order_id
               WHERE od.delivery_status = 'cancelled'
                 AND NOT EXISTS (SELECT 1 FROM public.order_cancellations y WHERE y.order_id = od.order_id)) c
        JOIN public.orders o ON o.id = c.order_id
        JOIN public.restaurants r ON r.id = c.restaurant_id
        LEFT JOIN public.order_deliveries d ON d.order_id = o.id
        LEFT JOIN public.tables t ON t.id = o.table_id
        LEFT JOIN public.profiles p ON p.id = o.waiter_id
       WHERE ${where}
       ORDER BY c.cancelled_at DESC, o.id
       LIMIT ${ORDER_LIST_LIMIT}`);
  }

  private async deliver(id: string, tableId: string | null): Promise<void> {
    await this.uow.db.execute(sql`UPDATE public.orders SET status = 'delivered', updated_at = now() WHERE id = ${id}`);
    await this.setTableStatus(tableId, 'served');
  }

  private async setTableStatus(tableId: string | null, status: string): Promise<void> {
    if (tableId) {
      await this.uow.db.execute(sql`UPDATE public.tables SET status = ${status}, updated_at = now() WHERE id = ${tableId}`);
    }
  }

  async lockOrder(id: string) {
    const [order] = await this.rows<{ id: string; status: OrderStatus; table_id: string | null; order_type: OrderType | null }>(sql`
      SELECT id, status, table_id, order_type FROM public.orders WHERE id = ${id} FOR UPDATE`);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async lockTable(id: string) {
    const [table] = await this.rows<{ id: string; waiter_id: string | null }>(sql`
      SELECT id, waiter_id FROM public.tables WHERE id = ${id} FOR UPDATE`);
    if (!table) {
      throw new UnprocessableEntityException('Unknown table');
    }
    return table;
  }

  /** A foreign key would accept another restaurant's profile; RLS on this SELECT does not. */
  private async assertProfile(id: string): Promise<void> {
    const [profile] = await this.rows(sql`
      SELECT 1 FROM public.profiles WHERE id = ${id} AND active AND role = ANY(${sql.param(WAITER_ROLES)}::text[])`);
    if (!profile) {
      throw new UnprocessableEntityException('Unknown waiter');
    }
  }

  /** The promotions and the restaurant clock a send (or a preview) is evaluated with. */
  private async pricingContext(channel: PromotionChannel): Promise<PricingContext> {
    const now = await this.promotions.now();
    return { now, rules: await this.promotions.rules(), ctx: { now: now.local, channel } };
  }

  /**
   * Every line to insert, dish lines first, then the choices of each combo:
   * the unit list price (catalog price plus the prices of the line's options,
   * checked for the dish by private.resolve_line_modifiers, 422 with a
   * modifier_* code) and the promotion it is sent with (S3: the automatic
   * product promotion chosen now; a combo choice carries its combo). Every
   * dish must exist in the caller's restaurant and be active. A unitPrice the
   * client showed that differs from the list price answers 409 with the
   * current prices, before any write; with options the body also carries every
   * dish line's unit price. A combo that is unknown, not live now on the
   * channel or with a wrong choice answers 422 with the engine code.
   */
  private async priceLines(
    items: ItemInput[],
    combos: ComboLineInput[],
    pricing: PricingContext,
    options: { draftCombos?: boolean } = {},
  ): Promise<PricedLine[]> {
    const choices = combos.flatMap((combo, index) => {
      const rule = pricing.rules.find((r) => r.id === combo.comboPromotionId && r.kind === 'combo');
      if (!rule) {
        throw new UnprocessableEntityException({ message: 'Unknown combo', code: 'combo_unknown' });
      }
      const check = validateCombo(rule, combo.choices, pricing.ctx);
      if (!check.ok) {
        throw new UnprocessableEntityException({ message: 'Invalid combo', code: check.errors[0], codes: check.errors });
      }
      const comboId = options.draftCombos ? `draft-combo-${index}` : randomUUID();
      return combo.choices.map((choice) => ({ choice, rule, comboId }));
    });
    const all = [
      ...items.map((item) => ({ dishId: item.dishId, optionIds: (item.modifiers ?? []).map((m) => m.optionId) })),
      ...choices.map(({ choice }) => ({ dishId: choice.dishId, optionIds: (choice.modifiers ?? []).map((m) => m.optionId) })),
    ];
    const ids = [...new Set(all.map((line) => line.dishId))];
    const catalog = new Map((await this.dishes.list({})).map((dish) => [dish.id, dish]));
    const dishes = ids.map((id) => catalog.get(id));
    if (dishes.some((dish) => !dish)) {
      throw new UnprocessableEntityException('Unknown dish');
    }
    if (dishes.some((dish) => !dish!.active)) {
      throw new UnprocessableEntityException('Dish not active');
    }
    const modifiers = await resolveLineModifiers(this.uow, all);
    const unitPrices = all.map((line, index) => linePrice(catalog.get(line.dishId)!.price, modifiers[index]));
    if (items.some((item, index) => item.unitPrice !== undefined && item.unitPrice !== unitPrices[index])) {
      const withOptions = items.some((item) => (item.modifiers ?? []).length > 0);
      throw new ConflictException({
        message: 'Price changed',
        prices: ids.map((dishId) => ({ dishId, price: catalog.get(dishId)!.price })),
        ...(withOptions ? { lines: items.map((item, index) => ({ index, dishId: item.dishId, unitPrice: unitPrices[index] })) } : {}),
      });
    }
    const dishLines = items.map((item, index): PricedLine => {
      const dish = catalog.get(item.dishId)!;
      const engineItem = {
        id: `new-${index}`,
        dishId: dish.id,
        categoryId: dish.categoryId,
        subcategoryId: dish.subcategoryId,
        unitPrice: unitPrices[index],
        quantity: item.quantity,
        promotionId: null,
        addedAt: '',
        voided: false,
        comboId: null,
      };
      const tag = OrderDiscountsService.tag(engineItem, pricing.rules, pricing.ctx);
      return {
        dishId: dish.id,
        dish,
        quantity: item.quantity,
        price: unitPrices[index],
        comments: item.comments ?? null,
        optionIds: all[index].optionIds,
        promotionId: tag.promotionId,
        snapshot: tag.snapshot,
        comboId: null,
      };
    });
    const comboLines = choices.map(({ choice, rule, comboId }, i): PricedLine => {
      const index = items.length + i;
      return {
        dishId: choice.dishId,
        dish: catalog.get(choice.dishId)!,
        quantity: COMBO_QUANTITY,
        price: unitPrices[index],
        comments: choice.comments ?? null,
        optionIds: all[index].optionIds,
        promotionId: rule.id,
        snapshot: toSnapshot(rule),
        comboId,
      };
    });
    return [...dishLines, ...comboLines];
  }

  /** check_dishes_stock answers enabled: false (no shortages) when inventory control is off. */
  private async assertStock(items: readonly { dishId: string; quantity: number }[]): Promise<void> {
    const cart = items.map((item) => ({ dish_id: item.dishId, quantity: item.quantity }));
    const [result] = await this.rows<{ check: { ok: boolean; shortages: Record<string, unknown>[] } }>(sql`
      SELECT public.check_dishes_stock(${JSON.stringify(cart)}::jsonb) AS check`);
    if (!result.check.ok) {
      const shortages: StockShortage[] = result.check.shortages.map(toShortage);
      throw new ConflictException({ message: 'Insufficient stock', shortages });
    }
  }

  /**
   * One INSERT for every line; name from the catalog, list price, promotion
   * and snapshot from priceLines. added_at grows by a microsecond per line so
   * the items keep the cart order when read back. The ids are chosen here so
   * the option snapshot of each line is written next
   * (private.add_order_item_modifiers, same rules).
   */
  private async insertItems(orderId: string, items: PricedLine[]): Promise<void> {
    const lines = items.map((item, index) => ({
      id: randomUUID(),
      ord: index,
      dish_id: item.dishId,
      quantity: item.quantity,
      price: item.price,
      comments: item.comments,
      option_ids: item.optionIds,
      promotion_id: item.promotionId,
      promotion_snapshot: item.snapshot,
      combo_id: item.comboId,
    }));
    await this.uow.db.execute(sql`
      INSERT INTO public.order_items
        (id, order_id, dish_id, name, price, quantity, comments, status, added_at, promotion_id, promotion_snapshot, combo_id)
      SELECT x.id, ${orderId}::uuid, d.id, d.name, x.price, x.quantity, x.comments, 'kitchen',
             now() + x.ord * interval '1 microsecond', x.promotion_id, x.promotion_snapshot, x.combo_id
        FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
               AS x(id uuid, ord integer, dish_id uuid, quantity integer, price numeric, comments text,
                    promotion_id uuid, promotion_snapshot jsonb, combo_id uuid)
        JOIN public.dishes d ON d.id = x.dish_id
       ORDER BY x.ord`);
    const withOptions = lines.filter((line) => line.option_ids.length > 0).map(({ id, option_ids }) => ({ id, option_ids }));
    if (withOptions.length > 0) {
      await this.uow.db.execute(sql`
        SELECT private.add_order_item_modifiers(x.id, x.option_ids)
          FROM jsonb_to_recordset(${JSON.stringify(withOptions)}::jsonb) AS x(id uuid, option_ids uuid[])`);
    }
  }

  /** The automatic discounts and the bill (recompute_caller_order_bill), then the stock of the new lines (a no-op with inventory control off). */
  private async afterItems(orderId: string, now: RestaurantNow): Promise<void> {
    await this.discounts.recompute(orderId, now);
    await this.uow.db.execute(sql`SELECT public.consume_order_stock(${orderId}::uuid)`);
  }

  /** Orders with their items (one query, json aggregate), table number and waiter name. */
  private select(where: SQL, tail: SQL = sql``, items: SQL = LIVE_ITEMS): Promise<OrderRow[]> {
    return this.rows<OrderRow>(sql`
      SELECT to_jsonb(o) AS "order",
             t.number AS table_number,
             p.full_name AS waiter_name,
             coalesce((SELECT jsonb_agg(${ITEM_JSON} ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${items}), '[]'::jsonb) AS items,
             ${ORDER_DISCOUNTS} AS discounts
        FROM public.orders o
        LEFT JOIN public.tables t ON t.id = o.table_id
        LEFT JOIN public.profiles p ON p.id = o.waiter_id
       ${where}
       ${tail}`);
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}

/** The 23514 `table <id> is inactive` of the 0015 trigger, through Drizzle's `cause` chain; other 23514s are not it. */
function isInactiveTableError(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (code === '23514' && typeof message === 'string' && /^table \S+ is inactive$/.test(message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
