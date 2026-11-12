import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type {
  ApplyCountResult,
  CountLine,
  countLineSchema,
  InventoryCount,
  InventoryCountDetail,
  MyCount,
  MyCountDetail,
  MyCountLine,
  OpenCountResult,
  openCountSchema,
} from './inventory.dto';
import { definedColumns, one, rows, rpc, setList, trimmed } from './inventory-sql';
import { toApplyCountResult, toCount, toCountLine, toMyCount, toMyCountLine, toOpenCountResult } from './inventory.mappers';

type Json = Record<string, unknown>;

const NOT_FOUND = 'Inventory count not found';
const LINE_NOT_FOUND = 'Inventory count line not found';

const staffName = (column: string) =>
  sql`(SELECT p.full_name FROM public.profiles p WHERE p.id = ${sql.raw(`c.${column}`)})`;
const countJson = sql`to_jsonb(c) || jsonb_build_object(
  'location_name', (SELECT l.name FROM public.inventory_locations l WHERE l.id = c.location_id),
  'counter_name', ${staffName('counter_id')},
  'approver_name', ${staffName('approver_id')},
  'applied_by_name', ${staffName('applied_by')},
  'difference_value', (SELECT sum((cl.counted_quantity - cl.expected_quantity) * COALESCE(i.cost, 0))
                         FROM public.inventory_count_lines cl JOIN public.ingredients i ON i.id = cl.ingredient_id
                        WHERE cl.count_id = c.id AND cl.counted_quantity IS NOT NULL))`;
/** Valued difference in COP and whether it reaches private.inventory_count_reason_threshold(). */
const lineJson = sql`to_jsonb(cl) || jsonb_build_object('item_name', i.name, 'sku', i.sku, 'unit', i.unit,
  'difference', cl.counted_quantity - cl.expected_quantity,
  'difference_value', round((cl.counted_quantity - cl.expected_quantity) * COALESCE(i.cost, 0), 2),
  'reason_required', COALESCE(abs((cl.counted_quantity - cl.expected_quantity) * COALESCE(i.cost, 0))
                              >= private.inventory_count_reason_threshold(), false))`;

const byName = <T extends { itemName: string | null }>(a: T, b: T) => (a.itemName ?? '').localeCompare(b.itemName ?? '', 'es');

