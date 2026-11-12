import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import type { PaymentMethodKind } from '../payments/payments.dto';
import type { CashTransactionReason, CashTransactionType, RegisterSummary } from '../registers/registers.dto';
import { profileRef } from '../registers/registers.mappers';
import { RegistersService } from '../registers/registers.service';
import { ConfigService } from '../settings/config.service';
import {
  CASH_MESSAGES,
  type CashCashierDifference,
  type CashDay,
  type CashDayRegister,
  type CashLedger,
  type CashLedgerEntry,
  type CashLedgerTender,
  type CashMethodTips,
  type CashMethodTotal,
  type CashPeriodBucket,
  type CashReport,
  type CashVoidItem,
  type CashWaiterTips,
  type CashZList,
  type CashZRef,
  type CashZReport,
  type CashZSnapshot,
  MAX_REPORT_DAYS,
  type ReportGroup,
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
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** First day of the bucket holding `date`: itself, the Monday of its ISO week or the first of its month. */
export function bucketStart(date: string, group: ReportGroup): string {
  if (group === 'month') {
    return `${date.slice(0, 7)}-01`;
  }
  if (group === 'week') {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return addDays(date, -((weekday + 6) % 7));
  }
  return date;
}
function bucketEnd(start: string, group: ReportGroup): string {
  if (group === 'month') {
    const d = new Date(`${start}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  return group === 'week' ? addDays(start, 6) : start;
}

/** Prices include the tax: base = round(sales / (1 + rate / 100)), tax = sales - base, whole pesos. */
export function taxBreakdown(sales: number, rate: number): { base: number; tax: number } {
  const base = Math.round((sales * 100) / (100 + rate));
  return { base, tax: sales - base };
}

/** The day-level aggregates of a range of business days, before bucketing. */
interface DayFigures {
  sales: Map<string, { salesNet: number; tickets: number; tips: number }>;
  methods: Map<string, Map<string, { total: number; count: number }>>;
  difference: Map<string, number>;
  voids: Map<string, { count: number; amount: number }>;
}

interface Catalog {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
}

/**
 * The admin's cash figures (S5, S6): the business day, its ledger and the
 * period report. A register belongs to the business day
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
    return { ...(await this.summary(date)), z: await this.zOfDay(date) };
  }

  /** GET /cash/days/:date without the Z: the part a Z snapshot freezes. */
  private async summary(date: string): Promise<Omit<CashDay, 'z'>> {
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
      voids: { count: voids.length, amount: voids.reduce((sum, item) => sum + item.amount, 0), items: voids.map(({ day: _day, ...item }) => item) },
      previous: { date: previous, salesNet: num(prev.sales) },
    };
  }

  async ledger(date: string): Promise<CashLedger> {
    const scope = this.scope(date, date, await this.cutoff());
    const events: (CashLedgerEntry & { rank: number; seq: string })[] = [];
    const push = (entry: CashLedgerEntry, rank: number, seq: string) => events.push({ ...entry, rank, seq });
    const regs = await this.rows(sql`
      WITH ${scope}
      SELECT r.id, r.opening_timestamp, r.closing_timestamp, r.initial_cash, r.final_cash, r.counted_cash, r.cash_difference,
             r.close_note, r.validated_at, r.opened_by, op.full_name AS opened_by_name, r.closed_by, cb.full_name AS closed_by_name,
             r.validated_by, vb.full_name AS validated_by_name
        FROM regs r
        LEFT JOIN public.profiles op ON op.id = r.opened_by
        LEFT JOIN public.profiles cb ON cb.id = r.closed_by
        LEFT JOIN public.profiles vb ON vb.id = r.validated_by`);
    for (const r of regs) {
      const registerId = String(r.id);
      const initial = num(r.initial_cash);
      push({ registerId, at: time(r.opening_timestamp)!, kind: 'opening', cashDelta: initial, cashBalance: null, amount: initial,
        openedBy: profileRef(r.opened_by, r.opened_by_name) }, 0, registerId);
      if (r.closing_timestamp) {
        push({ registerId, at: time(r.closing_timestamp)!, kind: 'close', cashDelta: 0, cashBalance: null, expected: num(r.final_cash),
          counted: numOrNull(r.counted_cash), difference: numOrNull(r.cash_difference), note: text(r.close_note),
          closedBy: profileRef(r.closed_by, r.closed_by_name) }, 2, registerId);
      }
      if (r.validated_at) {
        push({ registerId, at: time(r.validated_at)!, kind: 'validation', cashDelta: 0, cashBalance: null,
          validatedBy: profileRef(r.validated_by, r.validated_by_name) }, 3, registerId);
      }
    }
    const payments = await this.rows(sql`
      WITH ${scope}
      SELECT p.id, p.cash_register_id, p.created_at, p.amount_due, p.tip_amount, p.change_given, o.order_number, ${tableLabel} AS table_label,
             o.waiter_id, w.full_name AS waiter_name, p.cashier_profile_id, c.full_name AS cashier_name,
             ${cashTenders} AS cash, ${tenderList} AS tenders
        FROM public.payments p
        JOIN regs r ON r.id = p.cash_register_id
        JOIN public.orders o ON o.id = p.order_id
        LEFT JOIN public.tables t ON t.id = o.table_id
        LEFT JOIN public.profiles w ON w.id = o.waiter_id
        LEFT JOIN public.profiles c ON c.id = p.cashier_profile_id`);
    for (const p of payments) {
      push({ registerId: String(p.cash_register_id), at: time(p.created_at)!, kind: 'payment', cashDelta: num(p.cash), cashBalance: null,
        orderNumber: numOrNull(p.order_number), table: text(p.table_label), waiter: profileRef(p.waiter_id, p.waiter_name),
        cashier: profileRef(p.cashier_profile_id, p.cashier_name), amount: num(p.amount_due), tip: num(p.tip_amount),
        change: num(p.change_given), tenders: toTenders(p.tenders), voided: false }, 1, String(p.id));
    }
    const movements = await this.rows(sql`
      WITH ${scope}
      SELECT ct.id, ct.cash_register_id, ct.timestamp, ct.amount, ct.type, ct.reason, ct.description, ct.created_by, cp.full_name AS created_by_name
        FROM public.cash_transactions ct
        JOIN regs r ON r.id = ct.cash_register_id
        LEFT JOIN public.profiles cp ON cp.id = ct.created_by`);
    for (const m of movements) {
      const amount = num(m.amount);
      push({ registerId: String(m.cash_register_id), at: time(m.timestamp)!, kind: 'cash_movement',
        cashDelta: m.type === 'withdrawal' ? -amount : amount, cashBalance: null, type: m.type as CashTransactionType, amount,
        reason: text(m.reason) as CashTransactionReason | null, description: text(m.description) ?? '',
        createdBy: profileRef(m.created_by, m.created_by_name) }, 1, String(m.id));
    }
    // A voided payment is invisible through RLS (0018): its payment entry and its void come from the payment_voids snapshot.
    const voided = await this.rows(sql`
      WITH ${scope}
      SELECT v.id, v.cash_register_id, v.paid_at, v.voided_at, v.amount_due, v.tip_amount, v.change_given, v.reason_code, v.reason_text,
             v.voided_by_name, v.authorized_by_name, o.order_number, ${tableLabel} AS table_label, o.waiter_id, w.full_name AS waiter_name,
             (SELECT coalesce(sum((x->>'amount')::bigint), 0) FROM jsonb_array_elements(v.tenders) AS e(x) WHERE x->>'method_kind' = 'cash') AS cash,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('method', coalesce(m.name, x->>'method_code'), 'code', x->>'method_code',
                                                           'kind', x->>'method_kind', 'amount', (x->>'amount')::bigint)
                                        ORDER BY (x->>'line_no')::int), '[]'::jsonb)
                FROM jsonb_array_elements(v.tenders) AS e(x)
                LEFT JOIN public.payment_methods m ON m.id::text = x->>'payment_method_id') AS tenders
        FROM public.payment_voids v
        JOIN regs r ON r.id = v.cash_register_id
        JOIN public.orders o ON o.id = v.order_id
        LEFT JOIN public.tables t ON t.id = o.table_id
        LEFT JOIN public.profiles w ON w.id = o.waiter_id`);
    for (const v of voided) {
      const registerId = String(v.cash_register_id);
      const order = { orderNumber: numOrNull(v.order_number), table: text(v.table_label) };
      push({ registerId, at: time(v.paid_at)!, kind: 'payment', cashDelta: num(v.cash), cashBalance: null, ...order,
        waiter: profileRef(v.waiter_id, v.waiter_name), cashier: null, amount: num(v.amount_due), tip: num(v.tip_amount),
        change: num(v.change_given), tenders: toTenders(v.tenders), voided: true }, 1, String(v.id));
      push({ registerId, at: time(v.voided_at)!, kind: 'payment_void', cashDelta: -num(v.cash), cashBalance: null, ...order,
        amount: num(v.amount_due), reason: String(v.reason_code), reasonText: text(v.reason_text), requestedBy: String(v.voided_by_name),
        authorizedBy: text(v.authorized_by_name) }, 1, String(v.id));
    }
    // A cancellation has no register: it goes to the day's register open at that time (the latest opened before it).
    const cancellations = await this.rows(sql`
      WITH ${scope}
      SELECT oc.id, oc.cancelled_at, oc.total, oc.reason_code, oc.reason_text, oc.cancelled_by_name, oc.authorized_by_name,
             o.order_number, ${tableLabel} AS table_label,
             (SELECT r.id FROM regs r
               WHERE r.opening_timestamp <= oc.cancelled_at AND (r.closing_timestamp IS NULL OR oc.cancelled_at <= r.closing_timestamp)
               ORDER BY r.opening_timestamp DESC LIMIT 1) AS register_id
        FROM public.order_cancellations oc
        JOIN public.orders o ON o.id = oc.order_id
        LEFT JOIN public.tables t ON t.id = o.table_id
       CROSS JOIN bounds b
       WHERE oc.cancelled_at >= b.lo AND oc.cancelled_at < b.hi`);
    for (const c of cancellations) {
      push({ registerId: text(c.register_id), at: time(c.cancelled_at)!, kind: 'order_cancellation', cashDelta: 0, cashBalance: null,
        orderNumber: numOrNull(c.order_number), table: text(c.table_label), amount: num(c.total), reason: String(c.reason_code),
        reasonText: text(c.reason_text), requestedBy: String(c.cancelled_by_name), authorizedBy: text(c.authorized_by_name) }, 1, String(c.id));
    }
    events.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank || a.seq.localeCompare(b.seq));
    const balances = new Map<string, number>();
    const entries = events.map(({ rank: _rank, seq: _seq, ...entry }) => {
      if (entry.registerId === null) {
        return entry;
      }
      const balance = (balances.get(entry.registerId) ?? 0) + entry.cashDelta;
      balances.set(entry.registerId, balance);
      return { ...entry, cashBalance: balance };
    });
    return { date, entries };
  }

  async report(from: string, to: string, group: ReportGroup): Promise<CashReport> {
    if (from > to) {
      throw new UnprocessableEntityException({ message: CASH_MESSAGES.rangeInverted, code: 'range_inverted' });
    }
    const length = daysBetween(from, to) + 1;
    if (length > MAX_REPORT_DAYS) {
      throw new UnprocessableEntityException({ message: CASH_MESSAGES.rangeTooLong, code: 'range_too_long' });
    }
    const cutoff = await this.cutoff();
    const catalog = await this.catalog();
    const scope = this.scope(from, to, cutoff);
    const figures = await this.figures(scope);
    const buckets: CashPeriodBucket[] = [];
    for (let start = bucketStart(from, group); start <= to; start = addDays(bucketEnd(start, group), 1)) {
      const first = start < from ? from : start;
      const end = bucketEnd(start, group);
      buckets.push(bucketOf(catalog, figures, first, end > to ? to : end));
    }
    const prevFrom = addDays(from, -length);
    const prevTo = addDays(from, -1);
    const previous = bucketOf(catalog, await this.figures(this.scope(prevFrom, prevTo, cutoff)), prevFrom, prevTo);
    const cashiers = await this.rows(sql`
      WITH ${scope}
      SELECT r.opened_by AS profile_id, p.full_name AS name, count(*) AS shifts, coalesce(sum(r.cash_difference), 0) AS difference
        FROM regs r JOIN public.profiles p ON p.id = r.opened_by
       GROUP BY r.opened_by, p.full_name
       ORDER BY p.full_name, r.opened_by`);
    return {
      from,
      to,
      group,
      buckets,
      totals: bucketOf(catalog, figures, from, to),
      previous,
      byCashier: cashiers.map(
        (row): CashCashierDifference => ({ profileId: String(row.profile_id), name: String(row.name), shifts: num(row.shifts), difference: num(row.difference) }),
      ),
      tipsByWaiter: await this.tipsByWaiter(scope),
    };
  }

  /**
   * S8: "Emitir informe Z". Under a transaction advisory lock per restaurant
   * (concurrent emits wait for each other): a day that already has a Z
   * returns it unchanged; a day without registers is 409 day_empty, one with
   * an open register 409 day_open. Otherwise the day summary is frozen with
   * its taxes (configured rate, from salesNet, tax included), the
   * order range, discounts and tips by method, and numbered max + 1.
   */
  async emitZ(date: string): Promise<CashZReport> {
    await this.rows(sql`SELECT pg_advisory_xact_lock(hashtextextended('z_reports:' || private.current_restaurant_id()::text, 0))`);
    const [existing] = await this.rows<{ number: number }>(sql`SELECT number FROM public.z_reports WHERE business_day = ${date}::date`);
    if (existing) {
      return this.z(Number(existing.number));
    }
    const day = await this.summary(date);
    if (day.status === 'empty') {
      throw new ConflictException({ message: CASH_MESSAGES.dayEmpty, code: 'day_empty' });
    }
    if (day.status === 'open') {
      throw new ConflictException({ message: CASH_MESSAGES.dayOpen, code: 'day_open' });
    }
    const config = await this.config.get();
    const scope = this.scope(date, date, config.businessDayCutoffHour);
    const [orders] = await this.rows(sql`
      WITH ${scope}
      SELECT min(o.order_number) AS first, max(o.order_number) AS last, coalesce(sum(o.total_discounts), 0) AS discounts
        FROM pays p JOIN public.orders o ON o.id = p.order_id`);
    const snapshot: CashZSnapshot = {
      ...day,
      taxes: {
        rate: config.taxPercentage,
        ...taxBreakdown(day.totals.salesNet, config.taxPercentage),
      },
      orders: { first: numOrNull(orders.first), last: numOrNull(orders.last) },
      discounts: Math.round(num(orders.discounts)),
      tipsByMethod: await this.tipsByMethod(scope),
    };
    const [{ number }] = await this.rows<{ number: number }>(sql`
      INSERT INTO public.z_reports (number, business_day, snapshot)
      SELECT coalesce(max(number), 0) + 1, ${date}::date, ${JSON.stringify(snapshot)}::jsonb FROM public.z_reports
      RETURNING number`);
    return this.z(Number(number));
  }

  /** GET /cash/z/:number: the stored Z; 404 when the restaurant has no such number. */
  async z(number: number): Promise<CashZReport> {
    const [row] = await this.rows(sql`
      SELECT z.number, to_char(z.business_day, 'YYYY-MM-DD') AS business_day, z.snapshot, z.emitted_at, z.emitted_by, p.full_name AS emitted_by_name
        FROM public.z_reports z LEFT JOIN public.profiles p ON p.id = z.emitted_by
       WHERE z.number = ${number}`);
    if (!row) {
      throw new NotFoundException('Z report not found');
    }
    return { ...zRef(row), businessDay: String(row.business_day), snapshot: row.snapshot as CashZSnapshot };
  }

  /** GET /cash/z?from&to: the Zs of the business days by number, and the missing numbers between the first and the last. */
  async zList(from: string, to: string): Promise<CashZList> {
    if (from > to) {
      throw new UnprocessableEntityException({ message: CASH_MESSAGES.rangeInverted, code: 'range_inverted' });
    }
    if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) {
      throw new UnprocessableEntityException({ message: CASH_MESSAGES.rangeTooLong, code: 'range_too_long' });
    }
    const rows = await this.rows(sql`
      SELECT z.number, to_char(z.business_day, 'YYYY-MM-DD') AS business_day, z.emitted_at, z.emitted_by, p.full_name AS emitted_by_name,
             z.snapshot->'totals'->>'salesNet' AS sales_net, z.snapshot->'totals'->>'difference' AS difference
        FROM public.z_reports z LEFT JOIN public.profiles p ON p.id = z.emitted_by
       WHERE z.business_day BETWEEN ${from}::date AND ${to}::date
       ORDER BY z.number`);
    const items = rows.map((row) => ({
      ...zRef(row),
      businessDay: String(row.business_day),
      salesNet: num(row.sales_net),
      difference: num(row.difference),
    }));
    let gaps: number[] = [];
    if (items.length > 0) {
      const missing = await this.rows<{ n: number }>(sql`
        SELECT n FROM generate_series(${items[0].number}::int, ${items[items.length - 1].number}::int) AS n
         WHERE NOT EXISTS (SELECT 1 FROM public.z_reports z WHERE z.number = n)
         ORDER BY n`);
      gaps = missing.map((row) => Number(row.n));
    }
    return { from, to, items, gaps };
  }

  private async zOfDay(date: string): Promise<CashZRef | null> {
    const [row] = await this.rows(sql`
      SELECT z.number, z.emitted_at, z.emitted_by, p.full_name AS emitted_by_name
        FROM public.z_reports z LEFT JOIN public.profiles p ON p.id = z.emitted_by
       WHERE z.business_day = ${date}::date`);
    return row ? zRef(row) : null;
  }

  /**
   * Tips of the scope's live payments by tender method, in catalog order,
   * methods with tips only. A payment with several tenders splits its tip by
   * tender amount (the last tender takes the rounding).
   */
  private async tipsByMethod(scope: SQL): Promise<CashMethodTips[]> {
    const rows = await this.rows(sql`
      WITH ${scope}
      SELECT p.id, p.tip_amount, t.payment_method_id, t.amount
        FROM pays p JOIN public.payment_tenders t ON t.payment_id = p.id
       WHERE p.tip_amount > 0
       ORDER BY p.id, t.line_no`);
    const byPayment = new Map<string, { tip: number; tenders: { method: string; amount: number }[] }>();
    for (const row of rows) {
      const entry = byPayment.get(String(row.id)) ?? { tip: num(row.tip_amount), tenders: [] };
      entry.tenders.push({ method: String(row.payment_method_id), amount: num(row.amount) });
      byPayment.set(String(row.id), entry);
    }
    const byMethod = new Map<string, number>();
    for (const { tip, tenders } of byPayment.values()) {
      const total = tenders.reduce((sum, tender) => sum + tender.amount, 0);
      let left = tip;
      tenders.forEach((tender, index) => {
        const share = index === tenders.length - 1 ? left : total > 0 ? Math.floor((tip * tender.amount) / total) : 0;
        left -= share;
        byMethod.set(tender.method, (byMethod.get(tender.method) ?? 0) + share);
      });
    }
    return (await this.catalog())
      .filter((method) => (byMethod.get(method.id) ?? 0) > 0)
      .map((method) => ({ code: method.code, name: method.name, kind: method.kind, amount: byMethod.get(method.id)! }));
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

  private async figures(scope: SQL): Promise<DayFigures> {
    const sales = await this.rows(sql`
      WITH ${scope}
      SELECT day, sum(amount_due) AS sales, count(*) AS tickets, sum(tip_amount) AS tips FROM pays GROUP BY day`);
    const methods = await this.rows(sql`
      WITH ${scope}
      SELECT p.day, t.payment_method_id, sum(t.amount) AS total, count(*) AS count
        FROM pays p JOIN public.payment_tenders t ON t.payment_id = p.id
       GROUP BY p.day, t.payment_method_id`);
    const differences = await this.rows(sql`
      WITH ${scope}
      SELECT day, coalesce(sum(cash_difference), 0) AS difference FROM regs GROUP BY day`);
    const figures: DayFigures = { sales: new Map(), methods: new Map(), difference: new Map(), voids: new Map() };
    for (const row of sales) {
      figures.sales.set(String(row.day), { salesNet: num(row.sales), tickets: num(row.tickets), tips: num(row.tips) });
    }
    for (const row of methods) {
      const day = String(row.day);
      const byMethod = figures.methods.get(day) ?? new Map();
      byMethod.set(String(row.payment_method_id), { total: num(row.total), count: num(row.count) });
      figures.methods.set(day, byMethod);
    }
    for (const row of differences) {
      figures.difference.set(String(row.day), num(row.difference));
    }
    for (const item of await this.voids(scope)) {
      const current = figures.voids.get(item.day) ?? { count: 0, amount: 0 };
      figures.voids.set(item.day, { count: current.count + 1, amount: current.amount + item.amount });
    }
    return figures;
  }

  /**
   * Payment voids of the scope's registers (their register's day) plus the
   * order cancellations and line voids inside its bounds (their own business
   * day), oldest first.
   */
  private async voids(scope: SQL): Promise<(CashVoidItem & { day: string })[]> {
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
      day: String(row.day),
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

const zRef = (row: Row): CashZRef => ({
  number: Number(row.number),
  emittedAt: time(row.emitted_at)!,
  emittedBy: profileRef(row.emitted_by, row.emitted_by_name),
});

/** Table label of the joined order `o` and table `t`. */
const tableLabel = sql`CASE WHEN o.order_type = 'delivery' THEN 'Domicilio' ELSE t.number::text END`;
/** Cash tenders of the joined payment `p` (each amount is already net of the change). */
const cashTenders = sql`(SELECT coalesce(sum(ct.amount), 0) FROM public.payment_tenders ct WHERE ct.payment_id = p.id AND ct.method_kind = 'cash')`;
const tenderList = sql`coalesce((
  SELECT jsonb_agg(jsonb_build_object('method', coalesce(m.name, pt.method_code), 'code', pt.method_code, 'kind', pt.method_kind, 'amount', pt.amount)
                   ORDER BY pt.line_no)
    FROM public.payment_tenders pt LEFT JOIN public.payment_methods m ON m.id = pt.payment_method_id
   WHERE pt.payment_id = p.id), '[]'::jsonb)`;

const toTenders = (value: unknown): CashLedgerTender[] =>
  ((value as Json[] | null) ?? []).map((t) => ({ method: String(t.method), code: String(t.code), kind: t.kind as PaymentMethodKind, amount: num(t.amount) }));

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

function bucketOf(catalog: Catalog[], figures: DayFigures, start: string, end: string): CashPeriodBucket {
  let salesNet = 0;
  let tickets = 0;
  let tips = 0;
  let difference = 0;
  const voids = { count: 0, amount: 0 };
  const methods = new Map<string, { total: number; count: number }>();
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const sales = figures.sales.get(day);
    salesNet += sales?.salesNet ?? 0;
    tickets += sales?.tickets ?? 0;
    tips += sales?.tips ?? 0;
    difference += figures.difference.get(day) ?? 0;
    const dayVoids = figures.voids.get(day);
    voids.count += dayVoids?.count ?? 0;
    voids.amount += dayVoids?.amount ?? 0;
    for (const [id, value] of figures.methods.get(day) ?? []) {
      const current = methods.get(id) ?? { total: 0, count: 0 };
      methods.set(id, { total: current.total + value.total, count: current.count + value.count });
    }
  }
  return {
    start,
    end,
    salesNet,
    tickets,
    avgTicket: avg(salesNet, tickets),
    tips,
    methods: catalog.map((method) => ({ ...method, ...(methods.get(method.id) ?? { total: 0, count: 0 }) })),
    difference,
    voids,
  };
}
