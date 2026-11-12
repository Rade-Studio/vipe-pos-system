import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type CashRegister,
  type CashTransaction,
  type CloseRegisterInput,
  type CloseRegisterResult,
  type createCashTransactionSchema,
  PAID_ORDERS_DEFAULT,
  type RegisterPaidOrder,
  type RegisterSummary,
} from './registers.dto';
import {
  type RegisterRow,
  toCashTransaction,
  toCloseResult,
  toPaidOrder,
  toRegister,
  toRegisterCount,
  toRegisterSummary,
} from './registers.mappers';

type Json = Record<string, unknown>;
export const ALREADY_OPEN = 'A register is already open';
const ONE_OPEN_INDEX = 'one_open_register_per_restaurant';
const OPEN_ORDER_STATUSES = sql`('active', 'kitchen', 'delivered')`;

export const openOrdersMessage = (count: number): string =>
  count === 1
    ? 'Hay 1 orden abierta. Cóbrala o cancélala, o confirma que pasa a la siguiente caja.'
    : `Hay ${count} órdenes abiertas. Cóbralas o cancélalas, o confirma que pasan a la siguiente caja.`;

export const CLOSE_MESSAGES = {
  countedCashRequired: 'Ingresa el efectivo contado para cerrar la caja.',
  countMismatch: 'La suma de billetes y monedas no coincide con el efectivo contado.',
  noteRequired: 'El contado no cuadra con lo esperado: escribe una nota de 3 a 300 caracteres.',
  descriptionRequired: 'Describe el motivo del movimiento.',
} as const;

