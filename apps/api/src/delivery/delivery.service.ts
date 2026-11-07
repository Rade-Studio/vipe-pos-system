import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import type { CallerProfile } from '../auth/auth-context';
import { Clock } from '../common/clock';
import { VoidsService } from '../audit/voids.service';
import { UnitOfWork } from '../db/unit-of-work';
import { definedColumns, insertColumns, one, rows, rpc, setList } from '../inventory/inventory-sql';
import { SalesService } from '../inventory/sales.service';
import { PrintService } from '../print/print.service';
import type { cancelOrderSchema } from '../orders/orders.dto';
import type {
  ClosedTodaySummary,
  Courier,
  createCourierSchema,
  CreateDeliveryOrderInput,
  CreateDeliveryOrderResult,
  CustomerWithAddresses,
  DeliveryOrder,
  DeliveryOrderWithBill,
  setDeliveryStatusSchema,
  updateCourierSchema,
} from './delivery.dto';
import {
  toClosedTodaySummary,
  toCourier,
  toCustomer,
  toCustomerAddress,
  toCustomerHistory,
  toDeliveryOrder,
  toDeliveryWithBill,
} from './delivery.mappers';

type Json = Record<string, unknown>;
/** Waiter on the kitchen ticket when the operator has no name; the printer drops commands without one. */
const FALLBACK_WAITER = 'Domicilios';
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
/** The courier fields a delivery operator may not change (T19: only isActive). */
const ADMIN_ONLY_COURIER_FIELDS = ['name', 'phone'] as const;

/**
 * `to_jsonb(order_deliveries)` plus the prepaid method's name and the order's
 * number (T25), for a query whose FROM has `public.order_deliveries od` and
 * DELIVERY_JOIN.
 */
const DELIVERY_ROW = sql`to_jsonb(od) || jsonb_build_object('prepaid_method_name', pm.name, 'order_number', onum.order_number)`;
const DELIVERY_JOIN = sql`LEFT JOIN public.payment_methods pm ON pm.restaurant_id = od.restaurant_id AND pm.id = od.prepaid_method_id
  JOIN public.orders onum ON onum.id = od.order_id`;

/** Local midnight of `now` in the restaurant's timezone, for a query whose FROM has `public.restaurants r`. */
const restaurantMidnight = (now: string) => sql`(date_trunc('day', ${now}::timestamptz AT TIME ZONE r.timezone) AT TIME ZONE r.timezone)`;

/** Only the keys the caller sent, renamed for the RPC (delivery-service.ts customerWire/addressWire/itemsWire). */
function wire(input: Record<string, unknown>, names: Record<string, string>): Json {
  return Object.fromEntries(
    Object.entries(names)
      .filter(([key]) => input[key] !== undefined)
      .map(([key, name]) => [name, input[key]]),
  );
}

/** One display line "line, neighborhood (reference)" (lib/delivery/address.ts formatAddress). */
function formatAddress(delivery: DeliveryOrder): string {
  let line = delivery.addressLine.trim();
  const neighborhood = (delivery.neighborhood ?? '').trim();
  const reference = (delivery.addressReference ?? '').trim();
  if (neighborhood) line += `, ${neighborhood}`;
  if (reference) line += ` (${reference})`;
  return line;
}

/** DeliveryPrintInfo from the order_deliveries snapshot (lib/delivery/print.ts buildDeliveryPrintInfo). */
function printInfo(delivery: DeliveryOrder): Json {
  const info: Json = {
    customerName: delivery.customerName,
    phone: delivery.customerPhone,
    address: formatAddress(delivery),
    paymentMode: delivery.paymentMode,
    deliveryFee: delivery.deliveryFee,
  };
  const notes = delivery.notes?.trim();
  if (notes) info.notes = notes;
  if (delivery.paymentMode === 'cash_on_delivery' && delivery.cashChangeFor !== null) {
    info.cashChangeFor = delivery.cashChangeFor;
  }
  return info;
}

