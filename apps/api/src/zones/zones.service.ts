import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { type createZoneSchema, type updateZoneSchema, type Zone, ZONE_MESSAGES } from './zones.dto';

interface ZoneRow {
  id: string;
  name: string;
  aspect: number;
  sort_order: number;
  labels: Zone['labels'];
  active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

const toZone = (row: ZoneRow): Zone => ({
  id: row.id,
  name: row.name,
  aspect: row.aspect,
  sortOrder: row.sort_order,
  labels: row.labels,
  active: row.active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Floors of the caller's restaurant (floor plan, T4); RLS scopes every statement. */
@Injectable()
export class ZonesService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(includeInactive: boolean): Promise<Zone[]> {
    const where = includeInactive ? sql`` : sql`WHERE active`;
    return (await this.select(sql`${where} ORDER BY sort_order, lower(name), id`)).map(toZone);
  }

  async create(input: z.infer<typeof createZoneSchema>): Promise<Zone> {
    const [row] = await this.write(sql`
      INSERT INTO public.zones (name, aspect, sort_order, labels, active)
      VALUES (${input.name}, ${input.aspect ?? 1.6}, ${input.sortOrder ?? 0},
              ${JSON.stringify(input.labels ?? [])}::jsonb, ${input.active ?? true})
      RETURNING id`);
    return this.get(row.id);
  }

  async update(id: string, input: z.infer<typeof updateZoneSchema>): Promise<Zone> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
    if (input.aspect !== undefined) sets.push(sql`aspect = ${input.aspect}`);
    if (input.sortOrder !== undefined) sets.push(sql`sort_order = ${input.sortOrder}`);
    if (input.labels !== undefined) sets.push(sql`labels = ${JSON.stringify(input.labels)}::jsonb`);
    if (input.active !== undefined) sets.push(sql`active = ${input.active}`);
    const [row] = await this.write(sql`UPDATE public.zones SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING id`);
    if (!row) {
      throw new NotFoundException('Zone not found');
    }
    return this.get(id);
  }

  /** 409 while a table still sits on the zone (the foreign key is ON DELETE RESTRICT too). */
  async remove(id: string): Promise<void> {
    const [zone] = await this.rows(sql`SELECT 1 FROM public.zones WHERE id = ${id} FOR UPDATE`);
    if (!zone) {
      throw new NotFoundException('Zone not found');
    }
    const [table] = await this.rows(sql`SELECT 1 FROM public.tables WHERE zone_id = ${id} LIMIT 1`);
    if (table) {
      throw new ConflictException(ZONE_MESSAGES.hasTables);
    }
    await this.uow.db.execute(sql`DELETE FROM public.zones WHERE id = ${id}`);
  }

  private async get(id: string): Promise<Zone> {
    const [row] = await this.select(sql`WHERE id = ${id}`);
    if (!row) {
      throw new NotFoundException('Zone not found');
    }
    return toZone(row);
  }

  private select(tail: SQL): Promise<ZoneRow[]> {
    return this.rows<ZoneRow>(sql`
      SELECT id, name, aspect::float8 AS aspect, sort_order, labels, active, created_at, updated_at
        FROM public.zones
       ${tail}`);
  }

  /** A duplicate name (zones_restaurant_id_name_key) is a 409 in Spanish like the other zone messages. */
  private async write(query: SQL): Promise<{ id: string }[]> {
    try {
      return await this.rows<{ id: string }>(query);
    } catch (error) {
      throw violates(error, 'zones_restaurant_id_name_key') ? new ConflictException(ZONE_MESSAGES.duplicateName) : error;
    }
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}

/** A unique violation of `constraint`; Drizzle wraps the `pg` error as `cause`. */
function violates(error: unknown, constraint: string): boolean {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const pg = current as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505') {
      return pg.constraint === constraint;
    }
    current = current.cause;
  }
  return false;
}
