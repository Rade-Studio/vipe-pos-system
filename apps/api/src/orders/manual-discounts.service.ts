import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { VOID_ERRORS } from '../audit/voids';
import { SupervisorAuthorizationsService } from '../auth/supervisor-authorizations.service';
import { UnitOfWork } from '../db/unit-of-work';
import { amountOff, isLiveFor, matchesTargets, unitSaving } from '../promotions/engine';
import { OrderDiscountsService } from '../promotions/order-discounts.service';
import { PromotionCatalog, type PromotionChannel, type Rule } from '../promotions/promotion-catalog.service';
import { type AddOrderDiscountInput, FREE_DISCOUNT_LABEL, type Order } from './orders.dto';
import { OrdersService } from './orders.service';

/** A manual discount has its own supervisor action (POST /auth/authorize), bound to the order; a void authorization backs none. */
const AUTHORIZATION_ACTION = 'apply_discount';
/** The 42501 raises of private.discount_authorizer (0025). */
const AUTHORIZER_RAISED = /^apply_discount: (authorization_required|authorization_invalid|self_authorization_not_allowed)$/;

/** The machine code and Spanish message of every refusal of a manual discount. */
export const MANUAL_DISCOUNT_ERRORS = {
  order_item_not_found: 'El producto no está en la orden o ya fue anulado',
  promotion_not_found: 'La promoción no existe',
  promotion_not_manual: 'Esta promoción se aplica sola; no se puede agregar a mano',
  promotion_kind_unsupported: 'Solo los descuentos por producto o por cuenta se aplican a mano',
  promotion_not_available: 'La promoción no está vigente ahora para este canal',
  promotion_not_applicable: 'La promoción no aplica a este producto',
  promotion_max_uses: 'Esta promoción ya se usó el máximo de veces en la cuenta',
  promotion_min_subtotal: 'La cuenta no llega al mínimo de esta promoción',
  discount_item_required: 'Elige el producto al que se aplica la promoción',
  discount_item_not_allowed: 'Esta promoción se aplica a la cuenta, no a un producto',
  discount_nothing_left: 'No queda valor por descontar',
  discount_not_manual: 'Los descuentos automáticos no se pueden quitar a mano',
} as const;
type ManualDiscountError = keyof typeof MANUAL_DISCOUNT_ERRORS;

const refuse = (code: ManualDiscountError) => new UnprocessableEntityException({ message: MANUAL_DISCOUNT_ERRORS[code], code });
const forbid = (code: 'authorization_required' | 'authorization_invalid' | 'self_authorization_not_allowed') =>
  new ForbiddenException({ message: VOID_ERRORS[code].message, code });
const closed = () => new ConflictException({ message: VOID_ERRORS.order_closed.message, code: 'order_closed' });

/**
 * Manual discounts (S7): a manual or manual_pin promotion or a free discount,
 * on a line or on the order, with a reason. manual_pin and free discounts need
 * an apply_discount supervisor authorization, checked by
 * private.discount_authorizer with the private.void_authorizer rules (this
 * order, requested by the caller, an active admin or cashier, the caller only
 * with allow_self_authorization). The amount is the server's; the
 * automatic discounts and the bill are recomputed in the same transaction.
 */
