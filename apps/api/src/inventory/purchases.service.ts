import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type {
  createPurchaseOrderSchema,
  PaymentStatus,
  PurchaseOrder,
  purchaseOrderListQuerySchema,
  ReceivePurchaseResult,
  receivePurchaseOrderSchema,
  updatePurchaseOrderSchema,
} from './inventory.dto';
import { one, rows, rpc } from './inventory-sql';
import { toPurchaseOrder, toReceiveResult } from './inventory.mappers';

type Json = Record<string, unknown>;
type LineInput = { itemId: string; quantity: number; unitCost: number };

const NOT_FOUND = 'Purchase order not found';

/**
 * One order with its names and lines (insertion order) for a query whose FROM
 * has `public.purchase_orders po`; totals are added by the mapper.
 */
const orderJson = sql`
  to_jsonb(po) || jsonb_build_object(
    'supplier_name', (SELECT s.name FROM public.suppliers s WHERE s.id = po.supplier_id),
    'location_name', (SELECT l.name FROM public.inventory_locations l WHERE l.id = po.location_id),
    'lines', coalesce((
      SELECT jsonb_agg(to_jsonb(pl) || jsonb_build_object('item_name', i.name, 'unit', i.unit, 'sku', i.sku)
                       ORDER BY pl.created_at, pl.ctid)
        FROM public.purchase_order_lines pl
        LEFT JOIN public.ingredients i ON i.id = pl.ingredient_id
       WHERE pl.purchase_order_id = po.id), '[]'::jsonb))`;

/**
 * Purchase orders. Headers and draft lines are written to the tables (RLS,
 * admin) and guarded by `inventory_documents_before_write`; receiving goes
 * through `receive_purchase_order`. Every multi-step write runs in the request
 * transaction, so a failed line leaves no draft and a failed diff changes nothing.
 */
