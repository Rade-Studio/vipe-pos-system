/** Inventory dashboard data (`inventory_overview`, admin only). */

import { api } from "@/lib/api/client"
import { required } from "./shared"
import type { InventoryOverview } from "./types"

export async function getInventoryOverview(days = 30): Promise<InventoryOverview> {
  const { data } = await api.GET("/api/inventory/overview", { params: { query: { days } } })
  return required(data)
}
