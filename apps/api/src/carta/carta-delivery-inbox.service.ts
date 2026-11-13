import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { CallerProfile } from '../auth/auth-context';
import { parseInput } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import { createDeliveryOrderSchema } from '../delivery/delivery.dto';
import { DeliveryService } from '../delivery/delivery.service';
import { OrdersService } from '../orders/orders.service';
import type { DeliveryInboxRequest, DeliveryPaymentMethod, DeliveryRequestConfirmed } from './carta-delivery.dto';
import { cartaDbError } from './carta-errors';

/** private.confirm_delivery_request (0038). */
interface ConfirmedRequest {
  requestId: string;
  customer: { name: string; phone: string };
  address: string;
  neighborhood: string | null;
  notes: string | null;
  paymentMethod: DeliveryPaymentMethod;
  cashFrom: number | null;
  deliveryFee: number | string;
  items: { dishId: string; quantity: number; optionIds: string[]; note: string | null }[];
}

/** The delivery console has cash on delivery and prepaid only: card and transfer are paid on delivery too, so the note tells the courier. */
const PAYMENT_NOTES: Record<DeliveryPaymentMethod, string | null> = {
  cash: null,
  card: 'Paga con datáfono.',
  transfer: 'Paga por transferencia.',
};

/**
 * The operators' inbox of guest delivery requests (S15), inside the request
 * unit of work: RLS scopes the reads to the caller's restaurant and the 0038
 * staff functions check the role and tenant again. The restaurant never
 * comes from the client.
 */
@Injectable()
export class CartaDeliveryInboxService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly delivery: DeliveryService,
    private readonly orders: OrdersService,
  ) {}

  /** Pending requests, newest first, each priced now on delivery by the staff pricing preview. */
  async list(): Promise<DeliveryInboxRequest[]> {
    const requests = await this.rows<Omit<DeliveryInboxRequest, 'previewSubtotal' | 'previewTotal'>>(sql`
      SELECT jsonb_build_object(
               'id', d.id, 'customerName', d.customer_name,
               -- The name already registered for that phone (null when new): a carta order never renames it.
               'registeredName', (SELECT cu.name FROM public.customers cu WHERE cu.restaurant_id = d.restaurant_id AND cu.phone = d.phone),
               'phone', d.phone, 'address', d.address, 'neighborhood', d.neighborhood,
               'notes', d.notes, 'paymentMethod', d.payment_method, 'cashFrom', d.cash_from, 'deliveryFee', d.delivery_fee,
               'createdAt', d.created_at,
               'lines', (SELECT jsonb_agg(jsonb_build_object(
                                  'dishId', l.v ->> 'dishId', 'name', di.name, 'quantity', (l.v ->> 'quantity')::integer, 'note', l.v -> 'note',
                                  'options', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', mo.name) ORDER BY x.n), '[]'::jsonb)
                                                FROM jsonb_array_elements_text(l.v -> 'optionIds') WITH ORDINALITY x(id, n)
                                                LEFT JOIN public.modifier_options mo ON mo.id = x.id::uuid))
                                ORDER BY l.n)
                           FROM jsonb_array_elements(d.items) WITH ORDINALITY l(v, n)
                           LEFT JOIN public.dishes di ON di.id = (l.v ->> 'dishId')::uuid)) AS row
        FROM public.carta_delivery_requests d
       WHERE d.status = 'pending'
       ORDER BY d.created_at DESC, d.id DESC`);
    const priced: DeliveryInboxRequest[] = [];
    for (const request of requests) {
      const subtotal = await this.previewSubtotal(request.lines);
      priced.push({ ...request, previewSubtotal: subtotal, previewTotal: subtotal === null ? null : subtotal + request.deliveryFee });
    }
    return priced;
  }

  /**
   * One transaction: confirm (locks the request), create the delivery order
   * through the console's POST /delivery/orders path (customer upsert by
   * phone, address, fee, cash change, promotions, stock, kitchen ticket),
   * then link it so the guest follows its status. Any failure rolls all back.
   */
  async confirm(id: string, caller: CallerProfile): Promise<DeliveryRequestConfirmed> {
    const [request] = await this.call<ConfirmedRequest>(sql`SELECT private.confirm_delivery_request(${id}::uuid) AS row`);
    // The console upserts the customer by phone and overwrites the name; a guest must not rename an
    // existing customer, so their registered name is kept and the name typed in the carta goes to the notes.
    const [registered] = await this.rows<{ name: string }>(
      sql`SELECT jsonb_build_object('name', cu.name) AS row FROM public.customers cu WHERE cu.phone = ${request.customer.phone}`,
    );
    const renamed = registered && registered.name !== request.customer.name ? `Nombre en la carta: ${request.customer.name}.` : null;
    const notes = [PAYMENT_NOTES[request.paymentMethod], renamed, request.notes].filter(Boolean).join(' ');
    const input = parseInput(createDeliveryOrderSchema, {
      customer: { phone: request.customer.phone, name: registered?.name ?? request.customer.name },
      address: { addressLine: request.address, neighborhood: request.neighborhood },
      items: request.items.map((item) => ({
        dishId: item.dishId,
        quantity: item.quantity,
        comments: item.note,
        modifiers: item.optionIds.map((optionId) => ({ optionId })),
      })),
      deliveryFee: Number(request.deliveryFee),
      paymentMode: 'cash_on_delivery',
      cashChangeFor: request.paymentMethod === 'cash' ? request.cashFrom : null,
      notes: notes || null,
    });
    const order = await this.delivery.createOrder(input, caller);
    await this.call(sql`SELECT private.link_delivery_request(${id}::uuid, ${order.orderId}::uuid) AS row`);
    return { requestId: request.requestId, status: 'confirmed', order };
  }

  async reject(id: string, reason: string | null): Promise<void> {
    await this.call(sql`SELECT private.reject_delivery_request(${id}::uuid, ${reason}) AS row`);
  }

  /**
   * The staff preview's netSubtotal on delivery; null when a line no longer
   * prices (dish paused, option rule changed). A savepoint keeps a refused
   * line from aborting the request transaction.
   */
  private async previewSubtotal(lines: DeliveryInboxRequest['lines']): Promise<number | null> {
    await this.uow.db.execute(sql`SAVEPOINT carta_delivery_preview`);
    try {
      const preview = await this.orders.pricingPreview({
        channel: 'delivery',
        lines: lines.map((line) => ({ dishId: line.dishId, quantity: line.quantity, modifiers: line.options.map((option) => ({ optionId: option.id })) })),
      });
      await this.uow.db.execute(sql`RELEASE SAVEPOINT carta_delivery_preview`);
      return preview.netSubtotal;
    } catch {
      await this.uow.db.execute(sql`ROLLBACK TO SAVEPOINT carta_delivery_preview`);
      return null;
    }
  }

  private async call<T>(query: SQL): Promise<T[]> {
    try {
      return await this.rows<T>(query);
    } catch (error) {
      return cartaDbError(error);
    }
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return (result.rows as { row: T }[]).map((r) => r.row);
  }
}
