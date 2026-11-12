import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { eq, schema, sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { appliesToChannel, scheduleState } from '../promotions/engine';
import { PromotionCatalog, type PromotionChannel, type PromotionRecord, type RestaurantNow } from '../promotions/promotion-catalog.service';
import { clockText, promotionBadge, promotionSentence, type TargetNames } from '../promotions/promotion-text';
import {
  type Dish,
  type Promotion,
  promotionBodySchema,
  type PromotionErrorCode,
  type PromotionShape,
  promotionShapeSchema,
  type PromotionsToday,
  type PromotionStats,
} from './catalog.dto';
import { toDish } from './catalog.mappers';
import { ModifiersService } from './modifiers.service';

const promotions = schema.promotions;
const promotionDishes = schema.promotionDishes;

const NO_STATS: PromotionStats = { usesLast30Days: 0, discountLast30Days: 0 };
/** Reasons a promotion is not offered at all (the terminals' "today" leaves them out). */
const GONE = ['paused', 'ended'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 422 with the first machine code as `code` and every `<field>: <code>` in `message` (joined with "; "). */
function rejected(issues: { path: PropertyKey[]; message: string }[]): UnprocessableEntityException {
  const messages = issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message));
  return new UnprocessableEntityException({ message: messages.join('; '), code: (issues[0]?.message ?? 'promotion_invalid') as PromotionErrorCode });
}

function parse<T extends z.ZodType>(schemaToUse: T, input: unknown): z.infer<T> {
  const parsed = schemaToUse.safeParse(input ?? {});
  if (!parsed.success) throw rejected(parsed.error.issues);
  return parsed.data;
}

const unknownTarget = (path: string) => rejected([{ path: [path], message: 'unknown_target' }]);

