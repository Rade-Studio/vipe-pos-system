import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { slugifyMethodCode } from './method-code';
import type { createPaymentMethodSchema, PaymentMethod, updatePaymentMethodSchema } from './payments.dto';
import { toPaymentMethod } from './payments.mappers';

/**
 * The caller's payment-method catalog. RLS lets every role read it and only
 * admin write it; `code` is immutable after insert (guard trigger). Every
 * method runs in the request transaction.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Inactive rows included: old payments keep resolving their method. */
  async list(): Promise<PaymentMethod[]> {
    const rows = await this.rows<{ method: Record<string, unknown> }>(sql`
      SELECT to_jsonb(m) AS method FROM public.payment_methods m ORDER BY m.sort_order, m.created_at, m.id`);
    return rows.map((row) => toPaymentMethod(row.method));
  }

  /**
   * The code slug (unique per restaurant) and sortOrder = max + 1 are derived
   * here, with the restaurant's rows locked so two creates cannot pick the same.
   */
  async create(input: z.infer<typeof createPaymentMethodSchema>): Promise<PaymentMethod> {
    const existing = await this.rows<{ code: string; sort_order: number }>(sql`
      SELECT code, sort_order FROM public.payment_methods FOR UPDATE`);
    const code = slugifyMethodCode(input.name, existing.map((row) => row.code));
    const sortOrder = existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
    const [row] = await this.rows<{ method: Record<string, unknown> }>(sql`
      INSERT INTO public.payment_methods (code, name, kind, sort_order)
      VALUES (${code}, ${input.name}, ${input.kind}, ${sortOrder})
      RETURNING to_jsonb(payment_methods.*) AS method`);
    return toPaymentMethod(row.method);
  }

  async update(id: string, patch: z.infer<typeof updatePaymentMethodSchema>): Promise<PaymentMethod> {
    const [row] = await this.rows<{ method: Record<string, unknown> }>(sql`
      UPDATE public.payment_methods
         SET name = coalesce(${patch.name ?? null}::text, name),
             is_active = coalesce(${patch.isActive ?? null}::boolean, is_active)
       WHERE id = ${id}
      RETURNING to_jsonb(payment_methods.*) AS method`);
    if (!row) {
      throw new NotFoundException('Payment method not found');
    }
    return toPaymentMethod(row.method);
  }

  /** `ids` must list every method of the restaurant once; sortOrder becomes the position, in one UPDATE. */
  async reorder(ids: string[]): Promise<PaymentMethod[]> {
    const current = await this.rows<{ id: string }>(sql`SELECT id FROM public.payment_methods FOR UPDATE`);
    const known = new Set(current.map((row) => row.id));
    if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new UnprocessableEntityException('ids must list every payment method of the restaurant once');
    }
    await this.uow.db.execute(sql`
      UPDATE public.payment_methods m
         SET sort_order = x.position - 1
        FROM unnest(${sql.param(ids)}::uuid[]) WITH ORDINALITY AS x(id, position)
       WHERE m.id = x.id`);
    return this.list();
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}
