import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type {
  ApplyCountResult,
  CountLine,
  InventoryCount,
  InventoryCountDetail,
  OpenCountResult,
  openCountSchema,
} from './inventory.dto';
import { one, rows, rpc } from './inventory-sql';
import { toApplyCountResult, toCount, toCountLine, toOpenCountResult } from './inventory.mappers';

type Json = Record<string, unknown>;

const NOT_FOUND = 'Inventory count not found';

const countJson = sql`to_jsonb(c) || jsonb_build_object('location_name',
  (SELECT l.name FROM public.inventory_locations l WHERE l.id = c.location_id))`;
const lineJson = sql`to_jsonb(cl) || jsonb_build_object('item_name', i.name, 'sku', i.sku, 'unit', i.unit)`;

/**
 * Physical counts: `open_inventory_count` snapshots the expected quantities,
 * the admin sets `counted_quantity` per line (RLS + guard trigger), and
 * `apply_inventory_count` moves the balance to the counted one.
 */
@Injectable()
export class CountsService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first. */
  async list(): Promise<InventoryCount[]> {
    const result = await rows<{ count: Json }>(this.uow, sql`
      SELECT ${countJson} AS count FROM public.inventory_counts c ORDER BY c.number DESC`);
    return result.map((row) => toCount(row.count));
  }

  /** Lines by item name with the `es` collation rule the web applied (localeCompare). */
  async get(id: string): Promise<InventoryCountDetail> {
    const count = toCount(
      await one<Json>(this.uow, sql`SELECT ${countJson} AS count FROM public.inventory_counts c WHERE c.id = ${id}`, 'count', NOT_FOUND),
    );
    const lines = (
      await rows<{ line: Json }>(this.uow, sql`
        SELECT ${lineJson} AS line
          FROM public.inventory_count_lines cl
          LEFT JOIN public.ingredients i ON i.id = cl.ingredient_id
         WHERE cl.count_id = ${id}`)
    ).map((row) => toCountLine(row.line));
    lines.sort((a, b) => (a.itemName ?? '').localeCompare(b.itemName ?? '', 'es'));
    return { ...count, lines };
  }

  async open(input: z.infer<typeof openCountSchema>): Promise<OpenCountResult> {
    const itemIds = input.itemIds ?? null;
    return toOpenCountResult(
      await rpc(this.uow, sql`
        SELECT public.open_inventory_count(
          p_location_id => ${input.locationId ?? null}::uuid,
          p_ingredient_ids => ${itemIds === null ? null : sql.param(itemIds)}::uuid[],
          p_notes => ${input.notes ?? null}::text) AS result`),
    );
  }

  /** null clears the line (not counted yet). */
  async setCounted(countId: string, lineId: string, countedQuantity: number | null): Promise<CountLine> {
    await one(this.uow, sql`
      UPDATE public.inventory_count_lines SET counted_quantity = ${countedQuantity}
       WHERE id = ${lineId} AND count_id = ${countId}
      RETURNING id`, 'id', 'Inventory count line not found');
    return toCountLine(
      await one<Json>(this.uow, sql`
        SELECT ${lineJson} AS line
          FROM public.inventory_count_lines cl
          LEFT JOIN public.ingredients i ON i.id = cl.ingredient_id
         WHERE cl.id = ${lineId}`, 'line', 'Inventory count line not found'),
    );
  }

  async apply(id: string): Promise<ApplyCountResult> {
    return toApplyCountResult(await rpc(this.uow, sql`SELECT public.apply_inventory_count(${id}::uuid) AS result`));
  }

  /** open -> cancelled (the trigger refuses any other move). */
  async cancel(id: string): Promise<InventoryCount> {
    await one(this.uow, sql`UPDATE public.inventory_counts SET status = 'cancelled' WHERE id = ${id} RETURNING id`, 'id', NOT_FOUND);
    return toCount(
      await one<Json>(this.uow, sql`SELECT ${countJson} AS count FROM public.inventory_counts c WHERE c.id = ${id}`, 'count', NOT_FOUND),
    );
  }
}