/**
 * Promotions of the caller's restaurant (S1); RLS scopes every statement to
 * it. A write validates the merged promotion per kind and stores the row, its
 * targets and its combo groups in the request transaction, so a rejected body
 * leaves nothing behind.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly modifiers: ModifiersService,
    private readonly catalog: PromotionCatalog,
  ) {}

  /** Newest first. */
  async list(): Promise<Promotion[]> {
    return (await this.read()).reverse();
  }

  /** Active flag set and inside their dates now (restaurant timezone), oldest first. */
  async active(): Promise<Promotion[]> {
    return (await this.read()).filter((p) => !['paused', 'not_started', 'ended'].includes(p.schedule.reason));
  }

  /** GET /catalog/promotions/today: what a terminal shows for a channel (S8). */
  async today(channel: PromotionChannel): Promise<PromotionsToday> {
    const now = await this.catalog.now();
    const records = await this.catalog.records();
    const dtos = await this.toDtos(records, now);
    const result: PromotionsToday = { now: now.instant.toISOString(), localTime: clockText(now.local.minutes)!, channel, active: [], laterToday: [], others: [] };
    records.forEach(({ rule }, index) => {
      const promotion = dtos[index];
      const state = scheduleState(rule, now.local);
      if (GONE.includes(state.reason)) return;
      const base = { promotion, sentence: promotion.sentence, badge: promotion.badge };
      if (!appliesToChannel(rule, channel)) {
        result.others.push({ ...base, reason: 'other_channel' });
      } else if (state.activeNow) {
        const left = state.endsAtMinutes === null ? null : state.endsAtMinutes - now.local.minutes;
        result.active.push({ ...base, endsAt: clockText(state.endsAtMinutes), minutesLeft: left });
      } else if (state.reason === 'outside_hours' && state.nextStartTodayMinutes !== null) {
        result.laterToday.push({
          ...base,
          startsAt: clockText(state.nextStartTodayMinutes)!,
          minutesUntilStart: state.nextStartTodayMinutes - now.local.minutes,
        });
      } else {
        result.others.push({ ...base, reason: state.reason as 'other_day' | 'outside_hours' | 'manual' | 'not_started' });
      }
    });
    result.active.sort((a, b) => (a.minutesLeft ?? Infinity) - (b.minutesLeft ?? Infinity));
    result.laterToday.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);
    return result;
  }

  async create(input: unknown): Promise<Promotion> {
    const body = parse(promotionBodySchema, input);
    const now = await this.catalog.now();
    const shape = parse(promotionShapeSchema, { ...defaults(now), ...body, description: body.description ?? null });
    const values = this.columns(shape, now.timeZone);
    const { rows } = await this.uow.db.execute(sql`
      INSERT INTO public.promotions (${sql.raw(COLUMN_NAMES.join(', '))})
      VALUES (${sql.join(values, sql`, `)})
      RETURNING id`);
    const id = String((rows[0] as { id: string }).id);
    await this.writeChildren(id, shape, { targets: true, comboGroups: true });
    return this.one(id);
  }

  async update(id: string, input: unknown): Promise<Promotion> {
    const body = parse(promotionBodySchema, input);
    await this.assertPromotion(id);
    const [current] = await this.catalog.records([id]);
    const now = await this.catalog.now();
    const shape = parse(promotionShapeSchema, { ...toShape(current), ...body, description: body.description === undefined ? current.description : body.description });
    const values = this.columns(shape, now.timeZone);
    const sets = COLUMN_NAMES.map((name, index) => sql`${sql.raw(name)} = ${values[index]}`);
    await this.uow.db.execute(sql`UPDATE public.promotions SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}`);
    // A kind without targets or groups drops them; otherwise only what the body sent is replaced.
    const keepsTargets = shape.kind === 'product_discount' || shape.kind === 'buy_x_pay_y';
    await this.writeChildren(id, shape, {
      targets: body.targets !== undefined || !keepsTargets,
      comboGroups: body.comboGroups !== undefined || shape.kind !== 'combo',
    });
    return this.one(id);
  }

  /** Deletes the promotion; its targets and groups go with it (ON DELETE CASCADE), sent lines keep their snapshot. */
  async remove(id: string): Promise<void> {
    await this.assertPromotion(id);
    await this.uow.db.delete(promotionDishes).where(eq(promotionDishes.promotionId, id));
    await this.uow.db.delete(promotions).where(eq(promotions.id, id));
  }

  async dishes(id: string): Promise<Dish[]> {
    await this.assertPromotion(id);
    const rows = await this.uow.db
      .select({ dish: schema.dishes })
      .from(promotionDishes)
      .innerJoin(schema.dishes, eq(schema.dishes.id, promotionDishes.dishId))
      .where(eq(promotionDishes.promotionId, id))
      .orderBy(schema.dishes.name);
    const groups = await this.modifiers.groupsForDishes(rows.map((row) => row.dish.id));
    return rows.map((row) => toDish(row.dish, groups.get(row.dish.id)));
  }

  /**
   * Replaces the dish set in the request transaction: delete, then insert the
   * dishes visible to the caller. A dish id that is unknown or belongs to
   * another restaurant inserts no row, which aborts the transaction, so the
   * previous set survives.
   */
  async setDishes(id: string, dishIds: readonly string[]): Promise<Dish[]> {
    await this.assertPromotion(id);
    const unique = [...new Set(dishIds)];
    await this.uow.db.delete(promotionDishes).where(eq(promotionDishes.promotionId, id));
    if (unique.length > 0) {
      const result = await this.uow.db.execute(sql`
        INSERT INTO public.promotion_dishes (promotion_id, dish_id)
        SELECT ${id}::uuid, d.id FROM public.dishes d WHERE d.id = ANY(${sql.param(unique)}::uuid[])`);
      if (result.rowCount !== unique.length) {
        throw new UnprocessableEntityException('Unknown dish');
      }
    }
    return this.dishes(id);
  }

  /** Names of every dish, category and subcategory, for the rule sentences. */
  async targetNames(): Promise<TargetNames> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT 'd' AS t, id, name FROM public.dishes
      UNION ALL SELECT 'c', id, name FROM public.categories
      UNION ALL SELECT 's', id, name FROM public.subcategories`);
    const maps = { d: new Map<string, string>(), c: new Map<string, string>(), s: new Map<string, string>() };
    for (const row of rows as { t: 'd' | 'c' | 's'; id: string; name: string }[]) {
      maps[row.t].set(row.id, row.name);
    }
    return { dishes: maps.d, categories: maps.c, subcategories: maps.s };
  }

  private async read(): Promise<Promotion[]> {
    const now = await this.catalog.now();
    return this.toDtos(await this.catalog.records(), now);
  }

  private async one(id: string): Promise<Promotion> {
    const records = await this.catalog.records([id]);
    if (records.length === 0) throw new NotFoundException('Promotion not found');
    return (await this.toDtos(records, await this.catalog.now()))[0];
  }

  private async toDtos(records: PromotionRecord[], now: RestaurantNow): Promise<Promotion[]> {
    if (records.length === 0) return [];
    const [names, stats] = await Promise.all([this.targetNames(), this.stats(now)]);
    return records.map((record) => toPromotion(record, now, names, stats.get(record.rule.id) ?? NO_STATS));
  }

  /** Distinct orders and discount of each promotion over the 30 days before now (cancelled orders and lines left out). */
  private async stats(now: RestaurantNow): Promise<Map<string, PromotionStats>> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT od.promotion_id, count(DISTINCT od.order_id)::int AS uses, coalesce(sum(od.amount), 0)::bigint AS amount
        FROM public.order_discounts od
        JOIN public.orders o ON o.id = od.order_id
        LEFT JOIN public.order_items oi ON oi.id = od.order_item_id
       WHERE od.promotion_id IS NOT NULL
         AND o.status <> 'cancelled'
         AND o.created_at >= ${now.instant.toISOString()}::timestamptz - interval '30 days'
         AND (od.order_item_id IS NULL OR oi.status IS DISTINCT FROM 'cancelled')
       GROUP BY od.promotion_id`);
    return new Map(
      (rows as { promotion_id: string; uses: number; amount: string | number }[]).map((row) => [
        row.promotion_id,
        { usesLast30Days: Number(row.uses), discountLast30Days: Number(row.amount) },
      ]),
    );
  }

  /** Column values in COLUMN_NAMES order; fields of other kinds are null (the 0025 per-kind CHECKs). */
  private columns(p: PromotionShape, timeZone: string): SQL[] {
    const has = (...kinds: PromotionShape['kind'][]) => kinds.includes(p.kind);
    const discount = has('product_discount', 'bill_discount');
    const nxm = has('buy_x_pay_y');
    return [
      sql`${p.name}`,
      sql`${p.description}`,
      sql`${p.kind}`,
      sql`${p.mode}`,
      sql`${discount ? p.discountType : null}`,
      sql`${discount ? p.discountValue : null}::numeric`,
      sql`${nxm ? p.buyQuantity : null}::integer`,
      sql`${nxm ? p.payQuantity : null}::integer`,
      sql`${nxm ? p.restDiscountPercent : null}::integer`,
      sql`${has('combo') ? p.comboPrice : null}::numeric`,
      sql`${has('bill_discount') ? p.minSubtotal : null}::numeric`,
      sql`${has('bill_discount') ? p.maxDiscount : null}::numeric`,
      dateValue(p.startDate, timeZone, 'start'),
      p.endDate === null ? sql`NULL::timestamptz` : dateValue(p.endDate, timeZone, 'end'),
      sql`${sql.param([...new Set(p.daysOfWeek)].sort((a, b) => a - b))}::smallint[]`,
      sql`${JSON.stringify(p.timeWindows)}::jsonb`,
      sql`${sql.param(p.channels)}::text[]`,
      sql`${p.maxUsesPerOrder}::integer`,
      sql`${p.active}`,
    ];
  }

  /** Replaces targets and/or combo groups; an id the caller cannot see is a 422 unknown_target (the transaction rolls back). */
  private async writeChildren(id: string, p: PromotionShape, replace: { targets: boolean; comboGroups: boolean }): Promise<void> {
    const targeted = p.kind === 'product_discount' || p.kind === 'buy_x_pay_y';
    if (replace.targets) {
      const t = targeted ? p.targets : { dishIds: [], categoryIds: [], subcategoryIds: [] };
      await this.uow.db.execute(sql`DELETE FROM public.promotion_dishes WHERE promotion_id = ${id}`);
      await this.uow.db.execute(sql`DELETE FROM public.promotion_categories WHERE promotion_id = ${id}`);
      await this.uow.db.execute(sql`DELETE FROM public.promotion_subcategories WHERE promotion_id = ${id}`);
      await this.insertLinks(sql`public.promotion_dishes (promotion_id, dish_id)`, sql`public.dishes`, id, t.dishIds, 'targets.dishIds');
      await this.insertLinks(sql`public.promotion_categories (promotion_id, category_id)`, sql`public.categories`, id, t.categoryIds, 'targets.categoryIds');
      await this.insertLinks(sql`public.promotion_subcategories (promotion_id, subcategory_id)`, sql`public.subcategories`, id, t.subcategoryIds, 'targets.subcategoryIds');
    }
    if (replace.comboGroups) {
      await this.uow.db.execute(sql`DELETE FROM public.promotion_combo_groups WHERE promotion_id = ${id}`);
      if (p.kind !== 'combo') return;
      for (const [position, group] of p.comboGroups.entries()) {
        const { rows } = await this.uow.db.execute(sql`
          INSERT INTO public.promotion_combo_groups (promotion_id, name, position) VALUES (${id}, ${group.name}, ${position}) RETURNING id`);
        const groupId = String((rows[0] as { id: string }).id);
        await this.insertLinks(sql`public.promotion_combo_options (group_id, dish_id)`, sql`public.dishes`, groupId, group.dishIds, `comboGroups.${position}.dishIds`);
      }
    }
  }

  private async insertLinks(into: SQL, from: SQL, ownerId: string, ids: readonly string[], path: string): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const result = await this.uow.db.execute(sql`
      INSERT INTO ${into} SELECT ${ownerId}::uuid, x.id FROM ${from} x WHERE x.id = ANY(${sql.param(unique)}::uuid[])`);
    if (result.rowCount !== unique.length) throw unknownTarget(path);
  }

  private async assertPromotion(id: string): Promise<void> {
    const [row] = await this.uow.db.select({ id: promotions.id }).from(promotions).where(eq(promotions.id, id)).for('update');
    if (!row) {
      throw new NotFoundException('Promotion not found');
    }
  }
}

