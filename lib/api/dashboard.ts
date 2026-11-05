import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * The Resumen widgets (T12): ONE `GET /dashboard/summary` computed in SQL in
 * the restaurant timezone. Errors reject, so the page shows its error state
 * instead of the old silent zeros.
 */

export type DashboardSummary = components["schemas"]["DashboardSummary"]

export async function fetchDashboardSummary(days: number): Promise<DashboardSummary> {
  const { data } = await api.GET("/api/dashboard/summary", { params: { query: { days: String(days) } } })
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}
