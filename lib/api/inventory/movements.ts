/**
 * Stock reads (lots, movement ledger) and the single-item stock moves:
 * `inventory_adjust` (opening / adjustment / waste) and `inventory_transfer`
 * (FEFO between locations).
 */

import { api } from "@/lib/api/client"
import { byId, csv, defined, required } from "./shared"
import type {
  AdjustStockInput,
  AdjustStockResult,
  Lot,
  MovementFilters,
  MovementPage,
  TransferStockInput,
  TransferStockResult,
} from "./types"

/** The server's page size when `pageSize` is not given. */
export const DEFAULT_MOVEMENTS_PAGE_SIZE = 50

/** Lots of one item in FEFO order (expires_on ASC NULLS LAST, received_at). Empty lots included. */
export async function listLots(itemId: string): Promise<Lot[]> {
  const { data } = await api.GET("/api/inventory/items/{id}/lots", byId(itemId))
  return required(data)
}

/**
 * Newest first, one page (1-based) plus the exact total for the filters. A
 * bare date as `to` means the whole local day of the restaurant (server-side).
 */
export async function listMovements(filters: MovementFilters = {}): Promise<MovementPage> {
  const { data } = await api.GET("/api/inventory/movements", {
    params: {
      query: defined({
        itemId: filters.itemId,
        locationId: filters.locationId,
        types: csv(filters.types),
        from: filters.from || undefined,
        to: filters.to || undefined,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    },
  })
  return required(data)
}

export async function adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
  const { data } = await api.POST("/api/inventory/movements/adjust", { body: defined({ ...input }) })
  return required(data)
}

export async function transferStock(input: TransferStockInput): Promise<TransferStockResult> {
  const { data } = await api.POST("/api/inventory/movements/transfer", { body: defined({ ...input }) })
  return required(data)
}
