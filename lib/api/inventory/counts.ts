/**
 * Physical counts. `open_inventory_count` snapshots expected quantities, the
 * admin then sets each line's counted quantity, and `apply_inventory_count`
 * sets the final balance = counted. An open count can be cancelled.
 */

import { api } from "@/lib/api/client"
import { byId, defined, required } from "./shared"
import type { ApplyCountResult, InventoryCount, InventoryCountDetail, OpenCountInput, OpenCountResult } from "./types"

/** Newest first. */
export async function listCounts(): Promise<InventoryCount[]> {
  const { data } = await api.GET("/api/inventory/counts")
  return required(data)
}

/** Lines sorted by item name (server-side, es collation). */
export async function getCount(id: string): Promise<InventoryCountDetail> {
  const { data } = await api.GET("/api/inventory/counts/{id}", byId(id))
  return required(data)
}

export async function openCount(input: OpenCountInput = {}): Promise<OpenCountResult> {
  const { data } = await api.POST("/api/inventory/counts", { body: defined({ ...input }) })
  return required(data)
}

/** null clears the line (not counted yet). */
export async function setCountedQuantity(countId: string, lineId: string, countedQuantity: number | null): Promise<void> {
  await api.PATCH("/api/inventory/counts/{id}/lines/{lineId}", {
    params: { path: { id: countId, lineId } },
    body: { countedQuantity },
  })
}

export async function applyCount(countId: string): Promise<ApplyCountResult> {
  const { data } = await api.POST("/api/inventory/counts/{id}/apply", byId(countId))
  return required(data)
}

export async function cancelCount(countId: string): Promise<void> {
  await api.POST("/api/inventory/counts/{id}/cancel", byId(countId))
}
