import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { VoidsService } from '../audit/voids.service';
import { DishesService } from '../catalog/dishes.service';
import { UnitOfWork } from '../db/unit-of-work';
import { paymentJson } from '../payments/payments.mappers';
import { ConfigService } from '../settings/config.service';
import {
  type addOrderItemsSchema,
  type cancelOrderSchema,
  type CancelledOrder,
  type CompletedOrder,
  type createOrderSchema,
  DELETE_DEFAULT_REASON,
  type Order,
  ORDER_LIST_LIMIT,
  type OrderStatus,
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

type ItemInput = z.infer<typeof createOrderSchema>['items'][number];
type OrderDetails = z.infer<typeof updateOrderDetailsSchema>;
type CancelInput = z.infer<typeof cancelOrderSchema>;
/** Live lines: a fully voided line (quantity 0, status cancelled) is history, not part of the order. */
const LIVE_ITEMS = sql`oi.status IS DISTINCT FROM 'cancelled'`;
/** Order statuses that keep a table busy. */
const OPEN_STATUSES = ['active', 'kitchen', 'delivered'];
/** Roles a profile must have to own an order or a table. */
const WAITER_ROLES = ['waiter', 'admin'];

export interface OrderListFilter {
  statuses?: OrderStatus[];
  withTable?: boolean;
  withWaiter?: boolean;
  stationId?: string;
}

/**
 * Orders of the caller's restaurant. Every method runs inside the request
 * transaction (UnitOfWork), so a write is all or nothing; RLS scopes every
 * statement. Money is never computed here: the bill comes from
 * private.recompute_order_bill (through private.recompute_caller_order_bill),
 * the same function pay_order trusts.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly dishes: DishesService,
    private readonly voids: VoidsService,
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
             coalesce((SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${LIVE_ITEMS}), '[]'::jsonb) AS items,
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
    const prices = await this.priceItems(input.items);
    if (!input.force) {
      await this.assertStock(input.items);
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
    await this.insertItems(order.id, input.items, prices);
    await this.afterItems(order.id);
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
    const prices = await this.priceItems(input.items);
    if (!input.force) {
      await this.assertStock(input.items);
    }
    await this.insertItems(id, input.items, prices);
    await this.afterItems(id);
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
    const items = input.items.map((item) => ({ order_item_id: item.itemId, quantity: item.quantity }));
    await this.voids.run(
      'void_item',
      input.authorizationId,
      sql`SELECT public.void_order_items(${id}::uuid, ${JSON.stringify(items)}::jsonb, ${input.reason},
                                        ${input.reasonText ?? null}, ${input.authorizationId ?? null}::uuid) AS result`,
    );
    return this.get(id);
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
             coalesce((SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${LIVE_ITEMS}), '[]'::jsonb) AS items,
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

  private async lockOrder(id: string) {
    const [order] = await this.rows<{ id: string; status: OrderStatus; table_id: string | null }>(sql`
      SELECT id, status, table_id FROM public.orders WHERE id = ${id} FOR UPDATE`);
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

  /**
   * The catalog price of every line, promotions applied with the server clock
   * (the same DishesService the menu reads). Every dish must exist in the
   * caller's restaurant and be active. A unitPrice the client showed that
   * differs from it answers 409 with the current prices, before any write.
   */
  private async priceItems(items: ItemInput[]): Promise<Map<string, number>> {
    const ids = [...new Set(items.map((item) => item.dishId))];
    const catalog = new Map((await this.dishes.list({ pricing: 'promotions' })).map((dish) => [dish.id, dish]));
    const dishes = ids.map((id) => catalog.get(id));
    if (dishes.some((dish) => !dish)) {
      throw new UnprocessableEntityException('Unknown dish');
    }
    if (dishes.some((dish) => !dish!.active)) {
      throw new UnprocessableEntityException('Dish not active');
    }
    const prices = new Map(dishes.map((dish) => [dish!.id, dish!.price]));
    if (items.some((item) => item.unitPrice !== undefined && item.unitPrice !== prices.get(item.dishId))) {
      throw new ConflictException({
        message: 'Price changed',
        prices: ids.map((dishId) => ({ dishId, price: prices.get(dishId) })),
      });
    }
    return prices;
  }

  /** check_dishes_stock answers enabled: false (no shortages) when inventory control is off. */
  private async assertStock(items: ItemInput[]): Promise<void> {
    const cart = items.map((item) => ({ dish_id: item.dishId, quantity: item.quantity }));
    const [result] = await this.rows<{ check: { ok: boolean; shortages: Record<string, unknown>[] } }>(sql`
      SELECT public.check_dishes_stock(${JSON.stringify(cart)}::jsonb) AS check`);
    if (!result.check.ok) {
      const shortages: StockShortage[] = result.check.shortages.map(toShortage);
      throw new ConflictException({ message: 'Insufficient stock', shortages });
    }
  }

  /**
   * One INSERT for every line; name and price come from the catalog
   * (priceItems). added_at grows by a microsecond per line so the items keep
   * the cart order when read back.
   */
  private async insertItems(orderId: string, items: ItemInput[], prices: Map<string, number>): Promise<void> {
    const lines = items.map((item, index) => ({
      ord: index,
      dish_id: item.dishId,
      quantity: item.quantity,
      price: prices.get(item.dishId),
      comments: item.comments ?? null,
    }));
    await this.uow.db.execute(sql`
      INSERT INTO public.order_items (order_id, dish_id, name, price, quantity, comments, status, added_at)
      SELECT ${orderId}::uuid, d.id, d.name, x.price, x.quantity, x.comments, 'kitchen',
             now() + x.ord * interval '1 microsecond'
        FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
               AS x(ord integer, dish_id uuid, quantity integer, price numeric, comments text)
        JOIN public.dishes d ON d.id = x.dish_id
       ORDER BY x.ord`);
  }

  /** The bill from order_items, then the stock of the new lines (a no-op with inventory control off). */
  private async afterItems(orderId: string): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.recompute_caller_order_bill(${orderId}::uuid)`);
    await this.uow.db.execute(sql`SELECT public.consume_order_stock(${orderId}::uuid)`);
  }

  /** Orders with their items (one query, json aggregate), table number and waiter name. */
  private select(where: SQL, tail: SQL = sql``, items: SQL = LIVE_ITEMS): Promise<OrderRow[]> {
    return this.rows<OrderRow>(sql`
      SELECT to_jsonb(o) AS "order",
             t.number AS table_number,
             p.full_name AS waiter_name,
             coalesce((SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.added_at, oi.created_at, oi.id)
                         FROM public.order_items oi WHERE oi.order_id = o.id AND ${items}), '[]'::jsonb) AS items
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
