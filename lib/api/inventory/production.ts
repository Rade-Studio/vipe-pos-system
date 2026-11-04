/** Batch production of preparations (`produce_preparation`) and the batch history. */

import { api } from "@/lib/api/client"
import { defined, required } from "./shared"
import type { ProducePreparationInput, ProducePreparationResult, ProductionBatch } from "./types"

/** Newest first, optionally for one preparation (server default limit 100). */
export async function listBatches(options: { itemId?: string; limit?: number } = {}): Promise<ProductionBatch[]> {
  const { data } = await api.GET("/api/inventory/batches", {
    params: { query: defined({ itemId: options.itemId, limit: options.limit }) },
  })
  return required(data)
}

/** Insufficient stock rejects with P0001 whose `details` lists the shortages (see toInventoryError). */
export async function producePreparation(input: ProducePreparationInput): Promise<ProducePreparationResult> {
  const { data } = await api.POST("/api/inventory/production", { body: defined({ ...input }) })
  return required(data)
}
