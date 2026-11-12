import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { InventoryTransfer, receiveTransferSchema, transferListQuerySchema, transferSchema } from './inventory.dto';
import { one, rows, rpc } from './inventory-sql';
import { toTransfer } from './inventory.mappers';

type Json = Record<string, unknown>;

const NOT_FOUND = 'Inventory transfer not found';

/** One transfer with its location and staff names and its lines by item name, for a FROM with `public.inventory_transfers t`. */
const transferJson = sql`
  to_jsonb(t) || jsonb_build_object(
    'from_location_name', (SELECT l.name FROM public.inventory_locations l WHERE l.id = t.from_location_id),
    'to_location_name', (SELECT l.name FROM public.inventory_locations l WHERE l.id = t.to_location_id),
    'created_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = t.created_by),
    'sent_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = t.sent_by),
    'received_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = t.received_by),
    'cancelled_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = t.cancelled_by),
    'lines', coalesce((
      SELECT jsonb_agg(to_jsonb(tl) || jsonb_build_object('item_name', i.name, 'unit', i.unit, 'sku', i.sku)
                       ORDER BY i.name, tl.id)
        FROM public.inventory_transfer_lines tl
        LEFT JOIN public.ingredients i ON i.id = tl.ingredient_id
       WHERE tl.transfer_id = t.id), '[]'::jsonb))`;

/** The transfer's restaurant timezone, for the bare-date bounds. */
const tz = sql`(SELECT r.timezone FROM public.restaurants r WHERE r.id = t.restaurant_id)`;

const linesJson = (lines: { itemId: string; quantity: number }[]) =>
  JSON.stringify(lines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })));

/**
 * Transfer documents (S3). Every write is one RPC (create / update_ / send_ /
 * receive_ / cancel_inventory_transfer) in the request transaction; the stock
 * a send takes sits in `inventory_transit_lots` until it is received or
 * cancelled, so it is never available or counted. Each write answers the
 * transfer as GET /:id does.
 */
@Injectable()
export class TransfersService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first; `locationId` matches the origin or the destination, dates are local days of the restaurant. */
  async list(query: z.infer<typeof transferListQuerySchema>): Promise<InventoryTransfer[]> {
    const where: SQL[] = [];
    if (query.status?.length) where.push(sql`t.status = ANY(${sql.param(query.status)}::text[])`);
    if (query.locationId) where.push(sql`(t.from_location_id = ${query.locationId} OR t.to_location_id = ${query.locationId})`);
    if (query.from) where.push(sql`t.created_at >= (${query.from}::date::timestamp AT TIME ZONE ${tz})`);
    if (query.to) where.push(sql`t.created_at < ((${query.to}::date + 1)::timestamp AT TIME ZONE ${tz})`);
    const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const result = await rows<{ transfer: Json }>(this.uow, sql`
      SELECT ${transferJson} AS transfer FROM public.inventory_transfers t ${filter} ORDER BY t.number DESC`);
    return result.map((row) => toTransfer(row.transfer));
  }

  async get(id: string): Promise<InventoryTransfer> {
    return toTransfer(
      await one<Json>(this.uow, sql`SELECT ${transferJson} AS transfer FROM public.inventory_transfers t WHERE t.id = ${id}`, 'transfer', NOT_FOUND),
    );
  }

  async create(input: z.infer<typeof transferSchema>): Promise<InventoryTransfer> {
    const result = await rpc(this.uow, sql`
      SELECT public.create_inventory_transfer(
        p_from_location_id => ${input.fromLocationId}::uuid,
        p_to_location_id => ${input.toLocationId}::uuid,
        p_lines => ${linesJson(input.lines)}::jsonb,
        p_notes => ${input.notes ?? null}::text) AS result`);
    return this.get(String(result.transfer_id));
  }

  /** Drafts only (422 P0001 otherwise): header and lines replaced. */
  async update(id: string, input: z.infer<typeof transferSchema>): Promise<InventoryTransfer> {
    await rpc(this.uow, sql`
      SELECT public.update_inventory_transfer(
        p_transfer_id => ${id}::uuid,
        p_from_location_id => ${input.fromLocationId}::uuid,
        p_to_location_id => ${input.toLocationId}::uuid,
        p_lines => ${linesJson(input.lines)}::jsonb,
        p_notes => ${input.notes ?? null}::text) AS result`);
    return this.get(id);
  }

  async send(id: string): Promise<InventoryTransfer> {
    await rpc(this.uow, sql`SELECT public.send_inventory_transfer(${id}::uuid) AS result`);
    return this.get(id);
  }

  /** Idempotent: an already received transfer is answered as stored. */
  async receive(id: string, input: z.infer<typeof receiveTransferSchema>): Promise<InventoryTransfer> {
    const lines = input.lines.map((line) => ({
      line_id: line.lineId,
      received_quantity: line.receivedQuantity,
      shortfall_reason: line.shortfallReason ?? null,
    }));
    await rpc(this.uow, sql`
      SELECT public.receive_inventory_transfer(${id}::uuid, ${JSON.stringify(lines)}::jsonb) AS result`);
    return this.get(id);
  }

  async cancel(id: string): Promise<InventoryTransfer> {
    await rpc(this.uow, sql`SELECT public.cancel_inventory_transfer(${id}::uuid) AS result`);
    return this.get(id);
  }
}
