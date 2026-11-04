import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import type { CashRegister, CashTransaction, CloseRegisterResult, createCashTransactionSchema, RegisterSummary } from './registers.dto';
import { type RegisterRow, toCashTransaction, toCloseResult, toRegister, toRegisterSummary } from './registers.mappers';

type Json = Record<string, unknown>;
export const ALREADY_OPEN = 'A register is already open';
const ONE_OPEN_INDEX = 'one_open_register_per_restaurant';

export interface RegisterIncludes {
  transactions?: boolean;
  cashTransactions?: boolean;
}

/**
 * Cash registers of the caller's restaurant. Timestamps come from the
 * database clock; totals and the close come only from register_summary and
 * close_register. Every method runs in the request transaction.
 */
@Injectable()
export class RegistersService {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Every register, or those opened on `date` (YYYY-MM-DD) in the restaurant's
   * timezone column: the day bounds are local midnights converted with AT TIME ZONE.
   */
  async list(filter: { date?: string } & RegisterIncludes): Promise<CashRegister[]> {
    const where = filter.date
      ? sql`WHERE cr.opening_timestamp >= (${filter.date}::date::timestamp AT TIME ZONE r.timezone)
           AND cr.opening_timestamp < ((${filter.date}::date + 1)::timestamp AT TIME ZONE r.timezone)`
      : sql``;
    return (await this.select(where, filter)).map(toRegister);
  }

  async get(id: string, include: RegisterIncludes = {}): Promise<CashRegister> {
    const [row] = await this.select(sql`WHERE cr.id = ${id}`, include);
    if (!row) {
      throw new NotFoundException('Register not found');
    }
    return toRegister(row);
  }

  /** The open register (one per restaurant, unique index), or null. */
  async current(include: RegisterIncludes = {}): Promise<CashRegister | null> {
    const [row] = await this.select(sql`WHERE cr.status = 'open'`, include);
    return row ? toRegister(row) : null;
  }

  /** opening_timestamp is the database clock; a second open register is 409 (pre-check, then the index on a race). */
  async open(initialCash: number): Promise<CashRegister> {
    const [open] = await this.rows(sql`SELECT 1 FROM public.cash_registers WHERE status = 'open' LIMIT 1`);
    if (open) {
      throw new ConflictException(ALREADY_OPEN);
    }
    try {
      const [row] = await this.rows<{ id: string }>(sql`
        INSERT INTO public.cash_registers (opening_timestamp, initial_cash, status)
        VALUES (now(), ${initialCash}, 'open') RETURNING id`);
      return this.get(row.id);
    } catch (error) {
      if (violates(error, ONE_OPEN_INDEX)) {
        throw new ConflictException(ALREADY_OPEN);
      }
      throw error;
    }
  }

  /**
   * close_register, unchanged. Its first close does not return the
   * closing_timestamp it wrote (only the replay does), so it is read back from
   * the row in the same transaction.
   */
  async close(id: string): Promise<CloseRegisterResult> {
    const [{ result }] = await this.rows<{ result: Json }>(sql`SELECT public.close_register(${id}::uuid) AS result`);
    let closing = result.closing_timestamp as string | null | undefined;
    if (!closing) {
      const [row] = await this.rows<{ closing_timestamp: string }>(sql`
        SELECT closing_timestamp::text FROM public.cash_registers WHERE id = ${id}`);
      closing = row.closing_timestamp;
    }
    return toCloseResult(result, toIso(String(closing)));
  }

  async summary(ids: string[]): Promise<RegisterSummary> {
    const [{ result }] = await this.rows<{ result: Json }>(sql`
      SELECT public.register_summary(${sql.param(ids)}::uuid[]) AS result`);
    return toRegisterSummary(result);
  }

  /**
   * A deposit or withdrawal stamped with the database clock. The register is
   * read FOR SHARE (as pay_order does) so a concurrent close_register waits,
   * and a closed register refuses new movements.
   */
  async addCashTransaction(registerId: string, input: z.infer<typeof createCashTransactionSchema>): Promise<CashTransaction> {
    const [register] = await this.rows<{ status: string }>(sql`
      SELECT status FROM public.cash_registers WHERE id = ${registerId} FOR SHARE`);
    if (!register) {
      throw new NotFoundException('Register not found');
    }
    if (register.status !== 'open') {
      throw new ConflictException('Register is closed');
    }
    const [row] = await this.rows<{ tx: Json }>(sql`
      INSERT INTO public.cash_transactions (amount, type, description, cash_register_id)
      VALUES (${input.amount}, ${input.type}, ${input.description ?? ''}, ${registerId})
      RETURNING to_jsonb(cash_transactions.*) AS tx`);
    return toCashTransaction(row.tx);
  }

  async listCashTransactions(registerId: string): Promise<CashTransaction[]> {
    return (await this.get(registerId, { cashTransactions: true })).cashTransactions ?? [];
  }

  /** Registers (newest opening first) with the requested embeds, one query; restaurants joins the timezone. */
  private select(where: SQL, include: RegisterIncludes): Promise<RegisterRow[]> {
    const transactions = include.transactions
      ? sql`coalesce((SELECT jsonb_agg(to_jsonb(pt) ORDER BY pt.timestamp DESC, pt.id)
                        FROM public.payment_transactions pt WHERE pt.cash_register_id = cr.id), '[]'::jsonb)`
      : sql`NULL::jsonb`;
    const cash = include.cashTransactions
      ? sql`coalesce((SELECT jsonb_agg(to_jsonb(ct) ORDER BY ct.timestamp DESC, ct.id)
                        FROM public.cash_transactions ct WHERE ct.cash_register_id = cr.id), '[]'::jsonb)`
      : sql`NULL::jsonb`;
    return this.rows<RegisterRow>(sql`
      SELECT to_jsonb(cr) AS register, ${transactions} AS transactions, ${cash} AS cash_transactions
        FROM public.cash_registers cr
        JOIN public.restaurants r ON r.id = cr.restaurant_id
       ${where}
       ORDER BY cr.opening_timestamp DESC, cr.id`);
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
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