const COLUMN_NAMES = [
  'name', 'description', 'kind', 'mode', 'discount_type', 'discount_value', 'buy_quantity', 'pay_quantity', 'rest_discount_percent',
  'combo_price', 'min_subtotal', 'max_discount', 'start_date', 'end_date', 'days_of_week', 'time_windows', 'channels',
  'max_uses_per_order', 'active',
];

/** YYYY-MM-DD is the start (or the end) of that day in the restaurant timezone; anything else is an instant. */
function dateValue(value: string, timeZone: string, edge: 'start' | 'end'): SQL {
  if (DATE_ONLY.test(value)) {
    return edge === 'start'
      ? sql`(${value}::date::timestamp AT TIME ZONE ${timeZone})`
      : sql`((((${value}::date + 1)::timestamp) AT TIME ZONE ${timeZone}) - interval '1 millisecond')`;
  }
  return sql`${new Date(value).toISOString()}::timestamptz`;
}

function defaults(now: RestaurantNow): Omit<PromotionShape, 'name' | 'description'> {
  return {
    kind: 'product_discount',
    mode: 'automatic',
    discountType: null,
    discountValue: null,
    buyQuantity: null,
    payQuantity: null,
    restDiscountPercent: 100,
    comboPrice: null,
    comboGroups: [],
    minSubtotal: null,
    maxDiscount: null,
    startDate: now.instant.toISOString(),
    endDate: null,
    daysOfWeek: [],
    timeWindows: [],
    channels: [],
    maxUsesPerOrder: null,
    active: true,
    targets: { dishIds: [], categoryIds: [], subcategoryIds: [] },
  };
}

