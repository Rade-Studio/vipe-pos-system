import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { Clock } from '../common/clock';
import { UnitOfWork } from '../db/unit-of-work';
import { type DailySales, type DashboardSummary, DEFAULT_DAYS, type PopularDish, POPULAR_DISHES_LIMIT } from './dashboard.dto';

/**
 * Admin overview aggregates (T12), computed in SQL with the definitions of
 * lib/supabase/dashboard-service.ts, but in `restaurants.timezone` instead of
 * the browser's: month start and "local midnight N days back" are restaurant
 * days, and the daily series groups by the restaurant's calendar day (the web
 * grouped by the UTC date). RLS limits every read to the caller's restaurant.
 * Errors propagate (the web used to swallow them into 0 and []).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async summary(days = DEFAULT_DAYS): Promise<DashboardSummary> {
    const now = this.clock.now().toISOString();
    const bounds = sql`
      bounds AS (
        SELECT date_trunc('month', l.now_local) AT TIME ZONE l.tz AS month_start,
               (l.now_local::date - ${days}::int)::timestamp AT TIME ZONE l.tz AS since,
               l.tz
          FROM (SELECT r.timezone AS tz, ${now}::timestamptz AT TIME ZONE r.timezone AS now_local
                  FROM public.restaurants r
                 WHERE r.id = private.current_restaurant_id()) l
      )`;

    const [totals] = await this.rows<{ month_sales: string; kitchen_orders: string }>(sql`
      WITH ${bounds}
      SELECT (SELECT coalesce(sum(o.total), 0) FROM public.orders o, bounds b
               WHERE o.status = 'paid' AND o.created_at >= b.month_start) AS month_sales,
             (SELECT count(*) FROM public.orders o WHERE o.status = 'kitchen') AS kitchen_orders`);

    const daily = await this.rows<{ date: string; amount: string }>(sql`
      WITH ${bounds}
      SELECT to_char((o.created_at AT TIME ZONE b.tz)::date, 'YYYY-MM-DD') AS date, sum(o.total) AS amount
        FROM public.orders o, bounds b
       WHERE o.status = 'paid' AND o.created_at >= b.since
       GROUP BY 1
       ORDER BY 1`);

    const popular = await this.rows<{ id: string | null; name: string; count: string }>(sql`
      WITH ${bounds}
      SELECT (array_agg(oi.dish_id ORDER BY oi.dish_id) FILTER (WHERE oi.dish_id IS NOT NULL))[1] AS id,
             oi.name, sum(oi.quantity) AS count
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id, bounds b
       WHERE o.status = 'paid' AND o.created_at >= b.since
         AND oi.status IS DISTINCT FROM 'cancelled'
       GROUP BY oi.name
       ORDER BY count DESC, oi.name
       LIMIT ${POPULAR_DISHES_LIMIT}`);

    return {
      monthSales: Number(totals?.month_sales ?? 0),
      kitchenOrders: Number(totals?.kitchen_orders ?? 0),
      dailySales: daily.map((row): DailySales => ({ date: row.date, amount: Number(row.amount) })),
      popularDishes: popular.map((row): PopularDish => ({ id: row.id, name: row.name, count: Number(row.count) })),
    };
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}
