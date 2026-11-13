import { Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { DbClient } from '../db/db-client';
import { cartaDbError } from './carta-errors';
import {
  type feedbackSchema,
  type GuestTableBill,
  type GuestTableStatus,
  type ProposalCreated,
  type proposalSchema,
  type TableRequestCreated,
} from './carta-table.dto';
import { CARTA_MESSAGES, cartaSlugSchema, tableTokenSchema } from './carta.dto';

const notFound = () => new NotFoundException(CARTA_MESSAGES.notFound);

/**
 * The guest side of the table QR (S12–S14): no login and no unit of work,
 * like CartaService. The restaurant comes only from the slug and the table
 * only from its token, inside the 0037 guest SECURITY DEFINER functions run
 * on the pool without app.user_id; the staff identity is never read.
 */
@Injectable()
export class CartaTableService {
  constructor(private readonly client: DbClient) {}

  async status(slug: string, token: string, guestKey: string): Promise<GuestTableStatus> {
    return this.found(await this.call<GuestTableStatus>('private.guest_table_status($1, $2, $3)', [slug, token, guestKey], token));
  }

  async bill(slug: string, token: string): Promise<GuestTableBill> {
    return this.found(await this.call<GuestTableBill>('private.guest_table_bill($1, $2)', [slug, token], token));
  }

  async propose(slug: string, token: string, input: z.infer<typeof proposalSchema>): Promise<ProposalCreated> {
    const items = input.items.map((item) => ({ dishId: item.dishId, quantity: item.quantity, optionIds: item.optionIds ?? [], note: item.note ?? null }));
    const created = await this.call<ProposalCreated>(
      'private.guest_submit_proposal($1, $2, $3, $4::jsonb, $5)',
      [slug, token, input.guestKey, JSON.stringify(items), input.note ?? null],
      token,
    );
    return this.found(created);
  }

  async request(slug: string, token: string, kind: string): Promise<TableRequestCreated> {
    return this.found(await this.call<TableRequestCreated>('private.guest_request($1, $2, $3)', [slug, token, kind], token));
  }

  async feedback(slug: string, input: z.infer<typeof feedbackSchema>): Promise<void> {
    await this.call('private.guest_feedback($1, $2, $3, $4)', [slug, input.token ?? null, input.rating, input.comment ?? null], input.token);
  }

  /** Malformed slugs and tokens are the carta's one 404 before any query. */
  private async call<T>(fn: string, values: unknown[], token: string | undefined): Promise<T | null> {
    if (!cartaSlugSchema.safeParse(values[0]).success || (token !== undefined && !tableTokenSchema.safeParse(token).success)) {
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
