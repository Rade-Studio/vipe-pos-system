/**
 * Dashboard window and cache slot.
 *
 * T9 (S1) split the old seven sequential reads into four parallel, bounded
 * reads. T12 moved the aggregates to the server: `GET /dashboard/summary`
 * computes the month sales, the kitchen count, the daily series and the
 * popular dishes in SQL in the restaurant timezone, so the Resumen page issues
 * ONE request, cached under one key that records its window.
 */
import { daysAgoIso, monthStartIso } from "./dates"

/** Days of the "Ventas por día" series and the "Platos Populares" window. */
export const DASHBOARD_DAYS = 30

/**
 * How long the summary is fresh. A tab switch inside this window costs zero
 * requests; after it, a background refetch keeps the previous numbers on
 * screen instead of blanking the panel.
 */
export const DASHBOARD_STALE_MS = 60_000

export { daysAgoIso, monthStartIso }

export function dashboardSummaryKey(days: number): readonly string[] {
  return ["admin", "dashboard", "summary", String(days)]
}