@Injectable()
export class ManualDiscountsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: OrdersService,
    private readonly discounts: OrderDiscountsService,
    private readonly catalog: PromotionCatalog,
    private readonly authorizations: SupervisorAuthorizationsService,
  ) {}

  async add(orderId: string, input: AddOrderDiscountInput, callerProfileId: string): Promise<Order> {
    const order = await this.openOrder(orderId);
    const channel = (order.order_type ?? 'dine_in') as PromotionChannel;
    const rule = input.promotionId ? await this.manualRule(input.promotionId, orderId, channel) : null;
    if (rule?.kind === 'product_discount' && !input.orderItemId) throw refuse('discount_item_required');
    if (rule?.kind === 'bill_discount' && input.orderItemId) throw refuse('discount_item_not_allowed');

    const { amount, lineQuantity } = input.orderItemId
      ? await this.lineAmount(orderId, input.orderItemId, rule, input)
      : { amount: await this.billAmount(orderId, rule, input), lineQuantity: null };
    if (amount <= 0) throw refuse('discount_nothing_left');
    // The removal rule is fixed now (requires_authorization): a later change of the promotion's mode does not change it.
    const requiresAuthorization = rule?.mode !== 'manual';
    const authorizedBy = requiresAuthorization ? await this.authorizer(orderId, input.authorizationId) : callerProfileId;

    await this.write(sql`
      INSERT INTO public.order_discounts (order_id, order_item_id, promotion_id, kind, source, label, amount, reason, created_by, authorized_by, requires_authorization, line_quantity)
      VALUES (${orderId}, ${input.orderItemId ?? null}, ${rule?.id ?? null}, ${input.orderItemId ? 'manual_item' : 'manual_bill'}, 'manual',
              ${left(rule?.name ?? FREE_DISCOUNT_LABEL)}, ${amount}, ${input.reason}, ${callerProfileId}, ${authorizedBy}, ${requiresAuthorization}, ${lineQuantity})`);
    await this.discounts.recompute(orderId);
    return this.orders.get(orderId);
  }

  /** Removes a manual discount with the authorization rule stored when it was added, then recomputes. */
  async remove(orderId: string, discountId: string, authorizationId: string | undefined, callerProfileId: string): Promise<Order> {
    await this.openOrder(orderId);
    const [row] = await this.rows<{ source: string; requires_authorization: boolean }>(sql`
      SELECT source, requires_authorization FROM public.order_discounts WHERE id = ${discountId} AND order_id = ${orderId}`);
    if (!row) throw new NotFoundException({ message: 'Descuento no encontrado', code: 'discount_not_found' });
    if (row.source !== 'manual') throw refuse('discount_not_manual');
    if (row.requires_authorization) await this.authorizer(orderId, authorizationId);
    await this.write(sql`DELETE FROM public.order_discounts WHERE id = ${discountId} AND order_id = ${orderId}`);
    await this.discounts.recompute(orderId);
    return this.orders.get(orderId);
  }

  /** The locked order; 404 order_not_found, 409 order_closed when paid or cancelled. */
  private async openOrder(orderId: string) {
    const order = await this.orders.lockOrder(orderId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? new NotFoundException({ message: VOID_ERRORS.order_not_found.message, code: 'order_not_found' }) : error;
    });
    if (order.status === 'paid' || order.status === 'cancelled') throw closed();
    return order;
  }

  /** A manual-mode product or bill promotion live now (its schedule and channel) and under its maxUsesPerOrder. */
  private async manualRule(promotionId: string, orderId: string, channel: PromotionChannel): Promise<Rule> {
    const [rule] = await this.catalog.rules([promotionId]);
    if (!rule) throw refuse('promotion_not_found');
    if (rule.mode === 'automatic') throw refuse('promotion_not_manual');
    if (rule.kind !== 'product_discount' && rule.kind !== 'bill_discount') throw refuse('promotion_kind_unsupported');
    const now = await this.catalog.now();
    if (!isLiveFor({ ...rule, mode: 'automatic' }, now.local, channel)) throw refuse('promotion_not_available');
    if (rule.maxUsesPerOrder !== null) {
      const [{ uses }] = await this.rows<{ uses: number }>(sql`
        SELECT count(*)::int AS uses FROM public.order_discounts WHERE order_id = ${orderId} AND promotion_id = ${rule.id}`);
      if (uses >= rule.maxUsesPerOrder) throw refuse('promotion_max_uses');
    }
    return rule;
  }

  /**
   * From the line value (price·quantity) minus the discounts already on it,
   * never above what remains on the line nor above the current net subtotal
   * (S2: the order's discounts never exceed the gross subtotal); with the line
   * quantity the amount is for.
   */
  private async lineAmount(orderId: string, orderItemId: string, rule: Rule | null, input: AddOrderDiscountInput): Promise<{ amount: number; lineQuantity: number }> {
    const [line] = await this.rows<{ dish_id: string | null; category_id: string | null; subcategory_id: string | null; price: string; quantity: number; discounted: string }>(sql`
      SELECT oi.dish_id, d.category_id, d.subcategory_id, oi.price, oi.quantity,
             coalesce((SELECT sum(od.amount) FROM public.order_discounts od WHERE od.order_item_id = oi.id), 0) AS discounted
        FROM public.order_items oi LEFT JOIN public.dishes d ON d.id = oi.dish_id
       WHERE oi.id = ${orderItemId} AND oi.order_id = ${orderId} AND oi.status IS DISTINCT FROM 'cancelled' AND oi.quantity > 0`);
    if (!line) throw refuse('order_item_not_found');
    const unitPrice = Number(line.price);
    const quantity = Number(line.quantity);
    const remaining = Math.max(0, Math.round(unitPrice * quantity) - Number(line.discounted));
    const cap = Math.min(remaining, await this.netSubtotal(orderId));
    if (!rule) return { amount: Math.min(cap, amountOff(remaining, input.discountType!, input.discountValue!)), lineQuantity: quantity };
    const item = { id: orderItemId, dishId: line.dish_id ?? '', categoryId: line.category_id, subcategoryId: line.subcategory_id, unitPrice, quantity, promotionId: null, addedAt: '', voided: false, comboId: null };
    if (!matchesTargets(item, rule)) throw refuse('promotion_not_applicable');
    return { amount: Math.min(cap, unitSaving(unitPrice, rule) * quantity), lineQuantity: quantity };
  }

  /**
   * From the current net subtotal (the bill after every discount), never
   * above it; a promotion's minSubtotal is checked, as S4, on the gross
   * subtotal minus the line and combo discounts.
   */
  private async billAmount(orderId: string, rule: Rule | null, input: AddOrderDiscountInput): Promise<number> {
    const net = await this.netSubtotal(orderId);
    if (!rule) return amountOff(net, input.discountType!, input.discountValue!);
    if ((await this.afterProductDiscounts(orderId)) < (rule.minSubtotal ?? 0)) throw refuse('promotion_min_subtotal');
    const amount = amountOff(net, rule.discountType, rule.discountValue);
    return rule.maxDiscount === null ? amount : Math.min(amount, rule.maxDiscount);
  }

  /** The order's current net subtotal (gross minus every discount), never below 0. */
  private async netSubtotal(orderId: string): Promise<number> {
    const [{ subtotal }] = await this.rows<{ subtotal: string }>(sql`SELECT subtotal FROM public.orders WHERE id = ${orderId}`);
    return Math.max(0, Number(subtotal));
  }

  /** The gross subtotal minus the line and combo discounts (both carry a line) of lines that are not cancelled: the S4 base. */
  private async afterProductDiscounts(orderId: string): Promise<number> {
    const [{ base }] = await this.rows<{ base: string }>(sql`
      SELECT coalesce((SELECT sum(round(oi.price * oi.quantity)) FROM public.order_items oi
                        WHERE oi.order_id = ${orderId} AND oi.status IS DISTINCT FROM 'cancelled'), 0)
           - coalesce((SELECT sum(od.amount) FROM public.order_discounts od
                         JOIN public.order_items oi ON oi.id = od.order_item_id
                        WHERE od.order_id = ${orderId} AND oi.status IS DISTINCT FROM 'cancelled'), 0) AS base`);
    return Number(base);
  }

  /**
   * The supervisor behind the discount: the apply_discount authorization of
   * this order, consumed now, then checked by private.discount_authorizer.
   */
  private async authorizer(orderId: string, authorizationId: string | undefined): Promise<string> {
    if (!authorizationId) throw forbid('authorization_required');
    await this.authorizations.consume(authorizationId, AUTHORIZATION_ACTION);
    try {
      const [row] = await this.rows<{ supervisor: string }>(sql`
        SELECT private.discount_authorizer(${orderId}::uuid, ${authorizationId}::uuid) AS supervisor`);
      return row.supervisor;
    } catch (error) {
      const code = authorizerError(error);
      if (code) throw forbid(code);
      throw error;
    }
  }

  /** A write on order_discounts; the lifecycle guard (42501, paid or cancelled order) answers order_closed. */
  private async write(query: SQL): Promise<void> {
    try {
      await this.uow.db.execute(query);
    } catch (error) {
      if (isLifecycleError(error)) throw closed();
      throw error;
    }
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

const left = (label: string) => label.slice(0, 255);

/** The code of a private.discount_authorizer refusal, through Drizzle's `cause` chain. */
function authorizerError(error: unknown): 'authorization_required' | 'authorization_invalid' | 'self_authorization_not_allowed' | undefined {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    const match = code === '42501' && typeof message === 'string' ? AUTHORIZER_RAISED.exec(message) : null;
    if (match) return match[1] as 'authorization_required' | 'authorization_invalid' | 'self_authorization_not_allowed';
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The 42501 of private.guard_order_discount_lifecycle, through Drizzle's `cause` chain. */
function isLifecycleError(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 5; depth += 1) {
    const { code, message } = current as { code?: unknown; message?: unknown };
    if (code === '42501' && typeof message === 'string' && message.startsWith('order_discounts:')) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
