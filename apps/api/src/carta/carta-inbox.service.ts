import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import { OrdersService } from '../orders/orders.service';
import { cartaDbError } from './carta-errors';
import type { CartaInbox, ProposalConfirmed } from './carta-table.dto';

/** Order statuses that keep a table open (private.carta_open_order). */
const OPEN_STATUSES = ['active', 'kitchen', 'delivered'];

/** private.confirm_table_proposal (0036). */
interface ConfirmedProposal {
  proposalId: string;
  orderId: string;
  items: { dishId: string; quantity: number; optionIds: string[]; note: string | null }[];
}

/**
 * The waiter's inbox of guest proposals and requests (S12, S14), inside the
 * request unit of work: RLS scopes the reads to the caller's restaurant and
 * the 0036 staff functions check the role and tenant again. The restaurant
 * never comes from the client.
 */
@Injectable()
export class CartaInboxService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: OrdersService,
  ) {}

  /** Requests of earlier orders are ignored (L19): only the currently open orders count. */
  async inbox(): Promise<CartaInbox> {
    const open = sql`o.status = ANY(${sql.param(OPEN_STATUSES)}::text[])`;
    const [proposals, requests] = await Promise.all([
      this.rows<CartaInbox['proposals'][number]>(sql`
        SELECT jsonb_build_object(
                 'id', p.id, 'orderId', p.order_id, 'tableNumber', t.number, 'zoneName', z.name, 'waiterName', w.full_name,
                 'note', p.note, 'createdAt', p.created_at,
                 'lines', (SELECT jsonb_agg(jsonb_build_object(
                                    'dishId', l.v ->> 'dishId', 'name', d.name, 'quantity', (l.v ->> 'quantity')::integer, 'note', l.v -> 'note',
                                    'options', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', mo.name) ORDER BY x.n), '[]'::jsonb)
                                                  FROM jsonb_array_elements_text(l.v -> 'optionIds') WITH ORDINALITY x(id, n)
                                                  LEFT JOIN public.modifier_options mo ON mo.id = x.id::uuid))
                                  ORDER BY l.n)
                             FROM jsonb_array_elements(p.items) WITH ORDINALITY l(v, n)
                             LEFT JOIN public.dishes d ON d.id = (l.v ->> 'dishId')::uuid)) AS row
          FROM public.carta_table_proposals p
          JOIN public.orders o ON o.id = p.order_id
          JOIN public.tables t ON t.id = p.table_id
          LEFT JOIN public.zones z ON z.id = t.zone_id
          LEFT JOIN public.profiles w ON w.id = o.waiter_id
         WHERE p.status = 'pending' AND ${open}
         ORDER BY p.created_at DESC, p.id DESC`),
      this.rows<CartaInbox['requests'][number]>(sql`
        SELECT jsonb_build_object(
                 'id', r.id, 'kind', r.kind, 'orderId', r.order_id, 'tableNumber', t.number, 'zoneName', z.name,
                 'waiterName', w.full_name, 'createdAt', r.created_at) AS row
          FROM public.carta_table_requests r
          JOIN public.orders o ON o.id = r.order_id
          JOIN public.tables t ON t.id = r.table_id
          LEFT JOIN public.zones z ON z.id = t.zone_id
          LEFT JOIN public.profiles w ON w.id = o.waiter_id
         WHERE r.resolved_at IS NULL AND ${open}
         ORDER BY r.created_at DESC, r.id DESC`),
    ]);
    return { proposals, requests };
  }

  /**
   * One transaction: confirm (locks the proposal and its open order), add the
   * lines through the waiter's POST /orders/:id/items path (prices, options,
   * promotion tagging, stock check and consumption, bill, order and table to
   * kitchen), then link the new order_items so the guest sees the stage.
   */
  async confirm(id: string): Promise<ProposalConfirmed> {
    const [proposal] = await this.call<ConfirmedProposal>(sql`SELECT private.confirm_table_proposal(${id}::uuid) AS row`);
    const before = new Set((await this.orders.get(proposal.orderId)).items.map((item) => item.id));
    const order = await this.orders.addItems(proposal.orderId, {
      items: proposal.items.map((item) => ({
        dishId: item.dishId,
        quantity: item.quantity,
        comments: item.note,
        modifiers: item.optionIds.map((optionId) => ({ optionId })),
      })),
    });
    const orderItemIds = order.items.map((item) => item.id).filter((itemId) => !before.has(itemId));
    await this.call(sql`SELECT private.link_table_proposal_items(${id}::uuid, ${sql.param(orderItemIds)}::uuid[]) AS row`);
    // Freshly sent lines are in the kitchen.
    return { proposalId: proposal.proposalId, orderId: proposal.orderId, status: 'confirmed', stage: 'kitchen', orderItemIds };
  }

  async reject(id: string, reason: string | null): Promise<void> {
    await this.call(sql`SELECT private.reject_table_proposal(${id}::uuid, ${reason}) AS row`);
  }

  async resolve(id: string): Promise<void> {
    await this.call(sql`SELECT private.resolve_table_request(${id}::uuid) AS row`);
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