/**
 * Physical counts. Without a counter: `open_inventory_count` snapshots the
 * expected quantities, the admin sets `counted_quantity` per line (RLS + guard
 * trigger) and `apply_inventory_count` moves the balance to the counted one.
 * With a counter (S5): prepare (draft) -> start (counting) -> the counter counts
 * blind through the `my*` methods -> submit (review) -> recount or apply by an
 * admin who did not count. RLS keeps both tables admin only.
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

  /** Lines by item name (es collation); in review and applied by |differenceValue|, largest first. */
  async get(id: string): Promise<InventoryCountDetail> {
    const count = await this.read(id);
    const [{ threshold }] = await rows<{ threshold: string }>(this.uow, sql`
      SELECT private.inventory_count_reason_threshold() AS threshold`);
    const lines = (
      await rows<{ line: Json }>(this.uow, sql`
        SELECT ${lineJson} AS line
          FROM public.inventory_count_lines cl
          LEFT JOIN public.ingredients i ON i.id = cl.ingredient_id
         WHERE cl.count_id = ${id}`)
    ).map((row) => toCountLine(row.line));
    lines.sort(byName);
    if (count.stage === 'review' || count.stage === 'applied') {
      lines.sort((a, b) => Math.abs(b.differenceValue ?? 0) - Math.abs(a.differenceValue ?? 0));
    }
    return { ...count, reasonThreshold: Number(threshold), lines };
  }

  /** With counterId and approverId: prepare_inventory_count (draft); otherwise open_inventory_count (counting). */
  async open(input: z.infer<typeof openCountSchema>): Promise<OpenCountResult> {
    const itemIds = input.itemIds ?? null;
    const items = sql`${itemIds === null ? null : sql.param(itemIds)}::uuid[]`;
    if (input.counterId && input.approverId) {
      return toOpenCountResult(
        await rpc(this.uow, sql`
          SELECT public.prepare_inventory_count(
            p_location_id => ${input.locationId ?? null}::uuid,
            p_ingredient_ids => ${items},
            p_counter_id => ${input.counterId}::uuid,
            p_approver_id => ${input.approverId}::uuid,
            p_notes => ${input.notes ?? null}::text) AS result`),
      );
    }
    return toOpenCountResult(
      await rpc(this.uow, sql`
        SELECT public.open_inventory_count(
          p_location_id => ${input.locationId ?? null}::uuid,
          p_ingredient_ids => ${items},
          p_notes => ${input.notes ?? null}::text) AS result`),
    );
  }

  /** countedQuantity null clears the line; reason is the line notes (blank clears). */
  async setLine(countId: string, lineId: string, input: z.infer<typeof countLineSchema>): Promise<CountLine> {
    const reason = trimmed(input.reason);
    const pairs = definedColumns({ counted_quantity: input.countedQuantity, notes: reason === '' ? null : reason });
    await one(this.uow, sql`
      UPDATE public.inventory_count_lines SET ${setList(pairs)}
       WHERE id = ${lineId} AND count_id = ${countId}
      RETURNING id`, 'id', LINE_NOT_FOUND);
    return toCountLine(
      await one<Json>(this.uow, sql`
        SELECT ${lineJson} AS line
          FROM public.inventory_count_lines cl
          LEFT JOIN public.ingredients i ON i.id = cl.ingredient_id
         WHERE cl.id = ${lineId}`, 'line', LINE_NOT_FOUND),
    );
  }

  /** draft -> counting. */
  async start(id: string): Promise<InventoryCount> {
    await rpc(this.uow, sql`SELECT public.start_inventory_count(${id}::uuid) AS result`);
    return this.read(id);
  }

  /** counting -> review, by an admin. */
  async submit(id: string): Promise<InventoryCount> {
    await rpc(this.uow, sql`SELECT public.submit_inventory_count(${id}::uuid) AS result`);
    return this.read(id);
  }

  /** review -> counting for the given lines only. */
  async recount(id: string, lineIds: string[]): Promise<InventoryCount> {
    await rpc(this.uow, sql`SELECT public.request_inventory_count_recount(${id}::uuid, ${sql.param(lineIds)}::uuid[]) AS result`);
    return this.read(id);
  }

  async apply(id: string): Promise<ApplyCountResult> {
    return toApplyCountResult(await rpc(this.uow, sql`SELECT public.apply_inventory_count(${id}::uuid) AS result`));
  }

  /** draft | counting | review -> cancelled (the trigger refuses any other move). */
  async cancel(id: string): Promise<InventoryCount> {
    await one(this.uow, sql`UPDATE public.inventory_counts SET status = 'cancelled' WHERE id = ${id} RETURNING id`, 'id', NOT_FOUND);
    return this.read(id);
  }

  // ---- The assigned counter (blind: SECURITY DEFINER functions, no expected stock) ----

  async listMine(): Promise<MyCount[]> {
    const result = await rpc(this.uow, sql`SELECT public.list_my_inventory_counts() AS result`);
    return (result as unknown as Json[]).map(toMyCount);
  }

  async getMine(id: string): Promise<MyCountDetail> {
    const result = await rpc(this.uow, sql`SELECT public.get_my_inventory_count(${id}::uuid) AS result`);
    const lines = (result.lines as Json[]).map(toMyCountLine).sort(byName);
    return { ...toMyCount(result), lines };
  }

  async countMine(countId: string, lineId: string, countedQuantity: number | null): Promise<MyCountLine> {
    return toMyCountLine(
      await rpc(this.uow, sql`
        SELECT public.count_my_inventory_line(${countId}::uuid, ${lineId}::uuid, ${countedQuantity}::numeric) AS result`),
    );
  }

  async submitMine(id: string): Promise<MyCount> {
    const result = await rpc(this.uow, sql`SELECT public.submit_inventory_count(${id}::uuid) AS result`);
    return toMyCount(result.count as Json);
  }

  private async read(id: string): Promise<InventoryCount> {
    return toCount(
      await one<Json>(this.uow, sql`SELECT ${countJson} AS count FROM public.inventory_counts c WHERE c.id = ${id}`, 'count', NOT_FOUND),
    );
  }
}
