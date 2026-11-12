import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import { Clock } from '../common/clock';
import { UnitOfWork } from '../db/unit-of-work';
import { ConfigService } from '../settings/config.service';
import type { PromotionWeekStats } from './catalog.dto';

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

/**
 * The promotions header figures (S9) for the business week holding now: from
 * Monday at businessDayCutoffHour (restaurant timezone) through now, the same
 * cut-off rule as the cash business day (CashService.scope), so Monday before
 * the cut-off still belongs to the previous week. Only paid orders, by
 * created_at; gross = subtotal + total_discounts. RLS scopes to the caller.
 */
@Injectable()
export class PromotionWeekStatsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly clock: Clock,
  ) {}

  async week(): Promise<PromotionWeekStats> {
    const cutoff = (await this.config.get()).businessDayCutoffHour;
    const now = this.clock.now().toISOString();
    const { rows } = await this.uow.db.execute(sql`
      WITH bounds AS (
        SELECT tz, cut, ((day - (extract(isodow FROM day)::int - 1))::timestamp + cut) AT TIME ZONE tz AS lo
          FROM (SELECT tz, cut, ((${now}::timestamptz AT TIME ZONE tz) - cut)::date AS day
                  FROM (SELECT coalesce((SELECT r.timezone FROM public.restaurants r WHERE r.id = private.current_restaurant_id()), 'America/Bogota') AS tz,
                               make_interval(hours => ${cutoff}::int) AS cut) t) d),
      paid AS (
        SELECT coalesce(o.total_discounts, 0) AS discount, o.subtotal + coalesce(o.total_discounts, 0) AS gross,
               EXISTS (SELECT 1 FROM public.order_discounts od WHERE od.order_id = o.id) AS promoted
          FROM public.orders o, bounds b
         WHERE o.status = 'paid' AND o.created_at >= b.lo AND o.created_at <= ${now}::timestamptz)
      SELECT (SELECT lo FROM bounds) AS lo,
             coalesce(sum(discount), 0) AS discount, coalesce(sum(gross), 0) AS gross,
             coalesce(sum(gross) FILTER (WHERE promoted), 0) AS promoted_gross, count(*) FILTER (WHERE promoted) AS bills
        FROM paid`);
    const row = rows[0] as Record<string, unknown>;
    const discountGranted = num(row.discount);
    const salesGross = num(row.gross);
    return {
      weekStart: new Date(String(row.lo)).toISOString(),
      now,
      discountGranted,
      salesGross,
      discountPercent: salesGross > 0 ? Math.round((discountGranted / salesGross) * 1000) / 10 : 0,
      salesWithPromotion: num(row.promoted_gross),
      billsWithPromotion: num(row.bills),
    };
  }
}
