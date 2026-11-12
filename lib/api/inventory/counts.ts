/**
 * Physical counts. `open_inventory_count` snapshots expected quantities, the
 * admin then sets each line's counted quantity, and `apply_inventory_count`
 * sets the final balance = counted. An open count can be cancelled.
 *
 * With a counter and an approver (S5): openCount prepares a draft, startCount
 * opens it, the counter counts blind through the *MyCount* wrappers and
 * submits, and an admin who did not count asks for a recount or applies.
 */

import { api } from "@/lib/api/client"
import { byId, defined, required } from "./shared"
import type {
  ApplyCountResult,
  InventoryCount,
  InventoryCountDetail,
  MyCount,
  MyCountDetail,
  MyCountLine,
  OpenCountInput,
  OpenCountResult,
} from "./types"

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

/** Reason of a line's difference (line notes); null clears it. Counting or review. */
export async function setCountReason(countId: string, lineId: string, reason: string | null): Promise<void> {
  await api.PATCH("/api/inventory/counts/{id}/lines/{lineId}", {
    params: { path: { id: countId, lineId } },
    body: { reason },
  })
}

/** draft -> counting. */
export async function startCount(countId: string): Promise<InventoryCount> {
  const { data } = await api.POST("/api/inventory/counts/{id}/start", byId(countId))
  return required(data)
}

/** counting -> review (every line counted). */
export async function submitCount(countId: string): Promise<InventoryCount> {
  const { data } = await api.POST("/api/inventory/counts/{id}/submit", byId(countId))
  return required(data)
}

/** review -> counting for these lines only. */
export async function requestRecount(countId: string, lineIds: string[]): Promise<InventoryCount> {
  const { data } = await api.POST("/api/inventory/counts/{id}/recount", { ...byId(countId), body: { lineIds } })
  return required(data)
}

/** Counts assigned to the caller, newest first (blind). */
export async function listMyCounts(): Promise<MyCount[]> {
  const { data } = await api.GET("/api/inventory/my-counts")
  return required(data)
}

/** Lines by item name, without expected stock. */
export async function getMyCount(countId: string): Promise<MyCountDetail> {
  const { data } = await api.GET("/api/inventory/my-counts/{id}", byId(countId))
  return required(data)
}

/** null clears the line. During a recount only the marked lines. */
export async function setMyCountedQuantity(countId: string, lineId: string, countedQuantity: number | null): Promise<MyCountLine> {
  const { data } = await api.PATCH("/api/inventory/my-counts/{id}/lines/{lineId}", {
    params: { path: { id: countId, lineId } },
    body: { countedQuantity },
  })
  return required(data)
}

export async function submitMyCount(countId: string): Promise<MyCount> {
  const { data } = await api.POST("/api/inventory/my-counts/{id}/submit", byId(countId))
  return required(data)
}
