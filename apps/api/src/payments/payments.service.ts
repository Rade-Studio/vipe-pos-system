import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toVoidException } from '../audit/voids';
import { VoidsService } from '../audit/voids.service';
import { UnitOfWork } from '../db/unit-of-work';
import { OrderDiscountsService } from '../promotions/order-discounts.service';
import {
  CASH_REFERENCE_MESSAGE,
  type Payment,
  type PaymentVoid,
  type payOrderSchema,
  type PayOrderResult,
  type SplitOrderResult,
  type splitOrderSchema,
  type UndoSplitResult,
  type voidPaymentSchema,
} from './payments.dto';
import { paymentJson, toPayment, toPaymentVoid, toPayOrderResult, toSplitResult, toUndoSplitResult } from './payments.mappers';

type Json = Record<string, unknown>;
type TenderInput = z.infer<typeof payOrderSchema>['tenders'][number];

/** split_order refuses to separate the lines of a combo (0025): a stable 422 code. */
const COMBO_SPLIT = /^split_order: item\[\d+\] is part of a combo; move every line of the combo together$/;
export const COMBO_SPLIT_MESSAGE = 'Un menú se mueve completo: pasa todos sus productos juntos';

function toComboSplitException(error: unknown): UnprocessableEntityException | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (COMBO_SPLIT.test(current.message) && (current as { code?: unknown }).code === 'P0001') {
      return new UnprocessableEntityException({ message: COMBO_SPLIT_MESSAGE, code: 'combo_split_not_allowed' });
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * The p_tenders jsonb of pay_order. Without a reference a line keeps the exact
 * pre-0014 keys (payment_method_id, amount, cash_received), so old payloads
 * reach the RPC byte-identical; a reference is appended last.
 */
export function toPayOrderTenders(tenders: TenderInput[]): Json[] {
  return tenders.map((tender) => ({
    payment_method_id: tender.paymentMethodId,
    amount: tender.amount,
    cash_received: tender.cashReceived ?? null,
    ...(tender.reference ? { reference: tender.reference } : {}),
  }));
}

/**
 * Settlement over the plpgsql core. Money is computed only by the RPCs
 * (pay_order, split_order, undo_split), called unchanged inside the request
 * transaction with the argument shapes lib/supabase/payments-service.ts sent;
 * their SQLSTATEs and messages reach the client through the error filter.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly voids: VoidsService,
    private readonly discounts: OrderDiscountsService,
  ) {}

  async pay(input: z.infer<typeof payOrderSchema>): Promise<PayOrderResult> {
    await this.refuseCashReferences(input.tenders);
    const tenders = toPayOrderTenders(input.tenders);
    const result = await this.rpc(sql`
      SELECT public.pay_order(${input.orderId}::uuid, ${input.cashRegisterId}::uuid, ${input.tipAmount}::bigint,
                              ${JSON.stringify(tenders)}::jsonb, ${input.idempotencyKey}::uuid) AS result`);
    return toPayOrderResult(result);
  }

  /**
   * A reference only describes a card/transfer line: one on a cash method is
   * 422 before pay_order runs. Unknown or foreign methods are left to the RPC.
   */
  private async refuseCashReferences(tenders: TenderInput[]): Promise<void> {
    const ids = tenders.filter((tender) => tender.reference).map((tender) => tender.paymentMethodId);
    if (!ids.length) {
      return;
    }
    const { rows } = await this.uow.db.execute(sql`
      SELECT 1 FROM public.payment_methods WHERE id = ANY(${sql.param(ids)}::uuid[]) AND kind = 'cash' LIMIT 1`);
    if (rows.length) {
      throw new UnprocessableEntityException(CASH_REFERENCE_MESSAGE);
    }
  }

  /** Payments with their tenders, newest first; an empty id list answers [] without a query. */
  async list(filter: { orderIds?: string[]; cashRegisterIds?: string[] }): Promise<Payment[]> {
    const ids = filter.orderIds ?? filter.cashRegisterIds ?? [];
    if (!ids.length) {
      return [];
    }
    const where = filter.orderIds
      ? sql`p.order_id = ANY(${sql.param(ids)}::uuid[])`
      : sql`p.cash_register_id = ANY(${sql.param(ids)}::uuid[])`;
    const result = await this.uow.db.execute(sql`
      SELECT ${paymentJson} AS payment FROM public.payments p WHERE ${where} ORDER BY p.created_at DESC, p.id`);
    return (result.rows as { payment: Json }[]).map((row) => toPayment(row.payment));
  }

  /**
   * POST /payments/:id/void: public.void_payment, always with a supervisor
   * authorization. The payment row stays (voided_at) but counts in no total
   * and is no longer listed; the order is open again to be paid or cancelled.
   */
  async void(paymentId: string, input: z.infer<typeof voidPaymentSchema>): Promise<PaymentVoid> {
    await this.voids.run(
      'void_payment',
      input.authorizationId,
      sql`SELECT public.void_payment(${paymentId}::uuid, ${input.reason}, ${input.reasonText ?? null}, ${input.authorizationId ?? null}::uuid) AS result`,
    );
    const { rows } = await this.uow.db.execute(sql`SELECT to_jsonb(v) AS row FROM public.payment_voids v WHERE v.payment_id = ${paymentId}`);
    return toPaymentVoid((rows[0] as { row: Json }).row);
  }

  /**
   * The moved lines carry their discounts pro rata; then both orders get
   * their automatic discounts recomputed (buy_x_pay_y regroups on each side,
   * the bill discount is evaluated again) in the same transaction, and the
   * bills are read after it. Separating a combo is 422 combo_split_not_allowed.
   */
  async split(parentOrderId: string, input: z.infer<typeof splitOrderSchema>): Promise<SplitOrderResult> {
    const items = input.items.map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity }));
    let result: Json;
    try {
      result = await this.rpc(sql`SELECT public.split_order(${parentOrderId}::uuid, ${JSON.stringify(items)}::jsonb) AS result`);
    } catch (error) {
      throw toComboSplitException(error) ?? error;
    }
    const childOrderId = String(result.child_order_id);
    await this.discounts.recompute(parentOrderId);
    await this.discounts.recompute(childOrderId);
    return toSplitResult({ ...result, parent: await this.bill(parentOrderId), child: await this.bill(childOrderId) });
  }

  /** A split whose lines have void history is not undone: 409 split_has_voids (the void rows reference them). */
  async undoSplit(childOrderId: string): Promise<UndoSplitResult> {
    let result: Json;
    try {
      result = await this.rpc(sql`SELECT public.undo_split(${childOrderId}::uuid) AS result`);
    } catch (error) {
      throw toVoidException(error) ?? error;
    }
    const parentOrderId = String((result.parent as Json).order_id);
    await this.discounts.recompute(parentOrderId);
    return toUndoSplitResult({ ...result, parent: await this.bill(parentOrderId) });
  }

  /** The bill of an order in the split_order/undo_split response shape, after the recompute. */
  private async bill(orderId: string): Promise<Json> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT jsonb_build_object('order_id', o.id, 'subtotal', o.subtotal, 'tax', o.tax, 'tip', o.tip, 'total', o.total) AS result
        FROM public.orders o WHERE o.id = ${orderId}`);
    return (rows[0] as { result: Json }).result;
  }

  private async rpc(query: SQL): Promise<Json> {
    const [row] = (await this.uow.db.execute(query)).rows as { result: Json }[];
    return row.result;
  }
}
