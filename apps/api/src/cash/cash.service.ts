import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import type { PaymentMethodKind } from '../payments/payments.dto';
import type { RegisterSummary } from '../registers/registers.dto';
import { profileRef } from '../registers/registers.mappers';
import { RegistersService } from '../registers/registers.service';
import { ConfigService } from '../settings/config.service';
import {
  type CashDay,
  type CashDayRegister,
  type CashMethodTotal,
  type CashVoidItem,
  type CashWaiterTips,
  type VoidKind,
} from './cash.dto';

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const time = (value: unknown) => toIso(text(value));
const avg = (sales: number, tickets: number) => (tickets > 0 ? Math.round(sales / tickets) : 0);

/** YYYY-MM-DD plus `days` (calendar arithmetic in UTC). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
interface Catalog {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
}

/**
 * The admin's cash figures (S5, S6): the business day. A register belongs to the business day
 * date((opening_timestamp AT TIME ZONE restaurants.timezone) - cut-off hours)
 * (businessDayCutoffHour, default 4); its payments, movements and payment
 * voids follow it. Cancellations and line voids, which have no register,
 * belong to the business day of their own time. Sales are the amount due of
 * the live payments (tips apart, voided payments excluded, as in
 * register_summary). RLS scopes every read to the caller's restaurant.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly registers: RegistersService,
  ) {}

  async day(date: string): Promise<CashDay> {
    const cutoff = await this.cutoff();
    const scope = this.scope(date, date, cutoff);
    const regs = await this.rows(sql`
      WITH ${scope}
      SELECT to_jsonb(r) AS register, op.full_name AS opened_by_name, cb.full_name AS closed_by_name, vb.full_name AS validated_by_name
        FROM regs r
        LEFT JOIN public.profiles op ON op.id = r.opened_by
        LEFT JOIN public.profiles cb ON cb.id = r.closed_by
        LEFT JOIN public.profiles vb ON vb.id = r.validated_by
       ORDER BY r.opening_timestamp, r.id`);
    const catalog = await this.catalog();
    const registers: CashDayRegister[] = [];
    for (const row of regs) {
      const r = row.register as Json;
      const summary = await this.registers.summary([String(r.id)]);
      registers.push({
        id: String(r.id),
        status: r.status as CashDayRegister['status'],
        openedAt: time(r.opening_timestamp)!,
        closedAt: time(r.closing_timestamp),
        openedBy: profileRef(r.opened_by, row.opened_by_name),
        closedBy: profileRef(r.closed_by, row.closed_by_name),
        validatedBy: profileRef(r.validated_by, row.validated_by_name),
        validatedAt: time(r.validated_at),
        initialCash: summary.initialCash,
        salesNet: summary.totalBilled,
        tickets: summary.paymentsCount,
        tips: summary.totalTips,
        methods: summaryMethods(summary),
        deposits: summary.cashDeposits,
        withdrawals: summary.cashWithdrawals,
        tipsPayout: summary.tipsPayout,
        expected: summary.expectedCashAfterTips,
        countedCash: numOrNull(r.counted_cash),
        cashDifference: numOrNull(r.cash_difference),
        closeNote: text(r.close_note),
      });
    }
    const [extra] = await this.rows(sql`
      WITH ${scope}
      SELECT count(DISTINCT o.table_id) FILTER (WHERE o.order_type = 'dine_in') AS tables,
             count(*) FILTER (WHERE o.order_type = 'delivery') AS deliveries,
             coalesce(sum(p.amount_due) FILTER (WHERE o.order_type = 'delivery'), 0) AS delivery_amount
        FROM pays p JOIN public.orders o ON o.id = p.order_id`);
    const salesNet = sumOf(registers, 'salesNet');
    const tickets = sumOf(registers, 'tickets');
    const voids = await this.voids(scope);
    const previous = addDays(date, -7);
    const [prev] = await this.rows(sql`WITH ${this.scope(previous, previous, cutoff)} SELECT coalesce(sum(amount_due), 0) AS sales FROM pays`);
    return {
      date,
      status: registers.length === 0 ? 'empty' : registers.some((reg) => reg.status === 'open') ? 'open' : 'closed',
      registers,
      totals: {
        salesNet,
        tickets,
        avgTicket: avg(salesNet, tickets),
        tables: num(extra.tables),
        deliveries: { count: num(extra.deliveries), amount: num(extra.delivery_amount) },
        tips: sumOf(registers, 'tips'),
        methods: mergeMethods(catalog, registers.map((reg) => reg.methods)),
        deposits: sumOf(registers, 'deposits'),
        withdrawals: sumOf(registers, 'withdrawals'),
        expected: sumOf(registers, 'expected'),
        counted: registers.reduce((sum, reg) => sum + (reg.countedCash ?? 0), 0),
        difference: registers.reduce((sum, reg) => sum + (reg.cashDifference ?? 0), 0),
      },
      tipsByWaiter: await this.tipsByWaiter(scope),
      voids: { count: voids.length, amount: voids.reduce((sum, item) => sum + item.amount, 0), items: voids },
      previous: { date: previous, salesNet: num(prev.sales) },
    };
  }

  private async cutoff(): Promise<number> {
    return (await this.config.get()).businessDayCutoffHour;
  }

  /**
   * CTEs over the business days from..to: bounds (timezone, cut-off, the
   * [lo, hi) instants), regs (their registers, with `day`) and pays (the
   * live payments of those registers).
   */
  private scope(from: string, to: string, cutoff: number): SQL {
    return sql`
      bounds AS (
        SELECT r.timezone AS tz, make_interval(hours => ${cutoff}::int) AS cut,
               (${from}::date::timestamp + make_interval(hours => ${cutoff}::int)) AT TIME ZONE r.timezone AS lo,
               ((${to}::date + 1)::timestamp + make_interval(hours => ${cutoff}::int)) AT TIME ZONE r.timezone AS hi
          FROM public.restaurants r WHERE r.id = private.current_restaurant_id()),
      regs AS (
        SELECT cr.*, to_char(((cr.opening_timestamp AT TIME ZONE b.tz) - b.cut)::date, 'YYYY-MM-DD') AS day
          FROM public.cash_registers cr, bounds b
         WHERE cr.opening_timestamp >= b.lo AND cr.opening_timestamp < b.hi),
      pays AS (
        SELECT p.*, r.day FROM public.payments p JOIN regs r ON r.id = p.cash_register_id WHERE p.voided_at IS NULL)`;
  }

  /**
   * Payment voids of the scope's registers  plus the
   * order cancellations and line voids inside its bounds (their own business
   * day), oldest first.
   */
  private async voids(scope: SQL): Promise<CashVoidItem[]> {
    const eventDay = (column: SQL) => sql`to_char(((${column} AT TIME ZONE b.tz) - b.cut)::date, 'YYYY-MM-DD')`;
    const rows = await this.rows(sql`
      WITH ${scope}
      SELECT e.*, o.order_number, ${tableLabel} AS table_label FROM (
        SELECT v.voided_at AS at, 'payment_void' AS kind, r.day, v.order_id, v.amount_due AS amount, v.reason_code, v.reason_text,
               v.voided_by_name AS requested_by, v.authorized_by_name AS authorized_by, v.id
          FROM public.payment_voids v JOIN regs r ON r.id = v.cash_register_id
        UNION ALL
        SELECT oc.cancelled_at, 'order_cancellation', ${eventDay(sql`oc.cancelled_at`)}, oc.order_id, oc.total, oc.reason_code, oc.reason_text,
               oc.cancelled_by_name, oc.authorized_by_name, oc.id
          FROM public.order_cancellations oc, bounds b WHERE oc.cancelled_at >= b.lo AND oc.cancelled_at < b.hi
        UNION ALL
        SELECT iv.voided_at, 'item_void', ${eventDay(sql`iv.voided_at`)}, iv.order_id, iv.amount, iv.reason_code, iv.reason_text,
               iv.voided_by_name, iv.authorized_by_name, iv.id
          FROM public.order_item_voids iv, bounds b WHERE iv.voided_at >= b.lo AND iv.voided_at < b.hi
      ) e
      JOIN public.orders o ON o.id = e.order_id
      LEFT JOIN public.tables t ON t.id = o.table_id
      ORDER BY e.at, e.id`);
    return rows.map((row) => ({
      at: time(row.at)!,
      kind: row.kind as VoidKind,
      orderNumber: numOrNull(row.order_number),
      table: text(row.table_label),
      amount: num(row.amount),
      reason: String(row.reason_code),
      reasonText: text(row.reason_text),
      requestedBy: String(row.requested_by),
      authorizedBy: text(row.authorized_by),
    }));
  }

  /** Tips of the scope's live payments by the order's waiter, highest first. */
  private async tipsByWaiter(scope: SQL): Promise<CashWaiterTips[]> {
    const rows = await this.rows(sql`
      WITH ${scope}
      SELECT o.waiter_id, w.full_name AS name, sum(p.tip_amount) AS amount
        FROM pays p
        JOIN public.orders o ON o.id = p.order_id
        LEFT JOIN public.profiles w ON w.id = o.waiter_id
       WHERE p.tip_amount > 0
       GROUP BY o.waiter_id, w.full_name
       ORDER BY amount DESC, name NULLS LAST`);
    return rows.map((row) => ({ waiterId: text(row.waiter_id), name: text(row.name), amount: num(row.amount) }));
  }

  private async catalog(): Promise<Catalog[]> {
    const rows = await this.rows(sql`SELECT id, code, name, kind FROM public.payment_methods ORDER BY sort_order, name`);
    return rows.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name), kind: row.kind as PaymentMethodKind }));
  }

  private async rows<T = Row>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

/** Table label of the joined order `o` and table `t`. */
const tableLabel = sql`CASE WHEN o.order_type = 'delivery' THEN 'Domicilio' ELSE t.number::text END`;
const sumOf = <K extends 'salesNet' | 'tickets' | 'tips' | 'deposits' | 'withdrawals' | 'expected'>(rows: CashDayRegister[], key: K) =>
  rows.reduce((sum, row) => sum + row[key], 0);

const summaryMethods = (summary: RegisterSummary): CashMethodTotal[] =>
  summary.methods.map((m) => ({ id: m.paymentMethodId, code: m.code, name: m.name, kind: m.kind, total: m.total, count: m.tendersCount }));

/** Catalog order, totals and counts added over the lists. */
function mergeMethods(catalog: Catalog[], lists: CashMethodTotal[][]): CashMethodTotal[] {
  return catalog.map((method) => {
    const rows = lists.flat().filter((row) => row.id === method.id);
    return { ...method, total: rows.reduce((sum, row) => sum + row.total, 0), count: rows.reduce((sum, row) => sum + row.count, 0) };
  });
}
