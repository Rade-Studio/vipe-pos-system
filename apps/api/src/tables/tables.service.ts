import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type createTableSchema,
  type Table,
  UNRELEASABLE_STATUSES,
  type updateTableSchema,
  type Waiter,
} from './tables.dto';

interface TableRow {
  id: string;
  number: number;
  status: string;
  waiter_id: string | null;
  waiter_name: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

/** timestamptz from a raw query: a Date or Postgres text depending on the driver's type parsers. */
const iso = (value: Date | string | null) => (value instanceof Date ? value.toISOString() : toIso(value));

const toTable = (row: TableRow): Table => ({
  id: row.id,
  number: row.number,
  status: row.status,
  waiterId: row.waiter_id,
  waiterName: row.waiter_name,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/**
 * Tables of the caller's restaurant; RLS scopes every statement. Every write
 * sets updated_at with the server clock (clients never send timestamps).
 */
@Injectable()
export class TablesService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<Table[]> {
    return (await this.select(sql`ORDER BY t.number, t.id`)).map(toTable);
  }

  async create(input: z.infer<typeof createTableSchema>): Promise<Table> {
    const [row] = await this.rows<{ id: string }>(sql`
      INSERT INTO public.tables (number, status) VALUES (${input.number}, ${input.status ?? 'available'}) RETURNING id`);
    return this.get(row.id);
  }

  async update(id: string, input: z.infer<typeof updateTableSchema>): Promise<Table> {
    await this.lock(id);
    if (input.waiterId) {
      await this.assertWaiter(input.waiterId);
    }
    // Like tableService.updateTableStatus: making a table available clears its waiter.
    const waiterId = input.waiterId !== undefined ? input.waiterId : input.status === 'available' ? null : undefined;
    const sets: SQL[] = [sql`updated_at = now()`];
    if (input.number !== undefined) sets.push(sql`number = ${input.number}`);
    if (input.status !== undefined) sets.push(sql`status = ${input.status}`);
    if (waiterId !== undefined) sets.push(sql`waiter_id = ${waiterId}`);
    await this.uow.db.execute(sql`UPDATE public.tables SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    return this.get(id);
  }

  /** 409 while any order of the table is not paid (was a client-side check in tableService.delete). */
  async remove(id: string): Promise<void> {
    await this.lock(id);
    const [open] = await this.rows(sql`
      SELECT 1 FROM public.orders WHERE table_id = ${id} AND status <> 'paid' LIMIT 1`);
    if (open) {
      throw new ConflictException('Table has open orders');
    }
    await this.uow.db.execute(sql`DELETE FROM public.tables WHERE id = ${id}`);
  }

  async assign(id: string, waiterId: string): Promise<Table> {
    await this.lock(id);
    await this.assertWaiter(waiterId);
    await this.uow.db.execute(sql`
      UPDATE public.tables SET waiter_id = ${waiterId}, status = 'occupied', updated_at = now() WHERE id = ${id}`);
    return this.get(id);
  }

  /** Release guard of WaiterView, now on the server; only an admin may force it. */
  async release(id: string, force: boolean, callerRole: string): Promise<Table> {
    const table = await this.lock(id);
    if (UNRELEASABLE_STATUSES.includes(table.status) && !(force && callerRole === 'admin')) {
      throw new ConflictException(`Table cannot be released while ${table.status}`);
    }
    await this.uow.db.execute(sql`
      UPDATE public.tables SET waiter_id = NULL, status = 'available', updated_at = now() WHERE id = ${id}`);
    return this.get(id);
  }

  /** Active waiters of the restaurant, by name (hooks/use-waiters, the portal). */
  async waiters(): Promise<Waiter[]> {
    return this.rows<Waiter>(sql`
      SELECT id, full_name AS name, username FROM public.profiles
       WHERE role = 'waiter' AND active ORDER BY full_name, id`);
  }

  private async get(id: string): Promise<Table> {
    const [row] = await this.select(sql`WHERE t.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Table not found');
    }
    return toTable(row);
  }

  private async lock(id: string): Promise<{ status: string }> {
    const [table] = await this.rows<{ status: string }>(sql`SELECT status FROM public.tables WHERE id = ${id} FOR UPDATE`);
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    return table;
  }

  /** The foreign key would accept another restaurant's profile; RLS on this SELECT does not. */
  private async assertWaiter(id: string): Promise<void> {
    const [profile] = await this.rows(sql`
      SELECT 1 FROM public.profiles WHERE id = ${id} AND active AND role IN ('waiter', 'admin')`);
    if (!profile) {
      throw new UnprocessableEntityException('Unknown waiter');
    }
  }

  private select(tail: SQL): Promise<TableRow[]> {
    return this.rows<TableRow>(sql`
      SELECT t.id, t.number, t.status, t.waiter_id, p.full_name AS waiter_name, t.created_at, t.updated_at
        FROM public.tables t
        LEFT JOIN public.profiles p ON p.id = t.waiter_id
       ${tail}`);
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}