/**
 * Delivery module (T11): customer lookup, courier registry, and the two
 * plpgsql RPCs. Every method runs in the request transaction (UnitOfWork);
 * create_delivery_order and set_delivery_status enforce the role matrix and
 * the state machine, and their errors reach the client through the shared
 * error filter with the SQLSTATE as `code`.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sales: SalesService,
    private readonly print: PrintService,
    private readonly clock: Clock,
    private readonly voids: VoidsService,
  ) {}

  /** `phone` is already normalised; RLS limits it to the caller's restaurant. */
  async findCustomer(phone: string): Promise<CustomerWithAddresses> {
    const [customer] = await rows<{ row: Json }>(this.uow, sql`
      SELECT to_jsonb(c) AS row FROM public.customers c WHERE c.phone = ${phone}`);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    const addresses = await rows<{ row: Json }>(this.uow, sql`
      SELECT to_jsonb(a) AS row FROM public.customer_addresses a
       WHERE a.customer_id = ${customer.row.id as string}
       ORDER BY a.is_default DESC, a.created_at, a.id`);
    return {
      customer: toCustomer(customer.row),
      addresses: addresses.map((a) => toCustomerAddress(a.row)),
      history: await this.customerHistory(customer.row.id as string),
    };
  }

  /** The customer's deliveries except cancelled ones: count, latest date and its address snapshot. */
  private async customerHistory(customerId: string) {
    const [row] = await rows<{ row: Json }>(this.uow, sql`
      SELECT jsonb_build_object(
               'orders_count', count(*),
               'last_order_at', max(od.created_at),
               'last_address', (
                 SELECT jsonb_build_object('address_line', l.address_line, 'neighborhood', l.neighborhood,
                                           'address_reference', l.address_reference)
                   FROM public.order_deliveries l
                  WHERE l.customer_id = ${customerId} AND l.delivery_status <> 'cancelled'
                  ORDER BY l.created_at DESC, l.order_id DESC
                  LIMIT 1)) AS row
        FROM public.order_deliveries od
       WHERE od.customer_id = ${customerId} AND od.delivery_status <> 'cancelled'`);
    return toCustomerHistory(row.row);
  }

  /** One delivery as the DTO reads it (RLS: the caller's restaurant). */
  private async readDelivery(orderId: string): Promise<DeliveryOrder> {
    return toDeliveryOrder(await one<Json>(this.uow, sql`
      SELECT ${DELIVERY_ROW} AS row FROM public.order_deliveries od ${DELIVERY_JOIN}
       WHERE od.order_id = ${orderId}`, 'row', 'Delivery not found'));
  }

  async listCouriers(activeOnly: boolean): Promise<Courier[]> {
    const where = activeOnly ? sql`WHERE co.is_active` : sql``;
    const result = await rows<{ row: Json }>(this.uow, sql`
      SELECT to_jsonb(co) AS row FROM public.couriers co ${where} ORDER BY co.name, co.id`);
    return result.map((r) => toCourier(r.row));
  }

  async createCourier(input: z.infer<typeof createCourierSchema>): Promise<Courier> {
    const pairs = definedColumns({ name: input.name, phone: input.phone ?? null });
    return toCourier(await one(this.uow, sql`
      INSERT INTO public.couriers ${insertColumns(pairs)} RETURNING to_jsonb(couriers) AS row`, 'row', 'Courier not found'));
  }

  /**
   * Admins patch every field; a delivery operator only isActive (403 before
   * any write; couriers_operator_guard refuses it in the database too).
   */
  async updateCourier(id: string, patch: z.infer<typeof updateCourierSchema>, caller: CallerProfile): Promise<Courier> {
    if (caller.role === 'delivery_operator' && ADMIN_ONLY_COURIER_FIELDS.some((field) => patch[field] !== undefined)) {
      throw new ForbiddenException('A delivery operator may only change isActive');
    }
    const pairs = definedColumns({ name: patch.name, phone: patch.phone, is_active: patch.isActive });
    return toCourier(await one(this.uow, sql`
      UPDATE public.couriers SET ${setList(pairs)} WHERE id = ${id} RETURNING to_jsonb(couriers) AS row`, 'row', 'Courier not found'));
  }

  /**
   * One transaction: create_delivery_order (arguments mapped exactly as
   * delivery-service.ts did), consume_order_stock (a shortage is reported in
   * `consumption`, the order stands, as with the web's fire-and-forget call),
   * and the kitchen command job, which reaches the printers after the commit.
   * Any failure, the print enqueue included, rolls everything back.
   */
  async createOrder(input: CreateDeliveryOrderInput, caller: CallerProfile): Promise<CreateDeliveryOrderResult> {
    const customer = wire(input.customer, { id: 'id', phone: 'phone', name: 'name' });
    const address = wire(input.address, {
      id: 'id',
      addressLine: 'address_line',
      neighborhood: 'neighborhood',
      reference: 'reference',
      label: 'label',
      save: 'save',
    });
    const items = input.items.map((item) => wire(item, { dishId: 'dish_id', quantity: 'quantity', comments: 'comments' }));
    const cashChangeFor = input.paymentMode === 'cash_on_delivery' ? (input.cashChangeFor ?? null) : null;
    const created = await rpc(this.uow, sql`
      SELECT public.create_delivery_order(${json(customer)}, ${json(address)}, ${json(items)},
               ${input.deliveryFee}::bigint, ${input.paymentMode}::text, ${cashChangeFor}::bigint, ${input.notes ?? null}::text,
               ${input.prepaidMethodId ?? null}::uuid) AS result`);
    const orderId = String(created.order_id);
    const delivery = await this.readDelivery(orderId);

    const consumption = await this.sales.consume(orderId);

    // Ticket lines in the order the operator entered them, named from the menu like the order items.
    const names = new Map(
      (
        await rows<{ dish_id: string; name: string }>(this.uow, sql`
          SELECT DISTINCT ON (oi.dish_id) oi.dish_id, oi.name FROM public.order_items oi WHERE oi.order_id = ${orderId}`)
      ).map((row) => [row.dish_id, row.name]),
    );
    const lines = input.items.map((item) => {
      const line: Json = { name: names.get(item.dishId) ?? '', quantity: item.quantity };
      const comments = item.comments?.trim();
      if (comments) line.comments = comments;
      return line;
    });
    // F6: the dish of each line routes it to its station (same rule as table
    // orders); a restaurant without printers (S2) queues nothing.
    const printJob = (await this.print.printingEnabled())
      ? await this.print.printCommand(
          { items: lines, waiter: caller.name.trim() || FALLBACK_WAITER, table: null, delivery: printInfo(delivery) },
          input.items.map((item) => item.dishId),
        )
      : null;

    return {
      orderId,
      customerId: String(created.customer_id),
      addressId: created.address_id === null ? null : String(created.address_id),
      delivery,
      consumption,
      printJob,
    };
  }

  async setStatus(orderId: string, input: z.infer<typeof setDeliveryStatusSchema>): Promise<DeliveryOrder> {
    await rpc(this.uow, sql`
      SELECT public.set_delivery_status(${orderId}::uuid, ${input.action}::text,
               ${input.courierId ?? null}::uuid, ${input.reason ?? null}::text,
               ${input.courierEta ?? null}::timestamptz, ${input.courierLocation ?? null}::text) AS result`);
    return this.readDelivery(orderId);
  }

  /**
   * POST /delivery/orders/:id/cancel: the audited public.cancel_order of F1
   * (0019), the only way a delivery is cancelled. A reason is required; the
   * supervisor authorization (cancel_order, bound to this order) only when
   * the delivery has a live payment, which is voided in the same transaction.
   */
  async cancel(orderId: string, input: z.infer<typeof cancelOrderSchema>): Promise<DeliveryOrder> {
    await this.voids.run(
      'cancel_order',
      input.authorizationId,
      sql`SELECT public.cancel_order(${orderId}::uuid, ${input.reason}, ${input.reasonText ?? null}, ${input.authorizationId ?? null}::uuid) AS result`,
    );
    return this.readDelivery(orderId);
  }

  /** return_courier owns the role matrix and the state rule (delivered or failed, once). */
  async returnCourier(orderId: string): Promise<DeliveryOrder> {
    await rpc(this.uow, sql`SELECT public.return_courier(${orderId}::uuid) AS result`);
    return this.readDelivery(orderId);
  }

  /**
   * Every delivery not delivered or cancelled, plus the delivered and
   * cancelled ones updated since local midnight in the restaurant's timezone
   * (the web used the browser's midnight); "now" comes from the injected
   * Clock. Newest update first.
   */
  async listActive(): Promise<DeliveryOrderWithBill[]> {
    const now = this.clock.now().toISOString();
    const result = await rows<{ delivery: Json; bill: Json }>(this.uow, sql`
      SELECT ${DELIVERY_ROW} AS delivery, jsonb_build_object('subtotal', o.subtotal, 'tax', o.tax, 'status', o.status) AS bill
        FROM public.order_deliveries od
        ${DELIVERY_JOIN}
        JOIN public.orders o ON o.id = od.order_id
        JOIN public.restaurants r ON r.id = od.restaurant_id
       WHERE od.delivery_status NOT IN ('delivered', 'cancelled')
          OR od.updated_at >= ${restaurantMidnight(now)}
       ORDER BY od.updated_at DESC, od.order_id`);
    return result.map(toDeliveryWithBill);
  }

  /**
   * "Cerrados hoy" of the board: delivered and cancelled deliveries updated
   * since local midnight (the listActive rule), failed ones that failed since
   * then, and the average dispatched_at → delivered_at of the delivered ones
   * in rounded minutes.
   */
  async closedToday(): Promise<ClosedTodaySummary> {
    const now = this.clock.now().toISOString();
    const [row] = await rows<{ row: Json }>(this.uow, sql`
      SELECT jsonb_build_object(
               'delivered', count(*) FILTER (WHERE od.delivery_status = 'delivered' AND od.updated_at >= m.midnight),
               'cancelled', count(*) FILTER (WHERE od.delivery_status = 'cancelled' AND od.updated_at >= m.midnight),
               'failed', count(*) FILTER (WHERE od.delivery_status = 'failed' AND od.failed_at >= m.midnight),
               'average_minutes', round(avg(extract(epoch FROM od.delivered_at - od.dispatched_at) / 60)
                 FILTER (WHERE od.delivery_status = 'delivered' AND od.updated_at >= m.midnight AND od.dispatched_at IS NOT NULL))) AS row
        FROM public.restaurants r -- RLS: only the caller's restaurant
        CROSS JOIN LATERAL (SELECT ${restaurantMidnight(now)} AS midnight) m
        LEFT JOIN public.order_deliveries od ON od.restaurant_id = r.id`);
    return toClosedTodaySummary(row?.row ?? { delivered: 0, cancelled: 0, failed: 0, average_minutes: null });
  }
}
