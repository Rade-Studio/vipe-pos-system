import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import type { CallerProfile } from '../auth/auth-context';
import { Clock } from '../common/clock';
import { UnitOfWork } from '../db/unit-of-work';
import { definedColumns, insertColumns, one, rows, rpc, setList } from '../inventory/inventory-sql';
import { SalesService } from '../inventory/sales.service';
import { PrintService } from '../print/print.service';
import type {
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
import { toCourier, toCustomer, toCustomerAddress, toDeliveryOrder, toDeliveryWithBill } from './delivery.mappers';

type Json = Record<string, unknown>;
/** Waiter on the kitchen ticket when the operator has no name; the printer drops commands without one. */
const FALLBACK_WAITER = 'Domicilios';
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

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
    return { customer: toCustomer(customer.row), addresses: addresses.map((a) => toCustomerAddress(a.row)) };
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

  async updateCourier(id: string, patch: z.infer<typeof updateCourierSchema>): Promise<Courier> {
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
               ${input.deliveryFee}::bigint, ${input.paymentMode}::text, ${cashChangeFor}::bigint, ${input.notes ?? null}::text) AS result`);
    const orderId = String(created.order_id);
    const delivery = toDeliveryOrder(created.delivery as Json);

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
    const printJob = await this.print.printCommand({
      items: lines,
      waiter: caller.name.trim() || FALLBACK_WAITER,
      table: null,
      delivery: printInfo(delivery),
    });

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
    return toDeliveryOrder(await rpc(this.uow, sql`
      SELECT public.set_delivery_status(${orderId}::uuid, ${input.action}::text,
               ${input.courierId ?? null}::uuid, ${input.reason ?? null}::text) AS result`));
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
      SELECT to_jsonb(od) AS delivery, jsonb_build_object('subtotal', o.subtotal, 'tax', o.tax, 'status', o.status) AS bill
        FROM public.order_deliveries od
        JOIN public.orders o ON o.id = od.order_id
        JOIN public.restaurants r ON r.id = od.restaurant_id
       WHERE od.delivery_status NOT IN ('delivered', 'cancelled')
          OR od.updated_at >= (date_trunc('day', ${now}::timestamptz AT TIME ZONE r.timezone) AT TIME ZONE r.timezone)
       ORDER BY od.updated_at DESC, od.order_id`);
    return result.map(toDeliveryWithBill);
  }
}