const unprocessable = (message: string, code: string) => new UnprocessableEntityException({ message, code });

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

  /**
   * opening_timestamp is the database clock and opened_by is left to its
   * column default (the caller's profile, migration 0014); a second
   * open register is 409 (pre-check, then the index on a race).
   */
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
   * close_register, gated: while the register is still open and the
   * restaurant (RLS) has open orders, the close is 409 open_orders unless
   * `leaveOpenOrders` confirms they pass to the next register. A closed or
   * unknown register goes straight to close_register (replay, 404) and keeps
   * its stored count. On an open register (locked FOR UPDATE first) the count
   * is required (422 counted_cash_required) and its denominations must add
   * up (422 count_mismatch); after close_register the difference against its
   * final_cash (expected after tips at the lock) needs a note (422
   * note_required, which rolls the close back), then the count and closed_by
   * (the caller's profile) are written in the same transaction. The
   * closing_timestamp and the count are read back from the row.
   */
  async close(id: string, options: CloseRegisterInput = {}): Promise<CloseRegisterResult> {
    if (!options.leaveOpenOrders) {
      const [{ count }] = await this.rows<{ count: number }>(sql`
        SELECT count(*)::int AS count FROM public.orders
         WHERE status IN ${OPEN_ORDER_STATUSES}
           AND EXISTS (SELECT 1 FROM public.cash_registers WHERE id = ${id} AND status = 'open')`);
      if (count > 0) {
        throw new ConflictException({ message: openOrdersMessage(count), code: 'open_orders', count });
      }
    }
    const [register] = await this.rows<{ status: string }>(sql`
      SELECT status FROM public.cash_registers WHERE id = ${id} FOR UPDATE`);
    const counted = options.countedCash;
    if (register?.status === 'open') {
      if (counted === undefined) {
        throw unprocessable(CLOSE_MESSAGES.countedCashRequired, 'counted_cash_required');
      }
      if (options.denominations && options.denominations.reduce((sum, d) => sum + d.value * d.quantity, 0) !== counted) {
        throw unprocessable(CLOSE_MESSAGES.countMismatch, 'count_mismatch');
      }
    }
    const [{ result }] = await this.rows<{ result: Json }>(sql`SELECT public.close_register(${id}::uuid) AS result`);
    if (result.status === 'closed' && counted !== undefined) {
      const difference = counted - Number(result.final_cash);
      const note = options.note ?? null;
      if (difference !== 0 && !note) {
        throw unprocessable(CLOSE_MESSAGES.noteRequired, 'note_required');
      }
      const denominations = options.denominations ? JSON.stringify(options.denominations) : null;
      await this.rows(sql`
        UPDATE public.cash_registers
           SET counted_cash = ${counted}, cash_difference = ${difference}, close_note = ${note},
               denominations = ${denominations}::jsonb, closed_by = private.current_profile_id()
         WHERE id = ${id}`);
    }
    const [row] = await this.rows<{ register: Json; closed_by_name: string | null }>(sql`
      SELECT to_jsonb(cr) AS register, cb.full_name AS closed_by_name
        FROM public.cash_registers cr
        LEFT JOIN public.profiles cb ON cb.id = cr.closed_by
       WHERE cr.id = ${id}`);
    const closing = (result.closing_timestamp as string | null | undefined) ?? String(row.register.closing_timestamp);
    return toCloseResult(result, toIso(closing), toRegisterCount(row.register, row.closed_by_name));
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
    const description = input.description ?? '';
    if (input.reason === 'other' && !description) {
      throw unprocessable(CLOSE_MESSAGES.descriptionRequired, 'description_required');
    }
    // created_by is left to its column default: the caller's profile (migration 0025).
    const [row] = await this.rows<{ tx: Json }>(sql`
      WITH tx AS (
        INSERT INTO public.cash_transactions (amount, type, reason, description, cash_register_id)
        VALUES (${input.amount}, ${input.type}, ${input.reason}, ${description}, ${registerId})
        RETURNING *)
      SELECT to_jsonb(tx) || jsonb_build_object('created_by_name', p.full_name) AS tx
        FROM tx LEFT JOIN public.profiles p ON p.id = tx.created_by`);
    return toCashTransaction(row.tx);
  }

  /**
   * The pay_order payments taken on the register, newest first, each with its
   * order (number, type, table, zone, waiter) and tenders. RLS scopes every
   * table to the caller's restaurant; an invisible register is 404.
   */
  async paidOrders(registerId: string, limit = PAID_ORDERS_DEFAULT): Promise<RegisterPaidOrder[]> {
    const [register] = await this.rows(sql`SELECT 1 FROM public.cash_registers WHERE id = ${registerId}`);
    if (!register) {
      throw new NotFoundException('Register not found');
    }
    const rows = await this.rows<{ row: Json }>(sql`
      SELECT jsonb_build_object(
               'order_id', o.id, 'order_number', o.order_number, 'order_type', o.order_type,
               'table_number', t.number, 'zone_name', z.name, 'waiter_id', w.id, 'waiter_name', w.full_name,
               'payment_id', p.id, 'amount_due', p.amount_due, 'tip_amount', p.tip_amount,
               'total_charged', p.total_charged, 'paid_at', p.created_at,
               'tenders', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'method_code', pt.method_code, 'method_name', coalesce(m.name, pt.method_code),
                          'method_kind', pt.method_kind, 'amount', pt.amount, 'reference', pt.reference)
                          ORDER BY pt.line_no)
                   FROM public.payment_tenders pt
                   LEFT JOIN public.payment_methods m ON m.id = pt.payment_method_id
                  WHERE pt.payment_id = p.id), '[]'::jsonb)) AS row
        FROM public.payments p
        JOIN public.orders o ON o.id = p.order_id
        LEFT JOIN public.tables t ON t.id = o.table_id
        LEFT JOIN public.zones z ON z.id = t.zone_id
        LEFT JOIN public.profiles w ON w.id = o.waiter_id
       WHERE p.cash_register_id = ${registerId}
       ORDER BY p.created_at DESC, p.id
       LIMIT ${limit}`);
    return rows.map(({ row }) => toPaidOrder(row));
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
      ? sql`coalesce((SELECT jsonb_agg(to_jsonb(ct) || jsonb_build_object('created_by_name', cp.full_name) ORDER BY ct.timestamp DESC, ct.id)
                        FROM public.cash_transactions ct
                        LEFT JOIN public.profiles cp ON cp.id = ct.created_by
                       WHERE ct.cash_register_id = cr.id), '[]'::jsonb)`
      : sql`NULL::jsonb`;
    return this.rows<RegisterRow>(sql`
      SELECT to_jsonb(cr) AS register, op.full_name AS opened_by_name, cb.full_name AS closed_by_name,
             ${transactions} AS transactions, ${cash} AS cash_transactions
        FROM public.cash_registers cr
        JOIN public.restaurants r ON r.id = cr.restaurant_id
        LEFT JOIN public.profiles op ON op.id = cr.opened_by
        LEFT JOIN public.profiles cb ON cb.id = cr.closed_by
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