@Injectable()
export class PurchasesService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first. */
  async list(query: z.infer<typeof purchaseOrderListQuerySchema>): Promise<PurchaseOrder[]> {
    const where: SQL[] = [];
    if (query.status?.length) where.push(sql`po.status = ANY(${sql.param(query.status)}::text[])`);
    if (query.supplierId) where.push(sql`po.supplier_id = ${query.supplierId}`);
    const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const result = await rows<{ po: Json }>(this.uow, sql`
      SELECT ${orderJson} AS po FROM public.purchase_orders po ${filter} ORDER BY po.number DESC`);
    return result.map((row) => toPurchaseOrder(row.po));
  }

  async get(id: string): Promise<PurchaseOrder> {
    return toPurchaseOrder(
      await one<Json>(this.uow, sql`SELECT ${orderJson} AS po FROM public.purchase_orders po WHERE po.id = ${id}`, 'po', NOT_FOUND),
    );
  }

  /** Draft header and its lines in one transaction (no orphan draft). */
  async create(input: z.infer<typeof createPurchaseOrderSchema>): Promise<PurchaseOrder> {
    const [row] = await rows<{ id: string }>(this.uow, sql`
      INSERT INTO public.purchase_orders (supplier_id, location_id, expected_on, notes, status)
      VALUES (${input.supplierId}, ${input.locationId}, ${input.expectedOn ?? null}, ${input.notes ?? null}, 'draft')
      RETURNING id`);
    await this.insertLines(row.id, input.lines);
    return this.get(row.id);
  }

  /**
   * Replaces the header and applies the line diff the web computed with
   * `diffDraftLines` (remove, then update changed lines, then add), all in one
   * transaction. A `lineId` that is not a line of this order is a 422.
   */
  async update(id: string, input: z.infer<typeof updatePurchaseOrderSchema>): Promise<PurchaseOrder> {
    await one(this.uow, sql`
      UPDATE public.purchase_orders
         SET supplier_id = ${input.supplierId}, location_id = ${input.locationId},
             expected_on = ${input.expectedOn ?? null}, notes = ${input.notes ?? null}
       WHERE id = ${id}
      RETURNING id`, 'id', NOT_FOUND);

    const existing = new Set(
      (await rows<{ id: string }>(this.uow, sql`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = ${id}`)).map(
        (row) => row.id,
      ),
    );
    const kept = input.lines.filter((line) => line.lineId !== undefined);
    const keptIds = kept.map((line) => line.lineId!);
    if (keptIds.some((lineId) => !existing.has(lineId)) || new Set(keptIds).size !== keptIds.length) {
      throw new UnprocessableEntityException('lines: lineId must be a line of this purchase order, once');
    }

    const removed = [...existing].filter((lineId) => !keptIds.includes(lineId));
    if (removed.length) {
      await this.uow.db.execute(sql`DELETE FROM public.purchase_order_lines WHERE id = ANY(${sql.param(removed)}::uuid[])`);
    }
    if (kept.length) {
      const changes = kept.map((line) => ({ id: line.lineId, item_id: line.itemId, quantity: line.quantity, unit_cost: line.unitCost }));
      await this.uow.db.execute(sql`
        UPDATE public.purchase_order_lines pl
           SET ingredient_id = x.item_id, quantity = x.quantity, unit_cost = x.unit_cost
          FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) AS x(id uuid, item_id uuid, quantity numeric, unit_cost numeric)
         WHERE pl.id = x.id
           AND (pl.ingredient_id, pl.quantity, pl.unit_cost) IS DISTINCT FROM (x.item_id, x.quantity, x.unit_cost)`);
    }
    await this.insertLines(
      id,
      input.lines.filter((line) => line.lineId === undefined),
    );
    return this.get(id);
  }

  /** draft -> ordered / cancelled (the trigger sets ordered_at and refuses other moves). */
  async setStatus(id: string, status: 'ordered' | 'cancelled'): Promise<PurchaseOrder> {
    await one(this.uow, sql`UPDATE public.purchase_orders SET status = ${status} WHERE id = ${id} RETURNING id`, 'id', NOT_FOUND);
    return this.get(id);
  }

  async setPaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<PurchaseOrder> {
    await one(
      this.uow,
      sql`UPDATE public.purchase_orders SET payment_status = ${paymentStatus} WHERE id = ${id} RETURNING id`,
      'id',
      NOT_FOUND,
    );
    return this.get(id);
  }

  /** Only drafts (trigger: P0001 `only draft purchase orders can be deleted`). */
  async remove(id: string): Promise<void> {
    await one(this.uow, sql`DELETE FROM public.purchase_orders WHERE id = ${id} RETURNING id`, 'id', NOT_FOUND);
  }

  /**
   * `receive_purchase_order` with the line objects purchases-service.ts built
   * (unit_cost, lot_code, expires_on only when given), then the optional
   * payment status in the same transaction.
   */
  async receive(id: string, input: z.infer<typeof receivePurchaseOrderSchema>): Promise<ReceivePurchaseResult> {
    const lines = input.lines.map((l) => {
      const line: Record<string, unknown> = { line_id: l.lineId, quantity: l.quantity };
      if (l.unitCost !== undefined) line.unit_cost = l.unitCost;
      if (l.lotCode !== undefined) line.lot_code = l.lotCode;
      if (l.expiresOn !== undefined) line.expires_on = l.expiresOn;
      return line;
    });
    const result = await rpc(this.uow, sql`
      SELECT public.receive_purchase_order(${id}::uuid, ${JSON.stringify(lines)}::jsonb) AS result`);
    if (input.paymentStatus !== undefined) {
      await this.uow.db.execute(sql`UPDATE public.purchase_orders SET payment_status = ${input.paymentStatus} WHERE id = ${id}`);
    }
    return toReceiveResult(result);
  }

  /** Lines in the given order; the trigger refuses foreign items (P0002) and closed orders (P0001). */
  private async insertLines(purchaseOrderId: string, lines: LineInput[]): Promise<void> {
    if (!lines.length) {
      return;
    }
    const values = lines.map((line) => ({ item_id: line.itemId, quantity: line.quantity, unit_cost: line.unitCost }));
    await this.uow.db.execute(sql`
      INSERT INTO public.purchase_order_lines (purchase_order_id, ingredient_id, quantity, unit_cost)
      SELECT ${purchaseOrderId}::uuid, (e.v->>'item_id')::uuid, (e.v->>'quantity')::numeric, (e.v->>'unit_cost')::numeric
        FROM jsonb_array_elements(${JSON.stringify(values)}::jsonb) WITH ORDINALITY AS e(v, n)
       ORDER BY e.n`);
  }
}
