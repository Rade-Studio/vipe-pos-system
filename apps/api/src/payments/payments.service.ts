import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { VoidsService } from '../audit/voids.service';
import { UnitOfWork } from '../db/unit-of-work';
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

  async split(parentOrderId: string, input: z.infer<typeof splitOrderSchema>): Promise<SplitOrderResult> {
    const items = input.items.map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity }));
    return toSplitResult(
      await this.rpc(sql`SELECT public.split_order(${parentOrderId}::uuid, ${JSON.stringify(items)}::jsonb) AS result`),
    );
  }

  async undoSplit(childOrderId: string): Promise<UndoSplitResult> {
    return toUndoSplitResult(await this.rpc(sql`SELECT public.undo_split(${childOrderId}::uuid) AS result`));
  }

  private async rpc(query: SQL): Promise<Json> {
    const [row] = (await this.uow.db.execute(query)).rows as { result: Json }[];
    return row.result;
  }
}
