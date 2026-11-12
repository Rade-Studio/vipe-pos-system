import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { Clock } from '../common/clock';
import { UnitOfWork } from '../db/unit-of-work';
import { type EnginePromotion, type LocalClock, toLocalClock } from './engine';

/** promotions_channels_check (0028): dine_in (Salón), takeaway (Para llevar, 0033) and delivery (Domicilio), the orders.order_type values. */
export const PROMOTION_CHANNELS = ['dine_in', 'takeaway', 'delivery'] as const;
export type PromotionChannel = (typeof PROMOTION_CHANNELS)[number];
export const CHANNEL_LABELS: Record<PromotionChannel, string> = { dine_in: 'Salón', takeaway: 'Para llevar', delivery: 'Domicilio' };

export type Rule = EnginePromotion<PromotionChannel>;

/** A promotion row in the engine shape plus what the admin DTO adds. */
export interface PromotionRecord {
  rule: Rule;
  description: string | null;
  /** timestamptz as ISO 8601. */
  startsAt: string;
  endsAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** "Now" on the server clock, in the restaurant's timezone. */
export interface RestaurantNow {
  instant: Date;
  timeZone: string;
  local: LocalClock;
}

/** One promotion as records() reads it (and private.guest_menu_data returns it, 0034). */
export interface PromotionJson {
  id: string;
  name: string;
  description: string | null;
  kind: Rule['kind'];
  mode: Rule['mode'];
  active: boolean | null;
  start_date: string;
  end_date: string | null;
  start_local: string;
  end_local: string | null;
  days_of_week: number[];
  time_windows: { from: string; to: string }[];
  channels: PromotionChannel[];
  max_uses_per_order: number | null;
  discount_type: Rule['discountType'];
  discount_value: number | null;
  buy_quantity: number | null;
  pay_quantity: number | null;
  rest_discount_percent: number | null;
  combo_price: number | null;
  min_subtotal: number | null;
  max_discount: number | null;
  created_at: string | null;
  updated_at: string | null;
  dish_ids: string[];
  category_ids: string[];
  subcategory_ids: string[];
  combo_groups: { id: string; name: string; dish_ids: string[] }[];
}

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/**
 * Loads the caller's promotions (RLS) in the engine shape, with their targets
 * and combo groups, in one query, oldest first (the engine's tie order), and
 * the restaurant clock (restaurants.timezone, default America/Bogota).
 */
@Injectable()
export class PromotionCatalog {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async now(): Promise<RestaurantNow> {
    const { rows } = await this.uow.db.execute(sql`
      SELECT coalesce((SELECT r.timezone FROM public.restaurants r WHERE r.id = private.current_restaurant_id()), 'America/Bogota') AS tz`);
    return restaurantNow(this.clock.now(), String((rows[0] as { tz: string }).tz));
  }

  /** Every promotion, or only `ids`. */
  async records(ids?: readonly string[]): Promise<PromotionRecord[]> {
    const where: SQL = ids ? sql`WHERE p.id = ANY(${sql.param([...ids])}::uuid[])` : sql``;
    const { rows } = await this.uow.db.execute(sql`
      SELECT jsonb_build_object(
               'id', p.id, 'name', p.name, 'description', p.description, 'kind', p.kind, 'mode', p.mode, 'active', p.active,
               'start_date', p.start_date, 'end_date', p.end_date,
               'start_local', to_char((p.start_date AT TIME ZONE tz.name)::date, 'YYYY-MM-DD'),
               'end_local', to_char((p.end_date AT TIME ZONE tz.name)::date, 'YYYY-MM-DD'),
               'days_of_week', p.days_of_week, 'time_windows', p.time_windows, 'channels', p.channels,
               'max_uses_per_order', p.max_uses_per_order, 'discount_type', p.discount_type, 'discount_value', p.discount_value,
               'buy_quantity', p.buy_quantity, 'pay_quantity', p.pay_quantity, 'rest_discount_percent', p.rest_discount_percent,
               'combo_price', p.combo_price, 'min_subtotal', p.min_subtotal, 'max_discount', p.max_discount,
               'created_at', p.created_at, 'updated_at', p.updated_at,
               'dish_ids', coalesce((SELECT jsonb_agg(x.dish_id ORDER BY x.dish_id) FROM public.promotion_dishes x WHERE x.promotion_id = p.id), '[]'::jsonb),
               'category_ids', coalesce((SELECT jsonb_agg(x.category_id ORDER BY x.category_id) FROM public.promotion_categories x WHERE x.promotion_id = p.id), '[]'::jsonb),
               'subcategory_ids', coalesce((SELECT jsonb_agg(x.subcategory_id ORDER BY x.subcategory_id) FROM public.promotion_subcategories x WHERE x.promotion_id = p.id), '[]'::jsonb),
               'combo_groups', coalesce((
                 SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'dish_ids', coalesce((
                          SELECT jsonb_agg(o.dish_id ORDER BY o.created_at, o.dish_id) FROM public.promotion_combo_options o WHERE o.group_id = g.id), '[]'::jsonb))
                        ORDER BY g.position, g.created_at, g.id)
                   FROM public.promotion_combo_groups g WHERE g.promotion_id = p.id), '[]'::jsonb)) AS row
        FROM public.promotions p
        CROSS JOIN (SELECT coalesce((SELECT r.timezone FROM public.restaurants r WHERE r.id = private.current_restaurant_id()), 'America/Bogota') AS name) tz
       ${where}
       ORDER BY p.created_at, p.id`);
    return (rows as { row: PromotionJson }[]).map(({ row }) => toRecord(row));
  }

  async rules(ids?: readonly string[]): Promise<Rule[]> {
    return (await this.records(ids)).map((record) => record.rule);
  }
}

/** `instant` on the clock of `timeZone`: the one rule for "now" of a restaurant. */
export function restaurantNow(instant: Date, timeZone: string): RestaurantNow {
  return { instant, timeZone, local: toLocalClock(instant, timeZone) };
}

const num = (value: number | string | null | undefined, fallback: number) => (value === null || value === undefined ? fallback : Number(value));
const nullableNum = (value: number | string | null | undefined) => (value === null || value === undefined ? null : Number(value));

export function toRecord(row: PromotionJson): PromotionRecord {
  const rule: Rule = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.mode,
    // Nullable in the schema; a missing flag was always read as inactive.
    active: row.active === true,
    startDate: row.start_local,
    endDate: row.end_local,
    daysOfWeek: [...row.days_of_week].sort((a, b) => a - b),
    timeWindows: row.time_windows,
    channels: row.channels,
    maxUsesPerOrder: row.max_uses_per_order,
    createdAt: iso(row.created_at) ?? '',
    discountType: row.discount_type,
    discountValue: nullableNum(row.discount_value),
    buyQuantity: num(row.buy_quantity, 0),
    payQuantity: num(row.pay_quantity, 0),
    restDiscountPercent: num(row.rest_discount_percent, 0),
    comboPrice: num(row.combo_price, 0),
    comboGroups: row.combo_groups.map((g) => ({ id: g.id, name: g.name, dishIds: g.dish_ids })),
    minSubtotal: nullableNum(row.min_subtotal),
    maxDiscount: nullableNum(row.max_discount),
    targets: { dishIds: row.dish_ids, categoryIds: row.category_ids, subcategoryIds: row.subcategory_ids },
    unitNoun: null,
  };
  return {
    rule,
    description: row.description,
    startsAt: iso(row.start_date)!,
    endsAt: iso(row.end_date),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