/** The stored promotion as a write body, so a PATCH is validated merged. */
function toShape({ rule, description, startsAt, endsAt }: PromotionRecord): PromotionShape {
  return {
    name: rule.name,
    description,
    kind: rule.kind,
    mode: rule.mode,
    discountType: rule.discountType,
    discountValue: rule.discountValue,
    buyQuantity: rule.kind === 'buy_x_pay_y' ? rule.buyQuantity : null,
    payQuantity: rule.kind === 'buy_x_pay_y' ? rule.payQuantity : null,
    restDiscountPercent: rule.kind === 'buy_x_pay_y' ? rule.restDiscountPercent : 100,
    comboPrice: rule.kind === 'combo' ? rule.comboPrice : null,
    comboGroups: rule.comboGroups.map((g) => ({ name: g.name, dishIds: g.dishIds })),
    minSubtotal: rule.minSubtotal,
    maxDiscount: rule.maxDiscount,
    startDate: startsAt,
    endDate: endsAt,
    daysOfWeek: rule.daysOfWeek,
    timeWindows: rule.timeWindows,
    channels: rule.channels,
    maxUsesPerOrder: rule.maxUsesPerOrder,
    active: rule.active,
    targets: rule.targets,
  };
}

const nullIfZero = (value: number, used: boolean) => (used ? value : null);

export function toPromotion(record: PromotionRecord, now: RestaurantNow, names: TargetNames, stats: PromotionStats): Promotion {
  const { rule } = record;
  const state = scheduleState(rule, now.local);
  return {
    id: rule.id,
    name: rule.name,
    description: record.description,
    kind: rule.kind,
    mode: rule.mode,
    discountType: rule.discountType,
    discountValue: rule.discountValue,
    buyQuantity: nullIfZero(rule.buyQuantity, rule.kind === 'buy_x_pay_y'),
    payQuantity: nullIfZero(rule.payQuantity, rule.kind === 'buy_x_pay_y'),
    restDiscountPercent: nullIfZero(rule.restDiscountPercent, rule.kind === 'buy_x_pay_y'),
    comboPrice: nullIfZero(rule.comboPrice, rule.kind === 'combo'),
    comboGroups: rule.comboGroups,
    minSubtotal: rule.minSubtotal,
    maxDiscount: rule.maxDiscount,
    startDate: record.startsAt,
    endDate: record.endsAt,
    daysOfWeek: rule.daysOfWeek,
    timeWindows: rule.timeWindows,
    channels: rule.channels,
    maxUsesPerOrder: rule.maxUsesPerOrder,
    active: rule.active,
    targets: rule.targets,
    stats,
    schedule: {
      activeNow: state.activeNow,
      reason: state.reason,
      endsAt: clockText(state.endsAtMinutes),
      nextStartToday: clockText(state.nextStartTodayMinutes),
    },
    sentence: promotionSentence(rule, names),
    badge: promotionBadge(rule),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

