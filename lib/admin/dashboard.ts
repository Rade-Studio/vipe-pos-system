/**
 * T9 (S1) — Dashboard read boundaries and cache slots.
 *
 * The Dashboard tab used to run ONE `useEffect` that awaited seven reads back
 * to back on every mount: four inside `getDashboardStats` (paid orders of the
 * month, kitchen orders, tables, waiters), the 30-day sales series, the
 * popular dishes and the assigned-table count. Two of those four stats reads
 * duplicated data the shell had already loaded for the admin
 * (`lib/shell/startup-loads.ts`: `tables`, `waiters`), and the assigned-table
 * count duplicated the tables read a second time.
 *
 * What is left is four independent reads, fired in parallel by React Query,
 * each gated by the Dashboard tab being open and each bounded by a period
 * recorded in its cache key.
 */
import { daysAgoIso, monthStartIso } from "./dates"

/** Days of the "Ventas por día" series. */
export const DAILY_SALES_DAYS = 30

/**
 * Days of the "Platos Populares" chart. The old read had NO date filter and no
 * limit: it read every paid order_item the tenant has ever had.
 */
export const POPULAR_DISHES_DAYS = 30

/** Rows the chart shows. */
export const POPULAR_DISHES_LIMIT = 10

/**
 * How long a dashboard read is fresh. A tab switch inside this window costs
 * zero requests; after it, a background refetch keeps the previous numbers on
 * screen instead of blanking the panel.
 */
export const DASHBOARD_STALE_MS = 60_000

export { daysAgoIso, monthStartIso }

/** `since` bound for the month's paid sales. */
export function monthSalesSinceIso(now: Date): string {
  return monthStartIso(now)
}

/** `since` bound for the popular-dishes read (never unbounded). */
export function popularDishesSinceIso(now: Date, days: number = POPULAR_DISHES_DAYS): string {
  return daysAgoIso(now, days)
}

export function dashboardMonthSalesKey(sinceIso: string): readonly string[] {
  return ["admin", "dashboard", "month-sales", sinceIso]
}

export function dashboardKitchenOrdersKey(): readonly string[] {
  return ["admin", "dashboard", "kitchen-orders"]
}

export function dashboardDailySalesKey(days: number): readonly string[] {
  return ["admin", "dashboard", "daily-sales", String(days)]
}

export function dashboardPopularDishesKey(days: number, limit: number): readonly string[] {
  return ["admin", "dashboard", "popular-dishes", `${days}`, String(limit)]
}