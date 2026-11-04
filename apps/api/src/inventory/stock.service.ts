import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type AdjustStockResult,
  type adjustStockSchema,
  type batchListQuerySchema,
  DEFAULT_MOVEMENTS_PAGE_SIZE,
  type Lot,
  type movementListQuerySchema,
  type MovementPage,
  type ProducePreparationResult,
  type producePreparationSchema,
  type ProductionBatch,
  type TransferStockResult,
  type transferStockSchema,
} from './inventory.dto';
import { rows, rpc } from './inventory-sql';
import { toAdjustResult, toBatch, toLot, toMovement, toProduceResult, toTransferResult } from './inventory.mappers';

type Json = Record<string, unknown>;

/** The movement's restaurant timezone, for bare-date bounds (T9 registers use the same column). */
const tz = sql`(SELECT r.timezone FROM public.restaurants r WHERE r.id = m.restaurant_id)`;
const isDate = (value: string) => !value.includes('T');

/**
 * Stock reads (lots, movement ledger, production batches) and the RPCs that
 * move stock: inventory_adjust, inventory_transfer, produce_preparation. RPC
 * arguments are the ones lib/supabase/inventory sent, optionals as NULL.
 */
@Injectable()
export class StockService {
  constructor(private readonly uow: UnitOfWork) {}

  /** FEFO: expires_on ASC NULLS LAST, then received_at. Empty lots included. */
  async listLots(itemId: string): Promise<Lot[]> {
    const result = await rows<{ lot: Json }>(this.uow, sql`
      SELECT to_jsonb(l) || jsonb_build_object('location_name', loc.name) AS lot
        FROM public.inventory_lots l
        LEFT JOIN public.inventory_locations loc ON loc.id = l.location_id
       WHERE l.ingredient_id = ${itemId}
       ORDER BY l.expires_on ASC NULLS LAST, l.received_at ASC, l.id`);
    return result.map((row) => toLot(row.lot));
  }

  /** Newest first, one page (1-based) plus the exact total for the filters. */
  async listMovements(query: z.infer<typeof movementListQuerySchema>): Promise<MovementPage> {
    const pageSize = query.pageSize ?? DEFAULT_MOVEMENTS_PAGE_SIZE;
    const offset = ((query.page ?? 1) - 1) * pageSize;
    const where: SQL[] = [];
    if (query.itemId) where.push(sql`m.ingredient_id = ${query.itemId}`);
    if (query.locationId) where.push(sql`m.location_id = ${query.locationId}`);
    if (query.types?.length) where.push(sql`m.movement_type = ANY(${sql.param(query.types)}::text[])`);
    // A bare date is a local day of the restaurant: half-open [from 00:00, to + 1 00:00).
    if (query.from) {
      where.push(
        isDate(query.from)
          ? sql`m.created_at >= (${query.from}::date::timestamp AT TIME ZONE ${tz})`
          : sql`m.created_at >= ${query.from}::timestamptz`,
      );
    }
    if (query.to) {
      where.push(
        isDate(query.to)
          ? sql`m.created_at < ((${query.to}::date + 1)::timestamp AT TIME ZONE ${tz})`
          : sql`m.created_at <= ${query.to}::timestamptz`,
      );
    }
    const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

    const [{ total }] = await rows<{ total: number }>(this.uow, sql`
      SELECT count(*)::int AS total FROM public.inventory_movements m ${filter}`);
    const page = await rows<{ movement: Json }>(this.uow, sql`
      SELECT to_jsonb(m) || jsonb_build_object('item_name', i.name, 'sku', i.sku, 'unit', i.unit,
                                               'location_name', loc.name) AS movement
        FROM public.inventory_movements m
        LEFT JOIN public.ingredients i ON i.id = m.ingredient_id
        LEFT JOIN public.inventory_locations loc ON loc.id = m.location_id
        ${filter}
       ORDER BY m.created_at DESC, m.id
       LIMIT ${pageSize} OFFSET ${offset}`);
    return { rows: page.map((row) => toMovement(row.movement)), total };
  }

  async adjust(input: z.infer<typeof adjustStockSchema>): Promise<AdjustStockResult> {
    return toAdjustResult(
      await rpc(this.uow, sql`
        SELECT public.inventory_adjust(
          p_ingredient_id => ${input.itemId}::uuid,
          p_location_id => ${input.locationId}::uuid,
          p_movement_type => ${input.movementType}::text,
          p_quantity => ${input.quantity}::numeric,
          p_unit_cost => ${input.unitCost ?? null}::numeric,
          p_reason => ${input.reason ?? null}::text,
          p_notes => ${input.notes ?? null}::text,
          p_lot_id => ${input.lotId ?? null}::uuid,
          p_lot_code => ${input.lotCode ?? null}::text,
          p_expires_on => ${input.expiresOn ?? null}::date) AS result`),
    );
  }

  async transfer(input: z.infer<typeof transferStockSchema>): Promise<TransferStockResult> {
    return toTransferResult(
      await rpc(this.uow, sql`
        SELECT public.inventory_transfer(
          p_ingredient_id => ${input.itemId}::uuid,
          p_from_location_id => ${input.fromLocationId}::uuid,
          p_to_location_id => ${input.toLocationId}::uuid,
          p_quantity => ${input.quantity}::numeric,
          p_notes => ${input.notes ?? null}::text) AS result`),
    );
  }

  /** Newest first, at most `limit` (default 100), optionally for one preparation. */
  async listBatches(query: z.infer<typeof batchListQuerySchema>): Promise<ProductionBatch[]> {
    const filter = query.itemId ? sql`WHERE b.ingredient_id = ${query.itemId}` : sql``;
    const result = await rows<{ batch: Json }>(this.uow, sql`
      SELECT to_jsonb(b) || jsonb_build_object('item_name', i.name, 'unit', i.unit, 'location_name', loc.name,
                                               'lot_code', lot.lot_code) AS batch
        FROM public.production_batches b
        LEFT JOIN public.ingredients i ON i.id = b.ingredient_id
        LEFT JOIN public.inventory_locations loc ON loc.id = b.location_id
        LEFT JOIN public.inventory_lots lot ON lot.id = b.lot_id
        ${filter}
       ORDER BY b.created_at DESC, b.id
       LIMIT ${query.limit ?? 100}`);
    return result.map((row) => toBatch(row.batch));
  }

  /** Insufficient stock rejects with P0001 whose `details` lists the shortages (passed through by the error filter). */
  async produce(input: z.infer<typeof producePreparationSchema>): Promise<ProducePreparationResult> {
    return toProduceResult(
      await rpc(this.uow, sql`
        SELECT public.produce_preparation(
          p_ingredient_id => ${input.itemId}::uuid,
          p_quantity => ${input.quantity}::numeric,
          p_location_id => ${input.locationId ?? null}::uuid,
          p_lot_code => ${input.lotCode ?? null}::text,
          p_notes => ${input.notes ?? null}::text) AS result`),
    );
  }
}
