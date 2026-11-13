import { Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DbClient } from '../db/db-client';
import { restaurantNow } from '../promotions/promotion-catalog.service';
import { cartaDbError } from './carta-errors';
import type { DeliverySubmitInput, DeliverySubmitted, GuestDeliveryStatus, GuestPricing, GuestPricingInput } from './carta-delivery.dto';
import { channelTaxPercentage, guestPricing } from './carta-pricing';
import { CARTA_MESSAGES, cartaSlugSchema } from './carta.dto';
import type { GuestMenuData } from './guest-menu-source';

const notFound = () => new NotFoundException(CARTA_MESSAGES.notFound);

/**
 * The guest side of the carta delivery (S15): no login and no unit of work,
 * like CartaTableService. The restaurant comes only from the slug and the
 * request only from its tracking token, inside the 0038 guest SECURITY
 * DEFINER functions run on the pool without app.user_id; the staff identity
 * is never read. The pricing preview prices the guest rows of 0036 with the
 * staff engine (carta-pricing.ts) and touches no order.
 */
@Injectable()
export class CartaDeliveryService {
  constructor(
    private readonly client: DbClient,
    private readonly clock: Clock,
  ) {}

  async submit(slug: string, input: DeliverySubmitInput): Promise<DeliverySubmitted> {
    const customer = { name: input.customer.name, phone: input.customer.phone, address: input.customer.address, neighborhood: input.customer.neighborhood ?? null };
    const items = input.items.map((item) => ({ dishId: item.dishId, quantity: item.quantity, optionIds: item.optionIds ?? [], note: item.note ?? null }));
    const payment = { method: input.payment.method, cashFrom: input.payment.cashFrom ?? null };
    return this.found(
      await this.call<DeliverySubmitted>('private.guest_submit_delivery($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)', [
        slug,
        JSON.stringify(customer),
        JSON.stringify(items),
        JSON.stringify(payment),
        input.notes ?? null,
      ]),
    );
  }

  async status(slug: string, trackingToken: string): Promise<GuestDeliveryStatus> {
    return this.found(await this.call<GuestDeliveryStatus>('private.guest_delivery_status($1, $2)', [slug, trackingToken]));
  }

  /** One statement, so the fee and the menu read the same snapshot. */
  async pricing(slug: string, input: GuestPricingInput): Promise<GuestPricing> {
    if (!cartaSlugSchema.safeParse(slug).success) {
      throw notFound();
    }
    const { rows } = await this.client.pool.query<{ carta: { restaurant: { timezone: string | null }; deliveryFee: number | string; taxPercentage: number | string; deliveryTaxPercentage: number | string | null } | null; menu: GuestMenuData | null }>(
      'SELECT private.guest_carta($1) AS carta, private.guest_menu_data($1) AS menu',
      [slug],
    );
    const { carta, menu } = rows[0] ?? {};
    if (!carta || !menu) {
      throw notFound();
    }
    const now = restaurantNow(this.clock.now(), carta.restaurant.timezone ?? 'America/Bogota');
    return guestPricing(menu, now, input.channel, input.items, Number(carta.deliveryFee), channelTaxPercentage(input.channel, carta));
  }

  /** A malformed slug is the carta's one 404 before any query. */
  private async call<T>(fn: string, values: unknown[]): Promise<T | null> {
    if (!cartaSlugSchema.safeParse(values[0]).success) {
      throw notFound();
    }
    try {
      const { rows } = await this.client.pool.query<{ result: T | null }>(`SELECT ${fn} AS result`, values);
      return rows[0]?.result ?? null;
    } catch (error) {
      return cartaDbError(error);
    }
  }

  private found<T>(value: T | null): T {
    if (value === null) {
      throw notFound();
    }
    return value;
  }
}
