import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { Payment, payOrderSchema, PayOrderResult, SplitOrderResult, splitOrderSchema, UndoSplitResult } from './payments.dto';
import { paymentJson, toPayment, toPayOrderResult, toSplitResult, toUndoSplitResult } from './payments.mappers';

type Json = Record<string, unknown>;

/**
 * Settlement over the plpgsql core. Money is computed only by the RPCs
 * (pay_order, split_order, undo_split), called unchanged inside the request
 * transaction with the argument shapes lib/supabase/payments-service.ts sent;
 * their SQLSTATEs and messages reach the client through the error filter.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly uow: UnitOfWork) {}

  async pay(input: z.infer<typeof payOrderSchema>): Promise<PayOrderResult> {
    const tenders = input.tenders.map((tender) => ({
      payment_method_id: tender.paymentMethodId,
      amount: tender.amount,
      cash_received: tender.cashReceived ?? null,
    }));
    const result = await this.rpc(sql`
      SELECT public.pay_order(${input.orderId}::uuid, ${input.cashRegisterId}::uuid, ${input.tipAmount}::bigint,
                              ${JSON.stringify(tenders)}::jsonb, ${input.idempotencyKey}::uuid) AS result`);
    return toPayOrderResult(result);
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
